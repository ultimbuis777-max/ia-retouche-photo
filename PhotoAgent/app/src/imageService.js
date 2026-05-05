'use strict';

const { execFileSync } = require('child_process');
const config = require('./config');

// Auto-détection : magick (Windows/IM7) ou convert (IM6/Linux)
let _cmd = null;
function im() {
  if (_cmd) return _cmd;
  try { execFileSync('magick', ['--version'], { stdio: 'pipe' }); _cmd = 'magick'; }
  catch { _cmd = 'convert'; }
  return _cmd;
}

// Redimensionnement + enhancement qualité pro
function enhance(inputPath, outputPath) {
  execFileSync(im(), [
    inputPath,
    '-resize',           `${config.image.maxSize}x${config.image.maxSize}>`,
    '-auto-level',
    '-contrast-stretch', '0.5%x0.5%',
    '-modulate',         '105,110,100',
    '-sharpen',          '0x1',
    '-quality',          String(config.image.quality),
    outputPath,
  ], { stdio: 'pipe' });
}

// Instagram Portrait 1080×1350
function toPortrait(inputPath, outputPath) {
  execFileSync(im(), [
    inputPath,
    '-resize',  '1080x1350^',
    '-gravity', 'center',
    '-extent',  '1080x1350',
    '-quality', String(config.image.quality),
    outputPath,
  ], { stdio: 'pipe' });
}

// Carré 1080×1080
function toSquare(inputPath, outputPath) {
  execFileSync(im(), [
    inputPath,
    '-resize',  '1080x1080^',
    '-gravity', 'center',
    '-extent',  '1080x1080',
    '-quality', String(config.image.quality),
    outputPath,
  ], { stdio: 'pipe' });
}

module.exports = { enhance, toPortrait, toSquare };
