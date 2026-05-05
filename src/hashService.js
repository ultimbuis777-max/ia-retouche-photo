'use strict';

const fs     = require('fs');
const crypto = require('crypto');
const config = require('./config');

function load() {
  try { return JSON.parse(fs.readFileSync(config.data.hashes, 'utf8')); }
  catch { return {}; }
}

function save(hashes) {
  fs.writeFileSync(config.data.hashes, JSON.stringify(hashes, null, 2), 'utf8');
}

function fileHash(filePath) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Vérifie si le contenu du fichier a déjà été traité avec succès.
 * Ne stocke PAS le hash — appeler markProcessed() après succès.
 */
function isDuplicate(filePath) {
  const hash = fileHash(filePath);
  if (!hash) return false;
  const hashes = load();
  return !!hashes[hash];
}

/**
 * Enregistre le hash du fichier comme traité avec succès.
 * À appeler uniquement après un traitement réussi.
 */
function markProcessed(filePath) {
  const hash = fileHash(filePath);
  if (!hash) return;
  const hashes = load();
  if (!hashes[hash]) {
    hashes[hash] = { file: filePath, ts: new Date().toISOString() };
    save(hashes);
  }
}

module.exports = { isDuplicate, markProcessed };
