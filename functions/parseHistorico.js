// Parser del historico de sorteos de "Nuevos Tiempos" en
// loteriaypiramides.com/costa-rica/nuevos-tiempos/historico
//
// La pagina, sin parametros, devuelve por defecto los ultimos ~10 dias
// de sorteos (3 sorteos/dia: Mediodia, Tarde, Noche). Estructura de cada
// fila de tabla (confirmada con Chrome + verificada que es HTML estatico,
// no inyectado por JS, asi que cheerio la puede leer igual):
//   td[0]: fecha "DD/mmm."
//   td[1]: numero de sorteo (id)
//   td[2]: "NN R/- NN"  -> numero, reventado(R) o no(-), mega-reventados
//   td[3]: "Sorteo: ##### - Horario"  (Horario = Mediodia/Tarde/Noche)

const cheerio = require('cheerio');

const MESES = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12'
};

function parseFecha(txt, anioRef) {
  // "27/sep." -> "YYYY-09-27" (usa anioRef, o el actual si cruza diciembre/enero se ajusta afuera)
  const m = txt.trim().toLowerCase().match(/(\d{1,2})\/([a-z]{3})/);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = MESES[m[2]];
  if (!mm) return null;
  return { dd, mm };
}

function parseHistoricoHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const now = new Date();
  const anioActual = now.getFullYear();

  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
    if (tds.length < 4) return;

    const fechaParsed = parseFecha(tds[0], anioActual);
    if (!fechaParsed) return;

    const drawIdMatch = tds[1].match(/\d+/);
    if (!drawIdMatch) return;
    const drawId = drawIdMatch[0];

    const numMatch = tds[2].match(/(\d{1,2})\s*([R-])\s*(\d{2}|xx)?/i);
    if (!numMatch) return;
    const numero = numMatch[1].padStart(2, '0');
    const reventado = numMatch[2].toUpperCase() === 'R';
    const megaReventados = (numMatch[3] && numMatch[3].toLowerCase() !== 'xx') ? numMatch[3] : '';

    const slotMatch = tds[3].match(/Mediodia|Mediod[ií]a|Tarde|Noche/i);
    let slot = slotMatch ? slotMatch[0] : '';
    if (/mediod/i.test(slot)) slot = 'Mediodia';

    // Determinar el año: si el mes es diciembre y hoy estamos en enero, es el año anterior.
    let anio = anioActual;
    if (fechaParsed.mm === '12' && now.getMonth() === 0) anio -= 1;
    const date = `${anio}-${fechaParsed.mm}-${fechaParsed.dd}`;

    rows.push({ draw_id: drawId, date, slot, numero, reventado, mega_reventados: megaReventados });
  });

  return rows;
}

module.exports = { parseHistoricoHtml };
