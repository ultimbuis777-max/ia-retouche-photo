'use strict';

const fs   = require('fs');
const path = require('path');

// ── Storage ───────────────────────────────────────────────────────────────────

const LEARNING_FILE = path.resolve(__dirname, '..', '..', 'data', 'learning.json');

/**
 * Persistent store shape:
 * {
 *   [clientId]: {
 *     entries: [
 *       { params: {...}, score: number, ts: string },
 *       ...
 *     ]
 *   }
 * }
 */
function _load() {
  try { return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8')); }
  catch { return {}; }
}

function _save(data) {
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCORE_THRESHOLD    = 60;   // minimum score for an entry to count
const MIN_ENTRIES        = 10;   // minimum qualifying entries before override kicks in
const MAX_ENTRIES        = 200;  // cap per client to avoid unbounded growth

// Numeric params that can be averaged
const NUMERIC_PARAMS = [
  'brightness', 'saturation', 'hue',
  'contrast', 'contrastOffset', 'sharpness',
];

// ── Public: record ────────────────────────────────────────────────────────────

/**
 * Persist a processed image's params + score for a given client.
 * Only stores the entry — does not filter here (filtering happens at read time).
 *
 * @param {string} clientId
 * @param {object} params    ImageMagick params that were applied
 * @param {number} score     final quality score (0-100)
 */
function record(clientId, params, score) {
  if (!clientId) return;

  const data   = _load();
  const bucket = data[clientId] || { entries: [] };

  bucket.entries.push({
    params: _pickNumeric(params),
    score:  Number(score) || 0,
    ts:     new Date().toISOString(),
  });

  // Keep only the most recent MAX_ENTRIES
  if (bucket.entries.length > MAX_ENTRIES) {
    bucket.entries = bucket.entries.slice(-MAX_ENTRIES);
  }

  data[clientId] = bucket;
  _save(data);
}

// ── Public: getLearnedPreset ──────────────────────────────────────────────────

/**
 * Build an optimised preset from the client's recorded history.
 *
 * Algorithm:
 *   1. Filter entries with score > SCORE_THRESHOLD
 *   2. Require at least MIN_ENTRIES qualifying entries
 *   3. Compute weighted average of each numeric param
 *      (weight = score, so higher-scored images pull stronger)
 *   4. Round to integers except sharpness (1 decimal)
 *
 * Returns null if the client has insufficient history.
 *
 * @param {string} clientId
 * @returns {object|null}  learned params or null
 */
function getLearnedPreset(clientId) {
  if (!clientId) return null;

  const data    = _load();
  const bucket  = data[clientId];
  if (!bucket || !bucket.entries.length) return null;

  const qualifying = bucket.entries.filter(e => e.score > SCORE_THRESHOLD);
  if (qualifying.length < MIN_ENTRIES) return null;

  return _weightedAverage(qualifying);
}

/**
 * Return learning stats for a client (used by API / dashboard).
 *
 * @param {string} clientId
 * @returns {{ total: number, qualifying: number, ready: boolean, learnedParams: object|null }}
 */
function getStats(clientId) {
  if (!clientId) return { total: 0, qualifying: 0, ready: false, learnedParams: null };

  const data   = _load();
  const bucket = data[clientId];
  if (!bucket) return { total: 0, qualifying: 0, ready: false, learnedParams: null };

  const qualifying = bucket.entries.filter(e => e.score > SCORE_THRESHOLD);
  const ready      = qualifying.length >= MIN_ENTRIES;

  return {
    total:         bucket.entries.length,
    qualifying:    qualifying.length,
    ready,
    learnedParams: ready ? _weightedAverage(qualifying) : null,
  };
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _pickNumeric(params) {
  const out = {};
  for (const k of NUMERIC_PARAMS) {
    if (params[k] !== undefined) out[k] = Number(params[k]);
  }
  // Preserve contrastStretch as-is (string)
  if (params.contrastStretch) out.contrastStretch = params.contrastStretch;
  return out;
}

function _weightedAverage(entries) {
  const totalWeight = entries.reduce((s, e) => s + e.score, 0);
  if (totalWeight === 0) return null;

  const sums = {};

  for (const e of entries) {
    const w = e.score / totalWeight;
    for (const k of NUMERIC_PARAMS) {
      if (e.params[k] !== undefined) {
        sums[k] = (sums[k] || 0) + e.params[k] * w;
      }
    }
  }

  const result = {};
  for (const k of NUMERIC_PARAMS) {
    if (sums[k] === undefined) continue;
    result[k] = k === 'sharpness'
      ? Math.round(sums[k] * 10) / 10   // 1 decimal place
      : Math.round(sums[k]);
  }

  // Use the most frequent contrastStretch string
  const stretchCounts = {};
  for (const e of entries) {
    const v = e.params.contrastStretch;
    if (v) stretchCounts[v] = (stretchCounts[v] || 0) + 1;
  }
  const topStretch = Object.entries(stretchCounts).sort((a, b) => b[1] - a[1])[0];
  if (topStretch) result.contrastStretch = topStretch[0];

  return result;
}

module.exports = { record, getLearnedPreset, getStats };
