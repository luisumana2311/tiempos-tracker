// Equivalente standalone de la funcion updateDraws: trae el historico
// reciente de sorteos y recalcula las estadisticas del dashboard.
// Pensado para correr desde GitHub Actions (ver .github/workflows/).

const fetch = require('node-fetch');
const { db } = require('./firebaseAdmin');
const { parseHistoricoHtml } = require('./lib/parseHistorico');
const { computeStats } = require('./lib/stats');

const HISTORICO_URL = 'https://loteriaypiramides.com/costa-rica/nuevos-tiempos/historico';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
