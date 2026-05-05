'use strict';

const path   = require('path');
const config = require('./config');

const RULES = [
  { preset: 'immobilier', keys: ['salon', 'chambre', 'cuisine', 'bathroom', 'room', 'house', 'immo', 'flat', 'floor', 'interior', 'piece', 'sejour'] },
  { preset: 'ecom',       keys: ['product', 'item', 'shop', 'store', 'pack', 'article', 'catalog', 'produit'] },
  { preset: 'social',     keys: ['insta', 'social', 'post', 'story', 'reel', 'lifestyle', 'portrait', 'selfie'] },
];

function classify(filePath) {
  if (config.preset !== 'auto') return config.preset;
  const name = path.basename(filePath).toLowerCase();
  for (const { preset, keys } of RULES) {
    if (keys.some(k => name.includes(k))) return preset;
  }
  return 'default';
}

module.exports = { classify };
