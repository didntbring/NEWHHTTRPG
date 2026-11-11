/*
 * Checks for the app's logic. Run from this folder with:   node run.js
 * (needs Node 18 or newer; nothing to install).
 * It reads your real spells.csv, so it also tells you if an edit broke something.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.HH = {};
['config', 'defaults', 'csv', 'requirements', 'catalog', 'dice', 'logic', 'storage'].forEach(f => require(`./${f}.js`));
const HH = globalThis.HH;
const readData = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

let passed = 0;
let failed = 0;
let skipped = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n         ${e.message.split('\n').join('\n         ')}`); }
}
function testIf(condition, name, fn) {
  if (condition) test(name, fn);
  else { skipped++; console.log(`  skip ${name}`); }
}
function section(title) { console.log(`\n${title}`); }

const halls = HH.config.HALLS;
const parse = text => HH.requirements.parse(text, { halls });
const char = (elements = {}, stats = {}) => ({
  elements: Object.assign({ fire: 0, air: 0, spirit: 0, earth: 0, water: 0 }, elements),
  stats: Object.assign({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, stats),
});
const meets = (text, c) => HH.requirements.evaluate(parse(text), c).met;
const spellsFrom = csv => HH.catalog.normalizeSpells(HH.csv.parseCSV(csv), { halls });
const gap = (text, c) => HH.requirements.shortfall(parse(text), c);

// ------------------------------------------------------------------ CSV
section('CSV reader');
test('handles BOM, quotes, escaped quotes and line breaks inside cells', () => {
  const text = '﻿A,B,C\r\n1,"two, with comma","he said ""hi"""\r\n"line1\nline2",x,y\r\n';
  const { headers, records } = HH.csv.parseCSV(text);
  assert.deepStrictEqual(headers, ['A', 'B', 'C']);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].cells[1], 'two, with comma');
  assert.strictEqual(records[0].cells[2], 'he said "hi"');
  assert.strictEqual(records[1].cells[0], 'line1\nline2');
});
test('row numbers match a spreadsheet (header is row 1, blank rows still count)', () => {
  const { records } = HH.csv.parseCSV('A,B\n1,2\n,\n3,4\n');
  assert.deepStrictEqual(records.map(r => r.row), [2, 4]);
});
test('short rows are padded and no trailing newline is needed', () => {
  const { records } = HH.csv.parseCSV('A,B,C\n1,2');
  assert.deepStrictEqual(records[0].cells, ['1', '2', '']);
});

// ---------------------------------------------------------- requirements
section('Requirement rules');
test('"Any N" means N in any ONE element, not N in total', () => {
  assert.strictEqual(meets('Any 3', char({ fire: 3 })), true);
  assert.strictEqual(meets('Any 3', char({ water: 5 })), true);
  assert.strictEqual(meets('Any 3', char({ fire: 1, air: 1, spirit: 1 })), false);
  assert.strictEqual(meets('Any 3', char({ fire: 2, air: 2, earth: 2, water: 2 })), false);
});
test('single stat, and case does not matter', () => {
  assert.strictEqual(meets('Fire 4', char({ fire: 4 })), true);
  assert.strictEqual(meets('fire 4', char({ fire: 3 })), false);
  assert.strictEqual(meets('SPIRIT 2', char({ spirit: 2 })), true);
});
test('"/" and "," both mean AND', () => {
  assert.strictEqual(meets('Air 4 / Spirit 3', char({ air: 4, spirit: 3 })), true);
  assert.strictEqual(meets('Air 4 / Spirit 3', char({ air: 4, spirit: 2 })), false);
  assert.strictEqual(meets('Fire 4, Dex 12', char({ fire: 4 }, { dex: 12 })), true);
  assert.strictEqual(meets('Fire 4, Dex 12', char({ fire: 4 }, { dex: 11 })), false);
});
test('core stats are checked together with elements', () => {
  const r = 'Water 4 / Fire 4, CHA 13';
  assert.strictEqual(meets(r, char({ water: 4, fire: 4 }, { cha: 13 })), true);
  assert.strictEqual(meets(r, char({ water: 4, fire: 4 }, { cha: 12 })), false);
});
test('OR gives alternatives; a Hall name alone never qualifies', () => {
  assert.strictEqual(meets('Animalians OR WIS 13, Water 3', char({ water: 3 }, { wis: 13 })), true);
  assert.strictEqual(meets('Animalians OR WIS 13, Water 3', char({ water: 3 }, { wis: 12 })), false);
  assert.strictEqual(meets('Animalians', char({ fire: 10 })), false);
});
test('", or Hall" and lowercase "or" are alternatives too', () => {
  const p = parse('Fire 4, Int 13, or Aura Healers');
  assert.strictEqual(p.alternatives.length, 2);
  assert.strictEqual(p.alternatives[0].terms.length, 2);
  assert.strictEqual(p.alternatives[1].terms[0].name, 'Aura Healers');
  assert.strictEqual(meets('Fire 4, Int 13, or Aura Healers', char({ fire: 4 }, { int: 13 })), true);
});
test('missing comma ("Earth 2 Dex 15") and missing space ("INT15") are understood', () => {
  const p = parse('Air 7, Earth 2 Dex 15, or Stone Singers');
  assert.strictEqual(p.warnings.length, 0);
  assert.strictEqual(p.alternatives[0].terms.length, 3);
  assert.strictEqual(meets('Arcanium (Runic Design 7) or INT15', char({}, { int: 15 })), true);
});
test('number-first form ("1 Earth / 1 Fire / 1 Spirit")', () => {
  assert.strictEqual(meets('1 Earth / 1 Fire / 1 Spirit', char({ earth: 1, fire: 1, spirit: 1 })), true);
  assert.strictEqual(meets('1 Earth / 1 Fire / 1 Spirit', char({ earth: 1, fire: 1 })), false);
});
test('notes in brackets are kept but never treated as requirements', () => {
  const p = parse('Animalians (Hunter 10) OR WIS 14, Water 6, Earth 6');
  assert.strictEqual(p.alternatives[0].terms[0].note, 'Hunter 10');
  assert.strictEqual(p.alternatives[0].terms[0].name, 'Animalians');
  assert.strictEqual(p.warnings.length, 0);
});
test('special names (not a stat or Hall) can never qualify on their own', () => {
  assert.strictEqual(meets('Earth 6, Int 14, Spectral Field', char({ earth: 9 }, { int: 20 })), false);
  assert.deepStrictEqual(parse('Earth 6, Int 14, Spectral Field').namedTerms, ['Spectral Field']);
});
test('"None" and blank mean everyone qualifies', () => {
  assert.strictEqual(meets('None', char()), true);
  assert.strictEqual(meets('', char()), true);
});
test('ALL-CAPS names are tidied for display', () => {
  assert.strictEqual(parse('Spirit 5, DEX 11 or PROTECTORS').alternatives[1].terms[0].name, 'Protectors');
});
test('a stat with no number is reported, not silently accepted', () => {
  assert.ok(parse('Fire').warnings.length > 0);
  assert.ok(parse('Any').warnings.length > 0);
});

// ------------------------------------------------------ how close (near miss)
section('How close a character is to qualifying');
test('already qualified is 0 points', () => {
  assert.strictEqual(gap('Fire 4', char({ fire: 4 })).points, 0);
  assert.strictEqual(gap('None', char()).points, 0);
});
test('one stat short', () => {
  const g = gap('Fire 4', char({ fire: 2 }));
  assert.strictEqual(g.points, 2);
  assert.deepStrictEqual(g.steps.map(s => `${s.label} +${s.gap}`), ['Fire +2']);
});
test('several stats short add up, and core stats are named in capitals', () => {
  const g = gap('Fire 4, Dex 12', char({ fire: 3 }, { dex: 10 }));
  assert.strictEqual(g.points, 3);
  assert.deepStrictEqual(g.steps.map(s => `${s.label} +${s.gap}`), ['Fire +1', 'DEX +2']);
  assert.strictEqual(HH.logic.gapText(g), 'Fire +1, DEX +2');
});
test('"Any N" is measured from the character\'s highest element', () => {
  assert.strictEqual(gap('Any 3', char({ fire: 1, water: 2 })).points, 1);
  assert.strictEqual(gap('Any 3', char()).points, 3);
});
test('with OR, the cheapest option counts', () => {
  assert.strictEqual(gap('Fire 6 OR Air 4', char({ fire: 5, air: 1 })).points, 1);
});
test('a Hall option is ignored, but the checkable option still counts', () => {
  assert.strictEqual(gap('Animalians OR WIS 13, Water 3', char({ water: 3 }, { wis: 12 })).points, 1);
});
test('a requirement that cannot be checked at all gives null', () => {
  assert.strictEqual(gap('Animalians', char()), null);
  assert.strictEqual(gap('Earth 6, Int 14, Spectral Field', char({ earth: 6 }, { int: 14 })), null);
});

// ----------------------------------------------------------- real spells
section('Your spell list (spells.csv)');
const spellResult = spellsFrom(readData('spells.csv'));
const has = id => spellResult.spells.some(s => s.id === id);
test('loads spells', () => {
  assert.ok(spellResult.spells.length > 0, 'no spells loaded');
});
test('every requirement is understood (no parser warnings)', () => {
  const bad = spellResult.issues.filter(i => /requirement:/.test(i.message));
  assert.strictEqual(bad.length, 0, bad.map(b => `row ${b.row}: ${b.message}`).join('\n'));
});
test('no spell is missing a name, rarity or FP cost', () => {
  const bad = spellResult.issues.filter(i => i.level === 'error' || /no Rarity|no FP Cost|unfamiliar Rarity/.test(i.message));
  assert.strictEqual(bad.length, 0, bad.map(b => `row ${b.row}: ${b.message}`).join('\n'));
});
test('spell ids are unique and "(uncommon)" tags are stripped from names', () => {
  const ids = spellResult.spells.map(s => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(spellResult.spells.every(s => !/\((un)?common\)/i.test(s.name)));
});
test('escalation text is never left inside a description', () => {
  assert.ok(spellResult.spells.every(s => !/Escalation:/i.test(s.description)));
});
testIf(has('final-strike'), 'a repeated spell row appears only once', () => {
  assert.strictEqual(spellResult.spells.filter(s => s.id === 'final-strike').length, 1);
});
test('every spell has a cast, range, duration and element category for the filters', () => {
  const cast = ['action', 'bonus', 'reaction', 'long', 'other'];
  const range = ['self', 'touch', 'ranged', 'other'];
  const dur = ['instant', 'concentration', 'lasting', 'other'];
  spellResult.spells.forEach(s => {
    assert.ok(cast.includes(s.castKey), `${s.name}: cast ${s.castKey}`);
    assert.ok(range.includes(s.rangeKey), `${s.name}: range ${s.rangeKey}`);
    assert.ok(dur.includes(s.durKey), `${s.name}: duration ${s.durKey}`);
    assert.ok(Array.isArray(s.elements));
  });
});
test('cast times written different ways land in the same category', () => {
  const r = spellsFrom('Spell Name,Cast Time\nA,Action\nB,1 action\nC,Bonus\nD,Bonus action\nE,1 bonus action\nF,Reaction\nG,5 minutes\nH,1 minutes\nI,\n');
  assert.deepStrictEqual(r.spells.map(s => s.castKey), ['action', 'action', 'bonus', 'bonus', 'bonus', 'reaction', 'long', 'long', 'other']);
});
test('FP costs: plain numbers, group costs and blanks', () => {
  const r = spellsFrom('Spell Name,FP Cost\nA,0\nB,2\nC,4 + 1 per mage\nD,\n');
  assert.deepStrictEqual(r.spells.map(s => [s.fpNum, s.fpVaries]), [[0, false], [2, false], [4, true], [null, false]]);
});
test('range and duration categories', () => {
  const r = spellsFrom('Spell Name,Range,Duration\nA,Self,Instant\nB,Self or Touch,Instantaneous\nC,Touch,Concentration\nD,30 feet,"Concentration, up to 1 minute"\nE,100 ft,1 hour\nF,Summoning Circle,Until long rest\nG,50’ by 50’,\n');
  assert.deepStrictEqual(r.spells.map(s => s.rangeKey), ['self', 'self', 'touch', 'ranged', 'ranged', 'other', 'ranged']);
  assert.deepStrictEqual(r.spells.map(s => s.durKey), ['instant', 'instant', 'concentration', 'concentration', 'lasting', 'lasting', 'other']);
});
test('elements are read from the requirement, in any option', () => {
  const r = spellsFrom('Spell Name,Requirement\nA,Fire 2 / Air 1\nB,Any 2\nC,Water 3 OR Earth 3\nD,DEX 12\n');
  assert.deepStrictEqual(r.spells.map(s => s.elements), [['fire', 'air'], [], ['water', 'earth'], []]);
});
test('an optional Tags column is read ("Damage; Fire")', () => {
  const r = spellsFrom('Spell Name,Tags\nA,Damage; Fire\nB,\nC,heal;Heal ; Support\n');
  assert.deepStrictEqual(r.spells.map(s => s.tags), [['Damage', 'Fire'], [], ['heal', 'Support']]);
  assert.strictEqual(r.spells[0].extras.length, 0);
});

// ------------------------------------------------------- catalog details
section('Spell and item list handling');
test('column headings are matched loosely and extra columns are kept', () => {
  const r = spellsFrom('spell NAME,REQUIREMENT,fp cost,Rarity,Description,School\nZap,Fire 1,1,Common,Hi,Evocation\n');
  assert.strictEqual(r.spells[0].name, 'Zap');
  assert.deepStrictEqual(r.spells[0].extras, [{ label: 'School', value: 'Evocation' }]);
});
test('an ID column keeps saved checkmarks when a spell is renamed', () => {
  const r = spellsFrom('Spell Name,ID,Requirement,Rarity\nBrand New Name,Old Name,Fire 1,Uncommon\n');
  assert.strictEqual(r.spells[0].id, HH.catalog.makeId('Old Name'));
});
test('same name with different details keeps both and warns', () => {
  const r = spellsFrom('Spell Name,Requirement,Rarity\nA,Fire 1,Common\nA,Fire 2,Common\n');
  assert.strictEqual(r.spells.length, 2);
  assert.notStrictEqual(r.spells[0].id, r.spells[1].id);
  assert.ok(r.issues.some(i => i.level === 'warning'));
});
test('an exact repeat is ignored and reported', () => {
  const r = spellsFrom('Spell Name,Requirement,Rarity\nA,Fire 1,Common\nA,Fire 1,Common\n');
  assert.strictEqual(r.spells.length, 1);
  assert.ok(r.issues.some(i => /exact copy/.test(i.message)));
});
test('bad rows are reported with their row number', () => {
  const r = spellsFrom('Spell Name,Requirement,Rarity\n,Fire 1,Common\nB,Fire,Epic\n');
  assert.ok(r.issues.some(i => i.row === 2 && i.level === 'error'));
  assert.ok(r.issues.some(i => i.row === 3 && /Rarity/.test(i.message)));
  assert.ok(r.issues.some(i => i.row === 3 && /requirement/.test(i.message)));
});
test('your item list loads without problems', () => {
  const r = HH.catalog.normalizeItems(HH.csv.parseCSV(readData('items.csv')));
  const bad = r.issues.filter(i => i.level !== 'info');
  assert.strictEqual(bad.length, 0, bad.map(b => `row ${b.row}: ${b.message}`).join('\n'));
  assert.ok(r.items.length > 0);
});
test('items: slots make things equippable and "Yes" makes them consumable', () => {
  const r = HH.catalog.normalizeItems(HH.csv.parseCSV('Item Name,Type,Equip Slot,Consumable,Effect\nPotion,Potion,,Yes,Heals\nCloak,Clothing,Back,,\nRope,Gear,,,\n'));
  const [potion, cloak, rope] = r.items;
  assert.strictEqual(potion.consumable, true);
  assert.strictEqual(potion.equippable, false);
  assert.strictEqual(cloak.equippable, true);
  assert.strictEqual(cloak.slot, 'Back');
  assert.strictEqual(rope.equippable || rope.consumable, false);
  assert.ok(potion.extras.some(e => e.label === 'Effect'));
});

// ------------------------------------------------------------ filters
section('My spells filters');
const filterSpells = spellsFrom([
  'Spell Name,Requirement,Range,Cast Time,FP Cost,Duration,Rarity',
  'Spark,Fire 1,30 feet,Action,1,Instant,Common',
  'Shield,Earth 2,Self,Reaction,2,1 round,Common',
  'Mend,Water 2,Touch,Bonus action,2,Instant,Common',
  'Ward,Any 3,Self,Action,0,Concentration,Common',
  'Big Spark,Fire 4 / Air 3,100 feet,Action,5,Instant,Uncommon',
  'Circle,Spirit 5,Summoning Circle,1 minute,4 + 1 per mage,1 hour,Uncommon',
].join('\n')).spells;
const byName = n => filterSpells.find(s => s.name === n);
const ctx = (over) => Object.assign({ currentFP: 3, isReady: () => true, tagKeys: () => [] }, over);
const names = (f, c) => filterSpells.filter(s => HH.logic.matchesFilters(s, f, ctx(c))).map(s => s.name);
test('no filters keeps everything', () => {
  assert.strictEqual(names(HH.logic.emptyFilters()).length, filterSpells.length);
});
test('cast time filter, and choices in one group combine with OR', () => {
  const f = HH.logic.emptyFilters();
  f.cast.add('bonus');
  assert.deepStrictEqual(names(f), ['Mend']);
  f.cast.add('reaction');
  assert.deepStrictEqual(names(f), ['Shield', 'Mend']);
});
test('different groups combine with AND', () => {
  const f = HH.logic.emptyFilters();
  f.cast.add('action');
  f.fp.add('1');
  assert.deepStrictEqual(names(f), ['Spark']);
});
test('FP buckets: free, exact, 4 or more, and group costs', () => {
  const f = HH.logic.emptyFilters();
  f.fp.add('free');
  assert.deepStrictEqual(names(f), ['Ward']);
  const g = HH.logic.emptyFilters();
  g.fp.add('4+');
  assert.deepStrictEqual(names(g), ['Big Spark']);
  const h = HH.logic.emptyFilters();
  h.fp.add('varies');
  assert.deepStrictEqual(names(h), ['Circle']);
});
test('range, duration and element filters', () => {
  const r = HH.logic.emptyFilters(); r.range.add('self');
  assert.deepStrictEqual(names(r), ['Shield', 'Ward']);
  const d = HH.logic.emptyFilters(); d.dur.add('concentration');
  assert.deepStrictEqual(names(d), ['Ward']);
  const e = HH.logic.emptyFilters(); e.el.add('fire');
  assert.deepStrictEqual(names(e), ['Spark', 'Big Spark']);
});
test('"I can afford it now" compares against current FP', () => {
  const f = HH.logic.emptyFilters(); f.afford = true;
  assert.deepStrictEqual(names(f, { currentFP: 1 }), ['Spark', 'Ward']);
  assert.deepStrictEqual(names(f, { currentFP: 5 }), ['Spark', 'Shield', 'Mend', 'Ward', 'Big Spark', 'Circle']);
});
test('tag filter uses the tag names the app supplies', () => {
  const f = HH.logic.emptyFilters(); f.tag.add('healing');
  const tagKeys = s => (s.name === 'Mend' ? ['healing'] : []);
  assert.deepStrictEqual(names(f, { tagKeys }), ['Mend']);
});
test('"ready to cast only" uses the readiness the app supplies', () => {
  const f = HH.logic.emptyFilters(); f.ready = true;
  assert.deepStrictEqual(names(f, { isReady: s => s.name === 'Spark' }), ['Spark']);
});
test('active filter count', () => {
  const f = HH.logic.emptyFilters();
  assert.strictEqual(HH.logic.activeCount(f), 0);
  f.cast.add('action'); f.cast.add('bonus'); f.afford = true;
  assert.strictEqual(HH.logic.activeCount(f), 3);
});

// ------------------------------------------------- suggestions and combos
section('Close-to-qualifying spells and combos');
const sugCtx = character => ({
  spellsById: new Map(filterSpells.map(s => [s.id, s])),
  stateOf: s => {
    const ev = HH.requirements.evaluate(s.req, character);
    const needs = s.rarityKey !== 'common' || s.req.namedTerms.length > 0;
    const learned = (character.learned || []).includes(s.id);
    const inList = ev.met;
    return { inList, ready: inList && (!needs || learned) };
  },
  near: s => HH.requirements.shortfall(s.req, character),
});
test('near misses are within the limit, closest first, and exclude spells already available', () => {
  const c = Object.assign(char({ fire: 3, air: 3, earth: 2 }), { learned: [] });
  const list = HH.logic.nearMisses(filterSpells, sugCtx(c), 2);
  // Spark, Shield and Ward are already available; Circle (Spirit 5) is too far; Big Spark is 1 away; Mend is 2 away.
  assert.deepStrictEqual(list.map(x => [x.spell.name, x.shortfall.points]), [['Big Spark', 1], ['Mend', 2]]);
});
test('a bigger limit lets more spells in', () => {
  const c = Object.assign(char({ fire: 1 }), { learned: [] });
  const small = HH.logic.nearMisses(filterSpells, sugCtx(c), 1).map(x => x.spell.name);
  const large = HH.logic.nearMisses(filterSpells, sugCtx(c), 4).map(x => x.spell.name);
  assert.ok(large.length > small.length);
  assert.ok(large.indexOf('Mend') >= 0 || large.indexOf('Shield') >= 0);
});
const comboList = HH.catalog.normalizeCombos(HH.csv.parseCSV(
  'Combo Name,Spells,Description,Notes2\n' +
  'Ready Combo,Spark; Ward,Both are easy,x\n' +
  'Almost Combo,Spark + Big Spark,One short,\n' +
  'Far Combo,Spark | Circle,Out of reach,\n' +
  'Typo Combo,Spark; Sparrk; Ward,Has a typo,\n' +
  'Too Small,Spark,Only one,\n' +
  ',Spark; Ward,No name,\n'
), new Map(filterSpells.map(s => [s.id, s])));
test('combo list: names matched, three separators accepted, extra columns kept', () => {
  assert.deepStrictEqual(comboList.combos.map(c => c.name), ['Ready Combo', 'Almost Combo', 'Far Combo', 'Typo Combo']);
  assert.deepStrictEqual(comboList.combos[1].spellIds, ['spark', 'big-spark']);
  assert.ok(comboList.combos[0].extras.some(e => e.label === 'Notes2' && e.value === 'x'));
});
test('combo list: misspelled spell, single-spell combo and unnamed row are reported', () => {
  const msgs = comboList.issues.map(i => `${i.row}:${i.message}`);
  assert.ok(msgs.some(m => /^5:.*"Sparrk".*isn't in the spell list/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some(m => /^6:.*at least two spells/.test(m)));
  assert.ok(msgs.some(m => /^7:.*no combo name/.test(m)));
});
test('combo list: missing columns give a clear error', () => {
  const r = HH.catalog.normalizeCombos(HH.csv.parseCSV('Foo,Bar\n1,2\n'), new Map());
  assert.strictEqual(r.issues[0].level, 'error');
});
test('combo status: ready, close, and out of reach', () => {
  const c = Object.assign(char({ fire: 3, air: 3, earth: 2, spirit: 0 }), { learned: [] });
  const cx = sugCtx(c);
  const status = name => HH.logic.comboStatus(comboList.combos.find(x => x.name === name), cx, 2);
  const ready = status('Ready Combo');
  assert.strictEqual(ready.ready, true);
  assert.strictEqual(ready.fp, 1 + 0);
  const almost = status('Almost Combo');
  assert.strictEqual(almost.ready, false);
  assert.strictEqual(almost.soon, true);
  assert.deepStrictEqual(almost.parts.map(p => p.kind), ['ready', 'near']);
  assert.strictEqual(almost.points, 1);
  const far = status('Far Combo');
  assert.strictEqual(far.soon, false);
  assert.strictEqual(far.fpVaries, true);
});
test('combos sort: ready first, then closest', () => {
  const c = Object.assign(char({ fire: 3, air: 3, earth: 2 }), { learned: [] });
  const cx = sugCtx(c);
  const sorted = comboList.combos.map(x => HH.logic.comboStatus(x, cx, 2)).sort(HH.logic.compareCombos).map(s => s.combo.name);
  // "Typo Combo" loses its misspelled spell, so it is ready too and keeps its spreadsheet order.
  assert.deepStrictEqual(sorted.slice(0, 2), ['Ready Combo', 'Typo Combo']);
  assert.strictEqual(sorted[2], 'Almost Combo');
  assert.strictEqual(sorted[sorted.length - 1], 'Far Combo');
});
test('an unlearned spell you already qualify for counts as "learn" not "ready"', () => {
  const c = Object.assign(char({ fire: 5, air: 5 }), { learned: [] });
  const s = HH.logic.comboStatus(comboList.combos.find(x => x.name === 'Almost Combo'), sugCtx(c), 2);
  assert.deepStrictEqual(s.parts.map(p => p.kind), ['ready', 'learn']);
  assert.strictEqual(s.missing, 1);
});
test('your combos.csv (if you have one) matches your spell list', () => {
  if (!fs.existsSync(path.join(__dirname, 'combos.csv'))) return;
  const map = new Map(spellResult.spells.map(s => [s.id, s]));
  const r = HH.catalog.normalizeCombos(HH.csv.parseCSV(readData('combos.csv')), map);
  const bad = r.issues.filter(i => i.level !== 'info');
  assert.strictEqual(bad.length, 0, bad.map(b => `row ${b.row}: ${b.message}`).join('\n'));
});

// ---------------------------------------------------------------- dice
section('Dice');
test('rolls stay within range and totals add up with the modifier', () => {
  const r = HH.dice.roll({ 20: 1, 6: 3, 4: 2 }, 5, undefined, HH.config.DICE);
  assert.deepStrictEqual(r.groups.map(g => [g.sides, g.count]), [[20, 1], [6, 3], [4, 2]]);
  r.groups.forEach(g => g.rolls.forEach(x => assert.ok(x >= 1 && x <= g.sides)));
  const sum = r.groups.reduce((n, g) => n + g.rolls.reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(r.diceTotal, sum);
  assert.strictEqual(r.total, sum + 5);
  assert.strictEqual(r.notation, '1d20 + 3d6 + 2d4 + 5');
});
test('a fixed random source gives a predictable roll', () => {
  const seq = [0, 5, 3, 19];
  const rng = () => seq.shift();
  const r = HH.dice.roll({ 20: 1, 6: 2, 10: 1 }, 0, rng, HH.config.DICE);
  // order is d20, d10, d8, d6, d4: d20 -> 1, d10 -> 6, d6 -> 4 and 20 (rng value above range is the test's problem)
  assert.strictEqual(r.groups[0].rolls[0], 1);
  assert.strictEqual(r.groups[1].rolls[0], 6);
});
test('negative modifier is written with a minus sign; no modifier shows none', () => {
  assert.ok(/− 2$/.test(HH.dice.roll({ 8: 1 }, -2).notation));
  assert.strictEqual(HH.dice.roll({ 8: 1 }, 0).notation, '1d8');
});
test('a single d20 reports natural 20 and natural 1', () => {
  assert.strictEqual(HH.dice.roll({ 20: 1 }, 0, () => 19).nat, 'Natural 20');
  assert.strictEqual(HH.dice.roll({ 20: 1 }, 0, () => 0).nat, 'Natural 1');
  assert.strictEqual(HH.dice.roll({ 20: 1 }, 0, () => 9).nat, null);
  assert.strictEqual(HH.dice.roll({ 20: 2 }, 0, () => 19).nat, null);
});
test('choosing no dice rolls nothing', () => {
  assert.strictEqual(HH.dice.roll({ 20: 0, 6: 0 }, 3), null);
});
test('there is a cap on how many dice one roll can use', () => {
  const r = HH.dice.roll({ 20: 90, 6: 90 }, 0, () => 0, HH.config.DICE);
  assert.strictEqual(r.groups.reduce((n, g) => n + g.count, 0), HH.dice.MAX_TOTAL_DICE);
});
test('the real random source is fair (every face comes up about equally often)', () => {
  const tally = [0, 0, 0, 0];
  const rng = HH.dice.makeRng();
  for (let i = 0; i < 12000; i++) tally[rng(4)]++;
  tally.forEach(n => assert.ok(n > 2700 && n < 3300, `uneven: ${tally.join(', ')}`));
});

// ---------------------------------------------------------------- storage
section('Saving, backups and moving from the old app');
function memoryBackend(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}
test('a first visit creates one default character and saves it', () => {
  const be = memoryBackend();
  const store = HH.storage.createStore(be);
  store.load();
  assert.strictEqual(store.characters.length, 1);
  assert.ok(be.getItem('hhrpg2.data'));
});
test('new characters start with sensible health and blank spell numbers', () => {
  const c = HH.storage.newCharacter();
  assert.strictEqual(c.maxHP, 10);
  assert.strictEqual(c.currentHP, 10);
  assert.strictEqual(c.tempHP, 0);
  assert.strictEqual(c.saveDC, null);
  assert.strictEqual(c.attackMod, null);
  assert.strictEqual(c.damageMod, null);
});
test('changes survive a reload (including overrides, health, spell numbers and tags)', () => {
  const be = memoryBackend();
  let store = HH.storage.createStore(be);
  store.load();
  const c = store.active();
  c.name = 'Mira';
  c.elements.fire = 6;
  c.overrides.push('mage-light');
  c.learned.push('fashion-transformation');
  c.maxHP = 24; c.currentHP = 18; c.tempHP = 3;
  c.saveDC = 14; c.attackMod = 6; c.damageMod = -1;
  HH.storage.addTag(c, 'Damage', 'ruby');
  HH.storage.toggleSpellTag(c, 'mage-light', 'Damage');
  c.inventory.push({ uid: 'u1', itemId: null, name: 'Rope', qty: 2, equipped: false, custom: { type: '', description: '', slot: '', consumable: false } });
  store.save();
  store = HH.storage.createStore(be);
  store.load();
  const again = store.active();
  assert.strictEqual(again.name, 'Mira');
  assert.strictEqual(again.elements.fire, 6);
  assert.deepStrictEqual(again.overrides, ['mage-light']);
  assert.deepStrictEqual(again.learned, ['fashion-transformation']);
  assert.deepStrictEqual([again.maxHP, again.currentHP, again.tempHP], [24, 18, 3]);
  assert.deepStrictEqual([again.saveDC, again.attackMod, again.damageMod], [14, 6, -1]);
  assert.deepStrictEqual(again.tags, [{ name: 'Damage', color: 'ruby' }]);
  assert.deepStrictEqual(again.spellTags, { 'mage-light': ['Damage'] });
  assert.strictEqual(again.inventory[0].qty, 2);
});
test('favorite spells are saved, kept in backups and copied with a duplicate', () => {
  const be = memoryBackend();
  let store = HH.storage.createStore(be);
  store.load();
  store.active().favorites.push('mage-light', 'darkvision');
  store.save();
  store = HH.storage.createStore(be);
  store.load();
  assert.deepStrictEqual(store.active().favorites, ['mage-light', 'darkvision']);
  store.duplicateActive();
  assert.deepStrictEqual(store.active().favorites, ['mage-light', 'darkvision']);
  const other = HH.storage.createStore(memoryBackend());
  other.load();
  other.importJSON(store.exportJSON());
  assert.ok(other.characters.some(c => c.favorites.length === 2));
});
test('a character saved before health, tags or favorites existed still loads', () => {
  const c = HH.storage.sanitizeCharacter({ name: 'Old', level: 3 });
  assert.deepStrictEqual(c.favorites, []);
  assert.strictEqual(c.maxHP, 10);
  assert.strictEqual(c.saveDC, null);
  assert.deepStrictEqual(c.tags, []);
  assert.deepStrictEqual(c.spellTags, {});
});
test('health and spell numbers are kept in range; blanks stay blank', () => {
  const c = HH.storage.sanitizeCharacter({ maxHP: 5000, currentHP: 9999, tempHP: -4, saveDC: '', attackMod: 'x', damageMod: 500 });
  assert.strictEqual(c.maxHP, 999);
  assert.strictEqual(c.currentHP, 999);
  assert.strictEqual(c.tempHP, 0);
  assert.strictEqual(c.saveDC, null);
  assert.strictEqual(c.attackMod, null);
  assert.strictEqual(c.damageMod, 60);
  const d = HH.storage.sanitizeCharacter({ maxHP: 20, currentHP: 30 });
  assert.strictEqual(d.currentHP, 20);
});
test('tags: names are unique ignoring capitals, colors fall back to gray, blanks are dropped', () => {
  const c = HH.storage.newCharacter();
  const a = HH.storage.addTag(c, '  Damage ', 'ruby');
  const b = HH.storage.addTag(c, 'damage', 'sky');
  assert.strictEqual(a, b);
  assert.strictEqual(HH.storage.addTag(c, 'Heal', 'not-a-color').color, 'slate');
  assert.strictEqual(HH.storage.addTag(c, '   ', 'ruby'), null);
  assert.strictEqual(c.tags.length, 2);
  assert.strictEqual(HH.storage.addTag(c, 'x'.repeat(40), 'sky').name.length, 24);
});
test('tags: toggling on a spell, and deleting a tag removes it everywhere', () => {
  const c = HH.storage.newCharacter();
  HH.storage.addTag(c, 'Damage', 'ruby');
  HH.storage.addTag(c, 'Heal', 'lime');
  assert.strictEqual(HH.storage.toggleSpellTag(c, 'a', 'damage'), true);
  assert.strictEqual(HH.storage.toggleSpellTag(c, 'a', 'Heal'), true);
  assert.strictEqual(HH.storage.toggleSpellTag(c, 'b', 'Damage'), true);
  assert.deepStrictEqual(c.spellTags.a, ['Damage', 'Heal']);
  assert.strictEqual(HH.storage.toggleSpellTag(c, 'b', 'Damage'), false);
  assert.strictEqual('b' in c.spellTags, false);
  assert.strictEqual(HH.storage.toggleSpellTag(c, 'a', 'Nope'), false);
  HH.storage.deleteTag(c, 'DAMAGE');
  assert.deepStrictEqual(c.tags.map(t => t.name), ['Heal']);
  assert.deepStrictEqual(c.spellTags, { a: ['Heal'] });
});
test('saved spell tags that point at a tag that no longer exists are dropped', () => {
  const c = HH.storage.sanitizeCharacter({ tags: [{ name: 'Damage', color: 'ruby' }], spellTags: { a: ['damage', 'Gone'], b: ['Gone'] } });
  assert.deepStrictEqual(c.spellTags, { a: ['Damage'] });
});
test('a duplicate keeps its own copy of tags', () => {
  const store = HH.storage.createStore(memoryBackend());
  store.load();
  HH.storage.addTag(store.active(), 'Damage', 'ruby');
  const original = store.active();
  store.duplicateActive();
  HH.storage.addTag(store.active(), 'Heal', 'lime');
  assert.strictEqual(original.tags.length, 1);
  assert.strictEqual(store.active().tags.length, 2);
});
test('multiple characters: add, switch, duplicate, delete', () => {
  const store = HH.storage.createStore(memoryBackend());
  store.load();
  const first = store.active().id;
  store.addCharacter({ name: 'Second' });
  assert.strictEqual(store.characters.length, 2);
  store.setActive(first);
  store.duplicateActive();
  assert.strictEqual(store.characters.length, 3);
  assert.ok(/\(copy\)/.test(store.active().name));
  store.deleteActive();
  assert.strictEqual(store.characters.length, 2);
});
test('deleting the only character leaves a fresh one', () => {
  const store = HH.storage.createStore(memoryBackend());
  store.load();
  store.deleteActive();
  assert.strictEqual(store.characters.length, 1);
});
test('export then import adds characters without replacing any', () => {
  const store = HH.storage.createStore(memoryBackend());
  store.load();
  store.active().name = 'Original';
  const backup = store.exportJSON();
  const other = HH.storage.createStore(memoryBackend());
  other.load();
  const res = other.importJSON(backup);
  assert.strictEqual(res.added, 1);
  assert.strictEqual(other.characters.length, 2);
  assert.ok(other.characters.some(c => c.name === 'Original'));
  assert.notStrictEqual(other.characters[0].id, other.characters[1].id);
});
test('importing a wrong or broken file gives a readable error', () => {
  const store = HH.storage.createStore(memoryBackend());
  store.load();
  assert.throws(() => store.importJSON('not json'), /valid backup/);
  assert.throws(() => store.importJSON('{"hello":1}'), /doesn't look like a backup/);
});
test('out-of-range or junk saved values are repaired', () => {
  const c = HH.storage.sanitizeCharacter({ name: 'X', level: 99, maxFP: 'abc', elements: { fire: -4, air: '7' }, stats: { str: 100 }, currentFP: 500 });
  assert.strictEqual(c.level, 20);
  assert.strictEqual(c.maxFP, 10);
  assert.strictEqual(c.elements.fire, 0);
  assert.strictEqual(c.elements.air, 7);
  assert.strictEqual(c.stats.str, 20);
  assert.strictEqual(c.currentFP, 10);
});
test('the old app\'s saved character is copied over, and left untouched', () => {
  const be = memoryBackend({
    characterCreatorData: JSON.stringify({ name: 'Old Hero', level: '5', fp: '14', hall: 'Arcanium', fire: '4', air: '', spirit: '2', earth: '', water: '3', str: '', dex: '12', con: '11', int: '', wis: '13', cha: '' }),
    learnedRaritySpells: JSON.stringify(['Fashion Transformation (uncommon)', 'Mage Light']),
    currentFPState: '9',
    characterInventory: JSON.stringify([{ id: 'a', name: 'Potion', amount: 3, description: 'Red' }]),
  });
  const before = JSON.stringify(be.dump());
  const store = HH.storage.createStore(be);
  const info = store.load();
  assert.strictEqual(info.migratedFromOld, true);
  const c = store.active();
  assert.strictEqual(c.name, 'Old Hero');
  assert.strictEqual(c.level, 5);
  assert.strictEqual(c.maxFP, 14);
  assert.strictEqual(c.currentFP, 9);
  assert.strictEqual(c.hall, 'Arcanium');
  assert.strictEqual(c.elements.fire, 4);
  assert.strictEqual(c.stats.dex, 12);
  assert.strictEqual(c.stats.str, 8);
  assert.deepStrictEqual(c.learned, ['fashion-transformation', 'mage-light']);
  assert.strictEqual(c.inventory[0].name, 'Potion');
  assert.strictEqual(c.inventory[0].qty, 3);
  assert.strictEqual(c.inventory[0].custom.consumable, true);
  assert.strictEqual(c.maxHP, 10);
  assert.strictEqual(c.saveDC, null);
  const after = be.dump();
  Object.keys(JSON.parse(before)).forEach(k => assert.strictEqual(after[k], JSON.parse(before)[k], `old key ${k} was changed`));
});
test('unreadable saved data is kept as a backup instead of being overwritten', () => {
  const be = memoryBackend({ 'hhrpg2.data': '{broken' });
  const store = HH.storage.createStore(be);
  store.load();
  assert.strictEqual(be.getItem('hhrpg2.data.unreadable-backup'), '{broken');
});
test('storage that refuses to save is detected', () => {
  const be = { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem() {} };
  const store = HH.storage.createStore(be);
  store.load();
  assert.strictEqual(store.isWritable(), false);
});

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
