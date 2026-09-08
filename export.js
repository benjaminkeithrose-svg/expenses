// Builds the deliverable: one HTML file with an index and every receipt
// stitched into a continuous strip. Images are embedded so it works alone.

import { getImage } from "./store.js";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function shortDate(isoStr) {
  if (!isoStr) return "";
  const [y, m, d] = isoStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export const money = (v) =>
  v === null || v === undefined ? "\u2014" : "$" + v.toFixed(2);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const toDataURL = (blob) =>
  new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(blob);
  });

/* The logo is the approved asset, embedded so the file stands alone.
   Never redrawn — see Guidelines p.12, "Never attempt to create the logo". */
async function logoDataURL(file) {
  try {
    const res = await fetch(file);
    if (!res.ok) return null;
    return await toDataURL(await res.blob());
  } catch {
    return null;
  }
}

export async function buildExport(state) {
  const stmt = state.statement || {};
  // White logo on the dark masthead, red for print where it inverts to white
  // paper (Guidelines p.28 — use only the white logo on dark).
  const logoWhite = await logoDataURL("brand/intralox-white.png");
  const logoRed = await logoDataURL("brand/intralox-red.png");

  // Walk everything in the order it will appear, numbering as we go. The
  // number is what ties each index row to its receipt further down.
  const numbers = {}, strip = [];
  let n = 0;
  const items = [
    ...state.lines.map((l) => ["amex", l]),
    ...state.cash.map((c) => ["cash", c]),
  ];
  for (const [kind, item] of items)
    for (const rid of item.receipts) {
      numbers[rid] = ++n;
      strip.push([n, kind, item, rid]);
    }
  const placed = new Set(Object.keys(numbers));
  for (const rid of Object.keys(state.receipts))
    if (!placed.has(rid)) {
      numbers[rid] = ++n;
      strip.push([n, "orphan", null, rid]);
    }

  const amexTotal = state.lines.reduce((s, l) => s + l.amount, 0);
  const cashTotal = state.cash.reduce((s, c) => s + (c.amount || 0), 0);
  const missing = state.lines.filter((l) => !l.receipts.length);

  const p = [];
  const a = (s) => p.push(s);

  a(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Expenses ${esc(stmt.periodStart)} to ${esc(stmt.periodEnd)}</title>
<style>
/* Intralox Global Brand Guidelines: dark gray dominant, cyan secondary,
   red reserved for the logo. Arial per the internal-forms standard (p.19),
   so the file renders identically anywhere without embedded fonts. */
:root{--ink:#222;--soft:#4D4D4F;--rule:#E3E3E3;--paper:#fff;--miss:#B2232F;--ok:#237F35;--cyan:#479EBC;--lightgray:#E8EAEB;--header:#363738}
*{box-sizing:border-box}
body{margin:0;background:var(--lightgray);color:var(--ink);font:15px/1.55 Arial,"Helvetica Neue",Helvetica,sans-serif;font-variant-numeric:tabular-nums}
.sheet{max-width:760px;margin:0 auto;background:var(--paper);padding:0 0 60px}
.masthead{background:var(--header);padding:20px 32px 18px;margin-bottom:30px}
.masthead img{height:22px;width:auto;display:block;margin-bottom:12px}
.masthead img.lg-print{display:none}
.masthead h1{color:#fff;font-size:21px;font-weight:700;margin:0 0 3px}
.masthead p{color:#B3B5B8;font-size:13.5px;margin:0}
.pad{padding:0 32px}
.sub{color:var(--soft);font-size:14px;margin:0 0 26px}
h2{font-size:14px;font-weight:700;margin:34px 0 10px;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);border-left:3px solid var(--cyan);padding-left:9px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-weight:500;color:var(--soft);font-size:12.5px;padding:0 8px 6px 0;border-bottom:1px solid var(--rule)}
td{padding:7px 8px 7px 0;border-bottom:1px solid #eceef0;vertical-align:top}
.num{text-align:right;white-space:nowrap;padding-right:0}
.ref{width:34px;color:var(--soft);font-size:12.5px}
.none{color:var(--miss)}
.totals{display:flex;gap:30px;padding:16px 0;border-top:2px solid var(--soft);border-bottom:1px solid var(--rule);flex-wrap:wrap}
.totals div{min-width:92px}
.totals span{display:block;color:var(--soft);font-size:12.5px}
.totals b{font-size:19px;font-weight:700}
.flag{background:#F9ECED;border-left:3px solid var(--miss);padding:12px 16px;margin:18px 0;font-size:14px}
.flag ul{margin:8px 0 0;padding-left:18px}
.rcpt{padding:24px 0 20px;border-bottom:1px solid var(--rule)}
.cap{display:flex;gap:10px;align-items:baseline;margin-bottom:12px}
.cap .n{font-weight:600;color:var(--soft);min-width:26px}
.cap .d{flex:1}
.cap .m{font-weight:700}
.cap small{display:block;color:var(--soft);font-size:12.5px;font-weight:400}
.rcpt img{width:100%;max-width:520px;display:block;border:1px solid var(--rule)}
.tag{font-size:11.5px;padding:1px 7px;border-radius:9px;background:var(--lightgray);color:var(--soft)}
.tag.cash{background:#EDF3EE;color:var(--ok)}
.tag.orphan{background:#F9ECED;color:var(--miss)}
footer{margin-top:32px;color:var(--soft);font-size:12.5px}
@media print{body{background:#fff}.sheet{max-width:none;padding:0}.rcpt{page-break-inside:avoid}.masthead{background:#fff;padding:0 0 14px;border-bottom:2px solid var(--header)}.masthead h1{color:var(--ink)}.masthead p{color:var(--soft)}.pad{padding:0}.masthead img.lg-screen{display:none}.masthead img.lg-print{display:block}}
</style></head><body><div class="sheet">`);

  a(`<div class="masthead">${logoWhite ? `<img class="lg-screen" src="${logoWhite}" alt="Intralox">` : ""}${logoRed ? `<img class="lg-print" src="${logoRed}" alt="Intralox">` : ""}
<h1>Expenses \u2014 ${shortDate(stmt.periodStart)} to ${shortDate(stmt.periodEnd)} ${esc((stmt.periodEnd || "").slice(0, 4))}</h1>
<p>${esc(stmt.card || "")} \u00b7 prepared ${shortDate(new Date().toISOString().slice(0, 10))} ${new Date().getFullYear()}</p></div><div class="pad">`);

  a(`<div class="totals">
<div><span>Card charges</span><b>${money(amexTotal)}</b></div>
<div><span>Cash</span><b>${money(cashTotal)}</b></div>
<div><span>Total to claim</span><b>${money(amexTotal + cashTotal)}</b></div>
<div><span>Receipts</span><b>${placed.size}</b></div>
</div>`);

  if (missing.length) {
    a(`<div class="flag"><strong>No receipt attached \u2014 ${missing.length} charge${missing.length === 1 ? "" : "s"}</strong><ul>`);
    for (const l of missing)
      a(`<li>${shortDate(l.date)} \u00b7 ${esc(l.description)} \u00b7 ${money(l.amount)}</li>`);
    a(`</ul></div>`);
  }

  a(`<h2>Card charges</h2><table><thead><tr><th class="ref">#</th><th>Date</th><th>Merchant</th><th class="num">Amount</th></tr></thead><tbody>`);
  for (const l of state.lines) {
    const refs = l.receipts.map((r) => numbers[r]).join(", ");
    a(`<tr><td class="ref">${refs || '<span class="none">\u2014</span>'}</td><td>${shortDate(l.date)}</td><td>${esc(l.description)}</td><td class="num">${money(l.amount)}</td></tr>`);
  }
  a(`<tr><td></td><td></td><td><strong>Subtotal</strong></td><td class="num"><strong>${money(amexTotal)}</strong></td></tr></tbody></table>`);

  if (state.cash.length) {
    a(`<h2>Cash expenses</h2><table><thead><tr><th class="ref">#</th><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>`);
    for (const c of state.cash) {
      const refs = c.receipts.map((r) => numbers[r]).join(", ");
      a(`<tr><td class="ref">${refs || '<span class="none">\u2014</span>'}</td><td>${shortDate(c.date)}</td><td>${esc(c.description || "Cash expense")}</td><td class="num">${money(c.amount)}</td></tr>`);
    }
    a(`<tr><td></td><td></td><td><strong>Subtotal</strong></td><td class="num"><strong>${money(cashTotal)}</strong></td></tr></tbody></table>`);
  }

  if (stmt.credits?.length) {
    a(`<h2>Payments and credits</h2><table><tbody>`);
    for (const c of stmt.credits)
      a(`<tr><td class="ref"></td><td>${shortDate(c.date)}</td><td>${esc(c.description)}</td><td class="num">${money(c.amount)}</td></tr>`);
    a(`</tbody></table><p class="sub" style="margin-top:8px">Not part of the claim \u2014 shown so the statement reconciles.</p>`);
  }

  a(`<h2>Receipts</h2><div class="strip">`);
  if (!strip.length) a(`<p class="sub">No receipts attached yet.</p>`);
  for (const [num, kind, item, rid] of strip) {
    const rec = await getImage(rid);
    const src = rec?.display ? await toDataURL(rec.display) : null;
    let head, tag = "";
    if (kind === "orphan") {
      const meta = state.receipts[rid];
      head = `<span class="m">Unmatched receipt</span><small>${meta?.date ? shortDate(meta.date) + " \u00b7 " : ""}Not attached to a charge or cash expense</small>`;
      tag = `<span class="tag orphan">unmatched</span>`;
    } else {
      head = `<span class="m">${esc(item.description || "Cash expense")}</span><small>${shortDate(item.date)} \u00b7 ${money(item.amount)}</small>`;
      if (kind === "cash") tag = `<span class="tag cash">cash</span>`;
    }
    a(`<div class="rcpt"><div class="cap"><span class="n">${num}</span><span class="d">${head}</span>${tag}</div>`);
    a(src ? `<img src="${src}" alt="Receipt ${num}">` : `<p class="none">Image missing.</p>`);
    a(`</div>`);
  }
  a(`</div>`);

  if (stmt.check) {
    const txt = stmt.check.ok
      ? "matches the statement summary"
      : `DOES NOT MATCH \u2014 statement says ${money(stmt.check.stated)}`;
    a(`<footer>Parsed charges total ${money(stmt.check.parsed)}; ${txt}.<br>Source file: ${esc(stmt.source || "")}</footer>`);
  }

  a(`</div></div></body></html>`);

  const name = `expenses-${stmt.periodStart || "period"}-to-${stmt.periodEnd || ""}.html`;
  return { blob: new Blob([p.join("\n")], { type: "text/html" }), name };
}
