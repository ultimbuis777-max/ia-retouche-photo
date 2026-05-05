'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  paths: {
    raw:       path.join(ROOT, 'RAW'),
    retouched: path.join(ROOT, 'retouched'),
    selected:  path.join(ROOT, 'selected'),
    failed:    path.join(ROOT, 'failed'),
    logs:      path.join(ROOT, 'logs'),
    data:      path.join(ROOT, 'data'),
    public:    path.join(ROOT, 'public'),
    portrait:  path.join(ROOT, 'exports', 'portrait'),
    square:    path.join(ROOT, 'exports', 'square'),
    review:    path.join(ROOT, 'review'),
    advanced:  path.join(ROOT, 'advanced'),
    backups:   path.join(ROOT, 'backups'),
  },
  data: {
    hashes:  path.join(ROOT, 'data', 'hashes.json'),
    scores:  path.join(ROOT, 'data', 'scores.json'),
    history: path.join(ROOT, 'data', 'history.json'),
    presets: path.join(ROOT, 'data', 'presets.json'),
    review:  path.join(ROOT, 'review', 'review.json'),
    advanced: path.join(ROOT, 'data', 'advanced.json'),
    apiKeys:  path.join(ROOT, 'data', 'api-keys.json'),
  },
  image: {
    maxSize: 2048,
    quality: 90,
  },
  upscale: {
    enabled:   false,
    threshold: 1000,
  },
  scoring: {
    threshold: 70,
  },
  batch: {
    enabled:        true,
    windowMs:       5000,
    topN:           3,
    sessionWindowMs: 600000, // 10-minute session for consistency grouping
  },
  server: {
    port: 3000,
  },
  watcher: {
    ignoreInitial: true,
  },
  preset: 'auto', // auto | social | ecom | restaurant | immobilier | default
};
