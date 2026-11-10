/*
 * Turns the rows of the spell and item CSV files into clean objects, and
 * collects friendly "Data Check" messages about anything that looks off.
 *
 * Column headings are matched loosely (capitals and spacing don't matter), and any
 * extra column you add is shown on the card automatically.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  const SPELL_FIELDS = {
    name: ['spell name', 'name', 'spell'],
    requirement: ['requirement', 'requirements', 'req'],
    range: ['range'],
    castTime: ['cast time', 'casting time'],
    fpCost: ['fp cost', 'fp', 'focus cost'],
    duration: ['duration'],
    description: ['description'],
    escalation: ['escalation', 'escalate'],
    rarity: ['rarity'],
    id: ['id'],
  };

  const ITEM_FIELDS = {
    name: ['item name', 'name', 'item'],
    type: ['type', 'category'],
    rarity: ['rarity'],
    slot: ['equip slot', 'slot', 'equip', 'equipment slot'],
    consumable: ['consumable', 'usable', 'use'],
    description: ['description'],
    id: ['id'],
  };

  const normHeader = h => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // "Fashion Transformation (uncommon)" -> "Fashion Transformation"
  function stripRarityTag(name) {
    return String(name).replace(/\s*\((?:common|uncommon|rare)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  function slug(s) {
    return String(s)
      .toLowerCase()
      .replace(/[’'`]/g, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // The stable key that characters use to remember a spell or item.
  const makeId = nameOrId => slug(stripRarityTag(nameOrId));

  function mapColumns(headers, fieldMap) {
    const index = {};
    const extras = [];
    headers.forEach((header, i) => {
      if (!header) return;
      const key = normHeader(header);
      const field = Object.keys(fieldMap).find(f => fieldMap[f].includes(key));
      if (field && !(field in index)) index[field] = i;
      else if (!field) extras.push({ label: header, index: i });
    });
    return { index, extras };
  }

  function splitEscalation(description) {
    const m = description.match(/\b(?:Escalation|Escalate|Escalating)\s*:\s*/i);
    if (!m) return { description, escalation: '' };
    const before = description.slice(0, m.index).trim();
    const after = description.slice(m.index + m[0].length).trim();
    if (!before || !after) return { description, escalation: '' };
    return { description: before, escalation: after };
  }

  function titleWord(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

  function uniqueId(base, taken, fallback) {
    let id = base || fallback;
    if (!taken.has(id)) return id;
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    return `${id}-${n}`;
  }

  function isYes(value) { return /^(y|yes|true|1|x|✓|consumable|use)$/i.test(value.trim()); }
  function isNo(value) { return /^(|n|no|false|0|-|none|n\/a)$/i.test(value.trim()); }

  // ---------------------------------------------------------------- spells
  function normalizeSpells(parsedCsv, options) {
    const halls = (options && options.halls) || (HH.config && HH.config.HALLS) || [];
    const issues = [];
    const spells = [];
    const { index, extras } = mapColumns(parsedCsv.headers, SPELL_FIELDS);

    if (!('name' in index)) {
      issues.push({ level: 'error', row: 1, message: 'Could not find a "Spell Name" column in the spell list.' });
      return { spells, issues, extraColumns: [] };
    }
    if (!('requirement' in index)) {
      issues.push({ level: 'warning', row: 1, message: 'No "Requirement" column found, so every spell counts as having no requirement.' });
    }

    const seen = new Map(); // id -> { signature, row }
    const taken = new Set();
    const unknownNames = new Map(); // name -> count of spells

    parsedCsv.records.forEach(rec => {
      const cell = field => (field in index ? rec.cells[index[field]] || '' : '');
      const rawName = cell('name');
      if (!rawName) {
        issues.push({ level: 'error', row: rec.row, message: 'A row has no spell name, so it was skipped.' });
        return;
      }
      const name = stripRarityTag(rawName);
      const baseId = makeId(cell('id') || rawName);
      const signature = JSON.stringify(rec.cells);

      if (seen.has(baseId)) {
        const first = seen.get(baseId);
        if (first.signature === signature) {
          issues.push({ level: 'warning', row: rec.row, message: `"${name}" is an exact copy of row ${first.row}. The copy was ignored; you can delete this row.` });
          return;
        }
        issues.push({ level: 'warning', row: rec.row, message: `"${name}" has the same name as row ${first.row} but different details. Both were kept; rename one if that's a mistake.` });
      } else {
        seen.set(baseId, { signature, row: rec.row });
      }
      const id = uniqueId(baseId, taken, `spell-${rec.row}`);
      taken.add(id);

      const rarityRaw = cell('rarity');
      let rarityKey = rarityRaw.toLowerCase();
      if (!rarityKey) {
        rarityKey = 'common';
        if ('rarity' in index) issues.push({ level: 'warning', row: rec.row, message: `"${name}" has no Rarity, so it was treated as Common.` });
      } else if (!['common', 'uncommon', 'rare'].includes(rarityKey)) {
        issues.push({ level: 'warning', row: rec.row, message: `"${name}" has an unfamiliar Rarity "${rarityRaw}" (expected Common, Uncommon or Rare).` });
      }

      const requirementText = cell('requirement');
      const req = HH.requirements.parse(requirementText, { halls });
      req.warnings.forEach(w => issues.push({ level: 'warning', row: rec.row, message: `"${name}" requirement: ${w}.` }));
      req.namedTerms.forEach(t => {
        const term = req.alternatives.flatMap(a => a.terms).find(x => x.kind === 'named' && x.name === t);
        if (term && !term.isHall) unknownNames.set(t, (unknownNames.get(t) || 0) + 1);
      });

      let description = cell('description');
      let escalation = cell('escalation');
      if (!escalation) ({ description, escalation } = splitEscalation(description));

      const fpCost = cell('fpCost');
      if ('fpCost' in index && fpCost === '') {
        issues.push({ level: 'warning', row: rec.row, message: `"${name}" has no FP Cost.` });
      }

      spells.push({
        id,
        row: rec.row,
        name,
        requirementText,
        req,
        range: cell('range'),
        castTime: cell('castTime'),
        fpCost,
        duration: cell('duration'),
        description,
        escalation,
        rarity: titleWord(rarityKey),
        rarityKey,
        extras: extras
          .map(e => ({ label: e.label, value: rec.cells[e.index] || '' }))
          .filter(e => e.value),
        search: `${name} ${description} ${escalation} ${requirementText}`.toLowerCase(),
      });
    });

    if (unknownNames.size) {
      const list = [...unknownNames].map(([n, c]) => `${n} (${c} spell${c === 1 ? '' : 's'})`).join(', ');
      issues.push({
        level: 'info', row: null,
        message: `These requirement names aren't in the Hall list, so they can't be checked automatically: ${list}. That's fine if it's intentional; those spells use Override / Learn.`,
      });
    }
    if (extras.length) {
      issues.push({ level: 'info', row: null, message: `Extra columns shown on spell cards: ${extras.map(e => e.label).join(', ')}.` });
    }
    return { spells, issues, extraColumns: extras.map(e => e.label) };
  }

  // ----------------------------------------------------------------- items
  function normalizeItems(parsedCsv) {
    const issues = [];
    const items = [];
    const { index, extras } = mapColumns(parsedCsv.headers, ITEM_FIELDS);

    if (!('name' in index)) {
      issues.push({ level: 'error', row: 1, message: 'Could not find an "Item Name" column in the item list.' });
      return { items, issues, extraColumns: [] };
    }

    const seen = new Map();
    const taken = new Set();

    parsedCsv.records.forEach(rec => {
      const cell = field => (field in index ? rec.cells[index[field]] || '' : '');
      const rawName = cell('name');
      if (!rawName) {
        issues.push({ level: 'error', row: rec.row, message: 'A row has no item name, so it was skipped.' });
        return;
      }
      const name = stripRarityTag(rawName);
      const baseId = makeId(cell('id') || rawName);
      const signature = JSON.stringify(rec.cells);

      if (seen.has(baseId)) {
        const first = seen.get(baseId);
        if (first.signature === signature) {
          issues.push({ level: 'warning', row: rec.row, message: `"${name}" is an exact copy of row ${first.row}. The copy was ignored; you can delete this row.` });
          return;
        }
        issues.push({ level: 'warning', row: rec.row, message: `"${name}" has the same name as row ${first.row} but different details. Both were kept; rename one if that's a mistake.` });
      } else {
        seen.set(baseId, { signature, row: rec.row });
      }
      const id = uniqueId(baseId, taken, `item-${rec.row}`);
      taken.add(id);

      const consumableRaw = cell('consumable');
      if (!isYes(consumableRaw) && !isNo(consumableRaw)) {
        issues.push({ level: 'warning', row: rec.row, message: `"${name}" has Consumable "${consumableRaw}". Use Yes or leave it blank.` });
      }
      const slotRaw = cell('slot');
      const equippable = !isNo(slotRaw);
      const rarityRaw = cell('rarity');

      items.push({
        id,
        row: rec.row,
        name,
        type: cell('type'),
        rarity: rarityRaw ? titleWord(rarityRaw) : '',
        rarityKey: rarityRaw.toLowerCase(),
        slot: equippable ? slotRaw : '',
        equippable,
        consumable: isYes(consumableRaw),
        description: cell('description'),
        extras: extras
          .map(e => ({ label: e.label, value: rec.cells[e.index] || '' }))
          .filter(e => e.value),
        search: `${name} ${cell('type')} ${cell('description')}`.toLowerCase(),
      });
    });

    if (extras.length) {
      issues.push({ level: 'info', row: null, message: `Extra columns shown on item cards: ${extras.map(e => e.label).join(', ')}.` });
    }
    return { items, issues, extraColumns: extras.map(e => e.label) };
  }

  HH.catalog = { normalizeSpells, normalizeItems, makeId, stripRarityTag, slug, splitEscalation };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.catalog;
})();
