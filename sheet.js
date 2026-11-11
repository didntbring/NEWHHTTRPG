/*
 * Character sheet math: modifiers, proficiency, saves, skills, initiative. No page code in here.
 */
(function () {
  'use strict';
  const HH = (typeof window !== 'undefined' ? (window.HH = window.HH || {}) : (global.HH = global.HH || {}));
  const cfg = () => HH.config;

  const mod = score => Math.floor((Number(score) - 10) / 2);
  function profBonus(level) {
    const P = cfg().PROFICIENCY;
    return P.base + Math.floor((Math.max(1, Number(level) || 1) - 1) / P.every);
  }
  const profValue = c => (c.profOverride != null ? c.profOverride : profBonus(c.level));

  // Proficiency level 0 none, 1 proficient, 2 double (some Hall features double it).
  function rowTotal(c, stat, level, override) {
    const auto = mod(c.stats[stat]) + (level || 0) * profValue(c);
    return { auto, total: override != null ? override : auto, overridden: override != null };
  }
  const saveTotal = (c, stat) => rowTotal(c, stat, c.saveProf[stat], c.saveOverride[stat]);
  function skillTotal(c, skill) {
    return rowTotal(c, skill.stat, c.skillProf[skill.key], c.skillOverride[skill.key]);
  }
  const initiative = c => mod(c.stats.dex) + (c.initBonus || 0);
  const fmt = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

  HH.sheet = { mod, profBonus, profValue, saveTotal, skillTotal, initiative, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.sheet;
})();
