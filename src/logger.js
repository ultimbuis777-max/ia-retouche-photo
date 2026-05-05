'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('./config');

const logFile = path.join(config.paths.logs, 'log.json');

function readLogs() {
  try { return JSON.parse(fs.readFileSync(logFile, 'utf8')); }
  catch { return []; }
}

function write(entry) {
  const record = { ts: new Date().toISOString(), ...entry };
  const logs   = readLogs();
  logs.push(record);
  fs.writeFileSync(logFile, JSON.stringify(logs.slice(-1000), null, 2), 'utf8');

  const lvl = (entry.status || 'INFO').toUpperCase().padEnd(12);
  const msg = entry.file
    ? `${entry.file}${entry.score !== undefined ? ` -> score:${entry.score}` : ''}${entry.step ? ` [${entry.step}]` : ''}`
    : (entry.message || '');
  console.log(`[${record.ts}] [${lvl}] ${msg}${entry.error ? ' - ' + entry.error : ''}`);
}

module.exports = {
  info:       (message, extra = {}) => write({ status: 'info',       message, ...extra }),
  done:       (file, score, extra = {}) => write({ status: 'done',   file, score, ...extra }),
  failed:     (file, error, extra = {}) => write({ status: 'failed', file, error: String(error), type: 'SYSTEM_ERROR', ...extra }),
  pending:    (file)                    => write({ status: 'pending',    file }),
  processing: (file)                    => write({ status: 'processing', file }),

  /** Image moved to /review for human inspection */
  review: (file, reason, detail) => write({
    status: 'review',
    type:   'VALIDATION_REVIEW',
    file,
    reason,
    detail,
    message: `Image envoyée en révision - ${reason}${detail ? ` (${detail})` : ''}`,
  }),

  /** Technical pipeline error with step context */
  systemError: (file, step, error) => write({
    status: 'failed',
    type:   'SYSTEM_ERROR',
    file,
    step,
    error:  String(error),
  }),

  /** Duplicate image detected — not moved to failed */
  duplicate: (file) => write({
    status:  'duplicate',
    type:    'DUPLICATE_IMAGE',
    file,
    message: `Doublon ignoré : ${file}`,
  }),

  getLogs: readLogs,
};
