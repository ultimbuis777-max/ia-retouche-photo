'use strict';

const path = require('path');
const config = require('../config');

// ── Constants ────────────────────────────────────────────────────────────────

const SESSION_MS = config.batch.sessionWindowMs || 600_000;

/**
 * Weighted pull strengths toward session average.
 * Higher weight = stronger homogenisation for that dimension.
 */
const WEIGHTS = {
  brightness:  0.50,  // 50% pull toward avg
  contrast:    0.60,  // 60% pull toward avg
  saturation:  0.65,  // 65% pull toward avg — stronger for batch homogeneity
};

/** Multipliers: convert normalised [0-1] delta → ImageMagick parameter units */
const MULTIPLIERS = {
  brightness:  35,
  contrast:    25,
  saturation:  22,
};

/** Output clamp ranges for ImageMagick parameters */
const CLAMPS = {
  brightness:  { min: 80,  max: 140 },
  contrast:    { min: 3,   max: 22  },
  saturation:  { min: 85,  max: 150 },
};

/** Minimum images in session before adjustments are applied */
const MIN_SESSION_SIZE = 2;

// ── In-memory session store ──────────────────────────────────────────────────
// Map<sessionId, { analyses: Array<{brightness, contrast, saturation, temperature}>, avg: object|null }>

const sessions = new Map();

// ── Session key ──────────────────────────────────────────────────────────────

/**
 * Build a deterministic session key from:
 *   - immediate parent folder name (images from different folders never share a session)
 *   - time bucket derived from wall-clock time (not file mtime) so that all images
 *     processed within the same SESSION_MS window land in the same session.
 *
 * Using wall-clock time instead of file mtime means the key is stable even when
 * mtime is unavailable or unreliable (e.g. network drives, copy-paste artefacts).
 */
function getSessionId(filePath) {
  const folder = path.basename(path.dirname(path.resolve(filePath)));
  const bucket = Math.floor(Date.now() / SESSION_MS);
  return `${folder}::${bucket}`;
}

/**
 * Session key for the "current" global window (folder-agnostic).
 * Used by callers that do not have a specific file path (e.g. API stats endpoint).
 */
function getCurrentSessionId() {
  return `__global__::${Math.floor(Date.now() / SESSION_MS)}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _ensureSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { analyses: [], avg: null });
  }
  return sessions.get(sessionId);
}

function _recomputeAvg(session) {
  const n = session.analyses.length;
  if (n === 0) { session.avg = null; return; }
  const sum = session.analyses.reduce(
    (acc, a) => ({
      brightness:  acc.brightness  + a.brightness,
      contrast:    acc.contrast    + a.contrast,
      saturation:  acc.saturation  + a.saturation,
      temperature: acc.temperature + a.temperature,
    }),
    { brightness: 0, contrast: 0, saturation: 0, temperature: 0 }
  );
  session.avg = {
    brightness:  sum.brightness  / n,
    contrast:    sum.contrast    / n,
    saturation:  sum.saturation  / n,
    temperature: sum.temperature / n,
  };
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Record an image's analysis into its session.
 * Must be called AFTER getAdjustment so that the current image does not
 * pull its own adjustment.
 *
 * @param {string} sessionId
 * @param {{ brightness: number, contrast: number, saturation: number, temperature: number }} analysis
 */
function record(sessionId, analysis) {
  const session = _ensureSession(sessionId);
  session.analyses.push({
    brightness:  Number(analysis.brightness)  || 0,
    contrast:    Number(analysis.contrast)    || 0,
    saturation:  Number(analysis.saturation)  || 0,
    temperature: Number(analysis.temperature) || 0,
  });
  _recomputeAvg(session);
}

/**
 * Compute adjusted ImageMagick parameters that nudge this image toward the
 * weighted blended target for the session.
 *
 * Target formula for each dimension d:
 *   target_d = avg_d * WEIGHTS[d] + current_d * (1 - WEIGHTS[d])
 *
 * The delta (target - current) is then scaled by MULTIPLIERS[d] and added
 * to the corresponding base parameter.
 *
 * Returns baseParams unchanged when:
 *   - the session has fewer than MIN_SESSION_SIZE images (no reliable average yet), or
 *   - the session does not exist.
 *
 * @param {string} sessionId
 * @param {{ brightness: number, contrast: number, saturation: number }} analysis
 * @param {object} baseParams  ImageMagick parameter object from presetAgent
 * @returns {object}           Adjusted parameter object (shallow copy of baseParams)
 */
function getAdjustment(sessionId, analysis, baseParams) {
  const session = sessions.get(sessionId);
  if (!session || !session.avg || session.analyses.length < MIN_SESSION_SIZE) {
    return baseParams;
  }

  const avg = session.avg;
  const p   = { ...baseParams };

  // ── Brightness ─────────────────────────────────────────────────────────────
  const brightTarget = avg.brightness * WEIGHTS.brightness
                     + analysis.brightness * (1 - WEIGHTS.brightness);
  const brightDelta  = brightTarget - analysis.brightness;
  p.brightness = _clamp(
    Math.round((p.brightness || 100) + brightDelta * MULTIPLIERS.brightness),
    CLAMPS.brightness.min,
    CLAMPS.brightness.max
  );

  // ── Contrast ───────────────────────────────────────────────────────────────
  const contrastTarget = avg.contrast * WEIGHTS.contrast
                       + analysis.contrast * (1 - WEIGHTS.contrast);
  const contrastDelta  = contrastTarget - analysis.contrast;
  p.contrast = _clamp(
    Math.round((p.contrast || 10) + contrastDelta * MULTIPLIERS.contrast),
    CLAMPS.contrast.min,
    CLAMPS.contrast.max
  );

  // ── Saturation nudge (stronger pull for batch homogeneity) ─────────────────
  const satTarget = avg.saturation * WEIGHTS.saturation
                  + analysis.saturation * (1 - WEIGHTS.saturation);
  const satDelta  = satTarget - analysis.saturation;
  p.saturation = _clamp(
    Math.round((p.saturation || 112) + satDelta * MULTIPLIERS.saturation),
    CLAMPS.saturation.min,
    CLAMPS.saturation.max
  );

  return p;
}

/**
 * Return diagnostic statistics for a session (used by the API dashboard).
 *
 * Consistency is derived from a combined weighted standard deviation across
 * brightness, contrast and saturation so it reflects overall batch uniformity.
 *
 * @param {string} sessionId
 * @returns {{ count: number, avg: object|null, consistency: string|null }}
 */
function getSessionStats(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { count: 0, avg: null, consistency: null };

  const n   = session.analyses.length;
  const avg = session.avg;
  if (n < 2 || !avg) return { count: n, avg, consistency: null };

  // Combined weighted variance across the three perceptual dimensions
  const variance = session.analyses.reduce((acc, a) => {
    const db = a.brightness  - avg.brightness;
    const dc = a.contrast    - avg.contrast;
    const ds = a.saturation  - avg.saturation;
    return acc
      + WEIGHTS.brightness * db * db
      + WEIGHTS.contrast   * dc * dc
      + WEIGHTS.saturation * ds * ds;
  }, 0) / n;

  const std = Math.sqrt(variance);
  let consistency;
  if      (std < 0.05) consistency = 'Homogène';
  else if (std < 0.12) consistency = 'Modérée';
  else                 consistency = 'Variable';

  return { count: n, avg, consistency };
}

module.exports = {
  record,
  getAdjustment,
  getSessionId,
  getCurrentSessionId,
  getSessionStats,
};
