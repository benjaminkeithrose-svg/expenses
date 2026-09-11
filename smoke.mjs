// Headless smoke test: boots the real app.js against jsdom + a fake
// IndexedDB, then drives the multi-period flows that the v7 change is for.
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";
import fs from "fs";

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, { url: "https://example.com/", pretendToBeVisual: true });

global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.location = dom.window.location;
global.Blob = dom.window.Blob;
global.File = dom.window.File;
global.FileReader = dom.window.FileReader;
global.structuredClone = structuredClone;
dom.window.indexedDB = global.indexedDB;
dom.window.IDBKeyRange = global.IDBKeyRange;
dom.window.URL.createObjectURL = () => "blob:fake";
dom.window.URL.revokeObjectURL = () => {};
global.URL = dom.window.URL;
global.confirm = () => true;
global.XLSX = {};
dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
Object.defineProperty(dom.window.navigator, "serviceWorker", {
  value: { register: async () => {}, getRegistrations: async () => [] },
});

await import("./app.js");
await new Promise((r) => setTimeout(r, 60));

const app = dom.window.__app;
const $ = (id) => document.getElementById(id);
let fails = 0;
const ok = (cond, label) => {
  if (!cond) fails++;
  console.log(`${cond ? "\u2713" : "\u2717"} ${label}`);
};

// ---------------------------------------------------------------- fixtures

const line = (id, date, amount, desc) =>
  ({ id, date, description: desc, amount, city: "", receipts: [] });

const period = (start, end, lines) => ({
  id: `p_${start}_${end}`,
  card: "Test Card", periodStart: start, periodEnd: end,
  source: "test.xlsx", check: { ok: true, parsed: 0, stated: 0 }, credits: [],
  lines, cash: [], done: false, doneAt: null,
});

const aug = period("2026-08-04", "2026-09-03", [
  line("A1", "2026-08-10", 42.00, "CAFE ALPHA"),
  line("A2", "2026-09-02", 18.50, "TAXI BETA"),
]);
const sep = period("2026-09-04", "2026-10-03", [
  line("S1", "2026-09-06", 90.00, "HOTEL GAMMA"),
  line("S2", "2026-09-08", 12.00, "CAFE ALPHA"),
]);

app.state = {
  v: 7,
  periods: [aug, sep],
  activeId: sep.id,
  receipts: {
    r1: { id: "r1", date: "2026-08-10", periodId: null },   // clearly August
    r2: { id: "r2", date: "2026-09-06", periodId: null },   // clearly September
    r3: { id: "r3", date: "2026-09-02", periodId: null },   // last day of August period
  },
};

// -------------------------------------------------------------------- tests

console.log("\n-- period assignment by date --");
ok(app.periodFor("2026-08-10") === aug.id, "a mid-August date files into the August period");
ok(app.periodFor("2026-09-06") === sep.id, "a September date files into the September period");
ok(app.periodFor("2026-09-02") === aug.id, "2 Sep still belongs to the Aug 4 \u2013 Sep 3 period");
ok(app.periodFor("2026-07-01") === aug.id, "a date before every period falls to the nearest one");
ok(app.periodFor("2027-01-01") === sep.id, "a date after every period falls to the nearest one");
ok(app.periodFor(null) === null, "an undated receipt gets no period");

console.log("\n-- receipts are seated, then stay in their own month --");
app.render();
const S = app.state;
ok(S.receipts.r1.periodId === aug.id, "r1 seated into August");
ok(S.receipts.r3.periodId === aug.id, "r3 (2 Sep) seated into August, not September");
ok(S.receipts.r2.periodId === sep.id, "r2 seated into September");

console.log("\n-- candidates never cross a period boundary --");
const c1 = app.candidates("r1").map((c) => c.line.id);
ok(c1.length > 0 && c1.every((id) => id.startsWith("A")),
   `an August receipt is only offered August charges (${c1.join(", ")})`);
const c2 = app.candidates("r2").map((c) => c.line.id);
ok(c2.length > 0 && c2.every((id) => id.startsWith("S")),
   `a September receipt is only offered September charges (${c2.join(", ")})`);
ok(c1.includes("A1"), "the same-day August charge is among the candidates");
ok(!c1.includes("S2"), "the identically-named September merchant is NOT offered");

console.log("\n-- the active period drives the charges tab --");
ok($("lines").querySelectorAll("[data-line]").length === 2, "September's two charges render");
ok([...$("lines").querySelectorAll("[data-line]")].every((r) => r.dataset.line.startsWith("S")),
   "and only September's");
S.activeId = aug.id;
app.render();
ok([...$("lines").querySelectorAll("[data-line]")].every((r) => r.dataset.line.startsWith("A")),
   "switching the period switches the rows");

console.log("\n-- tallies are per period, never combined --");
ok($("tallies").textContent.includes("$60.50"),
   "August totals $60.50 on its own (not $162.50 across both)");
S.activeId = sep.id;
app.render();
ok($("tallies").textContent.includes("$102.00"), "September totals $102.00 on its own");

console.log("\n-- the running record renders one chip per month --");
ok($("periods").querySelectorAll("[data-period]").length === 2, "two period chips");
ok($("periods").textContent.includes("Sep 26") && $("periods").textContent.includes("Oct 26"),
   "labelled by closing month");
ok($("periods").querySelector(".pchip.on").dataset.period === sep.id, "the active one is marked");

console.log("\n-- receipts tab is scoped to the active month --");
app.render();
ok($("thumbs").querySelectorAll("[data-rcpt]").length === 1,
   "September shows only its own receipt");
ok($("rcptHint").textContent.includes("2 in other months"),
   "and says how many sit in other months");

console.log("\n-- completing a period locks it --");
sep.done = true;
sep.doneAt = "2026-10-05";
app.render();
ok($("footbar").querySelector("#reopenBtn") !== null, "a completed period offers Reopen");
ok($("footbar").querySelector("#completeBtn") === null, "and no longer offers Complete");
ok(document.body.classList.contains("locked"), "the body is marked locked");
ok($("periods").querySelector(".pchip.done") !== null, "its chip shows as done");
sep.done = false;
app.render();
ok($("footbar").querySelector("#completeBtn") !== null, "reopening restores Complete & export");

console.log("\n-- v6 state migrates rather than being lost --");
const old = {
  statement: { card: "Old", periodStart: "2026-08-04", periodEnd: "2026-09-03",
               source: "old.xlsx", check: null, credits: [] },
  lines: [line("A1", "2026-08-10", 42.00, "CAFE ALPHA")],
  cash: [{ id: "c1", date: "2026-08-11", description: "Parking", amount: 6, receipts: ["r9"] }],
  receipts: { r9: { id: "r9", date: "2026-08-11" } },
};
const m = app.migrate(old);
ok(m.periods.length === 1, "the single v6 statement becomes one period");
ok(m.periods[0].id === app.periodKey("2026-08-04", "2026-09-03"), "with the stable period id");
ok(m.periods[0].lines.length === 1 && m.periods[0].cash.length === 1, "lines and cash carried over");
ok(m.receipts.r9.periodId === m.periods[0].id, "existing receipts are homed to it");
ok(m.activeId === m.periods[0].id, "and it becomes the active period");
ok(app.migrate(null).periods.length === 0, "a cold start migrates to empty");

console.log("\n-- export covers one period only --");
const { buildExport } = await import("./export.js");
app.state = { v: 7, periods: [aug, sep], activeId: aug.id,
  receipts: { r1: { id: "r1", date: "2026-08-10", periodId: aug.id },
              r2: { id: "r2", date: "2026-09-06", periodId: sep.id } } };
aug.lines[0].receipts = ["r1"];
const out = await buildExport(aug, app.state.receipts);
const text = out.blob ? await out.blob.text() : "";
ok(out.name === "expenses-2026-08-04-to-2026-09-03.html", `filename names the period: ${out.name}`);
ok(text.includes("CAFE ALPHA") && text.includes("TAXI BETA"), "August charges are in the document");
ok(!text.includes("HOTEL GAMMA"), "September's charges are NOT");
ok(!text.includes("unmatched"), "September's loose receipt does not wash up as an orphan here");
ok(text.includes("$60.50"), "the total is August's alone");

console.log(fails ? `\n${fails} FAILED` : "\nAll passed");
process.exit(fails ? 1 : 0);
