'use strict';

const { execFileSync } = require('child_process');

// Run an ImageMagick command and return stdout as string, or null on failure
function imRun(args) {
  try {
    return execFileSync('magick', args, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function parseFloat_(s, fallback) {
  if (!s) return fallback;
  const v = parseFloat(s);
  return isNaN(v) ? fallback : v;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getLumaStats(imagePath) {
  const raw = imRun([imagePath, '-colorspace', 'Gray', '-format', '%[fx:mean] %[fx:standard_deviation]', 'info:']);
  if (!raw) return { brightness: 0.5, contrast: 0.15 };
  const [meanRaw, stdRaw] = raw.split(/\s+/);
  return {
    brightness: clamp(parseFloat_(meanRaw, 0.5), 0, 1),
    contrast:   clamp(parseFloat_(stdRaw, 0.15), 0, 1),
  };
}

// Brightness: mean luminance in [0,1]. Ideal ~0.50
function getBrightness(imagePath) {
  return getLumaStats(imagePath).brightness;
}

// Contrast: std-dev of luminance in [0,1]. Flat ~0.05, rich ~0.15-0.25
function getContrast(imagePath) {
  return getLumaStats(imagePath).contrast;
}

// Saturation: mean of S channel in HSL [0,1]
function getSaturation(imagePath) {
  const raw = imRun([
    imagePath, '-colorspace', 'HSL',
    '-channel', 'Green', '-separate',
    '-format', '%[fx:mean]', 'info:',
  ]);
  return clamp(parseFloat_(raw, 0.5), 0, 1);
}

// Color temperature: R-mean minus B-mean. Positive = warm, negative = cool
function getTemperature(imagePath) {
  const rRaw = imRun([imagePath, '-channel', 'Red',  '-separate', '-format', '%[fx:mean]', 'info:']);
  const bRaw = imRun([imagePath, '-channel', 'Blue', '-separate', '-format', '%[fx:mean]', 'info:']);
  const r = parseFloat_(rRaw, 0.5);
  const b = parseFloat_(bRaw, 0.5);
  return clamp(r - b, -1, 1);
}

// Sharpness: Laplacian std-dev. Blurry ~0.01, sharp ~0.10+
function getSharpness(imagePath) {
  const raw = imRun([
    imagePath,
    '-colorspace', 'Gray',
    '-define', 'convolve:scale=1',
    '-morphology', 'Convolve', 'Laplacian:0',
    '-format', '%[fx:standard_deviation]',
    'info:',
  ]);
  const v = parseFloat_(raw, 0.05);
  return clamp(Math.round(v * 600), 0, 100);
}

/**
 * Analyze an image and return raw metrics.
 * @param {string} imagePath
 * @returns {{ brightness, contrast, saturation, temperature, sharpness }}
 */
function analyze(imagePath) {
  const luma        = getLumaStats(imagePath);
  const brightness  = luma.brightness;
  const contrast    = luma.contrast;
  const saturation  = getSaturation(imagePath);
  const temperature = getTemperature(imagePath);
  const sharpness   = getSharpness(imagePath);
  return { brightness, contrast, saturation, temperature, sharpness };
}

module.exports = { analyze };
