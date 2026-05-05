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
        // Retry x1
        logger.info(`Retry`, { file: path.basename(item.filePath) });
        queue.unshift({ filePath: item.filePath, attempts: item.attempts + 1 });
      } else {
        // Déplacer vers /failed
        try { fs.renameSync(item.filePath, path.join(config.paths.failed, path.basename(item.filePath))); } catch {}
        logger.failed(item.filePath, 'Échec après retry');
      }
    }
  } catch (err) {
    logger.failed(item.filePath, `Erreur queue: ${err.message}`);
  }

  processing = false;
  setImmediate(runNext);
}

function enqueue(filePath) {
  if (!isImage(filePath) || isFait(filePath)) return;
  if (hashService.isDuplicate(filePath)) {
    logger.info('Doublon ignoré', { file: path.basename(filePath) });
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
