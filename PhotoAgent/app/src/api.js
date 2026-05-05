'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const config = require('./config');
const logger = require('./logger');
const queue  = require('./queue');

const app = express();
app.use(express.static(config.paths.public));
app.use('/images', express.static(config.paths.retouched));

// Liste des images retouchées
app.get('/api/files', (_req, res) => {
  try {
    const files = fs.readdirSync(config.paths.retouched)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(config.paths.retouched, f));
        return { name: f, url: `/images/${f}`, size: stat.size, ts: stat.mtime };
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts));
    res.json(files);
  } catch {
    res.json([]);
  }
});

// Logs
app.get('/api/logs', (_req, res) => {
  res.json(logger.getLogs().slice(-200).reverse());
});

// Statut de la queue
app.get('/api/status', (_req, res) => {
  let retouched = 0;
  let failed    = 0;
  try { retouched = fs.readdirSync(config.paths.retouched).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length; } catch {}
  try { failed    = fs.readdirSync(config.paths.failed).length; } catch {}
  res.json({ ...queue.getStatus(), retouched, failed });
});

function start() {
  app.listen(config.server.port, () => {
    logger.info(`Dashboard → http://localhost:${config.server.port}`);
  });
}

module.exports = { start };
