(() => {
const $ = id => document.getElementById(id);
const LEAF = 'path,polygon,polyline,rect,circle,ellipse';
const SHAPES = LEAF + ',g';
const NODATA = '#3a3a37';
const CATS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#1f77b4', '#d62728', '#17becf', '#bcbd22', '#8c564b', '#e377c2', '#7f7f7f', '#aec7e8', '#98df8a', '#c49c94'];
const RAMP = ['#5b2a86', '#e4782b', '#f7d032']; // purple → orange → yellow
const S = { svg: null, rows: null, items: [], breaks: [], ranges: [], colors: [] };

/* ---------- helpers ---------- */
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/_x[0-9a-f]{4}_/gi, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const toast = t => { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 2500); };
const PAINT = LEAF + ',use';
const ok = s => !s.closest('defs,mask,clipPath,symbol,pattern');
const leaves = el => (el.matches('g') ? [...el.querySelectorAll(PAINT)] : [el]).filter(ok);

function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let s = String(v ?? '').replace(/[^\d.,\-]/g, '');
  if (!/\d/.test(s)) return NaN;
  const d = s.lastIndexOf('.'), c = s.lastIndexOf(',');
  if (d > -1 && c > -1) { const dec = d > c ? '.' : ','; s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.'); }
  else if (d > -1 || c > -1) {
    const sep = d > -1 ? '.' : ',';
    if (!/^-?0[.,]/.test(s) && new RegExp('^-?\\d{1,3}(\\' + sep + '\\d{3})+$').test(s)) s = s.split(sep).join('');
    else s = s.replace(sep, '.');
  }
  return parseFloat(s);
}
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function hsvToHex(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255); }
function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map(x => x / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0; if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
function ramp(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1) * (RAMP.length - 1), a = Math.min(Math.floor(t), RAMP.length - 2), f = t - a;
    const A = hexToRgb(RAMP[a]), B = hexToRgb(RAMP[a + 1]);
    return rgbToHex(...A.map((x, k) => x + (B[k] - x) * f));
  });
}

/* ---------- SVG upload ---------- */
$('svgInput').onchange = e => { const f = e.target.files[0]; return f && loadSvg(f); };
async function loadSvg(f) {
  if (!$('mapView').hidden) $('backBtn').onclick();
  const doc = new DOMParser().parseFromString(await f.text(), 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.nodeName.toLowerCase() !== 'svg') { $('svgInfo').textContent = 'That file is not a valid SVG.'; S.svg = null; return refresh(); }
  root.querySelectorAll('script,foreignObject').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => /^on/i.test(a.name) && n.removeAttribute(a.name)));
  const svg = document.importNode(root, true);
  const prev = $('preview'); prev.innerHTML = ''; prev.appendChild(svg);
  if (!svg.getAttribute('viewBox')) {
    const b = svg.getBBox(); svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
  }
  svg.removeAttribute('width'); svg.removeAttribute('height'); svg.removeAttribute('style');
  S.svg = svg; resetShapes();
  indexShapes();
  if (S.index.size) $('svgInfo').textContent = `${f.name} — ${S.index.size} named shapes found`;
  else {
    $('svgInfo').innerHTML = `${f.name} — no layer names found.<br>Are you using Figma? <a href="#" id="figmaDocLink">See how to export with layer names</a>`;
    $('figmaDocLink').onclick = e => { e.preventDefault(); setTab('docs'); openDoc('docs/figma-export.html', 'Exporting an SVG from Figma with layer names'); };
  }
  refresh();
}
function indexShapes() {
  S.index = new Map(); S.labels = new Map();
  S.svg.querySelectorAll(SHAPES).forEach(el => {
    const names = ['id', 'data-name', 'inkscape:label', 'name', 'aria-label', 'label'].map(a => el.getAttribute(a));
    const t = [...el.children].find(c => c.nodeName.toLowerCase() === 'title'); if (t) names.push(t.textContent);
    names.push(...(el.getAttribute('class') || '').split(/\s+/));
    names.forEach(n => { const k = norm(n); if (k && !S.index.has(k)) { S.index.set(k, el); S.labels.set(k, String(n)); } });
  });
}
function resetShapes() {
  [...S.svg.querySelectorAll(PAINT)].filter(ok).forEach(s => {
    s.style.fill = NODATA;
    if (!s.matches('use')) { s.style.stroke = '#262624'; s.style.strokeWidth = '1'; s.style.vectorEffect = 'non-scaling-stroke'; }
    s.dataset.nodata = '1'; s.classList.remove('hl');
  });
  S.svg.querySelectorAll('[data-tm-name]').forEach(el => { el.removeAttribute('data-tm-name'); el.removeAttribute('data-tm-value'); });
}

/* ---------- sheet upload ---------- */
$('sheetInput').onchange = e => { const f = e.target.files[0]; return f && loadSheet(f); };
async function loadSheet(f) {
  S.edited = false;
  try {
    const wb = /\.(csv|tsv|txt)$/i.test(f.name)
      ? XLSX.read(await f.text(), { type: 'string', raw: true })
      : XLSX.read(await f.arrayBuffer(), { type: 'array' });
    // clean up: trim cells, drop fully empty rows, then drop fully empty columns
    let data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
      .map(r => r.map(c => typeof c === 'string' ? c.trim() : c)).filter(r => r.some(c => c !== ''));
    const width = Math.max(...data.map(r => r.length)), keep = [...Array(width).keys()].filter(i => data.some(r => r[i] !== undefined && r[i] !== ''));
    data = data.map(r => keep.map(i => r[i] ?? ''));
    const hasHeader = !data[0].some((c, i) => i > 0 && !isNaN(parseNum(c)));
    const headers = data[0].map((h, i) => hasHeader ? String(h || 'Column ' + (i + 1)) : 'Column ' + (i + 1));
    S.rows = hasHeader ? data.slice(1) : data;
    const opts = headers.map((h, i) => `<option value="${i}">${h.replace(/</g, '&lt;')}</option>`).join('');
    $('nameCol').innerHTML = opts; $('valueCol').innerHTML = opts;
    let vi = headers.findIndex((_, i) => i > 0 && S.rows.filter(r => !isNaN(parseNum(r[i]))).length > S.rows.length / 2);
    const ni = headers.findIndex((_, i) => S.rows.filter(r => String(r[i] ?? '').trim() && isNaN(parseNum(r[i]))).length > S.rows.length / 2);
    $('nameCol').value = Math.max(ni, 0); $('valueCol').value = vi > 0 ? vi : Math.min(1, headers.length - 1);
    $('sheetOpts').hidden = false;
  } catch (err) { S.rows = null; setMsg('Could not read that sheet.', 'err'); }
  refresh();
}

/* ---------- matching + form state ---------- */
function match() {
  if (!S.svg || !S.rows) return { items: [], missing: [] };
  const ni = +$('nameCol').value, vi = +$('valueCol').value, items = [], missing = [], seen = new Set();
  S.rows.forEach(r => {
    const name = String(r[ni] ?? '').trim(), k = norm(name), value = parseNum(r[vi]), key = String(r[vi] ?? '').trim();
    if (!name || (getMode() === 'range' ? isNaN(value) : !key)) return;
    const el = S.index.get(k);
    if (!el || seen.has(k)) { if (!el) missing.push(name); return; }
    seen.add(k); items.push({ el, name, raw: String(r[vi]), value, key });
  });
  return { items, missing };
}
function setMsg(t, cls = '') { const m = $('msg'); m.textContent = t; m.className = 'msg ' + cls; }
const getMode = () => document.querySelector('input[name=mode]:checked').value;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function suggest(name, used) {
  const k = norm(name); let best = null, bs = 0;
  S.index.forEach((el, key) => {
    if (used.has(el) || !key || /^\d+$/.test(key)) return;
    let sim = 1 - lev(k, key) / Math.max(k.length, key.length);
    if (k.includes(key) || key.includes(k)) sim = Math.max(sim, .8);
    if (sim > bs) { bs = sim; best = key; }
  });
  return bs >= .55 ? S.labels.get(best) : null;
}
function refresh() {
  const { items, missing } = match(), mode = getMode(), uniq = mode === 'unique', min = uniq ? 1 : 3;   // ranges need at least 3 territories (max ranges = territories - 1)
  const n = items.length, rc = $('rangeCount'), distinct = new Set(items.map(i => i.key)).size, cap = uniq ? n : n - 1;
  $('rangeLabel').textContent = uniq ? 'Number of colors' : 'Range measure';
  rc.min = uniq ? 1 : 2; rc.max = n >= min ? cap : 99;
  if (uniq && !S.edited && distinct) rc.value = distinct;
  if (n >= min && +rc.value > cap) {   // colors <= territories, ranges <= territories - 1
    rc.value = cap;
    if (S.edited) warn(uniq ? `There are only ${n} territories, so colors were limited to ${n}.` : `There are ${n} territories, so ranges were limited to ${cap} (territories - 1).`);
  }
  const ready = S.svg && S.rows;
  $('rangeHint').textContent = !ready ? 'Load an SVG and a sheet first.'
    : uniq ? `Found ${distinct} distinct values in the value column (one color each). Max ${n}.` : `Min 2, max ${cap} (matched territories - 1).`;
  const same = ready && $('nameCol').value === $('valueCol').value, mismatch = uniq && distinct > 0 && +rc.value !== distinct;
  if (ready) {
    const used = new Set(items.map(i => i.el));
    if (same) setMsg('The name column and the value column are the same. If your sheet has only one column, add the column with the values (for example the party number).', 'err');
    else if (n < min) setMsg('Too few sheet rows match a shape name in the SVG. Check the name column and the layer names. SVG names found: ' + ([...S.index.keys()].slice(0, 6).join(', ') || 'none') + '. Sheet names: ' + S.rows.slice(0, 6).map(r => r[+$('nameCol').value]).join(', ') + '.', 'err');
    else if (mismatch) setMsg(`Your value column has ${distinct} distinct values, but you asked for ${rc.value} colors. Check that the right value column is selected, or change the number.`, 'err');
    else if (missing.length) setMsg(`${n} matched. ${missing.length} sheet row(s) have no shape with the same name: ` + missing.slice(0, 6).map(m => { const g = suggest(m, used); return g ? `${m} (SVG has "${g}")` : m; }).join('; ') + (missing.length > 6 ? '…' : '') + '. Rename them to match, then reload the file.', 'warn');
    else setMsg((uniq ? `${n} territories matched, ${distinct} distinct values.` : `${n} territories matched.`) + ($('titleInput').value.trim() ? '' : ' A map title is required.'), $('titleInput').value.trim() ? '' : 'warn');
  } else setMsg('');
  const issues = [];
  if (!S.svg) issues.push('Upload a map SVG.');
  if (!S.rows) issues.push('Upload a data sheet.');
  if (!$('titleInput').value.trim()) issues.push('Add a map title.');
  if (ready) {
    if (same) issues.push('The name column and the value column must be different.');
    else if (n < min) issues.push(`Too few sheet rows match shape names in the SVG (found ${n}, need at least ${min}).`);
    else {
      if (!uniq && !(+rc.value >= 2 && +rc.value <= cap)) issues.push(`Range measure must be a number between 2 and ${cap}.`);
      if (mismatch) issues.push(`Number of colors must match the ${distinct} distinct values in the value column.`);
    }
  }
  if (!$('certify').checked) issues.push('Confirm that every territory is named exactly the same in the SVG and the sheet.');
  S.issues = issues;
  $('startBtn').classList.toggle('not-ready', issues.length > 0); $('startBtn').setAttribute('aria-disabled', String(issues.length > 0));
}
function warn(text) {
  const t = document.createElement('div'); t.className = 'warn-toast'; t.textContent = text; t.onclick = () => t.remove();
  $('warnStack').appendChild(t); setTimeout(() => t.remove(), 5500);
}
['nameCol', 'valueCol'].forEach(i => $(i).onchange = () => { S.edited = false; refresh(); });
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { S.edited = false; refresh(); });
$('certify').onchange = refresh; $('rangeCount').oninput = () => { S.edited = true; refresh(); };

/* ---------- start: ranges, colors, render ---------- */
function breaksFor(vals, n, idx) {
  const b = [];
  for (let k = 1; k < n; k++) { const v = vals[idx(k)]; if (v !== undefined && v > (b.length ? b[b.length - 1] : vals[0])) b.push(v); }
  return b;
}
$('startBtn').onclick = () => {
  if (S.issues.length) { S.issues.forEach(warn); return; }   // one warning per missing field
  const { items } = match(); S.mode = getMode();
  if (items.length < (S.mode === 'unique' ? 1 : 3)) return;
  let b = [];
  if (S.mode === 'unique') {
    const cats = [...new Set(items.map(i => i.key))], numeric = cats.every(c => !isNaN(+c));
    cats.sort(numeric ? (a, c) => a - c : (a, c) => a.localeCompare(c));
    S.cats = cats; S.ranges = cats.slice();
    S.colors = cats.map((_, i) => CATS[i] || hsvToHex((i * 137.5) % 360, .65, .9));
  } else {
    const n = Math.min(Math.max(2, +$('rangeCount').value), items.length - 1);
    const vals = items.map(i => i.value).sort((a, b) => a - b), N = vals.length;
    const size = Math.ceil(N / n);
    b = breaksFor(vals, n, k => k * size);
    if (b.length + 1 < n) b = breaksFor(vals, n, k => Math.round(k * N / n));
    S.ranges = Array.from({ length: b.length + 1 }, (_, i) =>
      i === 0 ? `Below ${fmt(b[0])}` : i === b.length ? `${fmt(b[i - 1])} and above` : `${fmt(b[i - 1])} to <${fmt(b[i])}`);
    S.colors = ramp(S.ranges.length);
  }
  S.items = items; S.breaks = b; S.rangesOrig = S.ranges.slice();
  resetShapes();
  items.forEach(it => {
    it.bin = S.mode === 'unique' ? S.cats.indexOf(it.key) : b.filter(x => x <= it.value).length;
    it.el.setAttribute('data-tm-name', it.name); it.el.setAttribute('data-tm-value', valText(it));
    it.el.onmousemove = ev => showTip(ev, it); it.el.onmouseleave = hideTip;
    it.el.onmouseenter = () => leaves(it.el).forEach(s => s.classList.add('hl'));
    it.el.addEventListener('mouseleave', () => leaves(it.el).forEach(s => s.classList.remove('hl')));
  });
  paintAll(); buildLegend(); buildPalette(); updateMeta();
  $('mapHost').innerHTML = ''; $('mapHost').appendChild(S.svg);
  $('uploadView').hidden = true; $('mapView').hidden = false; $('exportWrap').hidden = false; $('backBtn').hidden = false;
};
function paintAll() { S.items.forEach(it => leaves(it.el).forEach(s => { s.style.fill = S.colors[it.bin]; delete s.dataset.nodata; })); }

/* ---------- tooltip ---------- */
function showTip(ev, it) {
  const t = $('tooltip'); t.hidden = false;
  t.querySelector('h2').textContent = it.name; t.querySelector('h4').textContent = valText(it);
  t.style.left = Math.min(ev.clientX + 16, innerWidth - t.offsetWidth - 8) + 'px'; t.style.top = (ev.clientY + 16) + 'px';
}
const hideTip = () => $('tooltip').hidden = true;

/* ---------- legend ---------- */
function buildLegend() {
  $('legendList').innerHTML = S.ranges.map((r, i) => `<li><i data-lg="${i}" style="background:${S.colors[i]}"></i><span data-lt="${i}">${esc(r)}</span></li>`).join('');
}
$('ear').onclick = () => { $('legend').classList.toggle('right'); $('legendDock').classList.toggle('right'); };
const valText = it => S.mode === 'unique' ? S.ranges[it.bin] : it.raw;
function showMenu(v) { $('menuMain').hidden = v !== 'main'; $('menuLegend').hidden = v !== 'legend'; syncStartBar(); }
function syncStartBar() { $('startBar').hidden = $('tabMaker').hidden || $('menuMain').hidden; }
$('legend').onclick = e => {
  if (e.target.closest('#ear, #paletteBtn')) return;
  setTab('maker');
  $('legendEdit').innerHTML = S.ranges.map((r, i) => `<label class="lg-row"><i style="background:${S.colors[i]}" data-le="${i}"></i><input type="text" data-i="${i}" value="${esc(r)}"></label>`).join('');
  showMenu('legend');
};
$('legendEdit').oninput = e => {
  const i = +e.target.dataset.i; if (isNaN(i)) return;
  S.ranges[i] = e.target.value.trim() || S.rangesOrig[i];
  document.querySelector(`[data-lt="${i}"]`).textContent = S.ranges[i];
  const t = document.querySelector(`strong[data-t="${i}"]`); if (t) t.textContent = S.ranges[i];
  if (S.mode === 'unique') S.items.forEach(it => it.bin === i && it.el.setAttribute('data-tm-value', S.ranges[i]));
};
$('legendDone').onclick = () => showMenu('main');

/* ---------- palette + HSB picker ---------- */
let pick = null, hsv = [0, 1, 1];
function buildPalette() {
  $('swatches').innerHTML = S.ranges.map((r, i) => `
    <div class="sw-row"><button class="sw" data-i="${i}" style="background:${S.colors[i]}" aria-label="Pick color"></button>
    <div class="sw-info"><strong data-t="${i}">${esc(r)}</strong><input type="text" data-i="${i}" value="${S.colors[i]}" maxlength="7" spellcheck="false"></div></div>`).join('');
}
function setColor(i, hex) {
  S.colors[i] = hex.toLowerCase();
  document.querySelector(`.sw[data-i="${i}"]`).style.background = hex;
  document.querySelector(`.sw-info input[data-i="${i}"]`).value = hex;
  document.querySelector(`[data-lg="${i}"]`).style.background = hex;
  const le = document.querySelector(`[data-le="${i}"]`); if (le) le.style.background = hex;
  paintAll();
}
$('swatches').onclick = e => {
  const b = e.target.closest('.sw'); if (!b) return;
  pick = +b.dataset.i; hsv = hexToHsv(S.colors[pick]);
  const r = b.getBoundingClientRect(), p = $('picker');
  p.style.left = (r.left - 216) + 'px'; p.style.top = Math.min(r.top, innerHeight - 250) + 'px'; p.hidden = false; syncPicker();
  e.stopPropagation();
};
$('swatches').onchange = e => {
  if (e.target.tagName !== 'INPUT') return;
  let v = e.target.value.trim(); if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map(c => c + c).join('');
  if (/^#[0-9a-f]{6}$/i.test(v)) { e.target.classList.remove('bad'); setColor(+e.target.dataset.i, v); }
  else e.target.classList.add('bad');
};
function syncPicker() {
  $('sv').style.backgroundColor = `hsl(${hsv[0]},100%,50%)`;
  $('svDot').style.left = hsv[1] * 100 + '%'; $('svDot').style.top = (1 - hsv[2]) * 100 + '%'; $('hue').value = hsv[0];
}
function svMove(e) {
  const r = $('sv').getBoundingClientRect();
  hsv[1] = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); hsv[2] = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  syncPicker(); setColor(pick, hsvToHex(...hsv));
}
$('sv').onpointerdown = e => { $('sv').setPointerCapture(e.pointerId); svMove(e); $('sv').onpointermove = svMove; };
$('sv').onpointerup = () => $('sv').onpointermove = null;
$('hue').oninput = e => { hsv[0] = +e.target.value; syncPicker(); setColor(pick, hsvToHex(...hsv)); };
$('paletteBtn').onclick = () => { $('palette').hidden = !$('palette').hidden; $('picker').hidden = true; };
document.addEventListener('click', e => {
  if (!e.target.closest('#picker')) $('picker').hidden = true;
  if (!e.target.closest('.dropdown')) $('exportMenu').hidden = true;
});
$('backBtn').onclick = () => {
  $('preview').innerHTML = ''; $('preview').appendChild(S.svg);
  showMenu('main'); $('mapView').hidden = true; $('exportWrap').hidden = true; $('backBtn').hidden = true; $('palette').hidden = true; $('uploadView').hidden = false;
};

/* ---------- drag & drop / import ---------- */
const canvasToast = t => { const e = $('canvasToast'); e.textContent = t; e.hidden = false; clearTimeout(canvasToast.t); canvasToast.t = setTimeout(() => e.hidden = true, 3500); };
const showDrop = on => $('dropOverlay').hidden = !on;
// show the imported file's name in the native file field
function setInputFile(input, f) { try { const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; } catch (e) {} }
async function importFile(f) {
  try {
    if (/\.svg$/i.test(f.name)) { await loadSvg(f); canvasToast('SVG imported successfully'); }
    else if (/\.(csv|tsv|txt|xls|xlsx)$/i.test(f.name)) { setTab('maker'); showMenu('main'); setInputFile($('sheetInput'), f); await loadSheet(f); canvasToast('Spreadsheet imported successfully'); }
    else toast('Unsupported file. Use an SVG or a CSV/XLS sheet.');
  } catch (err) { console.error(err); toast('Import failed: ' + err.message); }
}
async function sampleFile(key) {
  const x = (window.SAMPLES || {})[key];
  if (x) return new File([x.text], x.name, { type: x.type });
  const a = document.querySelector(`[data-sample="${key}"] a[download]`);   // fallback when served over http
  try { const r = await fetch(a.href); if (r.ok) return new File([await r.blob()], a.getAttribute('download') || a.href.split('/').pop()); } catch (e) {}
  throw new Error('Sample data not found. Keep samples.js in the assets folder (or next to index.html) and reload.');
}
async function importSample(key) { try { await importFile(await sampleFile(key)); } catch (err) { console.error(err); toast(err.message); } }
let draggingSample = null, dragDepth = 0;
document.querySelectorAll('.res-row').forEach(r => {
  r.addEventListener('dragstart', e => {
    draggingSample = r.dataset.sample;
    e.dataTransfer.setData('text/x-paintmap-sample', draggingSample); e.dataTransfer.setData('text/plain', draggingSample); e.dataTransfer.effectAllowed = 'copy';
    setTimeout(() => r.classList.add('dragging'), 0); showDrop(true);
  });
  r.addEventListener('dragend', () => { r.classList.remove('dragging'); dragDepth = 0; showDrop(false); setTimeout(() => draggingSample = null, 300); });
});
document.querySelectorAll('.import-btn').forEach(b => b.onclick = () => importSample(b.dataset.import));
const hasPayload = e => !!draggingSample || [...(e.dataTransfer?.types || [])].some(t => t === 'Files' || t === 'text/x-paintmap-sample');
document.addEventListener('dragenter', e => { if (hasPayload(e)) { e.preventDefault(); dragDepth++; showDrop(true); } });
document.addEventListener('dragleave', e => { if (hasPayload(e) && --dragDepth <= 0) { dragDepth = 0; showDrop(false); } });
document.addEventListener('dragover', e => { if (hasPayload(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('drop', e => {
  if (!hasPayload(e)) return;
  e.preventDefault(); dragDepth = 0; showDrop(false);
  const key = draggingSample || e.dataTransfer.getData('text/x-paintmap-sample'), file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!$('stage').contains(e.target)) return;
  if (key) importSample(key); else if (file) importFile(file); else toast('Nothing to import: the drop carried no file.');
});

/* ---------- tabs, title, source ---------- */
function setTab(t) {
  document.querySelectorAll('.tab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $('tabMaker').hidden = t !== 'maker'; $('tabDocs').hidden = t !== 'docs'; $('tabResources').hidden = t !== 'resources'; syncStartBar();
}
document.querySelectorAll('.tab[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('downloadAll').onclick = () => document.querySelectorAll('.res-row a[download]').forEach((a, i) => setTimeout(() => a.click(), i * 400));
function openDoc(path, title) { $('docTitle').textContent = title; $('docFrame').src = path; $('docsList').hidden = true; $('docView').hidden = false; }
document.querySelectorAll('.doc-item').forEach(b => b.onclick = () => openDoc(b.dataset.doc, b.dataset.title));
$('docBack').onclick = () => { $('docView').hidden = true; $('docsList').hidden = false; $('docFrame').removeAttribute('src'); };
function getSource(target = 'app') {
  if (!$('srcCheck').checked) return null;
  if (S.srcSheet) {
    if (target === 'pdf') return { text: 'Sources: see next page', href: null };
    if (target === 'png') return { text: 'Sources: ' + S.srcSheet.name, href: null };
    return { text: 'Sources (click to download)', href: S.srcSheet.uri, download: S.srcSheet.name };
  }
  const v = $('srcInput').value.trim(); if (!v) return null;
  if (!/^(https?:\/\/)?[^\s\/]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) return { text: 'Source: ' + v, href: null };
  const href = /^https?:\/\//i.test(v) ? v : 'https://' + v; let host = v;
  try { host = new URL(href).hostname.replace(/^www\./, ''); } catch {}
  return { text: 'Source: ' + host, href };
}
function updateMeta() {
  const t = $('titleInput').value.trim(); $('mapTitle').textContent = t; $('mapTitle').hidden = !t;
  const s = getSource(), a = $('sourceLink'); a.hidden = !s;
  if (s) {
    a.textContent = s.text;
    s.href ? a.setAttribute('href', s.href) : a.removeAttribute('href');
    if (s.download) { a.setAttribute('download', s.download); a.removeAttribute('target'); } else { a.removeAttribute('download'); a.setAttribute('target', '_blank'); }
    a.onclick = s.href && !s.download ? ev => { ev.preventDefault(); window.open(s.href, '_blank', 'noopener'); } : null;
  }
}
$('titleInput').addEventListener('input', () => { updateMeta(); refresh(); });
$('srcInput').addEventListener('input', syncSource);
async function readRows(f) {
  const wb = /\.(csv|tsv|txt)$/i.test(f.name) ? XLSX.read(await f.text(), { type: 'string', raw: true }) : XLSX.read(await f.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }).map(r => r.map(c => typeof c === 'string' ? c.trim() : c)).filter(r => r.some(c => c !== ''));
}
function syncSource() {
  const sh = !!S.srcSheet, has = !!$('srcInput').value.trim();
  $('srcChip').hidden = !sh; $('chipName').textContent = sh ? S.srcSheet.name : '';
  $('multiLink').hidden = sh; $('multiLink').classList.toggle('off', has);
  $('srcInput').disabled = sh; updateMeta();
}
$('multiLink').onclick = e => { e.preventDefault(); if ($('srcInput').value.trim()) return toast('Clear the direct link to upload a spreadsheet instead.'); $('srcSheetInput').click(); };
$('srcSheetInput').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const rows = await readRows(f), buf = new Uint8Array(await f.arrayBuffer()); let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    S.srcSheet = { name: f.name, rows, uri: `data:${f.type || 'application/octet-stream'};base64,${btoa(bin)}` };
    $('srcInput').value = ''; $('srcCheck').checked = true; syncSource();
  } catch (err) { toast('Could not read that spreadsheet.'); }
};
$('chipX').onclick = () => { S.srcSheet = null; syncSource(); };
const fileBase = () => $('titleInput').value.trim().replace(/[\\/:*?"<>|]+/g, '').trim() || 'map';
function addSourcesPages(pdf, pw, ph) {
  const m = pw * .06, fs = Math.max(11, pw / 75), lh = fs * 1.5, ori = pw > ph ? 'l' : 'p', isU = c => /^https?:\/\/\S+$/i.test(c);
  let y = m + fs; pdf.addPage([pw, ph], ori);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(fs * 1.6); pdf.setTextColor(34); pdf.text('Sources', m, y); y += lh * 1.8;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(fs);
  const room = () => { if (y > ph - m) { pdf.addPage([pw, ph], ori); y = m + fs; pdf.setFontSize(fs); } };
  S.srcSheet.rows.forEach(r => {
    const cells = r.map(c => String(c).trim()).filter(Boolean), plain = cells.filter(c => !isU(c)), urls = cells.filter(isU);
    if (plain.length) pdf.splitTextToSize(plain.join('  —  '), pw - m * 2).forEach(l => { room(); pdf.setTextColor(34); pdf.text(l, m, y); y += lh; });
    urls.forEach(u => { room(); pdf.setTextColor(0, 0, 200); pdf.textWithLink(u.length > 110 ? u.slice(0, 107) + '…' : u, m + fs, y, { url: u }); y += lh; });
    y += lh * .4;
  });
}
$('srcCheck').addEventListener('change', updateMeta);
$('srcInput').addEventListener('focus', () => { if (!$('srcCheck').checked) { $('srcCheck').checked = true; updateMeta(); } });

/* ---------- export ---------- */
const NS = 'http://www.w3.org/2000/svg';
function mk(tag, attrs, text) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
function buildExport(bg, target = 'svg') {
  const c = S.svg.cloneNode(true);
  c.removeAttribute('style'); c.setAttribute('xmlns', NS);
  c.querySelectorAll('.hl').forEach(n => n.classList.remove('hl'));
  c.querySelectorAll('[data-nodata]').forEach(n => n.style.fill = '#d4d4d0');
  c.querySelectorAll(LEAF).forEach(n => ok(n) && (n.style.stroke = '#fff'));
  const [x, y, w, h] = c.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  const fs = w / 55, pad = fs, rowH = fs * 1.7, rows = S.ranges.length, per = 5, cols = Math.ceil(rows / per);
  const lw = Math.max(...S.ranges.map(r => r.length)) * fs * .55 + fs * 3.5, boxW = Math.max(cols * lw, fs * 8), boxH = pad * 2 + rowH * (Math.min(rows, per) + 1) + (getSource(target) ? rowH : 0);
  const g = mk('g', { 'font-family': 'system-ui,Arial,sans-serif' }), ly = y + h + pad;
  g.appendChild(mk('text', { x: x + pad, y: ly + pad + fs, 'font-size': fs * 1.2, 'font-weight': 600, fill: '#222' }, 'Legend'));
  S.ranges.forEach((r, i) => {
    const cx = x + pad + Math.floor(i / per) * lw, yy = ly + pad + rowH * (i % per + 1);
    g.appendChild(mk('rect', { x: cx, y: yy, width: fs * 1.2, height: fs * 1.2, rx: fs * .2, fill: S.colors[i] }));
    g.appendChild(mk('text', { x: cx + fs * 1.9, y: yy + fs, 'font-size': fs, fill: '#222' }, r));
  });
  const src = getSource(target), title = $('titleInput').value.trim();
  if (src) {
    const sy = ly + pad + rowH * (Math.min(rows, per) + 1) + fs * .6, sf = fs * .85;
    const t = mk('text', { x: x + pad, y: sy, 'font-size': sf, fill: '#222', 'text-decoration': 'underline' }, src.text);
    if (src.href) { const a = mk('a', src.download ? { href: src.href, download: src.download } : { href: src.href, target: '_blank' }); a.appendChild(t); g.appendChild(a); } else g.appendChild(t);
    c.srcInfo = { x: x + pad, y: sy - sf, w: src.text.length * sf * .55, h: sf * 1.3, href: src.href };
  }
  const W = Math.max(w, boxW + pad * 2), H = h + boxH + pad, ty = title ? fs * 2.8 : 0;
  if (title) g.appendChild(mk('text', { x: x + pad, y: y - ty + fs * 2, 'font-size': fs * 1.8, 'font-weight': 600, fill: '#222', 'font-family': 'Georgia,serif' }, title));
  c.appendChild(g);
  c.setAttribute('viewBox', `${x} ${y - ty} ${W} ${H + ty}`);
  if (bg) c.insertBefore(mk('rect', { x, y: y - ty, width: W, height: H + ty, fill: '#fff' }), c.firstChild);
  return c;
}
const ser = n => new XMLSerializer().serializeToString(n);
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
async function toCanvas(width = 2000, target = 'png') {
  const c = buildExport(true, target), vb = c.getAttribute('viewBox').split(' ').map(Number), height = Math.round(width * vb[3] / vb[2]);
  c.setAttribute('width', width); c.setAttribute('height', height);
  const img = new Image(); const url = URL.createObjectURL(new Blob([ser(c)], { type: 'image/svg+xml' }));
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height; cv.getContext('2d').drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url); cv.meta = { vb, src: c.srcInfo }; return cv;
}
function embedHtml() {
  const c = buildExport(false); c.setAttribute('width', '100%'); c.removeAttribute('height');
  const css = '.tmap{position:relative;max-width:900px;margin:auto}.tmap svg{width:100%;height:auto}.tmap [data-tm-name]{cursor:pointer}.tmap [data-tm-name]:hover{filter:brightness(1.2)}.tmap-tip{display:none;position:absolute;pointer-events:none;background:#30302e;color:#faf9f5;padding:10px 14px;border-radius:10px;font-family:system-ui,sans-serif;box-shadow:0 6px 20px #0006;z-index:9}.tmap-tip h2{margin:0;font-size:18px}.tmap-tip h4{margin:4px 0 0;font-size:14px;font-weight:500;color:#d97757}';
  const js = "document.querySelectorAll('.tmap:not([data-i])').forEach(function(b){b.dataset.i=1;var t=document.createElement('div');t.className='tmap-tip';t.innerHTML='<h2></h2><h4></h4>';b.appendChild(t);b.querySelectorAll('[data-tm-name]').forEach(function(e){e.addEventListener('mousemove',function(v){var r=b.getBoundingClientRect();t.children[0].textContent=e.dataset.tmName;t.children[1].textContent=e.dataset.tmValue;t.style.display='block';t.style.left=(v.clientX-r.left+14)+'px';t.style.top=(v.clientY-r.top+14)+'px'});e.addEventListener('mouseleave',function(){t.style.display='none'})})});";
  return `<style>${css}</style>\n<div class="tmap">${ser(c)}</div>\n<script>${js}<\/script>`;
}
$('exportBtn').onclick = e => { e.stopPropagation(); $('exportMenu').hidden = !$('exportMenu').hidden; };
$('exportMenu').onclick = async e => {
  const f = e.target.dataset.fmt; if (!f) return; $('exportMenu').hidden = true;
  try {
    if (f === 'svg') download(new Blob([ser(buildExport(false))], { type: 'image/svg+xml' }), fileBase() + '.svg');
    if (f === 'png') (await toCanvas(2000, 'png')).toBlob(b => download(b, fileBase() + '.png'));
    if (f === 'pdf') {
      const cv = await toCanvas(2000, 'pdf'), w = cv.width / 2, h = cv.height / 2;
      const pdf = new window.jspdf.jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'pt', format: [w, h] });
      pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, w, h);
      const m = cv.meta;
      if (m.src && m.src.href) { const k = w / m.vb[2]; pdf.link((m.src.x - m.vb[0]) * k, (m.src.y - m.vb[1]) * k, m.src.w * k, m.src.h * k, { url: m.src.href }); }
      if (S.srcSheet && $('srcCheck').checked) addSourcesPages(pdf, w, h);
      pdf.setProperties({ title: fileBase() }); pdf.save(fileBase() + '.pdf');
    }
    if (f === 'embed') {
      const code = embedHtml(); download(new Blob([code], { type: 'text/html' }), fileBase() + ' (embed).html');
      try { await navigator.clipboard.writeText(code); toast('Embed code copied and downloaded'); } catch { toast('Embed file downloaded'); }
    }
  } catch (err) { toast('Export failed: ' + err.message); }
};
$('startBtn').disabled = false;   // readiness is shown by the .not-ready class; clicks show the warnings
refresh();
})();
