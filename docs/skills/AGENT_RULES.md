# AGENT RULES

## Principes fondamentaux

1. **Simplicité > Complexité** — Toujours choisir la solution la plus simple qui fonctionne. Pas d'abstraction spéculative.
2. **Jamais retraiter** — Un fichier suffixé `_FAIT` est ignoré définitivement. Idempotence garantie.
3. **Pipeline idempotent** — Le même fichier d'entrée produit toujours le même résultat.
4. **Scoring avant output** — Le score est calculé avant toute copie vers `/selected`.
5. **Éviter la surcharge CPU** — Traitement strictement séquentiel (1 image à la fois).
6. **Toujours un fallback** — Aucune exception ne doit crasher l'agent. Toujours un plan B.
7. **Logs obligatoires** — Chaque action est loggée avec timestamp, statut et contexte.

---

## Règles pipeline

- `watcher → queue → processor` (séquentiel, jamais parallèle)
- Hash MD5 vérifié avant enqueue (anti-doublon)
- Retry x1 automatique en cas d'échec
- Si retry échoue → déplacement vers `/failed`
- Fichiers temporaires nettoyés après chaque traitement (succès ou échec)
- L'original est renommé `_FAIT` uniquement après succès complet

---

## Règles scoring

- `sharpness (40%) + brightness (35%) + contrast (25%)`
- Score final : 0 → 100
- Seuil défaut : **70** → copie vers `/selected`
- Si scoring échoue → score fallback : **50**
- Score stocké dans `data/scores.json` par nom de fichier de sortie

---

## Règles nommage

- Kebab-case, max 4 mots, basé sur le nom original
- Fallback si nom vide ou non convertible : `image-YYYYMMDD-HHmm.jpg`
- Anti-collision : suffixe `-1`, `-2`, etc. si le fichier existe déjà

---

## Règles gestion d'erreurs

- `try/catch` sur chaque service critique
- Nettoyage des fichiers tmp en cas d'erreur
- Jamais de `process.exit()` hors du script de setup
- Log systématique de chaque erreur avec message complet

---

## Règles extension

- Ajouter un preset → modifier uniquement `imageService.js` (PRESETS) et `presetService.js` (RULES)
- Modifier le seuil de sélection → via `POST /api/config` ou `src/config.js`
- Ajouter un format d'entrée → ajouter l'extension dans `src/utils.js` (IMAGE_EXTS)
