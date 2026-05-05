'use strict';

const fs   = require('fs');
const path = require('path');

function toKebab(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .split('-').filter(Boolean).slice(0, 4).join('-');
}

function timestamp() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `img-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Generate a collision-free output path in destDir.
 * @param {string} originalPath - source file path
 * @param {string} destDir      - target directory
 * @param {string} [suffix]     - appended before extension, e.g. '_portrait'
 */
function generate(originalPath, destDir, suffix = '') {
  const base  = path.basename(originalPath, path.extname(originalPath));
  const stem  = toKebab(base) || timestamp();
  const name0 = suffix ? `${stem}${suffix}` : stem;

  let name = `${name0}.jpg`;
  let dest = path.join(destDir, name);
  let i = 1;
  while (fs.existsSync(dest)) {
    name = `${name0}-${i}.jpg`;
    dest = path.join(destDir, name);
    i++;
  }
  return dest;
}

module.exports = { generate, timestamp };
