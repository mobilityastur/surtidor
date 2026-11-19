// Surtidor · descarga los precios de carburantes del Ministerio y genera los JSON de data/.
//   node scripts/update.mjs              → descarga del servicio REST oficial
//   node scripts/update.mjs fichero.json → usa un fichero local (pruebas)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const FUENTES = [
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
  'https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/EstacionesTerrestres/',
];
const UA = 'Mozilla/5.0 (Surtidor; github.com/mobilityastur/surtidor)';

// Productos: clave interna → nombre del campo del Ministerio (sin "Precio", sin tildes, en minúsculas)
export const PRODUCTOS = {
  g95: 'gasolina 95 e5',
  die: 'gasoleo a',
  g98: 'gasolina 98 e5',
  diep: 'gasoleo premium',
  glp: 'gases licuados del petroleo',
  gnc: 'gas natural comprimido',
  g95p: 'gasolina 95 e5 premium',
  e10: 'gasolina 95 e10',
  g98e10: 'gasolina 98 e10',
  gnl: 'gas natural licuado',
  h2: 'hidrogeno',
  adb: 'adblue',
  hvo: 'diesel renovable',
  gren: 'gasolina renovable',
};
// Productos con estadísticas por provincia (los botones del mapa)
const PRINCIPALES = ['g95', 'die', 'g98', 'diep', 'glp', 'gnc'];
// Sin estos territorios en la referencia nacional: otra fiscalidad (IGIC, IPSI)
const FUERA_REFERENCIA = new Set(['35', '38', '51', '52']);
const DIAS_HISTORICO = 120;

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = s => { if (s == null || s === '') return null; const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; };
const r3 = v => Math.round(v * 1000) / 1000;

async function descargar() {
  const errores = [];
  for (const url of FUENTES) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return JSON.parse(await res.text());
      } catch (e) {
        errores.push(`fetch ${url} (${intento}): ${e.cause?.code || e.message}`);
      }
      // curl usa el almacén de certificados del sistema: sirve de respaldo si falla la verificación TLS de Node
      try {
        const txt = execFileSync('curl', ['-sS', '--fail', '-m', '150', '-H', 'Accept: application/json', '-A', UA, url], { maxBuffer: 256 * 1024 * 1024 }).toString();
        return JSON.parse(txt);
      } catch (e) {
        errores.push(`curl ${url} (${intento}): ${String(e.message).split('\n')[0]}`);
      }
      await new Promise(r => setTimeout(r, 5000 * intento));
    }
  }
  throw new Error('No se pudo descargar:\n' + errores.join('\n'));
}

function mediana(a) {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function precioValido(prod, v) {
  if (v == null || v <= 0) return false;
  if (prod === 'h2' || prod === 'gnc' || prod === 'gnl') return v < 30;
  return v >= 0.4 && v <= 4;
}

function estadisticas(lista) {
  if (!lista.length) return null;
  let min = lista[0];
  for (const x of lista) if (x.v < min.v) min = x;
  const vs = lista.map(x => x.v);
  return { n: lista.length, med: r3(mediana(vs)), min: r3(min.v), max: r3(Math.max(...vs)), minId: min.id };
}

async function main() {
  const local = process.argv[2];
  const bruto = local ? JSON.parse(await readFile(local, 'utf8')) : await descargar();
  const lista = bruto.ListaEESSPrecio;
  if (!Array.isArray(lista) || lista.length < 1000) throw new Error(`Respuesta inesperada: ${lista?.length ?? 'sin lista'} estaciones`);

  // Relación entre los campos de precio de la respuesta y nuestros productos
  const campos = {};
  for (const k of Object.keys(lista[0])) {
    if (!/^precio /i.test(k)) continue;
    const n = norm(k.replace(/^precio /i, ''));
    const prod = Object.keys(PRODUCTOS).find(p => PRODUCTOS[p] === n);
    if (prod) campos[prod] = k;
  }
  const sinCampo = PRINCIPALES.filter(p => !campos[p]);
  if (sinCampo.length) console.warn('Aviso: no aparecen los campos de', sinCampo.join(', '));

  const porProv = {};
  for (const e of lista) {
    const prov = String(e.IDProvincia || '').padStart(2, '0');
    let la = num(e.Latitud), lo = num(e['Longitud (WGS84)']);
    if (!prov || prov === '00') continue;
    // Algunas gasolineras llegan con coordenadas 0,0 o con latitud y longitud cambiadas
    const enEspana = (a, b) => a != null && b != null && a >= 27.4 && a <= 44 && b >= -18.5 && b <= 4.6;
    if (!enEspana(la, lo) && enEspana(lo, la)) [la, lo] = [lo, la];
    if (!enEspana(la, lo)) la = lo = null;
    const p = {};
    for (const [prod, campo] of Object.entries(campos)) {
      const v = num(e[campo]);
      if (precioValido(prod, v)) p[prod] = r3(v);
    }
    if (!Object.keys(p).length) continue;
    const est = {
      id: String(e.IDEESS),
      r: (e['Rótulo'] || '').trim(),
      d: (e['Dirección'] || '').trim(),
      l: (e.Localidad || e.Municipio || '').trim(),
      cp: e['C.P.'] || '',
      h: (e.Horario || '').trim(),
      la: la == null ? null : Math.round(la * 1e5) / 1e5,
      lo: lo == null ? null : Math.round(lo * 1e5) / 1e5,
      p,
    };
    if (e['Tipo Venta'] === 'R') est.res = 1; // venta restringida a socios
    (porProv[prov] ||= []).push(est);
  }

  const fecha = bruto.Fecha || '';
  const resumen = { fecha, generado: new Date().toISOString(), nacional: {}, provincias: {} };
  const todasRef = Object.fromEntries(PRINCIPALES.map(p => [p, []]));

  // Precios de la actualización anterior, para saber qué ha cambiado
  let fechaAnterior = null;
  try { fechaAnterior = JSON.parse(await readFile('data/resumen.json', 'utf8')).fecha; } catch {}
  const cambios = {};

  await mkdir('data/prov', { recursive: true });
  for (const [prov, ests] of Object.entries(porProv)) {
    let previos = {};
    try { previos = Object.fromEntries(JSON.parse(await readFile(`data/prov/${prov}.json`, 'utf8')).e.map(e => [e.id, e.p])); } catch {}
    for (const e of ests) {
      const ant = previos[e.id];
      if (!ant) continue;
      const c = {};
      for (const prod of new Set([...Object.keys(ant), ...Object.keys(e.p)])) {
        if (ant[prod] !== e.p[prod]) c[prod] = [ant[prod] ?? null, e.p[prod] ?? null];
      }
      if (Object.keys(c).length) cambios[e.id] = { prov, c };
    }
    ests.sort((a, b) => a.l.localeCompare(b.l, 'es') || a.id.localeCompare(b.id));
    const info = { n: ests.length };
    for (const prod of PRINCIPALES) {
      const vals = ests.filter(e => !e.res && e.p[prod] != null).map(e => ({ v: e.p[prod], id: e.id }));
      const s = estadisticas(vals);
      if (s) info[prod] = s;
      if (!FUERA_REFERENCIA.has(prov)) todasRef[prod].push(...vals);
    }
    resumen.provincias[prov] = info;
    await escribirSiCambia(`data/prov/${prov}.json`, JSON.stringify({ prov, e: ests }));
  }
  for (const prod of PRINCIPALES) {
    const s = estadisticas(todasRef[prod]);
    if (s) resumen.nacional[prod] = s;
  }
  await writeFile('data/resumen.json', JSON.stringify(resumen));
  // Gasolineras cuyo precio ha cambiado respecto a la actualización anterior: { id: { prov, c: { prod: [antes, ahora] } } }
  await writeFile('data/cambios.json', JSON.stringify({ fecha, anterior: fechaAnterior, n: Object.keys(cambios).length, cambios }));

  // Histórico diario de medianas (se sobrescribe el día en curso)
  let hist = { dias: {} };
  try { hist = JSON.parse(await readFile('data/historico.json', 'utf8')); } catch {}
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
  const dia = { nac: {}, p: {} };
  for (const prod of PRINCIPALES) if (resumen.nacional[prod]) dia.nac[prod] = resumen.nacional[prod].med;
  for (const [prov, info] of Object.entries(resumen.provincias)) {
    dia.p[prov] = {};
    for (const prod of PRINCIPALES) if (info[prod]) dia.p[prov][prod] = info[prod].med;
  }
  hist.dias[hoy] = dia;
  const claves = Object.keys(hist.dias).sort().slice(-DIAS_HISTORICO);
  hist.dias = Object.fromEntries(claves.map(k => [k, hist.dias[k]]));
  await writeFile('data/historico.json', JSON.stringify(hist));

  const n = Object.values(porProv).reduce((a, b) => a + b.length, 0);
  console.log(`${fecha}: ${n} estaciones en ${Object.keys(porProv).length} provincias. ${Object.keys(cambios).length} con cambios. Mediana 95: ${resumen.nacional.g95?.med} · diésel: ${resumen.nacional.die?.med}`);
}

async function escribirSiCambia(ruta, txt) {
  try { if ((await readFile(ruta, 'utf8')) === txt) return; } catch {}
  await writeFile(ruta, txt);
}

main().catch(e => { console.error(e.message); process.exit(1); });
