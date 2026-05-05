'use strict';

const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('./src/config');
const logger = require('./src/logger');

// Auto-init all directories
const dirs = [
  config.paths.raw,
  config.paths.retouched,
  config.paths.selected,
  config.paths.failed,
  config.paths.logs,
  config.paths.data,
  config.paths.public,
  config.paths.portrait,
  config.paths.square,
  config.paths.advanced,
];
dirs.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

// Auto-init data files
const dataFiles = [
  { p: config.data.hashes,  c: '{}' },
  { p: config.data.scores,  c: '{}' },
  { p: config.data.history, c: '[]' },
  { p: config.data.advanced, c: '{}' },
  { p: config.data.apiKeys,  c: '{}' },
  { p: path.join(config.paths.logs, 'log.json'), c: '[]' },
];
dataFiles.forEach(({ p, c }) => { if (!fs.existsSync(p)) fs.writeFileSync(p, c, 'utf8'); });

const api     = require('./src/api');
const watcher = require('./src/watcher');

logger.info('AgentOrchestrator démarré — pipeline multi-agents actif');
api.start();
watcher.start();

// Ouvrir le dashboard automatiquement après démarrage du serveur
setTimeout(() => { exec('start http://localhost:3000'); }, 1500);

process.on('uncaughtException',  err    => logger.info(`Uncaught exception: ${err.message}`));
process.on('unhandledRejection', reason => logger.info(`Unhandled rejection: ${String(reason)}`));
