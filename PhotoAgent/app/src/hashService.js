'use strict';

const fs     = require('fs');
const crypto = require('crypto');
const config = require('./config');

function load() {
  try { return JSON.parse(fs.readFileSync(config.data.hashes, 'utf8')); }
  catch { return {}; }
}

function isDuplicate(filePath) {
  const hashes = load();
  let hash;
  try { hash = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex'); }
  catch { return false; }
  if (hashes[hash]) return true;
  hashes[hash] = { file: filePath, ts: new Date().toISOString() };
  fs.writeFileSync(config.data.hashes, JSON.stringify(hashes, null, 2), 'utf8');
  return false;
}

module.exports = { isDuplicate };
