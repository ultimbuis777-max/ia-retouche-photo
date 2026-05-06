'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const config           = require('./config');
const logger           = require('./logger');
const scoringAgent     = require('./agents/scoringAgent');
const consistencyAgent = require('./agents/consistencyAgent');
const presetAgent      = require('./agents/presetAgent');
const enhanceAgent     = require('./agents/enhanceAgent');
const batchService     = require('./batchService');
const queue            = require('./queue');

// Lazy-require to avoid circular deps
function imageService() { return require('./imageService'); }

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static(config.paths.public));
app.use('/raw',       express.static(config.paths.raw));
app.use('/retouched', express.static(config.paths.retouched));
app.use('/selected',  express.static(config.paths.selected));
app.use('/portrait',  express.static(config.paths.portrait));
app.use('/square',    express.static(config.paths.square));
app.use('/review',    express.static(config.paths.review));
app.use('/advanced',  express.static(config.paths.advanced));

// ── Data file paths ───────────────────────────────────────────────────────────

const DATA_DIR            = path.resolve(__dirname, '..', 'data');
const CLIENTS_FILE        = path.join(DATA_DIR, 'clients.json');
const CLIENT_UPLOADS_FILE = path.join(DATA_DIR, 'client-uploads.json');
const ALLOWED_KEY_PROVIDERS = ['openai', 'replicate', 'stability', 'photoroom', 'custom'];

// ── Generic helpers ───────────────────────────────────────────────────────────

function listImages(dir, urlPrefix) {
  try {
    return fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, url: `/${urlPrefix}/${f}`, size: stat.size, ts: stat.mtime };
      });
  } catch { return []; }
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function saveJSON(file, data) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function backupDataFiles() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const root = config.paths.backups || path.resolve(__dirname, '..', 'backups');
  let dest = path.join(root, stamp);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(root, `${stamp}-${String(i).padStart(3, '0')}`);
    i++;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'))) {
    fs.copyFileSync(path.join(DATA_DIR, file), path.join(dest, file));
  }
  return dest;
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 4) return '****';
  if (key.length <= 8) return `****${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function sanitizeProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  return ALLOWED_KEY_PROVIDERS.includes(p) ? p : null;
}

// ── Image endpoints ───────────────────────────────────────────────────────────

app.get('/api/files',    (_req, res) => res.json(listImages(config.paths.retouched, 'retouched')));
app.get('/api/selected', (_req, res) => res.json(listImages(config.paths.selected,  'selected')));
app.get('/api/exports',  (_req, res) => res.json({
  portrait: listImages(config.paths.portrait, 'portrait'),
  square:   listImages(config.paths.square,   'square'),
}));

app.get('/api/advanced', (_req, res) => {
  const images = listImages(config.paths.advanced, 'advanced');
  const data   = loadJSON(config.data.advanced, {});
  res.json(images.map(img => ({
    ...img,
    ...(data[img.name] || {}),
  })));
});

app.post('/api/advanced/queue', (req, res) => {
  const files = Array.isArray(req.body && req.body.files) ? req.body.files : [req.body && req.body.filename];
  const queued = [];
  const errors = [];

  try {
    if (!fs.existsSync(config.paths.advanced)) fs.mkdirSync(config.paths.advanced, { recursive: true });
    const data = loadJSON(config.data.advanced, {});

    for (const item of files) {
      const filename = path.basename(String(item || ''));
      if (!filename) continue;
      const src = path.join(config.paths.retouched, filename);
      const dest = path.join(config.paths.advanced, filename);
      if (!fs.existsSync(src)) { errors.push({ filename, error: 'not found' }); continue; }
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      data[filename] = {
        ...(data[filename] || {}),
        output: filename,
        status: 'pending',
        reason: data[filename] && data[filename].reason ? data[filename].reason : 'Retouche IA demandée',
        suggestedAction: data[filename] && data[filename].suggestedAction ? data[filename].suggestedAction : 'Instruction manuelle à préciser',
        updatedAt: new Date().toISOString(),
      };
      queued.push(filename);
    }

    saveJSON(config.data.advanced, data);
    res.json({ ok: true, queued, errors });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/advanced/prepare', (req, res) => {
  const instruction = String((req.body && req.body.instruction) || '').trim();
  const provider = sanitizeProvider(req.body && req.body.provider);
  if (!provider) return res.status(400).json({ error: 'invalid provider' });

  try {
    const data = loadJSON(config.data.advanced, {});
    let count = 0;
    for (const item of Object.values(data)) {
      if (!item || !['pending', 'suggested', 'later'].includes(item.status)) continue;
      item.status = 'ready';
      item.provider = provider;
      item.instruction = instruction;
      item.updatedAt = new Date().toISOString();
      count++;
    }
    saveJSON(config.data.advanced, data);
    res.json({ ok: true, ready: count, message: 'Retouche IA prête à être lancée — connexion API non activée dans cette version.' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/advanced/:filename/status', (req, res) => {
  const filename = path.basename(req.params.filename || '');
  const status   = String((req.body && req.body.status) || '').trim();
  if (!filename || !['pending', 'ready', 'ai_requested', 'done', 'cancelled', 'kept', 'later', 'suggested'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }

  try {
    const data = loadJSON(config.data.advanced, {});
    data[filename] = {
      ...(data[filename] || {}),
      status,
      updatedAt: new Date().toISOString(),
    };
    saveJSON(config.data.advanced, data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/selected/:filename', (req, res) => {
  const filename = path.basename(req.params.filename || '');
  if (!filename) return res.status(400).json({ error: 'invalid filename' });
  const src = path.join(config.paths.retouched, filename);
  const dest = path.join(config.paths.selected, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'not found' });

  try {
    if (!fs.existsSync(config.paths.selected)) fs.mkdirSync(config.paths.selected, { recursive: true });
    fs.copyFileSync(src, dest);
    res.json({ ok: true, filename });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Scores / history / logs ───────────────────────────────────────────────────

app.get('/api/scores',  (_req, res) => res.json(scoringAgent.getScores()));
app.get('/api/logs',    (_req, res) => res.json(logger.getLogs().slice(-200).reverse()));
app.get('/api/history', (_req, res) => res.json(batchService.getHistory().slice(-200).reverse()));

app.get('/api/settings/keys', (_req, res) => {
  const stored = loadJSON(config.data.apiKeys, {});
  res.json(ALLOWED_KEY_PROVIDERS.map(provider => {
    const key = stored[provider] && stored[provider].key;
    return { provider, configured: Boolean(key), masked: key ? maskKey(key) : '' };
  }));
});

app.post('/api/settings/keys', (req, res) => {
  const provider = sanitizeProvider(req.body && req.body.provider);
  const key      = String((req.body && req.body.key) || '').trim();
  if (!provider) return res.status(400).json({ error: 'invalid provider' });
  if (!key)      return res.status(400).json({ error: 'key required' });

  try {
    const stored = loadJSON(config.data.apiKeys, {});
    stored[provider] = { key, updatedAt: new Date().toISOString() };
    saveJSON(config.data.apiKeys, stored);
    res.json({ ok: true, provider, configured: true, masked: maskKey(key) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete('/api/settings/keys/:provider', (req, res) => {
  const provider = sanitizeProvider(req.params.provider);
  if (!provider) return res.status(400).json({ error: 'invalid provider' });

  try {
    backupDataFiles();
    const stored = loadJSON(config.data.apiKeys, {});
    delete stored[provider];
    saveJSON(config.data.apiKeys, stored);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  const scores = scoringAgent.getScores();
  const vals   = Object.values(scores).map(s => s.total || 0);
  const avg    = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  let retouched = 0, selected = 0, failed = 0, portrait = 0, square = 0, review = 0;
  try { retouched = fs.readdirSync(config.paths.retouched).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length; } catch {}
  try { selected  = fs.readdirSync(config.paths.selected).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;  } catch {}
  try { failed    = fs.readdirSync(config.paths.failed).length;                                               } catch {}
  try { portrait  = fs.readdirSync(config.paths.portrait).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;  } catch {}
  try { square    = fs.readdirSync(config.paths.square).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;    } catch {}
  try { review    = fs.readdirSync(config.paths.review).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;    } catch {}
  res.json({ retouched, selected, failed, portrait, square, review, avgScore: avg, queue: queue.getStatus() });
});

// ── Session / consistency ─────────────────────────────────────────────────────

app.get('/api/session', (_req, res) => {
  const sessionId = consistencyAgent.getCurrentSessionId();
  const stats     = consistencyAgent.getSessionStats(sessionId);
  res.json({ sessionId, ...stats });
});

// ── Presets ───────────────────────────────────────────────────────────────────

app.get('/api/presets', (_req, res) => {
  res.json({ presets: presetAgent.loadPresets(), active: config.preset });
});

app.post('/api/presets/:key', (req, res) => {
  const { key } = req.params;
  const { params, name, description } = req.body;
  if (!params) return res.status(400).json({ error: 'params required' });
  let presets = {};
  try { presets = presetAgent.loadPresets(); } catch {}
  presets[key] = { name: name || key, description: description || '', style: key, params };
  try {
    fs.writeFileSync(config.data.presets, JSON.stringify(presets, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Config ────────────────────────────────────────────────────────────────────

app.post('/api/config', (req, res) => {
  const { scoreThreshold, upscaleEnabled, preset } = req.body;
  if (scoreThreshold !== undefined) config.scoring.threshold = Number(scoreThreshold);
  if (upscaleEnabled !== undefined) config.upscale.enabled   = Boolean(upscaleEnabled);
  if (preset         !== undefined) config.preset            = preset;
  res.json({ ok: true, preset: config.preset, scoreThreshold: config.scoring.threshold });
});

// ── Clients ───────────────────────────────────────────────────────────────────

app.get('/api/clients', (_req, res) => res.json(loadJSON(CLIENTS_FILE, [])));

app.post('/api/clients', (req, res) => {
  const { name, type, preset } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const clients = loadJSON(CLIENTS_FILE, []);
  const client  = {
    id:        makeId(),
    name:      name.trim(),
    type:      type   || 'default',
    preset:    preset || 'auto',
    createdAt: new Date().toISOString(),
  };
  clients.push(client);
  saveJSON(CLIENTS_FILE, clients);
  res.json(client);
});

app.put('/api/clients/:id', (req, res) => {
  const clients = loadJSON(CLIENTS_FILE, []);
  const idx = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  clients[idx] = { ...clients[idx], ...req.body, id: req.params.id };
  saveJSON(CLIENTS_FILE, clients);
  res.json(clients[idx]);
});

app.delete('/api/clients/:id', (req, res) => {
  try { backupDataFiles(); }
  catch (e) { return res.status(500).json({ error: String(e) }); }
  const clients = loadJSON(CLIENTS_FILE, []).filter(c => c.id !== req.params.id);
  saveJSON(CLIENTS_FILE, clients);
  res.json({ ok: true });
});

// ── Client uploads mapping ────────────────────────────────────────────────────

app.get('/api/client-uploads', (_req, res) => res.json(loadJSON(CLIENT_UPLOADS_FILE, {})));

// ── Upload ────────────────────────────────────────────────────────────────────

app.post('/api/upload', (req, res) => {
  const { clientId, files } = req.body;
  const batchId = req.body && req.body.batchId ? String(req.body.batchId) : null;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array required' });
  }

  if (clientId) {
    const client = loadJSON(CLIENTS_FILE, []).find(c => c.id === clientId);
    if (client && client.preset && client.preset !== 'auto') config.preset = client.preset;
  }

  const uploads = loadJSON(CLIENT_UPLOADS_FILE, {});
  const saved   = [];
  const errors  = [];
  const uploadBatchId = batchId || (files.length > 1 ? makeId() : null);
  const uploadCreatedAt = new Date().toISOString();

  for (const file of files) {
    if (!file.name || !file.data) { errors.push({ name: file.name || '?', error: 'missing data' }); continue; }
    try {
      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!safeName) throw new Error('invalid filename');
      const dest = path.join(config.paths.raw, safeName);
      fs.writeFileSync(dest, Buffer.from(file.data, 'base64'));
      if (clientId || uploadBatchId) {
        uploads[safeName] = {
          clientId: clientId || null,
          batchId: uploadBatchId,
          createdAt: uploadCreatedAt,
        };
      }
      saved.push(safeName);
    } catch (e) {
      errors.push({ name: file.name, error: String(e) });
    }
  }

  if ((clientId || uploadBatchId) && saved.length > 0) saveJSON(CLIENT_UPLOADS_FILE, uploads);
  res.json({ ok: true, saved, errors, batchId: uploadBatchId, createdAt: uploadCreatedAt });
});

// ── Review ────────────────────────────────────────────────────────────────────

/**
 * GET /api/review
 * List all images in /review with their reason from review.json
 */
app.get('/api/review', (_req, res) => {
  const images  = listImages(config.paths.review, 'review');
  const reasons = loadJSON(config.data.review, {});
  const result  = images.map(img => ({
    ...img,
    ...(reasons[img.name] || {}),
  }));
  res.json(result);
});

/**
 * POST /api/review/approve/:filename
 * Move image from /review back to /RAW → watcher picks it up automatically
 */
app.post('/api/review/approve/:filename', (req, res) => {
  const { filename } = req.params;
  const src  = path.join(config.paths.review, filename);
  const dest = path.join(config.paths.raw,    filename);

  if (!fs.existsSync(src)) return res.status(404).json({ error: 'not found' });

  try {
    backupDataFiles();
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);

    // Remove from review.json
    const data = loadJSON(config.data.review, {});
    delete data[filename];
    saveJSON(config.data.review, data);

    logger.info(`Approuvé depuis review → RAW : ${filename}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /api/review/reject/:filename
 * Permanently delete image from /review
 */
app.post('/api/review/reject/:filename', (req, res) => {
  const { filename } = req.params;
  const src = path.join(config.paths.review, filename);

  try {
    backupDataFiles();
    if (fs.existsSync(src)) fs.unlinkSync(src);

    const data = loadJSON(config.data.review, {});
    delete data[filename];
    saveJSON(config.data.review, data);

    logger.info(`Rejeté et supprimé : ${filename}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /api/retry/:filename
 * Re-enqueue an image from /failed for reprocessing (system errors only)
 */
app.post('/api/retry/:filename', (req, res) => {
  const { filename } = req.params;
  const src  = path.join(config.paths.failed, filename);
  const dest = path.join(config.paths.raw,    filename);

  if (!fs.existsSync(src)) return res.status(404).json({ error: 'not found' });

  try {
    backupDataFiles();
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
    logger.info(`Retry lancé : ${filename}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Preset test (before / after preview) ─────────────────────────────────────

/**
 * POST /api/preset/test
 * Body: { params: object, image: base64 string }
 * Returns: { before: base64, after: base64 }
 */
app.post('/api/preset/test', (req, res) => {
  const { params, image } = req.body;
  if (!params || !image) return res.status(400).json({ error: 'params and image required' });

  const stamp  = Date.now();
  const tmpIn  = path.join(os.tmpdir(), `pt_in_${stamp}.jpg`);
  const tmpPre = path.join(os.tmpdir(), `pt_pre_${stamp}.jpg`);
  const tmpOut = path.join(os.tmpdir(), `pt_out_${stamp}.jpg`);

  try {
    fs.writeFileSync(tmpIn, Buffer.from(image, 'base64'));
    try { imageService().preprocess(tmpIn, tmpPre); } catch { fs.copyFileSync(tmpIn, tmpPre); }
    enhanceAgent.enhance(tmpPre, tmpOut, params);
    const before = fs.readFileSync(tmpPre).toString('base64');
    const after  = fs.readFileSync(tmpOut).toString('base64');
    res.json({ before, after });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    for (const f of [tmpIn, tmpPre, tmpOut]) try { fs.unlinkSync(f); } catch {}
  }
});

// ── Client custom preset ──────────────────────────────────────────────────────

/**
 * PUT /api/clients/:id/preset-custom
 * Body: { params: object }  — saves presetCustom onto the client record
 */
app.put('/api/clients/:id/preset-custom', (req, res) => {
  const { params } = req.body;
  if (!params) return res.status(400).json({ error: 'params required' });

  const clients = loadJSON(CLIENTS_FILE, []);
  const idx     = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'client not found' });

  clients[idx].presetCustom = params;
  saveJSON(CLIENTS_FILE, clients);
  res.json({ ok: true, client: clients[idx] });
});

// ── Reset history ─────────────────────────────────────────────────────────────

app.post('/api/reset-history', (_req, res) => {
  try {
    backupDataFiles();
    fs.writeFileSync(config.data.history, '[]', 'utf8');
    fs.writeFileSync(config.data.hashes,  '{}', 'utf8');
    logger.info('Historique et hashes réinitialisés');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

function start() {
  app.listen(config.server.port, () => {
    logger.info(`Dashboard → http://localhost:${config.server.port}`);
  });
}

module.exports = { start };
