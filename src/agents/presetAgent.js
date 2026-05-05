'use strict';

const fs           = require('fs');
const path         = require('path');
const config       = require('../config');
const learningAgent = require('./learningAgent');

// ── Name-based detection rules (ordered by specificity) ─────────────────────

const NAME_RULES = [
  {
    preset: 'food',
    keys: [
      'food', 'pizza', 'burger', 'dish', 'plat', 'meal', 'repas',
      'brunch', 'resto', 'restaurant', 'cafe', 'sushi', 'pasta',
      'dessert', 'cocktail', 'drink', 'snack',
    ],
  },
  {
    preset: 'immobilier',
    keys: [
      'salon', 'chambre', 'cuisine', 'bathroom', 'room', 'house',
      'immo', 'flat', 'interior', 'piece', 'sejour', 'living',
    ],
  },
  {
    preset: 'ecom',
    keys: [
      'product', 'item', 'shop', 'store', 'pack', 'article',
      'catalog', 'produit', 'ecom',
    ],
  },
  {
    preset: 'social',
    keys: [
      'insta', 'social', 'post', 'story', 'reel', 'lifestyle',
      'portrait', 'selfie', 'photo',
    ],
  },
];

// ── Dynamic adaptation thresholds (analysis values are normalised 0-1) ───────

/** brightness is the ImageMagick modulate value (80-140), not the 0-1 metric */
const ADAPT = {
  brightness: {
    veryDark:    { threshold: 0.28, boost: +18, offsetDelta: -2 },
    dark:        { threshold: 0.40, boost: +9                    },
    slightBright:{ threshold: 0.62, boost: -5                    },
    overExposed: { threshold: 0.72, boost: -12, offsetDelta: -2  },
  },
  contrast: {
    flat:     { threshold: 0.07, boost: +6 },
    low:      { threshold: 0.10, boost: +3 },
    veryHigh: { threshold: 0.32, boost: -4 },
  },
  saturation: {
    low:  { threshold: 0.35, boost: +12 },
    high: { threshold: 0.70, boost: -8  },
  },
};

const CLAMPS = {
  brightness:     { min: 80,  max: 140 },
  contrast:       { min: 3,   max: 22  },
  saturation:     { min: 85,  max: 150 },
  contrastOffset: { min: 0,   max: 10  },
};

// ── Preset definitions (built-in fallback when presets.json is missing) ──────

const BUILTIN_PRESETS = {
  food: {
    name: 'Food / Gastronomie',
    params: {
      brightness:     104,
      saturation:     125,
      hue:            103,
      contrast:       11,
      contrastOffset: 3,
      sharpness:      0.7,
      contrastStretch:'0.4%x0.4%',
    },
  },
  social: {
    name: 'Social / Lifestyle',
    params: {
      brightness:     105,
      saturation:     128,
      hue:            100,
      contrast:       12,
      contrastOffset: 3,
      sharpness:      0.6,
      contrastStretch:'0.5%x0.5%',
    },
  },
  ecom: {
    name: 'E-commerce',
    params: {
      brightness:     102,
      saturation:     108,
      hue:            100,
      contrast:       8,
      contrastOffset: 2,
      sharpness:      0.8,
      contrastStretch:'0.3%x0.3%',
    },
  },
  restaurant: {
    name: 'Restaurant / Food',
    params: {
      brightness:     104,
      saturation:     122,
      hue:            103,
      contrast:       10,
      contrastOffset: 3,
      sharpness:      0.7,
      contrastStretch:'0.4%x0.4%',
    },
  },
  immobilier: {
    name: 'Immobilier',
    params: {
      brightness:     110,
      saturation:     112,
      hue:            100,
      contrast:       10,
      contrastOffset: 5,
      sharpness:      0.5,
      contrastStretch:'0.5%x0.5%',
    },
  },
  default: {
    name: 'Défaut',
    params: {
      brightness:     103,
      saturation:     112,
      hue:            100,
      contrast:       10,
      contrastOffset: 3,
      sharpness:      0.5,
      contrastStretch:'0.5%x0.5%',
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Public: loadPresets ──────────────────────────────────────────────────────

/**
 * Load presets from disk, merged with built-in definitions.
 * Built-in presets act as defaults; disk values override on a per-key basis.
 * @returns {object} preset map
 */
function loadPresets() {
  let fromDisk = {};
  try { fromDisk = JSON.parse(fs.readFileSync(config.data.presets, 'utf8')); } catch {}
  return { ...BUILTIN_PRESETS, ...fromDisk };
}

// ── Public: detectByName ─────────────────────────────────────────────────────

/**
 * Infer preset key from file basename (case-insensitive substring match).
 * Returns 'default' when no rule matches.
 * @param {string} filePath
 * @returns {string} preset key
 */
function detectByName(filePath) {
  const name = path.basename(filePath).toLowerCase();
  for (const { preset, keys } of NAME_RULES) {
    if (keys.some(k => name.includes(k))) return preset;
  }
  return 'default';
}

// ── Public: adapt ────────────────────────────────────────────────────────────

/**
 * Dynamically adapt preset params based on image analysis metrics.
 *
 * Analysis values are normalised [0-1] from analysisAgent:
 *   brightness  — mean luminance     (ideal ~0.50)
 *   contrast    — luminance std-dev  (flat ~0.05, rich ~0.15-0.25)
 *   saturation  — HSL S-channel mean (ideal ~0.45-0.65)
 *   temperature — R-mean minus B-mean (warm > 0, cool < 0)
 *
 * Output params are ImageMagick modulate/contrast values.
 *
 * @param {object} baseParams  params from a preset definition
 * @param {{ brightness: number, contrast: number, saturation: number, temperature: number }} analysis
 * @returns {object} adapted params (shallow copy — original is untouched)
 */
function adapt(baseParams, analysis) {
  const p  = { ...baseParams };
  const br = analysis.brightness;
  const co = analysis.contrast;
  const sa = analysis.saturation;

  // ── Brightness adaptation ─────────────────────────────────────────────────
  if (br < ADAPT.brightness.veryDark.threshold) {
    p.brightness     = _clamp(p.brightness + ADAPT.brightness.veryDark.boost, CLAMPS.brightness.min, CLAMPS.brightness.max);
    p.contrastOffset = _clamp((p.contrastOffset || 3) + ADAPT.brightness.veryDark.offsetDelta, CLAMPS.contrastOffset.min, CLAMPS.contrastOffset.max);
  } else if (br < ADAPT.brightness.dark.threshold) {
    p.brightness = _clamp(p.brightness + ADAPT.brightness.dark.boost, CLAMPS.brightness.min, CLAMPS.brightness.max);
  } else if (br > ADAPT.brightness.overExposed.threshold) {
    p.brightness     = _clamp(p.brightness + ADAPT.brightness.overExposed.boost, CLAMPS.brightness.min, CLAMPS.brightness.max);
    p.contrastOffset = _clamp((p.contrastOffset || 3) + ADAPT.brightness.overExposed.offsetDelta, CLAMPS.contrastOffset.min, CLAMPS.contrastOffset.max);
  } else if (br > ADAPT.brightness.slightBright.threshold) {
    p.brightness = _clamp(p.brightness + ADAPT.brightness.slightBright.boost, CLAMPS.brightness.min, CLAMPS.brightness.max);
  }

  // ── Contrast adaptation ───────────────────────────────────────────────────
  if (co < ADAPT.contrast.flat.threshold) {
    p.contrast = _clamp((p.contrast || 10) + ADAPT.contrast.flat.boost, CLAMPS.contrast.min, CLAMPS.contrast.max);
  } else if (co < ADAPT.contrast.low.threshold) {
    p.contrast = _clamp((p.contrast || 10) + ADAPT.contrast.low.boost, CLAMPS.contrast.min, CLAMPS.contrast.max);
  } else if (co > ADAPT.contrast.veryHigh.threshold) {
    p.contrast = _clamp((p.contrast || 10) + ADAPT.contrast.veryHigh.boost, CLAMPS.contrast.min, CLAMPS.contrast.max);
  }

  // ── Saturation adaptation ─────────────────────────────────────────────────
  if (sa < ADAPT.saturation.low.threshold) {
    p.saturation = _clamp((p.saturation || 112) + ADAPT.saturation.low.boost, CLAMPS.saturation.min, CLAMPS.saturation.max);
  } else if (sa > ADAPT.saturation.high.threshold) {
    p.saturation = _clamp((p.saturation || 112) + ADAPT.saturation.high.boost, CLAMPS.saturation.min, CLAMPS.saturation.max);
  }

  // ── Temperature nudge for food/restaurant presets ─────────────────────────
  // Cool-toned food shots look unappetising — nudge hue slightly warmer
  if (analysis.temperature < -0.05 && (p.hue === 103 || p.hue === 102)) {
    p.hue = 102;
  }

  return p;
}

/**
 * Apply content-type tuning on top of already-adapted params.
 *
 * Tuning table:
 *   food     → saturation +8, sharpness +0.15, hue warm nudge
 *   portrait → contrast -2, saturation -5, sharpness -0.15 (softer skin)
 *   interior → brightness +4, contrast +2, saturation -4 (clean, neutral)
 *   product  → sharpness +0.2, saturation -3 (faithful colour, crisp edges)
 *   general  → no change
 *
 * @param {object} params      already-adapted params (mutated in place via copy)
 * @param {string} contentType from contentDetectionAgent.detect()
 * @returns {object}
 */
function applyContentTuning(params, contentType) {
  const p = { ...params };

  switch (contentType) {

    case 'food': {
      // Progressive saturation: smaller boost when already high (avoid over-saturation)
      const curSat  = p.saturation || 112;
      const satBoost = curSat > 132 ? 4 : curSat > 122 ? 7 : 12;
      p.saturation = _clamp(curSat + satBoost, CLAMPS.saturation.min, CLAMPS.saturation.max);
      // Sharpness: slight crisp for food texture
      p.sharpness  = Math.min((p.sharpness || 0.5) + 0.12, 1.8);
      // Warmth nudge — only if not already warm
      if (!p.hue || p.hue <= 101) p.hue = 102;
      // Slight contrast lift to make colours pop without crushing shadows
      p.contrastOffset = _clamp((p.contrastOffset || 3) + 1, CLAMPS.contrastOffset.min, CLAMPS.contrastOffset.max);
      break;
    }

    case 'portrait': {
      // Gentle contrast softening — preserve face modelling, don't flatten
      p.contrast   = _clamp((p.contrast || 10) - 1, CLAMPS.contrast.min, CLAMPS.contrast.max);
      // Skin-tone protection: don't reduce saturation below 95 (keeps healthy complexion)
      const minSkin = 95;
      p.saturation = Math.max(_clamp((p.saturation || 112) - 4, CLAMPS.saturation.min, CLAMPS.saturation.max), minSkin);
      // Softer sharpness — reduce harshness on skin texture
      p.sharpness  = Math.max((p.sharpness || 0.5) - 0.10, 0.15);
      // Keep hue neutral (skin tones are temperature-sensitive)
      if (p.hue && p.hue !== 100) p.hue = Math.round(p.hue * 0.5 + 100 * 0.5);
      break;
    }

    case 'interior': {
      // Moderate brightness boost — avoid over-exposing bright rooms
      const curBr = p.brightness || 103;
      p.brightness = _clamp(curBr + (curBr > 115 ? 2 : 4), CLAMPS.brightness.min, CLAMPS.brightness.max);
      // Contrast lift for room depth and architectural clarity
      p.contrast      = _clamp((p.contrast || 10) + 2, CLAMPS.contrast.min, CLAMPS.contrast.max);
      // Micro clarity boost via contrastOffset (avoids noise from main contrast)
      p.contrastOffset = _clamp((p.contrastOffset || 3) + 1, CLAMPS.contrastOffset.min, CLAMPS.contrastOffset.max);
      // Slight desaturation for neutral, clean look
      p.saturation = _clamp((p.saturation || 112) - 4, CLAMPS.saturation.min, CLAMPS.saturation.max);
      break;
    }

    case 'product':
      // Crisp edges, faithful colour
      p.sharpness  = Math.min((p.sharpness  || 0.5) + 0.2, 2.0);
      p.saturation = _clamp((p.saturation || 112) - 3, CLAMPS.saturation.min, CLAMPS.saturation.max);
      break;

    // 'general' → clean neutral, no adjustment
  }

  return p;
}

// ── Public: select ───────────────────────────────────────────────────────────

/**
 * Select and adapt a preset for the given image.
 *
 * Resolution order:
 *   1. Learned preset from learningAgent  (if clientId provided + ≥10 qualifying images)
 *   2. config.preset if explicitly set (not 'auto')
 *   3. Name-based detection from file basename
 *   4. 'default' fallback
 *
 * After resolving the base preset, dynamic adaptation and content-type tuning
 * are always applied on top (including over the learned params).
 *
 * @param {string} filePath       original file path
 * @param {object} analysis       metrics from analysisAgent
 * @param {string} [contentType]  type from contentDetectionAgent
 * @param {string} [clientId]     client identifier for learned override
 * @returns {{ key: string, name: string, params: object, learned: boolean }}
 */
function select(filePath, analysis, contentType, clientId) {
  const presets = loadPresets();
  let baseParams;
  let presetKey;
  let presetName;
  let learned = false;

  // 0. presetCustom — explicit custom preset saved directly on the client record
  if (clientId) {
    try {
      const clientsPath = path.resolve(__dirname, '..', '..', 'data', 'clients.json');
      const clients     = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
      const client      = clients.find(c => c.id === clientId);
      if (client && client.presetCustom) {
        const adapted = adapt({ ...client.presetCustom }, analysis);
        const tuned   = contentType ? applyContentTuning(adapted, contentType) : adapted;
        return { key: 'custom', name: 'Preset personnalisé', params: tuned, learned: false, custom: true };
      }
    } catch {}
  }

  // 1. Learned override — use weighted-average params from high-scoring history
  const learnedParams = clientId ? learningAgent.getLearnedPreset(clientId) : null;
  if (learnedParams) {
    baseParams = learnedParams;
    presetKey  = 'learned';
    presetName = 'Appris (client)';
    learned    = true;
  } else {
    // 2-3. Standard resolution
    presetKey = (config.preset && config.preset !== 'auto')
      ? config.preset
      : detectByName(filePath);

    const preset = presets[presetKey] || presets['default'] || { name: 'Défaut', params: {} };
    baseParams   = preset.params;
    presetName   = preset.name || presetKey;
  }

  const adapted = adapt({ ...baseParams }, analysis);
  const tuned   = contentType ? applyContentTuning(adapted, contentType) : adapted;

  return {
    key:     presetKey,
    name:    presetName,
    params:  tuned,
    learned,
  };
}

module.exports = { select, loadPresets, detectByName, adapt, applyContentTuning };
