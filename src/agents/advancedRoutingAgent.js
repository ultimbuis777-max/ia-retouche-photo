'use strict';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function suggest(ctx = {}) {
  const score      = num(ctx.scoreData && ctx.scoreData.total, 50);
  const sharpness  = num(ctx.scoreData && ctx.scoreData.sharpness, 50);
  const brightness = num(ctx.scoreData && ctx.scoreData.brightness, 50);
  const contrast   = num(ctx.scoreData && ctx.scoreData.contrast, 50);
  const content    = ctx.contentType || 'general';
  const confidence = ctx.contentConfidence || 'low';

  if (score < 45) {
    return { shouldRoute: false, reason: '', suggestedAction: '' };
  }

  if (score < 55) {
    return {
      shouldRoute: true,
      reason: `Score exploitable mais faible (${score}/100)`,
      suggestedAction: 'Revoir lumiere, contraste et nettete avant livraison finale',
    };
  }

  if (confidence === 'low' && score < 70) {
    return {
      shouldRoute: true,
      reason: `Detection incertaine avec score moyen (${score}/100)`,
      suggestedAction: 'Verifier manuellement le rendu et le preset applique',
    };
  }

  if (content === 'food' && (brightness < 58 || contrast < 45)) {
    return {
      shouldRoute: true,
      reason: 'Image food avec luminosite ou contraste perfectible',
      suggestedAction: 'Renforcer appetence, contraste local et equilibre lumineux',
    };
  }

  if (sharpness < 38 && score >= 45) {
    return {
      shouldRoute: true,
      reason: 'Nettete faible mais image exploitable',
      suggestedAction: 'Prevoir une correction de nettete selective',
    };
  }

  return { shouldRoute: false, reason: '', suggestedAction: '' };
}

module.exports = { suggest };
