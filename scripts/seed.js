// Script de una sola vez: carga el historico de sorteos y el log de
// predicciones ya recolectados (seed/data.csv, seed/predictions_log.csv)
// dentro de Firestore, para no tener que esperar meses a que las Cloud
// Functions vuelvan a acumular este historial desde cero.
//
// Uso (desde la carpeta scripts/, con GOOGLE_APPLICATION_CREDENTIALS
// apuntando a una service account key, o con `gcloud auth application-default
// login` ya hecho):
//   npm install
//   node seed.js

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const obj = {};
    header.forEach((h, i) => { obj[h] = cols[i] !== undefined ? cols[i] : ''; });
    return obj;
  });
}

async function commitInChunks(collection, docs, idFn, transform) {
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    for (const row of docs.slice(i, i + CHUNK)) {
      const data = transform(row);
      batch.set(db.collection(collection).doc(idFn(row)), data, { merge: true });
    }
    await batch.commit();
    console.log(`${collection}: ${Math.min(i + CHUNK, docs.length)}/${docs.length}`);
  }
}

async function seedDraws() {
  const csvPath = path.join(__dirname, '..', 'seed', 'data.csv');
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  await commitInChunks('draws', rows, r => r.draw_id, r => ({
    draw_id: r.draw_id,
    date: r.date,
    slot: r.slot,
    numero: r.numero,
    reventado: r.reventado === 'True' || r.reventado === 'true' || r.reventado === '1',
    mega_reventados: r.mega_reventados || ''
  }));
  console.log(`Listo: ${rows.length} sorteos cargados en la coleccion "draws".`);
}

async function seedPredictions() {
  const csvPath = path.join(__dirname, '..', 'seed', 'predictions_log.csv');
  if (!fs.existsSync(csvPath)) { console.log('No hay predictions_log.csv, se omite.'); return; }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  await commitInChunks('predictions', rows, r => `${r.date}_${r.source}`, r => ({
    date: r.date,
    source: r.source,
    kind: r.kind,
    numbers: r.numbers ? r.numbers.split(';') : [],
    baseline_pct: parseFloat(r.baseline_pct) || 0,
    hit: r.hit === '' ? null : (r.hit === 'True' || r.hit === 'true' || r.hit === '1'),
    matched_draw: r.matched_draw || null,
    captured_at: new Date().toISOString()
  }));
  console.log(`Listo: ${rows.length} predicciones cargadas en la coleccion "predictions".`);
}

async function computeInitialStats() {
  const { computeStats } = require('../functions/stats');
  const snap = await db.collection('draws').get();
  const allDraws = snap.docs.map(d => d.data());
  const stats = computeStats(allDraws);
  await db.collection('stats').doc('latest').set(stats);
  console.log(`Listo: stats/latest calculado sobre ${allDraws.length} sorteos.`);
}

(async () => {
  await seedDraws();
  await seedPredictions();
  await computeInitialStats();
  console.log('Semilla completa.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
