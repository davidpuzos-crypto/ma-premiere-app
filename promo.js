/* ============================================================
   LA PROMO — le volet communautaire
   Chacun·e choisit d'y apparaître, sous pseudonyme. Sont publiés :
   le pseudonyme, la discipline et l'année (facultatives), l'avancement
   en pourcentage, les pages de la semaine, la série, le calendrier de
   régularité, et les notes que l'on décide de partager.
   Ne sont jamais publiés : le nom, l'adresse email, le titre de la
   thèse, le plan, les notes privées.

   Les fiches vivent dans la collection « profiles » de Firestore.
   Tant que les règles de sécurité n'autorisent pas cette collection
   (voir firestore.rules), tout le volet reste invisible.
============================================================ */
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { todayKey, isDayKey, diffDays, clamp } from './core.js';
import { isoWeek, gradeFor, promoLead, rankTitle, randomPseudonym } from './humour.js';
import { initials } from './visuals.js';

const MAX_NOTES = 8;
const LIST_TTL = 60000;       // la liste est relue au plus une fois par minute
const PUBLISH_DELAY = 4000;   // les statistiques sont publiées après quelques secondes de calme

const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const numIn = (v, min, max) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0, min, max);

/** Une fiche lue dans Firestore est une donnée extérieure : on la remet au propre. */
export function cleanProfile(id, d) {
  if (!d || typeof d !== 'object') return null;
  // L'identifiant sert dans des liens et des boutons : seuls les identifiants de compte ordinaires sont admis
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id))) return null;
  const name = cut(d.name, 30);
  if (name.length < 2) return null;
  const heat = {};
  if (d.heat && typeof d.heat === 'object') {
    for (const [k, v] of Object.entries(d.heat).slice(0, 120)) {
      if (isDayKey(k) && Number(v) > 0) heat[k] = numIn(v, 0, 99);
    }
  }
  const notes = (Array.isArray(d.notes) ? d.notes : []).slice(0, MAX_NOTES).map(n => ({
    d: isDayKey(n && n.d) ? n.d : null,
    t: cut(n && n.t, 240),
    p: numIn(n && n.p, 0, 99),
  })).filter(n => n.d && n.t);
  return {
    id: String(id),
    name,
    field: cut(d.field, 30),
    year: numIn(d.year, 0, 6),
    pct: Math.round(numIn(d.pct, 0, 100)),
    week: cut(d.week, 10),
    weekPages: Math.round(numIn(d.weekPages, 0, 300) * 10) / 10,
    streak: Math.round(numIn(d.streak, 0, 9999)),
    heat,
    notes,
    joinedAt: cut(d.joinedAt, 30),
    updatedAt: cut(d.updatedAt, 30),
  };
}

const YEARS = ['', '1re année', '2e année', '3e année', '4e année', '5e année', '6e année et plus'];
export function profileMeta(p) {
  return [p.field, YEARS[p.year] || ''].filter(Boolean).join(' · ');
}

/**
 * ctx : { db, user(), stats(), heatmap(heat, weeks), ui: { esc, fmt1, relDay, setText, setHTML,
 *         toast, openModal, closeModal }, onChange(available, member) }
 */
export function createPromo(ctx) {
  const { db, ui } = ctx;
  const { esc, fmt1 } = ui;
  let available = null;   // null = pas encore su, true / false
  let me = null;          // ma fiche (brute, telle que publiée) ou null
  let list = [];
  let listAt = 0;
  let lastPublished = '';
  let timer = null;
  let myCheers = 0;
  let readyResolve;
  let ready = new Promise(r => { readyResolve = r; });

  const uid = () => { const u = ctx.user(); return u ? u.uid : null; };
  const ref = id => doc(db, 'profiles', id);
  const week = () => isoWeek().id;
  const weekPagesOf = p => (p.week === week() ? p.weekPages : 0);
  const notify = () => ctx.onChange(available === true, !!me);

  /* ---------- Disponibilité et ma fiche ---------- */

  function reset() {
    clearTimeout(timer);
    available = null; me = null; list = []; listAt = 0; lastPublished = ''; myCheers = 0;
    ready = new Promise(r => { readyResolve = r; });
  }

  /** À la connexion : la promo est-elle ouverte (règles en place) ? Suis-je inscrit·e ? */
  async function init() {
    const id = uid();
    if (!id) return;
    try {
      const snap = await getDoc(ref(id));
      if (uid() !== id) return;
      available = true;
      me = snap.exists() ? snap.data() : null;
      if (me) { publishSoon(); loadMyCheers(); }
    } catch (e) {
      if (uid() !== id) return;
      // « permission-denied » : la collection n'est pas (encore) autorisée. Hors ligne : on réessaiera.
      available = e && e.code === 'permission-denied' ? false : null;
    }
    notify();
    readyResolve(available === true);
  }

  function snapshotOf(base) {
    const s = ctx.stats();
    return {
      v: 1,
      name: cut(base.name, 30),
      field: cut(base.field, 30),
      year: numIn(base.year, 0, 6),
      pct: s.pct,
      week: week(),
      weekPages: s.weekPages,
      streak: s.streak,
      heat: s.heat,
      notes: (Array.isArray(base.notes) ? base.notes : []).slice(0, MAX_NOTES),
      joinedAt: base.joinedAt || new Date().toISOString(),
    };
  }

  async function publishNow() {
    clearTimeout(timer);
    const id = uid();
    if (!id || !me || available !== true) return false;
    const data = snapshotOf(me);
    const sig = JSON.stringify(data);
    if (sig === lastPublished) return true;
    data.updatedAt = new Date().toISOString();
    try {
      await setDoc(ref(id), data);
      lastPublished = sig;
      me = data;
      const i = list.findIndex(p => p.id === id);
      const clean = cleanProfile(id, data);
      if (clean) { if (i >= 0) list[i] = clean; else list.unshift(clean); }
      return true;
    } catch (e) {
      console.warn('Promo :', e);
      return false;
    }
  }

  /** Appelé à chaque changement de mes chiffres : publication groupée, sans urgence. */
  function publishSoon() {
    if (!me || available !== true) return;
    clearTimeout(timer);
    timer = setTimeout(publishNow, PUBLISH_DELAY);
  }

  /* ---------- Ma fiche : rejoindre, modifier, quitter ---------- */

  function profileLink() {
    return `${location.origin}${location.pathname}?p=${encodeURIComponent(uid() || '')}`;
  }

  function openProfile() {
    if (available !== true) return;
    document.getElementById('ppName').value = me ? me.name : randomPseudonym();
    document.getElementById('ppField').value = me ? (me.field || '') : '';
    document.getElementById('ppYear').value = me && me.year ? String(me.year) : '';
    ui.setText('ppTitle', me ? 'Ma fiche dans la promo' : 'Rejoindre la promo');
    ui.setText('ppSave', me ? 'Enregistrer' : 'Rejoindre');
    document.getElementById('ppLeave').classList.toggle('hidden', !me);
    document.getElementById('ppLinkRow').classList.toggle('hidden', !me);
    document.getElementById('ppLink').value = me ? profileLink() : '';
    ui.openModal('promoModal');
  }

  function rollPseudonym() {
    const input = document.getElementById('ppName');
    input.value = randomPseudonym(input.value);
  }

  async function saveProfile() {
    const name = cut(document.getElementById('ppName').value, 30);
    if (name.length < 2) { ui.toast('Choisissez un pseudonyme (2 caractères au moins).', 'warn'); return; }
    const joining = !me;
    me = {
      ...(me || {}),
      name,
      field: cut(document.getElementById('ppField').value, 30),
      year: numIn(document.getElementById('ppYear').value, 0, 6),
    };
    lastPublished = '';
    const ok = await publishNow();
    if (!ok) {
      if (joining) me = null;
      ui.toast('Impossible d\'enregistrer votre fiche pour le moment.', 'warn');
      return;
    }
    ui.closeModal('promoModal');
    notify();
    ui.toast(joining ? `Bienvenue dans la promo, ${name}.` : 'Fiche mise à jour.', 'success');
    render();
  }

  /** Supprime ma fiche et les encouragements reçus. Lève une erreur si la fiche n'a pas pu être supprimée. */
  async function purge() {
    const id = uid();
    if (!id || available === false) return;
    clearTimeout(timer);
    try { await deleteDoc(ref(id)); }
    catch (e) { if (e && e.code === 'permission-denied') return; throw e; } // promo fermée : rien à supprimer
    // Les encouragements reçus partent avec la fiche (au mieux : la fiche, elle, est déjà supprimée)
    try {
      const snap = await getDocs(collection(db, 'profiles', id, 'cheers'));
      const gone = [];
      snap.forEach(d => gone.push(deleteDoc(doc(db, 'profiles', id, 'cheers', d.id))));
      await Promise.all(gone);
    } catch (e) { console.warn('Promo :', e); }
    me = null; lastPublished = ''; myCheers = 0;
    list = list.filter(p => p.id !== id);
  }

  async function leave() {
    const id = uid();
    if (!id || !me) return;
    if (!confirm('Quitter la promo ?\n\nVotre fiche et vos notes partagées seront supprimées. Votre journal, lui, ne change pas.')) return;
    try {
      await purge();
    } catch (e) {
      console.warn('Promo :', e);
      ui.toast('Impossible de supprimer la fiche pour le moment.', 'warn');
      return;
    }
    ui.closeModal('promoModal');
    notify();
    ui.toast('Vous avez quitté la promo. Votre fiche est supprimée.', '');
    render();
  }

  async function copyLink() {
    const link = profileLink();
    try {
      await navigator.clipboard.writeText(link);
      ui.toast('Lien copié. Il s\'ouvre sans compte.', 'success');
    } catch {
      const input = document.getElementById('ppLink');
      if (input) { input.focus(); input.select(); }
      ui.toast('Sélectionnez le lien pour le copier.', '');
    }
  }

  /* ---------- Notes partagées ---------- */

  async function addNote(text, pages) {
    const t = cut(text, 240);
    if (!t || !me || available !== true) return false;
    me = { ...me, notes: [{ d: todayKey(), t, p: numIn(pages, 0, 99) }].concat(me.notes || []).slice(0, MAX_NOTES) };
    lastPublished = '';
    const ok = await publishNow();
    if (ok) render();
    return ok;
  }

  async function post() {
    const input = document.getElementById('promoText');
    const t = cut(input.value, 240);
    if (!t) { input.focus(); return; }
    if (await addNote(t, 0)) { input.value = ''; ui.toast('Publié dans le fil de la promo.', 'success'); }
    else ui.toast('Publication impossible pour le moment.', 'warn');
  }

  async function removeNote(index) {
    if (!me || !Array.isArray(me.notes) || !me.notes[index]) return;
    me = { ...me, notes: me.notes.filter((_, i) => i !== index) };
    lastPublished = '';
    await publishNow();
    render();
    ui.toast('Note retirée du fil.', '');
  }

  async function report(targetId, index) {
    const id = uid();
    const p = list.find(x => x.id === targetId);
    if (!id || !p) return;
    if (!confirm('Signaler ce message à la personne qui gère Le Journal de Bord ?')) return;
    try {
      await setDoc(doc(db, 'reports', `${id}_${targetId}_${Date.now()}`), {
        by: id, target: targetId, name: p.name, text: (p.notes[index] && p.notes[index].t) || '', at: new Date().toISOString(),
      });
      ui.toast('Signalement envoyé. Merci.', 'success');
    } catch (e) {
      console.warn('Promo :', e);
      ui.toast('Signalement impossible pour le moment.', 'warn');
    }
  }

  /* ---------- Encouragements ---------- */

  /** Compte mes encouragements de la semaine et annonce, une seule fois, ceux que je n'ai pas encore vus. */
  async function loadMyCheers() {
    const id = uid();
    if (!id) return;
    try {
      const snap = await getDocs(collection(db, 'profiles', id, 'cheers'));
      if (uid() !== id) return;
      const seenKey = 'jdb_cheers_seen_' + id;
      let seen = '';
      try { seen = localStorage.getItem(seenKey) || ''; } catch { /* ignoré */ }
      let n = 0;
      let newest = seen;
      const fresh = [];
      snap.forEach(d => {
        const c = d.data() || {};
        if (c.w === week()) n++;
        const at = cut(c.at, 30);
        if (at && at > seen) { fresh.push(cut(c.name, 30) || 'Quelqu\'un'); if (at > newest) newest = at; }
      });
      myCheers = n;
      renderMe();
      if (fresh.length) {
        try { localStorage.setItem(seenKey, newest); } catch { /* ignoré */ }
        const who = fresh.length === 1 ? `${fresh[0]} vous encourage`
          : fresh.length === 2 ? `${fresh[0]} et ${fresh[1]} vous encouragent`
            : `${fresh[0]}, ${fresh[1]} et ${fresh.length - 2} autre${fresh.length > 3 ? 's' : ''} vous encouragent`;
        ui.toast(`${who}. La promo croit en vous (elle, au moins).`, 'success', { key: 'cheers', duration: 8000 });
      }
    } catch (e) { console.warn('Promo :', e); }
  }

  async function cheer(targetId) {
    const id = uid();
    if (!id || targetId === id) return;
    if (!me) { ui.toast('Rejoignez la promo pour encourager les autres.', ''); openProfile(); return; }
    try {
      await setDoc(doc(db, 'profiles', targetId, 'cheers', id), { w: week(), at: new Date().toISOString(), name: cut(me.name, 30) });
      ui.toast('Encouragement envoyé. Ça compte plus qu\'on ne croit.', 'success');
      document.querySelectorAll(`[data-cheer="${CSS.escape(targetId)}"]`).forEach(b => { b.textContent = 'Encouragé·e cette semaine'; b.disabled = true; });
    } catch (e) {
      console.warn('Promo :', e);
      ui.toast('Encouragement impossible pour le moment.', 'warn');
    }
  }

  /* ---------- La page « La promo » ---------- */

  async function loadList(force) {
    if (available !== true) return;
    if (!force && Date.now() - listAt < LIST_TTL && list.length) return;
    try {
      const snap = await getDocs(query(collection(db, 'profiles'), orderBy('updatedAt', 'desc'), limit(100)));
      const out = [];
      snap.forEach(d => { const p = cleanProfile(d.id, d.data()); if (p) out.push(p); });
      list = out;
      listAt = Date.now();
    } catch (e) {
      console.warn('Promo :', e);
      if (!list.length) ui.setHTML('promoRank', '<li class="promo-empty">Impossible de joindre la promo pour le moment.</li>');
    }
  }

  async function open() {
    if (available !== true) return;
    render();
    await loadList(false);
    render();
    if (me) loadMyCheers();
  }

  function mine() {
    const id = uid();
    if (!me || !id) return null;
    return cleanProfile(id, { ...me, ...ctx.stats(), week: week() });
  }

  function everyone() {
    const id = uid();
    const m = mine();
    const others = list.filter(p => p.id !== id);
    return m ? [m, ...others] : others;
  }

  function renderMe() {
    const el = document.getElementById('promoMe');
    if (!el) return;
    const m = mine();
    document.getElementById('promoJoin').classList.toggle('hidden', !!m);
    document.getElementById('promoCompose').classList.toggle('hidden', !m);
    el.classList.toggle('hidden', !m);
    if (!m) return;
    const cheers = myCheers > 0 ? ` · ${myCheers} encouragement${myCheers > 1 ? 's' : ''} cette semaine` : '';
    el.innerHTML = `<div class="pm-top"><span class="avatar" aria-hidden="true">${esc(initials(m.name))}</span>
        <div><div class="pm-who">${esc(m.name)}</div>
        <div class="pm-stats">${m.pct}\u00A0% · ${fmt1(m.weekPages)} p. cette semaine · ${m.streak} jour${m.streak > 1 ? 's' : ''} d'affilée${cheers}</div></div></div>
      <div class="pm-links">
        <button type="button" class="link-btn" onclick="openPromoProfile()">Ma fiche</button>
        <button type="button" class="link-btn" onclick="copyProfileLink()">Copier le lien de ma fiche</button>
      </div>`;
  }

  function render() {
    if (available !== true || !document.getElementById('promoRank')) return;
    const id = uid();
    const all = everyone();
    const w = isoWeek();
    ui.setText('promoWeek', `semaine ${w.week}`);
    ui.setText('promoLead', promoLead(all.length, all.reduce((s, p) => s + weekPagesOf(p), 0)));
    renderMe();

    const active = all.filter(p => weekPagesOf(p) > 0).sort((a, b) => weekPagesOf(b) - weekPagesOf(a) || b.streak - a.streak);
    const idle = all.filter(p => !(weekPagesOf(p) > 0));
    const max = active.length ? weekPagesOf(active[0]) : 1;
    ui.setHTML('promoRank', active.length
      ? active.slice(0, 30).map((p, i) => {
        const title = rankTitle(i + 1, weekPagesOf(p));
        const meta = profileMeta(p);
        return `<li><button type="button" class="rank-item${i === 0 ? ' top1' : ''}${p.id === id ? ' me' : ''}" onclick="openFellow('${esc(p.id)}')">
            <span class="rk-pos" aria-hidden="true">${i + 1}</span>
            <span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span>
            <span class="rk-who"><span class="rk-name">${esc(p.name)}${p.id === id ? ' (vous)' : ''}</span>${meta ? `<span class="rk-meta">${esc(meta)}</span>` : ''}${title ? `<span class="rk-title">${title}</span>` : ''}</span>
            <span class="rk-pages">+${fmt1(weekPagesOf(p))}\u00A0p.</span>
            <span class="rk-bar meter"><span class="meter-fill" style="width:${Math.round((weekPagesOf(p) / max) * 100)}%"></span></span>
          </button></li>`;
      }).join('')
      : '<li class="promo-empty">Personne n\'a encore noté de page cette semaine. La première place est à prendre.</li>');
    ui.setHTML('promoIdle', idle.length
      ? 'En réflexion cette semaine : ' + idle.slice(0, 14).map(p =>
        `<button type="button" onclick="openFellow('${esc(p.id)}')">${esc(p.name)}${p.id === id ? ' (vous)' : ''}</button>`).join(', ')
        + (idle.length > 14 ? ` et ${idle.length - 14} autres.` : (/\.$/.test(idle[idle.length - 1].name) ? '' : '.')) // « Et al. » apporte son point
      : '');

    const notes = [];
    for (const p of all) p.notes.forEach((n, i) => notes.push({ p, n, i }));
    notes.sort((a, b) => (a.n.d < b.n.d ? 1 : a.n.d > b.n.d ? -1 : 0));
    ui.setHTML('promoFeed', notes.length
      ? notes.slice(0, 40).map(({ p, n, i }) => noteHTML(p, n, i, id)).join('')
      : '<p class="promo-empty">Le fil est encore vide. Une astuce, une petite victoire, un coup de mou : tout se partage.</p>');
  }

  function noteHTML(p, n, i, id) {
    const own = p.id === id;
    const actions = own
      ? `<button type="button" class="link-btn" onclick="removePromoNote(${i})">Retirer</button>`
      : `<button type="button" class="link-btn" data-cheer="${esc(p.id)}" onclick="cheerFellow('${esc(p.id)}')">Encourager</button>
         <button type="button" class="link-btn" onclick="reportNote('${esc(p.id)}', ${i})">Signaler</button>`;
    return `<article class="feed-item">
        <div class="fd-head">${ui.relDay(n.d)} · <button type="button" onclick="openFellow('${esc(p.id)}')">${esc(p.name)}${own ? ' (vous)' : ''}</button>${n.p ? ` · +${fmt1(n.p)} p.` : ''}</div>
        <p class="fd-text">${esc(n.t)}</p>
        <div class="fd-actions">${actions}</div>
      </article>`;
  }

  /* ---------- Fiche d'un·e doctorant·e ---------- */

  function sheetHTML(p, { guest, own }) {
    const meta = profileMeta(p);
    const today = todayKey();
    const last = p.updatedAt && isDayKey(p.updatedAt.slice(0, 10)) ? diffDays(p.updatedAt.slice(0, 10), today) : null;
    const seen = last === null ? '' : last <= 0 ? 'vu·e aujourd\'hui' : last === 1 ? 'vu·e hier' : `vu·e il y a ${last} jours`;
    const wkPages = weekPagesOf(p);
    const notes = p.notes.slice(0, 5).map(n =>
      `<article class="feed-item"><div class="fd-head">${ui.relDay(n.d)}${n.p ? ` · +${fmt1(n.p)} p.` : ''}</div><p class="fd-text">${esc(n.t)}</p></article>`).join('');
    const actions = guest ? '' : `<div class="modal-actions">
        ${own ? '<button type="button" class="btn btn-neutral" onclick="closeModal(\'fellowModal\'); openPromoProfile()">Modifier ma fiche</button>'
    : `<button type="button" class="btn btn-neutral" data-cheer="${esc(p.id)}" onclick="cheerFellow('${esc(p.id)}')">Encourager</button>`}
        <button type="button" class="btn btn-primary" onclick="closeModal('fellowModal')">Fermer</button>
      </div>`;
    return `<p class="kicker fw-kicker">${guest ? 'Fiche partagée' : 'Doctorant·e de la promo'}</p>
      <h2 class="fw-name" id="fwName">${esc(p.name)}</h2>
      <p class="fw-meta">${esc([meta, seen].filter(Boolean).join(' · '))}</p>
      <p class="fw-pct">${p.pct}\u00A0%</p>
      <div class="meter fw-meter"><div class="meter-fill" style="width:${p.pct}%"></div></div>
      <p class="grade fw-grade">${esc(gradeFor(p.pct))}</p>
      <div class="fw-stats">
        <span><b>${fmt1(wkPages)}</b> p. cette semaine</span>
        <span><b>${p.streak}</b> jour${p.streak > 1 ? 's' : ''} d'affilée</span>
        <span class="fw-cheers" id="fwCheers"></span>
      </div>
      <div class="heatmap fw-heat">${ctx.heatmap(p.heat, 12)}</div>
      ${notes ? `<div class="fw-notes">${notes}</div>` : ''}
      ${actions}`;
  }

  async function openFellow(targetId) {
    const id = uid();
    let p = targetId === id ? mine() : list.find(x => x.id === targetId);
    if (!p) {
      try {
        const snap = await getDoc(ref(targetId));
        p = snap.exists() ? cleanProfile(targetId, snap.data()) : null;
      } catch (e) { console.warn('Promo :', e); }
    }
    if (!p) { ui.toast('Cette fiche n\'existe plus.', ''); return; }
    ui.setHTML('fellowSheet', sheetHTML(p, { guest: false, own: targetId === id }));
    ui.openModal('fellowModal');
    try {
      const snap = await getDocs(collection(db, 'profiles', targetId, 'cheers'));
      let n = 0;
      let byMe = false;
      snap.forEach(d => { if ((d.data() || {}).w === week()) { n++; if (d.id === id) byMe = true; } });
      const el = document.getElementById('fwCheers');
      if (el && n) el.innerHTML = `<b>${n}</b> encouragement${n > 1 ? 's' : ''}`;
      if (byMe) document.querySelectorAll(`#fellowSheet [data-cheer]`).forEach(b => { b.textContent = 'Encouragé·e cette semaine'; b.disabled = true; });
    } catch (e) { /* le compteur est un plus : sans lui, la fiche reste lisible */ }
  }

  /** Lien de fiche ouvert sans être connecté·e : la fiche s'affiche au-dessus du formulaire. */
  async function showGuest(targetId) {
    const el = document.getElementById('guestProfile');
    if (!el || !targetId) return;
    try {
      const snap = await getDoc(ref(targetId));
      const p = snap.exists() ? cleanProfile(targetId, snap.data()) : null;
      if (!p) return;
      el.innerHTML = sheetHTML(p, { guest: true, own: false })
        + '<p class="guest-cta">Vous écrivez aussi une thèse ? Ouvrez votre journal, c\'est gratuit.</p>';
      el.classList.remove('hidden');
    } catch (e) { /* fiche indisponible : l'accueil s'affiche normalement */ }
  }

  return {
    init, reset, open, render, openProfile, rollPseudonym, saveProfile, leave, purge, copyLink,
    addNote, post, removeNote, report, cheer, openFellow, showGuest, publishSoon,
    isAvailable: () => available === true,
    isMember: () => !!me,
    isUnknown: () => available === null,   // pas encore su (hors ligne au démarrage) : à redemander
    whenReady: () => ready,
  };
}
