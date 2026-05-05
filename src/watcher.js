'use strict';

const chokidar = require('chokidar');
const path     = require('path');
const config   = require('./config');
const queue    = require('./queue');
const logger   = require('./logger');
const { isImage, isFait } = require('./utils');

function start() {
  const ignoreInitial = !config.watcher || config.watcher.ignoreInitial !== false;
  const watcher = chokidar.watch(config.paths.raw, {
    persistent:     true,
    ignoreInitial,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    ignored: (filePath) => {
      const base = path.basename(filePath);
      return base.startsWith('.') || isFait(filePath);
    },
  });

  watcher.on('add', (filePath) => {
    if (!isImage(filePath) || isFait(filePath)) return;
    logger.info('Détecté', { file: path.basename(filePath) });
    queue.enqueue(filePath);
  });

  watcher.on('error', (err) => logger.info(`Erreur watcher: ${err.message}`));

  logger.info(`Surveillance active : ${config.paths.raw}`);
  return watcher;
}

module.exports = { start };
