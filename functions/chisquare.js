// Implementacion numerica de la funcion gamma incompleta regularizada,
// usada para calcular el p-value de una prueba chi-cuadrado sin depender
// de librerias externas (equivalente a scipy.stats.chi2.sf en Python).
//
// Referencia: Numerical Recipes (algoritmo gammp/gammq), aproximacion de
// Lanczos para log-gamma.

const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];

function logGamma(x) {
  if (x < 0.5) {
    // Reflexion: Gamma(x)*Gamma(1-x) = pi / sin(pi x)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS_COEF[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += LANCZOS_COEF[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// P(a, x): gamma incompleta inferior regularizada, via serie de potencias.
// Valida y de convergencia rapida cuando x < a + 1.
function gammaincLowerSeries(a, x) {
  if (x <= 0) return 0;
  let sum = 1 / a;
  let term = sum;
  let n = a;
  for (let i = 0; i < 500; i++) {
    n += 1;
    term *= x / n;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

// Q(a, x): gamma incompleta superior regularizada, via fraccion continua
// (Lentz). Valida y de convergencia rapida cuando x >= a + 1.
function gammaincUpperContinuedFraction(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

// Q(a, x) = 1 - P(a, x): cola superior regularizada, que es lo que
// necesitamos para un p-value de chi-cuadrado (P(X >= observado)).
function gammaincUpperRegularized(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) {
    return 1 - gammaincLowerSeries(a, x);
  }
  return gammaincUpperContinuedFraction(a, x);
}

// p-value de una prueba chi-cuadrado: P(X_df >= chi2stat)
function chi2SF(chi2stat, df) {
  if (chi2stat <= 0) return 1;
  return gammaincUpperRegularized(df / 2, chi2stat / 2);
}

// Prueba de bondad de ajuste: dado un arreglo de frecuencias observadas,
// asume distribucion uniforme esperada y devuelve { chi2, df, p }.
function chiSquareGoodnessOfFit(observedCounts) {
  const k = observedCounts.length;
  const total = observedCounts.reduce((s, v) => s + v, 0);
  const expected = total / k;
  let chi2 = 0;
  for (const o of observedCounts) {
    chi2 += ((o - expected) ** 2) / expected;
  }
  const df = k - 1;
  return { chi2: round2(chi2), df, p: round4(chi2SF(chi2, df)) };
}

function round2(x) { return Math.round(x * 100) / 100; }
function round4(x) { return Math.round(x * 10000) / 10000; }

module.exports = { chi2SF, chiSquareGoodnessOfFit, round2, round4 };
