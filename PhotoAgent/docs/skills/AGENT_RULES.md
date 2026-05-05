# AGENT RULES — PhotoAgent

## Principes

1. **Simplicité** — Aucune abstraction inutile. Code direct, lisible.
2. **Robustesse** — try/catch partout. Jamais de crash global.
3. **Idempotence** — Un fichier `_FAIT` est ignoré définitivement.
4. **Pipeline fiable** — Watcher → Queue → Processor, strictement séquentiel.
5. **Qualité naturelle** — Enhancement subtil, rendu réaliste, non artificiel.
6. **Logs systématiques** — Chaque action tracée avec statut + timestamp.

---

## Pipeline

```
RAW/image.jpg
  → watcher détecte
  → hash MD5 (anti-doublon)
  → queue (FIFO, 1 à la fois)
  → processor :
       enhance (ImageMagick)
       → main.jpg
       → main-portrait.jpg (1080×1350)
       → main-carre.jpg (1080×1080)
  → RAW/image_FAIT.jpg
```

---

## Enhancement ImageMagick

Paramètres exacts (ne pas modifier sans raison) :

```
-resize 2048x2048>
-auto-level
-contrast-stretch 0.5%x0.5%
-modulate 105,110,100
-sharpen 0x1
-quality 85
```

- **auto-level** : corrige automatiquement les niveaux (noir/blanc)
- **contrast-stretch** : étire le contraste sans saturer
- **modulate 105,110,100** : légère hausse luminosité (+5%) et saturation (+10%)
- **sharpen 0x1** : netteté réaliste sans artefacts

---

## Gestion erreurs

- Échec processor → retry x1 automatique
- Échec après retry → déplacement vers `/failed/`
- Fichiers temporaires nettoyés dans tous les cas (succès ou erreur)
- Jamais `process.exit()` hors contexte de démarrage

---

## Nommage

- Basé sur le nom original (kebab-case, max 4 mots)
- Fallback : `image-YYYYMMDD-HHmm.jpg`
- Suffixes sociaux : `-portrait.jpg` et `-carre.jpg`
- Anti-collision : suffixe `-1`, `-2`, etc.

---

## Évolutions

| Modifier | Fichier |
|---|---|
| Paramètres enhancement | `src/imageService.js` |
| Tailles export social | `src/imageService.js` (toPortrait / toSquare) |
| Port serveur | `src/config.js` |
| Formats d'entrée | `src/utils.js` (IMAGE_EXTS) |
