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
  }, C.RANGES);

  // The number fields on the Character tab (besides elements and core attributes).
  C.NUMBER_FIELDS = C.NUMBER_FIELDS || {
    maxHP: { label: 'Max hit points', range: 'hp', start: 10, signed: false, nullable: false, group: 'health' },
    saveDC: { label: 'Spell Save DC', range: 'saveDC', start: 10, signed: false, nullable: true, group: 'numbers' },
    attackMod: { label: 'Spell Attack Modifier', range: 'attackMod', start: 0, signed: true, nullable: true, group: 'numbers' },
    damageMod: { label: 'Single Target Spell Damage Modifier', range: 'damageMod', start: 0, signed: true, nullable: true, group: 'numbers' },
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

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})();
