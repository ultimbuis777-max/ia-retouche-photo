'use strict';

const path = require('path');

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif',
  '.bmp', '.webp', '.raw', '.cr2', '.nef', '.arw',
]);

function isImage(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function isFait(filePath) {
  return path.basename(filePath).includes('_FAIT');
}

module.exports = { isImage, isFait };
