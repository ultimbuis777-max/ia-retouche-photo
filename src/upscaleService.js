'use strict';

const { execFileSync } = require('child_process');
const path   = require('path');
const config = require('./config');
const logger = require('./logger');

let _esrganAvailable = null;

function checkEsrgan() {
  if (_esrganAvailable !== null) return _esrganAvailable;
  try {
    execFileSync('realesrgan-ncnn-vulkan', ['-h'], { stdio: 'pipe' });
    _esrganAvailable = true;
  } catch {
    _esrganAvailable = false;
  }
  return _esrganAvailable;
}

function needsUpscale(imagePath) {
  try {
    const out = execFileSync('magick', ['identify', '-format', '%wx%h', imagePath], { stdio: 'pipe' }).toString().trim();
    const [w, h] = out.split('x').map(Number);
    return Math.max(w, h) < config.upscale.threshold;
  } catch {
    return false;
  }
}

function upscale(inputPath, outputPath) {
  if (!config.upscale.enabled) return false;
  if (!checkEsrgan()) {
    logger.info('Real-ESRGAN non disponible, upscale ignoré', { file: path.basename(inputPath) });
    return false;
  }
  if (!needsUpscale(inputPath)) return false;
  try {
    execFileSync('realesrgan-ncnn-vulkan', ['-i', inputPath, '-o', outputPath, '-n', 'realesrgan-x4plus'], {
      stdio: 'pipe',
      timeout: 120000,
    });
    return true;
  } catch (err) {
    logger.info('Upscale échoué, traitement continué sans', { file: path.basename(inputPath), error: String(err) });
    return false;
  }
}

module.exports = { upscale };
