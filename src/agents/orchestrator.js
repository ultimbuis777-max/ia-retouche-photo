'use strict';

/**
 * AgentOrchestrator
 * -----------------
 * Pipeline:
 *   input → AnalysisAgent → PresetAgent → ConsistencyAgent
 *        → EnhanceAgent → ScoringAgent → ExportAgent → NamingAgent → output
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const config           = require('../config');
const logger           = require('../logger');
const upscaleService   = require('../upscaleService');
const batchService     = require('../batchService');
const hashService      = require('../hashService');

const analysisAgent         = require('./analysisAgent');
const presetAgent           = require('./presetAgent');
const contentDetectionAgent = require('./contentDetectionAgent');
const contentVisionAgent    = require('./contentVisionAgent');
const consistencyAgent      = require('./consistencyAgent');
const learningAgent         = require('./learningAgent');
const validationAgent       = require('./validationAgent');
const enhanceAgent     = require('./enhanceAgent');
const scoringAgent     = require('./scoringAgent');
const namingAgent      = require('./namingAgent');
const exportAgent      = require('./exportAgent');
const advancedRoutingAgent = require('./advancedRoutingAgent');

// Lazy-require to avoid circular deps
function imageService() { return require('../imageService'); }

function tmpPath(label, name) {
  const safe = path.basename(name).replace(/[^a-zA-Z0-9.]/g, '_');
  return path.join(os.tmpdir(), `${label}_${Date.now()}_${safe}.jpg`);
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f) fs.unlinkSync(f); } catch {}
  }
}

function markDone(filePath) {
  const dir  = path.dirname(filePath);
  const ext  = path.extname(filePath);
  const base = path.basename(filePath, ext);
  try { fs.renameSync(filePath, path.join(dir, `${base}_FAIT${ext}`)); } catch {}
}

function saveAdvancedSuggestion(sourcePath, outName, payload) {
  try {
    if (!fs.existsSync(config.paths.advanced)) fs.mkdirSync(config.paths.advanced, { recursive: true });
    if (!fs.existsSync(config.paths.data)) fs.mkdirSync(config.paths.data, { recursive: true });

    fs.copyFileSync(sourcePath, path.join(config.paths.advanced, outName));

    let advanced = {};
    try { advanced = JSON.parse(fs.readFileSync(config.data.advanced, 'utf8')); } catch {}
    const previous = advanced[outName] || {};
    advanced[outName] = {
      ...previous,
      ...payload,
      output: outName,
      status: previous.status || 'suggested',
      ts: previous.ts || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(config.data.advanced, JSON.stringify(advanced, null, 2), 'utf8');
  } catch (err) {
    logger.info('Advanced retouch suggestion skipped', {
      status: 'warning',
      type:   'ADVANCED_RETOUCH_WARNING',
      file:   outName,
      error:  String(err),
    });
  }
}

function createTimer() {
  const start = Date.now();
  const marks = {};
  return {
    mark(step) { marks[step] = Date.now(); },
    duration(step) { return marks[step] ? Date.now() - marks[step] : 0; },
    total() { return Date.now() - start; },
  };
}

function logPerf(file, step, durationMs, extra = {}) {
  logger.info(`Durée ${step}: ${durationMs}ms`, {
    type: 'PERF_STEP',
    file,
    step,
    durationMs,
    ...extra,
  });
}

// ── Fallback processor (called once on failure) ─────────────────────────────

function hasSource(filePath, fileName, step) {
  if (filePath && fs.existsSync(filePath)) return true;
  logger.info('SOURCE_MISSING_SKIP', {
    status: 'skipped',
    type: 'SOURCE_MISSING_SKIP',
    file: fileName,
    step,
  });
  return false;
}

function skippedMissingSource(fileName, timer, step) {
  logPerf(fileName, 'total', timer.total(), { reason: 'skipped_missing_source', step });
  return {
    success: false,
    skipped: true,
    status: 'skipped_missing_source',
    reason: 'missing_source',
    step,
  };
}

async function processRetry(filePath, fileName) {
  const pre = tmpPath('r_pre', fileName);
  const enh = tmpPath('r_enh', fileName);
  try {
    if (!hasSource(filePath, fileName, 'retry_preprocess')) {
      return { success: false, skipped: true, status: 'skipped_missing_source', reason: 'missing_source', step: 'retry_preprocess' };
    }
    if (!hasSource(filePath, fileName, 'preprocess')) {
      return skippedMissingSource(fileName, timer, 'preprocess');
    }
    imageService().preprocess(filePath, pre);
    const presets   = presetAgent.loadPresets();
    const params    = (presets['default'] || { params: {} }).params;
    if (!hasSource(pre, fileName, 'retry_enhance')) {
      return { success: false, skipped: true, status: 'skipped_missing_source', reason: 'missing_source', step: 'retry_enhance' };
    }
    enhanceAgent.enhance(pre, enh, params);
    if (!hasSource(enh, fileName, 'retry_save')) {
      return { success: false, skipped: true, status: 'skipped_missing_source', reason: 'missing_source', step: 'retry_save' };
    }
    const retouchedPath = namingAgent.generate(filePath, config.paths.retouched);
    fs.copyFileSync(enh, retouchedPath);
    const outName   = path.basename(retouchedPath);
    const scoreData = { total: 50, sharpness: 50, brightness: 50, contrast: 50 };
    scoringAgent.saveScore(outName, scoreData);
    batchService.saveHistory({
      original: fileName, output: outName,
      score: 50, preset: 'default', presetName: 'Défaut (fallback)',
      selected: false, retry: true,
    });
    hashService.markProcessed(filePath);
    markDone(filePath);
    cleanup(pre, enh);
    return { success: true, score: 50, output: retouchedPath, preset: 'default', retry: true };
  } catch (err) {
    cleanup(pre, enh);
    throw err;
  }
}

// ── Main pipeline ────────────────────────────────────────────────────────────

async function process(filePath) {
  const fileName = path.basename(filePath);
  logger.processing(fileName);
  const timer = createTimer();

  const pre = tmpPath('pre', fileName);
  const enh = tmpPath('enh', fileName);
  const up  = tmpPath('up',  fileName);

  try {
    if (!hasSource(filePath, fileName, 'validation')) {
      return skippedMissingSource(fileName, timer, 'validation');
    }

    // 0. Validation — reject obviously bad images before heavy processing
    const validation = validationAgent.validate(filePath);
    if (!validation.valid) {
      const reviewDir  = config.paths.review;
      const reviewJson = config.data.review;
      try {
        if (!fs.existsSync(reviewDir)) fs.mkdirSync(reviewDir, { recursive: true });
        fs.copyFileSync(filePath, path.join(reviewDir, fileName));
        let reviewData = {};
        try { reviewData = JSON.parse(fs.readFileSync(reviewJson, 'utf8')); } catch {}
        reviewData[fileName] = { reason: validation.reason, detail: validation.detail, ts: new Date().toISOString() };
        fs.writeFileSync(reviewJson, JSON.stringify(reviewData, null, 2), 'utf8');
      } catch {}
      markDone(filePath);
      logger.review(fileName, validation.reason, validation.detail);
      return { success: false, reason: validation.reason, review: true };
    }

    // 1. Preprocess — resize to maxSize, normalise format
    imageService().preprocess(filePath, pre);

    // 2. Analysis — measure image characteristics
    if (!hasSource(pre, fileName, 'analyse')) {
      return skippedMissingSource(fileName, timer, 'analyse');
    }
    timer.mark('analyse');
    let analysis = { brightness: 0.5, contrast: 0.15, saturation: 0.5, temperature: 0, sharpness: 50 };
    try { analysis = analysisAgent.analyze(pre); } catch {}
    logPerf(fileName, 'analyse', timer.duration('analyse'));

    // 3. Content detection — visual heuristics + EMA smoothing + confidence labelling
    //    Falls back to name-based keywords if vision confidence is low, then 'general'
    let visionResult = { type: 'general', confidence: 'low', confidenceScore: 0.3, source: 'fallback' };
    try {
      if (hasSource(pre, fileName, 'content_detection')) {
        visionResult = contentVisionAgent.detectFull(pre, analysis, filePath);
      }
    } catch {
      try { visionResult.type = contentDetectionAgent.detect(filePath); } catch {}
    }
    const contentType       = visionResult.type;
    const contentConfidence = visionResult.confidence; // 'high' | 'medium' | 'low'

    // 3b. Client lookup — resolve clientId from upload mapping (for learned preset + recording)
    let clientId = null;
    let uploadBatchId = null;
    let uploadCreatedAt = null;
    try {
      const uploadsPath = path.resolve(__dirname, '..', '..', 'data', 'client-uploads.json');
      const uploads     = JSON.parse(fs.readFileSync(uploadsPath, 'utf8'));
      const uploadMeta = uploads[fileName] || null;
      if (uploadMeta && typeof uploadMeta === 'object') {
        clientId = uploadMeta.clientId || null;
        uploadBatchId = uploadMeta.batchId || null;
        uploadCreatedAt = uploadMeta.createdAt || null;
      } else {
        clientId = uploadMeta || null;
      }
    } catch {}

    // 4. Preset selection + dynamic adaptation + content-type tuning + learned override
    let presetResult = { key: 'default', name: 'Défaut', params: {}, learned: false };
    try { presetResult = presetAgent.select(filePath, analysis, contentType, clientId); } catch {}

    // 5. Consistency adjustment (pull image toward session average)
    const sessionId = consistencyAgent.getSessionId(filePath);
    let finalParams = presetResult.params;
    try { finalParams = consistencyAgent.getAdjustment(sessionId, analysis, presetResult.params); } catch {}

    // 6. Record this image in the session AFTER retrieving adjustment
    try { consistencyAgent.record(sessionId, analysis); } catch {}

    // 7. Enhance — apply full ImageMagick pipeline
    if (!hasSource(pre, fileName, 'enhance')) {
      return skippedMissingSource(fileName, timer, 'enhance');
    }
    timer.mark('enhance');
    enhanceAgent.enhance(pre, enh, finalParams);
    logPerf(fileName, 'enhance', timer.duration('enhance'));

    // 7. Upscale (optional, disabled by default)
    let finalTmp = enh;
    if (!hasSource(enh, fileName, 'upscale')) {
      return skippedMissingSource(fileName, timer, 'upscale');
    }
    if (upscaleService.upscale(enh, up)) finalTmp = up;

    // 8. Score — measure output quality
    if (!hasSource(finalTmp, fileName, 'score')) {
      return skippedMissingSource(fileName, timer, 'score');
    }
    timer.mark('score');
    let scoreData = { total: 50, sharpness: 50, brightness: 50, contrast: 50 };
    try { scoreData = scoringAgent.score(finalTmp); } catch {}
    logPerf(fileName, 'score', timer.duration('score'));

    // 8b. Low-quality filter — reject images below threshold
    if (scoreData.total < 45) {
      const lowQualityDir = path.join(config.paths.failed, 'low_quality');
      try {
        if (!fs.existsSync(lowQualityDir)) fs.mkdirSync(lowQualityDir, { recursive: true });
        fs.copyFileSync(filePath, path.join(lowQualityDir, fileName));
      } catch {}
      markDone(filePath);
      cleanup(pre, enh, up);
      logger.failed(fileName, new Error(`Score trop bas (${scoreData.total}/100) — image rejetée`));
      logPerf(fileName, 'total', timer.total(), { reason: 'low_quality' });
      return { success: false, score: scoreData.total, reason: 'low_quality' };
    }

    // 9. Name + save to /retouched
    const retouchedPath = namingAgent.generate(filePath, config.paths.retouched);
    fs.copyFileSync(finalTmp, retouchedPath);
    const outName = path.basename(retouchedPath);
    scoringAgent.saveScore(outName, scoreData);

    // 9b. Optional advanced retouch suggestion. Informative only; never blocks export.
    try {
      const advanced = advancedRoutingAgent.suggest({
        scoreData,
        analysis,
        contentType,
        contentConfidence,
      });
      if (advanced && advanced.shouldRoute) {
        saveAdvancedSuggestion(retouchedPath, outName, {
          original: fileName,
          score: scoreData.total,
          reason: advanced.reason,
          suggestedAction: advanced.suggestedAction,
          contentType,
          contentConfidence,
        });
        logger.info('ADVANCED_RETOUCH_SUGGESTED', {
          status: 'advanced',
          type:   'ADVANCED_RETOUCH_SUGGESTED',
          file:   outName,
          score:  scoreData.total,
          reason: advanced.reason,
        });
      }
    } catch (err) {
      logger.info('Advanced retouch routing failed', {
        status: 'warning',
        type:   'ADVANCED_RETOUCH_WARNING',
        file:   fileName,
        error:  String(err),
      });
    }

    // 10. Export social formats (portrait + square)
    if (!hasSource(finalTmp, fileName, 'export')) {
      return skippedMissingSource(fileName, timer, 'export');
    }
    timer.mark('export');
    let exports = { portrait: null, square: null };
    try { exports = exportAgent.exportSocial(finalTmp, outName); } catch {}
    logPerf(fileName, 'export', timer.duration('export'));

    // 11. Auto-select if score meets threshold
    let selected = false;
    if (scoreData.total >= config.scoring.threshold) {
      try { fs.copyFileSync(retouchedPath, path.join(config.paths.selected, outName)); selected = true; } catch {}
    }

    // 12. Learning — record params + score for this client
    try { learningAgent.record(clientId, finalParams, scoreData.total); } catch {}

    // 13. Batch tracking + history
    batchService.addToBatch(retouchedPath, scoreData);
    batchService.saveHistory({
      original:    fileName,
      output:      outName,
      score:             scoreData.total,
      preset:            presetResult.key,
      presetName:        presetResult.name,
      learned:           presetResult.learned || false,
      clientId:          clientId || undefined,
      batchId:           uploadBatchId || undefined,
      createdAt:         uploadCreatedAt || undefined,
      batchCreatedAt:    uploadCreatedAt || undefined,
      contentType,
      contentConfidence,
      selected,
      sessionId,
      analysis: {
        brightness:  Math.round(analysis.brightness  * 100),
        contrast:    Math.round(analysis.contrast    * 100),
        saturation:  Math.round(analysis.saturation  * 100),
        temperature: Math.round(analysis.temperature * 100),
        sharpness:   analysis.sharpness,
      },
      exports: {
        portrait: exports.portrait ? path.basename(exports.portrait) : null,
        square:   exports.square   ? path.basename(exports.square)   : null,
      },
    });

    // 14. Mark original as processed
    hashService.markProcessed(filePath);
    markDone(filePath);
    cleanup(pre, enh, up);

    logPerf(fileName, 'total', timer.total(), { output: outName });
    logger.done(fileName, scoreData.total, { output: outName, preset: presetResult.key, selected });
    return { success: true, score: scoreData.total, output: retouchedPath, preset: presetResult.key, exports };

  } catch (err) {
    cleanup(pre, enh, up);
    if (!fs.existsSync(filePath)) {
      return skippedMissingSource(fileName, timer, 'catch_retry');
    }
    // One retry with default preset before failing
    try {
      return await processRetry(filePath, fileName);
    } catch {
      logger.failed(fileName, err);
      try { fs.copyFileSync(filePath, path.join(config.paths.failed, fileName)); } catch {}
      return { success: false, error: String(err) };
    }
  }
}

module.exports = { process };
