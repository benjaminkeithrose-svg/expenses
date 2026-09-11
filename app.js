import { parseStatement, StatementError } from "./amex.js";
import { prepare } from "./images.js";
import * as db from "./store.js";
import { buildExport, shortDate, money } from "./export.js";

const $ = (id) => document.getElementById(id);

/**
 * v7 state. The app now holds a running record of periods rather than one
 * statement at a time.
 *
 *   periods[]  one per Amex statement export, each self-contained: its own
 *              lines, cash, credits, checksum and completion flag.
 *   activeId   which period the tabs are showing.
 *   receipts   global by id, but every receipt carries a periodId so it can
 *              only ever be filed against charges in its own month.
 *
 * Nothing is ever totalled across periods. Each one is a separate claim.
 */
const EMPTY = { v: 7, periods: [], activeId: null, receipts: {} };

let S = structuredClone(EMPTY);
let tab = "charges";
let assigning = null;    // receipt id currently being placed
let assignWide = false;  // show every charge in the period, not just nearby ones
const urls = new Map();  // rid -> object URL, so we don't leak them

// ------------------------------------------------------------------ utils

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const uid = (p) => p + Math.random().toString(36).slice(2, 10);

const dayGap = (a, b) =>
  Math.round((Date.parse(b + "T00:00:00") - Date.parse(a + "T00:00:00")) / 864e5);

function toast(msg, bad) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 2800);
}

const save = () => db.putState(S);

async function thumbURL(rid) {
  if (urls.has(rid)) return urls.get(rid);
  const rec = await db.getImage(rid);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.thumb);
  urls.set(rid, u);
  return u;
}

// ---------------------------------------------------------------- periods

/** Stable across re-imports: the same statement always lands on the same id. */
const periodKey = (start, end) => `p_${start}_${end}`;

const P = () => S.periods.find((p) => p.id === S.activeId) || null;

const byPeriodDesc = (a, b) => (a.periodStart < b.periodStart ? 1 : -1);

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const periodLabel = (p) =>
  `${shortDate(p.periodStart)} \u2013 ${shortDate(p.periodEnd)} ${p.periodEnd.slice(0, 4)}`;

/** Short chip label: the month the period closes in. */
const periodChip = (p) => {
  const [y, m] = p.periodEnd.split("-");
  return `${MON[+m - 1]} ${y.slice(2)}`;
};

/**
 * Which period does a receipt dated `date` belong to?
 *
 * Containment first. Failing that, the nearest period by edge distance, which
 * covers the boundary case: a meal on the 30th can post on the 2nd, so the
 * receipt's own date falls outside the statement that actually carries the
 * charge. A receipt is never stranded — but it is never silently offered
 * against another month's charges either, because the assign sheet only ever
 * lists the charges of the period it landed in.
 */
function periodFor(date) {
  if (!date || !S.periods.length) return null;
  const inside = S.periods.find((p) => date >= p.periodStart && date <= p.periodEnd);
  if (inside) return inside.id;
  let best = null, bestGap = Infinity;
  for (const p of S.periods) {
    const gap = date < p.periodStart ? dayGap(date, p.periodStart) : dayGap(p.periodEnd, date);
    if (gap < bestGap) { bestGap = gap; best = p; }
  }
  return best ? best.id : null;
}

/**
 * Re-home any receipt with no period yet — photographed before the statement
 * that covers it was downloaded. Attached receipts are left alone.
 */
function reseatReceipts() {
  const placed = placedSet();
  for (const r of Object.values(S.receipts))
    if (!r.periodId && r.date && !placed.has(r.id)) r.periodId = periodFor(r.date);
}

function placedSet() {
  const s = new Set();
  for (const p of S.periods) {
    for (const l of p.lines) l.receipts.forEach((r) => s.add(r));
    for (const c of p.cash) c.receipts.forEach((r) => s.add(r));
  }
  return s;
}

function detach(rid) {
  for (const p of S.periods) {
    for (const l of p.lines) l.receipts = l.receipts.filter((r) => r !== rid);
    for (const c of p.cash) c.receipts = c.receipts.filter((r) => r !== rid);
  }
}

/** Receipts sitting in a period: its own, plus anything still undated. */
const receiptsIn = (pid) =>
  Object.values(S.receipts).filter((r) => r.periodId === pid || !r.periodId);

const homeOf = (rid) => {
  const meta = S.receipts[rid];
  return S.periods.find((x) => x.id === (meta && meta.periodId ? meta.periodId : S.activeId)) || null;
};

// ----------------------------------------------------------------- render

function render() {
  reseatReceipts();
  const p = P();

  const amex = p ? p.lines.reduce((s, l) => s + l.amount, 0) : 0;
  const cash = p ? p.cash.reduce((s, c) => s + (c.amount || 0), 0) : 0;
  const withR = p ? p.lines.filter((l) => l.receipts.length).length : 0;
  const placed = placedSet();
  const mine = p ? receiptsIn(p.id) : [];
  const unplaced = mine.filter((r) => !placed.has(r.id));
  const undated = mine.filter((r) => !r.date).length;

  $("period").textContent = p ? periodLabel(p) : "No statement";
  $("period").classList.toggle("tappable", S.periods.length > 1);
  $("card").textContent = p
    ? (p.done ? `${p.card} \u00b7 completed ${shortDate(p.doneAt)}` : p.card)
    : "Load your Amex files to start.";
  document.body.classList.toggle("locked", !!(p && p.done));

  $("tallies").innerHTML = p ? `
    <div class="tally"><span>Card</span><b>${money(amex)}</b></div>
    <div class="tally"><span>Cash</span><b>${money(cash)}</b></div>
    <div class="tally"><span>Total</span><b>${money(amex + cash)}</b></div>
    <div class="tally ${withR === p.lines.length ? "done" : "todo"}">
      <span>Receipts</span><b>${withR}/${p.lines.length}</b></div>` : "";

  renderPeriods(placed);

  const b = $("banner");
  if (p && p.check && !p.check.ok) {
    b.hidden = false; b.className = "banner";
    b.textContent = `Parsed ${money(p.check.parsed)} but the statement summary says ` +
      `${money(p.check.stated)}. Check the file before exporting.`;
  } else if (p && p.check) {
    b.hidden = false; b.className = "banner good";
    b.textContent = `${p.lines.length} charges, ${money(amex)} \u2014 matches the statement summary.`;
  } else b.hidden = true;

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("on", t.dataset.tab === tab);
    if (t.dataset.tab === "receipts")
      t.innerHTML = unplaced.length
        ? `Receipts <span class="dot">${unplaced.length}</span>` : "Receipts";
  });
  ["charges", "receipts", "cash"].forEach((v) =>
    ($("view-" + v).hidden = v !== tab));

  renderFoot(p);
  renderLines(p);
  renderCash(p);
  renderThumbs(p, unplaced, undated, placed);
}

/** The running record: one chip per statement, newest first. */
function renderPeriods(placed) {
  const strip = $("periods");
  strip.innerHTML = [...S.periods].sort(byPeriodDesc).map((p) => {
    const open = p.lines.filter((l) => !l.receipts.length).length;
    const waiting = receiptsIn(p.id).filter((r) => !placed.has(r.id)).length;
    const flag = p.done ? `<span class="tick">\u2713</span>`
      : (open + waiting) ? `<span class="dot">${open + waiting}</span>` : "";
    return `<button class="pchip ${p.id === S.activeId ? "on" : ""} ${p.done ? "done" : ""}"
      data-period="${p.id}">${periodChip(p)}${flag}</button>`;
  }).join("") +
  `<button class="pchip add" id="addPeriod" aria-label="Load Amex files">+</button>`;
}

function renderFoot(p) {
  const f = $("footbar");
  if (!p) return (f.innerHTML = "");
  f.innerHTML = p.done
    ? `<button class="btn ghost" id="reopenBtn">Reopen</button>
       <button class="btn" id="exportBtn">Export again</button>`
    : `<button class="btn ghost" id="exportBtn">Export HTML</button>
       <button class="btn" id="completeBtn">Complete &amp; export</button>`;
}

function renderLines(p) {
  $("chargesEmpty").hidden = !!p;
  const box = $("lines");
  box.hidden = !p;
  if (!p) return (box.innerHTML = "");
  box.innerHTML = p.lines.map((l) => `
    <div class="row ${l.receipts.length ? "matched" : ""}" data-line="${l.id}">
      <span class="date">${shortDate(l.date)}</span>
      <span class="desc"><b>${esc(l.description)}</b>
        ${l.city ? `<small>${esc(l.city)}</small>` : ""}</span>
      <span class="amt">${money(l.amount)}</span>
      <span class="att">${l.receipts.length
        ? l.receipts.map((r) => `<img data-thumb="${r}" data-detach="${r}" alt="">`).join("")
        : `<span class="none">\u00b7</span>`}</span>
    </div>`).join("");
  hydrateThumbs(box);
}

function renderCash(p) {
  const list = p ? p.cash : [];
  $("cashEmpty").hidden = list.length > 0;
  $("addCash").hidden = !p || p.done;
  $("cash").innerHTML = list.map((c) => `
    <div class="row ${c.receipts.length ? "matched" : ""}" data-cash="${c.id}">
      <input class="line2" type="text" value="${esc(c.description || "")}"
             placeholder="What was it for?" data-f="description">
      <input type="date" value="${c.date || ""}" data-f="date">
      <input type="number" inputmode="decimal" step="0.01"
             class="amt ${c.amount === null ? "blank" : ""}"
             value="${c.amount === null ? "" : c.amount.toFixed(2)}"
             placeholder="0.00" data-f="amount">
      <span class="att">${c.receipts.length
        ? c.receipts.map((r) => `<img data-thumb="${r}" data-detach="${r}" alt="">`).join("")
        : `<span class="none">\u00b7</span>`}</span>
      <button class="del" data-delcash="${c.id}" aria-label="Delete">\u00d7</button>
    </div>`).join("");
  hydrateThumbs($("cash"));
}

function renderThumbs(p, unplaced, undated, placed) {
  const mine = p ? receiptsIn(p.id) : [];
  const ids = mine.map((r) => r.id).sort((a, b) =>
    (S.receipts[a].date || "9999") < (S.receipts[b].date || "9999") ? -1 : 1);
  const elsewhere = Object.keys(S.receipts).length - mine.length;

  $("receiptsEmpty").hidden = ids.length > 0;
  $("rcptHint").textContent = !p
    ? "Load a statement first \u2014 receipts are filed by month."
    : ids.length
      ? `${unplaced.length} to place${undated ? `, ${undated} still need a date` : ""}.` +
        ` Tap one to file it.${elsewhere ? ` ${elsewhere} in other months.` : ""}`
      : elsewhere
        ? `Nothing in this month. ${elsewhere} receipt${elsewhere === 1 ? "" : "s"} in other months.`
        : "";

  $("thumbs").innerHTML = ids.map((r) => {
    const m = S.receipts[r];
    const done = placed.has(r);
    return `<div class="thumb ${done ? "placed" : ""}" data-rcpt="${r}">
      <img data-thumb="${r}" alt="Receipt">
      ${done ? `<span class="tick">\u2713</span>` : ""}
      <span class="lbl ${m.date ? "" : "nodate"}">${m.date ? shortDate(m.date) : "no date"}</span>
    </div>`;
  }).join("");
  hydrateThumbs($("thumbs"));
}

async function hydrateThumbs(root) {
  for (const img of root.querySelectorAll("img[data-thumb]")) {
    const u = await thumbURL(img.dataset.thumb);
    // A completed period may have had its photos released to free storage.
    // The record stays; the picture is in the export.
    if (u) img.src = u; else img.classList.add("gone");
  }
}

// ------------------------------------------------------- date-led matching

/**
 * Order the charges by how close they are to the receipt's date.
 *
 * Only ever the charges of the receipt's own period — this is what stops
 * months bleeding into each other. "Show all charges" widens the date
 * window, never the period.
 */
function candidates(rid) {
  const meta = S.receipts[rid];
  const p = homeOf(rid);
  if (!p) return [];
  const date = meta && meta.date;
  if (!date || assignWide)
    return p.lines.map((l) => ({ line: l, gap: date ? dayGap(date, l.date) : null }));
  return p.lines
    .map((l) => ({ line: l, gap: dayGap(date, l.date) }))
    // A charge posts on the day or a little after; it is rarely dated before.
    .filter((c) => c.gap >= -1 && c.gap <= 3)
    // Nearest first, and for an equal gap put "after" before "before" so the
    // day groups stay contiguous rather than interleaving.
    .sort((a, b) =>
      (Math.abs(a.gap) * 2 + (a.gap < 0 ? 1 : 0)) -
      (Math.abs(b.gap) * 2 + (b.gap < 0 ? 1 : 0)) ||
      a.line.amount - b.line.amount);
}

function openAssign(rid) {
  const home = homeOf(rid);
  if (home && home.done)
    return toast("That month is completed. Reopen it to change anything.", true);
  assigning = rid;
  assignWide = false;
  drawAssign();
  $("assignSheet").hidden = false;
}

function drawAssign() {
  const rid = assigning;
  const meta = S.receipts[rid];
  const home = homeOf(rid);
  const list = candidates(rid);

  $("assignTitle").textContent = meta.date
    ? `Receipt from ${shortDate(meta.date)}`
    : "Receipt with no date";
  $("assignSub").textContent = !home
    ? "No statement loaded for this receipt."
    : meta.date
      ? (assignWide
          ? `All charges in ${periodChip(home)}.`
          : `${list.length} charge${list.length === 1 ? "" : "s"} around that date in ${periodChip(home)}.`)
      : "Add a date to narrow this down.";
  $("assignWiden").hidden = assignWide || !meta.date;
  $("assignMove").hidden = S.periods.length < 2;

  if (!list.length) {
    $("assignList").innerHTML =
      `<p class="soft small" style="padding:16px 8px">No charges near that date in this month.
       It may be a cash expense, or it may belong to a different month.</p>`;
    return;
  }

  let html = "", lastGap = null;
  for (const { line, gap } of list) {
    if (!assignWide && gap !== lastGap) {
      lastGap = gap;
      const label = gap === 0 ? "Same day"
        : gap > 0 ? `${gap} day${gap === 1 ? "" : "s"} after the receipt`
        : `${-gap} day${gap === -1 ? "" : "s"} before`;
      html += `<div class="daygroup">${label}</div>`;
    }
    const taken = line.receipts.length;
    html += `<button class="opt ${gap === 0 ? "exact" : ""} ${taken ? "taken" : ""}"
      data-pick="${line.id}">
      <span class="date">${shortDate(line.date)}</span>
      <span class="desc">${esc(line.description)}${taken ? " \u2713" : ""}</span>
      <span class="amt">${money(line.amount)}</span></button>`;
  }
  $("assignList").innerHTML = html;
}

function closeAssign() {
  assigning = null;
  $("assignSheet").hidden = true;
}

// ----------------------------------------------------------- period picker

/** "switch" changes which period the tabs show; "move" re-homes the receipt
 *  currently being assigned, for a charge that posted into the next month. */
let pickMode = "switch";

function openPicker(mode) {
  pickMode = mode;
  const placed = placedSet();
  $("pickTitle").textContent = mode === "move" ? "Move receipt to" : "Statement period";
  $("pickList").innerHTML = [...S.periods].sort(byPeriodDesc).map((p) => {
    const open = p.lines.filter((l) => !l.receipts.length).length;
    const waiting = receiptsIn(p.id).filter((r) => !placed.has(r.id)).length;
    const total = p.lines.reduce((s, l) => s + l.amount, 0) +
                  p.cash.reduce((s, c) => s + (c.amount || 0), 0);
    const note = p.done
      ? `Completed ${shortDate(p.doneAt)}`
      : `${open} charge${open === 1 ? "" : "s"} without a receipt` +
        (waiting ? ` \u00b7 ${waiting} to file` : "");
    return `<button class="opt period ${p.done ? "taken" : ""}" data-goto="${p.id}">
      <span class="desc"><b>${periodLabel(p)}</b><small>${note}</small></span>
      <span class="amt">${money(total)}</span></button>`;
  }).join("") || `<p class="soft small" style="padding:16px 8px">No statements loaded.</p>`;
  $("pickSheet").hidden = false;
}

// ------------------------------------------------------------- photo input

let queue = [];   // receipts awaiting a date

async function addPhotos(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  toast(`Reading ${files.length} photo${files.length > 1 ? "s" : ""}\u2026`);
  for (const f of files) {
    try {
      const img = await prepare(f);
      const rid = uid("r_");
      await db.putImage(rid, { display: img.display, thumb: img.thumb });
      S.receipts[rid] = {
        id: rid, date: img.taken, name: img.name, w: img.width, h: img.height,
        periodId: periodFor(img.taken),
      };
      queue.push(rid);
    } catch (e) {
      toast(`Couldn't read ${f.name}`, true);
    }
  }
  await save();
  tab = "receipts";
  render();
  nextDate();
}

/** Shift an ISO date by n days. */
function shiftDate(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function drawChips(photoDate, chosen) {
  const box = $("dateChips");
  if (!photoDate) return (box.innerHTML = "");
  // Receipts get photographed later far more often than earlier, so the
  // steps go backwards from the day the picture was taken.
  box.innerHTML = [0, -1, -2, -3].map((n) => {
    const d = shiftDate(photoDate, n);
    const label = n === 0 ? "Photo day" : `${-n} day${n === -1 ? "" : "s"} earlier`;
    return `<button class="chip ${d === chosen ? "on" : ""}" data-day="${d}">
      ${label}<br><span style="font-size:11.5px">${shortDate(d)}</span></button>`;
  }).join("");
}

/** Confirm the date for each new photo, one at a time. */
async function nextDate() {
  if (!queue.length) { $("dateSheet").hidden = true; return; }
  const rid = queue[0];
  const meta = S.receipts[rid];
  const rec = await db.getImage(rid);
  $("dateImg").src = rec ? URL.createObjectURL(rec.display) : "";
  const value = meta.date || (P() ? P().periodEnd : "") || "";
  $("dateInput").value = value;
  $("dateTitle").textContent = queue.length > 1
    ? `Receipt date (${queue.length} left)` : "Receipt date";
  $("dateWhy").textContent = meta.date
    ? `Photo taken ${shortDate(meta.date)}. If the receipt is from an earlier day, pick it below.`
    : "This photo carries no date, so please set one.";
  drawChips(meta.date, value);
  drawDateHome(value);
  $("dateSheet").hidden = false;
}

/**
 * Say out loud which month this date files the receipt into. The date is the
 * only thing typed about a receipt, and it now decides the month as well as
 * the charge — so a mis-set date is caught here rather than three screens on.
 */
function drawDateHome(value) {
  const p = S.periods.find((x) => x.id === periodFor(value));
  const el = $("dateHome");
  el.textContent = !value ? ""
    : p ? `Files into ${periodLabel(p)}`
        : "No statement loaded for that date yet.";
  el.className = "soft small home" + (value && !p ? " warn" : "");
}

$("dateChips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-day]");
  if (!chip) return;
  $("dateInput").value = chip.dataset.day;
  drawChips(S.receipts[queue[0]] && S.receipts[queue[0]].date, chip.dataset.day);
  drawDateHome(chip.dataset.day);
});

$("dateInput").addEventListener("change", () => {
  drawChips(S.receipts[queue[0]] && S.receipts[queue[0]].date, $("dateInput").value);
  drawDateHome($("dateInput").value);
});

async function commitDate(value) {
  const rid = queue.shift();
  if (rid && S.receipts[rid]) {
    S.receipts[rid].date = value || null;
    S.receipts[rid].periodId = periodFor(value);
    await save();
  }
  const img = $("dateImg");
  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  render();
  nextDate();
}

// ------------------------------------------------------------------ events

document.addEventListener("click", async (e) => {
  const t = e.target;

  const tabBtn = t.closest(".tab");
  if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }

  if (t.closest("#addPeriod")) { openStmt(); return; }

  const pchip = t.closest("[data-period]");
  if (pchip) { S.activeId = pchip.dataset.period; await save(); render(); return; }

  const goto = t.closest("[data-goto]");
  if (goto) {
    const pid = goto.dataset.goto;
    $("pickSheet").hidden = true;
    if (pickMode === "move" && assigning) {
      detach(assigning);
      S.receipts[assigning].periodId = pid;
      await save();
      drawAssign(); render();
      toast(`Moved to ${periodChip(S.periods.find((x) => x.id === pid))}`);
    } else {
      S.activeId = pid;
      await save(); render();
    }
    return;
  }

  const detachBtn = t.closest("[data-detach]");
  if (detachBtn) {
    const p = P();
    if (p && p.done) return toast("That month is completed. Reopen it first.", true);
    detach(detachBtn.dataset.detach);
    await save(); render();
    toast("Sent back to Receipts");
    return;
  }

  const thumb = t.closest("[data-rcpt]");
  if (thumb) { openAssign(thumb.dataset.rcpt); return; }

  const pick = t.closest("[data-pick]");
  if (pick) {
    const home = homeOf(assigning);
    if (!home) return;
    detach(assigning);
    home.lines.find((l) => l.id === pick.dataset.pick).receipts.push(assigning);
    S.receipts[assigning].periodId = home.id;
    await save();
    closeAssign(); render();
    return;
  }

  const delCash = t.closest("[data-delcash]");
  if (delCash) {
    const p = P();
    if (p.done) return toast("That month is completed. Reopen it first.", true);
    p.cash = p.cash.filter((c) => c.id !== delCash.dataset.delcash);
    await save(); render();
    return;
  }

  if (t.closest("#exportBtn")) return runExport(false);
  if (t.closest("#completeBtn")) return runExport(true);
  if (t.closest("#reopenBtn")) {
    const p = P();
    p.done = false; p.doneAt = null;
    await save(); render();
    toast("Reopened");
    return;
  }
});

$("period").onclick = () => { if (S.periods.length) openPicker("switch"); };
$("assignClose").onclick = closeAssign;
$("assignWiden").onclick = () => { assignWide = true; drawAssign(); };
$("assignMove").onclick = () => openPicker("move");
$("pickClose").onclick = () => ($("pickSheet").hidden = true);

$("assignCash").onclick = async () => {
  const rid = assigning;
  const meta = S.receipts[rid];
  const home = homeOf(rid);
  if (!home) return toast("Load a statement first", true);
  detach(rid);
  meta.periodId = home.id;
  home.cash.push({
    id: uid("c_"), date: meta.date, description: "",
    amount: null, receipts: [rid],
  });
  home.cash.sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : 1));
  S.activeId = home.id;
  await save();
  closeAssign();
  tab = "cash"; render();
  const el = $("cash").querySelector('[data-f="description"]');
  if (el) el.focus();
};

$("dateOk").onclick = () => commitDate($("dateInput").value);
$("dateSkip").onclick = () => commitDate("");

$("camInput").onchange = (e) => { addPhotos(e.target.files); e.target.value = ""; };
$("fileInput").onchange = (e) => { addPhotos(e.target.files); e.target.value = ""; };

$("cash").addEventListener("change", async (e) => {
  const input = e.target.closest("[data-f]");
  if (!input) return;
  const p = P();
  if (!p || p.done) return;
  const c = p.cash.find((x) => x.id === input.closest("[data-cash]").dataset.cash);
  const f = input.dataset.f;
  if (f === "amount") {
    const v = parseFloat(input.value);
    c.amount = isFinite(v) ? Math.round(v * 100) / 100 : null;
  } else c[f] = input.value;
  await save(); render();
});

$("addCash").onclick = async () => {
  const p = P();
  if (!p) return toast("Load a statement first", true);
  p.cash.push({
    id: uid("c_"), date: p.periodEnd || "",
    description: "", amount: null, receipts: [],
  });
  await save(); render();
  const inputs = $("cash").querySelectorAll('[data-f="description"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
};

// --------------------------------------------------------------- statement

/**
 * Several exports can be picked at once. Each becomes its own period. An
 * export re-imported over one already held refreshes the charges and keeps
 * the receipts already attached, matched by Amex reference. A completed
 * period is never overwritten — it has to be reopened first.
 */
$("stmtInput").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  // A missing xlsx.full.min.js otherwise fails here with a bare
  // "XLSX is not defined", which says nothing about the real cause.
  if (typeof XLSX === "undefined") {
    toast("xlsx.full.min.js didn't load \u2014 check it uploaded", true);
    return;
  }

  let added = 0, updated = 0, failed = 0, last = null;
  for (const f of files) {
    try {
      const parsed = parseStatement(await f.arrayBuffer());
      const id = periodKey(parsed.periodStart, parsed.periodEnd);
      const existing = S.periods.find((p) => p.id === id);
      if (existing && existing.done) {
        failed++;
        toast(`${periodChip(existing)} is completed \u2014 skipped`, true);
        continue;
      }
      const prev = existing
        ? Object.fromEntries(existing.lines.map((l) => [l.id, l.receipts]))
        : {};
      const period = {
        id,
        card: parsed.card,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        source: f.name,
        check: parsed.check,
        credits: parsed.credits,
        lines: parsed.charges.map((c) => ({ ...c, receipts: prev[c.id] || [] })),
        cash: existing ? existing.cash : [],
        done: false,
        doneAt: null,
      };
      if (existing) {
        S.periods[S.periods.indexOf(existing)] = period;
        updated++;
      } else {
        S.periods.push(period);
        added++;
      }
      last = period;
    } catch (err) {
      failed++;
      toast(err instanceof StatementError
        ? `${f.name}: ${err.message}` : `Couldn't read ${f.name}`, true);
    }
  }

  if (!added && !updated) return;
  S.periods.sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  if (last) S.activeId = last.id;
  reseatReceipts();
  await save();
  tab = "charges"; render();

  const bits = [];
  if (added) bits.push(`${added} period${added === 1 ? "" : "s"} added`);
  if (updated) bits.push(`${updated} refreshed`);
  if (failed) bits.push(`${failed} skipped`);
  toast(bits.join(", "));
};

const openStmt = () => { $("menuSheet").hidden = true; $("stmtInput").click(); };
$("loadStmt").onclick = openStmt;
$("loadStmt2").onclick = openStmt;

// ------------------------------------------------------------------- menu

$("menuBtn").onclick = () => ($("menuSheet").hidden = false);
$("menuClose").onclick = () => ($("menuSheet").hidden = true);

// ---------------------------------------------------------------- install

// Chrome fires this only when every installability criterion passes. Holding
// on to it lets us offer a real Install button rather than leaving the person
// to hunt through the browser menu, where the entry is only ever a shortcut.
let installPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("installBtn").hidden = false;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("installBtn").hidden = true;
  toast("Installed");
});

$("installBtn").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === "accepted") $("installBtn").hidden = true;
  installPrompt = null;
};

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

/** Report exactly which installability requirement is failing. */
$("diagBtn").onclick = async () => {
  const out = $("diagOut");
  out.hidden = false;
  out.textContent = "Checking\u2026";
  const lines = [];
  const tick = (ok, label) => lines.push(`${ok ? "\u2713" : "\u2717"} ${label}`);

  tick(location.protocol === "https:" || location.hostname === "localhost",
       `Secure origin (${location.protocol}//${location.hostname})`);

  try {
    const href = document.querySelector("link[rel=manifest]").getAttribute("href");
    const url = new URL(href, location.href).href;
    const res = await fetch(url);
    const manifest = await res.json();
    tick(res.ok, "Manifest loads");
    const scope = new URL(manifest.scope || "./", url).href;
    const start = new URL(manifest.start_url || "./", url).href;
    tick(start.startsWith(scope), "start_url inside scope");
    tick(location.href.startsWith(scope), "This page inside scope");
    tick(["standalone", "fullscreen", "minimal-ui"].includes(manifest.display),
         `display: ${manifest.display}`);
    const sizes = (manifest.icons || []).map((i) => i.sizes);
    tick(sizes.includes("192x192") && sizes.includes("512x512"),
         `Icons declared: ${sizes.join(", ") || "none"}`);
    for (const i of manifest.icons || []) {
      const r = await fetch(new URL(i.src, url).href).catch(() => null);
      if (!r || !r.ok) tick(false, `Icon missing: ${i.src}`);
    }
  } catch (err) {
    tick(false, "Manifest: " + err.message);
  }

  const regs = await navigator.serviceWorker.getRegistrations();
  tick(regs.length > 0, `Service worker registered (${regs.length})`);
  tick(!!navigator.serviceWorker.controller, "Service worker controlling page");

  tick(!!installPrompt || standalone(),
       standalone() ? "Already installed"
                    : installPrompt ? "Chrome offered the install prompt"
                                    : "Chrome has NOT offered install yet");

  if (!installPrompt && !standalone())
    lines.push("", "If everything above is ticked, reload once more \u2014",
               "Chrome sometimes needs a second visit before offering.");

  out.textContent = lines.join("\n");
};

$("storageBtn").onclick = async () => {
  const u = await db.usage();
  const held = Object.values(S.receipts).filter((r) => !r.released).length;
  $("storageInfo").textContent = (u
    ? `${u.usedMB.toFixed(1)} MB used of about ${Math.round(u.quotaMB)} MB available. `
    : "Storage size isn't reported on this browser. ") +
    `${S.periods.length} period${S.periods.length === 1 ? "" : "s"} held, ` +
    `${held} photo${held === 1 ? "" : "s"}.`;
};

/**
 * Free the photos of completed periods. The rows, the amounts and which
 * receipt sat against which charge all survive — only the pictures go, and
 * those are in the export. This is what makes a rolling record of months
 * survivable against the phone's quota.
 */
$("releaseBtn").onclick = async () => {
  const done = S.periods.filter((p) => p.done).map((p) => p.id);
  const ids = Object.values(S.receipts)
    .filter((r) => done.includes(r.periodId) && !r.released)
    .map((r) => r.id);
  if (!ids.length) return toast("Nothing to release", true);
  if (!confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"} from completed months? ` +
               `The exports keep them. This can't be undone.`)) return;
  for (const rid of ids) {
    await db.delImage(rid);
    S.receipts[rid].released = true;
    const u = urls.get(rid);
    if (u) { URL.revokeObjectURL(u); urls.delete(rid); }
  }
  await save(); render();
  toast(`Freed ${ids.length} photo${ids.length === 1 ? "" : "s"}`);
};

/** Remove one period and the receipts only it was holding. */
$("delPeriodBtn").onclick = async () => {
  const p = P();
  if (!p) return toast("No period to delete", true);
  if (!confirm(`Delete ${periodLabel(p)} and its receipts? Export first \u2014 the export is the record.`))
    return;
  const ids = Object.values(S.receipts).filter((r) => r.periodId === p.id).map((r) => r.id);
  for (const rid of ids) {
    await db.delImage(rid);
    delete S.receipts[rid];
    const u = urls.get(rid);
    if (u) { URL.revokeObjectURL(u); urls.delete(rid); }
  }
  S.periods = S.periods.filter((x) => x.id !== p.id);
  S.activeId = S.periods.length ? [...S.periods].sort(byPeriodDesc)[0].id : null;
  await save();
  $("menuSheet").hidden = true;
  tab = "charges"; render();
};

$("resetBtn").onclick = async () => {
  if (!confirm("Clear every period and every receipt? Export first \u2014 the export is the record."))
    return;
  urls.forEach(URL.revokeObjectURL);
  urls.clear();
  await db.clearImages();
  S = structuredClone(EMPTY);
  await save();
  $("menuSheet").hidden = true;
  tab = "charges"; render();
};

document.querySelectorAll(".sheet").forEach((sh) =>
  sh.addEventListener("click", (e) => {
    // tapping the dim area closes, except the date prompt which must be answered
    if (e.target === sh && sh.id !== "dateSheet") sh.hidden = true;
  }));

$("lightbox").onclick = () => ($("lightbox").hidden = true);

// ----------------------------------------------------------------- export

async function runExport(complete) {
  const p = P();
  if (!p) return;

  const blanks = p.cash.filter((c) => c.amount === null).length;
  if (blanks && !confirm(`${blanks} cash expense${blanks > 1 ? "s have" : " has"} no amount. Export anyway?`))
    return;
  if (complete) {
    const open = p.lines.filter((l) => !l.receipts.length).length;
    if (!confirm(`Complete ${periodLabel(p)}?` +
        (open ? ` ${open} charge${open === 1 ? "" : "s"} still have no receipt.` : "") +
        " It locks against further edits, and the export downloads now.")) return;
  }

  toast("Building\u2026");
  const { blob, name } = await buildExport(p, S.receipts);
  const file = new File([blob], name, { type: "text/html" });

  let shared = false;
  // Share sheet puts it straight into OneDrive or an email; the download is
  // the fallback for browsers without file sharing.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      shared = true;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  if (!shared) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB)`);
  }

  if (complete) {
    p.done = true;
    p.doneAt = new Date().toISOString().slice(0, 10);
    await save(); render();
    toast(`${periodChip(p)} completed`);
  }
}

// ------------------------------------------------------------------- boot

/** v6 held one statement. Fold it into the new shape rather than losing it. */
function migrate(old) {
  if (!old) return structuredClone(EMPTY);
  if (Array.isArray(old.periods)) return { ...structuredClone(EMPTY), ...old };
  const next = structuredClone(EMPTY);
  next.receipts = old.receipts || {};
  if (old.statement && old.statement.periodStart) {
    const s = old.statement;
    const p = {
      id: periodKey(s.periodStart, s.periodEnd),
      card: s.card, periodStart: s.periodStart, periodEnd: s.periodEnd,
      source: s.source, check: s.check, credits: s.credits || [],
      lines: old.lines || [], cash: old.cash || [],
      done: false, doneAt: null,
    };
    next.periods = [p];
    next.activeId = p.id;
    for (const r of Object.values(next.receipts)) r.periodId = p.id;
  }
  return next;
}

(async () => {
  S = migrate(await db.getState());
  if (!S.activeId && S.periods.length)
    S.activeId = [...S.periods].sort(byPeriodDesc)[0].id;
  db.persist();
  render();
  await save();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();

// exposed for the smoke test
window.__app = {
  get state() { return S; },
  set state(v) { S = v; render(); },
  candidates, render, periodFor, migrate, periodKey,
};
