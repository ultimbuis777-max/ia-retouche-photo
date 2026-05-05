'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const config         = require('./config');
const logger         = require('./logger');
const imageService   = require('./imageService');
const namingService  = require('./namingService');

function tmpFile(name) {
  const safe = path.basename(name).replace(/[^a-zA-Z0-9.]/g, '_');
  return path.join(os.tmpdir(), `pa_${Date.now()}_${safe}.jpg`);
}

function cleanup(...files) {
  files.forEach(f => { try { fs.unlinkSync(f); } catch {} });
}

async function process(filePath) {
  const fileName = path.basename(filePath);
  logger.processing(fileName);

  const tmpEnh = tmpFile(fileName);

  try {
    // 1. Resize + enhance
    imageService.enhance(filePath, tmpEnh);

    // 2. Nom de sortie (kebab, anti-collision)
    const mainPath = namingService.generate(filePath, config.paths.retouched);
    const stem     = path.basename(mainPath, '.jpg');

    // 3. Version principale
    fs.copyFileSync(tmpEnh, mainPath);

    // 4. Instagram portrait 1080×1350
    imageService.toPortrait(tmpEnh, path.join(config.paths.retouched, `${stem}-portrait.jpg`));

    // 5. Carré 1080×1080
    imageService.toSquare(tmpEnh, path.join(config.paths.retouched, `${stem}-carre.jpg`));

    // 6. Marquer l'original _FAIT
    const ext  = path.extname(filePath);
    const base = path.basename(filePath, ext);
    fs.renameSync(filePath, path.join(path.dirname(filePath), `${base}_FAIT${ext}`));

    cleanup(tmpEnh);
    logger.done(fileName, { output: stem });
    return { success: true };

  } catch (err) {
    cleanup(tmpEnh);
    logger.failed(fileName, err);
    return { success: false, error: String(err) };
  }
}

module.exports = { process };
