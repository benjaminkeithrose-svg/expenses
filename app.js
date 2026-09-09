import { parseStatement, StatementError } from "./amex.js";
import { prepare } from "./images.js";
import * as db from "./store.js";
import { buildExport, shortDate, money } from "./export.js";

const $ = (id) => document.getElementById(id);
const EMPTY = { statement: null, lines: [], cash: [], receipts: {} };

let S = structuredClone(EMPTY);
let tab = "charges";
let assigning = null;    // receipt id currently being placed
let assignWide = false;  // show every charge rather than the nearby ones
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

function placedSet() {
  const s = new Set();
  for (const l of S.lines) l.receipts.forEach((r) => s.add(r));
  for (const c of S.cash) c.receipts.forEach((r) => s.add(r));
  return s;
}

function detach(rid) {
  for (const l of S.lines) l.receipts = l.receipts.filter((r) => r !== rid);
  for (const c of S.cash) c.receipts = c.receipts.filter((r) => r !== rid);
}

// ----------------------------------------------------------------- render

function render() {
  const stmt = S.statement;
  const amex = S.lines.reduce((s, l) => s + l.amount, 0);
  const cash = S.cash.reduce((s, c) => s + (c.amount || 0), 0);
  const withR = S.lines.filter((l) => l.receipts.length).length;
  const placed = placedSet();
  const unplaced = Object.keys(S.receipts).filter((r) => !placed.has(r));
  const undated = Object.values(S.receipts).filter((r) => !r.date).length;

  $("period").textContent = stmt
    ? `${shortDate(stmt.periodStart)} \u2013 ${shortDate(stmt.periodEnd)} ${stmt.periodEnd.slice(0, 4)}`
    : "No statement";
  $("card").textContent = stmt ? stmt.card : "Load your Amex file to start.";
  $("exportBtn").disabled = !stmt;

  $("tallies").innerHTML = stmt ? `
    <div class="tally"><span>Card</span><b>${money(amex)}</b></div>
    <div class="tally"><span>Cash</span><b>${money(cash)}</b></div>
    <div class="tally"><span>Total</span><b>${money(amex + cash)}</b></div>
    <div class="tally ${withR === S.lines.length ? "done" : "todo"}">
      <span>Receipts</span><b>${withR}/${S.lines.length}</b></div>` : "";

  const b = $("banner");
  if (stmt?.check && !stmt.check.ok) {
    b.hidden = false; b.className = "banner";
    b.textContent = `Parsed ${money(stmt.check.parsed)} but the statement summary says ` +
      `${money(stmt.check.stated)}. Check the file before exporting.`;
  } else if (stmt?.check) {
    b.hidden = false; b.className = "banner good";
    b.textContent = `${S.lines.length} charges, ${money(amex)} \u2014 matches the statement summary.`;
  } else b.hidden = true;

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("on", t.dataset.tab === tab);
    if (t.dataset.tab === "receipts")
      t.innerHTML = unplaced.length
        ? `Receipts <span class="dot">${unplaced.length}</span>` : "Receipts";
  });
  ["charges", "receipts", "cash"].forEach((v) =>
    ($("view-" + v).hidden = v !== tab));

  renderLines();
  renderCash();
  renderThumbs(unplaced, undated);
}

function renderLines() {
  $("chargesEmpty").hidden = !!S.statement;
  const box = $("lines");
  box.hidden = !S.statement;
  if (!S.statement) return (box.innerHTML = "");
  box.innerHTML = S.lines.map((l) => `
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

function renderCash() {
  $("cashEmpty").hidden = S.cash.length > 0;
  $("cash").innerHTML = S.cash.map((c) => `
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

function renderThumbs(unplaced, undated) {
  const ids = Object.keys(S.receipts).sort((a, b) =>
    (S.receipts[a].date || "9999") < (S.receipts[b].date || "9999") ? -1 : 1);
  $("receiptsEmpty").hidden = ids.length > 0;
  $("rcptHint").textContent = ids.length
    ? `${unplaced.length} to place${undated ? `, ${undated} still need a date` : ""}. Tap one to file it.`
    : "";
  const placed = placedSet();
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
    if (u) img.src = u;
  }
}

// -------------------------------------------------------- date-led matching

/**
 * Order the charges by how close they are to the receipt's date.
 *
 * This is what makes the workflow quick: the amounts on a receipt don't have
 * to be read at all, because a receipt dated the 20th almost always belongs
 * to a charge dated the 20th. Same-day charges come first, then a day either
 * side, and so on.
 */
function candidates(rid) {
  const date = S.receipts[rid]?.date;
  if (!date || assignWide)
    return S.lines.map((l) => ({ line: l, gap: date ? dayGap(date, l.date) : null }));
  return S.lines
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
  assigning = rid;
  assignWide = false;
  drawAssign();
  $("assignSheet").hidden = false;
}

function drawAssign() {
  const rid = assigning;
  const meta = S.receipts[rid];
  const list = candidates(rid);
  const placed = placedSet();

  $("assignTitle").textContent = meta.date
    ? `Receipt from ${shortDate(meta.date)}`
    : "Receipt with no date";
  $("assignSub").textContent = meta.date
    ? (assignWide ? "All charges in the period."
                  : `${list.length} charge${list.length === 1 ? "" : "s"} around that date.`)
    : "Add a date to narrow this down.";
  $("assignWiden").hidden = assignWide || !meta.date;

  if (!list.length) {
    $("assignList").innerHTML =
      `<p class="soft small" style="padding:16px 8px">No charges near that date.
       It may be a cash expense, or try showing all charges.</p>`;
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

// ------------------------------------------------------------- photo input

let queue = [];   // receipts awaiting a date

async function addPhotos(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  toast(`Reading ${files.length} photo${files.length > 1 ? "s" : ""}\u2026`);
  for (const f of files) {
    try {
      const p = await prepare(f);
      const rid = uid("r_");
      await db.putImage(rid, { display: p.display, thumb: p.thumb });
      S.receipts[rid] = { id: rid, date: p.taken, name: p.name, w: p.width, h: p.height };
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
  const value = meta.date || S.statement?.periodEnd || "";
  $("dateInput").value = value;
  $("dateTitle").textContent = queue.length > 1
    ? `Receipt date (${queue.length} left)` : "Receipt date";
  $("dateWhy").textContent = meta.date
    ? `Photo taken ${shortDate(meta.date)}. If the receipt is from an earlier day, pick it below.`
    : "This photo carries no date, so please set one.";
  drawChips(meta.date, value);
  $("dateSheet").hidden = false;
}

$("dateChips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-day]");
  if (!chip) return;
  $("dateInput").value = chip.dataset.day;
  drawChips(S.receipts[queue[0]]?.date, chip.dataset.day);
});

$("dateInput").addEventListener("change", () =>
  drawChips(S.receipts[queue[0]]?.date, $("dateInput").value));

async function commitDate(value) {
  const rid = queue.shift();
  if (rid && S.receipts[rid]) {
    S.receipts[rid].date = value || null;
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

  const detachBtn = t.closest("[data-detach]");
  if (detachBtn) {
    detach(detachBtn.dataset.detach);
    await save(); render();
    toast("Sent back to Receipts");
    return;
  }

  const thumb = t.closest("[data-rcpt]");
  if (thumb) { openAssign(thumb.dataset.rcpt); return; }

  const pick = t.closest("[data-pick]");
  if (pick) {
    detach(assigning);
    S.lines.find((l) => l.id === pick.dataset.pick).receipts.push(assigning);
    await save();
    closeAssign(); render();
    return;
  }

  const delCash = t.closest("[data-delcash]");
  if (delCash) {
    S.cash = S.cash.filter((c) => c.id !== delCash.dataset.delcash);
    await save(); render();
    return;
  }
});

$("assignClose").onclick = closeAssign;
$("assignWiden").onclick = () => { assignWide = true; drawAssign(); };
$("assignCash").onclick = async () => {
  const rid = assigning;
  detach(rid);
  S.cash.push({
    id: uid("c_"), date: S.receipts[rid].date, description: "",
    amount: null, receipts: [rid],
  });
  S.cash.sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1);
  await save();
  closeAssign();
  tab = "cash"; render();
  $("cash").querySelector('[data-f="description"]')?.focus();
};

$("dateOk").onclick = () => commitDate($("dateInput").value);
$("dateSkip").onclick = () => commitDate("");

$("camInput").onchange = (e) => { addPhotos(e.target.files); e.target.value = ""; };
$("fileInput").onchange = (e) => { addPhotos(e.target.files); e.target.value = ""; };

$("cash").addEventListener("change", async (e) => {
  const input = e.target.closest("[data-f]");
  if (!input) return;
  const c = S.cash.find((x) => x.id === input.closest("[data-cash]").dataset.cash);
  const f = input.dataset.f;
  if (f === "amount") {
    const v = parseFloat(input.value);
    c.amount = isFinite(v) ? Math.round(v * 100) / 100 : null;
  } else c[f] = input.value;
  await save(); render();
});

$("addCash").onclick = async () => {
  S.cash.push({
    id: uid("c_"), date: S.statement?.periodEnd || "",
    description: "", amount: null, receipts: [],
  });
  await save(); render();
  const inputs = $("cash").querySelectorAll('[data-f="description"]');
  inputs[inputs.length - 1]?.focus();
};

// ---------------------------------------------------------------- statement

$("stmtInput").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const parsed = parseStatement(await f.arrayBuffer());
    // Re-importing must not lose work: receipts already attached are carried
    // across by transaction reference.
    const prev = Object.fromEntries(S.lines.map((l) => [l.id, l.receipts]));
    S.statement = {
      card: parsed.card, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd,
      source: f.name, check: parsed.check, credits: parsed.credits,
    };
    S.lines = parsed.charges.map((c) => ({ ...c, receipts: prev[c.id] || [] }));
    await save();
    tab = "charges"; render();
    toast(`${parsed.charges.length} charges loaded`);
  } catch (err) {
    toast(err instanceof StatementError ? err.message : "Couldn't read that file", true);
  }
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

  let manifest = null;
  try {
    const href = document.querySelector("link[rel=manifest]").getAttribute("href");
    const url = new URL(href, location.href).href;
    const res = await fetch(url);
    manifest = await res.json();
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
  } catch (e) {
    tick(false, "Manifest: " + e.message);
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
  $("storageInfo").textContent = u
    ? `${u.usedMB.toFixed(1)} MB used of about ${Math.round(u.quotaMB)} MB available.`
    : "Storage size isn't reported on this browser.";
};
$("resetBtn").onclick = async () => {
  if (!confirm("Clear this month? Export first — the export is the record.")) return;
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

$("exportBtn").onclick = async () => {
  const blanks = S.cash.filter((c) => c.amount === null).length;
  if (blanks && !confirm(`${blanks} cash expense${blanks > 1 ? "s have" : " has"} no amount. Export anyway?`))
    return;
  toast("Building\u2026");
  const { blob, name } = await buildExport(S);
  const file = new File([blob], name, { type: "text/html" });

  // Share sheet puts it straight into OneDrive or an email; the download is
  // the fallback for browsers without file sharing.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB)`);
};

// ------------------------------------------------------------------- boot

(async () => {
  S = (await db.getState()) || structuredClone(EMPTY);
  db.persist();
  render();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();

// exposed for the smoke test
window.__app = {
  get state() { return S; },
  set state(v) { S = v; render(); },
  candidates, render,
};
