# IA Retouche Photo

Agent autonome de retouche photo intelligent, rapide et local.

## 🚀 Objectif

Automatiser la retouche photo pour réseaux sociaux avec :
- cohérence visuelle
- gain de temps
- zéro complexité utilisateur

## ⚙️ Fonctionnement

Pipeline hybride :

- 80–90% des images → traitement local (gratuit)
- 10–20% → retouche avancée (optionnelle via API)

Workflow :

Upload → Analyse → Retouche auto → Score →  
→ OK → Export  
→ À vérifier → Validation  
→ Retouche avancée → option IA

## 🧩 Fonctionnalités

- Retouche automatique (ImageMagick)
- Détection contenu (food / portrait / intérieur)
- Presets par client (branding)
- Learning automatique
- Scoring qualité
- Dashboard UX simple
- Retouche avancée suggérée (non bloquante)
- Gestion des clés API (optionnelle)

## 💰 Coût

- Usage principal → 0€
- IA avancée → quelques centimes par image (optionnel)
- Aucun abonnement obligatoire

## 🖥️ Stack

- Node.js (CommonJS)
- Express
- ImageMagick
- Vanilla JS (frontend)

## 🔒 Sécurité

- Clés API locales (non versionnées)
- Aucune API appelée par défaut
- Traitement local prioritaire

## 📦 Installation

```bash
npm install
npm start
