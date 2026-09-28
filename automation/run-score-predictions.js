// Equivalente standalone de scorePredictions: compara las predicciones
// pendientes contra los sorteos reales y recalcula el resumen de aciertos.

const { db } = require('./firebaseAdmin');
const { sendTelegram } = require('./telegram');

async function main() {
  const firestore = db();
  const justScored = [];

  const pendingSnap = await firestore.collection('predictions').where('hit', '==', null).get();
  if (pendingSnap.empty) {
    console.log('scorePredictions: no hay predicciones pendientes de calificar.');
  } else {
    const drawsByDate = {};
    for (const doc of pendingSnap.docs) {
      const { date } = doc.data();
      if (!drawsByDate[date]) {
        const s = await firestore.collection('draws').where('date', '==', date).get();
        drawsByDate[date] = s.docs.map(d => d.data());
      }
    }

    const batch = firestore.batch();
    let scored = 0;
    for (const doc of pendingSnap.docs) {
      const pred = doc.data();
      const draws = drawsByDate[pred.date] || [];
      if (draws.length === 0) continue;

      let hit = false, matched = null;
      for (const draw of draws) {
        if (pred.numbers.includes(draw.numero)) { hit = true; matched = `${draw.slot} ${draw.numero}`; break; }
      }
      batch.update(doc.ref, { hit, matched_draw: matched });
      justScored.push({ ...pred, hit, matched_draw: matched });
      scored++;
    }
    if (scored > 0) await batch.commit();
    console.log(`scorePredictions: ${scored} predicciones calificadas.`);
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

  // --- Aviso por Telegram: que se califico hoy + rachas fuera de lo normal ---
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
