# Handover

Everything a person — or a fresh Claude conversation — needs to pick this up.

---

## What it is

A phone app for reconciling Amex corporate card charges against receipt
photos, plus manually entered cash expenses, producing a single
self-contained HTML claim.

Built as an installable **Progressive Web App**: pure HTML, CSS and
JavaScript, no build step, no server, no account. Hosted on GitHub Pages,
which serves the code and never sees the data. Statements, photos and amounts
live in the phone's IndexedDB.

**Current build: v7.**

---

## Why a PWA and not something else

The first version was a Python/FastAPI server with a browser UI. It worked,
but a local server can't be a standalone Android app, which was the
requirement. A PWA installs to the home screen, runs offline, and reaches
OneDrive through Android's own file picker without any Microsoft integration.

The Python version is preserved under `desktop/` for laptop use. It is not
maintained in step with the phone app.

---

## v7 — a running record of periods

v6 held exactly one statement; loading another replaced it. v7 keeps them all.

    S = { v: 7, periods: [...], activeId, receipts: {} }

Each period is self-contained — `lines`, `cash`, `credits`, `check`, `done`,
`doneAt` — and carries the id `p_<periodStart>_<periodEnd>`, which is stable,
so re-importing the same export lands on the same period and keeps the
receipts already attached (matched by Amex reference, as before).

**Nothing is ever totalled across periods.** Each month is reimbursed on its
own, so a combined view would be a number nobody wants. Tallies, the export
and the checksum banner all read the active period only.

### Segmentation is the whole point

The requirement was multiple months *without* receipts leaking between them.
Three things enforce that:

1. Every receipt carries a `periodId`, set from its date on save. `periodFor()`
   takes the period that contains the date, or failing that the nearest by
   edge distance — a receipt is never stranded.
2. `candidates()` only ever reads `lines` from the receipt's own period.
   **Show all charges** widens the date window, never the period. This is the
   line to hold if anything here is ever refactored.
3. The export filters `receipts` to the period being built, so another
   month's loose receipt can't surface as an orphan in this claim.

The escape hatch for the genuine boundary case — a purchase on the 30th that
posts on the 2nd, landing the charge in the next statement — is **Different
month** in the assign sheet, which re-homes the receipt by hand.

The date prompt names the month the receipt will file into. The date was
already the only thing typed about a receipt; it now decides two things
instead of one, so it says so before you save.

### Completion and storage

**Complete & export** builds the document, then sets `done`. A done period is
read-only (`body.locked`), refuses re-import, and shows Reopen instead.

A rolling record would otherwise eat the quota, so **Free photos from
completed months** deletes the blobs of ticked periods and marks each receipt
`released: true`. Rows, amounts and attachments survive; only the pictures
go, and those are in the export. Released thumbnails render grayed
(`img.gone`) rather than broken.

`migrate()` folds a v6 state into a single period on first load. Don't remove
it until every phone has run v7 at least once.

---

## The central design idea

**The receipt date does all the sorting; amounts are never read off paper.**

A receipt dated the 20th almost always belongs to a charge dated the 20th, so
the app offers that day's charges first rather than trying to match on value.
This removes OCR entirely, and with it the whole class of silent failures
where a misread total breaks matching invisibly.

The date itself usually costs nothing to enter — it's pulled from the photo's
EXIF `DateTimeOriginal`, with one-tap chips to step back a day or two for
receipts photographed after the fact.

Candidate window is **−1 to +3 days**, sorted nearest-first, with equal gaps
ordered "after" before "before" so day groups stay contiguous. Charges post
after the purchase, rarely before. **Show all charges** widens it.

Automated receipt reading was considered and deliberately dropped. If it's
ever revisited, the review step must stay: a wrong amount fails silently.

---

## Amex parser — hard-won findings

`amex.js` is written against a real export. Every one of these is something
that file actually does. **Do not "simplify" these away.**

- **The header is not row 1.** Six rows of account metadata sit above it. The
  parser scans for the row whose first cell is `Date`.
- **Dates are `DD/MM/YYYY`.** Parsed day-first, always. Left to a generic
  parser, `04/08/2026` becomes 8 April instead of 4 August — and that is the
  first transaction in the sample file, so the bug would be immediate but
  quiet.
- **Payments are negative rows.** `COMPANY DIRECT DEBIT PAYMENT RECEIVED` is
  the employer paying the card. It's separated out of the claim and shown in
  its own section so the statement still reconciles without inflating the
  total.
- **`Reference` is unique per transaction and stable across exports.** It is
  the key that lets a statement be re-imported without losing attached
  receipts, and it distinguishes two otherwise identical charges — the sample
  file has `CANTALOUPE WINDSOR` twice on 20 Aug at $7.50 each.
- **The summary sheet is a checksum.** Charges parsed to $3,509.34, exactly
  the `Charges & Adjustments` figure. A mismatch raises a red banner, because
  if the parse is wrong then every number below it is wrong too. Keep this.
- **Empty cells contain a single space**, not a null.
- **The statement period is in the title cell** (`Aug 04, 2026 to Sep 03,
  2026`), so the billing cycle comes from the file. There is no cycle day to
  configure — each export is exactly one period.
- CSV exports carry no metadata block, so the period falls back to the first
  and last transaction dates.

Reference sample: 27 charges, 1 credit, period 4 Aug – 3 Sep 2026.

---

## Branding

Applied from the Intralox Global Brand Guidelines, with one deliberate
departure.

- **Red (#EA1C24) and white lead.** Grays are text and borders only. No blues
  or cyans anywhere.
- Two functional colours, both from the approved digital palette: **green
  #237F35** for a matched receipt, **orange #E36C00** for anything needing
  attention. Errors deliberately don't use red, since red now reads as
  identity rather than alarm.
- **Roboto** in the app, vendored so it works offline. **Arial** in the
  exported document — the standard for internal forms — so it renders
  identically anywhere with no embedded fonts.
- The logo is the **approved artwork**, never redrawn. It's embedded in
  `index.html` as a data URI so it can't 404 or go stale independently of the
  page.

**The departure:** the written guidelines reserve red for the logo and make
dark gray dominant. Leading with red was a direct instruction. Fine for
internal claims; worth clearing with Global Marketing before it goes wider.

---

## Outstanding

**The app icon is a placeholder.** `icon-192.png`, `icon-512.png`,
`icon-maskable-512.png` and `apple-touch-icon.png` are a stand-in: the
approved white logo on a red tile.

They should be replaced with the **CRM system's app icon**, with the
"Call Log" wordmark removed and **"Expenses"** set beneath it. The original
vector or a 512px+ PNG is needed — the asset was not in the project files.

The maskable variant needs its content inside the middle ~72%, because
Android launchers crop maskable icons to a circle.

After replacing, bump `VERSION` in `sw.js`, and remove and re-add the app on
any phone — Android caches launcher icons at install time and won't refresh
them on its own.

---

## Bugs already found and fixed

Listed so they aren't reintroduced.

- **Service worker was cache-first on everything.** Installed phones served
  the original build forever; no code or artwork change ever arrived. Now
  network-first for code and markup, cache-first for fonts and images.
- **Manifest `id` was out of scope.** It was set to `/intralox-expenses/`,
  and Chrome resolves `id` against the *origin*, not the manifest's folder —
  so on Pages it landed outside scope. Now omitted, which makes Chrome
  default it to `start_url`.
- **Nothing ever offered to install.** Chrome fires `beforeinstallprompt`
  only when every criterion passes; the app now catches it and shows a real
  Install button. Without that, the browser menu only ever creates a
  shortcut.
- **Subfolders were dropped by GitHub's web uploader**, so icons and the
  spreadsheet library 404'd and Chrome refused to install. **The app is now
  flat — 20 files, no folders. Keep it that way.**
- **CSS specificity trap**: `.masthead img` outranked a bare `.lg-print`
  class, so both logo variants rendered at once.
- **White logo knockout was muddy** because the alpha was derived from
  luminance, which treats Intralox red as a midtone. It's now keyed off
  distance from white.
- **`[hidden]` was overridden** by `display: flex` on the overlays, leaving
  an invisible lightbox covering the page. A global
  `[hidden] { display: none !important }` fixes it.
- **Toast sat above the sheets** and covered the date field.
- **`buildExport` took the whole state.** It now takes one period plus the
  receipt map, because "the whole state" stopped meaning one claim at v7.

---

## Where things live

    index.html    shell; the logo is inlined here as a data URI
    app.js        periods, date-led matching, events, install prompt, diagnostics
    amex.js       statement parser — see findings above
    images.js     EXIF date extraction, orientation, resizing
    store.js      IndexedDB wrapper
    export.js     builds the output HTML
    style.css     Intralox styling and brand tokens
    sw.js         offline cache — bump VERSION on every change
    manifest.json install metadata

State shape is a single JSON record in IndexedDB: `periods[]`, `activeId`,
`receipts`. Image blobs are stored separately by receipt id, at display and
thumbnail size. See the v7 section above.

`smoke.mjs` boots `app.js` headlessly under jsdom and drives the period
flows — run it before shipping a change to matching or export scoping.

---

## Diagnostics

**⋯ → Options** carries three things worth knowing about:

- **Check install readiness** walks every Chrome installability requirement
  and names whichever one fails, including missing icon files.
- **Storage used** reports against the phone's quota.
- The **build number** at the bottom tells you what a phone is really
  running. Check it before debugging anything else — a stale build explains
  most odd behaviour.
