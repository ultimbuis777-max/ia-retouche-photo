'use strict';

const fs     = require('fs');
const path   = require('path');
const { execFileSync, execSync } = require('child_process');

const config = require('../config');

// ── ImageMagick binary detection ─────────────────────────────────────────────

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

// ── Format definitions ───────────────────────────────────────────────────────

const FORMATS = {
  portrait: { ratio: '4:5', width: 1080, height: 1350, dir: () => config.paths.portrait },
  square:   { ratio: '1:1', width: 1080, height: 1080, dir: () => config.paths.square   },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _stem(outputName) {
  const base = path.basename(outputName);
  return base.replace(/\.[^.]+$/, '');
}

// ── Core crop-resize ─────────────────────────────────────────────────────────

/**
 * Crop the image to the target aspect ratio (gravity centre), then resize to
 * the exact output dimensions.
 *
 * Pipeline:
 *   1. -gravity center -crop <ratio>  — smart centre crop
 *   2. -resize <WxH>^               — cover-fill to exact size
 *   3. -gravity center -extent <WxH> — ensure exact canvas
 *   4. -quality <q>                  — JPEG quality from config
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} ratio    e.g. '4:5'
 * @param {number} width    output width  in px
 * @param {number} height   output height in px
 */
function _cropResize(inputPath, outputPath, ratio, width, height) {
  const bin     = _resolveBin();
  const quality = Number(config.image?.quality) || 90;

  execFileSync(bin, [
    inputPath,
    '-gravity',  'Center',
    '-crop',     ratio,
    '+repage',
    '-resize',   `${width}x${height}^`,
    '-gravity',  'Center',
    '-extent',   `${width}x${height}`,
    '-quality',  String(quality),
    outputPath,
  ], { stdio: 'pipe' });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Export an enhanced image to Instagram social formats:
 *   - portrait 1080×1350 (4:5)  → /exports/portrait/
 *   - square   1080×1080 (1:1)  → /exports/square/
 *
 * Each format is generated independently so a failure in one does not block
 * the other. Returns null for any format that could not be generated.
 *
 * @param {string} inputPath   path to the enhanced (or retouched) image
 * @param {string} outputName  base filename for the outputs (e.g. "photo.jpg")
 * @returns {{ portrait: string|null, square: string|null }}
 */
function exportSocial(inputPath, outputName) {
  const stem    = _stem(outputName);
  const results = {};

  for (const [key, fmt] of Object.entries(FORMATS)) {
    const dir      = fmt.dir();
    const outPath  = path.join(dir, `${stem}.jpg`);
    results[key]   = null;

    try {
      _ensureDir(dir);
      _cropResize(inputPath, outPath, fmt.ratio, fmt.width, fmt.height);
      results[key] = outPath;
    } catch {}
  }

  return results;
}

/**
 * Export a single named format.
 * Useful for on-demand re-export from the API.
 *
 * @param {string} inputPath
 * @param {string} outputName
 * @param {'portrait'|'square'} formatKey
 * @returns {string} output path
 * @throws {Error} if the format key is unknown or ImageMagick fails
 */
function exportFormat(inputPath, outputName, formatKey) {
  const fmt = FORMATS[formatKey];
  if (!fmt) throw new Error(`Unknown export format: "${formatKey}"`);

  const dir     = fmt.dir();
  const outPath = path.join(dir, `${_stem(outputName)}.jpg`);

  _ensureDir(dir);
  _cropResize(inputPath, outPath, fmt.ratio, fmt.width, fmt.height);

  return outPath;
}

module.exports = { exportSocial, exportFormat };
