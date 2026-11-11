# Spell Finder (version 2.1)

A plain website: no build step, no server. Upload the files to GitHub Pages, all in one folder (no subfolders).

## What each file does
- `index.html`, `style.css`, `app.js`: the screens.
- `catalog.js`, `csv.js`, `requirements.js`, `logic.js`, `dice.js`, `storage.js`: the rules (all tested by `node run.js`).
- `defaults.js`: extra settings (dice list, tag colors, ranges). Change settings in `config.js` and it wins over `defaults.js`.
- `spells.csv`, `items.csv`, `combos.csv`: YOUR data. Edit these to change content.
- `config.js`: your settings. Do not overwrite it when updating.

## Updating the app
Upload new copies of the code files. Do NOT overwrite `spells.csv`, `items.csv`, `config.js` unless you mean to.

## Spell list columns
Spell Name, Requirement, Range, Cast Time, FP Cost, Duration, Description, Rarity. Optional: Tags (separate with `;`), ID. Any other column shows up on the card automatically.

## Combos (`combos.csv`)
Columns: `Combo Name`, `Spells`, `Description`. Separate spells with semicolons and use exact spell names. The app shows which spells in a combo you can use now, which you still need to learn, and how many points away the rest are.

## Tags
Per character: tag a spell from its card on My spells, then filter or group by tag. Colors are set under More.
