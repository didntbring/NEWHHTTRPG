/*
 * Dice rolling. Pure logic, so it can be tested without a screen.
 * Rolls use the browser's secure random numbers and are exactly fair
 * (no "modulo bias", where some faces would come up slightly more often).
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  const MAX_TOTAL_DICE = 100;

  // Returns a function rng(n) that gives a whole number from 0 to n - 1.
  function makeRng() {
    let cr = root.crypto;
    if ((!cr || !cr.getRandomValues) && typeof require === 'function') {
      try { cr = require('crypto').webcrypto; } catch (e) { cr = null; }
    }
    if (cr && cr.getRandomValues) {
      const buf = new Uint32Array(1);
      return n => {
        const limit = Math.floor(0x100000000 / n) * n;
        let x;
        do { cr.getRandomValues(buf); x = buf[0]; } while (x >= limit);
        return x % n;
      };
    }
    return n => Math.floor(Math.random() * n);
  }

  const MINUS = '−';

  // counts: { 20: 1, 6: 2 } means one d20 and two d6. Returns null if no dice were chosen.
  function roll(counts, modifier, rng, order) {
    rng = rng || makeRng();
    const sidesList = (order || Object.keys(counts).map(Number)).filter(s => counts[s] > 0);
    const groups = [];
    let total = 0;
    let dice = 0;
    sidesList.forEach(sides => {
      const count = Math.min(Math.floor(counts[sides]), MAX_TOTAL_DICE - dice);
      if (count <= 0) return;
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(rng(sides) + 1);
      const sum = rolls.reduce((a, b) => a + b, 0);
      groups.push({ sides, count, rolls, sum });
      total += sum;
      dice += count;
    });
    if (!groups.length) return null;
    const mod = Math.trunc(Number(modifier)) || 0;
    const d20 = groups.find(g => g.sides === 20);
    let nat = null;
    if (d20 && d20.count === 1) nat = d20.rolls[0] === 20 ? 'Natural 20' : d20.rolls[0] === 1 ? 'Natural 1' : null;
    const notation = groups.map(g => `${g.count}d${g.sides}`).join(' + ') +
      (mod ? ` ${mod > 0 ? '+' : MINUS} ${Math.abs(mod)}` : '');
    return { groups, modifier: mod, diceTotal: total, total: total + mod, notation, nat };
  }

  HH.dice = { roll, makeRng, MAX_TOTAL_DICE };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.dice;
})();
