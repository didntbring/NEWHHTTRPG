/*
 * The screen: reads the spell, item and combo lists, shows them, and saves the character.
 * Rules live in requirements.js and logic.js, list reading in catalog.js,
 * dice in dice.js, saving in storage.js.
 */
(function () {
  'use strict';
  const HH = window.HH;
  const C = HH.config;
  const L = HH.logic;
  const LABELS = HH.catalog.LABELS;

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
  const MINUS = '−';
  const signed = n => (n == null ? '—' : n > 0 ? `+${n}` : String(n).replace('-', MINUS));
  const parseNum = raw => parseInt(String(raw).replace(/[−–—]/g, '-').trim(), 10);

  const KINDS = {
    spells: { label: 'Spell list', title: 'Spells', noun: 'spell' },
    items: { label: 'Item list', title: 'Items', noun: 'item' },
    combos: { label: 'Combo list', title: 'Combos', noun: 'combo' },
  };

  const state = {
    store: null,
    spells: [], spellsById: new Map(),
    items: [], itemsById: new Map(),
    combos: [], combosText: null,
    issues: { spells: [], items: [], combos: [] },
    sources: { spells: null, items: null, combos: null },
    loading: true,
    banners: [],
    tab: 'character',
    open: new Set(),
    mineSearch: '', mf: L.emptyFilters(), mfOpen: false, groupBy: 'status',
    allSearch: '', allRarity: '', allSort: 'sheet', allQualified: false,
    allView: 'spells', allNear: false, nearLimit: C.NEAR_DEFAULT, comboSoon: false,
    itemSearch: '', dialogSearch: '', dialogType: '',
    dice: { counts: {}, history: [] },
    tagSpellId: null,
    vitalsVisible: true,
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
  const TAG_SVG = '<svg class="tag-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3.5 12.2V4.5h7.7l9.3 9.3-7.7 7.7z" stroke-width="1.8" stroke-linejoin="round" fill="none" stroke="currentColor"/><circle cx="8" cy="9" r="1.3" fill="currentColor"/></svg>';
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

  // ------------------------------------------------------------ tags
  const tagKey = HH.storage.tagKey;
  // Tags on a spell: the ones this character gave it, then any from the spell list.
  function tagsOf(spell, c) {
    c = c || active();
    const out = [];
    const add = name => {
      if (out.some(t => tagKey(t.name) === tagKey(name))) return;
      const own = c.tags.find(t => tagKey(t.name) === tagKey(name));
      out.push({ name: own ? own.name : name, color: own ? own.color : 'slate' });
    };
    (c.spellTags[spell.id] || []).forEach(add);
    spell.tags.forEach(add);
    return out;
  }
  const tagKeysOf = (spell, c) => tagsOf(spell, c).map(t => tagKey(t.name));
  const tagChip = t => `<span class="tag-chip tc-${esc(t.color)}">${esc(t.name)}</span>`;
  // Every tag the character could filter or group by: their own, then any only in the spell list.
  function allTagNames(c) {
    const names = c.tags.map(t => ({ name: t.name, color: t.color }));
    state.spells.forEach(s => s.tags.forEach(n => {
      if (!names.some(x => tagKey(x.name) === tagKey(n))) names.push({ name: n, color: 'slate' });
    }));
    return names;
  }
  function suggestedTags(spell, c) {
    const have = tagKeysOf(spell, c);
    const out = [];
    if (/\bdamage\b/i.test(spell.description) && !have.includes('damage')) out.push({ name: 'Damage', color: 'ruby' });
    if (/\bheal(s|ing)?\b|restores?\b.{0,40}hit points/i.test(spell.description) && !have.includes('healing')) out.push({ name: 'Healing', color: 'lime' });
    return out;
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
  const maxNear = Math.max(...C.NEAR_CHOICES);

  function spellCard(spell, mode) {
    const c = active();
    const st = stateOf(spell, c);
    const open = state.open.has(spell.id);
    const unlearned = mode === 'mine' && st.needs && !st.learned;
    const bodyId = `sp-${spell.id}-${mode}`;
    const fav = mode === 'mine' && c.favorites.includes(spell.id);
    const myTags = mode === 'mine' ? tagsOf(spell, c) : [];

    const tags = [];
    if (fav) tags.push(`<span class="fav-mark" title="Favorite">${STAR_SVG}<span class="sr-only">Favorite</span></span>`);
    myTags.forEach(t => tags.push(tagChip(t)));
    if (spell.rarityKey && spell.rarityKey !== 'common') {
      tags.push(`<span class="tag ${esc(spell.rarityKey)}">${esc(spell.rarity)}</span>`);
    }

    let gap = null;
    if (mode === 'all') {
      if (st.ev.met) tags.push('<span class="badge ok">You qualify</span>');
      else if (st.overridden) tags.push('<span class="badge added">Added by override</span>');
      else {
        gap = HH.requirements.shortfall(spell.req, c);
        if (gap && gap.points >= 1 && gap.points <= maxNear) {
          tags.push(`<span class="badge near">${count(gap.points, 'point')} away</span>`);
        }
      }
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
    const needsLine = gap && gap.points >= 1
      ? `<p class="help">To qualify you need: ${esc(L.gapText(gap))}.</p>` : '';

    let actions = '';
    if (mode === 'all') {
      if (!st.ev.met) {
        actions = st.overridden
          ? `<button type="button" class="btn small" data-action="override" data-id="${esc(spell.id)}" aria-pressed="true">Remove override</button>`
          : `<button type="button" class="btn small" data-action="override" data-id="${esc(spell.id)}" aria-pressed="false">Override and add</button>`;
      }
    } else {
      actions += `<button type="button" class="btn small star" data-action="favorite" data-id="${esc(spell.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}: ${esc(spell.name)}">${STAR_SVG}${fav ? 'Favorite' : 'Add favorite'}</button>`;
      const ownCount = (c.spellTags[spell.id] || []).length;
      actions += `<button type="button" class="btn small" data-action="tag-dialog" data-id="${esc(spell.id)}" aria-label="Tags for ${esc(spell.name)}">${TAG_SVG}${ownCount ? `Tags (${ownCount})` : 'Tags'}</button>`;
      if (st.needs) {
        actions += `<button type="button" class="btn small" data-action="learn" data-id="${esc(spell.id)}" aria-pressed="${st.learned}">${st.learned ? 'Learned' : 'Learn spell'}</button>`;
      }
      const cost = castCost(spell);
      if (st.ready && cost > 0) {
        actions += `<button type="button" class="btn small primary cast-btn" data-action="cast" data-id="${esc(spell.id)}" data-cost="${cost}"${c.currentFP < cost ? ' disabled' : ''}>Cast for ${cost} FP</button>`;
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
          ${needsLine}
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
    const label = KINDS[kind].noun;
    const src = state.sources[kind];
    if (state.loading) return '<div class="empty"><p>Loading the lists.</p></div>';
    if (src && src.from === 'none' && kind === 'items' && src.detail === 'missing') {
      return `<div class="empty"><p>There is no item list yet. Add a file named <b>${esc(C.DATA.items)}</b>, or add custom items yourself.</p></div>`;
    }
    return `<div class="empty"><p>The ${label} list couldn't be loaded.${location.protocol === 'file:' ? ' Browsers block loading it when index.html is opened as a file. Open the app from its web address instead.' : ' Check your connection, then try again.'}</p><button type="button" class="btn" data-action="reload-data">Try again</button></div>`;
  }

  // ------------------------------------------------------------ health, focus points, spell numbers
  function updateVitals() {
    const c = active();
    $('#hp-current').textContent = c.currentHP;
    $('#hp-max').textContent = c.maxHP;
    $('#hp-temp').textContent = c.tempHP;
    $('#hp-temp-chip').hidden = c.tempHP <= 0;
    const pct = c.maxHP ? Math.round((100 * c.currentHP) / c.maxHP) : 0;
    $('#hp-fill').style.width = `${pct}%`;
    const hp = $('#hp-block');
    hp.classList.toggle('empty', c.currentHP === 0);
    hp.classList.toggle('low', c.currentHP > 0 && c.currentHP <= c.maxHP / 4);
    $('#hp-bar').setAttribute('aria-label', `${c.currentHP} of ${c.maxHP} hit points${c.tempHP ? `, plus ${c.tempHP} temporary` : ''}`);

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

    $('#num-dc').textContent = c.saveDC == null ? '—' : c.saveDC;
    $('#num-atk').textContent = signed(c.attackMod);
    $('#num-dmg').textContent = signed(c.damageMod);
    $('#vm-hp').textContent = `${c.currentHP}/${c.maxHP}${c.tempHP ? ` +${c.tempHP}` : ''}`;
    $('#vm-fp').textContent = `${c.currentFP}/${c.maxFP}`;
    $('#vm-dc').textContent = c.saveDC == null ? '—' : c.saveDC;
    $('#vm-atk').textContent = signed(c.attackMod);
    $('#vm-dmg').textContent = signed(c.damageMod);
    renderHeader();
  }
  function updateMini() {
    $('#vitals-mini').hidden = !(state.tab === 'my-spells' && !state.vitalsVisible);
  }
  function setFP(value) {
    const c = active();
    c.currentFP = clamp(value, [0, c.maxFP]);
    persist();
    updateVitals();
  }
  function hpAmount() {
    const n = parseNum($('#hp-amount').value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 1;
  }
  function hpAction(dir) {
    const c = active();
    const before = { hp: c.currentHP, temp: c.tempHP };
    const amt = hpAmount();
    let msg;
    if (dir === 'damage') {
      let left = amt;
      const fromTemp = Math.min(c.tempHP, left);
      c.tempHP -= fromTemp;
      left -= fromTemp;
      c.currentHP = Math.max(0, c.currentHP - left);
      msg = `Took ${amt} damage. ${c.currentHP} HP left${c.tempHP ? `, plus ${c.tempHP} temp` : ''}.`;
    } else if (dir === 'heal') {
      c.currentHP = Math.min(c.maxHP, c.currentHP + amt);
      if (c.currentHP === before.hp) { toast('Already at full health.'); return; }
      msg = `Healed ${c.currentHP - before.hp}. ${c.currentHP} of ${c.maxHP} HP.`;
    } else if (dir === 'temp') {
      c.tempHP = Math.min(C.RANGES.temp[1], c.tempHP + amt);
      msg = `Added ${amt} temp HP. ${c.tempHP} temp in total.`;
    } else if (dir === 'clear-temp') {
      if (!c.tempHP) return;
      c.tempHP = 0;
      msg = 'Cleared temporary hit points.';
    } else return;
    persist();
    updateVitals();
    toast(msg, () => { c.currentHP = before.hp; c.tempHP = before.temp; persist(); updateVitals(); });
  }
  function fullRest() {
    const c = active();
    const before = { hp: c.currentHP, temp: c.tempHP, fp: c.currentFP };
    c.currentHP = c.maxHP;
    c.tempHP = 0;
    c.currentFP = c.maxFP;
    persist();
    updateVitals();
    toast('Rested. Hit points and focus points are full.', () => {
      c.currentHP = before.hp; c.tempHP = before.temp; c.currentFP = before.fp;
      persist(); updateVitals();
    });
  }

  // ------------------------------------------------------------ My spells: filters
  const FILTER_GROUPS = [
    { id: 'cast', title: 'Cast time', order: ['action', 'bonus', 'reaction', 'long', 'other'], labels: LABELS.cast, of: s => [s.castKey] },
    { id: 'fp', title: 'FP cost', order: ['free', '1', '2', '3', '4+', 'varies'], labels: LABELS.fp, of: fpBuckets },
    { id: 'range', title: 'Range', order: ['self', 'touch', 'ranged', 'other'], labels: LABELS.range, of: s => [s.rangeKey] },
    { id: 'dur', title: 'Duration', order: ['instant', 'concentration', 'lasting', 'other'], labels: LABELS.dur, of: s => [s.durKey] },
  ];
  function fpBuckets(s) {
    if (s.fpVaries) return ['varies'];
    if (s.fpNum == null) return [];
    return [s.fpNum === 0 ? 'free' : s.fpNum >= 4 ? '4+' : String(s.fpNum)];
  }

  function chipButton(group, value, label, n, pressed) {
    return `<button type="button" class="chip" data-action="mf-chip" data-group="${esc(group)}" data-value="${esc(value)}" aria-pressed="${pressed}">${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
  }

  function renderFilterPanel() {
    const n = L.activeCount(state.mf);
    const toggle = $('#mf-toggle');
    toggle.textContent = n ? `Filters (${n})` : 'Filters';
    toggle.setAttribute('aria-expanded', String(state.mfOpen));
    toggle.setAttribute('aria-pressed', String(n > 0));
    $('#mf-group').value = state.groupBy;
    const panel = $('#mf-panel');
    panel.hidden = !state.mfOpen;
    if (!state.mfOpen) return;

    const c = active();
    const mine = state.spells.filter(s => stateOf(s, c).inList);
    const tally = (keysOf) => {
      const m = new Map();
      mine.forEach(s => keysOf(s).forEach(k => m.set(k, (m.get(k) || 0) + 1)));
      return m;
    };
    const sections = FILTER_GROUPS.map(g => {
      const counts = tally(g.of);
      const chips = g.order
        .filter(v => counts.get(v) || state.mf[g.id].has(v))
        .map(v => chipButton(g.id, v, esc(g.labels[v]), counts.get(v) || 0, state.mf[g.id].has(v)));
      return chips.length ? `<div class="mf-group"><h4>${g.title}</h4><div class="chips">${chips.join('')}</div></div>` : '';
    });

    const elCounts = tally(s => s.elements);
    const elChips = C.ELEMENTS
      .filter(k => elCounts.get(k) || state.mf.el.has(k))
      .map(k => chipButton('el', k, `${glyphHTML(k, 14)}${esc(C.STAT_NAMES[k])}`, elCounts.get(k) || 0, state.mf.el.has(k)));
    const elSection = elChips.length ? `<div class="mf-group"><h4>Element in requirement</h4><div class="chips">${elChips.join('')}</div></div>` : '';

    const tagCounts = tally(s => tagKeysOf(s, c));
    const tagChips = allTagNames(c)
      .filter(t => tagCounts.get(tagKey(t.name)) || state.mf.tag.has(tagKey(t.name)))
      .map(t => chipButton('tag', tagKey(t.name), esc(t.name), tagCounts.get(tagKey(t.name)) || 0, state.mf.tag.has(tagKey(t.name))));
    const tagSection = tagChips.length ? `<div class="mf-group"><h4>Tag</h4><div class="chips">${tagChips.join('')}</div></div>` : '';

    const flags = `<div class="mf-group"><h4>Other</h4><div class="chips">
      <button type="button" class="chip" data-action="mf-flag" data-flag="afford" aria-pressed="${state.mf.afford}">I can afford it now</button>
      <button type="button" class="chip" data-action="mf-flag" data-flag="ready" aria-pressed="${state.mf.ready}">Ready to cast only</button>
    </div></div>`;

    panel.innerHTML = sections.join('') + elSection + tagSection + flags +
      `<div class="mf-foot"><button type="button" class="btn small" data-action="mf-clear"${n ? '' : ' disabled'}>Clear filters</button></div>`;
  }

  // ------------------------------------------------------------ My spells: list
  function groupHeading(title, n, tag) {
    return `<h3>${tag ? tagChip(tag) : title} <span class="count">${n}</span></h3>`;
  }

  function renderMine() {
    updateVitals();
    renderFilterPanel();
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
    const ctx = { currentFP: c.currentFP, isReady: s => stateOf(s, c).ready, tagKeys: s => tagKeysOf(s, c) };
    const shown = mine.filter(x => hasAll(toks, `${x.s.search} ${tagKeysOf(x.s, c).join(' ')}`) && L.matchesFilters(x.s, state.mf, ctx));
    if (!shown.length) {
      box.innerHTML = `<div class="empty"><p>${L.activeCount(state.mf) ? 'None of your spells match these filters.' : 'None of your spells match that search.'}</p>
        ${L.activeCount(state.mf) ? '<button type="button" class="btn" data-action="mf-clear">Clear filters</button>' : ''}</div>`;
      return;
    }

    const isFav = x => c.favorites.includes(x.s.id);
    const favs = shown.filter(isFav);
    const rest = shown.filter(x => !isFav(x));
    const groups = [];
    if (favs.length) groups.push({ title: 'Favorites', list: favs, cls: 'favorites' });

    if (state.groupBy === 'tag') {
      const order = allTagNames(c);
      const first = x => {
        const keys = tagKeysOf(x.s, c);
        const hit = order.find(t => keys.includes(tagKey(t.name)));
        return hit ? tagKey(hit.name) : null;
      };
      order.forEach(t => {
        const list = rest.filter(x => first(x) === tagKey(t.name));
        if (list.length) groups.push({ tag: t, list });
      });
      const none = rest.filter(x => first(x) === null);
      if (none.length) groups.push({ title: 'No tag', list: none });
    } else if (state.groupBy === 'cast') {
      ['action', 'bonus', 'reaction', 'long', 'other'].forEach(k => {
        const list = rest.filter(x => x.s.castKey === k);
        if (list.length) groups.push({ title: LABELS.cast[k], list });
      });
    } else {
      const ready = rest.filter(x => x.st.ready);
      const locked = rest.filter(x => !x.st.ready);
      if (ready.length) groups.push({ title: 'Ready to cast', list: ready });
      if (locked.length) groups.push({ title: 'Not learned yet', list: locked });
    }

    box.innerHTML = groups.map(g => `<div class="spell-group${g.cls ? ' ' + g.cls : ''}">${groupHeading(g.title, g.list.length, g.tag)}<div class="spells">${g.list.map(x => spellCard(x.s, 'mine')).join('')}</div></div>`).join('');
  }

  // ------------------------------------------------------------ All spells
  function nearCtx(c) {
    return { stateOf: s => stateOf(s, c), near: s => HH.requirements.shortfall(s.req, c) };
  }

  function renderAll() {
    $('#all-spells-view').hidden = state.allView !== 'spells';
    $('#all-combos-view').hidden = state.allView !== 'combos';
    $$('[data-action="all-view"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.allView)));
    $('#near-range-wrap').hidden = !state.allNear;
    $('#all-near').checked = state.allNear;
    $('#all-near-range').value = String(state.nearLimit);
    $('#combo-near-range').value = String(state.nearLimit);
    if (state.allView === 'combos') { renderCombos(); return; }

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

    let near = [];
    if (state.allNear) {
      near = L.nearMisses(list, nearCtx(c), state.nearLimit);
      const ids = new Set(near.map(x => x.spell.id));
      list = list.filter(s => !ids.has(s.id));
    }
    const total = list.length + near.length;
    $('#all-count').textContent = `Showing ${total} of ${state.spells.length} spells` +
      (state.allNear ? `, ${near.length} within reach` : '');

    if (!total) {
      box.innerHTML = '<div class="empty"><p>No spells match. Try fewer words, or clear the filters.</p></div>';
      return;
    }
    const nearHTML = near.length
      ? `<div class="spell-group near"><h3>Within reach <span class="count">${near.length}</span></h3>
          <p class="help">Spells you are at most ${count(state.nearLimit, 'point')} away from qualifying for, closest first.</p>
          <div class="spells">${near.map(x => spellCard(x.spell, 'all')).join('')}</div></div>`
      : (state.allNear ? '<p class="help">No spells are within reach right now. Try a larger distance.</p>' : '');
    const restHTML = list.length
      ? (near.length ? `<div class="spell-group"><h3>Everything else <span class="count">${list.length}</span></h3><div class="spells">${list.map(s => spellCard(s, 'all')).join('')}</div></div>`
        : `<div class="spells">${list.map(s => spellCard(s, 'all')).join('')}</div>`)
      : '';
    box.innerHTML = nearHTML + restHTML;
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
  function buildNearSelects() {
    const opts = C.NEAR_CHOICES.map(n => `<option value="${n}">${count(n, 'point')}</option>`).join('');
    $('#all-near-range').innerHTML = opts;
    $('#combo-near-range').innerHTML = opts;
  }

  // ------------------------------------------------------------ Combos
  function comboPartText(p) {
    if (p.kind === 'ready') return 'Ready';
    if (p.kind === 'learn') return 'Learn it first';
    if (p.shortfall) return `${p.kind === 'near' ? 'Needs' : 'Far off, needs'} ${L.gapText(p.shortfall)}`;
    return "Can't be checked automatically";
  }
  function renderCombos() {
    const box = $('#combo-list');
    if (state.loading) { box.innerHTML = '<div class="empty"><p>Loading the lists.</p></div>'; return; }
    if (!state.spells.length) { box.innerHTML = loadProblemHTML('spells'); return; }
    if (!state.combos.length) {
      box.innerHTML = `<div class="empty"><p>There are no combos yet. Add a file named <b>${esc(C.DATA.combos)}</b> with the columns <b>Combo Name</b>, <b>Spells</b> and <b>Description</b>. Separate the spells with semicolons, like <b>Mage Light; Distant Voices</b>.</p></div>`;
      return;
    }
    const c = active();
    const ctx = Object.assign({ spellsById: state.spellsById }, nearCtx(c));
    let list = state.combos.map(x => L.comboStatus(x, ctx, state.nearLimit)).sort(L.compareCombos);
    if (state.comboSoon) list = list.filter(s => s.soon);
    $('#combo-soon').checked = state.comboSoon;
    if (!list.length) {
      box.innerHTML = '<div class="empty"><p>No combos are within reach yet. Try a larger distance, or turn the filter off.</p></div>';
      return;
    }
    box.innerHTML = `<div class="stack">${list.map(s => {
      const total = s.parts.length;
      const summary = s.ready
        ? `You can use all ${total} spells.`
        : `${s.missing} of ${total} still to go${s.points ? `, ${count(s.points, 'point')} of stats needed` : ''}.`;
      const fp = s.fp || s.fpVaries ? `Total ${s.fp} FP${s.fpVaries ? ' or more' : ''}.` : '';
      const facts = s.combo.extras.length
        ? `<dl class="facts">${s.combo.extras.map(f => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl>` : '';
      return `<article class="combo${s.ready ? ' ready' : ''}">
        <h3 class="combo-title">${esc(s.combo.name)}</h3>
        <p class="combo-status">${esc(summary)} ${esc(fp)}</p>
        ${s.combo.description ? `<div class="prose">${paragraphs(s.combo.description)}</div>` : ''}
        ${facts}
        <ul class="combo-spells">${s.parts.map(p => `<li>
          <button type="button" class="combo-spell" data-action="combo-spell" data-id="${esc(p.spell.id)}">${esc(p.spell.name)}</button>
          <span class="cs-state cs-${p.kind}">${esc(comboPartText(p))}</span>
          ${p.spell.fpCost !== '' ? `<span class="fp-pill">${esc(p.spell.fpCost)} FP</span>` : ''}
        </li>`).join('')}</ul>
      </article>`;
    }).join('')}</div>`;
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

  // ------------------------------------------------------------ tag dialog
  const colorOptions = selected => C.TAG_COLORS.map(x => `<option value="${esc(x.key)}"${x.key === selected ? ' selected' : ''}>${esc(x.name)}</option>`).join('');

  function renderTagDialog() {
    const c = active();
    const spell = state.spellsById.get(state.tagSpellId);
    if (!spell) return;
    $('#tag-dialog-title').textContent = `Tags: ${spell.name}`;
    const own = c.spellTags[spell.id] || [];
    const picks = c.tags.length
      ? c.tags.map(t => `<label class="check tag-pick"><input type="checkbox" data-tag="${esc(t.name)}"${own.some(n => tagKey(n) === tagKey(t.name)) ? ' checked' : ''}> ${tagChip(t)}</label>`).join('')
      : '<p>You have no tags yet. Make one below.</p>';
    const fromList = spell.tags.length
      ? `<p class="fine">Also tagged in the spell list: ${spell.tags.map(esc).join(', ')}.</p>` : '';
    const sugg = suggestedTags(spell, c);
    const suggHTML = sugg.length
      ? `<div class="sugg"><span class="fine">From the description:</span> ${sugg.map(t => `<button type="button" class="btn small" data-action="tag-suggest" data-name="${esc(t.name)}" data-color="${esc(t.color)}">Add ${esc(t.name)} tag</button>`).join(' ')}</div>` : '';
    $('#tag-dialog-body').innerHTML = `
      <div class="tag-picks">${picks}</div>
      ${fromList}
      ${suggHTML}
      <form id="tag-dialog-form" class="tag-form" autocomplete="off">
        <div class="field"><label for="td-name">New tag</label><input id="td-name" type="text" maxlength="24" placeholder="Healing, Damage, Utility"></div>
        <div class="field"><label for="td-color">Color</label><select id="td-color">${colorOptions('sky')}</select></div>
        <button type="submit" class="btn primary">Add and apply</button>
      </form>`;
  }
  function openTagDialog(spellId) {
    state.tagSpellId = spellId;
    renderTagDialog();
    const dlg = $('#tag-dialog');
    if (!dlg.open) dlg.showModal();
  }
  function applyTagToSpell(name, color) {
    const c = active();
    const tag = HH.storage.addTag(c, name, color);
    if (!tag) return;
    const list = c.spellTags[state.tagSpellId] || [];
    if (!list.some(n => tagKey(n) === tagKey(tag.name))) HH.storage.toggleSpellTag(c, state.tagSpellId, tag.name);
    persist();
    renderTagDialog();
    if (state.tab === 'my-spells') renderMine();
  }

  // ------------------------------------------------------------ dice
  function renderDiceRows() {
    const maxEach = C.DICE_MAX_PER_TYPE;
    $('#dice-rows').innerHTML = C.DICE.map(sides => `
      <div class="die-row">
        <span class="die-name">d${sides}</span>
        <div class="stepper">
          <button type="button" class="step" data-action="die" data-sides="${sides}" data-delta="-1" aria-label="One fewer d${sides}">&minus;</button>
          <input type="text" inputmode="numeric" data-die="${sides}" value="${state.dice.counts[sides] || 0}" aria-label="Number of d${sides}" autocomplete="off">
          <button type="button" class="step" data-action="die" data-sides="${sides}" data-delta="1" aria-label="One more d${sides}">+</button>
        </div>
      </div>`).join('');
    const c = active();
    const presets = [];
    if (c.attackMod != null) presets.push(`<button type="button" class="btn small" data-action="dice-preset" data-kind="attack">Spell attack: d20 ${signed(c.attackMod).replace('+', '+ ')}</button>`);
    if (c.damageMod != null) presets.push(`<button type="button" class="btn small" data-action="dice-preset" data-kind="damage">Use damage modifier ${signed(c.damageMod)}</button>`);
    $('#dice-presets').innerHTML = presets.join('');
    void maxEach;
  }
  function diceMod() {
    const n = parseNum($('#dice-mod').value);
    return Number.isFinite(n) ? clamp(n, [-99, 99]) : 0;
  }
  function setDie(sides, raw) {
    const n = parseNum(raw);
    const v = clamp(Number.isFinite(n) ? n : 0, [0, C.DICE_MAX_PER_TYPE]);
    state.dice.counts[sides] = v;
    const input = $(`[data-die="${sides}"]`);
    if (input) input.value = v;
  }
  function renderDiceHistory() {
    const h = state.dice.history;
    $('#dice-history').innerHTML = h.length
      ? `<h3 class="slot-heading">Recent rolls</h3><ol class="dice-history">${h.map(r => `<li>${esc(r.notation)} = <b>${r.total}</b></li>`).join('')}</ol>` : '';
  }
  function doRoll() {
    const result = HH.dice.roll(state.dice.counts, diceMod(), undefined, C.DICE);
    const box = $('#dice-result');
    if (!result) {
      box.innerHTML = '<p class="fine">Choose at least one die, then roll.</p>';
      return;
    }
    const detail = result.groups.map(g => `d${g.sides}: ${g.rolls.join(', ')}`).join('; ');
    box.innerHTML = `<div class="roll-total">${result.total}</div>
      <div class="roll-notation">${esc(result.notation)}</div>
      <div class="roll-detail">${esc(detail)}${result.modifier ? `; modifier ${signed(result.modifier)}` : ''}</div>
      ${result.nat ? `<div class="roll-nat">${esc(result.nat)}</div>` : ''}`;
    state.dice.history.unshift({ notation: result.notation, total: result.total });
    state.dice.history = state.dice.history.slice(0, 8);
    renderDiceHistory();
  }
  function openDice() {
    renderDiceRows();
    renderDiceHistory();
    const dlg = $('#dice-dialog');
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
    const fieldHTML = group => Object.entries(C.NUMBER_FIELDS).filter(([, f]) => f.group === group).map(([k, f]) => `
      <div class="field" data-field-row="${k}">
        <label for="field-${k}">${esc(f.label)}</label>
        <div class="stepper">
          <button type="button" class="step" data-action="step-field" data-field="${k}" data-delta="-1" aria-label="Lower ${esc(f.label)}">&minus;</button>
          <input id="field-${k}" type="text" inputmode="numeric" data-field="${k}" placeholder="—" autocomplete="off">
          <button type="button" class="step" data-action="step-field" data-field="${k}" data-delta="1" aria-label="Raise ${esc(f.label)}">+</button>
        </div>
      </div>`).join('');
    $('#health-fields').innerHTML = fieldHTML('health');
    $('#number-fields').innerHTML = fieldHTML('numbers');
    $('#char-hall').innerHTML = '<option value="">None</option>' + C.HALLS.map(h => `<option>${esc(h)}</option>`).join('');
    $('#new-tag-color').innerHTML = colorOptions('sky');
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
  function updateField(key) {
    const c = active();
    const f = C.NUMBER_FIELDS[key];
    const range = C.RANGES[f.range];
    const row = $(`[data-field-row="${key}"]`);
    const value = c[key];
    $('input', row).value = value == null ? '' : value;
    const [minus, plus] = $$('.step', row);
    minus.disabled = value != null && value <= range[0];
    plus.disabled = value != null && value >= range[1];
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
    Object.keys(C.NUMBER_FIELDS).forEach(updateField);
    updateSummary();
  }
  function setStat(key, raw) {
    const c = active();
    const isEl = C.ELEMENTS.includes(key);
    const bag = isEl ? c.elements : c.stats;
    let n = parseNum(raw);
    if (!Number.isFinite(n)) n = bag[key];
    bag[key] = clamp(n, isEl ? C.RANGES.element : C.RANGES.core);
    persist();
    updateStatRow(key);
    updateSummary();
  }
  function setField(key, raw) {
    const c = active();
    const f = C.NUMBER_FIELDS[key];
    const range = C.RANGES[f.range];
    const text = String(raw).trim();
    let n;
    if (text === '' && f.nullable) n = null;
    else {
      n = parseNum(text);
      if (!Number.isFinite(n)) n = c[key];
      if (n != null) n = clamp(n, range);
    }
    if (key === 'maxHP') {
      const wasFull = c.currentHP >= c.maxHP;
      c.maxHP = n;
      c.currentHP = wasFull ? c.maxHP : Math.min(c.currentHP, c.maxHP);
    } else {
      c[key] = n;
    }
    persist();
    updateField(key);
    updateVitals();
  }

  // ------------------------------------------------------------ header
  function renderHeader() {
    const c = active();
    const sel = $('#char-switch');
    sel.innerHTML = state.store.characters.map(x => `<option value="${esc(x.id)}"${x.id === c.id ? ' selected' : ''}>${esc(x.name || 'Unnamed')}</option>`).join('');
    $('#who-sub').innerHTML = `<span>Level ${c.level}</span>${c.hall ? `<span>${esc(c.hall)}</span>` : ''}<span>HP ${c.currentHP} of ${c.maxHP}</span><span>FP ${c.currentFP} of ${c.maxFP}</span>`;
    document.title = `${c.name || 'Unnamed'} - Spell Finder`;
  }

  // ------------------------------------------------------------ More tab
  function issueRows() {
    const rank = { error: 0, warning: 1, info: 2 };
    const all = [];
    Object.keys(KINDS).forEach(kind => state.issues[kind].forEach(i => all.push(Object.assign({ kind, source: KINDS[kind].label }, i))));
    return all.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  function renderMoreTags() {
    const c = active();
    const used = name => Object.values(c.spellTags).filter(list => list.some(n => tagKey(n) === tagKey(name))).length;
    $('#more-tags').innerHTML = c.tags.length
      ? c.tags.map(t => `<div class="tag-row">
          ${tagChip(t)}
          <span class="fine">${count(used(t.name), 'spell')}</span>
          <label class="sr-only" for="tc-${esc(tagKey(t.name))}">Color for ${esc(t.name)}</label>
          <select id="tc-${esc(tagKey(t.name))}" data-tag-color="${esc(t.name)}">${colorOptions(t.color)}</select>
          <button type="button" class="btn small quiet" data-action="tag-delete" data-name="${esc(t.name)}">Delete</button>
        </div>`).join('')
      : '<p class="fine">No tags yet. Make one below, or from a spell card on My spells.</p>';
  }
  function renderMore() {
    const c = active();
    $('#more-characters').innerHTML = state.store.characters.map(x => `
      <button type="button" class="char-row" data-action="char-pick" data-id="${esc(x.id)}">
        <span class="who"><b>${esc(x.name || 'Unnamed')}</b><span>Level ${x.level}${x.hall ? `, ${esc(x.hall)}` : ''}</span></span>
        ${x.id === c.id ? '<span class="current">Current</span>' : ''}
      </button>`).join('');
    renderMoreTags();

    const srcText = kind => {
      const s = state.sources[kind];
      const n = state[kind].length;
      const K = KINDS[kind];
      if (!s) return `<li><b>${K.title}:</b> loading.</li>`;
      if (s.from === 'preview') return `<li><b>${K.title}:</b> ${count(n, K.noun)} from ${esc(s.detail)} (preview only; reload the page to go back).</li>`;
      if (s.from === 'cache') return `<li><b>${K.title}:</b> ${count(n, K.noun)} from the copy saved on this device${s.detail ? ` on ${esc(shortDate(s.detail))}` : ''}. The live list couldn't be reached.</li>`;
      if (s.from === 'none') return `<li><b>${K.title}:</b> not loaded${s.detail === 'missing' ? ` (no file at ${esc(C.DATA[kind])})` : ''}.</li>`;
      return `<li><b>${K.title}:</b> ${count(n, K.noun)} loaded from ${esc(C.DATA[kind])}.</li>`;
    };
    $('#more-data').innerHTML = `<ul class="status-list">${srcText('spells')}${srcText('items')}${srcText('combos')}</ul>`;

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

  function rebuildCombos() {
    if (!state.combosText || !state.spells.length) { state.combos = []; return; }
    const out = HH.catalog.normalizeCombos(HH.csv.parseCSV(state.combosText), state.spellsById);
    state.combos = out.combos;
    state.issues.combos = out.issues;
  }

  function applyKind(kind, result) {
    state.sources[kind] = { from: result.from, detail: result.detail };
    const K = KINDS[kind];
    if (!result.text) {
      state[kind] = [];
      if (kind === 'combos') state.combosText = null;
      // The item and combo lists are optional, so a missing or unreachable one isn't an error.
      state.issues[kind] = kind === 'spells'
        ? [{ level: 'error', row: null, message: `The ${K.noun} list couldn't be loaded from ${C.DATA[kind]}.` }]
        : (kind === 'items' && result.detail !== 'missing'
          ? [{ level: 'error', row: null, message: `The ${K.noun} list couldn't be loaded from ${C.DATA[kind]}.` }] : []);
    } else if (kind === 'combos') {
      state.combosText = result.text;
      state.issues.combos = [];
    } else {
      const parsed = HH.csv.parseCSV(result.text);
      const out = kind === 'spells'
        ? HH.catalog.normalizeSpells(parsed, { halls: C.HALLS })
        : HH.catalog.normalizeItems(parsed);
      state[kind] = kind === 'spells' ? out.spells : out.items;
      state.issues[kind] = out.issues;
    }
    if (kind === 'spells') state.spellsById = new Map(state.spells.map(x => [x.id, x]));
    if (kind === 'items') state.itemsById = new Map(state.items.map(x => [x.id, x]));
    if (kind === 'spells' || kind === 'combos') rebuildCombos();
  }

  function dataBanners() {
    dropBanners(/^(load|data)-/);
    Object.keys(KINDS).forEach(kind => {
      const s = state.sources[kind];
      const noun = KINDS[kind].noun;
      if (s.from === 'cache') {
        addBanner(`load-${kind}`, 'problem', `The live ${noun} list couldn't be reached, so you're seeing the copy saved on this device${s.detail ? ` on ${esc(shortDate(s.detail))}` : ''}.`);
      } else if (s.from === 'none' && kind === 'spells') {
        addBanner('load-spells', 'problem', location.protocol === 'file:'
          ? "The spell list couldn't be loaded. Browsers block this when index.html is opened as a file; open the app from its web address instead."
          : "The spell list couldn't be loaded. Check your connection and try again from the More tab.");
      }
    });
    const errors = issueRows().filter(i => i.level === 'error' && i.row);
    if (errors.length) {
      addBanner('data-errors', 'problem', `${count(errors.length, 'row')} in your spell, item or combo list need fixing. Open More, then Data check.`);
    }
  }

  async function loadAll() {
    state.loading = true;
    const [s, i, m] = await Promise.all([loadKind('spells'), loadKind('items'), loadKind('combos')]);
    applyKind('spells', s);
    applyKind('items', i);
    applyKind('combos', m);
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
      addBanner(`preview-${kind}`, 'note', `Previewing <b>${esc(file.name)}</b> in place of the ${KINDS[kind].noun} list. Reload the page to go back to the live list.`, false);
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
    if (scroll !== false) { state.vitalsVisible = true; }
    renderTab(tab);
    updateMini();
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
      if (state.tab === 'my-spells') renderMine(); else if (state.allNear) renderAll(); else refreshCard(id, 'all');
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
    hp: el => hpAction(el.dataset.dir),
    rest: () => fullRest(),
    step: el => {
      const c = active();
      const key = el.dataset.stat;
      const cur = (C.ELEMENTS.includes(key) ? c.elements : c.stats)[key];
      setStat(key, cur + Number(el.dataset.delta));
    },
    'step-field': el => {
      const key = el.dataset.field;
      const f = C.NUMBER_FIELDS[key];
      const cur = active()[key];
      setField(key, cur == null ? f.start : cur + Number(el.dataset.delta));
    },

    'mf-panel': () => { state.mfOpen = !state.mfOpen; renderFilterPanel(); },
    'mf-chip': el => {
      const set = state.mf[el.dataset.group];
      const v = el.dataset.value;
      if (set.has(v)) set.delete(v); else set.add(v);
      renderMine();
      const again = $(`#mf-panel [data-action="mf-chip"][data-group="${el.dataset.group}"][data-value="${CSS.escape(v)}"]`);
      if (again) again.focus();
    },
    'mf-flag': el => {
      state.mf[el.dataset.flag] = !state.mf[el.dataset.flag];
      renderMine();
      const again = $(`#mf-panel [data-flag="${el.dataset.flag}"]`);
      if (again) again.focus();
    },
    'mf-clear': () => { state.mf = L.emptyFilters(); renderMine(); },

    'tag-dialog': el => openTagDialog(el.dataset.id),
    'close-tag-dialog': () => $('#tag-dialog').close(),
    'tag-suggest': el => applyTagToSpell(el.dataset.name, el.dataset.color),
    'tag-delete': el => {
      const c = active();
      const snapshot = { tags: JSON.parse(JSON.stringify(c.tags)), spellTags: JSON.parse(JSON.stringify(c.spellTags)) };
      state.mf.tag.delete(tagKey(el.dataset.name));
      HH.storage.deleteTag(c, el.dataset.name);
      persist();
      renderMoreTags();
      toast(`Deleted the ${el.dataset.name} tag.`, () => {
        c.tags = snapshot.tags; c.spellTags = snapshot.spellTags;
        persist(); renderMoreTags();
      });
    },

    'all-view': el => { state.allView = el.dataset.view; renderAll(); },
    'combo-spell': el => {
      const spell = state.spellsById.get(el.dataset.id);
      if (!spell) return;
      state.allView = 'spells';
      state.allSearch = spell.name;
      state.allRarity = ''; state.allQualified = false;
      state.open.add(spell.id);
      $('#all-search').value = spell.name;
      $('#all-rarity').value = '';
      $('#all-qualified').checked = false;
      renderAll();
      window.scrollTo(0, 0);
    },

    'open-dice': () => openDice(),
    'close-dice': () => $('#dice-dialog').close(),
    die: el => { setDie(el.dataset.sides, (state.dice.counts[el.dataset.sides] || 0) + Number(el.dataset.delta)); },
    'dice-mod': el => { $('#dice-mod').value = clamp(diceMod() + Number(el.dataset.delta), [-99, 99]); },
    'dice-roll': () => doRoll(),
    'dice-reset': () => {
      C.DICE.forEach(s => setDie(s, 0));
      $('#dice-mod').value = 0;
      $('#dice-result').innerHTML = '';
    },
    'dice-preset': el => {
      const c = active();
      if (el.dataset.kind === 'attack') {
        C.DICE.forEach(s => setDie(s, s === 20 ? 1 : 0));
        $('#dice-mod').value = c.attackMod;
      } else {
        $('#dice-mod').value = c.damageMod;
      }
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
  function setNear(value) {
    state.nearLimit = Number(value) || C.NEAR_DEFAULT;
    state.store.setUI({ nearLimit: state.nearLimit });
    renderAll();
  }

  function wire() {
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = actions[el.dataset.action];
      if (fn) fn(el);
    });
    document.addEventListener('submit', e => {
      if (e.target.id === 'tag-dialog-form') {
        e.preventDefault();
        const name = $('#td-name').value;
        if (name.trim()) applyTagToSpell(name, $('#td-color').value);
      }
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
      else if (e.target.matches('input[data-field]')) setField(e.target.dataset.field, e.target.value);
    });
    $('#tab-character').addEventListener('focusin', e => {
      if (e.target.matches('input[data-stat], input[data-field]')) e.target.select();
    });
    $('#char-switch').addEventListener('change', e => switchCharacter(e.target.value));
    $('#hp-amount').addEventListener('focus', e => e.target.select());

    // My spells filters
    $('#my-search').addEventListener('input', debounce(e => { state.mineSearch = e.target.value; renderMine(); }, 120));
    $('#mf-group').addEventListener('change', e => {
      state.groupBy = e.target.value;
      state.store.setUI({ groupBy: state.groupBy });
      renderMine();
    });

    // All spells
    $('#all-search').addEventListener('input', debounce(e => { state.allSearch = e.target.value; renderAll(); }, 120));
    $('#all-rarity').addEventListener('change', e => { state.allRarity = e.target.value; renderAll(); });
    $('#all-sort').addEventListener('change', e => { state.allSort = e.target.value; renderAll(); });
    $('#all-qualified').addEventListener('change', e => { state.allQualified = e.target.checked; renderAll(); });
    $('#all-near').addEventListener('change', e => {
      state.allNear = e.target.checked;
      state.store.setUI({ allNear: state.allNear });
      renderAll();
    });
    $('#all-near-range').addEventListener('change', e => setNear(e.target.value));
    $('#combo-near-range').addEventListener('change', e => setNear(e.target.value));
    $('#combo-soon').addEventListener('change', e => { state.comboSoon = e.target.checked; renderAll(); });

    // items
    $('#item-search').addEventListener('input', debounce(e => { state.itemSearch = e.target.value; renderItems(); }, 120));
    $('#dialog-search').addEventListener('input', debounce(e => { state.dialogSearch = e.target.value; renderCatalog(); }, 120));
    $('#dialog-type').addEventListener('change', e => { state.dialogType = e.target.value; renderCatalog(); });

    // dialogs
    ['item-dialog', 'tag-dialog', 'dice-dialog'].forEach(id => {
      const dlg = $(`#${id}`);
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    });
    $('#item-dialog').addEventListener('close', () => { renderItems(); const b = $('#open-item-dialog'); if (b && state.tab === 'items') b.focus(); });
    $('#tag-dialog').addEventListener('close', () => { if (state.tab === 'my-spells') renderMine(); });
    $('#tag-dialog-body').addEventListener('change', e => {
      if (!e.target.matches('input[data-tag]')) return;
      HH.storage.toggleSpellTag(active(), state.tagSpellId, e.target.dataset.tag);
      persist();
      if (state.tab === 'my-spells') renderMine();
    });
    $('#dice-dialog').addEventListener('change', e => {
      if (e.target.matches('input[data-die]')) setDie(e.target.dataset.die, e.target.value);
      if (e.target.id === 'dice-mod') e.target.value = diceMod();
    });
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

    // More tab
    $('#tag-form').addEventListener('submit', e => {
      e.preventDefault();
      const input = $('#new-tag-name');
      if (!input.value.trim()) return;
      HH.storage.addTag(active(), input.value, $('#new-tag-color').value);
      persist();
      input.value = '';
      renderMoreTags();
    });
    $('#more-tags').addEventListener('change', e => {
      if (!e.target.matches('select[data-tag-color]')) return;
      const tag = active().tags.find(t => tagKey(t.name) === tagKey(e.target.dataset.tagColor));
      if (tag) { tag.color = e.target.value; persist(); renderMoreTags(); }
    });
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
    ['spells', 'items', 'combos'].forEach(kind => {
      $(`#preview-${kind}-file`).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; previewFile(kind, f); });
    });

    window.addEventListener('scroll', () => {
      $('#back-to-top').classList.toggle('show', window.scrollY > 700);
    }, { passive: true });

    // Show the compact health and focus readout once the full panel has scrolled out of view.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        state.vitalsVisible = entries[0].isIntersecting;
        updateMini();
      }, { rootMargin: '-56px 0px 0px 0px' }).observe($('#vitals'));
    }
  }

  // ------------------------------------------------------------ start
  async function init() {
    state.store = HH.storage.createStore(HH.storage.browserBackend());
    const info = state.store.load();
    const ui = state.store.getUI();
    if (['status', 'tag', 'cast'].includes(ui.groupBy)) state.groupBy = ui.groupBy;
    if (typeof ui.allNear === 'boolean') state.allNear = ui.allNear;
    if (C.NEAR_CHOICES.includes(ui.nearLimit)) state.nearLimit = ui.nearLimit;

    buildCharacterForm();
    buildNearSelects();
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

    const wanted = (location.hash || '').replace('#', '') || ui.tab || 'character';
    gotoTab(wanted, false);

    await loadAll();
    renderTab(state.tab);
    renderHeader();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
