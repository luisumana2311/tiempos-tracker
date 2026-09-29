// Equivalente standalone de scorePredictions: compara las predicciones
// contra los sorteos reales y recalcula el resumen de aciertos.
//
// Revisa TODAS las predicciones (no solo las pendientes), normalizando
// numeros con padStart(2,'0') antes de comparar. Esto es un "self-heal":
// si algun capture viejo guardo numeros sin cero a la izquierda (bug
// detectado el 2026-09-29 -- yelu_hot7 del 2026-09-28 se guardo como "9"
// en vez de "09", y por eso "9" nunca calzaba contra el "09" del sorteo,
// marcando "no acerto" cuando si habia acertado), esta pasada lo corrige
// solo, sin tener que editar Firestore a mano. El volumen es bajo (3
// predicciones por dia), asi que revisar todo cada vez es barato.

const { db } = require('./firebaseAdmin');
const { sendTelegram } = require('./telegram');

function norm(numStr) {
  return String(numStr).padStart(2, '0');
}

async function main() {
  const firestore = db();
  const justScored = [];
  const corrected = [];

  const allPredsSnap = await firestore.collection('predictions').get();
  if (allPredsSnap.empty) {
    console.log('scorePredictions: no hay predicciones guardadas todavia.');
  } else {
    const drawsByDate = {};
    for (const doc of allPredsSnap.docs) {
      const { date } = doc.data();
      if (!(date in drawsByDate)) {
        const s = await firestore.collection('draws').where('date', '==', date).get();
        drawsByDate[date] = s.docs.map(d => d.data());
      }
    }

    const batch = firestore.batch();
    let scored = 0;
    for (const doc of allPredsSnap.docs) {
      const pred = doc.data();
      const draws = drawsByDate[pred.date] || [];
      if (draws.length === 0) continue; // todavia no hay sorteos ese dia, se deja pendiente

      const normalizedPredNums = (pred.numbers || []).map(norm);
      let hit = false, matched = null;
      for (const draw of draws) {
        if (normalizedPredNums.includes(norm(draw.numero))) { hit = true; matched = `${draw.slot} ${draw.numero}`; break; }
      }

      const wasPending = pred.hit === null || pred.hit === undefined;
      const changed = pred.hit !== hit || pred.matched_draw !== matched;
      if (!changed) continue;

      batch.update(doc.ref, { hit, matched_draw: matched });
      scored++;
      if (wasPending) {
        justScored.push({ ...pred, hit, matched_draw: matched });
      } else {
        corrected.push({ ...pred, hit_before: pred.hit, hit, matched_draw: matched });
      }
    }
    if (scored > 0) await batch.commit();
    console.log(`scorePredictions: ${justScored.length} predicciones nuevas calificadas, ${corrected.length} corregidas (calificacion previa estaba mal).`);
    for (const c of corrected) {
      console.log(`  corregido: ${c.source} (${c.date}) paso de hit=${c.hit_before} a hit=${c.hit}`);
    }
  }

  const allSnap = await firestore.collection('predictions').where('hit', '!=', null).get();
  const bySource = {};
  for (const doc of allSnap.docs) {
    const p = doc.data();
    if (!bySource[p.source]) bySource[p.source] = { days: 0, hits: 0, baseline_pct: p.baseline_pct, kind: p.kind };
    bySource[p.source].days++;
    if (p.hit) bySource[p.source].hits++;
  }
  const summary = {};
  for (const [source, s] of Object.entries(bySource)) {
    summary[source] = { ...s, hit_rate_pct: s.days ? Math.round((s.hits / s.days) * 1000) / 10 : 0 };
  }
  await firestore.collection('predictions_summary').doc('latest').set({ sources: summary, updated_at: new Date().toISOString() });
  console.log('scorePredictions: resumen recalculado.');

  // --- Aviso por Telegram: solo por calificaciones NUEVAS (no por
  // correcciones de dias viejos, para no generar ruido con historia). ---
  if (justScored.length > 0) {
    const lines = ['🔎 <b>Predicciones calificadas</b>'];
    for (const p of justScored) {
      lines.push(`${p.source} (${p.date}): ${p.hit ? `✅ acerto (${p.matched_draw})` : '❌ no acerto'}`);
    }

    const streakAlerts = [];
    for (const [source, s] of Object.entries(summary)) {
      if (s.days >= 20 && s.hit_rate_pct >= s.baseline_pct * 2) {
        streakAlerts.push(`⚠️ ${source} lleva ${s.days} dias con ${s.hit_rate_pct}% de acierto, mas del doble de lo esperado por azar (${s.baseline_pct}%). Vale la pena revisarlo.`);
      }
    }
    if (streakAlerts.length) lines.push('', ...streakAlerts);

    await sendTelegram(lines.join('\n'));
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
