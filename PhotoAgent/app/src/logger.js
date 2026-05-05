'use strict';

const fs     = require('fs');
const config = require('./config');

function read() {
  try { return JSON.parse(fs.readFileSync(config.data.logFile, 'utf8')); }
  catch { return []; }
}

function write(entry) {
  const record = { ts: new Date().toISOString(), ...entry };
  const logs   = read();
  logs.push(record);
  try { fs.writeFileSync(config.data.logFile, JSON.stringify(logs.slice(-1000), null, 2), 'utf8'); }
  catch {}
  const lvl = (entry.status || 'INFO').toUpperCase().padEnd(10);
  const msg = entry.file ? entry.file : (entry.message || '');
  const extra = entry.error ? ` ✗ ${entry.error}` : '';
  console.log(`[${record.ts}] [${lvl}] ${msg}${extra}`);
}

module.exports = {
  info:       (message, extra = {}) => write({ status: 'info',       message, ...extra }),
  done:       (file, extra = {})    => write({ status: 'done',       file, ...extra }),
  failed:     (file, error)         => write({ status: 'failed',     file, error: String(error) }),
  pending:    (file)                => write({ status: 'pending',    file }),
  processing: (file)                => write({ status: 'processing', file }),
  getLogs:    read,
};
