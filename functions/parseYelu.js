// Parsers de yelu.cr, sitio que publica "numeros calientes/frios" para
// Nuevos Tiempos. Selectores confirmados manualmente con Chrome DevTools
// (ver notas de la sesion) contra el HTML server-renderizado (estatico,
// por eso cheerio funciona igual que el DOM vivo).

const cheerio = require('cheerio');

// Pagina: /hot-cold-numbers/nuevos-tiempos
// Estructura: dos <table>, la primera = 30 numeros calientes, la segunda
// = 30 numeros frios. Cada fila: primer <td> contiene un <div> con el
// numero; las siguientes 5 <td> son conteos en distintas ventanas de sorteos.
function parseHot30Cold30(html) {
  const $ = cheerio.load(html);
  const tables = $('table');
  const readTable = (idx) => {
    const t = tables.eq(idx);
    return t.find('tbody tr td:first-child div').map((_, el) => $(el).text().trim()).get()
      .filter(v => /^\d{1,2}$/.test(v))
      .map(v => v.padStart(2, '0'));
  };
  return {
    hot30: readTable(0),
    cold30: readTable(1)
  };
}

// Pagina: /jps-numeros-suerte-hoy
// Contiene predicciones para varios juegos (JPS Lotto, Nuevos Tiempos,
// Tres Monazos, El Premio Acumulado) en la misma pagina con clases CSS
// identicas, asi que hay que delimitar por encabezados <h2>.
function parseNuevosTiemposHoy(html) {
  const $ = cheerio.load(html);
  const heads = $('h1,h2,h3,h4,h5');

  const findHeading = (text) => heads.filter((_, el) => $(el).text().trim() === text).first();

  const hPredNT = findHeading('Predicción Nuevos Tiempos Hoy');
  const hFriosNT = findHeading('Números Fríos y Calientes de Nuevos Tiempos');
  const hMonazos = findHeading('Predicción Tres Monazos Hoy');

  let luckyNumbers = [];
  if (hPredNT.length && hFriosNT.length) {
    luckyNumbers = hPredNT.nextUntil(hFriosNT.length ? hFriosNT[0] : undefined)
      .find('[class*="lotto_no"]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(v => /^\d{1,2}$/.test(v))
      .map(v => v.padStart(2, '0'));
  }

  let hot7 = [];
  let cold7 = [];
  if (hFriosNT.length) {
    const until = hMonazos.length ? hMonazos[0] : undefined;
    const scope = hFriosNT.nextUntil(until);
    hot7 = scope.find('.lotto_no_hot').map((_, el) => $(el).text().trim()).get()
      .filter(v => /^\d{1,2}$/.test(v)).map(v => v.padStart(2, '0'));
    cold7 = scope.find('.lotto_no_cold').map((_, el) => $(el).text().trim()).get()
      .filter(v => /^\d{1,2}$/.test(v)).map(v => v.padStart(2, '0'));
  }

  return { luckyNumbers, hot7, cold7 };
}

module.exports = { parseHot30Cold30, parseNuevosTiemposHoy };
