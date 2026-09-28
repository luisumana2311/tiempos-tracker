// Equivalente standalone de la funcion updateDraws: trae el historico
// reciente de sorteos y recalcula las estadisticas del dashboard.
// Pensado para correr varias veces al dia (una vez despues de cada
// sorteo) desde GitHub Actions (ver .github/workflows/), avisando por
// Telegram solo el numero NUEVO que salio, sin repetir los anteriores.

const fetch = require('node-fetch');
const { db } = require('./firebaseAdmin');
const { parseHistoricoHtml } = require('./lib/parseHistorico');
const { computeStats } = require('./lib/stats');
const { sendTelegram } = require('./telegram');

const HISTORICO_URL = 'https://loteriaypiramides.com/costa-rica/nuevos-tiempos/historico';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function todayCR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const SLOT_ORDER = { Mediodia: 0, Tarde: 1, Noche: 2 };

async function main() {
  const res = await fetch(HISTORICO_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${HISTORICO_URL} -> ${res.status}`);
  const html = await res.text();

  const rows = parseHistoricoHtml(html);
  console.log(`updateDraws: ${rows.length} filas parseadas del historico`);
  if (rows.length === 0) {
    console.warn('updateDraws: no se parseo ninguna fila, no se actualiza nada.');
    return;
  }

  const firestore = db();
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = firestore.batch();
    for (const row of rows.slice(i, i + CHUNK)) {
      batch.set(firestore.collection('draws').doc(row.draw_id), row, { merge: true });
    }
    await batch.commit();
  }

  const snap = await firestore.collection('draws').get();
  const allDraws = snap.docs.map(d => d.data());
  const stats = computeStats(allDraws);
  await firestore.collection('stats').doc('latest').set(stats);

  console.log(`updateDraws: stats recalculadas sobre ${allDraws.length} sorteos totales.`);

  // --- Aviso por Telegram: SOLO el/los sorteo(s) nuevo(s) de hoy que no se hayan avisado todavia ---
  const today = todayCR();
  const todays = rows
    .filter(r => r.date === today)
    .sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9));

  if (todays.length === 0) {
    console.log('updateDraws: todavia no hay sorteos de hoy, no se avisa nada.');
    return;
  }

  const notifyRef = firestore.collection('notify_state').doc(today);
  const notifySnap = await notifyRef.get();
  const alreadyNotified = notifySnap.exists ? (notifySnap.data().slots || []) : [];

  const newOnes = todays.filter(r => !alreadyNotified.includes(r.slot));
  if (newOnes.length === 0) {
    console.log('updateDraws: no hay sorteos nuevos desde el ultimo aviso, no se manda Telegram.');
    return;
  }

  const lines = [`🎰 <b>Nuevos Tiempos — ${today}</b>`];
  for (const r of newOnes) {
    lines.push(`${r.slot}: <b>${r.numero}</b>${r.reventado ? ' 🔴 reventado' : ''}`);
  }

  // Las alertas estadisticas solo se mandan una vez al dia, cuando ya salio
  // el sorteo de la Noche (para no repetir el mismo aviso 3 veces al dia).
  const allSlotsIn = new Set([...alreadyNotified, ...newOnes.map(r => r.slot)]);
  if (allSlotsIn.has('Noche')) {
    const alerts = [];
    if (stats.p_total < 0.05) alerts.push(`⚠️ p-value de distribucion total: ${(stats.p_total * 100).toFixed(2)}% (posible desviacion, revisar)`);
    if (stats.p_eo < 0.05) alerts.push(`⚠️ p-value par/impar: ${(stats.p_eo * 100).toFixed(2)}% (posible desviacion, revisar)`);
    if (stats.p_last < 0.05) alerts.push(`⚠️ p-value ultimo digito: ${(stats.p_last * 100).toFixed(2)}% (posible desviacion, revisar)`);
    if (alerts.length) lines.push('', ...alerts);
  }

  await sendTelegram(lines.join('\n'));
  await notifyRef.set({ slots: [...allSlotsIn] });
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
