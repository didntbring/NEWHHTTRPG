# Character Creator & Spell Finder (version 2)

A phone-friendly tracker for your character, spells, focus points and items.
It is plain HTML, CSS and JavaScript. There is no server, no account and nothing to install.

Your **spell list** and **item list** live in two CSV files in the `data/` folder.
Your **characters** are saved in each player's own browser.

## What's in this folder

| File or folder | What it is |
| --- | --- |
| `index.html`, `style.css` | The page and its look |
| `js/app.js` | The screens and buttons |
| `js/requirements.js` | The one place that understands requirement text such as "Air 4 / Spirit 3" |
| `js/catalog.js` | Reads the spell and item CSVs and finds mistakes in them |
| `js/storage.js` | Saving characters, backups, and copying from the old app |
| `js/config.js` | Settings you might change: Hall names, stat ranges, where the CSVs are |
| `data/spells.csv` | Your spells (a copy of your current list, unchanged) |
| `data/items.csv` | Items, potions and equipment. **The current file is a five-line example.** Replace it with yours. |
| `tests/run.js` | Automatic checks of the rules (see the end) |

## Putting it online (free)

The simplest option is GitHub Pages:

1. On GitHub, make a **new repository** (for example `hhrpg-tracker`). Leave the old one alone.
2. Click **Add file, Upload files**, and drag in everything from this folder, including the `data`, `js` and `tests` folders. Commit.
3. Open **Settings, Pages**. Under "Build and deployment" choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After about a minute, the page shows your address, something like `https://yourname.github.io/hhrpg-tracker/`.

Opening `index.html` by double-clicking will not work. Browsers refuse to load the CSV files that way, so the app has to be opened from a web address.

**About your old characters:** browsers keep saved data per web *site*, not per page. If the new app is on the same `yourname.github.io` as the old one, it finds your old character the first time you open it and copies it over. The old app is never changed. On any other address, the old app has no way to hand its character over, so you would re-enter it (about a minute). Once you're on the new app, use More, **Save backup file** to keep a copy.

## Favorite spells

On **My spells**, tap **Add favorite** on any spell. Favorites move to a gold-outlined **Favorites** section at the top of the list, and tap **Favorite** again to remove one. Each character has their own favorites, and they're included in backup files.

## Adding and changing spells

Open `data/spells.csv`. It works in Excel or Google Sheets. Edit your list there, export it as CSV, and replace the file in `data/` on GitHub (Add file, Upload files; same file name).

Before you upload, open the app, go to **More**, and use **Try a spell CSV from this device**. The app shows your new file instead of the live one until you reload the page, and **Data check** lists anything wrong, with the row number.

Columns, in any order (capitals don't matter):

| Column | Notes |
| --- | --- |
| Spell Name | Required |
| Requirement | See below |
| Range, Cast Time, FP Cost, Duration | Shown on the card. FP Cost as a plain number gives the spell a "Cast" button. |
| Description | The text. If it contains `Escalation: ...`, that part is split out under its own heading. |
| Escalation | Optional. A separate column works too. |
| Rarity | Common, Uncommon or Rare. Uncommon and Rare spells must be **learned**. |
| ID | Optional. See "Renaming a spell" below. |
| Any other column | Shown on the card automatically (for example "School"). |

You no longer need to put "(uncommon)" in a spell name. The Rarity column does that job, and the tag is hidden if it's there.

### How requirements are read

| Written as | Means |
| --- | --- |
| `Fire 4` | Fire is at least 4 |
| `Any 3` | At least **one** element is 3 or higher |
| `Air 4 / Spirit 3` or `Fire 4, DEX 12` | Both are needed (`/` and `,` both mean "and") |
| `Animalians OR WIS 13, Water 3` | Either side is enough. A lowercase `or` works too. |
| `1 Earth / 1 Fire` | Number first is fine |
| `None` or blank | Everyone qualifies |

A Hall or special name (Animalians, Cybermagics, Spectral Field) can't be checked automatically, so it never qualifies a character by itself. Those spells use **Override and add** and **Learn spell**, as before. Text in brackets, like `(Hunter 10)`, is shown but not checked.

### Renaming a spell

Characters remember learned and overridden spells by name. If you rename a spell, characters lose their mark on it. To avoid that, add an **ID** column and put the *old* name there. The ID never shows, and the new name takes over.

## Adding items

`data/items.csv` works the same way. Columns:

| Column | Notes |
| --- | --- |
| Item Name | Required |
| Type | Potion, Clothing, Weapon... Used for the type filter. |
| Rarity | Optional |
| Equip Slot | If filled in (Back, Ring, Hand...), the item gets an **Equip** button and shows under "Equipped" |
| Consumable | `Yes` gives the item a **Use one** button |
| Description | Shown on the card |
| ID | Optional, works like the spell ID |
| Any other column | Shown on the card (the example file has Effect and Value) |

Items with an Equip Slot are tracked one at a time. Everything else stacks with a quantity. Players can also make a **custom item** on the spot.

## Hall dropdown

It is saved and shown, but does nothing else yet. Change the choices in `js/config.js` (`HALLS`).

## Editing in Google Sheets directly (optional)

If you'd rather have the app read a live Google Sheet, use File, Share, **Publish to web**, choose the sheet and **CSV**, and paste the link into `DATA.spells` in `js/config.js`. I haven't been able to test this from here, so check that it loads. If it doesn't, the upload method above always works. Published sheets can also take a few minutes to update.

## If something looks wrong

- **More, Data check** lists every problem it finds, with the row number.
- If the live lists can't be reached, the app uses the copy it saved on that device and tells you so.
- Deleting a character asks first. Removing or using an item offers **Undo**.

## Checking your changes automatically (optional)

If you have Node.js 18 or newer: open a terminal in this folder and run `node tests/run.js`. It checks the requirement rules, reads your real `spells.csv`, and tests saving, backups and copying from the old app. Nothing needs installing.
