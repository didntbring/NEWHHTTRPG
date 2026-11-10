/*
 * Checks for the app's logic. Run from the project folder with:   node tests/run.js
 * (needs Node 18 or newer; no installs required).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.HH = {};
['config', 'csv', 'requirements', 'catalog', 'storage'].forEach(f => require(`../js/${f}.js`));
const HH = globalThis.HH;
const readData = f => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n         ${e.message.split('\n').join('\n         ')}`); }
}
function section(title) { console.log(`\n${title}`); }

const halls = HH.config.HALLS;
const parse = text => HH.requirements.parse(text, { halls });
const char = (elements = {}, stats = {}) => ({
  elements: Object.assign({ fire: 0, air: 0, spirit: 0, earth: 0, water: 0 }, elements),
  stats: Object.assign({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, stats),
});
const meets = (text, c) => HH.requirements.evaluate(parse(text), c).met;

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

// ----------------------------------------------------------- real spells
section('Your spell list (data/spells.csv)');
const spellResult = HH.catalog.normalizeSpells(HH.csv.parseCSV(readData('spells.csv')), { halls });
test('loads every spell row', () => {
  assert.ok(spellResult.spells.length >= 270, `only ${spellResult.spells.length} spells loaded`);
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
  assert.ok(spellResult.spells.find(s => s.id === 'fashion-transformation'));
});
test('the repeated "Final Strike" row is ignored and reported', () => {
  assert.strictEqual(spellResult.spells.filter(s => s.id === 'final-strike').length, 1);
  assert.ok(spellResult.issues.some(i => /Final Strike.*exact copy/.test(i.message)));
});
test('previously unreadable requirements now work (e.g. "Fire 4, Dex 12")', () => {
  const spell = spellResult.spells.find(s => s.id === 'fashion-transformation');
  assert.strictEqual(HH.requirements.evaluate(spell.req, char({ fire: 4 }, { dex: 12 })).met, true);
  assert.strictEqual(HH.requirements.evaluate(spell.req, char({ fire: 4 }, { dex: 11 })).met, false);
});
test('escalation text inside a description is split out for display', () => {
  const spell = spellResult.spells.find(s => s.id === 'distant-voices');
  assert.ok(spell.escalation.startsWith('Add an additional year'));
  assert.ok(!/Escalation:/.test(spell.description));
});
test('every spell with a Hall/special requirement is Uncommon or Rare (so Learn applies)', () => {
  const odd = spellResult.spells.filter(s => s.req.namedTerms.length && s.rarityKey === 'common');
  assert.strictEqual(odd.length, 0, odd.map(s => s.name).join(', '));
});

// ------------------------------------------------------- catalog details
section('Spell and item list handling');
test('column headings are matched loosely and extra columns are kept', () => {
  const csv = HH.csv.parseCSV('spell NAME,REQUIREMENT,fp cost,Rarity,Description,School\nZap,Fire 1,1,Common,Hi,Evocation\n');
  const r = HH.catalog.normalizeSpells(csv, { halls });
  assert.strictEqual(r.spells[0].name, 'Zap');
  assert.deepStrictEqual(r.spells[0].extras, [{ label: 'School', value: 'Evocation' }]);
});
test('an ID column keeps saved checkmarks when a spell is renamed', () => {
  const csv = HH.csv.parseCSV('Spell Name,ID,Requirement,Rarity\nBrand New Name,Old Name,Fire 1,Uncommon\n');
  const r = HH.catalog.normalizeSpells(csv, { halls });
  assert.strictEqual(r.spells[0].id, HH.catalog.makeId('Old Name'));
});
test('same name with different details keeps both and warns', () => {
  const csv = HH.csv.parseCSV('Spell Name,Requirement,Rarity\nA,Fire 1,Common\nA,Fire 2,Common\n');
  const r = HH.catalog.normalizeSpells(csv, { halls });
  assert.strictEqual(r.spells.length, 2);
  assert.notStrictEqual(r.spells[0].id, r.spells[1].id);
  assert.ok(r.issues.some(i => i.level === 'warning'));
});
test('bad rows are reported with their row number', () => {
  const csv = HH.csv.parseCSV('Spell Name,Requirement,Rarity\n,Fire 1,Common\nB,Fire,Epic\n');
  const r = HH.catalog.normalizeSpells(csv, { halls });
  assert.ok(r.issues.some(i => i.row === 2 && i.level === 'error'));
  assert.ok(r.issues.some(i => i.row === 3 && /Rarity/.test(i.message)));
  assert.ok(r.issues.some(i => i.row === 3 && /requirement/.test(i.message)));
});
test('sample item list loads: slots, consumables, extra columns', () => {
  const r = HH.catalog.normalizeItems(HH.csv.parseCSV(readData('items.csv')));
  assert.strictEqual(r.items.length, 5);
  const potion = r.items.find(i => /Healing Potion/.test(i.name));
  assert.strictEqual(potion.consumable, true);
  assert.strictEqual(potion.equippable, false);
  const cloak = r.items.find(i => /Cloak/.test(i.name));
  assert.strictEqual(cloak.equippable, true);
  assert.strictEqual(cloak.slot, 'Back');
  assert.ok(r.items[0].extras.some(e => e.label === 'Effect'));
  assert.strictEqual(r.issues.filter(i => i.level !== 'info').length, 0);
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
test('changes survive a reload (including spell overrides, which the old app lost)', () => {
  const be = memoryBackend();
  let store = HH.storage.createStore(be);
  store.load();
  const c = store.active();
  c.name = 'Mira';
  c.elements.fire = 6;
  c.overrides.push('mage-light');
  c.learned.push('fashion-transformation');
  c.inventory.push({ uid: 'u1', itemId: null, name: 'Rope', qty: 2, equipped: false, custom: { type: '', description: '', slot: '', consumable: false } });
  store.save();
  store = HH.storage.createStore(be);
  store.load();
  const again = store.active();
  assert.strictEqual(again.name, 'Mira');
  assert.strictEqual(again.elements.fire, 6);
  assert.deepStrictEqual(again.overrides, ['mage-light']);
  assert.deepStrictEqual(again.learned, ['fashion-transformation']);
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
test('a character saved before favorites existed loads with an empty favorites list', () => {
  const c = HH.storage.sanitizeCharacter({ name: 'Old', level: 3 });
  assert.deepStrictEqual(c.favorites, []);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
