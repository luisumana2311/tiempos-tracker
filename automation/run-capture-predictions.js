// Equivalente standalone de capturePredictions: guarda las predicciones
// del dia de yelu.cr antes de que salgan los sorteos.

const fetch = require('node-fetch');
const { db } = require('./firebaseAdmin');
const { parseHot30Cold30, parseNuevosTiemposHoy } = require('./lib/parseYelu');

const YELU_HOY_URL = 'https://www.yelu.cr/lottery/jps-numeros-suerte-hoy';
const YELU_HOTCOLD_URL = 'https://www.yelu.cr/lottery/hot-cold-numbers/nuevos-tiempos';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function todayCR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function baselinePct(k) {
  const p = 1 - Math.pow(1 - k / 100, 3);
  return Math.round(p * 1000) / 10;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function main() {
  const date = todayCR();
  const [hoyHtml, hotColdHtml] = await Promise.all([fetchHtml(YELU_HOY_URL), fetchHtml(YELU_HOTCOLD_URL)]);

  const { luckyNumbers, hot7 } = parseNuevosTiemposHoy(hoyHtml);
  const { hot30 } = parseHot30Cold30(hotColdHtml);

  const entries = [];
  if (luckyNumbers.length) entries.push({ source: 'yelu_lucky', kind: `${luckyNumbers.length} numeros del dia`, numbers: luckyNumbers, baseline_pct: baselinePct(luckyNumbers.length) });
  if (hot7.length) entries.push({ source: 'yelu_hot7', kind: '7 calientes (ultimos 200 sorteos)', numbers: hot7, baseline_pct: baselinePct(hot7.length) });
  if (hot30.length) entries.push({ source: 'yelu_hot30', kind: '30 calientes (10-150 sorteos)', numbers: hot30, baseline_pct: baselinePct(hot30.length) });

  if (entries.length === 0) {
    console.warn('capturePredictions: no se pudo extraer ninguna prediccion hoy (posible cambio de estructura en yelu.cr).');
    return;
  }

  const firestore = db();
  const batch = firestore.batch();
  for (const e of entries) {
    const id = `${date}_${e.source}`;
    batch.set(firestore.collection('predictions').doc(id), {
      date, source: e.source, kind: e.kind, numbers: e.numbers,
      baseline_pct: e.baseline_pct, hit: null, matched_draw: null,
      captured_at: new Date().toISOString()
    }, { merge: true });
  }
  await batch.commit();
  console.log(`capturePredictions: ${entries.length} predicciones guardadas para ${date}.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
