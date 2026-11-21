/* Carnet de santé des chats — PWA 100 % locale + synchronisation Google Drive privée */
(() => {
'use strict';

const APP_VERSION = '1.0.0', APP_DATE = '19/11/2026';
const KEY = 'carnetChats.v1.data', SKEY = 'carnetChats.v1.settings';
const COLS = ['cats', 'weights', 'events', 'files', 'notes', 'contacts', 'heats', 'presets'];
const CFG = window.CARNET_CONFIG || {};
const CATCOLORS = ['#00968a', '#f5a623', '#ef6f6c', '#7e57c2', '#29b6f6'];

/* ---------- Utilitaires ---------- */
const $ = (s, e = document) => e.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dateObj = s => new Date(s + 'T00:00:00');
const fmtDate = s => s ? dateObj(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtKg = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kg';
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
function addMonths(s, m) {
  const d = dateObj(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + Math.round(m));
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const daysUntil = s => Math.round((dateObj(s) - dateObj(todayStr())) / 864e5);
const age = b => {
  if (!b) return '—';
  const d = dateObj(b), n = new Date();
  let m = (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth();
  if (n.getDate() < d.getDate()) m--;
  if (m < 0) return '—';
  if (m < 12) return m + ' mois';
  const y = Math.floor(m / 12), r = m % 12;
  return y + (y > 1 ? ' ans' : ' an') + (r ? ' ' + r + ' m' : '');
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

const SVG = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 19a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.6 8.6 4.7 4.7 0 0 1 17.5 19z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>'
};

/* ---------- Données ---------- */
const DEFAULT_PRESETS = [
  { id: 'p-tcc', type: 'vaccin', title: 'Typhus / Coryza / Chlamydiose (TCC)', months: 12 },
  { id: 'p-felv', type: 'vaccin', title: 'Leucose (FeLV)', months: 12 },
  { id: 'p-rage', type: 'vaccin', title: 'Rage', months: 12 },
  { id: 'p-verm', type: 'vermifuge', title: 'Vermifuge', months: 3 },
  { id: 'p-puces', type: 'antiparasitaire', title: 'Anti-puces / tiques', months: 1 }
];
const fill = d => {
  COLS.forEach(c => { if (!Array.isArray(d[c])) d[c] = []; });
  DEFAULT_PRESETS.forEach(p => { if (!d.presets.some(x => x.id === p.id)) d.presets.push({ ...p, updatedAt: '2000-01-01T00:00:00.000Z' }); });
  d.v = 1; return d;
};
let D = (() => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && typeof d === 'object') return fill(d); } catch (e) {} return fill({}); })();
let settings = Object.assign({ alertDays: 30, clientId: '', driveConnected: false, dirty: false, lastSync: null },
  (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })());
const saveLocal = () => localStorage.setItem(KEY, JSON.stringify(D));
const saveSettings = () => localStorage.setItem(SKEY, JSON.stringify(settings));
const live = c => D[c].filter(x => !x.deleted);
const byId = (c, id) => D[c].find(x => x.id === id && !x.deleted);

function save() { saveLocal(); settings.dirty = true; saveSettings(); refreshCloud(); scheduleSync(); }
function upsert(col, obj) {
  obj.updatedAt = nowISO();
  const i = D[col].findIndex(x => x.id === obj.id);
  if (i >= 0) D[col][i] = obj; else D[col].push(obj);
  save(); return obj;
}
function remove(col, id) {
  const o = D[col].find(x => x.id === id);
  if (o) { o.deleted = true; o.updatedAt = nowISO(); }
  if (col === 'cats') COLS.filter(c => c !== 'cats' && c !== 'contacts').forEach(c => D[c].forEach(x => {
    if (x.catId === id && !x.deleted) { x.deleted = true; x.cascade = id; x.updatedAt = nowISO(); }
  }));
  save();
}
function mergeInto(remote) {
  if (!remote || typeof remote !== 'object') return;
  COLS.forEach(c => {
    if (!Array.isArray(remote[c])) return;
    remote[c].forEach(r => {
      if (!r || !r.id) return;
      const i = D[c].findIndex(x => x.id === r.id);
      if (i < 0) D[c].push(r);
      else if ((r.updatedAt || '') > (D[c][i].updatedAt || '')) D[c][i] = r;
    });
  });
}

/* ---------- Blobs (photos, documents) dans IndexedDB ---------- */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open('carnetChats', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('blobs');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await idb;
  return new Promise((res, rej) => {
    const t = db.transaction('blobs', mode); const rq = fn(t.objectStore('blobs'));
    t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
  });
};
const putBlob = (id, b) => tx('readwrite', s => s.put(b, id));
const getBlob = id => tx('readonly', s => s.get(id));
const delBlob = id => tx('readwrite', s => s.delete(id));
const urls = new Map();
async function urlFor(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await getBlob(id); if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(id, u); return u;
}
async function hydrate() {
  for (const el of document.querySelectorAll('[data-blob]')) {
    const u = await urlFor(el.dataset.blob);
    if (u) { if (el.tagName === 'IMG') el.src = u; else el.style.backgroundImage = `url(${u})`; }
  }
}
async function shrink(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .82));
}
const pick = (accept, multiple) => new Promise(res => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = !!multiple;
  i.onchange = () => res([...i.files]); i.click();
});
const dateOfFile = f => { const d = new Date(f.lastModified || Date.now()); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/* ---------- Référentiels ---------- */
const EV = {
  vaccin: { l: 'Vaccin', i: '💉', g: 'vaccin' }, rappel: { l: 'Rappel de vaccin', i: '💉', g: 'vaccin' },
  antiparasitaire: { l: 'Antiparasitaire (puces/tiques)', i: '🐛', g: 'prev' }, vermifuge: { l: 'Vermifuge', i: '🪱', g: 'prev' },
  traitement: { l: 'Traitement / médicament', i: '💊', g: 'trait' }, consultation: { l: 'Consultation vétérinaire', i: '🩺', g: 'consult' },
  analyse: { l: 'Analyses / bilan', i: '🧪', g: 'consult' }, dentaire: { l: 'Soins dentaires', i: '🦷', g: 'consult' },
  chirurgie: { l: 'Chirurgie / stérilisation', i: '🏥', g: 'consult' }, autre: { l: 'Autre', i: '📝', g: 'consult' }
};
const EVFILTERS = [['all', 'Tout'], ['vaccin', 'Vaccins'], ['prev', 'Prévention'], ['trait', 'Traitements'], ['consult', 'Consultations']];
const DOCCATS = ['Carnet de vaccination', 'Ordonnance', 'Compte-rendu', 'Analyses', 'Facture', 'Assurance', 'Identification', 'Autre'];
const CONTACTLABELS = ['Vétérinaire', 'Urgences vétérinaires', 'Clinique de garde', 'Assurance', 'Pension / garde', 'Éleveur', 'Autre'];

const FORMS = {
  cats: { t: 'Fiche du chat', f: [
    { k: 'name', l: 'Nom', req: 1 }, { k: 'breed', l: 'Race', ph: 'ex. Européen, Maine Coon…' }, { k: 'coat', l: 'Robe / couleur' },
    { k: 'sex', l: 'Sexe', type: 'select', o: ['Femelle', 'Mâle'] }, { k: 'birth', l: 'Date de naissance', type: 'date' },
    { k: 'adopt', l: "Date d'adoption", type: 'date' }, { k: 'sterilized', l: 'Stérilisé(e)', type: 'checkbox' },
    { k: 'chip', l: 'N° de puce / identification' }, { k: 'chipPos', l: 'Emplacement de la puce', ph: 'ex. entre les omoplates' },
    { k: 'tattoo', l: 'Tatouage' }, { k: 'food', l: 'Alimentation', ph: 'croquettes, pâtée, marque…' },
    { k: 'special', l: 'Allergies / particularités', type: 'textarea' }] },
  weights: { t: 'Pesée', f: [{ k: 'date', l: 'Date', type: 'date', req: 1 }, { k: 'kg', l: 'Poids (kg)', type: 'number', req: 1, ph: 'ex. 4,2' }, { k: 'note', l: 'Note' }] },
  events: { t: 'Soin / santé', f: [
    { k: 'type', l: 'Type', type: 'select', o: Object.entries(EV).map(([k, v]) => [k, v.i + ' ' + v.l]) },
    { k: 'title', l: 'Intitulé', ph: 'ex. Typhus-Coryza, Frontline, Contrôle annuel…' },
    { k: 'date', l: 'Date', type: 'date', req: 1 }, { k: 'due', l: 'Prochain rappel (optionnel)', type: 'date' },
    { k: 'vet', l: 'Vétérinaire / clinique' }, { k: 'cost', l: 'Coût (€)', type: 'number' }, { k: 'notes', l: 'Notes', type: 'textarea' }] },
  notes: { t: 'Note', f: [{ k: 'title', l: 'Titre', req: 1 }, { k: 'date', l: 'Date', type: 'date' }, { k: 'text', l: 'Texte', type: 'textarea' }] },
  contacts: { t: 'Contact clé', f: [
    { k: 'label', l: 'Rôle', type: 'select', o: CONTACTLABELS }, { k: 'name', l: 'Nom', req: 1 },
    { k: 'phone', l: 'Téléphone', type: 'tel' }, { k: 'address', l: 'Adresse' }, { k: 'notes', l: 'Notes', type: 'textarea' }] },
  heats: { t: 'Période de chaleurs', f: [{ k: 'start', l: 'Début', type: 'date', req: 1 }, { k: 'end', l: 'Fin', type: 'date' }, { k: 'notes', l: 'Notes', type: 'textarea' }] },
  presets: { t: 'Modèle de soin', f: [
    { k: 'type', l: 'Catégorie', type: 'select', o: [['vaccin', '💉 Vaccin'], ['vermifuge', '🪱 Vermifuge'], ['antiparasitaire', '🐛 Anti-puces / tiques'], ['traitement', '💊 Traitement']] },
    { k: 'title', l: 'Nom', req: 1, ph: 'ex. Typhus-Coryza' },
    { k: 'months', l: 'Rappel tous les (mois) — vide = pas de rappel', type: 'number', ph: 'ex. 12' }] },
  files: { t: 'Fichier', f: [{ k: 'title', l: 'Titre' }, { k: 'cat', l: 'Catégorie', type: 'select', o: DOCCATS }, { k: 'date', l: 'Date', type: 'date' }] }
};

/* ---------- Navigation ---------- */
const S = { view: 'home', catId: null, tab: 'profil', plus: 'docs', filter: 'all', range: 12, sub: null };
let sheetOpen = false, ignorePop = false, afterPop = null;
const depth = () => (history.state && history.state.d) || 0;
function go(patch, push = true) {
  Object.assign(S, patch);
  if (push) history.pushState({ S: { ...S }, d: depth() + 1 }, ''); else history.replaceState({ S: { ...S }, d: depth() }, '');
  render();
}
if (history.state && history.state.S) Object.assign(S, history.state.S);
history.replaceState({ S: { ...S }, d: depth() }, '');
addEventListener('popstate', e => {
  if (ignorePop) { ignorePop = false; const f = afterPop; afterPop = null; if (f) f(); return; }
  if (sheetOpen) { closeSheet(true); return; }
  if (e.state && e.state.S) Object.assign(S, e.state.S); else Object.assign(S, { view: 'home', catId: null });
  render();
});
function openSheet(html, cls = '') {
  $('#sheet').innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet ${cls}">${html}</div>`;
  $('#sheet').classList.add('open');
  if (!sheetOpen) { sheetOpen = true; history.pushState({ sheet: 1, S: { ...S }, d: depth() }, ''); }
}
function closeSheet(fromPop, then) {
  if (!sheetOpen) { if (then) then(); return; }
  $('#sheet').classList.remove('open'); $('#sheet').innerHTML = ''; sheetOpen = false;
  if (!fromPop) { ignorePop = true; afterPop = then || null; history.back(); } else if (then) then();
}

/* ---------- Formulaires génériques ---------- */
function form({ title, fields, values = {}, onSave, onDelete, extra = '' }) {
  const fh = fields.map(f => {
    const v = values[f.k] ?? '';
    const id = 'f_' + f.k;
    if (f.type === 'checkbox') return `<div class="fld chk"><label><input type="checkbox" id="${id}" ${values[f.k] ? 'checked' : ''}>${esc(f.l)}</label></div>`;
    let inp;
    if (f.type === 'select') inp = `<select id="${id}">${f.o.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${ov === v ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    else if (f.type === 'textarea') inp = `<textarea id="${id}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
    else if (f.type === 'file') inp = `<input type="file" id="${id}" accept="${esc(f.accept || '')}">`;
    else if (f.type === 'number') inp = `<input id="${id}" inputmode="decimal" autocomplete="off" placeholder="${esc(f.ph || '')}" value="${esc(v)}">`;
    else inp = `<input id="${id}" type="${f.type || 'text'}" autocomplete="off" placeholder="${esc(f.ph || '')}" value="${esc(v)}">`;
    return `<div class="fld"><label for="${id}">${esc(f.l)}${f.req ? ' *' : ''}</label>${inp}</div>`;
  }).join('');
  openSheet(`<h2>${esc(title)}</h2><form id="gform" novalidate>${fh}${extra}
    <div class="acts">${onDelete ? '<button type="button" class="btn danger" data-act="form-del">Supprimer</button>' : ''}
    <button type="button" class="btn line" data-act="sheet-close">Annuler</button><button type="submit" class="btn">Enregistrer</button></div></form>`);
  const fe = $('#gform');
  fe.onsubmit = async ev => {
    ev.preventDefault();
    const out = {};
    for (const f of fields) {
      const el = $('#f_' + f.k);
      if (f.type === 'checkbox') out[f.k] = el.checked;
      else if (f.type === 'file') out[f.k] = el.files[0] || null;
      else if (f.type === 'number') out[f.k] = el.value.trim() === '' ? null : num(el.value);
      else out[f.k] = el.value.trim();
      if (f.req && (out[f.k] === '' || out[f.k] === null)) { toast(`« ${f.l} » est requis`); el.focus(); return; }
    }
    await onSave(out);
  };
  form.del = onDelete;
}

function defaults(col) {
  const t = todayStr();
  return { weights: { date: t }, events: { type: 'vaccin', date: t }, notes: { date: t }, contacts: { label: 'Vétérinaire' },
    cats: { sex: 'Femelle' }, presets: { type: 'vaccin', months: 12 }, heats: { start: t }, files: { date: t, cat: DOCCATS[0] } }[col] || {};
}
function presetField() {
  const ps = live('presets').sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  return { k: 'preset', l: 'Modèle (remplit le titre et le rappel)', type: 'select', o: [['', '— Saisie libre —'], ...ps.map(p => [p.id, (EV[p.type]?.i || '') + ' ' + p.title])] };
}
function openEdit(col, id, preset) {
  const def = FORMS[col], cur = id ? byId(col, id) : null;
  form({
    title: (cur ? 'Modifier — ' : 'Ajouter — ') + def.t, fields: col === 'events' && !cur ? [presetField(), ...def.f] : def.f, values: cur || { ...defaults(col), ...preset },
    onSave: async v => {
      const obj = { ...(cur || { id: uid(), color: col === 'cats' ? CATCOLORS[live('cats').length % CATCOLORS.length] : undefined }), ...v };
      if (col !== 'cats' && col !== 'contacts' && col !== 'presets') obj.catId = cur ? cur.catId : S.catId;
      delete obj.preset;
      if (col === 'weights' && !(v.kg > 0)) { toast('Poids invalide'); return; }
      if (col === 'events' && !v.title) obj.title = EV[v.type].l;
      if (col === 'events' && v.due && (!cur || cur.due !== v.due)) obj.done = false;
      upsert(col, obj);
      if (col === 'cats' && !cur) { closeSheet(false, () => go({ view: 'cat', catId: obj.id, tab: 'profil', filter: 'all' })); return; }
      closeSheet(); render();
    },
    onDelete: cur ? () => {
      if (!confirm(col === 'cats' ? `Supprimer ${cur.name} et toutes ses données ?` : 'Supprimer cet élément ?')) return;
      if (col === 'files') delBlob(cur.id).catch(() => {});
      remove(col, cur.id); closeSheet();
      if (col === 'cats') { S.view = 'home'; S.catId = null; }
      render();
    } : null
  });
  if (col === 'events' && !cur) {
    const sel = $('#f_preset'), dt = $('#f_date'), due = $('#f_due'), ty = $('#f_type'), ti = $('#f_title');
    let auto = !due.value;
    const chosen = () => D.presets.find(p => p.id === sel.value && !p.deleted);
    const match = () => live('presets').find(p => p.type === ty.value && p.title.toLowerCase() === ti.value.trim().toLowerCase());
    const compute = p => { if (p && p.months > 0 && dt.value) due.value = addMonths(dt.value, p.months); };
    sel.onchange = () => { const p = chosen(); if (!p) return; ty.value = p.type; ti.value = p.title; auto = true; compute(p); };
    dt.onchange = () => { if (auto) compute(chosen() || match()); };
    due.oninput = () => { auto = false; };
    const m = match();
    if (m && !due.value) { sel.value = m.id; compute(m); }
  }
}

/* ---------- Rappels ---------- */
const reminders = catId => live('events').filter(e => e.due && !e.done && byId('cats', e.catId) && (!catId || e.catId === catId))
  .sort((a, b) => a.due.localeCompare(b.due));
function dueInfo(due) {
  const d = daysUntil(due);
  if (d < 0) return { cls: 'late', txt: `En retard de ${-d} j` };
  if (d === 0) return { cls: 'soon', txt: "Aujourd'hui" };
  const txt = d > 60 ? `Dans ${Math.round(d / 30)} mois` : `Dans ${d} j`;
  return { cls: d <= settings.alertDays ? 'soon' : 'ok', txt };
}

/* ---------- Rendu ---------- */
const avatarHTML = (cat, cls = '') => cat.avatarId
  ? `<div class="av ${cls}"><img data-blob="${esc(cat.avatarId)}" alt=""></div>` : `<div class="av ${cls}">🐱</div>`;
function cloudBtn() {
  const st = syncing ? 'sync' : !settings.driveConnected ? 'off' : settings.dirty ? 'dirty' : 'ok';
  return `<button class="ic cloud ${st}" data-act="sync" aria-label="Synchroniser avec Google Drive">${SVG.cloud}<i></i></button>`;
}
function refreshCloud() {
  const st = syncing ? 'sync' : !settings.driveConnected ? 'off' : settings.dirty ? 'dirty' : 'ok';
  document.querySelectorAll('.cloud').forEach(b => { b.className = 'ic cloud ' + st; });
}
let lastKey = '';
function render() {
  const key = S.view + S.catId + S.tab + S.plus + S.sub;
  const sc = $('main') ? $('main').scrollTop : 0;
  const cat = S.catId ? byId('cats', S.catId) : null;
  if (S.view === 'cat' && !cat) { S.view = 'home'; S.catId = null; }
  $('#app').className = S.view === 'home' ? 'home' : '';
  $('#app').innerHTML = S.view === 'settings' ? viewSettings() : S.view === 'cat' ? viewCat(byId('cats', S.catId)) : viewHome();
  if (key === lastKey && $('main')) $('main').scrollTop = sc;
  lastKey = key; hydrate();
}

function viewHome() {
  const cats = live('cats');
  const rem = reminders().filter(e => daysUntil(e.due) <= settings.alertDays);
  const n = cats.length;
  const tribe = cats.slice(0, 5).map(c => c.avatarId
    ? `<div class="tav"><img data-blob="${esc(c.avatarId)}" alt=""></div>` : `<div class="tav">🐱</div>`).join('');
  let h = `<header class="top"><button class="ic" data-act="settings" aria-label="Menu">${SVG.menu}</button><span class="grow"></span>${cloudBtn()}</header><main class="home-main">
    <div class="paw p1">🐾</div><div class="paw p2">🐾</div>
    ${n ? `<div class="tribe">${tribe}</div>` : ''}
    <h1 class="tribu">Toute la tribu</h1>
    <p class="tribu-sub">${n ? `${n} petite${n > 1 ? 's' : ''} boule${n > 1 ? 's' : ''} de poils, un seul carnet` : 'Un carnet de santé pour tes chats'}</p>`;
  if (!n) h += `<div class="tcard empty-t"><span class="big">🐾</span><b>Bienvenue !</b><div class="muted">Crée la fiche de ton premier chat pour commencer le carnet de santé.</div></div>`;
  h += cats.map(c => {
    const ws = live('weights').filter(w => w.catId === c.id).sort((a, b) => b.date.localeCompare(a.date));
    const rc = reminders(c.id).filter(e => daysUntil(e.due) <= settings.alertDays).length;
    return `<div class="tcard" data-act="open-cat" data-id="${c.id}">${avatarHTML(c, 'big')}
      <div class="grow"><b>${esc(c.name)}</b><div class="muted small">${esc([c.breed, age(c.birth) !== '—' ? age(c.birth) : ''].filter(Boolean).join(' · ') || 'Chat')}</div>
      <div class="small">${ws[0] ? '⚖️ ' + fmtKg(ws[0].kg) : ''} ${rc ? `<span class="badge soon">${rc} rappel${rc > 1 ? 's' : ''}</span>` : ''}</div></div><span class="chev">›</span></div>`;
  }).join('');
  h += `<div class="tcard addt" data-act="add" data-col="cats"><span class="plusc">＋</span><b>Ajouter un chat</b></div>`;
  if (rem.length) {
    h += `<h2 class="home-h2">À ne pas oublier</h2><div class="todo">` + rem.map(e => {
      const c = byId('cats', e.catId), di = dueInfo(e.due);
      return `<div class="todo-i" data-act="open-cat-tab" data-id="${c.id}" data-tab="sante"><span class="yb">${EV[e.type]?.i || '✓'}</span>
        <div class="grow"><b>${esc(e.title)} — ${esc(c.name)}</b><div class="small">${fmtDate(e.due)}</div></div><span class="badge ${di.cls}">${di.txt}</span></div>`;
    }).join('') + `</div>`;
  }
  if (!settings.driveConnected && n) h += `<div class="homehint">☁️ Tes données sont pour l'instant uniquement sur cet appareil. Active la synchronisation Google Drive dans le menu pour les sauvegarder.</div>`;
  return h + '</main>';
}

const TABS = [['profil', '🐱', 'Profil'], ['poids', '⚖️', 'Poids'], ['sante', '🩺', 'Santé'], ['galerie', '🖼️', 'Galerie'], ['plus', '✨', 'Plus']];
function viewCat(cat) {
  const cats = live('cats');
  let body = '', fab = '';
  if (S.tab === 'profil') body = tabProfil(cat);
  else if (S.tab === 'poids') { body = tabPoids(cat); fab = `<button class="fab" data-act="add" data-col="weights">＋ Poids</button>`; }
  else if (S.tab === 'sante') { body = tabSante(cat); fab = `<button class="fab" data-act="add" data-col="events">＋ Soin</button>`; }
  else if (S.tab === 'galerie') body = tabGalerie(cat);
  else { body = tabPlus(cat); fab = S.plus === 'docs' ? `<button class="fab" data-act="doc-add">＋ Document</button>` :
    `<button class="fab" data-act="add" data-col="${{ notes: 'notes', contacts: 'contacts', heats: 'heats' }[S.plus]}">＋ Ajouter</button>`; }
  return `<header class="top"><button class="ic" data-act="back" aria-label="Retour">${SVG.back}</button>
    <div class="pill"><button class="catpill" data-act="switch-cat">${avatarHTML(cat)}<span>${esc(cat.name)}</span>${cats.length > 1 ? ' ⇄' : ''}</button></div>${cloudBtn()}</header>
    <main>${body}</main>${fab}
    <nav class="bar">${TABS.map(([k, e, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><span class="e">${e}</span>${l}</button>`).join('')}</nav>`;
}

function tabProfil(c) {
  const card = (ico, t, v) => `<div class="card kv"><div class="ico">${ico}</div><div><b>${t}</b><span>${esc(v)}</span></div></div>`;
  const rem = reminders(c.id).slice(0, 3);
  let h = `<div class="hero" style="--c:${c.color || CATCOLORS[0]}"><div class="av" data-act="avatar">${c.avatarId ? `<img data-blob="${esc(c.avatarId)}" alt="">` : '🐱'}</div>
    <h2>${esc(c.name)}</h2><div class="muted">Chat${c.breed ? ' · ' + esc(c.breed) : ''}${c.coat ? ' · ' + esc(c.coat) : ''}</div>
    ${c.birth ? `<div class="small">🎂 ${fmtDate(c.birth)}</div>` : ''}</div>
    <div class="chips"><div class="chip"><small>Âge</small><b>${age(c.birth)}</b></div><div class="chip"><small>Stérilisé(e)</small><b>${c.sterilized ? 'Oui' : 'Non'}</b></div><div class="chip"><small>Sexe</small><b>${esc(c.sex || '—')}</b></div></div>`;
  if (rem.length) h += `<div class="card"><h3>⏰ Prochains rappels</h3>${rem.map(e => { const di = dueInfo(e.due); return `<div class="row" style="margin:6px 0"><div class="grow"><b>${esc(e.title)}</b><div class="muted small">${fmtDate(e.due)}</div></div><span class="badge ${di.cls}">${di.txt}</span></div>`; }).join('')}</div>`;
  h += card('🔖', 'Puce', (c.chip || 'Non renseigné') + (c.chipPos ? `\nEmplacement : ${c.chipPos}` : ''));
  if (c.tattoo) h += card('✒️', 'Tatouage', c.tattoo);
  if (c.adopt) h += card('🏡', 'Adopté(e) le', fmtDate(c.adopt));
  if (c.food) h += card('🍽️', 'Alimentation', c.food);
  if (c.special) h += card('⚠️', 'Allergies / particularités', c.special);
  h += `<div class="acts"><button class="btn" data-act="edit" data-col="cats" data-id="${c.id}">${SVG.edit.replace('<svg', '<svg width="18" height="18"')} Modifier la fiche</button></div>`;
  return h;
}

/* Courbe lissée (interpolation monotone : arrondie, sans dépassement entre deux pesées) */
function smoothPath(pts) {
  const f = v => v.toFixed(1), n = pts.length;
  const lin = () => pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join(' ');
  if (n < 3) return lin();
  const dx = [], sl = [], t = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    if (dx[i] <= 0.01) return lin();
    sl[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = sl[0]; t[n - 1] = sl[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / sl[i], b = t[i + 1] / sl[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * sl[i]; t[i + 1] = k * b * sl[i]; }
  }
  let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i][0] + h)} ${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)} ${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  }
  return d;
}
/* Courbe lissée (interpolation cubique monotone : pas de dépassement entre deux pesées) */
function smoothPath(pts) {
  const n = pts.length; if (n < 2) return '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = Math.hypot(a, b);
    if (h > 3) { t[i] = 3 * a / h * m[i]; t[i + 1] = 3 * b / h * m[i]; }
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += ` C${(pts[i][0] + c).toFixed(1)} ${(pts[i][1] + t[i] * c).toFixed(1)} ${(pts[i + 1][0] - c).toFixed(1)} ${(pts[i + 1][1] - t[i + 1] * c).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}
function chart(ws) {
  if (ws.length < 2) return `<div class="empty small">Ajoute au moins 2 pesées pour voir la courbe.</div>`;
  const W = 320, H = 190, pl = 34, pr = 18, pt = 40, pb = 26;
  const xs = ws.map(w => dateObj(w.date).getTime()), ys = ws.map(w => w.kg);
  const x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < .2) { y0 -= .2; y1 += .2; } else { const p = (y1 - y0) * .18; y0 -= p; y1 += p; }
  const X = v => pl + (x1 === x0 ? (W - pl - pr) / 2 : (v - x0) / (x1 - x0) * (W - pl - pr));
  const Y = v => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
  const pts = ws.map((w, i) => [X(xs[i]), Y(ys[i])]);
  const line = smoothPath(pts), last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)} ${H - pb} L${pts[0][0].toFixed(1)} ${H - pb} Z`;
  let g = '';
  for (let i = 0; i <= 2; i++) {
    const v = y0 + (y1 - y0) * i / 2, y = Y(v);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="#e3efed" stroke-width="1"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#8aa5a2">${v.toFixed(1).replace('.', ',')}</text>`;
  }
  const lbl = s => dateObj(s).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  const txt = ys[ys.length - 1].toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kg';
  const bw = 8 + txt.length * 6.6, bx = Math.min(Math.max(last[0] - bw / 2, 2), W - bw - 2), by = Math.max(last[1] - 36, 2);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00968a" stop-opacity=".32"/><stop offset="1" stop-color="#00968a" stop-opacity="0"/></linearGradient></defs>
    ${g}<path d="${area}" fill="url(#gw)"/><path d="${line}" fill="none" stroke="#00968a" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.slice(0, -1).map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#fff" stroke="#00968a" stroke-width="2"/>`).join('')}
    <line x1="${last[0].toFixed(1)}" x2="${last[0].toFixed(1)}" y1="${last[1].toFixed(1)}" y2="${H - pb}" stroke="#ffd93b" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="6.5" fill="#ffd93b" stroke="#fff" stroke-width="2.5"/>
    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="24" rx="9" fill="#fff" stroke="#d3e6e3"/>
    <text x="${(bx + bw / 2).toFixed(1)}" y="${(by + 16).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#15302d">${txt}</text>
    <text x="${pl}" y="${H - 6}" font-size="10" fill="#8aa5a2">${lbl(ws[0].date)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end" font-size="10" fill="#8aa5a2">${lbl(ws[ws.length - 1].date)}</text></svg>`;
}
function tabPoids(c) {
  const all = live('weights').filter(w => w.catId === c.id).sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) return `<div class="empty"><span class="big">⚖️</span>Aucune pesée pour l'instant.<br>Pèse ${esc(c.name)} régulièrement : une variation de poids est souvent le premier signe d'un souci de santé.</div>`;
  const cut = S.range ? new Date(Date.now() - S.range * 30.44 * 864e5) : null;
  const ws = cut ? all.filter(w => dateObj(w.date) >= cut) : all;
  const last = all[all.length - 1], prev = all[all.length - 2];
  let delta = '';
  if (prev) { const d = last.kg - prev.kg, p = d / prev.kg * 100; delta = `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '↑' : d < 0 ? '↓' : '='} ${d > 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')} %</span>`; }
  let h = `<div class="card"><div class="wnow"><div class="num">${fmtKg(last.kg)}</div><div class="grow muted small">le ${fmtDate(last.date)}<br>${delta}</div></div></div>
    <div class="seg">${[[3, '3 mois'], [6, '6 mois'], [12, '12 mois'], [0, 'Tout']].map(([v, l]) => `<button class="${S.range === v ? 'on' : ''}" data-act="range" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="card">${chart(ws)}</div><div class="sec">Historique</div>`;
  h += [...all].reverse().map((w, i, arr) => {
    const p = arr[i + 1], d = p ? w.kg - p.kg : null;
    return `<div class="card item" data-act="edit" data-col="weights" data-id="${w.id}"><div class="ico">⚖️</div><div class="grow"><div class="t">${fmtKg(w.kg)}</div><div class="m">${fmtDate(w.date)}${w.note ? ' · ' + esc(w.note) : ''}</div></div>
      ${d !== null ? `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg</span>` : ''}</div>`;
  }).join('');
  return h;
}

function tabSante(c) {
  let evs = live('events').filter(e => e.catId === c.id).sort((a, b) => b.date.localeCompare(a.date));
  const todo = reminders(c.id);
  if (S.filter !== 'all') evs = evs.filter(e => EV[e.type]?.g === S.filter);
  let h = '';
  if (todo.length) {
    h += `<div class="sec">Rappels à venir</div>` + todo.map(e => {
      const di = dueInfo(e.due);
      return `<div class="card item" style="border-left:6px solid var(--${di.cls === 'late' ? 'red' : di.cls === 'soon' ? 'orange' : 'teal'})"><div class="ico">${EV[e.type]?.i || '📝'}</div>
        <div class="grow" data-act="edit" data-col="events" data-id="${e.id}"><div class="t">${esc(e.title)}</div><div class="m">${fmtDate(e.due)} · <span class="badge ${di.cls}">${di.txt}</span></div></div>
        <button class="btn sm" data-act="ev-done" data-id="${e.id}">✓ Fait</button></div>`;
    }).join('');
  }
  h += `<div class="sec">Historique de santé</div><div class="seg">${EVFILTERS.map(([k, l]) => `<button class="${S.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (!evs.length) return h + `<div class="empty"><span class="big">🩺</span>Aucun soin enregistré${S.filter !== 'all' ? ' dans cette catégorie' : ''}.<br>Ajoute vaccins, vermifuges, consultations…</div>`;
  return h + evs.map(e => `<div class="card item" data-act="edit" data-col="events" data-id="${e.id}"><div class="ico">${EV[e.type]?.i || '📝'}</div>
    <div class="grow"><div class="t">${esc(e.title)}</div><div class="m">${fmtDate(e.date)}${e.vet ? ' · ' + esc(e.vet) : ''}${e.cost ? ' · ' + e.cost.toLocaleString('fr-FR') + ' €' : ''}</div>
    ${e.notes ? `<div class="n">${esc(e.notes)}</div>` : ''}${e.due && e.done ? `<div class="due"><span class="badge ok">Rappel effectué</span></div>` : ''}</div></div>`).join('');
}

function tabGalerie(c) {
  const ph = live('files').filter(f => f.catId === c.id && f.kind === 'photo').sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  ph.forEach(f => { const k = f.date.slice(0, 7); (groups[k] = groups[k] || []).push(f); });
  const keys = Object.keys(groups).sort().reverse();
  const tile = f => `<div class="tile" data-act="photo-open" data-id="${f.id}" data-blob="${esc(f.id)}"></div>`;
  const add = `<div class="tile plus" data-act="photo-add">+</div>`;
  let h = `<div class="muted small" style="margin:0 4px 12px">Une galerie photo pour suivre ${esc(c.name)} mois après mois.</div>`;
  if (!keys.length) return h + `<div class="grid">${add}</div>`;
  keys.forEach((k, i) => {
    const t = new Date(k + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    h += `<div class="month"><h4>${t}</h4><div class="grid">${i === 0 ? add : ''}${groups[k].map(tile).join('')}</div></div>`;
  });
  return h;
}

function tabPlus(c) {
  const seg = [['docs', '📄 Documents'], ['notes', '📝 Notes'], ['contacts', '📞 Contacts'], ['heats', '🌸 Chaleurs']];
  let h = `<div class="seg">${seg.map(([k, l]) => `<button class="${S.plus === k ? 'on' : ''}" data-act="plus" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (S.plus === 'docs') {
    const ds = live('files').filter(f => f.catId === c.id && f.kind === 'doc').sort((a, b) => b.date.localeCompare(a.date));
    h += ds.length ? ds.map(f => `<div class="card item"><div class="ico">${f.mime === 'application/pdf' ? '📄' : '🖼️'}</div>
      <div class="grow" data-act="doc-open" data-id="${f.id}"><div class="t">${esc(f.title || f.name || 'Document')}</div><div class="m">${esc(f.cat || '')} · ${fmtDate(f.date)}</div></div>
      <button class="btn sm line" data-act="edit" data-col="files" data-id="${f.id}">⋯</button></div>`).join('')
      : `<div class="empty"><span class="big">📄</span>Ordonnances, comptes-rendus, analyses, carnet de vaccination scanné…<br>Ajoute ici tes documents médicaux (PDF ou photo).</div>`;
  } else if (S.plus === 'notes') {
    const ns = live('notes').filter(n => n.catId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    h += ns.length ? ns.map(n => `<div class="card item" data-act="edit" data-col="notes" data-id="${n.id}"><div class="ico">📝</div><div class="grow"><div class="t">${esc(n.title)}</div><div class="m">${fmtDate(n.date)}</div>${n.text ? `<div class="n">${esc(n.text)}</div>` : ''}</div></div>`).join('')
      : `<div class="empty"><span class="big">📝</span>Aucune note. Comportement, alimentation, observations…</div>`;
  } else if (S.plus === 'contacts') {
    const cs = live('contacts');
    h += `<div class="muted small" style="margin:0 4px 10px">Ces contacts sont communs à tous tes chats.</div>`;
    h += cs.length ? cs.map(k => `<div class="card item"><div class="ico">${k.label?.includes('Urgence') || k.label?.includes('garde') ? '🚑' : k.label === 'Assurance' ? '🛡️' : '👩‍⚕️'}</div>
      <div class="grow" data-act="edit" data-col="contacts" data-id="${k.id}"><div class="t">${esc(k.name)}</div><div class="m">${esc(k.label || '')}${k.address ? ' · ' + esc(k.address) : ''}</div>${k.notes ? `<div class="n">${esc(k.notes)}</div>` : ''}</div>
      ${k.phone ? `<a class="btn sm" href="tel:${esc(k.phone.replace(/\s/g, ''))}">📞 Appeler</a>` : ''}</div>`).join('')
      : `<div class="empty"><span class="big">📞</span>Ajoute ton vétérinaire, les urgences, ton assurance…</div>`;
  } else {
    const hs = live('heats').filter(x => x.catId === c.id).sort((a, b) => b.start.localeCompare(a.start));
    if (c.sterilized) h += `<div class="hint">${esc(c.name)} est stérilisé(e) : cette rubrique ne sert normalement pas.</div>`;
    h += hs.length ? hs.map(x => `<div class="card item" data-act="edit" data-col="heats" data-id="${x.id}"><div class="ico">🌸</div><div class="grow"><div class="t">${fmtDate(x.start)}${x.end ? ' → ' + fmtDate(x.end) : ' (en cours)'}</div>${x.notes ? `<div class="n">${esc(x.notes)}</div>` : ''}</div></div>`).join('')
      : `<div class="empty"><span class="big">🌸</span>Aucune période de chaleurs enregistrée.</div>`;
  }
  return h;
}

const ICO = {
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4"/><path d="M5.5 3v4h4M18.5 21v-4h-4"/>',
  down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  up: '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  chev: '<path d="M9 5l7 7-7 7"/>'
};
const svgi = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICO[k]}</svg>`;
const catName = id => ((D.cats.find(c => c.id === id) || {}).name) || '';
function trashItems() {
  const out = [];
  const liveCat = id => !!byId('cats', id);
  const add = (col, x, icon, label, sub) => out.push({ col, id: x.id, icon, label, sub, at: x.updatedAt || '' });
  D.cats.filter(x => x.deleted && !x.cascade).forEach(x => add('cats', x, '🐱', x.name, 'Fiche et toutes ses données'));
  D.weights.filter(x => x.deleted && !x.cascade && liveCat(x.catId)).forEach(x => add('weights', x, '⚖️', fmtKg(x.kg), catName(x.catId) + ' · ' + fmtDate(x.date)));
  D.events.filter(x => x.deleted && !x.cascade && liveCat(x.catId)).forEach(x => add('events', x, EV[x.type]?.i || '📝', x.title, catName(x.catId) + ' · ' + fmtDate(x.date)));
  D.notes.filter(x => x.deleted && !x.cascade && liveCat(x.catId)).forEach(x => add('notes', x, '📝', x.title, catName(x.catId)));
  D.heats.filter(x => x.deleted && !x.cascade && liveCat(x.catId)).forEach(x => add('heats', x, '🌸', 'Chaleurs ' + fmtDate(x.start), catName(x.catId)));
  D.contacts.filter(x => x.deleted).forEach(x => add('contacts', x, '📞', x.name, x.label || ''));
  D.presets.filter(x => x.deleted).forEach(x => add('presets', x, EV[x.type]?.i || '💉', x.title, 'Modèle de soin'));
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
function viewSettings() {
  const ls = settings.lastSync ? new Date(settings.lastSync).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : 'jamais';
  const trash = trashItems();
  const top = t => `<header class="top"><button class="ic" data-act="back" aria-label="Retour">${SVG.back}</button><h1>${t}</h1><span class="ic ghost"></span></header>`;
  if (!S.sub) {
    const rows = [
      ['m-teal', 'sliders', 'Modèles de soins', 'Vaccins, vermifuge, anti-puces', 'data-act="sub" data-v="presets"'],
      ['m-yellow', 'bell', 'Rappels', `Alerte ${settings.alertDays} jours avant l'échéance`, 'data-act="sub" data-v="alerts"'],
      ['m-green', 'sync', 'Synchroniser', settings.driveConnected ? `Google Drive · dernière synchro : ${ls}` : 'Google Drive · non connecté', 'data-act="sub" data-v="sync"'],
      ['m-orange', 'down', 'Importer', 'Fusionner un fichier de sauvegarde', 'data-act="import"'],
      ['m-coral', 'up', 'Exporter', 'Enregistrer une sauvegarde (.json)', 'data-act="export"'],
      ['m-blue', 'info', 'À propos', `Version ${APP_VERSION}`, 'data-act="sub" data-v="about"'],
      ['m-grey', 'trash', `Corbeille (${trash.length})`, 'Restaurer ce qui a été supprimé', 'data-act="sub" data-v="trash"']
    ];
    return top('Paramètres') + `<main><div class="menu">${rows.map(([c, i, l, h, a]) => `<div class="mrow" ${a}><span class="mic ${c}">${svgi(i)}</span><div class="grow"><b>${l}</b><div class="muted small">${h}</div></div>${svgi('chev', 'chv')}</div>`).join('')}</div></main>`;
  }
  if (S.sub === 'presets') {
    return top('Modèles de soins') + `<main><div class="card"><p class="small muted" style="margin-top:0">En ajoutant un soin, choisis un modèle : le titre et la date du prochain rappel se remplissent tout seuls. Les durées sont indicatives, à adapter selon l'avis du vétérinaire et le produit utilisé.</p>
      ${[['vaccin', '💉 Vaccins'], ['vermifuge', '🪱 Vermifuge'], ['antiparasitaire', '🐛 Anti-puces / tiques'], ['traitement', '💊 Traitements']].map(([k, l]) => {
        const ps = live('presets').filter(p => p.type === k).sort((a, b) => a.title.localeCompare(b.title));
        return ps.length ? `<div class="sec" style="margin:12px 0 4px">${l}</div>` + ps.map(p => `<div class="row" data-act="edit" data-col="presets" data-id="${p.id}" style="padding:8px 2px;cursor:pointer"><div class="grow"><b>${esc(p.title)}</b><div class="muted small">${p.months > 0 ? (p.months === 1 ? 'Rappel tous les mois' : 'Rappel tous les ' + p.months + ' mois') : 'Sans rappel'}</div></div>${svgi('chev', 'chv')}</div>`).join('') : '';
      }).join('')}
      <div class="acts"><button class="btn line" data-act="add" data-col="presets">＋ Ajouter un modèle</button></div></div></main>`;
  }
  if (S.sub === 'alerts') {
    return top('Rappels') + `<main><div class="card"><div class="fld" style="margin:0"><label>Alerter quand un rappel est dans moins de (jours)</label><input id="alertDays" type="number" inputmode="numeric" min="1" value="${settings.alertDays}"></div>
      <div class="acts"><button class="btn line" data-act="alert-save">Enregistrer</button></div></div></main>`;
  }
  if (S.sub === 'sync') {
    return top('Synchroniser') + `<main><div class="card"><p class="small muted" style="margin-top:0">Tes données sont stockées dans ton Drive (dossier « ${esc(CFG.DRIVE_FOLDER || 'Carnet Chats')} »), jamais ailleurs. Dernière synchro : <b>${ls}</b>.${settings.email ? `<br>Compte : <b>${esc(settings.email)}</b>` : ''}</p>
      <button class="btn block" data-act="sync">☁️ Synchroniser maintenant</button>
      <div class="fld" style="margin-top:14px"><label>Identifiant client Google (OAuth)</label><input id="clientId" placeholder="xxxxx.apps.googleusercontent.com" value="${esc(settings.clientId || CFG.GOOGLE_CLIENT_ID || '')}"></div>
      <div class="fld"><label>Compte Google commun (adresse e-mail)</label><input id="gmail" type="email" autocomplete="off" placeholder="compte.commun@gmail.com" value="${esc(settings.email || '')}"></div>
      <div class="acts"><button class="btn line" data-act="client-save">Enregistrer</button>${settings.driveConnected ? '<button class="btn danger" data-act="disconnect">Se déconnecter</button>' : ''}</div></div></main>`;
  }
  if (S.sub === 'trash') {
    return top('Corbeille') + `<main>${trash.length ? trash.map(t => `<div class="card item"><div class="ico">${t.icon}</div><div class="grow"><div class="t">${esc(t.label)}</div><div class="m">${esc(t.sub)}</div></div><button class="btn sm" data-act="restore" data-col="${t.col}" data-id="${t.id}">Restaurer</button></div>`).join('')
      + `<p class="small muted" style="margin:10px 6px">Les photos et documents supprimés ne peuvent pas être restaurés.</p>`
      : `<div class="empty"><span class="big">🗑️</span>La corbeille est vide.</div>`}</main>`;
  }
  return top('À propos') + `<main><div class="card"><b>Carnet de santé des chats</b><div class="muted small">Version ${APP_VERSION} · ${APP_DATE}</div>
    <p class="small muted">Tes données restent sur ton appareil et dans ton Google Drive. Rien n'est envoyé ailleurs.</p></div></main>`;
}

/* ---------- Actions ---------- */
async function addPhotos(files) {
  let n = 0;
  for (const f of files) {
    try {
      const b = await shrink(f), id = uid(); await putBlob(id, b);
      upsert('files', { id, catId: S.catId, kind: 'photo', date: dateOfFile(f), title: '', mime: 'image/jpeg', name: id + '.jpg' }); n++;
    } catch (e) { toast('Photo illisible : ' + f.name); }
  }
  if (n) toast(n + ' photo' + (n > 1 ? 's' : '') + ' ajoutée' + (n > 1 ? 's' : '')); render();
}
async function setAvatar(files) {
  if (!files[0]) return;
  try {
    const b = await shrink(files[0], 640), id = uid(); await putBlob(id, b);
    upsert('files', { id, catId: S.catId, kind: 'photo', date: todayStr(), title: 'Photo de profil', mime: 'image/jpeg', name: id + '.jpg' });
    const c = byId('cats', S.catId); c.avatarId = id; upsert('cats', c); render();
  } catch (e) { toast('Photo illisible'); }
}
function openViewer(id) {
  const f = byId('files', id); if (!f) return;
  openSheet(`<img class="viewer-img" data-blob="${esc(id)}" alt=""><div class="muted small" style="text-align:center;margin-top:8px;color:#9fb8b4">${fmtDate(f.date)}</div>
    <div class="viewer-bar"><button class="btn alt" data-act="v-avatar" data-id="${id}">⭐ Photo de profil</button><button class="btn danger" data-act="v-del" data-id="${id}">Supprimer</button><button class="btn line" data-act="sheet-close">Fermer</button></div>`, 'full');
  hydrate();
}
async function addDoc() {
  form({
    title: 'Ajouter un document', fields: [{ k: 'file', l: 'Fichier (PDF ou photo)', type: 'file', accept: 'application/pdf,image/*', req: 1 },
      { k: 'title', l: 'Titre', ph: 'ex. Ordonnance du 12/03' }, { k: 'cat', l: 'Catégorie', type: 'select', o: DOCCATS }, { k: 'date', l: 'Date', type: 'date' }],
    values: { date: todayStr(), cat: DOCCATS[0] },
    onSave: async v => {
      let blob = v.file, mime = v.file.type || 'application/octet-stream';
      if (mime.startsWith('image/')) { blob = await shrink(v.file, 1800); mime = 'image/jpeg'; }
      const id = uid(); await putBlob(id, blob);
      upsert('files', { id, catId: S.catId, kind: 'doc', date: v.date || todayStr(), title: v.title || v.file.name, cat: v.cat, mime, name: v.file.name });
      closeSheet(); render(); toast('Document ajouté');
    }
  });
}
async function openDoc(id) {
  const f = byId('files', id); if (!f) return;
  const b = await getBlob(id); if (!b) { toast('Fichier pas encore téléchargé : lance une synchro'); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.target = '_blank'; a.rel = 'noopener';
  if (f.mime !== 'application/pdf' && !f.mime.startsWith('image/')) a.download = f.name;
  a.click();
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, d = t.dataset;
  switch (a) {
    case 'settings': go({ view: 'settings', sub: null }); break;
    case 'sub': go({ sub: d.v }); break;
    case 'restore': {
      const o = D[d.col].find(x => x.id === d.id); if (!o) break;
      o.deleted = false; delete o.cascade; o.updatedAt = nowISO();
      if (d.col === 'cats') COLS.forEach(c => D[c].forEach(x => { if (x.cascade === d.id) { x.deleted = false; delete x.cascade; x.updatedAt = nowISO(); } }));
      save(); render(); toast('Restauré ✓'); break;
    }
    case 'back': if (depth() > 0) history.back(); else go({ view: 'home', catId: null }, false); break;
    case 'open-cat': go({ view: 'cat', catId: d.id, tab: 'profil', filter: 'all' }); break;
    case 'open-cat-tab': go({ view: 'cat', catId: d.id, tab: d.tab, filter: 'all' }); break;
    case 'tab': go({ tab: d.tab }, false); break;
    case 'plus': go({ plus: d.v }, false); break;
    case 'filter': go({ filter: d.v }, false); break;
    case 'range': go({ range: +d.v }, false); break;
    case 'switch-cat': { const cs = live('cats'); if (cs.length > 1) { const i = cs.findIndex(c => c.id === S.catId); go({ catId: cs[(i + 1) % cs.length].id }, false); } break; }
    case 'add': openEdit(d.col, null); break;
    case 'edit': openEdit(d.col, d.id); break;
    case 'form-del': if (form.del) form.del(); break;
    case 'sheet-close': closeSheet(); break;
    case 'ev-done': {
      const ev = byId('events', d.id); if (!ev) break;
      ev.done = true; upsert('events', ev);
      openEdit('events', null, { type: ev.type === 'rappel' ? 'rappel' : ev.type, title: ev.title, vet: ev.vet, date: todayStr() });
      toast('Rappel marqué fait : enregistre la nouvelle date et le prochain rappel'); render(); break;
    }
    case 'photo-add': addPhotos(await pick('image/*', true)); break;
    case 'photo-open': openViewer(d.id); break;
    case 'avatar': setAvatar(await pick('image/*', false)); break;
    case 'v-avatar': { const c = byId('cats', S.catId); c.avatarId = d.id; upsert('cats', c); closeSheet(); render(); toast('Photo de profil mise à jour'); break; }
    case 'v-del': if (confirm('Supprimer cette photo ?')) { delBlob(d.id).catch(() => {}); remove('files', d.id); const c = byId('cats', S.catId); if (c && c.avatarId === d.id) { c.avatarId = null; upsert('cats', c); } closeSheet(); render(); } break;
    case 'doc-add': addDoc(); break;
    case 'doc-open': openDoc(d.id); break;
    case 'sync': sync(true); break;
    case 'client-save': {
      const cid = ($('#clientId').value || '').replace(/\s+/g, '');
      if (cid && !CLIENT_ID_RE.test(cid)) { toast('Identifiant invalide : il doit ressembler à 123456789-abcdef.apps.googleusercontent.com'); break; }
      settings.clientId = cid;
      const em = ($('#gmail').value || '').trim();
      if (em !== (settings.email || '')) { settings.driveConnected = false; try { localStorage.removeItem(TKEY); } catch (x) {} }
      settings.email = em; token = null; tokenExp = 0; saveSettings(); render(); toast('Enregistré : appuie sur le nuage ☁️ pour te connecter'); break;
    }
    case 'alert-save': settings.alertDays = Math.max(1, parseInt($('#alertDays').value) || 30); saveSettings(); toast('Enregistré'); break;
    case 'disconnect': { const t = token; token = null; tokenExp = 0; settings.driveConnected = false; settings.email = ''; saveSettings(); try { localStorage.removeItem(TKEY); } catch (x) {} try { google.accounts.oauth2.revoke(t || '', () => {}); } catch (x) {} render(); toast('Déconnecté de Google Drive'); break; }
    case 'export': {
      const blob = new Blob([JSON.stringify(D, null, 1)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = `carnet-chats-${todayStr()}.json`; l.click(); break;
    }
    case 'import': {
      const [f] = await pick('application/json,.json', false); if (!f) break;
      try { mergeInto(JSON.parse(await f.text())); save(); render(); toast('Import terminé'); } catch (x) { toast('Fichier invalide'); }
      break;
    }
  }
});

/* ---------- Google Drive ---------- */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
let token = null, tokenExp = 0, syncing = false, syncTimer = null, silentSync = false, lastAuto = 0;
const loadGIS = () => new Promise((res, rej) => {
  if (window.google && google.accounts && google.accounts.oauth2) return res();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res;
  s.onerror = () => rej(new Error('Connexion à Google impossible (hors ligne ?)')); document.head.appendChild(s);
});
const TKEY = 'carnetChats.v1.token';
const CLIENT_ID_RE = /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;
const hasToken = () => !!token && Date.now() < tokenExp - 60000;
function loadStoredToken() {
  try { const t = JSON.parse(localStorage.getItem(TKEY)); if (t && t.t && t.exp > Date.now() + 60000) { token = t.t; tokenExp = t.exp; } } catch (e) {}
}
async function getToken(silent) {
  if (!hasToken()) loadStoredToken();
  if (hasToken()) return token;
  const cid = (settings.clientId || CFG.GOOGLE_CLIENT_ID || '').replace(/\s+/g, '');
  if (!cid) { if (!silent) go({ view: 'settings', sub: 'sync' }); throw new Error("Renseigne d'abord l'identifiant client Google"); }
  if (!CLIENT_ID_RE.test(cid)) { if (!silent) go({ view: 'settings', sub: 'sync' }); throw new Error("Identifiant client Google invalide : vérifie-le dans Paramètres → Synchroniser"); }
  await loadGIS();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: SCOPE, hint: settings.email || undefined,
      callback: r => {
        if (r.error) return rej(new Error(r.error));
        token = r.access_token; tokenExp = Date.now() + r.expires_in * 1000; settings.driveConnected = true; saveSettings();
        try { localStorage.setItem(TKEY, JSON.stringify({ t: token, exp: tokenExp })); } catch (e) {}
        res(token);
        if (!settings.email) rememberAccount();
      },
      error_callback: er => rej(new Error(er.type === 'popup_closed' ? 'Connexion annulée' : (er.type || 'Erreur Google')))
    });
    tc.requestAccessToken({ prompt: settings.driveConnected ? '' : 'consent' });
  });
}
async function rememberAccount() {
  try {
    const r = await fetch(`${API}/about?fields=user(emailAddress)`, { headers: { Authorization: 'Bearer ' + token } });
    const e = r.ok && (await r.json()).user?.emailAddress;
    if (e) { settings.email = e; saveSettings(); }
  } catch (x) {}
}
async function gfetch(url, opt = {}) {
  const t = await getToken(silentSync);
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + t } });
  if (!r.ok) { const x = await r.text(); throw new Error('Drive ' + r.status + ' ' + x.slice(0, 100)); }
  return r;
}
async function findOne(q) {
  const r = await gfetch(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5&spaces=drive`);
  return (await r.json()).files[0] || null;
}
async function ensureFolder(name, parent) {
  const f = await findOne(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent || 'root'}' in parents`);
  if (f) return f.id;
  const r = await gfetch(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent || 'root'] }) });
  return (await r.json()).id;
}
async function uploadFile({ id, name, mime, blob, parent }) {
  const meta = id ? { name } : { name, parents: [parent] }, b = 'carnet' + uid();
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${b}--`]);
  const r = await gfetch(`${UP}/files${id ? '/' + id : ''}?uploadType=multipart&fields=id`, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
  return (await r.json()).id;
}
const safe = s => String(s || '').replace(/[^\w\-]+/g, '_').slice(0, 40);
function driveName(f) {
  const c = byId('cats', f.catId) || D.cats.find(x => x.id === f.catId);
  const ext = f.mime === 'application/pdf' ? 'pdf' : f.mime === 'image/jpeg' ? 'jpg' : (f.name || '').split('.').pop() || 'bin';
  return `${safe(c && c.name)}_${f.date}_${safe(f.kind === 'doc' ? f.title : '')}_${f.id}.${ext}`.replace(/_+/g, '_');
}
async function sync(manual, silent) {
  if (syncing) return;
  syncing = true; silentSync = !!silent; refreshCloud();
  try {
    const root = await ensureFolder(CFG.DRIVE_FOLDER || 'Carnet Chats');
    const df = await findOne(`name='carnet-chats.json' and trashed=false and '${root}' in parents`);
    if (df) { const r = await gfetch(`${API}/files/${df.id}?alt=media`); mergeInto(await r.json()); }
    const photosF = await ensureFolder('Photos', root), docsF = await ensureFolder('Documents', root);
    for (const f of D.files) {
      if (f.deleted) {
        if (f.driveId) { try { await gfetch(`${API}/files/${f.driveId}`, { method: 'DELETE' }); } catch (x) {} f.driveId = null; }
        continue;
      }
      if (!f.driveId) {
        const b = await getBlob(f.id);
        if (b) { f.driveId = await uploadFile({ name: driveName(f), mime: f.mime, blob: b, parent: f.kind === 'photo' ? photosF : docsF }); f.updatedAt = nowISO(); }
      }
    }
    saveLocal();
    await uploadFile({ id: df && df.id, name: 'carnet-chats.json', mime: 'application/json', blob: new Blob([JSON.stringify(D)], { type: 'application/json' }), parent: root });
    const missing = [];
    for (const f of live('files')) if (f.driveId && !(await getBlob(f.id))) missing.push(f);
    for (let i = 0; i < missing.length; i += 3) {
      await Promise.all(missing.slice(i, i + 3).map(async f => {
        try { const r = await gfetch(`${API}/files/${f.driveId}?alt=media`); await putBlob(f.id, await r.blob()); } catch (x) {}
      }));
    }
    settings.dirty = false; settings.lastSync = nowISO(); saveSettings();
    if (manual) toast('Synchronisation terminée ✓');
  } catch (err) {
    if (!silent) toast(err.message || 'Échec de la synchronisation');
  } finally {
    syncing = false; silentSync = false; refreshCloud(); if (!sheetOpen) render();
  }
}
function scheduleSync() {
  if (!settings.driveConnected || !hasToken()) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(false), 4000);
}

/* Synchro discrète à l'ouverture et au retour dans l'appli (récupère les ajouts de l'autre téléphone) */
function autoSync() {
  if (!settings.driveConnected || syncing || sheetOpen || navigator.onLine === false || Date.now() - lastAuto < 60000) return;
  if (!hasToken()) loadStoredToken();
  if (!hasToken()) return;
  lastAuto = Date.now(); sync(false, true);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });

let gestureTried = false;
document.addEventListener('pointerup', e => {
  if (gestureTried || !settings.driveConnected || syncing || sheetOpen) return;
  if (e.target.closest('[data-act=sync],[data-act=disconnect],[data-act=client-save]')) return;
  if (!hasToken()) loadStoredToken();
  gestureTried = true;
  if (!hasToken()) sync(false, true); // compte mémorisé : la fenêtre Google se referme seule si l'accès est déjà accordé
});

/* ---------- Démarrage ---------- */
loadStoredToken();
render(); autoSync();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
