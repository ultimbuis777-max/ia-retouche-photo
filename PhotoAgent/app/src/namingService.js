'use strict';

const fs   = require('fs');
const path = require('path');

function toKebab(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .split('-').filter(Boolean).slice(0, 4).join('-');
}

function timestamp() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `image-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Retourne le chemin complet sans extension dans destDir (anti-collision)
function generate(originalPath, destDir) {
  const base  = path.basename(originalPath, path.extname(originalPath));
  const kebab = toKebab(base) || timestamp();
  let name    = `${kebab}.jpg`;
  let dest    = path.join(destDir, name);
  let i       = 1;
  while (fs.existsSync(dest)) {
    name = `${kebab}-${i}.jpg`;
    dest = path.join(destDir, name);
    i++;
  }
  return dest;
}

module.exports = { generate };
