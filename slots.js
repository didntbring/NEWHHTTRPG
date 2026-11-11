/*
 * Equip slots: which slot(s) an item needs, and where it goes. No page code in here.
 */
(function () {
  'use strict';
  const HH = (typeof window !== 'undefined' ? (window.HH = window.HH || {}) : (global.HH = global.HH || {}));
  const norm = s => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/\bslot\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
  const cfg = () => HH.config;

  // What an item's Equip Slot text asks for.
  //   {kind:'one', options:[...]}  one slot, the first free one is used
  //   {kind:'all', slots:[...]}    takes all of these at once
  //   {kind:'any', options:[...]}  any slot
  //   null                         no slot text (not equippable)
  function needs(label) {
    const C = cfg();
    const key = norm(label);
    if (!key) return null;
    if (C.SLOT_MULTI[key]) return { kind: 'all', slots: C.SLOT_MULTI[key].slice() };
    if (C.SLOT_ANY.words.includes(key)) {
      const rest = C.EQUIP_SLOTS.filter(s => !C.SLOT_ANY.prefer.includes(s));
      return { kind: 'any', options: C.SLOT_ANY.prefer.concat(rest).filter(s => C.EQUIP_SLOTS.includes(s)) };
    }
    if (C.SLOT_RULES[key]) return { kind: 'one', options: C.SLOT_RULES[key].slice() };
    const exact = C.EQUIP_SLOTS.find(s => s.toLowerCase() === String(label).trim().toLowerCase());
    if (exact) return { kind: 'one', options: [exact] };
    // Unknown text: its own slot, named as written.
    const own = String(label).trim().slice(0, 24);
    return { kind: 'one', options: [own] };
  }

  // occupied: Map(slot -> entry uid). Returns {slots, displaced:[uids]} or null.
  function place(req, occupied) {
    if (!req) return null;
    if (req.kind === 'all') {
      const displaced = [...new Set(req.slots.map(s => occupied.get(s)).filter(Boolean))];
      return { slots: req.slots.slice(), displaced };
    }
    const free = req.options.find(s => !occupied.has(s));
    if (free) return { slots: [free], displaced: [] };
    const first = req.options[0];
    return { slots: [first], displaced: [occupied.get(first)] };
  }

  // The map of which entry fills which slot for a character.
  function occupancy(inventory) {
    const m = new Map();
    inventory.forEach(e => (e.slots || []).forEach(s => m.set(s, e.uid)));
    return m;
  }

  // The slots to show: the configured ones, then any custom slots in use.
  function visibleSlots(inventory) {
    const all = cfg().EQUIP_SLOTS.slice();
    inventory.forEach(e => (e.slots || []).forEach(s => { if (!all.includes(s)) all.push(s); }));
    return all;
  }

  HH.slots = { needs, place, occupancy, visibleSlots, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.slots;
})();
