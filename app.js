'use strict';
// Surtidor · precios de carburantes en España por provincia y gasolinera

const PRODS = [
  ['g95', 'Gasolina 95'], ['die', 'Diésel'], ['g98', 'Gasolina 98'],
  ['diep', 'Diésel premium'], ['glp', 'GLP'], ['gnc', 'GNC'],
];
// Nombres oficiales (los del Ministerio), en el orden en que se muestran en la ficha de una gasolinera
const OFICIAL = [
  ['g95', 'Gasolina 95 E5'], ['g95p', 'Gasolina 95 E5 Premium'], ['e10', 'Gasolina 95 E10'],
  ['g98', 'Gasolina 98 E5'], ['g98e10', 'Gasolina 98 E10'], ['gren', 'Gasolina renovable'],
  ['die', 'Gasóleo A'], ['diep', 'Gasóleo Premium'], ['hvo', 'Diésel renovable'],
  ['glp', 'GLP (autogás)'], ['gnc', 'Gas natural comprimido'], ['gnl', 'Gas natural licuado'],
  ['h2', 'Hidrógeno'], ['adb', 'AdBlue'],
];
const POR_KG = new Set(['gnc', 'gnl', 'h2']);
const FUERA = new Set(['35', '38', '51', '52']);
const PROV = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila', '06': 'Badajoz', '07': 'Illes Balears',
  '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba',
  '15': 'A Coruña', '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa', '21': 'Huelva',
  '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida', '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga',
  '30': 'Murcia', '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra',
  '37': 'Salamanca', '38': 'S. C. de Tenerife', '39': 'Cantabria', '40': 'Segovia', '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona',
  '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza',
  '51': 'Ceuta', '52': 'Melilla',
};
// Escala divergente en céntimos respecto a la referencia: de más barata (verde azulado) a más cara (coral)
const UMBRALES = [-4.5, -2.5, -0.8, 0.8, 2.5, 4.5];
const oscuro = matchMedia('(prefers-color-scheme: dark)');
const COLORES = () => ['#0F6E56', '#1D9E75', '#5DCAA5', oscuro.matches ? '#4A4945' : '#D3D1C7', '#F0997B', '#D85A30', '#993C1D'];
const TEXTO_SOBRE = ['#E1F5EE', '#04342C', '#04342C', oscuro.matches ? '#ECEDEF' : '#2C2C2A', '#4A1B0C', '#FAECE7', '#FAECE7'];

const $ = id => document.getElementById(id);
const leer = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const st = {
  prod: leer('surtidor.prod', 'g95'),
  modo: 'med',
  sel: null,
  resumen: null, geo: null, hist: null,
  provs: {},          // ficheros de provincia ya descargados
  vista: 'inicio',
  provActual: null, mostrar: 20,
  radio: 10, pos: null,
};
if (!PRODS.some(p => p[0] === st.prod)) st.prod = 'g95';

// ---------- utilidades ----------
const eur = (v, d = 3) => v == null ? '—' : v.toFixed(d).replace('.', ',');
const cts = d => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(1).replace('.', ',');
const bin = d => { let i = 0; while (i < UMBRALES.length && d >= UMBRALES[i]) i++; return i; };
const color = d => COLORES()[bin(d)];
const unidad = p => POR_KG.has(p) ? '€/kg' : '€/l';
const nomProd = p => PRODS.find(x => x[0] === p)?.[1] || p;
function mediana(a) { const s = [...a].sort((x, y) => x - y), n = s.length; if (!n) return null; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function claseDif(d) { return d <= -0.8 ? 'bajo' : d >= 0.8 ? 'alto' : 'igual'; }
function textoDif(d) { return Math.abs(d) < 0.05 ? 'en la media' : `${cts(d)} cts`; }
const PEQ = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'a', 'en', 'por', 's/n']);
function tc(s) {
  return (s || '').toLowerCase().replace(/(^|[\s\-/(.,])([\p{L}\d])/gu, (m, a, b) => a + b.toUpperCase())
    .split(' ').map((w, i) => i && PEQ.has(w.toLowerCase()) ? w.toLowerCase() : w).join(' ');
}
function distKm(a, b) {
  const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Insignia de marca: color y abreviatura (solo para reconocerla de un vistazo)
const MARCAS = [
  ['REPSOL', '#E8611A', 'REP'], ['CEPSA', '#D3222A', 'CEP'], ['MOEVE', '#0A8F7A', 'MOE'], ['GALP', '#EE6A22', 'GALP'],
  ['SHELL', '#E9B800', 'SH'], ['PETRONOR', '#C8102E', 'PNR'], ['BALLENOIL', '#1C64B4', 'BAL'], ['PLENOIL', '#0098D8', 'PLE'],
  ['PETROPRIX', '#D6006F', 'PPX'], ['CARREFOUR', '#1E4FA0', 'CRF'], ['ALCAMPO', '#E2001A', 'ALC'], ['EROSKI', '#D7141A', 'ERO'],
  ['AVIA', '#D8232A', 'AVIA'], ['DISA', '#E30613', 'DISA'], ['MEROIL', '#003C7E', 'MER'], ['BONAREA', '#7A9A01', 'BON'],
  ['Q8', '#00539B', 'Q8'], ['ESCLATOIL', '#E4002B', 'ESC'], ['COSTCO', '#005DAA', 'COS'], ['GASEXPRESS', '#F39200', 'GEX'],
];
function marca(r) {
  const R = (r || '').toUpperCase();
  if (!R || /^SIN R[OÓ]TULO/.test(R) || R === 'NO TIENE') return { bg: oscuro.matches ? '#3A3F48' : '#9496A0', ab: '—', nombre: 'Sin marca' };
  if (/^(BP|B\.P\.)(\s|$)/.test(R)) return { bg: '#009B3A', ab: 'bp', nombre: 'BP' };
  for (const [k, bg, ab] of MARCAS) if (R.includes(k)) return { bg, ab, nombre: tc(r) };
  let h = 0; for (const c of R) h = (h * 31 + c.charCodeAt(0)) % 360;
  const ab = R.replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3) || R.slice(0, 3);
  return { bg: `hsl(${h} 38% 42%)`, ab, nombre: tc(r) };
}
const insignia = r => { const m = marca(r); return `<span class="marca" style="background:${m.bg}">${m.ab}</span>`; };

// ---------- datos ----------
async function json(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function cargar() {
  $('hora').textContent = 'Cargando…';
  try {
    const [res, geo, hist] = await Promise.all([
      json('data/resumen.json'),
      st.geo ? st.geo : json('data/provincias.geojson'),
      json('data/historico.json').catch(() => ({ dias: {} })),
    ]);
    st.resumen = res; st.geo = geo; st.hist = hist; st.provs = {};
    const m = /(\d{2})\/(\d{2})\/\d{4} (\d{2}):(\d{2})/.exec(res.fecha || '');
    $('hora').textContent = m ? `Datos de las ${m[3]}:${m[4]}` : 'Actualizado';
  } catch (e) {
    console.error(e);
    $('hora').textContent = 'Sin conexión';
    if (!st.resumen) { $('ref-val').textContent = 'No hay datos'; return; }
  }
  ruta();
}
async function provincia(c) {
  if (!st.provs[c]) st.provs[c] = json(`data/prov/${c}.json`).then(d => d.e).catch(e => { delete st.provs[c]; throw e; });
  return st.provs[c];
}

// Valor de cada provincia y referencia según el modo
function valores() {
  const P = st.resumen.provincias, out = {};
  for (const [c, info] of Object.entries(P)) {
    const s = info[st.prod];
    if (s) out[c] = st.modo === 'med' ? s.med : s.min;
  }
  let ref;
  if (st.modo === 'med') ref = st.resumen.nacional[st.prod]?.med;
  else ref = mediana(Object.entries(out).filter(([c]) => !FUERA.has(c)).map(([, v]) => v));
  return { out, ref };
}

// ---------- chips ----------
function pintarChips() {
  const P = st.resumen?.provincias || {};
  const hay = p => !st.resumen || Object.values(P).some(i => i[p]);
  $('chips').innerHTML = PRODS.filter(([p]) => hay(p))
    .map(([p, n]) => `<button class="chip${p === st.prod ? ' on' : ''}" data-p="${p}">${n}</button>`).join('');
}
$('chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  st.prod = b.dataset.p; guardar('surtidor.prod', st.prod); st.mostrar = 20;
  ruta();
});

// ---------- mapa de España (SVG) ----------
const K = 100, COS = Math.cos(40 * Math.PI / 180);
const CANARIAS = new Set(['35', '38']);
const DESPL_CAN = [7.0, 7.15]; // traslado de Canarias al recuadro (grados de lon, lat)
function proy(lon, lat, c) {
  if (CANARIAS.has(c)) { lon += DESPL_CAN[0]; lat += DESPL_CAN[1]; }
  return [(lon + 11.6) * COS * K, (44.2 - lat) * K];
}
function rutaSVG(geom, c) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  let d = '';
  for (const poly of polys) for (const ring of poly) {
    d += ring.map((pt, i) => { const [x, y] = proy(pt[0], pt[1], c); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('') + 'Z';
  }
  return d;
}
function centro(geom, c) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  const ring = polys.map(p => p[0]).sort((a, b) => b.length - a.length)[0];
  let x = 0, y = 0; for (const pt of ring) { const q = proy(pt[0], pt[1], c); x += q[0]; y += q[1]; }
  return [x / ring.length, y / ring.length];
}
let svgListo = false;
function construirMapa() {
  const W = (16.4 * COS * K), H = (44.2 - 34.4) * K;
  const [cx0, cy0] = proy(-18.3, 29.5, '35'), [cx1, cy1] = proy(-13.3, 27.55, '35');
  let h = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Mapa de España por provincias">`;
  h += `<rect class="marco" x="${(cx0 - 14).toFixed(0)}" y="${(cy0 - 14).toFixed(0)}" width="${(cx1 - cx0 + 28).toFixed(0)}" height="${(cy1 - cy0 + 28).toFixed(0)}" rx="10"/>`;
  h += `<text class="rot" x="${(cx0 - 2).toFixed(0)}" y="${(cy0 + 30).toFixed(0)}" style="font-size:34px">Canarias</text>`;
  for (const f of st.geo.features) {
    const c = f.properties.c;
    h += `<path class="prov sin" data-c="${c}" d="${rutaSVG(f.geometry, c)}"><title>${PROV[c]}</title></path>`;
    if (c === '51' || c === '52') {
      const [x, y] = centro(f.geometry, c);
      h += `<circle class="prov sin" data-c="${c}" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="13"><title>${PROV[c]}</title></circle>`;
    }
  }
  h += `<g id="etiquetas"></g></svg>`;
  $('mapa-es').innerHTML = h;
  $('mapa-es').addEventListener('click', e => {
    const p = e.target.closest('.prov'); if (!p) return;
    st.sel = p.dataset.c; pintarInicio();
    $('ficha').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  svgListo = true;
}

function pintarInicio() {
  if (!st.resumen) return;
  if (!svgListo) construirMapa();
  const { out, ref } = valores();
  const nac = st.resumen.nacional[st.prod];
  const u = unidad(st.prod);
  document.querySelectorAll('#modo button').forEach(b => b.classList.toggle('on', b.dataset.m === st.modo));

  if (st.modo === 'med') {
    $('ref-etq').textContent = `${nomProd(st.prod)} · precio típico en España`;
    $('ref-val').innerHTML = `${eur(nac?.med)}<small>${u}</small>`;
    $('ref-pie').textContent = nac ? `Mediana de ${nac.n.toLocaleString('es')} gasolineras (península y Baleares)` : 'Sin datos';
  } else {
    const cMin = Object.keys(out).filter(c => !FUERA.has(c)).sort((a, b) => out[a] - out[b])[0];
    $('ref-etq').textContent = `${nomProd(st.prod)} · la más barata de la península y Baleares`;
    $('ref-val').innerHTML = `${eur(nac?.min)}<small>${u}</small>`;
    $('ref-pie').textContent = cMin ? `En ${PROV[cMin]}. El mapa colorea la más barata de cada provincia.` : '';
  }

  document.querySelectorAll('#mapa-es .prov').forEach(el => {
    const c = el.dataset.c, v = out[c];
    if (v == null || ref == null) { el.style.fill = ''; el.classList.add('sin'); }
    else { el.classList.remove('sin'); el.style.fill = color((v - ref) * 100); }
    el.classList.toggle('sel', c === st.sel);
  });
  // los seleccionados, encima
  document.querySelectorAll('#mapa-es .prov.sel').forEach(el => el.parentNode.insertBefore(el, $('etiquetas')));

  $('barra').innerHTML = COLORES().map(c => `<span style="background:${c}"></span>`).join('');

  // rankings
  const orden = Object.keys(out).filter(c => !FUERA.has(c)).sort((a, b) => out[a] - out[b]);
  const fila = c => `<li><a href="#/p/${c}"><span class="bola" style="background:${color((out[c] - ref) * 100)}"></span><span class="nom">${PROV[c]}</span><span class="pr">${eur(out[c])}</span></a></li>`;
  $('rank-bajo').innerHTML = orden.slice(0, 5).map(fila).join('');
  $('rank-alto').innerHTML = orden.slice(-5).reverse().map(fila).join('');

  pintarFicha(out, ref);
}

async function pintarFicha(out, ref) {
  const c = st.sel, f = $('ficha');
  if (!c) { f.hidden = true; return; }
  const info = st.resumen.provincias[c]?.[st.prod];
  f.hidden = false;
  if (!info) {
    f.innerHTML = `<div class="ficha-cab"><b>${PROV[c]}</b></div><p class="etq">No hay datos de ${nomProd(st.prod).toLowerCase()} en esta provincia.</p>`;
    return;
  }
  const d = (out[c] - ref) * 100, fuera = FUERA.has(c);
  const u = unidad(st.prod);
  f.innerHTML = `
    <div class="ficha-cab"><b>${PROV[c]}</b><span class="dif ${claseDif(d)}">${textoDif(d)} ${fuera ? '· otra fiscalidad' : 'vs España'}</span></div>
    <div class="dos">
      <div class="dato"><div class="etq">Precio típico</div><div class="v">${eur(info.med)} <small class="etq">${u}</small></div><div class="s">Mediana de la provincia</div></div>
      <div class="dato"><div class="etq">Más barata</div><div class="v">${eur(info.min)} <small class="etq">${u}</small></div><div class="s" id="ficha-min">&nbsp;</div></div>
    </div>
    <div class="ficha-pie"><span>${info.n} gasolineras con ${nomProd(st.prod).toLowerCase()}</span><a class="ir" href="#/p/${c}">Ver gasolineras ›</a></div>`;
  try {
    const ests = await provincia(c);
    const e = ests.find(x => x.id === info.minId);
    if (e && st.sel === c && $('ficha-min')) $('ficha-min').textContent = `${marca(e.r).nombre} · ${tc(e.l)}`;
  } catch {}
}

$('modo').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  st.modo = b.dataset.m; pintarInicio();
});

// ---------- mapas de detalle (Leaflet) ----------
const teselas = () => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${oscuro.matches ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'}/MapServer/tile/{z}/{y}/{x}`;
const mapas = {};
function mapa(id) {
  if (mapas[id]) return mapas[id];
  const m = L.map(id, { zoomControl: true, attributionControl: true });
  L.tileLayer(teselas(), { maxZoom: 16, attribution: 'Mapa base © Esri, HERE, Garmin, © OpenStreetMap' }).addTo(m);
  m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  m.capa = L.layerGroup().addTo(m);
  mapas[id] = m;
  return m;
}
function puntos(m, lista, ref, extra) {
  m.capa.clearLayers();
  const pts = [];
  // los más caros primero, para que los baratos queden encima
  for (const e of [...lista].sort((a, b) => b.p[st.prod] - a.p[st.prod])) {
    const v = e.p[st.prod];
    const cm = L.circleMarker([e.la, e.lo], { radius: 7, weight: 1.5, color: '#fff', fillColor: color((v - ref) * 100), fillOpacity: 1 });
    cm.bindTooltip(`${marca(e.r).nombre} · ${eur(v)} ${unidad(st.prod)}`);
    cm.on('click', () => abrirHoja(e, ref));
    cm.addTo(m.capa);
    pts.push([e.la, e.lo]);
  }
  if (extra) { L.marker(extra, { icon: L.divIcon({ className: '', html: '<div class="punto-yo"></div>', iconSize: [16, 16] }) }).addTo(m.capa); pts.push(extra); }
  setTimeout(() => { m.invalidateSize(); if (pts.length) m.fitBounds(pts, { padding: [24, 24], maxZoom: 14 }); }, 60);
}

function filaEst(e, i, ref, extraTxt = '') {
  const v = e.p[st.prod], d = (v - ref) * 100;
  return `<li class="est" data-id="${e.id}">
    <span class="pos">${i + 1}</span>${insignia(e.r)}
    <div class="info"><div class="n1">${marca(e.r).nombre}</div><div class="n2">${extraTxt}${tc(e.d)} · ${tc(e.l)}</div></div>
    <div class="precio"><b>${eur(v)}</b><span class="dif ${claseDif(d)}">${textoDif(d)}</span></div></li>`;
}

// ---------- provincia ----------
async function pintarProvincia(c) {
  st.provActual = c;
  $('p-nombre').textContent = PROV[c] || 'Provincia';
  const info = st.resumen.provincias[c]?.[st.prod];
  const u = unidad(st.prod);
  const nac = st.resumen.nacional[st.prod];
  const dN = info && nac ? (info.med - nac.med) * 100 : null;
  $('p-tiles').innerHTML = info ? `
    <div class="dato"><div class="etq">Precio típico</div><div class="v">${eur(info.med)}</div><div class="s"><span class="dif ${claseDif(dN)}">${textoDif(dN)}</span></div></div>
    <div class="dato"><div class="etq">Más barata</div><div class="v">${eur(info.min)}</div><div class="s">${u}</div></div>
    <div class="dato"><div class="etq">Gasolineras</div><div class="v">${info.n}</div><div class="s">con ${nomProd(st.prod).toLowerCase()}</div></div>`
    : `<p class="etq">No hay datos de ${nomProd(st.prod).toLowerCase()} en ${PROV[c]}.</p>`;
  pintarEvolucion(c);
  $('p-lista').innerHTML = '<li class="estado">Cargando gasolineras…</li>';
  let ests;
  try { ests = await provincia(c); } catch { $('p-lista').innerHTML = '<li class="estado">No se pudieron cargar las gasolineras.</li>'; return; }
  if (st.provActual !== c || st.vista !== 'prov') return;
  let lista = ests.filter(e => !e.res && e.p[st.prod] != null);
  if ($('p-abiertas').checked) lista = lista.filter(e => /24\s*H/i.test(e.h));
  lista.sort((a, b) => a.p[st.prod] - b.p[st.prod]);
  const ref = info?.med ?? mediana(lista.map(e => e.p[st.prod]));
  puntos(mapa('p-mapa'), lista, ref);
  $('p-lista').innerHTML = lista.length ? lista.slice(0, st.mostrar).map((e, i) => filaEst(e, i, ref)).join('') : '<li class="estado">Ninguna gasolinera cumple el filtro.</li>';
  $('p-mas').hidden = lista.length <= st.mostrar;
  $('p-lista').onclick = ev => { const li = ev.target.closest('.est'); if (li) abrirHoja(lista.find(e => e.id === li.dataset.id), ref); };
}
$('p-mas').addEventListener('click', () => { st.mostrar += 20; pintarProvincia(st.provActual); });
$('p-abiertas').addEventListener('change', () => { st.mostrar = 20; pintarProvincia(st.provActual); });

function pintarEvolucion(c) {
  const dias = Object.keys(st.hist?.dias || {}).sort().slice(-30);
  const serie = dias.map(d => [d, st.hist.dias[d].p?.[c]?.[st.prod]]).filter(x => x[1] != null);
  const el = $('p-evol');
  if (serie.length < 2) { el.innerHTML = 'La evolución de los últimos días aparecerá aquí a medida que se acumulen datos.'; return; }
  const vs = serie.map(x => x[1]), mn = Math.min(...vs), mx = Math.max(...vs), rg = (mx - mn) || 0.01;
  const W = 300, H = 56;
  const pts = serie.map((x, i) => `${(i / (serie.length - 1) * W).toFixed(1)},${(H - 4 - (x[1] - mn) / rg * (H - 8)).toFixed(1)}`).join(' ');
  const d = (vs[vs.length - 1] - vs[0]) * 100;
  const f = s => s.slice(8, 10) + '/' + s.slice(5, 7);
  el.innerHTML = `Precio típico, últimos ${serie.length} días: <span class="dif ${claseDif(d)}">${textoDif(d)}</span> desde el ${f(serie[0][0])}
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---------- cerca de mí ----------
function bboxes() {
  if (st._bb) return st._bb;
  st._bb = {};
  for (const f of st.geo.features) {
    let a = [90, 180, -90, -180];
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const p of polys) for (const [lo, la] of p[0]) { a[0] = Math.min(a[0], la); a[1] = Math.min(a[1], lo); a[2] = Math.max(a[2], la); a[3] = Math.max(a[3], lo); }
    st._bb[f.properties.c] = a;
  }
  return st._bb;
}
function pintarCerca() {
  document.querySelectorAll('#radio button').forEach(b => b.classList.toggle('on', +b.dataset.r === st.radio));
  if (st.pos) return listarCerca();
  if (!navigator.geolocation) { $('c-estado').textContent = 'Tu navegador no permite obtener la ubicación.'; return; }
  $('c-estado').textContent = 'Buscando tu ubicación…';
  navigator.geolocation.getCurrentPosition(p => { st.pos = [p.coords.latitude, p.coords.longitude]; listarCerca(); },
    err => { $('c-estado').textContent = err.code === 1 ? 'No has dado permiso para usar tu ubicación. Puedes activarlo en los ajustes del navegador.' : 'No se pudo obtener tu ubicación. Inténtalo de nuevo.'; },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}
async function listarCerca() {
  const [la, lo] = st.pos, gLa = st.radio / 111, gLo = st.radio / (111 * Math.cos(la * Math.PI / 180));
  const cods = Object.entries(bboxes()).filter(([, b]) => la + gLa >= b[0] && la - gLa <= b[2] && lo + gLo >= b[1] && lo - gLo <= b[3]).map(([c]) => c);
  if (!cods.length) { $('c-estado').textContent = 'Parece que estás fuera de España: no hay gasolineras de esta app cerca.'; $('c-lista').innerHTML = ''; return; }
  $('c-estado').textContent = 'Buscando gasolineras…';
  let todas = [];
  try { todas = (await Promise.all(cods.map(provincia))).flat(); } catch { $('c-estado').textContent = 'No se pudieron cargar las gasolineras.'; return; }
  if (st.vista !== 'cerca') return;
  const lista = todas.filter(e => !e.res && e.p[st.prod] != null).map(e => ({ ...e, km: distKm(st.pos, [e.la, e.lo]) }))
    .filter(e => e.km <= st.radio).sort((a, b) => a.p[st.prod] - b.p[st.prod] || a.km - b.km);
  const ref = mediana(lista.map(e => e.p[st.prod]));
  $('c-estado').textContent = lista.length
    ? `${lista.length} gasolineras con ${nomProd(st.prod).toLowerCase()} a menos de ${st.radio} km. El color compara con el precio típico de la zona (${eur(ref)} ${unidad(st.prod)}).`
    : `No hay gasolineras con ${nomProd(st.prod).toLowerCase()} a menos de ${st.radio} km. Prueba con más distancia.`;
  puntos(mapa('c-mapa'), lista, ref ?? 0, st.pos);
  const kmTxt = e => `${e.km < 1 ? Math.round(e.km * 1000) + ' m' : e.km.toFixed(1).replace('.', ',') + ' km'} · `;
  $('c-lista').innerHTML = lista.slice(0, 30).map((e, i) => filaEst(e, i, ref, kmTxt(e))).join('');
  $('c-lista').onclick = ev => { const li = ev.target.closest('.est'); if (li) abrirHoja(lista.find(e => e.id === li.dataset.id), ref); };
}
$('radio').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  st.radio = +b.dataset.r; pintarCerca();
});

// ---------- ficha de gasolinera ----------
function abrirHoja(e, ref) {
  if (!e) return;
  const m = marca(e.r);
  const filas = OFICIAL.filter(([p]) => e.p[p] != null).map(([p, n]) => {
    const act = p === st.prod;
    const dif = act && ref != null ? ` <small class="dif ${claseDif((e.p[p] - ref) * 100)}">${textoDif((e.p[p] - ref) * 100)}</small>` : '';
    return `<li class="${act ? 'act' : ''}"><span>${n}${dif}</span><span>${eur(e.p[p])} <small>${unidad(p)}</small></span></li>`;
  }).join('');
  $('hoja').innerHTML = `<div class="asa"></div>
    <div class="hoja-cab">${insignia(e.r)}<div><h3>${m.nombre}</h3><div class="sub">${tc(e.d)} · ${e.cp ? e.cp + ' ' : ''}${tc(e.l)}</div></div></div>
    <ul class="precios">${filas}</ul>
    <p class="linea">Horario: ${e.h || 'no indicado'}</p>
    ${e.km != null ? `<p class="linea">A ${e.km.toFixed(1).replace('.', ',')} km de ti</p>` : ''}
    <p class="linea">Precios en surtidor sin descuentos, tal como los comunica la gasolinera al Ministerio.</p>
    <div class="acciones"><a class="pri" href="https://www.google.com/maps/dir/?api=1&destination=${e.la},${e.lo}" target="_blank" rel="noopener">Cómo llegar</a><button id="cerrar">Cerrar</button></div>`;
  $('hoja').hidden = false; $('velo').hidden = false;
  $('cerrar').onclick = cerrarHoja;
}
function cerrarHoja() { $('hoja').hidden = true; $('velo').hidden = true; }
$('velo').addEventListener('click', cerrarHoja);
addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });

// ---------- navegación ----------
function ruta() {
  if (!st.resumen) return;
  cerrarHoja();
  pintarChips();
  const h = location.hash;
  let v = 'inicio', c = null;
  const mp = /^#\/p\/(\d{2})$/.exec(h);
  if (mp && PROV[mp[1]]) { v = 'prov'; c = mp[1]; }
  else if (h === '#/cerca') v = 'cerca';
  const cambia = v !== st.vista || c !== st.provActual;
  st.vista = v;
  document.querySelectorAll('.vista').forEach(s => s.classList.toggle('activa', s.id === 'v-' + v));
  if (cambia) { scrollTo(0, 0); st.mostrar = 20; }
  if (v === 'inicio') pintarInicio();
  else if (v === 'prov') pintarProvincia(c);
  else pintarCerca();
}
addEventListener('hashchange', ruta);
$('hora').addEventListener('click', cargar);
oscuro.addEventListener('change', () => { svgListo = false; ruta(); });

cargar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
