'use strict';

const path = require('path');

// ── Detection rules (ordered by specificity) ─────────────────────────────────

const RULES = [
  {
    type: 'food',
    keys: [
      'food', 'pizza', 'burger', 'dish', 'plat', 'meal', 'repas',
      'brunch', 'resto', 'restaurant', 'cafe', 'sushi', 'pasta',
      'dessert', 'cocktail', 'drink', 'snack', 'cuisine',
    ],
  },
  {
    type: 'portrait',
    keys: [
      'portrait', 'face', 'people', 'person', 'selfie', 'headshot',
      'profil', 'visage', 'model', 'modele', 'baby', 'enfant',
    ],
  },
  {
    type: 'interior',
    keys: [
      'salon', 'chambre', 'room', 'house', 'immo', 'flat', 'interior',
      'piece', 'sejour', 'living', 'bathroom', 'office', 'bureau',
    ],
  },
  {
    type: 'product',
    keys: [
      'product', 'item', 'shop', 'store', 'pack', 'article',
      'catalog', 'produit', 'ecom',
    ],
  },
];

// ── Public: detect ────────────────────────────────────────────────────────────

/**
 * Detect content type from file basename using keyword matching.
 *
 * Types:
 *   'food'     — culinary / restaurant photos
 *   'portrait' — people, faces, headshots
 *   'interior' — real-estate, rooms
 *   'product'  — e-commerce, objects on background
 *   'general'  — anything else
 *
 * @param {string} filePath
 * @returns {'food'|'portrait'|'interior'|'product'|'general'}
 */
function detect(filePath) {
  const name = path.basename(filePath).toLowerCase();
  for (const { type, keys } of RULES) {
    if (keys.some(k => name.includes(k))) return type;
  }
  return 'general';
}

module.exports = { detect };
