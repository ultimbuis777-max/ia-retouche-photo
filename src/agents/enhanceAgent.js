'use strict';

const { execFileSync, execSync } = require('child_process');
const config = require('../config');

// ── ImageMagick binary detection ─────────────────────────────────────────────

/**
 * Resolve the ImageMagick CLI binary.
 * - Modern ImageMagick 7+  → `magick`
 * - Legacy ImageMagick 6   → `convert`
 * Cached after first call.
 */
let _imBin = null;

function _resolveBin() {
  if (_imBin) return _imBin;
  for (const candidate of ['magick', 'convert']) {
    try {
      execSync(`${candidate} --version`, { stdio: 'pipe' });
      _imBin = candidate;
      return _imBin;
    } catch {}
  }
  throw new Error('ImageMagick not found. Install ImageMagick 6 or 7 and ensure it is on PATH.');
}

// ── Param helpers ────────────────────────────────────────────────────────────

function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/**
 * Resolve modulate string "brightness,saturation,hue" from params.
 *
 * Accepts two param shapes from presetAgent:
 *   Shape A (flat)  : { brightness, saturation, hue }
 *   Shape B (array) : { modulate: [brightness, saturation, hue] }
 *
 * Values are clamped to safe ranges before use.
 */
function _resolveModulate(params) {
  let brightness, saturation, hue;

  if (Array.isArray(params.modulate) && params.modulate.length >= 2) {
    [brightness, saturation, hue = 100] = params.modulate;
  } else {
    brightness = params.brightness  ?? 103;
    saturation = params.saturation  ?? 112;
    hue        = params.hue         ?? 100;
  }

  brightness = _clamp(Number(brightness) || 103, 50, 200);
  saturation = _clamp(Number(saturation) || 112, 50, 200);
  hue        = _clamp(Number(hue)        || 100, 50, 150);

  return `${brightness},${saturation},${hue}`;
}

/**
 * Resolve contrast-stretch string.
 * Accepts: string (passthrough), or params.contrastOffset + params.contrast
 * for the legacy brightness-contrast path.
 */
function _resolveContrastStretch(params) {
  if (typeof params.contrastStretch === 'string' && params.contrastStretch.trim()) {
    return params.contrastStretch.trim();
  }
  return '0.5%x0.5%';
}

/** Resolve sharpen sigma — fallback to 1.0 when absent or invalid. */
function _resolveSharpen(params) {
  const v = Number(params.sharpen ?? params.sharpness ?? 1.0);
  return isNaN(v) || v < 0 ? 1.0 : Math.min(v, 5.0);
}

// ── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Apply the full enhancement pipeline to an image.
 *
 * Pipeline (in order):
 *   1. auto-level         — stretch histogram per channel
 *   2. contrast-stretch   — clip extreme shadows/highlights
 *   3. modulate           — brightness / saturation / hue
 *   4. sharpen            — unsharp-mask style Gaussian sharpen
 *
 * @param {string} inputPath   path to preprocessed source image
 * @param {string} outputPath  destination path
 * @param {object} params      preset params (flat or modulate-array shape)
 * @throws {Error} if ImageMagick exits with a non-zero code
 */
function enhance(inputPath, outputPath, params = {}) {
  const bin            = _resolveBin();
  const modulate       = _resolveModulate(params);
  const contrastStretch = _resolveContrastStretch(params);
  const sharpen        = _resolveSharpen(params);
  const quality        = Number(config.image?.quality) || 90;

  const args = [
    inputPath,
    '-auto-level',
    '-contrast-stretch', contrastStretch,
    '-modulate',         modulate,
    '-sharpen',          `0x${sharpen}`,
    '-quality',          String(quality),
    outputPath,
  ];

  execFileSync(bin, args, { stdio: 'pipe' });
}

// ── Social resize ────────────────────────────────────────────────────────────

/**
 * Crop-resize to exact pixel dimensions (cover fill, centre crop).
 * Used by exportAgent for portrait / square social formats.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} width
 * @param {number} height
 */
function resize(inputPath, outputPath, width, height) {
  const bin     = _resolveBin();
  const quality = Number(config.image?.quality) || 90;

  execFileSync(bin, [
    inputPath,
    '-resize', `${width}x${height}^`,
    '-gravity', 'Center',
    '-extent',  `${width}x${height}`,
    '-quality', String(quality),
    outputPath,
  ], { stdio: 'pipe' });
}

module.exports = { enhance, resize };
