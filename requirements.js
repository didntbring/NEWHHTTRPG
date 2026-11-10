/*
 * Reads the "Requirement" text of a spell and checks it against a character.
 *
 * How requirement text is understood (this is the only place that knows the rules):
 *   Fire 4                 -> Fire must be at least 4
 *   Any 3                  -> at least ONE element must be 3 or higher (not 3 in total)
 *   Air 4 / Spirit 3       -> both are needed ("/" and "," both mean AND)
 *   Fire 4, DEX 12         -> both are needed
 *   A OR B   (or ", or B") -> either option is enough
 *   1 Earth / 1 Fire       -> the number can come first
 *   Animalians, Spectral Field, Arcanium (Runic Design 5)
 *                          -> a name that is not a stat. It can't be checked
 *                             automatically, so it never qualifies you by itself;
 *                             use "Override" or "Learn" on the spell instead.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  const ELEMENTS = ['fire', 'air', 'spirit', 'earth', 'water'];
  const CORE = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const LONG_NAMES = {
    strength: 'str', dexterity: 'dex', constitution: 'con',
    intelligence: 'int', wisdom: 'wis', charisma: 'cha',
  };

  function statKey(name) {
    const k = name.trim().toLowerCase();
    if (ELEMENTS.includes(k) || CORE.includes(k)) return k;
    return LONG_NAMES[k] || null;
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // "PROTECTORS" -> "Protectors"; mixed-case names are left alone.
  function pretty(name) {
    const n = name.trim().replace(/\s+/g, ' ');
    return n === n.toUpperCase() && n.length > 3 ? titleCase(n) : n;
  }

  function statLabel(key, min) {
    return ELEMENTS.includes(key) ? `${titleCase(key)} ${min}` : `${key.toUpperCase()} ${min}`;
  }

  function makeTerm(name, number, note, halls, warnings, piece) {
    const lower = name.trim().toLowerCase();
    if (lower === 'any') {
      if (number == null) {
        warnings.push(`"${piece}" needs a number (for example "Any 3")`);
      } else {
        return { kind: 'any', min: number, label: `Any element ${number}` };
      }
    }
    const key = statKey(lower);
    if (key) {
      if (number == null) {
        warnings.push(`"${piece}" needs a number (for example "${titleCase(key)} 3")`);
      } else {
        return { kind: 'stat', key, min: number, label: statLabel(key, number) };
      }
    }
    const display = pretty(name) + (number != null ? ` ${number}` : '');
    return {
      kind: 'named',
      name: pretty(name),
      min: number,
      note: note || '',
      isHall: halls.includes(lower),
      label: display + (note ? ` (${note})` : ''),
    };
  }

  function termsFromPiece(piece, note, halls, warnings) {
    let m = piece.match(/^(\d+)\s+([A-Za-z][A-Za-z' ]*)$/); // "1 Earth"
    if (m) return [makeTerm(m[2], parseInt(m[1], 10), note, halls, warnings, piece)];

    // "Fire 4", "INT15", and also "Earth 2 Dex 15" (a missing comma).
    const re = /([A-Za-z][A-Za-z' ]*?)\s*(\d+)/g;
    const found = [];
    let last = 0;
    let clean = true;
    while ((m = re.exec(piece))) {
      if (piece.slice(last, m.index).trim() !== '') clean = false;
      found.push(m);
      last = re.lastIndex;
    }
    if (piece.slice(last).trim() !== '') clean = false;
    if (found.length && clean) {
      return found.map(f => makeTerm(f[1], parseInt(f[2], 10), note, halls, warnings, piece));
    }

    // A bare name such as "Animalians" or "Spectral Field".
    if (/^[A-Za-z][A-Za-z' ]*$/.test(piece)) {
      return [makeTerm(piece, null, note, halls, warnings, piece)];
    }

    warnings.push(`Couldn't understand "${piece}"`);
    return [{ kind: 'named', name: piece, min: null, note: '', isHall: false, label: piece }];
  }

  function parse(raw, opts) {
    const halls = ((opts && opts.halls) || []).map(h => h.toLowerCase());
    const text = String(raw == null ? '' : raw).trim();
    const result = { raw: text, none: false, alternatives: [], warnings: [], namedTerms: [] };
    if (!text || /^(none|n\/a|na|-|—|–)$/i.test(text)) {
      result.none = true;
      return result;
    }

    // Set "(notes)" aside so their contents can't be mistaken for separators.
    const notes = [];
    const masked = text.replace(/\(([^)]*)\)/g, (_, inner) => {
      notes.push(inner.trim());
      return ` \u0001${notes.length - 1}\u0001 `;
    });

    const options = masked.split(/\s*,?\s*\bor\b\s*/i);
    for (const option of options) {
      const terms = [];
      const pieces = option.split(/\s*(?:[\/,;&]|\band\b)\s*/i);
      for (let piece of pieces) {
        let note = '';
        piece = piece.replace(/\u0001(\d+)\u0001/g, (_, i) => { note = notes[Number(i)]; return ''; }).trim();
        if (!piece) continue;
        terms.push(...termsFromPiece(piece, note, halls, result.warnings));
      }
      if (!terms.length) {
        result.warnings.push('There is an empty option (check for a stray "OR" or comma)');
        continue;
      }
      result.alternatives.push({ terms });
    }

    const seen = new Set();
    result.alternatives.forEach(a => a.terms.forEach(t => {
      if (t.kind === 'named' && !seen.has(t.name)) { seen.add(t.name); result.namedTerms.push(t.name); }
    }));
    return result;
  }

  // character = { elements: {fire,...}, stats: {str,...} }
  // Returns { met, alternatives: [{ met, uncheckable, terms: [{ term, met: true|false|null }] }] }
  // (met === null means "a name that can't be checked automatically").
  function evaluate(parsed, character) {
    if (parsed.none) return { met: true, alternatives: [] };
    const elements = (character && character.elements) || {};
    const stats = (character && character.stats) || {};
    const value = key => Number(key in elements ? elements[key] : stats[key]) || 0;
    const highestElement = Math.max(0, ...ELEMENTS.map(k => Number(elements[k]) || 0));

    const alternatives = parsed.alternatives.map(alt => {
      const terms = alt.terms.map(term => {
        let met = null;
        if (term.kind === 'stat') met = value(term.key) >= term.min;
        else if (term.kind === 'any') met = highestElement >= term.min;
        return { term, met };
      });
      return {
        terms,
        met: terms.length > 0 && terms.every(t => t.met === true),
        uncheckable: terms.some(t => t.met === null),
      };
    });
    return { met: alternatives.some(a => a.met), alternatives };
  }

  HH.requirements = { parse, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.requirements;
})();
