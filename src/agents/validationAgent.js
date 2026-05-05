'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

// ── ImageMagick binary ────────────────────────────────────────────────────────

let _imBin = null;
function _resolveBin() {
  if (_imBin) return _imBin;
  for (const b of ['magick', 'convert']) {
    try { execSync(`${b} --version`, { stdio: 'pipe' }); _imBin = b; return b; }
    catch {}
  }
  throw new Error('ImageMagick not found');
}

function _im(args) {
  try { return execFileSync(_resolveBin(), args, { stdio: 'pipe' }).toString().trim(); }
  catch { return null; }
}

// ── Thresholds ────────────────────────────────────────────────────────────────

const T = {
  minBytes:      50 * 1024,  // 50 KB
  minPx:         500,        // minimum width AND height
  minBrightness: 0.04,       // below = too dark / black image
  maxBrightness: 0.96,       // above = too bright / white image
  minStdDev:     0.02,       // below = flat/empty image
};

// ── Public: validate ──────────────────────────────────────────────────────────

/**
 * Analyse an image file and return a validation result.
 * All checks are fast (file stat + 3 ImageMagick queries).
 *
 * @param {string} filePath
 * @returns {{ valid: boolean, reason: string|null, detail: string|null }}
 */
function validate(filePath) {
  // 1. File size
  try {
    const { size } = fs.statSync(filePath);
    if (size < T.minBytes) {
      return { valid: false, reason: 'too_small', detail: `${Math.round(size / 1024)} KB < 50 KB` };
    }
  } catch (e) {
    return { valid: false, reason: 'unreadable', detail: String(e.message) };
  }

  // 2. Resolution
  const geo = _im([filePath, '-format', '%wx%h', 'info:']);
  if (geo) {
    const [w, h] = geo.split('x').map(Number);
    if (!isNaN(w) && !isNaN(h) && (w < T.minPx || h < T.minPx)) {
      return { valid: false, reason: 'low_resolution', detail: `${w}×${h} px` };
    }
  }

  // 3. Brightness mean
  const meanRaw = _im([filePath, '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:']);
  const mean    = parseFloat(meanRaw);
  if (!isNaN(mean)) {
    if (mean < T.minBrightness) return { valid: false, reason: 'too_dark',   detail: `mean=${(mean * 100).toFixed(1)}%` };
    if (mean > T.maxBrightness) return { valid: false, reason: 'too_bright', detail: `mean=${(mean * 100).toFixed(1)}%` };
  }

  // 4. Standard deviation (variance proxy)
  const stdRaw = _im([filePath, '-colorspace', 'Gray', '-format', '%[fx:standard_deviation]', 'info:']);
  const std    = parseFloat(stdRaw);
  if (!isNaN(std) && std < T.minStdDev) {
    return { valid: false, reason: 'empty_image', detail: `stddev=${std.toFixed(3)}` };
  }

  return { valid: true, reason: null, detail: null };
}

module.exports = { validate, THRESHOLDS: T };
