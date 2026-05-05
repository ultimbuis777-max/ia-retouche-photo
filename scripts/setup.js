'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ok  = msg => console.log(`  ✓  ${msg}`);
const err = msg => console.error(`  ✗  ${msg}`);
const inf = msg => console.log(`  -  ${msg}`);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  IA Retouche Photo — Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 1. Node version
const major = parseInt(process.version.slice(1));
if (major < 16) { err(`Node.js >= 16 requis (actuel: ${process.version})`); process.exit(1); }
ok(`Node.js ${process.version}`);

// 2. ImageMagick
let imFound = false;
for (const cmd of ['magick', 'convert']) {
  try { execSync(`${cmd} --version`, { stdio: 'pipe' }); ok(`ImageMagick (${cmd})`); imFound = true; break; }
  catch {}
}
if (!imFound) {
  err('ImageMagick introuvable.');
  console.log('\n     Installer depuis : https://imagemagick.org/script/download.php');
  console.log('     Windows : cocher "Add to PATH" lors de l\'installation\n');
  process.exit(1);
}

// 3. Real-ESRGAN (optionnel)
try {
  execSync('realesrgan-ncnn-vulkan -h', { stdio: 'pipe' });
  ok('Real-ESRGAN disponible (upscale activable)');
} catch {
  inf('Real-ESRGAN non trouvé (optionnel — upscale désactivé par défaut)');
}

// 4. Créer dossiers
console.log('');
const DIRS = ['RAW','retouched','selected','failed','logs','data','public','docs/skills','src','scripts','exports/portrait','exports/square','review','advanced'];
for (const d of DIRS) {
  const full = path.join(ROOT, d);
  if (!fs.existsSync(full)) { fs.mkdirSync(full, { recursive: true }); ok(`Dossier créé : ${d}`); }
  else { inf(`Dossier existant : ${d}`); }
}

// 5. Init fichiers data
console.log('');
const DATA = [
  { f: 'data/hashes.json',         c: '{}' },
  { f: 'data/scores.json',         c: '{}' },
  { f: 'data/history.json',        c: '[]' },
  { f: 'data/clients.json',        c: '[]' },
  { f: 'data/client-uploads.json', c: '{}' },
  { f: 'data/learning.json',       c: '{}' },
  { f: 'data/advanced.json',       c: '{}' },
  { f: 'data/api-keys.json',       c: '{}' },
  { f: 'logs/log.json',            c: '[]' },
];
for (const { f, c } of DATA) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { fs.writeFileSync(full, c, 'utf8'); ok(`Fichier init : ${f}`); }
  else { inf(`Fichier existant : ${f}`); }
}

// 6. npm install
console.log('');
console.log('  Installation des dépendances npm...\n');
try {
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  console.log('');
  ok('Dépendances installées');
} catch {
  err('npm install échoué'); process.exit(1);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Setup terminé.');
console.log('  Lancer : node index.js');
console.log('  Dashboard : http://localhost:3000');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
