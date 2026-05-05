'use strict';

const fs   = require('fs');
const config = require('./src/config');

// Auto-création des dossiers et fichiers requis
const dirs = [
  config.paths.raw, config.paths.retouched, config.paths.failed,
  config.paths.logs, config.paths.data,
];
dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(config.data.hashes))  fs.writeFileSync(config.data.hashes,  '{}', 'utf8');
if (!fs.existsSync(config.data.logFile)) fs.writeFileSync(config.data.logFile, '[]', 'utf8');

const logger  = require('./src/logger');
const api     = require('./src/api');
const watcher = require('./src/watcher');

logger.info('PhotoAgent démarré');
api.start();
watcher.start();

process.on('uncaughtException',  err    => logger.info(`Exception: ${err.message}`));
process.on('unhandledRejection', reason => logger.info(`Rejection: ${String(reason)}`));
