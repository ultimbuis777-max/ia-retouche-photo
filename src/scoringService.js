'use strict';

const { execFileSync } = require('child_process');
const fs     = require('fs');
const config = require('./config');
const { clamp } = require('./utils');

function imStat(args) {
  try {
    return execFileSync('magick', args, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function getSharpness(imagePath) {
  const out = imStat([
    imagePath,
    '-colorspace', 'Gray',
    '-define', 'convolve:scale=1',
    '-morphology', 'Convolve', 'Laplacian:0',
    '-format', '%[fx:standard_deviation]',
    'info:',
  ]);
  if (!out) return 50;
  const val = parseFloat(out);
  if (isNaN(val)) return 50;
  // laplacian std-dev: blurry ~0.01, sharp ~0.10+
  return clamp(Math.round(val * 600), 0, 100);
}

function getBrightness(imagePath) {
  const out = imStat([imagePath, '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:']);
  if (!out) return 50;
  const val = parseFloat(out);
  if (isNaN(val)) return 50;
  // ideal range 0.3–0.7; penalise extremes
  const distance = Math.abs(val - 0.5);
  return clamp(Math.round((1 - distance * 2.2) * 100), 0, 100);
}

function getContrast(imagePath) {
  const out = imStat([imagePath, '-colorspace', 'Gray', '-format', '%[fx:standard_deviation]', 'info:']);
  if (!out) return 50;
  const val = parseFloat(out);
  if (isNaN(val)) return 50;
  // std-dev of pixel luminance: 0.05 low, 0.15–0.25 good, 0.35+ very high
  return clamp(Math.round(val * 350), 0, 100);
}

function score(imagePath) {
  const sharpness  = getSharpness(imagePath);
  const brightness = getBrightness(imagePath);
  const contrast   = getContrast(imagePath);
  const total      = clamp(Math.round(sharpness * 0.40 + brightness * 0.35 + contrast * 0.25), 0, 100);
  return { total, sharpness, brightness, contrast };
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

module.exports = { score, saveScore, getScores };
