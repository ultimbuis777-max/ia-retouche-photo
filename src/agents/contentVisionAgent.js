'use strict';

/**
 * ContentVisionAgent
 * ------------------
 * Visual-heuristic content-type classifier using ImageMagick metrics.
 *
 * Reuses analysis metrics from analysisAgent (brightness, contrast, saturation,
 * temperature) and adds one extra measurement: edge density (single magick call).
 *
 * Features:
 *  - Batch score smoothing (EMA: 70% current + 30% previous) to reduce noise
 *  - Oscillation guard: if top1 – top2 < 0.08, caps confidence at 'low'
 *  - String confidence labels: 'high' | 'medium' | 'low'
 *  - Name-based keyword fallback when vision confidence is low
 *
 * Types: 'food' | 'portrait' | 'interior' | 'general'
 */

const { execFileSync } = require('child_process');
const path             = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const VISION_THRESHOLD  = 0.38; // below → name fallback
const GENERAL_BASELINE  = 0.28;
const EMA_WEIGHT        = 0.7;  // weight for current frame vs previous
const OSCILLATION_GUARD = 0.08; // min margin top1–top2 for medium/high confidence

// Numeric score → label
const CONF_HIGH   = 0.65;
const CONF_MEDIUM = 0.45;

// ── Batch state (EMA smoothing across consecutive calls) ──────────────────────
// Keyed by type → last smoothed score
const _prevSmoothed = new Map();

// ── Name-based fallback rules ─────────────────────────────────────────────────

const NAME_RULES = [
  { type: 'food',     keys: ['food','pizza','burger','dish','plat','meal','repas','brunch','resto','restaurant','cafe','sushi','pasta','dessert','cocktail','drink','snack','cuisine'] },
  { type: 'portrait', keys: ['portrait','face','people','person','selfie','headshot','profil','visage','model','modele','baby','enfant'] },
  { type: 'interior', keys: ['salon','chambre','room','house','immo','flat','interior','piece','sejour','living','bathroom','office','bureau'] },
];

function _detectByName(filePath) {
  const name = path.basename(filePath).toLowerCase();
  for (const { type, keys } of NAME_RULES) {
    if (keys.some(k => name.includes(k))) return type;
  }
  return 'general';
}

// ── ImageMagick helper ────────────────────────────────────────────────────────

function _imRun(args) {
  try {
    return execFileSync('magick', args, { timeout: 8000, stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function _parseFloat(s, fallback) {
  if (!s) return fallback;
  const v = parseFloat(s);
  return isNaN(v) ? fallback : v;
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Edge density ──────────────────────────────────────────────────────────────
// Mean pixel intensity after -edge 1 on grayscale.
// < 0.030 → soft  (portrait bokeh, close-up food)
// 0.03–0.07 → medium (food textures, product)
// > 0.070 → structured (architectural lines, rooms)

function _getEdgeDensity(imagePath) {
  const raw = _imRun([
    imagePath, '-colorspace', 'Gray',
    '-edge', '1', '-format', '%[fx:mean]', 'info:',
  ]);
  return _clamp(_parseFloat(raw, 0.04), 0, 1);
}

// ── Per-type scoring ──────────────────────────────────────────────────────────

function _scoreFood(br, co, sa, te, ed) {
  let s = 0;
  if      (te > 0.10)  s += 0.30;
  else if (te > 0.05)  s += 0.20;
  else if (te > 0.02)  s += 0.08;
  else if (te < -0.04) s -= 0.12;

  if      (sa > 0.55)  s += 0.25;
  else if (sa > 0.42)  s += 0.14;
  else if (sa < 0.28)  s -= 0.16;

  if (br >= 0.32 && br <= 0.72) s += 0.14;
  else if (br < 0.20)            s -= 0.08;

  if      (ed >= 0.025 && ed <= 0.07) s += 0.10;
  else if (ed > 0.10)                  s -= 0.12;

  if (te > 0.04 && sa > 0.42) s += 0.10;

  return _clamp(s, 0, 1);
}

function _scorePortrait(br, co, sa, te, ed) {
  let s = 0;
  if      (te >= 0.00 && te <= 0.10) s += 0.22;
  else if (te >= -0.02 && te < 0.00) s += 0.10;
  else if (te > 0.14)                 s -= 0.05;
  else if (te < -0.06)                s -= 0.12;

  if      (ed < 0.030) s += 0.28;
  else if (ed < 0.050) s += 0.12;
  else if (ed > 0.080) s -= 0.18;

  if      (sa >= 0.22 && sa <= 0.50) s += 0.18;
  else if (sa > 0.62)                 s -= 0.18;

  if (co >= 0.08 && co <= 0.28) s += 0.12;
  if (br >= 0.38 && br <= 0.74) s += 0.08;

  return _clamp(s, 0, 1);
}

function _scoreInterior(br, co, sa, te, ed) {
  let s = 0;
  if      (ed > 0.09)  s += 0.32;
  else if (ed > 0.06)  s += 0.18;
  else if (ed > 0.04)  s += 0.06;
  else if (ed < 0.022) s -= 0.16;

  if      (br >= 0.42 && br <= 0.82) s += 0.20;
  else if (br < 0.22)                 s -= 0.10;

  if      (sa < 0.36)  s += 0.16;
  else if (sa > 0.55)  s -= 0.16;
  if (te <= 0.02)      s += 0.08;
  else if (te > 0.08)  s -= 0.08;

  if (co >= 0.11 && co <= 0.30) s += 0.12;

  return _clamp(s, 0, 1);
}

// ── Confidence mapping ────────────────────────────────────────────────────────

function _toConfLabel(score, margin) {
  // Oscillation guard: ambiguous result → cap at 'low'
  if (margin < OSCILLATION_GUARD) return 'low';
  if (score >= CONF_HIGH)         return 'high';
  if (score >= CONF_MEDIUM)       return 'medium';
  return 'low';
}

// ── Public: detectFull ────────────────────────────────────────────────────────

/**
 * Classify image content using visual heuristics.
 *
 * @param {string} imagePath   Preprocessed temp image (from analysisAgent)
 * @param {object} analysis    { brightness, contrast, saturation, temperature, sharpness }
 * @param {string} [origPath]  Original file path — name-based fallback only
 * @returns {{
 *   type:            'food'|'portrait'|'interior'|'general',
 *   confidence:      'high'|'medium'|'low',
 *   confidenceScore: number,
 *   source:          'vision'|'name'|'fallback',
 *   scores:          object,
 * }}
 */
function detectFull(imagePath, analysis, origPath) {
  const br = _clamp(analysis.brightness  ?? 0.5,  0, 1);
  const co = _clamp(analysis.contrast    ?? 0.15, 0, 1);
  const sa = _clamp(analysis.saturation  ?? 0.5,  0, 1);
  const te = _clamp(analysis.temperature ?? 0,   -1, 1);

  let ed = 0.04;
  try { ed = _getEdgeDensity(imagePath); } catch {}

  // Raw scores
  const raw = {
    food:     _scoreFood(br, co, sa, te, ed),
    portrait: _scorePortrait(br, co, sa, te, ed),
    interior: _scoreInterior(br, co, sa, te, ed),
    general:  GENERAL_BASELINE,
  };

  // EMA smoothing — stabilise across batch
  const smoothed = {};
  for (const [type, rawScore] of Object.entries(raw)) {
    const prev     = _prevSmoothed.get(type) ?? rawScore;
    smoothed[type] = _clamp(rawScore * EMA_WEIGHT + prev * (1 - EMA_WEIGHT), 0, 1);
  }

  // Sort descending
  const ranked = Object.entries(smoothed).sort((a, b) => b[1] - a[1]);
  const [bestType, bestScore] = ranked[0];
  const margin = bestScore - ranked[1][1];

  // Persist smoothed scores for next call
  for (const [type, score] of ranked) _prevSmoothed.set(type, score);

  // Vision result confident enough
  if (bestScore >= VISION_THRESHOLD) {
    return {
      type:            bestType,
      confidence:      _toConfLabel(bestScore, margin),
      confidenceScore: Math.round(bestScore * 100) / 100,
      source:          'vision',
      scores:          smoothed,
    };
  }

  // Low confidence — name-based fallback
  const nameType = origPath ? _detectByName(origPath) : 'general';
  if (nameType !== 'general') {
    return {
      type:            nameType,
      confidence:      'medium',
      confidenceScore: 0.52,
      source:          'name',
      scores:          smoothed,
    };
  }

  return {
    type:            'general',
    confidence:      'low',
    confidenceScore: 0.30,
    source:          'fallback',
    scores:          smoothed,
  };
}

// ── Public: detect ────────────────────────────────────────────────────────────

/**
 * Convenience wrapper — returns just the type string.
 * Drop-in replacement for contentDetectionAgent.detect().
 */
function detect(imagePath, analysis, origPath) {
  return detectFull(imagePath, analysis, origPath).type;
}

module.exports = { detect, detectFull };
