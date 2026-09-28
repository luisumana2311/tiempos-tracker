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

// Pagina: /lottery/results/nuevos-tiempos
// Publica los resultados reales (no predicciones) mucho mas rapido que
// loteriaypiramides.com/historico -- confirmado manualmente: el sorteo de
// Mediodia de un dia ya aparece aqui cuando el historico todavia no lo
// tiene. Se usa como fuente complementaria para no depender de un solo
// sitio con posible atraso de publicacion.
//
// Estructura de la tabla "Ultimos 30 sorteos" (primera <table> con
// encabezado "Fecha del Sorteo"):
//   td[0]: "28 de Septiembre 2026 - Lunes"
//   td[1]: <sup>DÍA</sup> | <sup>MIDDAY</sup> | <sup>NOCHE</sup>
//          (asi le dice yelu a Mediodia/Tarde/Noche, respectivamente)
//   td[2]: <div class="t_line1"><span><div class="lotto_no_r">NN</div>
//          <div class="lotto_no_w ...">R|-</div></span></div>
//          (si el sorteo todavia no salio, el numero es "?" / "Sortero
//          Pronto" y esa fila se ignora)
//   td[3]: <a>#24032</a>  (numero de sorteo, mismo esquema de IDs que
//          loteriaypiramides.com)
const MESES_LARGOS = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
};

const SUP_TO_SLOT = { 'DÍA': 'Mediodia', 'DIA': 'Mediodia', 'MIDDAY': 'Tarde', 'NOCHE': 'Noche' };

function parseYeluResultsHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];

  const table = $('table').filter((_, t) => $(t).find('th').first().text().trim() === 'Fecha del Sorteo').first();

  table.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 4) return;

    const fechaTxt = $(tds[0]).text().trim();
    const fm = fechaTxt.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})/);
    if (!fm) return;
    const dd = fm[1].padStart(2, '0');
    const mm = MESES_LARGOS[fm[2].toLowerCase()];
    if (!mm) return;
    const date = `${fm[3]}-${mm}-${dd}`;

    const supTxt = ($(tds[1]).find('sup').text() || '').trim().toUpperCase();
    const slot = SUP_TO_SLOT[supTxt];
    if (!slot) return; // otro juego o formato inesperado, se ignora

    const divs = $(tds[2]).find('div');
    const numeroTxt = (divs.eq(1).text() || '').trim();
    if (!/^\d{1,2}$/.test(numeroTxt)) return; // "Sortero Pronto" / "?" -> aun no sale, se ignora
    const numero = numeroTxt.padStart(2, '0');
    const flagTxt = (divs.eq(2).text() || '').trim().toUpperCase();
    const reventado = flagTxt === 'R';

    const sorteoTxt = $(tds[3]).text().trim();
    const drawIdMatch = sorteoTxt.match(/\d+/);
    if (!drawIdMatch) return;
    const draw_id = drawIdMatch[0];

    rows.push({ draw_id, date, slot, numero, reventado, mega_reventados: '' });
  });

  return rows;
}

module.exports = { parseHot30Cold30, parseNuevosTiemposHoy, parseYeluResultsHtml };
