'use strict';

const path = require('path');

// ROOT = /PhotoAgent  (deux niveaux au-dessus de app/src/)
const ROOT = path.resolve(__dirname, '..', '..');

module.exports = {
  paths: {
    raw:       path.join(ROOT, 'RAW'),
    retouched: path.join(ROOT, 'retouched'),
    failed:    path.join(ROOT, 'failed'),
    logs:      path.join(ROOT, 'logs'),
    data:      path.join(ROOT, 'data'),
    public:    path.join(__dirname, '..', 'public'),
  },
  data: {
    hashes:  path.join(ROOT, 'data', 'hashes.json'),
    logFile: path.join(ROOT, 'logs', 'log.json'),
  },
  image: {
    maxSize: 2048,
    quality: 85,
  },
  server: {
    port: 3000,
  },
};
