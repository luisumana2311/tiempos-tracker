// Equivalente standalone de la funcion updateDraws: trae el historico
// reciente de sorteos y recalcula las estadisticas del dashboard.
// Pensado para correr desde GitHub Actions (ver .github/workflows/).

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

  // --- Aviso por Telegram: numeros de hoy + alertas estadisticas ---
  const today = todayCR();
  const todays = rows
    .filter(r => r.date === today)
    .sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9));

  const lines = [`🎰 <b>Nuevos Tiempos — ${today}</b>`];
  if (todays.length === 0) {
    lines.push('Todavia no hay sorteos de hoy registrados.');
  } else {
    for (const r of todays) {
      lines.push(`${r.slot}: <b>${r.numero}</b>${r.reventado ? ' 🔴 reventado' : ''}`);
    }
  }

  const alerts = [];
  if (stats.p_total < 0.05) alerts.push(`⚠️ p-value de distribucion total: ${(stats.p_total * 100).toFixed(2)}% (posible desviacion, revisar)`);
  if (stats.p_eo < 0.05) alerts.push(`⚠️ p-value par/impar: ${(stats.p_eo * 100).toFixed(2)}% (posible desviacion, revisar)`);
  if (stats.p_last < 0.05) alerts.push(`⚠️ p-value ultimo digito: ${(stats.p_last * 100).toFixed(2)}% (posible desviacion, revisar)`);
  if (alerts.length) {
    lines.push('', ...alerts);
  }

  await sendTelegram(lines.join('\n'));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
