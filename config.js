/*
 * Game rules and app settings live here, so they can be changed in one place.
 * Nothing in this file touches saved characters.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  HH.config = {
    APP_VERSION: '2.0.0',

    // Where the spell and item lists are loaded from. Use a file in the data/ folder,
    // or a full web address (for example a Google Sheet "published to the web" as CSV;
    // see README.md).
    DATA: {
      spells: 'data/spells.csv',
      items: 'data/items.csv',
    },

    // Choices in the Hall / Affiliation dropdown. (Informational only for now.)
    HALLS: [
      'Arcanium', 'Assassins', 'Animalians', 'Coterie', 'Alchemists',
      'Stone Singers', 'Oestomancers', 'Metallum Nocturn', 'Aura Healers', 'Protectors',
    ],

    ELEMENTS: ['fire', 'air', 'spirit', 'earth', 'water'],
    CORE_STATS: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
    STAT_NAMES: {
      fire: 'Fire', air: 'Air', spirit: 'Spirit', earth: 'Earth', water: 'Water',
      str: 'Strength', dex: 'Dexterity', con: 'Constitution',
      int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
    },

    // [lowest, highest] value for each control on the Character tab.
    RANGES: {
      level: [1, 20],
      fp: [10, 30],
      element: [0, 10],
      core: [8, 20],
    },

    // Spells with one of these rarities (or a Hall / special requirement) have to be
    // "learned" before they count as ready to cast.
    LEARN_RARITIES: ['uncommon', 'rare'],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HH.config;
})();
