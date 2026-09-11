# Using it each month

Everything stays on the phone. There's no account, no server, and nothing is
uploaded anywhere.

---

## 1. Get the Amex file

Download the activity export (`.xlsx` or `.csv`) from Amex into your OneDrive
folder.

In the app: **⋯ → Load Amex files**, or the **+** at the right of the month
strip. Android's file picker lists OneDrive as a source, so there's no
Microsoft sign-in to deal with here.

**You can pick several exports at once.** Each one becomes its own month and
sits alongside the others — nothing is replaced. Re-loading a month you
already have refreshes its charges and keeps the receipts already attached.

A green banner confirms the parse — it checks the charges it read against the
statement's own summary figure. **If that banner is red, stop.** It means the
parse disagrees with Amex, and every number below it is suspect.

The statement period is read from the file, so there's no cycle day to set.
Each export is already exactly one period.

**The strip under the header is the running record.** One chip per month,
newest first. Tap a chip to switch; the number on it is how much is still
outstanding, and a tick means it's been completed. Tapping the dates in the
header opens the same list with totals.

---

## 2. Add the receipts

**Receipts → Take photo**, or **Choose photos** for ones already in the
gallery.

Each photo asks for a date. It comes pre-filled from the photo's own EXIF
data, so usually you just tap **Save date**.

If you photographed the receipt after the fact, tap **1 day earlier**,
**2 days earlier** or **3 days earlier**. Any other date can be set in the
field below the chips.

**The date is the only thing you type about a receipt**, and it does all the
work. Amounts are never needed — they come from the statement.

The date also decides **which month** the receipt files into, so the prompt
tells you where it's going before you save it. If no statement covers that
date yet, it says so — load the export and the receipt seats itself.

---

## 3. File them

Tap a receipt. The charges from that same day come up first, then a day
either side, then further out.

Tap the right one. The row turns green.

- **Same-day charges are grouped at the top.** On a quiet day it's one tap.
- **A busy day shows several.** Pick by merchant name.
- **Nothing fits?** Tap **Show all charges** to widen beyond the ±3 day
  window. Charges sometimes post two or three days after the purchase — a car
  hire returned on the 20th can be charged on the 22nd.
- **Only this month's charges are ever offered.** That's deliberate — it's
  what stops a June receipt landing on a July charge. If a purchase at the
  very end of a cycle posted into the next statement, tap **Different month**
  and move the receipt across.
- **Wrong one?** Tap the small thumbnail on the row to send it back.

One receipt can go on two charges, and two receipts on one charge — a deposit
and a balance, or a split bill.

---

## 4. Cash expenses

Anything you couldn't put on the card.

Easiest route: tap the receipt, then **Make it a cash expense**. That creates
the entry with the photo already attached and you fill in description and
amount.

Or **Cash → Add cash expense** first, and drag the receipt on afterwards if
you're working from a pile of paper.

Cash is the only place you type an amount, because there's no statement to
take it from.

---

## 5. Export and tick the month off

Two buttons at the bottom, and they act on **the month you're looking at**
only. Nothing is ever totalled across months — each one is its own claim.

- **Export HTML** — an interim copy, any time you like. Changes nothing.
- **Complete & export** — the one that finishes the month. It warns you about
  any charge still missing a receipt, downloads the document, and locks the
  month. Its chip turns green with a tick.

Locked doesn't mean gone: the month stays in the strip, and **Reopen** unlocks
it if something turns up late.

The share sheet sends the file to OneDrive, email, or wherever you
need it.

You get one file containing:

- Totals split three ways — card charges, cash, and the combined figure. They
  usually get reimbursed differently, so the split stays visible.
- **A flagged list of every charge with no receipt attached**, at the top.
  That's the part a reviewer reads first.
- An index of every charge with a receipt number beside it.
- All the receipts stitched into one continuous strip in the same order, each
  captioned with its date, merchant and amount.

It's self-contained — images are embedded, so it works on its own and prints
cleanly.

---

## 6. Keeping the phone from filling up

Months accumulate, and so do the photos. Once a month is completed and its
export is safely away, **⋯ → Options → Free photos from completed months**
deletes the pictures for every ticked month.

The record survives — the charges, the amounts, and which receipt sat against
which line all stay. Only the images go, and they're in the export.

**⋯ → Options → Storage used** shows where you stand, how many months are
held, and how many photos.

To remove a month outright, **Delete this period**. **Clear everything** wipes
the lot.

---

## Notes

- Work saves as you go. Close the app whenever.
- The app asks Android not to evict its data, but export promptly anyway.
- A completed month can't be overwritten by re-loading its Amex export.
  Reopen it first.
- Photos are shrunk to 1400px before embedding, so a month of 40 receipts
  lands around 8MB rather than 150MB. Untouched originals are not kept on the
  phone version — the export is the archive.
