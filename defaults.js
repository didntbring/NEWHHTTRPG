/*
 * Settings for newer features. They are filled in here so that an older config.js
 * (one you've already edited, for example your own Hall list) keeps working
 * without being replaced. Anything you set in config.js wins over these.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});
  const C = HH.config;

  C.APP_VERSION = '2.1.0';

  C.DATA = Object.assign({ combos: 'combos.csv' }, C.DATA);

  // [lowest, highest]. The three spell numbers can be left blank on a character.
  C.RANGES = Object.assign({
    hp: [1, 999],
    temp: [0, 999],
    saveDC: [0, 40],
    attackMod: [-20, 40],
    damageMod: [-20, 60],
    ac: [0, 60], speed: [0, 200], bonus: [-20, 40], prof: [0, 20],
  }, C.RANGES);

  // The number fields on the Character tab (besides elements and core attributes).
  C.NUMBER_FIELDS = C.NUMBER_FIELDS || {
    maxHP: { label: 'Max hit points', range: 'hp', start: 10, signed: false, nullable: false, group: 'health' },
    saveDC: { label: 'Spell Save DC', range: 'saveDC', start: 10, signed: false, nullable: true, group: 'numbers' },
    attackMod: { label: 'Spell Attack Modifier', range: 'attackMod', start: 0, signed: true, nullable: true, group: 'numbers' },
    damageMod: { label: 'Single Target Spell Damage Modifier', range: 'damageMod', start: 0, signed: true, nullable: true, group: 'numbers' },
    ac: { label: 'Armor class', range: 'ac', start: 10, signed: false, nullable: true, group: 'sheet' },
    speed: { label: 'Speed (feet)', range: 'speed', start: 30, signed: false, nullable: true, group: 'sheet' },
    initBonus: { label: 'Initiative bonus (on top of DEX)', range: 'bonus', start: 0, signed: true, nullable: false, group: 'sheet' },
    profOverride: { label: 'Proficiency bonus override', range: 'prof', start: 2, signed: false, nullable: true, group: 'sheet' },
  };

  C.DICE = C.DICE || [20, 10, 8, 6, 4];
  C.DICE_MAX_PER_TYPE = C.DICE_MAX_PER_TYPE || 20;

  // Colors a tag can have. The name is shown too, so color is never the only signal.
  C.TAG_COLORS = C.TAG_COLORS || [
    { key: 'ruby', name: 'Red' },
    { key: 'amber', name: 'Orange' },
    { key: 'gold', name: 'Yellow' },
    { key: 'lime', name: 'Green' },
    { key: 'teal', name: 'Teal' },
    { key: 'sky', name: 'Blue' },
    { key: 'violet', name: 'Purple' },
    { key: 'rose', name: 'Pink' },
    { key: 'slate', name: 'Gray' },
  ];

  // "Close" in All spells means this many points away from qualifying, at most.
  C.NEAR_CHOICES = C.NEAR_CHOICES || [1, 2, 3, 4];
  C.NEAR_DEFAULT = C.NEAR_DEFAULT || 2;


  // ---- Equip slots: one item per slot. Edit this list to change the slots. ----
  C.EQUIP_SLOTS = C.EQUIP_SLOTS || ['Head', 'Face', 'Chest', 'Arms', 'Ring1', 'Ring2', 'Legs', 'Feet', 'Hands', 'Weapon1', 'Weapon2'];
  // What an item's "Equip Slot" text means. Lowercase, letters and spaces only.
  // A list means "any one of these". Unknown text becomes a slot of its own.
  C.SLOT_RULES = C.SLOT_RULES || {
    head: ['Head'], face: ['Face'], neck: ['Face'], 'neck face': ['Face'],
    chest: ['Chest'], arm: ['Arms'], arms: ['Arms'], leg: ['Legs'], legs: ['Legs'],
    feet: ['Feet'], foot: ['Feet'], hand: ['Hands'], hands: ['Hands'],
    ring: ['Ring1', 'Ring2'], weapon: ['Weapon1', 'Weapon2'],
  };
  // An item that takes several slots at once.
  C.SLOT_MULTI = C.SLOT_MULTI || { 'arms chest': ['Arms', 'Chest'], 'arm chest': ['Arms', 'Chest'], 'chest arms': ['Arms', 'Chest'] };
  // Items that can go in any slot, tried in this order first.
  C.SLOT_ANY = C.SLOT_ANY || { words: ['any', 'anything', 'occasional'], prefer: ['Weapon1', 'Weapon2'] };

  // ---- Character sheet ----
  C.SKILLS = C.SKILLS || [
    { key: 'acrobatics', label: 'Acrobatics', stat: 'dex' },
    { key: 'animal', label: 'Animal Handling', stat: 'wis' },
    { key: 'arcana', label: 'Arcana', stat: 'int' },
    { key: 'athletics', label: 'Athletics', stat: 'str' },
    { key: 'deception', label: 'Deception', stat: 'cha' },
    { key: 'history', label: 'History', stat: 'int' },
    { key: 'insight', label: 'Insight', stat: 'wis' },
    { key: 'intimidation', label: 'Intimidation', stat: 'cha' },
    { key: 'investigation', label: 'Investigation', stat: 'int' },
    { key: 'medicine', label: 'Medicine', stat: 'wis' },
    { key: 'nature', label: 'Nature', stat: 'int' },
    { key: 'perception', label: 'Perception', stat: 'wis' },
    { key: 'performance', label: 'Performance', stat: 'cha' },
    { key: 'persuasion', label: 'Persuasion', stat: 'cha' },
    { key: 'occult', label: 'Occult', stat: 'int' },
    { key: 'sleight', label: 'Sleight of Hand', stat: 'dex' },
    { key: 'stealth', label: 'Stealth', stat: 'dex' },
    { key: 'survival', label: 'Survival', stat: 'wis' },
  ];
  // Proficiency bonus = base + one for every N levels after the first (+2 at 1-4, +3 at 5-8, and so on).
  C.PROFICIENCY = C.PROFICIENCY || { base: 2, every: 4 };
  C.SHEET_TEXT_MAX = C.SHEET_TEXT_MAX || 4000;
  C.COMBAT_ROWS_MAX = C.COMBAT_ROWS_MAX || 30;

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})();
