'use strict';

const { execFileSync } = require('child_process');
const config = require('./config');

const PRESETS = {
  immobilier: ['-auto-level', '-brightness-contrast', '5x10', '-modulate', '100,115,100', '-sharpen', '0x0.5'],
  ecom:       ['-auto-level', '-brightness-contrast', '2x8',  '-modulate', '100,105,100', '-sharpen', '0x0.8'],
  social:     ['-auto-level', '-brightness-contrast', '3x12', '-modulate', '100,130,100', '-sharpen', '0x0.6'],
  default:    ['-auto-level', '-brightness-contrast', '3x10', '-modulate', '100,110,100', '-sharpen', '0x0.5'],
};

function preprocess(inputPath, outputPath) {
  execFileSync('magick', [
    inputPath,
    '-resize', `${config.image.maxSize}x${config.image.maxSize}>`,
    '-quality', String(config.image.quality),
    outputPath,
  ], { stdio: 'pipe' });
}

function enhance(inputPath, outputPath, preset) {
  const ops = PRESETS[preset] || PRESETS.default;
  execFileSync('magick', [
    inputPath,
    ...ops,
    '-quality', String(config.image.quality),
    outputPath,
  ], { stdio: 'pipe' });
}

module.exports = { preprocess, enhance };
