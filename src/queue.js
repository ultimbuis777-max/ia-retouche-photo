'use strict';

const fs   = require('fs');
const path = require('path');

const config      = require('./config');
const logger      = require('./logger');
const processor   = require('./processor');
const hashService = require('./hashService');
const { isImage, isFait } = require('./utils');

const queue = [];
const registry = new Map();
const pendingPaths = new Set();
const activePaths = new Set();

let activeCount = 0;
let sessionTotal = 0;
let sessionDone = 0;
let sessionSkipped = 0;
let sessionFailed = 0;
let durationSumMs = 0;
let durationCount = 0;
let lastFile = null;

const COMPLETED_TTL_MS = 10 * 60 * 1000;
const STABLE_MS = 800;
const STABLE_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function absPath(filePath) {
  return path.resolve(filePath);
}

function makeKey(filePath, stat) {
  return `${absPath(filePath)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function pruneRegistry() {
  const cutoff = Date.now() - COMPLETED_TTL_MS;
  for (const [key, entry] of registry.entries()) {
    if (entry.ts < cutoff && ['completed', 'skipped', 'failed'].includes(entry.status)) {
      registry.delete(key);
    }
  }
}

function getConcurrency() {
  const cfg = config.queue || {};
  const max = Number(cfg.maxConcurrency) || 2;
  const val = Number(cfg.concurrency) || 2;
  return Math.max(1, Math.min(val, max, 2));
}

async function waitForStableFile(filePath) {
  let waitedMs = 0;
  let last = null;
  let stableSince = 0;

  while (waitedMs <= STABLE_TIMEOUT_MS) {
    let stat;
    try { stat = fs.statSync(filePath); } catch {
      logger.info('FILE_NOT_FOUND_SKIP', {
        status: 'skipped',
        type: 'FILE_NOT_FOUND_SKIP',
        file: path.basename(filePath),
      });
      return null;
    }

    const current = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    if (current === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= STABLE_MS) return { stat, key: makeKey(filePath, stat) };
    } else {
      last = current;
      stableSince = 0;
    }

    await sleep(200);
    waitedMs += 200;
  }

  logger.info('FILE_NOT_STABLE_SKIP', {
    status: 'skipped',
    type: 'FILE_NOT_STABLE_SKIP',
    file: path.basename(filePath),
  });
  return null;
}

function resetSessionIfIdle() {
  if (
    activeCount === 0 &&
    queue.length === 0 &&
    pendingPaths.size === 0 &&
    sessionDone + sessionSkipped + sessionFailed >= sessionTotal
  ) {
    sessionTotal = 0;
    sessionDone = 0;
    sessionSkipped = 0;
    sessionFailed = 0;
    durationSumMs = 0;
    durationCount = 0;
    lastFile = null;
  }
}

function markSkipped(key, filePath, type) {
  sessionSkipped++;
  lastFile = path.basename(filePath);
  if (key) registry.set(key, { status: 'skipped', ts: Date.now() });
  logger.info(type, {
    status: 'skipped',
    type,
    file: path.basename(filePath),
  });
}

async function runNext() {
  while (activeCount < getConcurrency() && queue.length > 0) {
    const item = queue.shift();
    activeCount++;
    activePaths.add(item.abs);
    registry.set(item.key, { status: 'active', ts: Date.now() });

    (async () => {
      const startedAt = Date.now();
      const baseName = path.basename(item.filePath);
      let finalAttempt = true;
      let countDuration = true;
      let result = null;

      try {
        if (!fs.existsSync(item.filePath)) {
          markSkipped(item.key, item.filePath, 'RAW_SOURCE_MISSING');
          finalAttempt = true;
          countDuration = false;
          result = { success: false, skipped: true, reason: 'missing_source' };
          return;
        }

        result = await processor.process(item.filePath);

        if (result && result.skipped) {
          markSkipped(item.key, item.filePath, result.reason === 'missing_source' ? 'RAW_SOURCE_MISSING' : 'SKIPPED');
          countDuration = false;
          return;
        }

        if (!result || !result.success) {
          if (item.attempts < 1) {
            if (!fs.existsSync(item.filePath)) {
              markSkipped(item.key, item.filePath, 'RAW_SOURCE_MISSING');
              countDuration = false;
              return;
            }

            logger.info(`Retry #${item.attempts + 1}`, { file: baseName });
            queue.unshift({ ...item, attempts: item.attempts + 1 });
            registry.set(item.key, { status: 'queued', ts: Date.now() });
            pendingPaths.add(item.abs);
            finalAttempt = false;
          } else {
            sessionFailed++;
            registry.set(item.key, { status: 'failed', ts: Date.now() });
            if (fs.existsSync(item.filePath)) {
              try {
                fs.renameSync(item.filePath, path.join(config.paths.failed, baseName));
              } catch {}
            }
            logger.failed(item.filePath, 'Max retries atteint');
          }
        }
      } catch (err) {
        sessionFailed++;
        registry.set(item.key, { status: 'failed', ts: Date.now() });
        logger.failed(item.filePath, `Erreur queue: ${err.message}`);
      } finally {
        const totalMs = Date.now() - startedAt;
        activeCount--;
        activePaths.delete(item.abs);
        if (finalAttempt) pendingPaths.delete(item.abs);

        if (finalAttempt && result && result.success) {
          sessionDone++;
          registry.set(item.key, { status: 'completed', ts: Date.now() });
        }

        if (finalAttempt && countDuration) {
          durationSumMs += totalMs;
          durationCount++;
          lastFile = baseName;
        }

        logger.info('Temps moyen par image', {
          type: 'PERF_AVG',
          file: baseName,
          durationMs: totalMs,
          avgMs: durationCount ? Math.round(durationSumMs / durationCount) : 0,
          done: sessionDone,
          skipped: sessionSkipped,
          failed: sessionFailed,
          total: sessionTotal,
        });

        setImmediate(runNext);
      }
    })();
  }
}

async function admit(filePath, abs) {
  const stable = await waitForStableFile(filePath);
  if (!stable) {
    pendingPaths.delete(abs);
    sessionTotal++;
    sessionSkipped++;
    return;
  }

  const key = stable.key;
  pruneRegistry();

  const entry = registry.get(key);
  if (entry && ['queued', 'active'].includes(entry.status)) {
    pendingPaths.delete(abs);
    logger.info('DUPLICATE_ENQUEUE_SKIP', {
      status: 'skipped',
      type: 'DUPLICATE_ENQUEUE_SKIP',
      file: path.basename(filePath),
    });
    return;
  }

  sessionTotal++;

  if (entry && entry.status === 'completed' && Date.now() - entry.ts < COMPLETED_TTL_MS) {
    pendingPaths.delete(abs);
    markSkipped(key, filePath, 'RECENTLY_COMPLETED_SKIP');
    return;
  }

  if (hashService.isDuplicate(filePath)) {
    pendingPaths.delete(abs);
    registry.set(key, { status: 'skipped', ts: Date.now() });
    sessionSkipped++;
    logger.duplicate(path.basename(filePath));
    return;
  }

  registry.set(key, { status: 'queued', ts: Date.now() });
  logger.pending(path.basename(filePath));
  queue.push({ filePath, abs, key, attempts: 0 });
  runNext();
}

function enqueue(filePath) {
  if (!isImage(filePath)) return;
  if (isFait(filePath)) return;

  const abs = absPath(filePath);
  resetSessionIfIdle();
  if (pendingPaths.has(abs) || activePaths.has(abs)) {
    logger.info('DUPLICATE_ENQUEUE_SKIP', {
      status: 'skipped',
      type: 'DUPLICATE_ENQUEUE_SKIP',
      file: path.basename(filePath),
    });
    return;
  }

  pendingPaths.add(abs);
  admit(filePath, abs).catch(err => {
    pendingPaths.delete(abs);
    sessionTotal++;
    sessionFailed++;
    logger.failed(filePath, `Erreur admission queue: ${err.message}`);
  });
}

function getStatus() {
  return {
    queued: queue.length,
    active: activeCount,
    processing: activeCount > 0,
    completed: sessionDone,
    skipped: sessionSkipped,
    failed: sessionFailed,
    total: sessionTotal,
    avgMs: durationCount ? Math.round(durationSumMs / durationCount) : 0,
    lastFile,
    concurrency: getConcurrency(),
  };
}

module.exports = { enqueue, getStatus };
