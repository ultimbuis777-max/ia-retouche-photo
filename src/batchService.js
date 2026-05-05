'use strict';

const fs     = require('fs');
const config = require('./config');

const batches = new Map();

function batchKey(filePath) {
  try {
    const ts = fs.statSync(filePath).mtimeMs;
    return String(Math.floor(ts / config.batch.windowMs));
  } catch {
    return String(Math.floor(Date.now() / config.batch.windowMs));
  }
}

function addToBatch(filePath, scoreData) {
  if (!config.batch.enabled) return;
  const key = batchKey(filePath);
  if (!batches.has(key)) batches.set(key, []);
  batches.get(key).push({ file: filePath, score: scoreData.total });
}

function isTopInBatch(filePath, scoreData) {
  if (!config.batch.enabled) return true;
  const key  = batchKey(filePath);
  const list = batches.get(key) || [];
  const top  = [...list].sort((a, b) => b.score - a.score).slice(0, config.batch.topN);
  return top.some(item => item.file === filePath);
}

function saveHistory(entry) {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(config.data.history, 'utf8')); } catch {}
  history.push({ ...entry, ts: new Date().toISOString() });
  fs.writeFileSync(config.data.history, JSON.stringify(history.slice(-500), null, 2), 'utf8');
}

function getHistory() {
  try { return JSON.parse(fs.readFileSync(config.data.history, 'utf8')); }
  catch { return []; }
}

module.exports = { addToBatch, isTopInBatch, saveHistory, getHistory };
