'use strict';

const fs   = require('fs');
const path = require('path');

const config      = require('./config');
const logger      = require('./logger');
const processor   = require('./processor');
const hashService = require('./hashService');
const { isImage, isFait } = require('./utils');

const queue = [];
let processing = false;

async function runNext() {
  if (processing || queue.length === 0) return;
  processing = true;

  const item = queue.shift();
  try {
    const result = await processor.process(item.filePath);
    if (!result.success) {
      if (item.attempts < 1) {
        logger.info(`Retry #${item.attempts + 1}`, { file: path.basename(item.filePath) });
        queue.unshift({ filePath: item.filePath, attempts: item.attempts + 1 });
      } else {
        try {
          fs.renameSync(item.filePath, path.join(config.paths.failed, path.basename(item.filePath)));
        } catch {}
        logger.failed(item.filePath, 'Max retries atteint');
      }
    }
  } catch (err) {
    logger.failed(item.filePath, `Erreur queue: ${err.message}`);
  }

  processing = false;
  setImmediate(runNext);
}

function enqueue(filePath) {
  if (!isImage(filePath)) return;
  if (isFait(filePath)) return;
  if (hashService.isDuplicate(filePath)) {
    logger.duplicate(path.basename(filePath));
    return;
  }
  logger.pending(path.basename(filePath));
  queue.push({ filePath, attempts: 0 });
  runNext();
}

function getStatus() {
  return { queued: queue.length, processing };
}

module.exports = { enqueue, getStatus };
