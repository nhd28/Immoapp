// Immo-Pipeline – Frontend (ohne Build-Schritt)
const $app = document.getElementById('app');
let CONFIG = null;
let PROPS = [];
const ui = {
  view: localStorage.getItem('view') || 'board',
  search: '',
  hideClosed: localStorage.getItem('hideClosed') === '1',
  sort: { key: 'updated_at', dir: -1 },
};
const NEBENKOSTEN = 0.105;
// Läuft die Seite in der nativen App (Capacitor)?
const NATIVE = Boolean(window.Capacitor?.isNativePlatform?.());
if (NATIVE) document.documentElement.classList.add('native');
// Externe Links und Dokumente in der App im System-Browser/-Viewer öffnen
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[target=_blank]');
  if (!a || !NATIVE) return;
  const Browser = window.Capacitor.Plugins?.Browser;
  if (!Browser) return;
  e.preventDefault();
  Browser.open({ url: new URL(a.dataset.signed || a.getAttribute('href'), location.href).href, presentationStyle: 'fullscreen' });
}); // ca. Grunderwerbsteuer + Notar/Grundbuch + Makler

// ---------- Hilfsfunktionen ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (v, d = 0) => (v == null ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: d }).format(v));
const nf = (v, d = 0) => (v == null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v));
const pct = (v) => (v == null ? '–' : `${nf(v * 100, 2)} %`);
const date = (s) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const status = (k) => CONFIG.statuses.find((s) => s.key === k) || { key: k, label: k, color: '#64748b' };
const stars = (v) => {
  if (v == null) return '<span class="muted small">noch nicht bewertet</span>';
  const r = Math.round(v);
  return `<span class="stars" title="${nf(v, 1)} / 5">${'★'.repeat(r)}<span class="off">${'★'.repeat(5 - r)}</span></span> <span class="small muted">${nf(v, 1)}</span>`;
};
const verdictLabel = { ja: 'Ja', vielleicht: 'Vielleicht', nein: 'Nein' };

function figures(p) {
  const ppsqm = p.price && p.living_area ? p.price / p.living_area : null;
  const yieldGross = p.price && p.rent_yearly ? p.rent_yearly / p.price : null;
  const factor = p.price && p.rent_yearly ? p.price / p.rent_yearly : null;
  const extra = p.price ? p.price * NEBENKOSTEN : null;
  const total = p.price ? p.price + extra : null;
  const yieldNet = total && p.rent_yearly ? (p.rent_yearly - (p.hausgeld || 0) * 12 * 0.4) / total : null; // grob: ~40 % des Hausgelds nicht umlagefähig
  return { ppsqm, yieldGross, factor, extra, total, yieldNet };
}

async function api(url, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes('/login')) { CONFIG.user = null; renderLogin(); throw new Error('Bitte anmelden'); }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast${err ? ' err' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
const fail = (e) => toast(e.message, true);

// ---------- Routing ----------
window.addEventListener('hashchange', route);
function route() {
  if (!CONFIG.user) return renderLogin();
  const m = /^#\/p\/(\d+)/.exec(location.hash);
  if (m) return renderDetail(Number(m[1]));
  renderHome();
}

function topbar() {
  return `<header class="topbar"><div class="topbar-inner">
    <a class="brand" href="#/"><span class="brand-logo"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M5 16 16 7l11 9v11h-7v-7h-8v7H5z" fill="white"/></svg></span>Immo-Pipeline</a>
    <span class="spacer"></span>
    <button class="btn primary" data-act="new">+ Exposé<span class="hide-sm">&nbsp;hochladen</span></button>
    <span class="user-chip">👤 ${esc(CONFIG.user)}</span>
    <button class="btn small ghost" data-act="logout" title="Abmelden" aria-label="Abmelden"><span class="show-sm">⏻</span><span class="hide-sm">Abmelden</span></button>
  </div></header>`;
}

function bindTopbar(root) {
  root.querySelector('[data-act=new]').onclick = openNewDialog;
  root.querySelector('[data-act=logout]').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    CONFIG.user = null;
    renderLogin();
  };
}

// ---------- Login ----------
function renderLogin() {
  $app.innerHTML = `<div class="login"><form class="card" id="loginForm">
    <div class="brand"><span class="brand-logo"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M5 16 16 7l11 9v11h-7v-7h-8v7H5z" fill="white"/></svg></span>Immo-Pipeline</div>
    <h1>Anmelden</h1>
    <p class="muted small">Wer bist du?</p>
    <div class="user-pick">${CONFIG.users.map((u) => `<button type="button" class="btn" data-user="${esc(u)}">${esc(u)}</button>`).join('')}</div>
    <label>Name</label><input name="name" required autocomplete="username" value="${esc(localStorage.getItem('lastUser') || '')}" />
    ${CONFIG.passwordRequired ? '<div style="margin-top:10px"><label>Passwort</label><input name="password" type="password" required autocomplete="current-password" /></div>' : ''}
    <button class="btn primary" style="width:100%;margin-top:14px">Anmelden</button>
  </form></div>`;
  const form = document.getElementById('loginForm');
  form.querySelectorAll('[data-user]').forEach((b) => (b.onclick = () => { form.name.value = b.dataset.user; (form.password || form.name).focus(); }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/login', { method: 'POST', body: { name: form.name.value, password: form.password?.value } });
      CONFIG.user = user;
      localStorage.setItem('lastUser', user);
      route();
    } catch (err) { fail(err); }
  };
}

// ---------- Übersicht ----------
async function renderHome() {
  try { PROPS = await api('/api/properties'); } catch (e) { return fail(e); }
  const q = ui.search.toLowerCase();
  const list = PROPS.filter((p) => (!q || [p.title, p.city, p.address, p.type].join(' ').toLowerCase().includes(q))
    && (!ui.hideClosed || !['abgelehnt', 'gekauft'].includes(p.status) || ui.view === 'board'));
  const active = PROPS.filter((p) => !['abgelehnt', 'gekauft'].includes(p.status));
  const volume = active.reduce((s, p) => s + (p.price || 0), 0);
  const rated = PROPS.filter((p) => p.rating_avg != null);

  $app.innerHTML = `${topbar()}<main>
    <section class="stats">
      <div class="card stat"><div class="v">${PROPS.length}</div><div class="l">Exposés gesamt</div></div>
      <div class="card stat"><div class="v">${active.length}</div><div class="l">aktiv in Prüfung</div></div>
      <div class="card stat"><div class="v">${PROPS.filter((p) => p.status === 'eingang').length}</div><div class="l">neu im Eingang</div></div>
      <div class="card stat"><div class="v">${PROPS.filter((p) => p.status === 'gekauft').length}</div><div class="l">gekauft</div></div>
      <div class="card stat"><div class="v">${volume ? eur(volume) : '–'}</div><div class="l">Volumen aktiv</div></div>
      <div class="card stat"><div class="v">${rated.length ? nf(rated.reduce((s, p) => s + p.rating_avg, 0) / rated.length, 1) : '–'}</div><div class="l">Ø Bewertung</div></div>
    </section>
    <div class="toolbar">
      <div class="seg"><button data-view="board" class="${ui.view === 'board' ? 'on' : ''}">Pipeline</button><button data-view="list" class="${ui.view === 'list' ? 'on' : ''}">Liste</button></div>
      <input class="search" id="search" placeholder="Suchen (Titel, Ort, Typ) …" value="${esc(ui.search)}" />
      ${ui.view === 'list' ? `<label class="row small" style="margin:0;color:var(--text)"><input type="checkbox" id="hideClosed" style="width:auto" ${ui.hideClosed ? 'checked' : ''}/> abgeschlossene ausblenden</label>` : ''}
    </div>
    <div id="content">${PROPS.length === 0 ? emptyState() : ui.view === 'board' ? board(list) : table(list)}</div>
  </main>`;

  bindTopbar($app);
  $app.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { ui.view = b.dataset.view; localStorage.setItem('view', ui.view); renderHome(); }));
  const s = document.getElementById('search');
  s.oninput = () => { ui.search = s.value; clearTimeout(s._t); s._t = setTimeout(() => { renderHome().then(() => { const n = document.getElementById('search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
  const hc = document.getElementById('hideClosed');
  if (hc) hc.onchange = () => { ui.hideClosed = hc.checked; localStorage.setItem('hideClosed', hc.checked ? '1' : '0'); renderHome(); };
  $app.querySelector('[data-act=new-empty]')?.addEventListener('click', openNewDialog);
  if (ui.view === 'board') bindBoard(); else bindTable();
  // Laufende KI-Analysen beobachten
  if (PROPS.some((p) => p.ai_status === 'running')) setTimeout(() => { if (!location.hash.startsWith('#/p/')) renderHome(); }, 5000);
}

const emptyState = () => `<div class="card empty" style="padding:48px 16px">
  <div style="font-size:2.4rem">🏠</div><h2 style="margin:8px 0">Noch keine Exposés</h2>
  <p>Lade das erste Exposé (PDF) und Bilder hoch – es landet automatisch im <b>Eingang</b>.</p>
  <button class="btn primary" data-act="new-empty">+ Exposé hochladen</button></div>`;

function pcard(p) {
  const f = figures(p);
  const verdicts = CONFIG.users.map((u) => {
    const v = p.verdicts.find((x) => x.user === u);
    return `<span class="verdict ${v?.verdict || 'none'}" title="${esc(u)}">${esc(u.slice(0, 1))}: ${v?.verdict ? verdictLabel[v.verdict] : '?'}</span>`;
  }).join('');
  return `<a class="pcard" draggable="true" data-id="${p.id}" href="#/p/${p.id}">
    <div class="cover" style="${p.cover ? `background-image:url('${esc(p.cover)}')` : ''}">${p.cover ? '' : 'kein Bild'}
      <div class="badges">${p.ai_status === 'running' ? '<span class="badge ai">KI …</span>' : p.ai_score != null ? `<span class="badge ai" title="KI-Score">KI ${p.ai_score}/10</span>` : ''}${p.images > 1 ? `<span class="badge">📷 ${p.images}</span>` : ''}</div>
    </div>
    <div class="body">
      <div class="title">${esc(p.title)}</div>
      <div class="meta">${esc([p.type, p.city].filter(Boolean).join(' · ') || 'Angaben fehlen')}</div>
      <div class="figures"><span><b>${eur(p.price)}</b></span>${f.ppsqm ? `<span>${eur(f.ppsqm)}/m²</span>` : ''}${f.yieldGross ? `<span>${pct(f.yieldGross)}</span>` : ''}</div>
      <div class="foot">${stars(p.rating_avg)}</div>
      <div class="foot">${verdicts}</div>
    </div></a>`;
}

function board(list) {
  return `<div class="board">${CONFIG.statuses.map((s) => {
    const items = list.filter((p) => p.status === s.key);
    return `<section class="column" data-status="${s.key}">
      <div class="column-head"><span class="dot" style="background:${s.color}"></span>${esc(s.label)}<span class="count">${items.length}</span></div>
      <div class="column-body">${items.map(pcard).join('') || '<div class="empty">–</div>'}</div></section>`;
  }).join('')}</div>`;
}

function bindBoard() {
  let dragId = null;
  $app.querySelectorAll('.pcard').forEach((c) => {
    c.ondragstart = (e) => { dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    c.ondragend = () => c.classList.remove('dragging');
  });
  $app.querySelectorAll('.column').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      if (!dragId) return;
      const p = PROPS.find((x) => String(x.id) === dragId);
      if (p && p.status !== col.dataset.status) {
        try {
          await api(`/api/properties/${dragId}/status`, { method: 'PUT', body: { status: col.dataset.status } });
          toast(`„${p.title}“ → ${status(col.dataset.status).label}`);
          renderHome();
        } catch (err) { fail(err); }
      }
      dragId = null;
    };
  });
}

const COLS = [
  ['title', 'Objekt'], ['status', 'Status'], ['city', 'Ort'], ['price', 'Kaufpreis', 1], ['living_area', 'm²', 1],
  ['ppsqm', '€/m²', 1], ['yieldGross', 'Rendite', 1], ['rating_avg', 'Bewertung', 1], ['ai_score', 'KI', 1], ['updated_at', 'Geändert'],
];
function table(list) {
  const rows = list.map((p) => ({ ...p, ...figures(p) }));
  const { key, dir } = ui.sort;
  rows.sort((a, b) => {
    const x = a[key]; const y = b[key];
    if (x == null) return 1;
    if (y == null) return -1;
    if (key === 'status') return (CONFIG.statuses.findIndex((s) => s.key === x) - CONFIG.statuses.findIndex((s) => s.key === y)) * dir;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
  return `<div class="table-wrap"><table class="list"><thead><tr>${COLS.map(([k, l, n]) => `<th data-sort="${k}" class="${n ? 'num' : ''}">${l}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((p) => `<tr data-id="${p.id}">
    <td style="white-space:normal;min-width:180px"><b>${esc(p.title)}</b></td>
    <td><span class="pill"><span class="dot" style="background:${status(p.status).color}"></span>${esc(status(p.status).label)}</span></td>
    <td>${esc(p.city || '–')}</td><td class="num">${eur(p.price)}</td><td class="num">${nf(p.living_area)}</td>
    <td class="num">${p.ppsqm ? eur(p.ppsqm) : '–'}</td><td class="num">${pct(p.yieldGross)}</td>
    <td class="num">${p.rating_avg != null ? `${nf(p.rating_avg, 1)} ★` : '–'}</td><td class="num">${p.ai_score ?? '–'}</td>
    <td class="muted">${date(p.updated_at)}</td></tr>`).join('') || `<tr><td colspan="${COLS.length}" class="empty">Keine Treffer</td></tr>`}</tbody></table></div>`;
}
function bindTable() {
  $app.querySelectorAll('[data-sort]').forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : (['title', 'city', 'status'].includes(k) ? 1 : -1) };
    renderHome();
  }));
  $app.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = `#/p/${tr.dataset.id}`)));
}

// ---------- Neues Exposé ----------
function openNewDialog() {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="card modal">
    <div class="section-head"><h2>Neues Exposé</h2><span class="spacer"></span><button type="button" class="btn small ghost" data-close>✕</button></div>
    <div class="dropzone" id="dz">📄 Exposé-PDF(s) &amp; Bilder hierher ziehen<br/><span class="small">oder klicken zum Auswählen</span></div>
    <input type="file" id="fi" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" hidden />
    <div class="chosen" id="chosen"></div>
    <div class="form-grid" style="margin-top:12px">
      <div class="full"><label>Titel (optional – wird sonst aus dem Exposé übernommen)</label><input name="title" placeholder="z. B. 3-Zi-ETW Altbau Südstadt" /></div>
      <div><label>Ort</label><input name="city" /></div>
      <div><label>Kaufpreis (€)</label><input name="price" inputmode="decimal" /></div>
      <div class="full"><label>Link zum Inserat</label><input name="link" type="url" placeholder="https://…" /></div>
      <div class="full"><label>Quelle / Makler</label><input name="source" /></div>
    </div>
    ${CONFIG.aiEnabled ? '<label class="row small" style="margin-top:12px;color:var(--text)"><input type="checkbox" name="analyze" checked style="width:auto"/> Exposé automatisch per KI auswerten</label>' : ''}
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary" id="submitNew">In den Eingang legen</button></div>
  </form>`;
  document.body.appendChild(bg);
  const form = bg.querySelector('form');
  let files = [];
  const dz = bg.querySelector('#dz'); const fi = bg.querySelector('#fi'); const chosen = bg.querySelector('#chosen');
  const show = () => (chosen.innerHTML = files.map((f) => `• ${esc(f.name)} <span class="muted">(${nf(f.size / 1048576, 1)} MB)</span>`).join('<br/>'));
  const add = (list) => { files = files.concat([...list]); show(); };
  dz.onclick = () => fi.click();
  fi.onchange = () => add(fi.files);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); add(e.dataTransfer.files); };
  const close = () => bg.remove();
  bg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  bg.onclick = (e) => { if (e.target === bg) close(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    for (const k of ['title', 'city', 'price', 'link', 'source']) if (form[k].value) fd.append(k, form[k].value);
    fd.append('analyze', form.analyze?.checked ? 'true' : 'false');
    files.forEach((f) => fd.append('files', f));
    const btn = bg.querySelector('#submitNew');
    btn.disabled = true; btn.textContent = 'Lade hoch …';
    try {
      const p = await api('/api/properties', { method: 'POST', body: fd });
      close();
      toast('Exposé angelegt');
      location.hash = `#/p/${p.id}`;
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = 'In den Eingang legen'; }
  };
}

// ---------- Detailansicht ----------
let pollTimer;
async function renderDetail(id, keepScroll = false) {
  clearTimeout(pollTimer);
  let p;
  try { p = await api(`/api/properties/${id}`); } catch (e) { fail(e); location.hash = '#/'; return; }
  const y = window.scrollY;
  const images = p.files.filter((f) => f.kind === 'image');
  const docs = p.files.filter((f) => f.kind !== 'image');
  const f = figures(p);
  const idx = CONFIG.statuses.findIndex((s) => s.key === p.status);
  const mine = p.ratings.find((r) => r.user === CONFIG.user) || { scores: {}, verdict: null, comment: '' };
  const others = p.ratings.filter((r) => r.user !== CONFIG.user);
  const kpiClass = (v, good, warn) => (v == null ? '' : v >= good ? 'good' : v >= warn ? 'warn' : 'bad');

  $app.innerHTML = `${topbar()}<main>
    <div class="detail-head">
      <div style="flex:1;min-width:240px">
        <a href="#/" class="small">← Zur Übersicht</a>
        <h1 style="margin-top:4px">${esc(p.title)}</h1>
        <div class="muted small">${esc([p.address, p.city].filter(Boolean).join(', ') || 'Adresse unbekannt')} · angelegt von ${esc(p.created_by || '?')} am ${date(p.created_at)}</div>
      </div>
      <div class="row">
        <select id="statusSel" style="width:auto">${CONFIG.statuses.map((s) => `<option value="${s.key}" ${s.key === p.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <button class="btn danger small" id="del">Löschen</button>
      </div>
    </div>

    <nav class="stepper">${CONFIG.statuses.map((s, i) => `<button class="step ${i === idx ? 'current' : i < idx && p.status !== 'abgelehnt' ? 'done' : ''} ${s.key === 'abgelehnt' ? 'rejected' : ''}" data-status="${s.key}">
      <div class="n">${s.key === 'abgelehnt' ? '✕' : `Schritt ${i + 1}`}</div>${esc(s.label)}</button>`).join('')}</nav>

    <div class="grid">
      <div class="stack">
        <section class="card">
          <div class="section-head"><h2>Bilder</h2><span class="muted small">${images.length}</span><span class="spacer"></span>
            <button class="btn small" data-upload="camera" title="Foto aufnehmen">📷 Kamera</button><button class="btn small" data-upload="image">+ Bilder</button></div>
          ${images.length ? `<div class="gallery-main" id="gmain" style="background-image:url('${esc(images[0].url)}')"></div>
          <div class="thumbs">${images.map((im, i) => `<div class="thumb ${i === 0 ? 'active' : ''}" data-i="${i}" style="background-image:url('${esc(im.url)}')">${im.is_cover ? '<span class="badge cover-tag">Titel</span>' : ''}</div>`).join('')}</div>
          <div class="row small" style="margin-top:8px"><button class="btn small" id="setCover">Als Titelbild</button><button class="btn small danger" id="delImg">Bild löschen</button></div>`
          : '<div class="dropzone" data-upload="image">📷 Noch keine Bilder – klicken oder hierher ziehen</div>'}
        </section>

        <section class="card">
          <div class="section-head"><h2>Kennzahlen</h2><span class="muted small">automatisch berechnet</span></div>
          <div class="kpis">
            <div class="kpi"><div class="v">${eur(p.price)}</div><div class="l">Kaufpreis</div></div>
            <div class="kpi"><div class="v">${f.ppsqm ? eur(f.ppsqm) : '–'}</div><div class="l">Preis pro m²</div></div>
            <div class="kpi ${kpiClass(f.yieldGross, 0.05, 0.035)}"><div class="v">${pct(f.yieldGross)}</div><div class="l">Bruttomietrendite</div></div>
            <div class="kpi ${f.factor == null ? '' : f.factor <= 20 ? 'good' : f.factor <= 28 ? 'warn' : 'bad'}"><div class="v">${f.factor ? `${nf(f.factor, 1)}×` : '–'}</div><div class="l">Kaufpreisfaktor</div></div>
            <div class="kpi"><div class="v">${eur(f.extra)}</div><div class="l">Nebenkosten (~${nf(NEBENKOSTEN * 100, 1)} %)</div></div>
            <div class="kpi"><div class="v">${eur(f.total)}</div><div class="l">Gesamtinvest</div></div>
            <div class="kpi ${kpiClass(f.yieldNet, 0.04, 0.03)}"><div class="v">${pct(f.yieldNet)}</div><div class="l">Nettorendite (grob)</div></div>
            <div class="kpi"><div class="v">${p.rent_yearly ? eur(p.rent_yearly / 12) : '–'}</div><div class="l">Kaltmiete / Monat</div></div>
          </div>
        </section>

        <section class="card">
          <div class="section-head"><h2>Eckdaten</h2><span class="spacer"></span><button class="btn small primary" id="saveData" disabled>Speichern</button></div>
          <form id="dataForm" class="form-grid">
            <div class="full"><label>Titel</label><input name="title" value="${esc(p.title)}" required /></div>
            <div class="full"><label>Adresse</label><input name="address" value="${esc(p.address)}" /></div>
            <div><label>Ort</label><input name="city" value="${esc(p.city)}" /></div>
            <div><label>Objektart</label><select name="type">${['', 'Eigentumswohnung', 'Einfamilienhaus', 'Mehrfamilienhaus', 'Wohn- und Geschäftshaus', 'Gewerbe', 'Grundstück', 'Sonstiges'].map((t) => `<option ${t === (p.type || '') ? 'selected' : ''} value="${t}">${t || '–'}</option>`).join('')}</select></div>
            <div><label>Kaufpreis (€)</label><input name="price" inputmode="decimal" value="${p.price ?? ''}" /></div>
            <div><label>Wohnfläche (m²)</label><input name="living_area" inputmode="decimal" value="${p.living_area ?? ''}" /></div>
            <div><label>Grundstück (m²)</label><input name="plot_area" inputmode="decimal" value="${p.plot_area ?? ''}" /></div>
            <div><label>Zimmer</label><input name="rooms" inputmode="decimal" value="${p.rooms ?? ''}" /></div>
            <div><label>Einheiten</label><input name="units" inputmode="numeric" value="${p.units ?? ''}" /></div>
            <div><label>Baujahr</label><input name="year_built" inputmode="numeric" value="${p.year_built ?? ''}" /></div>
            <div><label>Kaltmiete p. a. (€)</label><input name="rent_yearly" inputmode="decimal" value="${p.rent_yearly ?? ''}" /></div>
            <div><label>Hausgeld / Monat (€)</label><input name="hausgeld" inputmode="decimal" value="${p.hausgeld ?? ''}" /></div>
            <div><label>Energieklasse</label><input name="energy_class" value="${esc(p.energy_class)}" /></div>
            <div><label>Quelle / Makler</label><input name="source" value="${esc(p.source)}" /></div>
            <div class="full"><label>Kontakt</label><input name="contact" value="${esc(p.contact)}" /></div>
            <div class="full"><label>Link</label><div class="row" style="flex-wrap:nowrap"><input name="link" value="${esc(p.link)}" />${p.link ? `<a class="btn small" href="${esc(p.link)}" target="_blank" rel="noopener">Öffnen</a>` : ''}</div></div>
            <div class="full"><label>Notizen</label><textarea name="notes">${esc(p.notes)}</textarea></div>
          </form>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="section-head"><h2>Bewertung</h2><span class="spacer"></span>${stars(p.avg)}</div>
          <div class="rating-card" id="myRating">
            <div class="row"><b>${esc(CONFIG.user)}</b> <span class="muted small">(du)</span></div>
            ${CONFIG.criteria.map((c) => `<div class="crit"><span>${esc(c.label)}</span><span class="star-input" data-crit="${c.key}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${(mine.scores[c.key] || 0) >= n ? 'on' : ''}" aria-label="${n} Sterne">★</button>`).join('')}</span></div>`).join('')}
            <div class="verdict-pick">${['ja', 'vielleicht', 'nein'].map((v) => `<button type="button" data-v="${v}" class="${v} ${mine.verdict === v ? 'on' : ''}">${v === 'ja' ? '👍 Kaufen' : v === 'nein' ? '👎 Nein' : '🤔 Vielleicht'}</button>`).join('')}</div>
            <textarea id="myComment" placeholder="Deine Einschätzung …">${esc(mine.comment)}</textarea>
            <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small primary" id="saveRating">Bewertung speichern</button></div>
          </div>
          ${others.map((r) => `<div class="rating-card">
            <div class="row"><b>${esc(r.user)}</b><span class="spacer"></span>${r.verdict ? `<span class="verdict ${r.verdict}">${verdictLabel[r.verdict]}</span>` : ''}</div>
            ${CONFIG.criteria.map((c) => `<div class="crit"><span>${esc(c.label)}</span>${r.scores[c.key] ? stars(r.scores[c.key]) : '<span class="muted small">–</span>'}</div>`).join('')}
            ${r.comment ? `<p style="white-space:pre-wrap;margin:8px 0 0">${esc(r.comment)}</p>` : ''}
            <div class="muted small" style="margin-top:6px">${date(r.updated_at)}</div></div>`).join('')}
          ${CONFIG.users.filter((u) => u !== CONFIG.user && !others.some((r) => r.user === u)).map((u) => `<div class="rating-card muted small">${esc(u)} hat noch nicht bewertet.</div>`).join('')}
        </section>

        <section class="card ai">
          <div class="section-head"><h2>KI-Analyse</h2><span class="spacer"></span>
            ${CONFIG.aiEnabled ? `<button class="btn small" id="analyze" ${p.ai_status === 'running' ? 'disabled' : ''}>${p.ai_analysis ? 'Neu analysieren' : 'Exposé analysieren'}</button>` : ''}</div>
          ${aiBlock(p)}
        </section>

        <section class="card">
          <div class="section-head"><h2>Exposés &amp; Dokumente</h2><span class="spacer"></span><button class="btn small" data-upload="expose">+ Datei</button></div>
          <div class="files-list">${docs.map((d) => `<div class="file-row">
            <span class="file-icon">${esc((d.original_name || '').split('.').pop().toUpperCase().slice(0, 4) || 'DOC')}</span>
            <a class="name" href="${esc(d.url)}" data-signed="${esc(d.signed_url)}" target="_blank" rel="noopener">${esc(d.original_name)}</a>
            <span class="muted small">${nf((d.size || 0) / 1048576, 1)} MB</span>
            <button class="btn small ghost danger" data-delfile="${d.id}" title="Löschen">✕</button></div>`).join('') || '<div class="dropzone" data-upload="expose">📄 Exposé-PDF hochladen</div>'}</div>
        </section>

        <section class="card">
          <div class="section-head"><h2>Verlauf &amp; Kommentare</h2></div>
          <form id="commentForm" class="row" style="flex-wrap:nowrap;margin-bottom:8px"><input name="text" placeholder="Kommentar, z. B. Besichtigung am …" /><button class="btn primary small">Senden</button></form>
          <ul class="timeline">${p.activity.map((a) => `<li><div class="when">${date(a.created_at)} · ${esc(a.user || '')}</div>
            <div class="${a.type === 'comment' ? 'comment' : 'muted'}">${a.type === 'comment' ? '💬 ' : a.type === 'status' ? '➜ ' : a.type === 'ai' ? '✨ ' : a.type === 'upload' ? '📎 ' : '• '}${esc(a.text)}</div></li>`).join('')}</ul>
        </section>
      </div>
    </div>
    <input type="file" id="upl" multiple hidden />
  </main>`;
  if (keepScroll) window.scrollTo(0, y);
  const curStep = $app.querySelector('.step.current');
  if (curStep) curStep.parentElement.scrollLeft = curStep.offsetLeft - 16;
  bindTopbar($app);
  const reload = () => renderDetail(id, true);

  // Status
  const setStatus = async (s) => {
    if (s === p.status) return;
    try { await api(`/api/properties/${id}/status`, { method: 'PUT', body: { status: s } }); toast(`Status: ${status(s).label}`); reload(); } catch (e) { fail(e); }
  };
  document.getElementById('statusSel').onchange = (e) => setStatus(e.target.value);
  $app.querySelectorAll('.step').forEach((b) => (b.onclick = () => setStatus(b.dataset.status)));
  document.getElementById('del').onclick = async () => {
    if (!confirm(`„${p.title}“ inklusive aller Dateien endgültig löschen?`)) return;
    try { await api(`/api/properties/${id}`, { method: 'DELETE' }); toast('Gelöscht'); location.hash = '#/'; } catch (e) { fail(e); }
  };

  // Uploads
  const upl = document.getElementById('upl');
  const doUpload = async (fileList, kind) => {
    if (!fileList.length) return;
    const fd = new FormData();
    if (kind === 'image') fd.append('kind', 'image');
    [...fileList].forEach((fl) => fd.append('files', fl));
    toast('Lade hoch …');
    try { await api(`/api/properties/${id}/files`, { method: 'POST', body: fd }); toast('Hochgeladen'); reload(); } catch (e) { fail(e); }
  };
  $app.querySelectorAll('[data-upload]').forEach((el) => {
    const kind = el.dataset.upload;
    el.onclick = () => {
      upl.accept = kind === 'expose' ? 'application/pdf,image/*,.doc,.docx,.xls,.xlsx' : 'image/*';
      if (kind === 'camera') upl.setAttribute('capture', 'environment'); else upl.removeAttribute('capture');
      upl.onchange = () => { doUpload(upl.files, kind === 'camera' ? 'image' : kind); upl.value = ''; };
      upl.click();
    };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); };
    el.ondragleave = () => el.classList.remove('over');
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); doUpload(e.dataTransfer.files, kind); };
  });
  $app.querySelectorAll('[data-delfile]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Datei löschen?')) return;
    try { await api(`/api/files/${b.dataset.delfile}`, { method: 'DELETE' }); reload(); } catch (e) { fail(e); }
  }));

  // Galerie
  if (images.length) {
    let cur = 0;
    const gmain = document.getElementById('gmain');
    const select = (i) => {
      cur = i;
      gmain.style.backgroundImage = `url('${images[i].url}')`;
      $app.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('active', Number(t.dataset.i) === i));
    };
    $app.querySelectorAll('.thumb').forEach((t) => (t.onclick = () => select(Number(t.dataset.i))));
    gmain.onclick = () => openLightbox(images.map((im) => im.url), cur);
    document.getElementById('setCover').onclick = async () => { try { await api(`/api/files/${images[cur].id}`, { method: 'PATCH', body: { is_cover: true } }); toast('Titelbild gesetzt'); reload(); } catch (e) { fail(e); } };
    document.getElementById('delImg').onclick = async () => { if (!confirm('Bild löschen?')) return; try { await api(`/api/files/${images[cur].id}`, { method: 'DELETE' }); reload(); } catch (e) { fail(e); } };
  }

  // Eckdaten
  const dataForm = document.getElementById('dataForm');
  const saveBtn = document.getElementById('saveData');
  dataForm.oninput = () => (saveBtn.disabled = false);
  const save = async () => {
    const body = Object.fromEntries(new FormData(dataForm));
    try { await api(`/api/properties/${id}`, { method: 'PATCH', body }); toast('Gespeichert'); reload(); } catch (e) { fail(e); }
  };
  saveBtn.onclick = save;
  dataForm.onsubmit = (e) => { e.preventDefault(); save(); };

  // Bewertung
  const my = { scores: { ...mine.scores }, verdict: mine.verdict };
  $app.querySelectorAll('.star-input').forEach((si) => si.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const n = Number(b.dataset.n);
    my.scores[si.dataset.crit] = my.scores[si.dataset.crit] === n ? 0 : n;
    si.querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) <= my.scores[si.dataset.crit]));
  })));
  $app.querySelectorAll('.verdict-pick button').forEach((b) => (b.onclick = () => {
    my.verdict = my.verdict === b.dataset.v ? null : b.dataset.v;
    $app.querySelectorAll('.verdict-pick button').forEach((x) => x.classList.toggle('on', x.dataset.v === my.verdict));
  }));
  document.getElementById('saveRating').onclick = async () => {
    try { await api(`/api/properties/${id}/rating`, { method: 'PUT', body: { ...my, comment: document.getElementById('myComment').value } }); toast('Bewertung gespeichert'); reload(); } catch (e) { fail(e); }
  };

  // KI
  const ab = document.getElementById('analyze');
  if (ab) ab.onclick = async () => { try { await api(`/api/properties/${id}/analyze`, { method: 'POST' }); toast('KI-Analyse gestartet'); reload(); } catch (e) { fail(e); } };
  if (p.ai_status === 'running') pollTimer = setTimeout(() => { if (location.hash === `#/p/${id}`) reload(); }, 4000);

  // Kommentare
  const cf = document.getElementById('commentForm');
  cf.onsubmit = async (e) => {
    e.preventDefault();
    if (!cf.text.value.trim()) return;
    try { await api(`/api/properties/${id}/comments`, { method: 'POST', body: { text: cf.text.value } }); reload(); } catch (er) { fail(er); }
  };
}

function aiBlock(p) {
  if (p.ai_status === 'running') return '<div class="row muted"><span class="spinner"></span> Exposé wird analysiert … (dauert meist 1–2 Minuten)</div>';
  const err = p.ai_status === 'error' ? `<p style="color:var(--danger)" class="small">Fehler: ${esc(p.ai_error)}</p>` : '';
  if (!p.ai_analysis) {
    return err + (CONFIG.aiEnabled
      ? '<p class="muted small">Noch keine Analyse. Lade ein Exposé-PDF hoch und starte die Analyse – Eckdaten werden automatisch übernommen und die Immobilie wird eingeschätzt.</p>'
      : '<p class="muted small">KI-Analyse ist deaktiviert. Setze <code>ANTHROPIC_API_KEY</code> auf dem Server, um Exposés automatisch auswerten zu lassen.</p>');
  }
  const a = p.ai_analysis.assessment;
  const list = (title, items) => (items?.length ? `<h3>${title}</h3><ul class="ai-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
  return `${err}<div class="row"><span class="ai-score">${a.score}<span class="muted" style="font-size:1rem">/10</span></span><span class="muted small">analysiert ${date(p.ai_at)}</span></div>
    <p>${esc(a.summary)}</p>${list('👍 Stärken', a.pros)}${list('👎 Schwächen', a.cons)}${list('⚠️ Risiken', a.risks)}${list('❓ Fragen an den Makler', a.questions)}${list('📋 Fehlende Unterlagen', a.missing_documents)}`;
}

function openLightbox(urls, start) {
  let i = start;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img alt="" /><button class="close" aria-label="Schließen">✕</button>${urls.length > 1 ? '<button class="nav prev">‹</button><button class="nav next">›</button>' : ''}`;
  const img = lb.querySelector('img');
  const show = () => (img.src = urls[i]);
  const go = (d) => { i = (i + d + urls.length) % urls.length; show(); };
  const close = () => { lb.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
  lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains('close')) close(); };
  lb.querySelector('.prev')?.addEventListener('click', () => go(-1));
  lb.querySelector('.next')?.addEventListener('click', () => go(1));
  document.addEventListener('keydown', key);
  document.body.appendChild(lb);
  show();
}

// ---------- Start ----------
(async () => {
  CONFIG = await (await fetch('/api/config')).json();
  route();
})();
