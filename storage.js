/*
 * Saving and loading characters (in this browser), backups, and a one-time copy
 * of the old app's character if it is found on the same web address.
 *
 * The old app's saved data is only ever READ. It is never changed or deleted.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const HH = (root.HH = root.HH || {});

  const KEYS = {
    data: 'hhrpg2.data',
    corrupt: 'hhrpg2.data.unreadable-backup',
    ui: 'hhrpg2.ui',
    cache: { spells: 'hhrpg2.cache.spells', items: 'hhrpg2.cache.items' },
  };
  const OLD_KEYS = {
    character: 'characterCreatorData',
    learned: 'learnedRaritySpells',
    fp: 'currentFPState',
    items: 'characterInventory',
  };

  const cfg = () => HH.config;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
  const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
  function int(v, fallback) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  const strList = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && x))] : []);

  function newCharacter(partial) {
    const R = cfg().RANGES;
    const elements = {};
    cfg().ELEMENTS.forEach(k => { elements[k] = R.element[0]; });
    const stats = {};
    cfg().CORE_STATS.forEach(k => { stats[k] = R.core[0]; });
    return Object.assign({
      id: uid(),
      name: 'New Character',
      level: R.level[0],
      maxFP: R.fp[0],
      currentFP: R.fp[0],
      hall: '',
      elements,
      stats,
      learned: [],
      overrides: [],
      favorites: [],
      maxHP: cfg().NUMBER_FIELDS.maxHP.start,
      currentHP: cfg().NUMBER_FIELDS.maxHP.start,
      tempHP: 0,
      saveDC: null,
      attackMod: null,
      damageMod: null,
      tags: [],
      spellTags: {},
      inventory: [],
    }, partial || {});
  }

  // ---- tags (a tag is a name and a color; spells are linked to tags by name)
  const tagKey = n => String(n).trim().toLowerCase();

  function addTag(c, name, color) {
    const clean = str(name).trim().slice(0, 24);
    if (!clean) return null;
    const existing = c.tags.find(t => tagKey(t.name) === tagKey(clean));
    if (existing) return existing;
    const tag = { name: clean, color: cfg().TAG_COLORS.some(x => x.key === color) ? color : 'slate' };
    c.tags.push(tag);
    return tag;
  }
  function deleteTag(c, name) {
    const k = tagKey(name);
    c.tags = c.tags.filter(t => tagKey(t.name) !== k);
    Object.keys(c.spellTags).forEach(id => {
      c.spellTags[id] = c.spellTags[id].filter(n => tagKey(n) !== k);
      if (!c.spellTags[id].length) delete c.spellTags[id];
    });
  }
  // Returns true if the spell now has the tag, false if the tag was taken off.
  function toggleSpellTag(c, spellId, name) {
    const tag = c.tags.find(t => tagKey(t.name) === tagKey(name));
    if (!tag) return false;
    const list = c.spellTags[spellId] || (c.spellTags[spellId] = []);
    const i = list.findIndex(n => tagKey(n) === tagKey(name));
    if (i >= 0) {
      list.splice(i, 1);
      if (!list.length) delete c.spellTags[spellId];
      return false;
    }
    list.push(tag.name);
    return true;
  }

  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const itemId = raw.itemId ? str(raw.itemId) : null;
    const name = str(raw.name).trim() || itemId || '';
    if (!name) return null;
    const entry = {
      uid: str(raw.uid) || uid(),
      itemId,
      name,
      qty: clamp(int(raw.qty, 1), [1, 999]),
      equipped: !!raw.equipped,
      custom: null,
    };
    if (!itemId) {
      const c = raw.custom && typeof raw.custom === 'object' ? raw.custom : {};
      entry.custom = {
        type: str(c.type),
        description: str(c.description),
        slot: str(c.slot),
        consumable: !!c.consumable,
      };
    }
    return entry;
  }

  // Makes any character-shaped object safe to use (used for saved data and imports).
  function sanitizeCharacter(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const R = cfg().RANGES;
    const c = newCharacter();
    c.id = str(raw.id) || c.id;
    c.name = str(raw.name).trim().slice(0, 60) || 'Unnamed';
    c.level = clamp(int(raw.level, c.level), R.level);
    c.maxFP = clamp(int(raw.maxFP, c.maxFP), R.fp);
    c.currentFP = clamp(int(raw.currentFP, c.maxFP), [0, c.maxFP]);
    c.hall = str(raw.hall);
    const el = raw.elements && typeof raw.elements === 'object' ? raw.elements : {};
    cfg().ELEMENTS.forEach(k => { c.elements[k] = clamp(int(el[k], c.elements[k]), R.element); });
    const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
    cfg().CORE_STATS.forEach(k => { c.stats[k] = clamp(int(st[k], c.stats[k]), R.core); });
    c.learned = strList(raw.learned);
    c.overrides = strList(raw.overrides);
    c.favorites = strList(raw.favorites);
    c.maxHP = clamp(int(raw.maxHP, c.maxHP), R.hp);
    c.currentHP = clamp(int(raw.currentHP, c.maxHP), [0, c.maxHP]);
    c.tempHP = clamp(int(raw.tempHP, 0), R.temp);
    ['saveDC', 'attackMod', 'damageMod'].forEach(k => {
      const n = parseInt(raw[k], 10);
      c[k] = Number.isFinite(n) ? clamp(n, R[k]) : null;
    });
    const colors = cfg().TAG_COLORS.map(x => x.key);
    const seenTags = new Set();
    c.tags = (Array.isArray(raw.tags) ? raw.tags : [])
      .map(t => ({ name: str(t && t.name).trim().slice(0, 24), color: colors.includes(t && t.color) ? t.color : 'slate' }))
      .filter(t => t.name && !seenTags.has(tagKey(t.name)) && seenTags.add(tagKey(t.name)));
    c.spellTags = {};
    if (raw.spellTags && typeof raw.spellTags === 'object') {
      Object.keys(raw.spellTags).forEach(id => {
        const names = [...new Set(strList(raw.spellTags[id])
          .map(n => (c.tags.find(t => tagKey(t.name) === tagKey(n)) || {}).name)
          .filter(Boolean))];
        if (names.length) c.spellTags[id] = names;
      });
    }
    c.inventory = (Array.isArray(raw.inventory) ? raw.inventory : []).map(sanitizeEntry).filter(Boolean);
    return c;
  }

  // Reads (never writes) the old app's saved character, if there is one.
  function readOldApp(backend) {
    const read = key => { try { return backend.getItem(key); } catch (e) { return null; } };
    const json = key => { try { return JSON.parse(read(key)); } catch (e) { return null; } };
    const old = json(OLD_KEYS.character);
    const learned = json(OLD_KEYS.learned);
    const items = json(OLD_KEYS.items);
    const hasOld = (old && typeof old === 'object') || (Array.isArray(learned) && learned.length) || (Array.isArray(items) && items.length);
    if (!hasOld) return null;

    const o = old && typeof old === 'object' ? old : {};
    const R = cfg().RANGES;
    const c = newCharacter({ name: str(o.name).trim() || 'My Character', hall: str(o.hall) });
    c.level = clamp(int(o.level, c.level), R.level);
    c.maxFP = clamp(int(o.fp, c.maxFP), R.fp);
    c.currentFP = clamp(int(read(OLD_KEYS.fp), c.maxFP), [0, c.maxFP]);
    cfg().ELEMENTS.forEach(k => { c.elements[k] = clamp(int(o[k], c.elements[k]), R.element); });
    cfg().CORE_STATS.forEach(k => { c.stats[k] = clamp(int(o[k], c.stats[k]), R.core); });
    c.learned = Array.isArray(learned)
      ? [...new Set(learned.filter(n => typeof n === 'string').map(n => HH.catalog.makeId(n)).filter(Boolean))]
      : [];
    c.inventory = (Array.isArray(items) ? items : [])
      .filter(i => i && typeof i.name === 'string')
      .map(i => sanitizeEntry({
        name: i.name,
        qty: i.amount,
        custom: { type: '', description: str(i.description), slot: '', consumable: true },
      }))
      .filter(Boolean);
    return c;
  }

  function createStore(backend) {
    let data = { activeId: null, characters: [] };
    let writable = true;
    const memoryOnly = !!backend.memoryOnly;

    const get = key => { try { return backend.getItem(key); } catch (e) { writable = false; return null; } };
    const set = (key, value) => { try { backend.setItem(key, value); return true; } catch (e) { writable = false; return false; } };

    function save() {
      set(KEYS.data, JSON.stringify({ version: 2, activeId: data.activeId, characters: data.characters }));
    }

    function load() {
      let migratedFromOld = false;
      const raw = get(KEYS.data);
      let parsed = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { set(KEYS.corrupt, raw); }
      }
      if (parsed && Array.isArray(parsed.characters)) {
        data.characters = parsed.characters.map(sanitizeCharacter).filter(Boolean);
        data.activeId = parsed.activeId;
      }
      if (!data.characters.length) {
        const old = readOldApp(backend);
        if (old) { data.characters = [old]; migratedFromOld = true; }
        else data.characters = [newCharacter({ name: 'My Character' })];
      }
      if (!data.characters.some(c => c.id === data.activeId)) data.activeId = data.characters[0].id;
      save();
      return { migratedFromOld };
    }

    function exportJSON() {
      return JSON.stringify({
        app: 'hhrpg-spell-tracker',
        version: 2,
        exportedAt: new Date().toISOString(),
        characters: data.characters,
      }, null, 2);
    }

    // Adds the characters from a backup file. Never replaces or removes existing ones.
    function importJSON(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { throw new Error("That file isn't a valid backup (it couldn't be read)."); }
      const list = parsed && Array.isArray(parsed.characters) ? parsed.characters : null;
      if (!list) throw new Error("That file doesn't look like a backup from this app.");
      let added = 0;
      list.forEach(raw => {
        const c = sanitizeCharacter(raw);
        if (!c) return;
        if (data.characters.some(x => x.id === c.id)) c.id = uid();
        data.characters.push(c);
        added++;
      });
      if (!added) throw new Error('That backup has no characters in it.');
      save();
      return { added };
    }

    return {
      load,
      save,
      exportJSON,
      importJSON,
      get characters() { return data.characters; },
      get activeId() { return data.activeId; },
      active() { return data.characters.find(c => c.id === data.activeId) || data.characters[0]; },
      setActive(id) { if (data.characters.some(c => c.id === id)) { data.activeId = id; save(); } },
      addCharacter(partial) {
        const c = newCharacter(partial);
        data.characters.push(c);
        data.activeId = c.id;
        save();
        return c;
      },
      duplicateActive() {
        const copy = sanitizeCharacter(JSON.parse(JSON.stringify(this.active())));
        copy.id = uid();
        copy.name = `${copy.name} (copy)`.slice(0, 60);
        copy.inventory.forEach(e => { e.uid = uid(); });
        data.characters.push(copy);
        data.activeId = copy.id;
        save();
        return copy;
      },
      deleteActive() {
        data.characters = data.characters.filter(c => c.id !== data.activeId);
        if (!data.characters.length) data.characters.push(newCharacter({ name: 'My Character' }));
        data.activeId = data.characters[0].id;
        save();
      },
      getUI() {
        try { return JSON.parse(get(KEYS.ui)) || {}; } catch (e) { return {}; }
      },
      setUI(patch) {
        set(KEYS.ui, JSON.stringify(Object.assign(this.getUI(), patch)));
      },
      getCache(kind) {
        try { return JSON.parse(get(KEYS.cache[kind])); } catch (e) { return null; }
      },
      setCache(kind, text) {
        set(KEYS.cache[kind], JSON.stringify({ text, savedAt: new Date().toISOString() }));
      },
      isWritable() { return writable && !memoryOnly; },
    };
  }

  // localStorage if the browser allows it, otherwise a temporary in-memory stand-in.
  function browserBackend() {
    try {
      const probe = '__hhrpg_probe__';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return root.localStorage;
    } catch (e) {
      const mem = new Map();
      return {
        memoryOnly: true,
        getItem: k => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { mem.set(k, String(v)); },
        removeItem: k => { mem.delete(k); },
      };
    }
  }

  HH.storage = {
    createStore, browserBackend, newCharacter, sanitizeCharacter, readOldApp, uid, KEYS, OLD_KEYS,
    addTag, deleteTag, toggleSpellTag, tagKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = HH.storage;
})();
