'use strict';

const { execFileSync } = require('child_process');
const fs     = require('fs');
const config = require('../config');

const WEIGHTS = { sharpness: 0.5, contrast: 0.3, brightness: 0.2 };

function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function _safeFloat(v, fallback) {
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

function _imRun(args) {
  try { return execFileSync('magick', args, { stdio: 'pipe' }).toString().trim(); }
  catch { return null; }
}

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

function _measureLuma(imagePath) {
  const raw = _imRun([imagePath, '-colorspace', 'Gray', '-format', '%[fx:mean] %[fx:standard_deviation]', 'info:']);
  if (!raw) return { brightness: 50, contrast: 50 };

  const [meanRaw, stdRaw] = raw.split(/\s+/);
  const mean = _safeFloat(meanRaw, 0.5);

  return {
    brightness: _clamp(Math.round((1 - Math.abs(mean - 0.5) * 2.2) * 100), 0, 100),
    contrast:   _clamp(Math.round(_safeFloat(stdRaw, 0.15) * 350), 0, 100),
  };
}

function _measureBrightness(imagePath) {
  return _measureLuma(imagePath).brightness;
}

function _measureContrast(imagePath) {
  return _measureLuma(imagePath).contrast;
}

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

function score(imagePath) {
  const sharpness  = _measureSharpness(imagePath);
  const luma       = _measureLuma(imagePath);
  const brightness = luma.brightness;
  const contrast   = luma.contrast;

  return scoreFromAnalysis({ sharpness, brightness, contrast });
}

function saveScore(fileName, scoreData) {
  let scores = {};
  try { scores = JSON.parse(fs.readFileSync(config.data.scores, 'utf8')); } catch {}
  scores[fileName] = { ...scoreData, ts: new Date().toISOString() };
  fs.writeFileSync(config.data.scores, JSON.stringify(scores, null, 2), 'utf8');
}

function getScores() {
  try { return JSON.parse(fs.readFileSync(config.data.scores, 'utf8')); }
  catch { return {}; }
}

module.exports = { score, scoreFromAnalysis, saveScore, getScores };
