# Intralox Expenses

Match receipt photos to Amex charges on your phone, add cash expenses, and
export one self-contained HTML claim.

It installs to your home screen and runs offline. Statements, photos and
amounts stay on the device — the app has no server and no account.

## Install on the phone

1. Push this folder to a GitHub repo, then turn on **Settings → Pages**,
   source `main` / root. GitHub serves the files; it never sees your data.
2. Open the Pages URL in Chrome on the Samsung.
3. **⋮ → Add to Home screen.**

From then on it opens like any other app and works with no signal.

To try it on a desktop first: `python3 -m http.server 8000` in this folder,
then open <http://localhost:8000>. A plain `file://` open won't work — modules
and service workers need a real origin.

## Each month

1. Download the Amex activity export (`.xlsx` or `.csv`) into your OneDrive
   folder.
2. Open the app, **⋯ → Load Amex file**, and pick it. Android's file picker
   lists OneDrive as a source, so no Microsoft sign-in is needed here.
3. **Receipts → Take photo** or **Choose photos**.
4. Confirm the date for each one. It's usually already filled in from the
   photo's own EXIF data, so this is normally just a tap.
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

Applied from the Intralox Global Brand Guidelines:

- **Dark gray (#4D4D4F / header #363738) dominant**, cyan (#479EBC) as the
  secondary accent on section rules and the active tab. **Intralox red is
  reserved for the logo** and is used nowhere in the UI (p.14).
- Design-system UI tokens for state: success #237F35, error #B2232F,
  emphasis #FFA400, input border #E3E3E3, text #222222 (p.17).
- **Roboto** in the app, the primary digital typeface (p.20), vendored in
  `fonts/` so it works offline. **Arial** in the exported document, the
  standard for internal forms (p.19), so it renders identically anywhere
  with no embedded fonts.
- The logo is the **approved artwork**, never redrawn (p.12). White on the
  dark masthead, red when the document is printed and the masthead inverts
  to white paper (p.28).

### App icon — placeholder

`icons/icon-192.png` and `icon-512.png` are a stand-in built from the
approved white logo. Replace both with the CRM app icon artwork, dropping
the "Call Log" wordmark and setting "Expenses" beneath it. Nothing else
needs changing — bump `CACHE` in `sw.js` so phones pick the new icon up.

## Files

    index.html    the app shell
    app.js        state, matching, events
    amex.js       statement parser
    images.js     EXIF date, rotation, resizing
    store.js      IndexedDB
    export.js     builds the output HTML
    sw.js         offline cache — bump CACHE when you change a file
    lib/          SheetJS, vendored so the app works offline
    fonts/        Roboto (300/400/500/700), vendored
    brand/        approved Intralox logo, white and red
    icons/        app icon — placeholder, see above

## Storage

Everything lives in IndexedDB. The app asks for persistent storage on first
run, which stops Android evicting it when space gets tight, but the export is
still the durable record — take it before clearing a month. **⋯ → Storage
used** shows where you are against the quota.
