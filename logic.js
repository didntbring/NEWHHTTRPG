/*
 * Rules for filtering spells, finding spells a character is close to,
 * and judging how close a character is to a combo. No screen code in here.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  // ---------------------------------------------------------- spell filters
  function emptyFilters() {
    return {
      cast: new Set(), fp: new Set(), range: new Set(), dur: new Set(),
      el: new Set(), tag: new Set(), afford: false, ready: false,
    };
  }
  function activeCount(f) {
    return f.cast.size + f.fp.size + f.range.size + f.dur.size + f.el.size + f.tag.size +
      (f.afford ? 1 : 0) + (f.ready ? 1 : 0);
  }

  function fpMatches(spell, set) {
    const n = spell.fpNum;
    if (set.has('varies') && spell.fpVaries) return true;
    if (spell.fpVaries || n == null) return false;
    if (set.has('free') && n === 0) return true;
    if (set.has('1') && n === 1) return true;
    if (set.has('2') && n === 2) return true;
    if (set.has('3') && n === 3) return true;
    if (set.has('4+') && n >= 4) return true;
    return false;
  }

  // Different groups combine with AND; the choices inside one group combine with OR.
  // ctx = { currentFP, isReady(spell), tagKeys(spell) -> lowercase tag names }
  function matchesFilters(spell, f, ctx) {
    if (f.cast.size && !f.cast.has(spell.castKey)) return false;
    if (f.range.size && !f.range.has(spell.rangeKey)) return false;
    if (f.dur.size && !f.dur.has(spell.durKey)) return false;
    if (f.el.size && !spell.elements.some(e => f.el.has(e))) return false;
    if (f.fp.size && !fpMatches(spell, f.fp)) return false;
    if (f.tag.size && !ctx.tagKeys(spell).some(t => f.tag.has(t))) return false;
    if (f.afford && spell.fpNum != null && spell.fpNum > ctx.currentFP) return false;
    if (f.ready && !ctx.isReady(spell)) return false;
    return true;
  }

  // ---------------------------------------------------------- near misses
  // Spells the character doesn't have yet but is within `limit` points of qualifying for.
  // ctx = { stateOf(spell), near(spell) }  where near() is requirements.shortfall.
  function nearMisses(spells, ctx, limit) {
    const out = [];
    spells.forEach(spell => {
      if (ctx.stateOf(spell).inList) return;
      const sf = ctx.near(spell);
      if (sf && sf.points >= 1 && sf.points <= limit) out.push({ spell, shortfall: sf });
    });
    out.sort((a, b) => a.shortfall.points - b.shortfall.points || a.spell.row - b.spell.row);
    return out;
  }

  function gapText(sf) {
    return sf.steps.map(s => `${s.label} +${s.gap}`).join(', ');
  }

  // ---------------------------------------------------------- combos
  // ctx = { spellsById, stateOf(spell), near(spell) }
  function comboStatus(combo, ctx, nearLimit) {
    const parts = combo.spellIds.map(id => {
      const spell = ctx.spellsById.get(id);
      const st = ctx.stateOf(spell);
      let kind;
      let shortfall = null;
      if (st.ready) kind = 'ready';
      else if (st.inList) kind = 'learn';
      else {
        shortfall = ctx.near(spell);
        kind = shortfall && shortfall.points <= nearLimit ? 'near' : 'far';
      }
      return { spell, kind, shortfall };
    });
    const missing = parts.filter(p => p.kind !== 'ready').length;
    const far = parts.filter(p => p.kind === 'far').length;
    const points = parts.reduce((n, p) => n + (p.kind === 'near' ? p.shortfall.points : 0), 0);
    return {
      combo, parts, missing, far, points,
      ready: missing === 0,
      soon: far === 0,
      fp: parts.reduce((n, p) => n + (p.spell.fpNum || 0), 0),
      fpVaries: parts.some(p => p.spell.fpVaries),
    };
  }
  function compareCombos(a, b) {
    return (a.far > 0) - (b.far > 0) || a.missing - b.missing || a.points - b.points || a.combo.row - b.combo.row;
  }

  HH.logic = { emptyFilters, activeCount, matchesFilters, nearMisses, gapText, comboStatus, compareCombos };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.logic;
})();
