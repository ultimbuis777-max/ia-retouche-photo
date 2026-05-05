# PhotoAgent — Retouche Photo Automatique

Agent local de retouche photo. 100% offline. Aucune API payante.

---

## Installation (une seule fois)

**1. Installer Node.js**
→ https://nodejs.org (version 16 ou plus)

**2. Installer ImageMagick**
→ https://imagemagick.org/script/download.php
→ Windows : cocher **"Add application directory to your system path"** lors de l'installation

---

## Lancement

Double-cliquer sur **`start.bat`**

Le dashboard s'ouvre automatiquement sur http://localhost:3000

---

## Utilisation

1. Déposer les images dans le dossier **`RAW/`**
2. Le traitement démarre automatiquement
3. Les images retouchées apparaissent dans **`retouched/`**

---

## Versions générées par image

| Fichier | Format | Usage |
|---|---|---|
| `nom.jpg` | Original amélioré | Toutes plateformes |
| `nom-portrait.jpg` | 1080 × 1350 px | Instagram Portrait |
| `nom-carre.jpg` | 1080 × 1080 px | Instagram Carré |

---

## Structure des dossiers

```
PhotoAgent/
├── RAW/          ← déposer les images ici
├── retouched/    ← images traitées (3 versions)
├── failed/       ← images en erreur
├── logs/         ← journal d'activité
└── start.bat     ← double-clic pour lancer
```

---

## Formats acceptés

JPG, JPEG, PNG, TIFF, BMP, WEBP, RAW, CR2, NEF, ARW
