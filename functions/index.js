const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

const { parseHistoricoHtml } = require('../automation/lib/parseHistorico');
const { parseHot30Cold30, parseNuevosTiemposHoy } = require('../automation/lib/parseYelu');
const { computeStats } = require('../automation/lib/stats');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' });

const TZ = 'America/Costa_Rica';
const HISTORICO_URL = 'https://www.loteriaypiramides.com/costa-rica/nuevos-tiempos/historico';
const YELU_HOY_URL = 'https://www.yelu.cr/jps-numeros-suerte-hoy';
const YELU_HOTCOLD_URL = 'https://www.yelu.cr/hot-cold-numbers/nuevos-tiempos';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function todayCR() {
  // Fecha de hoy en zona horaria de Costa Rica, formato YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

// ---------------------------------------------------------------------
// 1) updateDraws: trae los sorteos recientes y recalcula las estadisticas
//    del dashboard principal. Corre todas las noches despues del sorteo
//    "Noche" (~9:12pm hora CR).
// ---------------------------------------------------------------------
exports.updateDraws = onSchedule({ schedule: '12 21 * * *', timeZone: TZ }, async () => {
  const html = await fetchHtml(HISTORICO_URL);
  const rows = parseHistoricoHtml(html);
  logger.info(`updateDraws: ${rows.length} filas parseadas del historico`);

  if (rows.length === 0) {
    logger.warn('updateDraws: no se parseo ninguna fila, no se actualiza nada.');
    return;
  }

  const batch = db.batch();
  for (const row of rows) {
    const id = `${row.draw_id}`;
    batch.set(db.collection('draws').doc(id), row, { merge: true });
  }
  await batch.commit();

  // Recalcular estadisticas sobre TODO el historico guardado en Firestore.
  const snap = await db.collection('draws').get();
  const allDraws = snap.docs.map(d => d.data());
  const stats = computeStats(allDraws);
  await db.collection('stats').doc('latest').set(stats);

  logger.info(`updateDraws: stats recalculadas sobre ${allDraws.length} sorteos totales.`);
});

// ---------------------------------------------------------------------
// 2) capturePredictions: guarda las predicciones del dia de yelu.cr,
//    ANTES de que salgan los sorteos del dia (~8:41am hora CR).
// ---------------------------------------------------------------------
exports.capturePredictions = onSchedule({ schedule: '41 8 * * *', timeZone: TZ }, async () => {
  const date = todayCR();

  const [hoyHtml, hotColdHtml] = await Promise.all([
    fetchHtml(YELU_HOY_URL),
    fetchHtml(YELU_HOTCOLD_URL)
  ]);

  const { luckyNumbers, hot7 } = parseNuevosTiemposHoy(hoyHtml);
  const { hot30 } = parseHot30Cold30(hotColdHtml);

  const entries = [];
  if (luckyNumbers.length) {
    entries.push({
      source: 'yelu_lucky', kind: `${luckyNumbers.length} numeros del dia`,
      numbers: luckyNumbers, baseline_pct: baselinePct(luckyNumbers.length)
    });
  }
  if (hot7.length) {
    entries.push({
      source: 'yelu_hot7', kind: '7 calientes (ultimos 200 sorteos)',
      numbers: hot7, baseline_pct: baselinePct(hot7.length)
    });
  }
  if (hot30.length) {
    entries.push({
      source: 'yelu_hot30', kind: '30 calientes (10-150 sorteos)',
      numbers: hot30, baseline_pct: baselinePct(hot30.length)
    });
  }

  if (entries.length === 0) {
    logger.warn('capturePredictions: no se pudo extraer ninguna prediccion hoy (posible cambio de estructura en yelu.cr).');
    return;
  }

  const batch = db.batch();
  for (const e of entries) {
    const id = `${date}_${e.source}`;
    batch.set(db.collection('predictions').doc(id), {
      date, source: e.source, kind: e.kind, numbers: e.numbers,
      baseline_pct: e.baseline_pct, hit: null, matched_draw: null,
      captured_at: new Date().toISOString()
    }, { merge: true });
  }
  await batch.commit();
  logger.info(`capturePredictions: ${entries.length} predicciones guardadas para ${date}.`);
});

// Probabilidad de que al menos uno de los 3 sorteos del dia caiga dentro
// de una lista de k numeros elegidos al azar entre 00-99:
// 1 - (1 - k/100)^3
function baselinePct(k) {
  const p = 1 - Math.pow(1 - k / 100, 3);
  return Math.round(p * 1000) / 10; // 1 decimal, en %
}

// ---------------------------------------------------------------------
// 3) scorePredictions: califica las predicciones del dia contra los
//    sorteos reales, y recalcula el resumen de aciertos por fuente.
//    Corre despues de updateDraws (~8:35pm hora CR, dejando margen para
//    el sorteo "Tarde"; el de "Noche" lo califica el dia siguiente si
//    hiciera falta, ya que la logica recalcula pendientes).
// ---------------------------------------------------------------------
exports.scorePredictions = onSchedule({ schedule: '35 20 * * *', timeZone: TZ }, async () => {
  // Califica cualquier prediccion con hit aun pendiente (null), no solo la de hoy,
  // para no perder dias si una corrida fallo.
  const pendingSnap = await db.collection('predictions').where('hit', '==', null).get();
  if (pendingSnap.empty) {
    logger.info('scorePredictions: no hay predicciones pendientes de calificar.');
  } else {
    const drawsByDate = {};
    for (const doc of pendingSnap.docs) {
      const { date } = doc.data();
      if (!drawsByDate[date]) {
        const s = await db.collection('draws').where('date', '==', date).get();
        drawsByDate[date] = s.docs.map(d => d.data());
      }
    }

    const batch = db.batch();
    let scored = 0;
    for (const doc of pendingSnap.docs) {
      const pred = doc.data();
      const draws = drawsByDate[pred.date] || [];
      if (draws.length === 0) continue; // aun no hay sorteos de ese dia, se reintenta manana

      let hit = false, matched = null;
      for (const draw of draws) {
        if (pred.numbers.includes(draw.numero)) {
          hit = true;
          matched = `${draw.slot} ${draw.numero}`;
          break;
        }
      }
      batch.update(doc.ref, { hit, matched_draw: matched });
      scored++;
    }
    if (scored > 0) await batch.commit();
    logger.info(`scorePredictions: ${scored} predicciones calificadas.`);
  }

  // Recalcular resumen de aciertos por fuente sobre todo el historico.
  const allSnap = await db.collection('predictions').where('hit', '!=', null).get();
  const bySource = {};
  for (const doc of allSnap.docs) {
    const p = doc.data();
    if (!bySource[p.source]) bySource[p.source] = { days: 0, hits: 0, baseline_pct: p.baseline_pct, kind: p.kind };
    bySource[p.source].days++;
    if (p.hit) bySource[p.source].hits++;
  }
  const summary = {};
  for (const [source, s] of Object.entries(bySource)) {
    summary[source] = {
      ...s,
      hit_rate_pct: s.days ? Math.round((s.hits / s.days) * 1000) / 10 : 0
    };
  }
  await db.collection('predictions_summary').doc('latest').set({
    sources: summary,
    updated_at: new Date().toISOString()
  });
});
