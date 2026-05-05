'use strict';

const { execFileSync } = require('child_process');
const fs     = require('fs');
const config = require('../config');

// ── Constants ────────────────────────────────────────────────────────────────

/** Weighted formula: sharpness 50%, contrast 30%, brightness 20% */
const WEIGHTS = { sharpness: 0.5, contrast: 0.3, brightness: 0.2 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function _safeFloat(v, fallback) {
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

function _imRun(args) {
  try { return execFileSync('magick', args, { stdio: 'pipe' }).toString().trim(); }
  catch { return null; }
}

// ── Image measurements (used when scoring by file path) ──────────────────────

function _measureSharpness(imagePath) {
  const raw = _imRun([
    imagePath,
    '-colorspace', 'Gray',
    '-define', 'convolve:scale=1',
    '-morphology', 'Convolve', 'Laplacian:0',
    '-format', '%[fx:standard_deviation]',
    'info:',
  ]);
  return _clamp(Math.round(_safeFloat(raw, 0.05) * 600), 0, 100);
}

function _measureBrightness(imagePath) {
  const raw = _imRun([imagePath, '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:']);
  const v   = _safeFloat(raw, 0.5);
  // Distance from ideal mid-tone 0.5 → penalise over/under-exposure
  return _clamp(Math.round((1 - Math.abs(v - 0.5) * 2.2) * 100), 0, 100);
}

function _measureContrast(imagePath) {
  const raw = _imRun([imagePath, '-colorspace', 'Gray', '-format', '%[fx:standard_deviation]', 'info:']);
  return _clamp(Math.round(_safeFloat(raw, 0.15) * 350), 0, 100);
}

// ── Score calculation ─────────────────────────────────────────────────────────

/**
 * Compute weighted quality score from an analysis object.
 *
 * Formula:
 *   total = sharpness * 0.5 + contrast * 0.3 + brightness * 0.2
 *
 * All input dimensions are expected in [0, 100].
 * Missing or invalid values fall back to 50 (neutral).
 *
 * @param {{ sharpness?: number, contrast?: number, brightness?: number }} analysis
 * @returns {{ total: number, sharpness: number, contrast: number, brightness: number }}
 */
function scoreFromAnalysis(analysis = {}) {
  const sharpness  = _clamp(_safeFloat(analysis.sharpness,  50), 0, 100);
  const contrast   = _clamp(_safeFloat(analysis.contrast,   50), 0, 100);
  const brightness = _clamp(_safeFloat(analysis.brightness, 50), 0, 100);

  const total = _clamp(
    Math.round(
      sharpness  * WEIGHTS.sharpness  +
      contrast   * WEIGHTS.contrast   +
      brightness * WEIGHTS.brightness
    ),
    0, 100
  );

  return { total, sharpness, contrast, brightness };
}

/**
 * Measure image quality directly from a file path using ImageMagick,
 * then apply the weighted formula.
 *
 * @param {string} imagePath
 * @returns {{ total: number, sharpness: number, brightness: number, contrast: number }}
 */
function score(imagePath) {
  const sharpness  = _measureSharpness(imagePath);
  const brightness = _measureBrightness(imagePath);
  const contrast   = _measureContrast(imagePath);

  return scoreFromAnalysis({ sharpness, brightness, contrast });
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Persist score data for a named output file.
 * Merges into the existing scores store; creates the file if absent.
 *
 * @param {string} fileName  output filename (used as key)
 * @param {object} scoreData result from score() or scoreFromAnalysis()
 */
function saveScore(fileName, scoreData) {
  let scores = {};
  try { scores = JSON.parse(fs.readFileSync(config.data.scores, 'utf8')); } catch {}
  scores[fileName] = { ...scoreData, ts: new Date().toISOString() };
  fs.writeFileSync(config.data.scores, JSON.stringify(scores, null, 2), 'utf8');
}

/**
 * Load all persisted scores.
 * @returns {object} filename → scoreData map
 */
function getScores() {
  try { return JSON.parse(fs.readFileSync(config.data.scores, 'utf8')); }
  catch { return {}; }
}

module.exports = { score, scoreFromAnalysis, saveScore, getScores };
