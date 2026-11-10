/*
 * The screen: reads the spell and item lists, shows them, and saves the character.
 * Rules live in requirements.js, list reading in catalog.js, saving in storage.js.
 */
(function () {
  'use strict';
  const HH = window.HH;
  const C = HH.config;

  // ------------------------------------------------------------ helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
  const count = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const tokens = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hasAll = (toks, hay) => toks.every(t => hay.includes(t));
  const shortDate = iso => {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
    catch (e) { return ''; }
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const paragraphs = text => String(text || '').split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');

  const state = {
    store: null,
    spells: [], spellsById: new Map(),
    items: [], itemsById: new Map(),
    issues: { spells: [], items: [] },
    sources: { spells: null, items: null },
    loading: true,
    banners: [],
    tab: 'character',
    open: new Set(),
    mineSearch: '',
    allSearch: '', allRarity: '', allSort: 'sheet', allQualified: false,
    itemSearch: '', dialogSearch: '', dialogType: '',
    warnedStorage: false,
  };
  const active = () => state.store.active();

  // ------------------------------------------------------------ glyphs
  const GLYPH = {
    fire: '<path d="M12 4.5 19.5 18.5h-15z"/>',
    water: '<path d="M12 19.5 19.5 5.5h-15z"/>',
    air: '<path d="M12 4.5 19.5 18.5h-15z"/><path d="M7.6 13h8.8"/>',
    earth: '<path d="M12 19.5 19.5 5.5h-15z"/><path d="M7.6 11h8.8"/>',
    spirit: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  };
  const STAR_SVG = '<svg class="star-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m12 3.6 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8z" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const glyphHTML = (key, size) => `<span class="glyph" aria-hidden="true"><svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${GLYPH[key] || ''}</svg></span>`;

  // ------------------------------------------------------------ saving
  function persist() {
    state.store.save();
    if (!state.store.isWritable() && !state.warnedStorage) {
      state.warnedStorage = true;
      addBanner('storage', 'problem', "This browser isn't letting the app save. Your changes will be lost when you close this page. Private browsing can cause this.");
    }
  }

  // ------------------------------------------------------------ banners and toast
  function addBanner(id, kind, html, dismissible) {
    state.banners = state.banners.filter(b => b.id !== id);
    state.banners.push({ id, kind, html, dismissible: dismissible !== false });
    renderBanners();
  }
  function dropBanners(pattern) {
    state.banners = state.banners.filter(b => !pattern.test(b.id));
    renderBanners();
  }
  function renderBanners() {
    $('#banner').innerHTML = state.banners.map(b => `
      <p class="note-box ${b.kind === 'problem' ? 'problem' : ''}">${b.html}
        ${b.dismissible ? ` <button type="button" class="btn quiet small" data-action="dismiss-banner" data-id="${esc(b.id)}">Dismiss</button>` : ''}
      </p>`).join('');
  }

  let toastTimer = null;
  let toastUndo = null;
  function toast(message, undoFn, undoLabel) {
    const el = $('#toast');
    toastUndo = undoFn || null;
    el.innerHTML = `<span class="toast-msg">${esc(message)}</span>` +
      (undoFn ? `<button type="button" class="toast-action" data-action="toast-undo">${esc(undoLabel || 'Undo')}</button>` : '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undoFn ? 7000 : 3500);
  }
  function hideToast() { $('#toast').classList.remove('show'); toastUndo = null; }

  // ------------------------------------------------------------ spell state
  function needsLearning(spell) {
    return C.LEARN_RARITIES.includes(spell.rarityKey) || spell.req.namedTerms.length > 0;
  }
  function stateOf(spell, c) {
    c = c || active();
    const ev = HH.requirements.evaluate(spell.req, c);
    const overridden = c.overrides.includes(spell.id);
    const learned = c.learned.includes(spell.id);
    const needs = needsLearning(spell);
    const inList = ev.met || overridden;
    return { ev, overridden, learned, needs, inList, ready: inList && (!needs || learned) };
  }
  function counts() {
    const c = active();
    let listed = 0;
    let ready = 0;
    state.spells.forEach(s => {
      const st = stateOf(s, c);
      if (st.inList) listed++;
      if (st.ready) ready++;
    });
    return { listed, ready };
  }
  const castCost = spell => (/^\d+$/.test(spell.fpCost) ? parseInt(spell.fpCost, 10) : 0);

  function spineColor(spell) {
    for (const alt of spell.req.alternatives) {
      for (const t of alt.terms) if (t.kind === 'stat' && C.ELEMENTS.includes(t.key)) return `var(--${t.key})`;
    }
    if (spell.req.namedTerms.length) return 'var(--brass)';
    return spell.req.alternatives.length ? '#8fb0ab' : 'var(--text-dim)';
  }

  // ------------------------------------------------------------ spell cards
  function chipHTML(entry) {
    const term = entry.term;
    let cls = 'sig';
    let glyph = '';
    if (term.kind === 'stat') {
      if (C.ELEMENTS.includes(term.key)) { cls += ` el-${term.key}`; glyph = glyphHTML(term.key, 14); }
      else cls += ' core';
    } else if (term.kind === 'any') cls += ' any';
    else cls += ' named';
    let sr = '';
    if (entry.met === true) { cls += ' met'; sr = ' (met)'; }
    else if (entry.met === false) { cls += ' unmet'; sr = ' (not met)'; }
    return `<span class="${cls}">${glyph}${esc(term.label)}${sr ? `<span class="sr-only">${sr}</span>` : ''}</span>`;
  }
  function reqHTML(spell, ev) {
    if (spell.req.none) return '<span class="req-none">No requirement</span>';
    const groups = ev.alternatives.map(alt => `<span class="req-group">${alt.terms.map(chipHTML).join('')}</span>`);
    return `<span class="req">${groups.join('<span class="req-or">or</span>')}</span>`;
  }

  function spellCard(spell, mode) {
    const st = stateOf(spell);
    const open = state.open.has(spell.id);
    const unlearned = mode === 'mine' && st.needs && !st.learned;
    const bodyId = `sp-${spell.id}-${mode}`;
    const fav = mode === 'mine' && active().favorites.includes(spell.id);

    const tags = [];
    if (fav) tags.push(`<span class="fav-mark" title="Favorite">${STAR_SVG}<span class="sr-only">Favorite</span></span>`);
    if (spell.rarityKey && spell.rarityKey !== 'common') {
      tags.push(`<span class="tag ${esc(spell.rarityKey)}">${esc(spell.rarity)}</span>`);
    }
    if (mode === 'all') {
      if (st.ev.met) tags.push('<span class="badge ok">You qualify</span>');
      else if (st.overridden) tags.push('<span class="badge added">Added by override</span>');
    } else {
      if (unlearned) tags.push('<span class="badge locked">Not learned</span>');
      if (st.overridden && !st.ev.met) tags.push('<span class="badge added">Override</span>');
    }

    const facts = [
      ['Range', spell.range], ['Cast time', spell.castTime], ['Duration', spell.duration],
      ...spell.extras.map(e => [e.label, e.value]),
    ].filter(f => f[1]);
    // Only repeat the raw text when the chips might hide something (several options or a special name).
    if (spell.requirementText && (spell.req.alternatives.length > 1 || spell.req.namedTerms.length)) {
      facts.push(['Requirement as written', spell.requirementText]);
    }

    const named = spell.req.namedTerms.length
      ? `<p class="help">This spell lists ${esc(spell.req.namedTerms.join(', '))}, which the app can't check. ${mode === 'all' ? 'Use "Override and add" if your character meets it.' : 'Tick Learn once your character meets it.'}</p>`
      : '';

    let actions = '';
    if (mode === 'all') {
      if (!st.ev.met) {
        actions = st.overridden
          ? `<button type="button" class="btn small" data-action="override" data-id="${esc(spell.id)}" aria-pressed="true">Remove override</button>`
          : `<button type="button" class="btn small" data-action="override" data-id="${esc(spell.id)}" aria-pressed="false">Override and add</button>`;
      }
    } else {
      actions += `<button type="button" class="btn small star" data-action="favorite" data-id="${esc(spell.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}: ${esc(spell.name)}">${STAR_SVG}${fav ? 'Favorite' : 'Add favorite'}</button>`;
      if (st.needs) {
        actions += `<button type="button" class="btn small" data-action="learn" data-id="${esc(spell.id)}" aria-pressed="${st.learned}">${st.learned ? 'Learned' : 'Learn spell'}</button>`;
      }
      const cost = castCost(spell);
      if (st.ready && cost > 0) {
        actions += `<button type="button" class="btn small primary cast-btn" data-action="cast" data-id="${esc(spell.id)}" data-cost="${cost}"${active().currentFP < cost ? ' disabled' : ''}>Cast for ${cost} FP</button>`;
      }
      if (st.overridden && !st.ev.met) {
        actions += `<button type="button" class="btn small quiet" data-action="override" data-id="${esc(spell.id)}" aria-pressed="true">Remove override</button>`;
      }
    }

    return `
    <article class="spell${open ? ' open' : ''}${unlearned ? ' unlearned' : ''}${fav ? ' fav' : ''}" data-id="${esc(spell.id)}" style="--spine:${spineColor(spell)}">
      <button type="button" class="spell-head" data-action="toggle-spell" aria-expanded="${open}" aria-controls="${esc(bodyId)}">
        <span class="spell-title">${esc(spell.name)}</span>
        ${spell.fpCost !== '' ? `<span class="fp-pill">${esc(spell.fpCost)} FP</span>` : '<span></span>'}
        <span class="spell-line">
          ${reqHTML(spell, st.ev)}
          <span class="badges">${tags.join('')}<span class="chev" aria-hidden="true"></span></span>
        </span>
      </button>
      <div class="spell-more" id="${esc(bodyId)}">
        <div class="spell-clip"><div class="spell-inner">
          ${facts.length ? `<dl class="facts">${facts.map(f => `<div class="fact"><dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>` : ''}
          ${spell.description ? `<div class="prose">${paragraphs(spell.description)}</div>` : ''}
          ${spell.escalation ? `<div class="escalation"><span class="esc-label">Escalation</span><p>${esc(spell.escalation)}</p></div>` : ''}
          ${named}
        </div></div>
      </div>
      ${actions ? `<div class="spell-foot actions">${actions}</div>` : ''}
    </article>`;
  }

  function refreshCard(id, mode) {
    const panel = mode === 'all' ? '#tab-all-spells' : '#tab-my-spells';
    const old = $(`${panel} .spell[data-id="${CSS.escape(id)}"]`);
    const spell = state.spellsById.get(id);
    if (!old || !spell) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = spellCard(spell, mode).trim();
    const fresh = tpl.content.firstElementChild;
    old.replaceWith(fresh);
    const again = $('[data-action="override"], [data-action="learn"]', fresh);
    if (again) again.focus();
  }

  function loadProblemHTML(kind) {
    const label = kind === 'spells' ? 'spell' : 'item';
    const src = state.sources[kind];
    if (state.loading) return '<div class="empty"><p>Loading the lists.</p></div>';
    if (src && src.from === 'none' && kind === 'items' && src.detail === 'missing') {
      return `<div class="empty"><p>There is no item list yet. Add a file named <b>${esc(C.DATA.items)}</b>, or add custom items yourself.</p></div>`;
    }
    return `<div class="empty"><p>The ${label} list couldn't be loaded.${location.protocol === 'file:' ? ' Browsers block loading it when index.html is opened as a file. Open the app from its web address instead.' : ' Check your connection, then try again.'}</p><button type="button" class="btn" data-action="reload-data">Try again</button></div>`;
  }

  // ------------------------------------------------------------ My spells
  function updateFP() {
    const c = active();
    $('#fp-current').textContent = c.currentFP;
    $('#fp-max').textContent = c.maxFP;
    const bar = $('#fp-bar');
    bar.classList.toggle('empty', c.currentFP === 0);
    bar.classList.toggle('low', c.currentFP > 0 && c.currentFP <= c.maxFP / 4);
    const ticks = $('#fp-ticks');
    ticks.setAttribute('aria-label', `${c.currentFP} of ${c.maxFP} focus points`);
    ticks.innerHTML = Array.from({ length: c.maxFP }, (_, i) => `<i class="${i < c.currentFP ? 'on' : ''}"></i>`).join('');
    $('#fp-minus').disabled = c.currentFP <= 0;
    $('#fp-plus').disabled = c.currentFP >= c.maxFP;
    $$('.cast-btn').forEach(b => { b.disabled = c.currentFP < Number(b.dataset.cost); });
    renderHeader();
  }
  function setFP(value) {
    const c = active();
    c.currentFP = clamp(value, [0, c.maxFP]);
    persist();
    updateFP();
  }

  function renderMine() {
    updateFP();
    const box = $('#my-list');
    if (state.loading || !state.spells.length) { box.innerHTML = loadProblemHTML('spells'); return; }
    const c = active();
    const toks = tokens(state.mineSearch);
    const mine = state.spells
      .map(s => ({ s, st: stateOf(s, c) }))
      .filter(x => x.st.inList);
    if (!mine.length) {
      box.innerHTML = `<div class="empty"><p>Your list is empty. Raise your elements on the Character tab, or find a spell and add it yourself.</p>
        <div class="button-row"><button type="button" class="btn primary" data-action="goto-tab" data-tab="character">Set up character</button>
        <button type="button" class="btn" data-action="goto-tab" data-tab="all-spells">Browse all spells</button></div></div>`;
      return;
    }
    const shown = mine.filter(x => hasAll(toks, x.s.search));
    if (!shown.length) { box.innerHTML = '<div class="empty"><p>None of your spells match that search.</p></div>'; return; }
    const isFav = x => c.favorites.includes(x.s.id);
    const favList = shown.filter(isFav);
    const readyList = shown.filter(x => !isFav(x) && x.st.ready);
    const lockedList = shown.filter(x => !isFav(x) && !x.st.ready);
    const group = (title, list, cls) => list.length
      ? `<div class="spell-group${cls ? ' ' + cls : ''}"><h3>${title} <span class="count">${list.length}</span></h3><div class="spells">${list.map(x => spellCard(x.s, 'mine')).join('')}</div></div>`
      : '';
    box.innerHTML = group('Favorites', favList, 'favorites') + group('Ready to cast', readyList) + group('Not learned yet', lockedList);
  }

  // ------------------------------------------------------------ All spells
  function renderAll() {
    const box = $('#all-list');
    if (state.loading || !state.spells.length) {
      box.innerHTML = loadProblemHTML('spells');
      $('#all-count').textContent = '';
      return;
    }
    const c = active();
    const toks = tokens(state.allSearch);
    let list = state.spells.filter(s => hasAll(toks, s.search) &&
      (!state.allRarity || s.rarityKey === state.allRarity) &&
      (!state.allQualified || stateOf(s, c).ev.met));
    if (state.allSort === 'az') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    $('#all-count').textContent = `Showing ${list.length} of ${state.spells.length} spells`;
    box.innerHTML = list.length
      ? `<div class="spells">${list.map(s => spellCard(s, 'all')).join('')}</div>`
      : '<div class="empty"><p>No spells match. Try fewer words, or clear the filters.</p></div>';
  }

  function rebuildFilters() {
    const sel = $('#all-rarity');
    const present = [...new Set(state.spells.map(s => s.rarityKey))];
    const order = ['common', 'uncommon', 'rare'];
    present.sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
    sel.innerHTML = '<option value="">All rarities</option>' +
      present.map(k => `<option value="${esc(k)}">${esc(k.charAt(0).toUpperCase() + k.slice(1))}</option>`).join('');
    sel.value = present.includes(state.allRarity) ? state.allRarity : '';
    state.allRarity = sel.value;
  }

  // ------------------------------------------------------------ Items
  function entryView(e) {
    const it = e.itemId ? state.itemsById.get(e.itemId) : null;
    if (it) {
      return { name: it.name, type: it.type, rarity: it.rarity, rarityKey: it.rarityKey, slot: it.slot, equippable: it.equippable, consumable: it.consumable, description: it.description, extras: it.extras, missing: false };
    }
    if (e.itemId) {
      return { name: e.name, type: '', rarity: '', rarityKey: '', slot: '', equippable: false, consumable: false, description: '', extras: [], missing: true };
    }
    const cu = e.custom || {};
    return { name: e.name, type: cu.type || '', rarity: '', rarityKey: '', slot: cu.slot || '', equippable: !!cu.slot, consumable: !!cu.consumable, description: cu.description || '', extras: [], missing: false };
  }

  function entryHTML(x) {
    const e = x.e;
    const v = x.v;
    const tags = [];
    if (v.type) tags.push(`<span class="tag">${esc(v.type)}</span>`);
    if (v.rarity) tags.push(`<span class="tag ${esc(v.rarityKey)}">${esc(v.rarity)}</span>`);
    if (v.equippable) tags.push(`<span class="tag">Slot: ${esc(v.slot)}</span>`);
    if (v.consumable) tags.push('<span class="tag">Consumable</span>');
    const showQty = !v.equippable && !e.equipped;
    const facts = v.extras.length
      ? `<dl class="facts">${v.extras.map(f => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>` : '';
    let actions = '';
    if (v.equippable || e.equipped) {
      actions += `<button type="button" class="btn small" data-action="item-equip" data-uid="${esc(e.uid)}" aria-pressed="${e.equipped}">${e.equipped ? 'Unequip' : 'Equip'}</button>`;
    }
    if (v.consumable) {
      actions += `<button type="button" class="btn small primary" data-action="item-use" data-uid="${esc(e.uid)}">Use one</button>`;
    }
    actions += `<button type="button" class="btn small quiet" data-action="item-remove" data-uid="${esc(e.uid)}" aria-label="Remove ${esc(v.name)}">Remove</button>`;
    return `
    <article class="entry${e.equipped ? ' equipped' : ''}" data-uid="${esc(e.uid)}">
      <div class="entry-head">
        <div>
          <div class="entry-name">${esc(v.name)}</div>
          ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
        </div>
        ${showQty ? `<div class="qty" role="group" aria-label="Quantity of ${esc(v.name)}">
          <button type="button" data-action="item-qty" data-uid="${esc(e.uid)}" data-delta="-1" aria-label="One fewer"${e.qty <= 1 ? ' disabled' : ''}>&minus;</button>
          <span aria-live="polite">${e.qty}</span>
          <button type="button" data-action="item-qty" data-uid="${esc(e.uid)}" data-delta="1" aria-label="One more">+</button>
        </div>` : ''}
      </div>
      ${v.description ? `<div class="prose">${paragraphs(v.description)}</div>` : ''}
      ${facts}
      ${v.missing ? '<p class="help">This item is no longer in the item list, so only its name and quantity are known.</p>' : ''}
      <div class="actions">${actions}</div>
    </article>`;
  }

  function renderItems() {
    const c = active();
    const box = $('#items-list');
    const toks = tokens(state.itemSearch);
    if (!c.inventory.length) {
      box.innerHTML = `<div class="empty"><p>You aren't carrying anything yet. Add items from the item list, or make up your own.</p>
        <button type="button" class="btn primary" data-action="open-item-dialog">Add item</button></div>`;
      return;
    }
    const views = c.inventory
      .map(e => ({ e, v: entryView(e) }))
      .filter(x => hasAll(toks, `${x.v.name} ${x.v.type} ${x.v.description}`.toLowerCase()));
    if (!views.length) { box.innerHTML = '<div class="empty"><p>None of your items match that search.</p></div>'; return; }
    const equipped = views.filter(x => x.e.equipped)
      .sort((a, b) => a.v.slot.localeCompare(b.v.slot) || a.v.name.localeCompare(b.v.name));
    const carried = views.filter(x => !x.e.equipped);
    const section = (title, list) => list.length
      ? `<h3 class="slot-heading">${title} <span class="count">${list.length}</span></h3><div class="stack">${list.map(entryHTML).join('')}</div>` : '';
    box.innerHTML = section('Equipped', equipped) + section('Carried', carried);
  }

  function findEntry(uid) { return active().inventory.find(e => e.uid === uid); }

  function addCatalogItem(item) {
    const c = active();
    if (!item.equippable) {
      const existing = c.inventory.find(e => e.itemId === item.id);
      if (existing) { existing.qty = Math.min(999, existing.qty + 1); persist(); return; }
    }
    c.inventory.push({ uid: HH.storage.uid(), itemId: item.id, name: item.name, qty: 1, equipped: false, custom: null });
    persist();
  }

  // ------------------------------------------------------------ add-item dialog
  function renderCatalog() {
    const box = $('#catalog-list');
    if (!state.items.length) {
      box.innerHTML = loadProblemHTML('items');
      return;
    }
    const toks = tokens(state.dialogSearch);
    const list = state.items.filter(i => hasAll(toks, i.search) && (!state.dialogType || i.type === state.dialogType));
    if (!list.length) { box.innerHTML = '<div class="empty"><p>No items match.</p></div>'; return; }
    const c = active();
    box.innerHTML = list.map(i => {
      const have = c.inventory.filter(e => e.itemId === i.id).reduce((n, e) => n + e.qty, 0);
      const tags = [];
      if (i.type) tags.push(`<span class="tag">${esc(i.type)}</span>`);
      if (i.rarity) tags.push(`<span class="tag ${esc(i.rarityKey)}">${esc(i.rarity)}</span>`);
      if (i.equippable) tags.push(`<span class="tag">Slot: ${esc(i.slot)}</span>`);
      if (i.consumable) tags.push('<span class="tag">Consumable</span>');
      return `<div class="cat-row">
        <div><div class="cat-name">${esc(i.name)}</div><div class="tags">${tags.join('')}${have ? `<span class="cat-have">Carrying ${have}</span>` : ''}</div></div>
        <button type="button" class="btn small primary" data-action="add-catalog" data-id="${esc(i.id)}" aria-label="Add ${esc(i.name)}">Add</button>
        ${i.description ? `<p class="cat-desc">${esc(i.description)}</p>` : ''}
      </div>`;
    }).join('');
  }
  function rebuildTypeFilter() {
    const sel = $('#dialog-type');
    const types = [...new Set(state.items.map(i => i.type).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    sel.value = types.includes(state.dialogType) ? state.dialogType : '';
    state.dialogType = sel.value;
    sel.hidden = types.length === 0;
  }
  function openItemDialog() {
    rebuildTypeFilter();
    renderCatalog();
    const dlg = $('#item-dialog');
    if (!dlg.open) dlg.showModal();
  }

  // ------------------------------------------------------------ Character tab
  function buildCharacterForm() {
    const R = C.RANGES;
    const range = ([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    $('#char-level').innerHTML = range(R.level).map(n => `<option>${n}</option>`).join('');
    $('#char-fp').innerHTML = range(R.fp).map(n => `<option>${n}</option>`).join('');
    $('#elements-list').innerHTML = C.ELEMENTS.map(k => `
      <div class="elem el-${k}" data-row="${k}">
        <div class="elem-name">${glyphHTML(k, 22)}${esc(C.STAT_NAMES[k])}</div>
        <div class="stepper">
          <button type="button" class="step" data-action="step" data-stat="${k}" data-delta="-1" aria-label="Lower ${esc(C.STAT_NAMES[k])}">&minus;</button>
          <input id="stat-${k}" type="text" inputmode="numeric" pattern="[0-9]*" data-stat="${k}" aria-label="${esc(C.STAT_NAMES[k])}" autocomplete="off">
          <button type="button" class="step" data-action="step" data-stat="${k}" data-delta="1" aria-label="Raise ${esc(C.STAT_NAMES[k])}">+</button>
        </div>
        <div class="meter" aria-hidden="true">${Array.from({ length: R.element[1] }, () => '<i></i>').join('')}</div>
      </div>`).join('');
    $('#core-grid').innerHTML = C.CORE_STATS.map(k => `
      <div class="field" data-row="${k}">
        <label for="stat-${k}">${esc(C.STAT_NAMES[k])}</label>
        <div class="stepper">
          <button type="button" class="step" data-action="step" data-stat="${k}" data-delta="-1" aria-label="Lower ${esc(C.STAT_NAMES[k])}">&minus;</button>
          <input id="stat-${k}" type="text" inputmode="numeric" pattern="[0-9]*" data-stat="${k}" autocomplete="off">
          <button type="button" class="step" data-action="step" data-stat="${k}" data-delta="1" aria-label="Raise ${esc(C.STAT_NAMES[k])}">+</button>
        </div>
      </div>`).join('');
    $('#char-hall').innerHTML = '<option value="">None</option>' + C.HALLS.map(h => `<option>${esc(h)}</option>`).join('');
  }

  function updateStatRow(key) {
    const c = active();
    const isEl = C.ELEMENTS.includes(key);
    const value = (isEl ? c.elements : c.stats)[key];
    const range = isEl ? C.RANGES.element : C.RANGES.core;
    const row = $(`[data-row="${key}"]`);
    $('input', row).value = value;
    const [minus, plus] = $$('.step', row);
    minus.disabled = value <= range[0];
    plus.disabled = value >= range[1];
    if (isEl) $$('.meter i', row).forEach((seg, i) => seg.classList.toggle('on', i < value));
  }
  function updateSummary() {
    const el = $('#char-summary');
    if (!state.spells.length) { el.textContent = ''; return; }
    const n = counts();
    el.textContent = `${count(n.listed, 'spell')} on your list, ${n.ready} ready to cast.`;
  }
  function renderCharacter() {
    const c = active();
    $('#char-name').value = c.name;
    $('#char-level').value = c.level;
    $('#char-fp').value = c.maxFP;
    const hall = $('#char-hall');
    if (c.hall && ![...hall.options].some(o => o.value === c.hall)) {
      hall.insertAdjacentHTML('beforeend', `<option>${esc(c.hall)}</option>`);
    }
    hall.value = c.hall;
    [...C.ELEMENTS, ...C.CORE_STATS].forEach(updateStatRow);
    updateSummary();
  }
  function setStat(key, raw) {
    const c = active();
    const isEl = C.ELEMENTS.includes(key);
    const bag = isEl ? c.elements : c.stats;
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n)) n = bag[key];
    bag[key] = clamp(n, isEl ? C.RANGES.element : C.RANGES.core);
    persist();
    updateStatRow(key);
    updateSummary();
  }

  // ------------------------------------------------------------ header
  function renderHeader() {
    const c = active();
    const sel = $('#char-switch');
    sel.innerHTML = state.store.characters.map(x => `<option value="${esc(x.id)}"${x.id === c.id ? ' selected' : ''}>${esc(x.name || 'Unnamed')}</option>`).join('');
    $('#who-sub').innerHTML = `<span>Level ${c.level}</span>${c.hall ? `<span>${esc(c.hall)}</span>` : ''}<span>FP ${c.currentFP} of ${c.maxFP}</span>`;
    document.title = `${c.name || 'Unnamed'} - Spell Finder`;
  }

  // ------------------------------------------------------------ More tab
  function issueRows() {
    const label = { spells: 'Spell list', items: 'Item list' };
    const rank = { error: 0, warning: 1, info: 2 };
    const all = [];
    ['spells', 'items'].forEach(kind => state.issues[kind].forEach(i => all.push(Object.assign({ kind, source: label[kind] }, i))));
    return all.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  function renderMore() {
    const c = active();
    $('#more-characters').innerHTML = state.store.characters.map(x => `
      <button type="button" class="char-row" data-action="char-pick" data-id="${esc(x.id)}">
        <span class="who"><b>${esc(x.name || 'Unnamed')}</b><span>Level ${x.level}${x.hall ? `, ${esc(x.hall)}` : ''}</span></span>
        ${x.id === c.id ? '<span class="current">Current</span>' : ''}
      </button>`).join('');

    const srcText = kind => {
      const s = state.sources[kind];
      const n = kind === 'spells' ? state.spells.length : state.items.length;
      const noun = kind === 'spells' ? 'spell' : 'item';
      if (!s) return `<li><b>${noun === 'spell' ? 'Spells' : 'Items'}:</b> loading.</li>`;
      const name = kind === 'spells' ? 'Spells' : 'Items';
      if (s.from === 'preview') return `<li><b>${name}:</b> ${count(n, noun)} from ${esc(s.detail)} (preview only; reload the page to go back).</li>`;
      if (s.from === 'cache') return `<li><b>${name}:</b> ${count(n, noun)} from the copy saved on this device${s.detail ? ` on ${esc(shortDate(s.detail))}` : ''}. The live list couldn't be reached.</li>`;
      if (s.from === 'none') return `<li><b>${name}:</b> not loaded${kind === 'items' && s.detail === 'missing' ? ` (no file at ${esc(C.DATA.items)})` : ''}.</li>`;
      return `<li><b>${name}:</b> ${count(n, noun)} loaded from ${esc(C.DATA[kind])}.</li>`;
    };
    $('#more-data').innerHTML = `<ul class="status-list">${srcText('spells')}${srcText('items')}</ul>`;

    const issues = issueRows();
    const problems = issues.filter(i => i.level !== 'info');
    const tagFor = { error: ['fix', 'Fix'], warning: ['check', 'Check'], info: ['', 'Note'] };
    const rows = issues.map(i => `<li class="issue"><span class="tag ${tagFor[i.level][0]}">${tagFor[i.level][1]}</span>
      <span>${esc(i.message)}${i.row ? ` <span class="where">${esc(i.source)}, row ${i.row}</span>` : ''}</span></li>`).join('');
    $('#more-issues').innerHTML = (problems.length ? '' : '<p>No problems found in your lists.</p>') +
      (rows ? `<ul class="issues">${rows}</ul>` : '');
    $('#about').textContent = `Version ${C.APP_VERSION}. Characters are saved in this browser on this device only. Use "Save backup file" to keep a copy somewhere else.`;
  }

  // ------------------------------------------------------------ data loading
  async function loadKind(kind) {
    try {
      const res = await fetch(C.DATA[kind], { cache: 'no-cache' });
      if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
      const text = await res.text();
      state.store.setCache(kind, text);
      return { text, from: 'network', detail: '' };
    } catch (err) {
      const cached = state.store.getCache(kind);
      if (cached && cached.text) return { text: cached.text, from: 'cache', detail: cached.savedAt };
      return { text: null, from: 'none', detail: err && err.status === 404 ? 'missing' : 'unreachable' };
    }
  }

  function applyKind(kind, result) {
    state.sources[kind] = { from: result.from, detail: result.detail };
    const label = kind === 'spells' ? 'spell' : 'item';
    if (!result.text) {
      state[kind] = [];
      state.issues[kind] = result.detail === 'missing' && kind === 'items'
        ? []
        : [{ level: 'error', row: null, message: `The ${label} list couldn't be loaded from ${C.DATA[kind]}.` }];
    } else {
      const parsed = HH.csv.parseCSV(result.text);
      const out = kind === 'spells'
        ? HH.catalog.normalizeSpells(parsed, { halls: C.HALLS })
        : HH.catalog.normalizeItems(parsed);
      state[kind] = kind === 'spells' ? out.spells : out.items;
      state.issues[kind] = out.issues;
    }
    state[kind === 'spells' ? 'spellsById' : 'itemsById'] = new Map(state[kind].map(x => [x.id, x]));
  }

  function dataBanners() {
    dropBanners(/^(load|data)-/);
    ['spells', 'items'].forEach(kind => {
      const s = state.sources[kind];
      const label = kind === 'spells' ? 'spell' : 'item';
      if (s.from === 'cache') {
        addBanner(`load-${kind}`, 'problem', `The live ${label} list couldn't be reached, so you're seeing the copy saved on this device${s.detail ? ` on ${esc(shortDate(s.detail))}` : ''}.`);
      } else if (s.from === 'none' && kind === 'spells') {
        addBanner('load-spells', 'problem', location.protocol === 'file:'
          ? "The spell list couldn't be loaded. Browsers block this when index.html is opened as a file; open the app from its web address instead."
          : "The spell list couldn't be loaded. Check your connection and try again from the More tab.");
      }
    });
    const errors = issueRows().filter(i => i.level === 'error' && i.row);
    if (errors.length) {
      addBanner('data-errors', 'problem', `${count(errors.length, 'row')} in your spell or item list need fixing. Open More, then Data check.`);
    }
  }

  async function loadAll() {
    state.loading = true;
    const [s, i] = await Promise.all([loadKind('spells'), loadKind('items')]);
    applyKind('spells', s);
    applyKind('items', i);
    state.loading = false;
    dataBanners();
    rebuildFilters();
  }

  async function previewFile(kind, file) {
    if (!file) return;
    try {
      const text = await file.text();
      applyKind(kind, { text, from: 'preview', detail: file.name });
      dropBanners(new RegExp(`^(load|data)-${kind}|^preview-${kind}$`));
      addBanner(`preview-${kind}`, 'note', `Previewing <b>${esc(file.name)}</b> in place of the ${kind === 'spells' ? 'spell' : 'item'} list. Reload the page to go back to the live list.`, false);
      rebuildFilters();
      renderTab(state.tab);
      toast(`Previewing ${file.name}`);
    } catch (e) {
      toast("That file couldn't be read.");
    }
  }

  // ------------------------------------------------------------ tabs
  function renderTab(tab) {
    switch (tab) {
      case 'character': renderCharacter(); break;
      case 'my-spells': renderMine(); break;
      case 'all-spells': renderAll(); break;
      case 'items': renderItems(); break;
      case 'more': renderMore(); break;
      default: break;
    }
  }
  function gotoTab(tab, scroll) {
    if (!$(`#tab-${tab}`)) tab = 'character';
    state.tab = tab;
    state.store.setUI({ tab });
    $$('main > .panel').forEach(p => { p.hidden = p.id !== `tab-${tab}`; });
    $$('.tabbar .tab').forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    renderTab(tab);
    if (scroll !== false) window.scrollTo(0, 0);
  }
  function switchCharacter(id) {
    state.store.setActive(id);
    renderHeader();
    renderTab(state.tab);
  }

  // ------------------------------------------------------------ downloads
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ------------------------------------------------------------ actions
  const actions = {
    'goto-tab': el => gotoTab(el.dataset.tab),
    'dismiss-banner': el => { dropBanners(new RegExp(`^${el.dataset.id.replace(/[^\w-]/g, '')}$`)); },
    'toast-undo': () => { const fn = toastUndo; hideToast(); if (fn) fn(); },
    'to-top': () => window.scrollTo({ top: 0, behavior: 'smooth' }),

    'toggle-spell': el => {
      const card = el.closest('.spell');
      const open = !card.classList.contains('open');
      card.classList.toggle('open', open);
      el.setAttribute('aria-expanded', String(open));
      if (open) state.open.add(card.dataset.id); else state.open.delete(card.dataset.id);
    },
    override: el => {
      const c = active();
      const id = el.dataset.id;
      const i = c.overrides.indexOf(id);
      if (i >= 0) c.overrides.splice(i, 1); else c.overrides.push(id);
      persist();
      if (state.tab === 'my-spells') renderMine(); else refreshCard(id, 'all');
      updateSummary();
    },
    learn: el => {
      const c = active();
      const id = el.dataset.id;
      const i = c.learned.indexOf(id);
      if (i >= 0) c.learned.splice(i, 1); else c.learned.push(id);
      persist();
      renderMine();
    },
    favorite: el => {
      const c = active();
      const id = el.dataset.id;
      const i = c.favorites.indexOf(id);
      if (i >= 0) c.favorites.splice(i, 1); else c.favorites.push(id);
      persist();
      renderMine();
      const again = $(`#my-list [data-action="favorite"][data-id="${CSS.escape(id)}"]`);
      if (again) again.focus();
    },
    cast: el => {
      const c = active();
      const spell = state.spellsById.get(el.dataset.id);
      const cost = Number(el.dataset.cost);
      if (!spell || c.currentFP < cost) return;
      const before = c.currentFP;
      setFP(before - cost);
      toast(`Cast ${spell.name}. ${c.currentFP} FP left.`, () => setFP(before));
    },
    fp: el => {
      const c = active();
      const dir = el.dataset.dir;
      if (dir === 'reset') setFP(c.maxFP);
      else setFP(c.currentFP + Number(dir));
    },
    step: el => {
      const c = active();
      const key = el.dataset.stat;
      const cur = (C.ELEMENTS.includes(key) ? c.elements : c.stats)[key];
      setStat(key, cur + Number(el.dataset.delta));
    },

    'open-item-dialog': () => openItemDialog(),
    'close-dialog': () => $('#item-dialog').close(),
    'add-catalog': el => {
      const item = state.itemsById.get(el.dataset.id);
      if (!item) return;
      addCatalogItem(item);
      renderCatalog();
      $('#dialog-status').textContent = `Added ${item.name}.`;
      const again = $(`[data-action="add-catalog"][data-id="${CSS.escape(item.id)}"]`);
      if (again) again.focus();
    },
    'item-equip': el => {
      const e = findEntry(el.dataset.uid);
      if (!e) return;
      e.equipped = !e.equipped;
      persist();
      renderItems();
      const again = $(`[data-action="item-equip"][data-uid="${CSS.escape(e.uid)}"]`);
      if (again) again.focus();
    },
    'item-qty': el => {
      const e = findEntry(el.dataset.uid);
      if (!e) return;
      e.qty = clamp(e.qty + Number(el.dataset.delta), [1, 999]);
      persist();
      renderItems();
      const again = $(`[data-action="item-qty"][data-uid="${CSS.escape(e.uid)}"][data-delta="${el.dataset.delta}"]`);
      if (again && !again.disabled) again.focus();
    },
    'item-use': el => {
      const c = active();
      const i = c.inventory.findIndex(e => e.uid === el.dataset.uid);
      if (i < 0) return;
      const e = c.inventory[i];
      const name = entryView(e).name;
      const snapshot = JSON.parse(JSON.stringify(e));
      if (e.qty > 1) {
        e.qty--;
        persist(); renderItems();
        toast(`Used one ${name}. ${e.qty} left.`, () => {
          const cur = findEntry(snapshot.uid);
          if (cur) cur.qty = snapshot.qty; else c.inventory.splice(Math.min(i, c.inventory.length), 0, snapshot);
          persist(); renderItems();
        });
      } else {
        c.inventory.splice(i, 1);
        persist(); renderItems();
        toast(`Used the last ${name}.`, () => {
          c.inventory.splice(Math.min(i, c.inventory.length), 0, snapshot);
          persist(); renderItems();
        });
      }
    },
    'item-remove': el => {
      const c = active();
      const i = c.inventory.findIndex(e => e.uid === el.dataset.uid);
      if (i < 0) return;
      const [removed] = c.inventory.splice(i, 1);
      persist(); renderItems();
      toast(`Removed ${entryView(removed).name}.`, () => {
        c.inventory.splice(Math.min(i, c.inventory.length), 0, removed);
        persist(); renderItems();
      });
    },

    'char-pick': el => { switchCharacter(el.dataset.id); },
    'char-new': () => {
      state.store.addCharacter({ name: 'New Character' });
      renderHeader();
      gotoTab('character');
      const name = $('#char-name');
      name.focus(); name.select();
    },
    'char-duplicate': () => {
      state.store.duplicateActive();
      renderHeader(); renderMore();
      toast('Duplicated. You are now on the copy.');
    },
    'char-delete': () => {
      const c = active();
      if (!window.confirm(`Delete ${c.name || 'this character'}? This can't be undone. Save a backup file first if you might want them back.`)) return;
      state.store.deleteActive();
      renderHeader(); renderMore();
      toast('Character deleted.');
    },
    export: () => {
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      download(`hhrpg-characters-${day}.json`, state.store.exportJSON(), 'application/json');
      toast('Backup file saved.');
    },
    'import-click': () => $('#import-file').click(),
    'reload-data': async () => {
      dropBanners(/^preview-/);
      toast('Reloading the lists.');
      await loadAll();
      renderTab(state.tab);
      toast('Lists reloaded.');
    },
    'preview-click': el => $(`#preview-${el.dataset.kind}-file`).click(),
  };

  // ------------------------------------------------------------ wiring
  function wire() {
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = actions[el.dataset.action];
      if (fn) fn(el);
    });

    // character fields
    $('#char-name').addEventListener('input', e => { active().name = e.target.value.slice(0, 60); persist(); renderHeader(); });
    $('#char-level').addEventListener('change', e => { active().level = Number(e.target.value); persist(); renderHeader(); });
    $('#char-hall').addEventListener('change', e => { active().hall = e.target.value; persist(); renderHeader(); });
    $('#char-fp').addEventListener('change', e => {
      const c = active();
      const wasFull = c.currentFP >= c.maxFP;
      c.maxFP = Number(e.target.value);
      c.currentFP = wasFull ? c.maxFP : Math.min(c.currentFP, c.maxFP);
      persist(); renderHeader();
    });
    $('#tab-character').addEventListener('change', e => {
      if (e.target.matches('input[data-stat]')) setStat(e.target.dataset.stat, e.target.value);
    });
    $('#tab-character').addEventListener('focusin', e => {
      if (e.target.matches('input[data-stat]')) e.target.select();
    });
    $('#char-switch').addEventListener('change', e => switchCharacter(e.target.value));

    // filters
    $('#my-search').addEventListener('input', debounce(e => { state.mineSearch = e.target.value; renderMine(); }, 120));
    $('#all-search').addEventListener('input', debounce(e => { state.allSearch = e.target.value; renderAll(); }, 120));
    $('#all-rarity').addEventListener('change', e => { state.allRarity = e.target.value; renderAll(); });
    $('#all-sort').addEventListener('change', e => { state.allSort = e.target.value; renderAll(); });
    $('#all-qualified').addEventListener('change', e => { state.allQualified = e.target.checked; renderAll(); });
    $('#item-search').addEventListener('input', debounce(e => { state.itemSearch = e.target.value; renderItems(); }, 120));
    $('#dialog-search').addEventListener('input', debounce(e => { state.dialogSearch = e.target.value; renderCatalog(); }, 120));
    $('#dialog-type').addEventListener('change', e => { state.dialogType = e.target.value; renderCatalog(); });

    // dialog
    const dlg = $('#item-dialog');
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { renderItems(); const b = $('#open-item-dialog'); if (b && state.tab === 'items') b.focus(); });
    $('#custom-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#custom-name').value.trim();
      if (!name) return;
      const slot = $('#custom-slot').value.trim();
      const qty = slot ? 1 : clamp(parseInt($('#custom-qty').value, 10) || 1, [1, 999]);
      active().inventory.push({
        uid: HH.storage.uid(), itemId: null, name, qty, equipped: false,
        custom: { type: $('#custom-type').value.trim(), description: $('#custom-description').value.trim(), slot, consumable: $('#custom-consumable').checked },
      });
      persist();
      e.target.reset();
      $('#custom-status').textContent = `Added ${name}.`;
      $('#custom-name').focus();
    });

    // files
    $('#import-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const res = state.store.importJSON(await file.text());
        renderHeader(); renderMore();
        toast(`Added ${count(res.added, 'character')} from the backup.`);
      } catch (err) {
        toast(err.message);
      }
    });
    $('#preview-spells-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; previewFile('spells', f); });
    $('#preview-items-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; previewFile('items', f); });

    window.addEventListener('scroll', () => {
      $('#back-to-top').classList.toggle('show', window.scrollY > 700);
    }, { passive: true });
  }

  // ------------------------------------------------------------ start
  async function init() {
    state.store = HH.storage.createStore(HH.storage.browserBackend());
    const info = state.store.load();
    buildCharacterForm();
    wire();
    renderHeader();
    renderBanners();

    if (info.migratedFromOld) {
      addBanner('migrated', 'note', "Your character from the old app was copied here. The old app and its saved data were not changed.");
    }
    if (!state.store.isWritable()) {
      state.warnedStorage = true;
      addBanner('storage', 'problem', "This browser isn't letting the app save. Your changes will be lost when you close this page. Private browsing can cause this.");
    }

    const wanted = (location.hash || '').replace('#', '') || state.store.getUI().tab || 'character';
    gotoTab(wanted, false);

    await loadAll();
    renderTab(state.tab);
    renderHeader();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
