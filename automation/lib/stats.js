// Calculo de las estadisticas del dashboard principal a partir de todos
// los sorteos guardados en Firestore. Equivalente en Node de los calculos
// que originalmente se hicieron en Python/scipy.

const { chiSquareGoodnessOfFit, round2, round4 } = require('./chisquare');

function computeStats(draws) {
  // draws: [{draw_id, date, slot, numero, reventado, mega_reventados}]
  const sorted = [...draws].sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const n = sorted.length;
  const half = Math.floor(n / 2);
  const half1 = sorted.slice(0, half);
  const half2 = sorted.slice(half);

  const freq = new Array(100).fill(0);
  const freq1 = new Array(100).fill(0);
  const freq2 = new Array(100).fill(0);
  const freqLastDigit = new Array(10).fill(0);
  const freqFirstDigit = new Array(10).fill(0);
  let even = 0, odd = 0, red = 0;
  const bySlot = {};
  let prevNum = null;
  let reps = 0;

  for (const d of sorted) {
    const num = parseInt(d.numero, 10);
    freq[num]++;
    freqLastDigit[num % 10]++;
    freqFirstDigit[Math.floor(num / 10)]++;
    if (num % 2 === 0) even++; else odd++;
    if (d.reventado) red++;
    if (!bySlot[d.slot]) bySlot[d.slot] = new Array(100).fill(0);
    bySlot[d.slot][num]++;
    if (prevNum !== null && prevNum === num) reps++;
    prevNum = num;
  }
  for (const d of half1) freq1[parseInt(d.numero, 10)]++;
  for (const d of half2) freq2[parseInt(d.numero, 10)]++;

  const totalTest = chiSquareGoodnessOfFit(freq);
  const lastDigitTest = chiSquareGoodnessOfFit(freqLastDigit);
  const firstDigitTest = chiSquareGoodnessOfFit(freqFirstDigit);

  // Prueba binomial aproximada (normal) para par/impar 50/50.
  const pEo = binomialTwoSidedPValue(even, even + odd, 0.5);

  const slotStats = {};
  for (const [slot, arr] of Object.entries(bySlot)) {
    const t = chiSquareGoodnessOfFit(arr);
    slotStats[slot] = { n: arr.reduce((s, v) => s + v, 0), chi2: t.chi2, p: t.p };
  }

  // Firestore no permite arrays anidados (array dentro de array), asi que
  // se guardan como objetos {num, count} en vez de pares [num, count].
  const hot = freq.map((c, num) => ({ num, count: c })).sort((a, b) => b.count - a.count).slice(0, 8);
  const cold = freq.map((c, num) => ({ num, count: c })).sort((a, b) => a.count - b.count).slice(0, 8);

  return {
    n,
    date_from: sorted[0]?.date || null,
    date_to: sorted[n - 1]?.date || null,
    freq, freq1, freq2,
    half1_n: half1.length, half2_n: half2.length,
    chi2_total: totalTest.chi2, p_total: totalTest.p,
    chi2_last: lastDigitTest.chi2, p_last: lastDigitTest.p,
    chi2_first: firstDigitTest.chi2, p_first: firstDigitTest.p,
    even, odd, p_eo: round4(pEo),
    red, red_rate: round4(n ? red / n : 0),
    reps, reps_rate: round4(n ? reps / n : 0),
    slot_stats: slotStats,
    hot, cold,
    updated_at: new Date().toISOString()
  };
}

// p-value bilateral aproximado por normal para una proporcion observada vs p0.
function binomialTwoSidedPValue(successes, trials, p0) {
  if (trials === 0) return 1;
  const mean = trials * p0;
  const sd = Math.sqrt(trials * p0 * (1 - p0));
  if (sd === 0) return 1;
  const z = Math.abs(successes - mean) / sd;
  return 2 * (1 - normalCdf(z));
}

function normalCdf(z) {
  // Aproximacion de Abramowitz-Stegun para la CDF normal estandar.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return 1 - p;
}

module.exports = { computeStats };
