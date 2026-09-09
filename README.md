# Intralox Expenses

Match receipt photos to Amex charges on your phone, add cash expenses, and
export one self-contained HTML claim.

It installs to your home screen and runs offline. Statements, photos and
amounts stay on the device — the app has no server and no account.

## Uploading to GitHub

**Every file sits in the root. There are no folders, on purpose** — GitHub's
web uploader silently drops folders, which is what broke the first attempt.

1. In the repo, **Add file → Upload files**.
2. Open this folder, select **all the files** (Ctrl+A / Cmd+A) and drag them
   in. Don't drag the folder itself.
3. Check the file count matches before committing: **21 files**.
4. **Settings → Pages**, source `main` / root. The repo must be **public**
   unless you're on a paid plan.

To confirm the upload worked, open the Pages URL and use
**⋯ → Options → Check install readiness**. Every line should tick.

## Install on the phone

1. Open the **https:// Pages URL** in Chrome on the Samsung. It has to be
   that URL — not a `file://` open, not a `raw.githubusercontent.com` link.
2. Open **⋯ → Options** and tap **Install app**.

That button appears only once Chrome has confirmed the app is installable,
so if it's there, the install will be a real one: its own icon, no browser
bar, launches like any other app.

If the button isn't there, tap **Check install readiness** in the same menu.
It reports each requirement in turn — secure origin, manifest, scope, icons,
service worker — so you can see exactly which one is failing rather than
guessing. Chrome occasionally wants a second visit before it offers, so
reload once if everything is ticked.

From then on it works with no signal.

To try it on a desktop first: `python3 -m http.server 8000` in this folder,
then open <http://localhost:8000>. A plain `file://` open won't work — modules
and service workers need a real origin.

## Each month

1. Download the Amex activity export (`.xlsx` or `.csv`) into your OneDrive
   folder.
2. Open the app, **⋯ → Load Amex file**, and pick it. Android's file picker
   lists OneDrive as a source, so no Microsoft sign-in is needed here.
3. **Receipts → Take photo** or **Choose photos**.
4. Confirm the date for each one. It arrives already filled in from the
   photo's own EXIF data, so this is normally just a tap. If you snapped
   the receipt a day or two after buying, tap **1 day earlier** /
   **2 days earlier**, or pick any date from the field below the chips.
5. Tap a receipt. The charges from that same day come up first, then a day
   either side. Tap the right one.
6. Anything with no matching charge → **Make it a cash expense**, then type
   the description and amount.
7. **Export HTML.** The share sheet sends it to OneDrive, email, or wherever
   you like.

Work saves as you go. Close the app whenever.

## Why the date matters

The receipt date is the only thing you type about a receipt, and it does all
the sorting. A receipt dated the 20th almost always belongs to a charge dated
the 20th, so the app never needs to read the amount off the paper — it just
offers you that day's charges, nearest first. On a day with one charge, filing
a receipt is a single tap.

Charges sometimes post a day or two after the purchase, so the window runs
from one day before to three days after. **Show all charges** widens it when
something doesn't line up.

## The export

One HTML file. An index of every charge with a receipt number beside it, then
all the receipts stitched into a continuous strip in the same order, each
captioned with its date, merchant and amount. Charges with no receipt are
listed in a flagged block at the top — that's the list a reviewer reads first.

Photos are shrunk to 1400px before embedding, so a month of 40 receipts lands
around 8MB rather than 150MB.

## Starting a new month

Export first — the export is the record — then **⋯ → Start a new month**.

---

## Notes on the statement parser

Written against a real export. Each of these is something that file does:

- **The header is not the first row.** Six rows of account metadata sit above
  it, so the parser scans for the row beginning `Date`.
- **Dates are `DD/MM/YYYY`.** Parsed day-first, always. Left to guess,
  `04/08/2026` becomes 8 April instead of 4 August.
- **Payments are negative rows.** `COMPANY DIRECT DEBIT PAYMENT RECEIVED` is
  kept out of the claim and shown separately, so the statement still
  reconciles without inflating the total.
- **Reference is unique per transaction** and stable across exports. It's the
  key that lets a re-import keep receipts already attached, and it separates
  two identical charges on the same day — the sample file has
  `CANTALOUPE WINDSOR` twice on 20 Aug, $7.50 each.
- **The summary sheet is a checksum.** Charges parse to $3,509.34, exactly the
  `Charges & Adjustments` figure. A mismatch shows as a red banner, because if
  the parse is wrong then every number below it is wrong too.
- **Empty cells contain a space**, not a null.
- **The statement period is in the title cell** (`Aug 04, 2026 to Sep 03,
  2026`), so the cycle day comes from the file. Each export is already exactly
  one period — nothing to configure.
- CSV exports have no metadata block, so the period falls back to the first
  and last transaction dates.

## Branding

Red and white lead; grays are support only. No blues or cyans anywhere.

- **Intralox red (#EA1C24)** carries the identity: the logo, the rule under
  the header, the active tab, primary buttons. **White** is the dominant
  surface, with a very light wash (#F7F8F8) only to separate panels.
- Grays are text and borders alone — #222222 text, #4D4D4F secondary,
  #E3E3E3 rules.
- Two functional colours, both from the approved digital palette: **green
  #237F35** for a matched receipt, **orange #E36C00** for anything needing
  attention. Errors don't use red, since red now reads as brand rather than
  alarm.
- **Roboto** in the app, vendored in `fonts/` so it works offline.
  **Arial** in the exported document, the standard for internal forms
  (Guidelines p.19), so it renders identically anywhere.
- The logo is the **approved artwork**, never redrawn (p.12), converted to
  transparent PNG so it sits cleanly on white. It's 26px tall in the header —
  the earlier white knockout at 17px was unreadable on a phone.

### Note on the guidelines

The written guidelines (p.14) reserve red for the logo and make dark gray
dominant. This build leads with red at your direction. Worth a word with
Global Marketing if it's going anywhere outside your own claims.

### Why it wasn't installing

Three faults, all fixed:

- **The `icons/` folder never reached the repo.** GitHub's web uploader
  dropped every subfolder, so the manifest pointed at icons that returned
  404. Icons are a hard installability requirement, so Chrome fell back to
  "Create shortcut" with a generic icon. `lib/xlsx.full.min.js` was missing
  too, which would have broken statement loading the moment it was tried.
  The app is now flat — no folders to lose.

- The manifest carried an `id` of `/intralox-expenses/`. Chrome resolves
  `id` against the **origin**, not the manifest's folder, so on GitHub Pages
  it landed outside the app's scope and broke the app's identity. It's now
  omitted, which makes Chrome default it to `start_url`.
- Nothing in the app ever asked to be installed. Chrome fires
  `beforeinstallprompt` only when every criterion passes; the app now catches
  that event and shows a real **Install app** button. Adding a page from the
  browser menu without it only ever creates a shortcut — a badged icon that
  opens in a browser tab, which is what you were seeing.

`start_url` is now `./` rather than `./index.html`, so it matches scope
exactly.

If a file ever does go missing again, **Check install readiness** names it
rather than leaving you to guess, and loading a statement without
`xlsx.full.min.js` now says so plainly instead of failing silently.

### Updating an installed app

The service worker is **network-first for code and markup**, so a phone with
the app installed picks up new builds on the next launch with a signal.
Fonts and images stay cache-first because they don't change. Bump `VERSION`
in `sw.js` whenever you change a file. **⋯ → Options** shows the build number
so you can tell what a phone is actually running.

The header logo is embedded directly in `index.html` as a data URI rather
than loaded from `brand/`, so it can't 404 or go stale independently of the
page.

### App icon — placeholder

`icons/icon-192.png` and `icon-512.png` are a stand-in: white logo on an
Intralox red tile. Replace both with the CRM app icon artwork, dropping the
"Call Log" wordmark and setting "Expenses" beneath it. Bump `CACHE` in
`sw.js` afterwards so installed phones pick the new icon up.

## Files

All 21 in the root, no subfolders:

    index.html              the app shell
    app.js                  state, matching, events
    amex.js                 statement parser
    images.js               EXIF date, rotation, resizing
    store.js                IndexedDB
    export.js               builds the output HTML
    style.css               Intralox styling
    sw.js                   offline cache — bump VERSION when you change a file
    manifest.json           install metadata
    xlsx.full.min.js        SheetJS, vendored so the app works offline
    roboto-*.woff2          Roboto 300/400/500/700
    intralox-red.png        approved logo, used in the export
    intralox-white.png      approved logo, used in the app icon
    icon-192/512.png        app icon — placeholder, see above
    icon-maskable-512.png   launcher safe zone
    apple-touch-icon.png
    README.md

## Storage

Everything lives in IndexedDB. The app asks for persistent storage on first
run, which stops Android evicting it when space gets tight, but the export is
still the durable record — take it before clearing a month. **⋯ → Storage
used** shows where you are against the quota.
