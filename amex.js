// Amex activity export parser. Ported from the Python version; every quirk
// handled here is something the real export actually does. See README.

export const PERIOD_RE =
  /(\w{3}\s+\d{1,2},\s*\d{4})\s+to\s+(\w{3}\s+\d{1,2},\s*\d{4})/i;

const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                 jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

export class StatementError extends Error {}

const clean = (v) =>
  v === null || v === undefined ? "" : String(v).replace(/\n/g, " ").trim();

const squash = (v) => clean(v).replace(/\s{2,}/g, " ");

const iso = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/* Amounts are numbers in xlsx but can carry $, commas, CR or brackets in csv. */
function parseAmount(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  let s = clean(v).replace(/[$,]/g, "");
  if (!s) return null;
  let neg = false;
  if (/cr$/i.test(s)) { neg = true; s = s.slice(0, -2).trim(); }
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

/* Australian exports are DD/MM/YYYY. Never guess: 04/08/2026 is 4 August,
   and month-first turns it into 8 April. */
function parseDate(v) {
  if (v instanceof Date && !isNaN(v))
    return iso(v.getFullYear(), v.getMonth(), v.getDate());
  const s = clean(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    if (mo > 12) [d, mo] = [mo, d];        // unambiguously the other way round
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return iso(y, mo - 1, d);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined)
    return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

function parsePeriod(rows) {
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    for (let j = 0; j < Math.min(4, (rows[i] || []).length); j++) {
      const m = PERIOD_RE.exec(clean(rows[i][j]));
      if (!m) continue;
      const one = (t) => {
        const p = t.replace(/,/g, "").split(/\s+/);
        const mo = MONTHS[p[0].slice(0, 3).toLowerCase()];
        return mo === undefined ? null : iso(+p[2], mo, +p[1]);
      };
      const a = one(m[1]), b = one(m[2]);
      if (a && b) return [a, b];
    }
  }
  return [null, null];
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(40, rows.length); i++)
    if (clean((rows[i] || [])[0]).toLowerCase() === "date") return i;
  throw new StatementError(
    "Couldn't find the transaction header. Expected a row starting with " +
    "'Date'. Is this an Amex activity export?"
  );
}

/* A tiny stable hash, only used when a row has no Reference of its own. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "H" + h.toString(16).padStart(8, "0");
}

/* Read the summary sheet's charges figure — a checksum for our parse. */
function statedTotal(wb) {
  const name = wb.SheetNames.find((n) => /summary/i.test(n));
  if (!name) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name],
    { header: 1, raw: true, defval: "" });
  for (const r of rows) {
    if (/charges/i.test(clean(r[0]))) {
      const a = parseAmount(r[1]);
      if (a !== null) return a;
    }
  }
  return null;
}

/**
 * @param {ArrayBuffer} buf  the .xlsx / .csv file
 * @returns {{card, periodStart, periodEnd, charges, credits, total, check, skipped}}
 */
export function parseStatement(buf) {
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false });
  const detail = wb.SheetNames.find((n) => /detail/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[detail],
    { header: 1, raw: false, defval: "", blankrows: true, dateNF: "dd/mm/yyyy" });

  if (!rows.length) throw new StatementError("That file has no rows in it.");

  const h = findHeader(rows);
  const cols = (rows[h] || []).map(squash);
  const idx = (...names) => {
    for (const n of names) {
      const i = cols.findIndex((c) => c.toLowerCase() === n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const cDate = idx("Date");
  const cProc = idx("Date Processed", "Date Posted");
  const cDesc = idx("Description", "Appears On Your Statement As");
  const cAmt  = idx("Amount");
  const cRef  = idx("Reference");
  const cCity = idx("Town/City", "City");

  if (cDate < 0 || cDesc < 0 || cAmt < 0)
    throw new StatementError(
      "Missing an expected column. Found: " + cols.filter(Boolean).join(", "));

  const charges = [], credits = [], seen = new Set();
  let skipped = 0;

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const date = parseDate(r[cDate]);
    const amount = parseAmount(r[cAmt]);
    const description = squash(r[cDesc]);
    if (date === null || amount === null || !description) { skipped++; continue; }

    // Reference is unique per transaction and stable across exports, so it is
    // the key that lets a re-import keep the receipts already attached. It also
    // separates two identical charges on the same day for the same amount.
    let id = cRef >= 0 ? clean(r[cRef]) : "";
    if (!id || seen.has(id)) id = hash(`${date}|${description}|${amount}|${i}`);
    seen.add(id);

    const row = {
      id, date, description, amount: Math.round(amount * 100) / 100,
      dateProcessed: cProc >= 0 ? parseDate(r[cProc]) : null,
      city: cCity >= 0 ? squash(r[cCity]) : "",
    };
    (amount > 0 ? charges : credits).push(row);
  }

  if (!charges.length && !credits.length)
    throw new StatementError("No transactions found below the header row.");

  const bydate = (a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 :
    a.description < b.description ? -1 : 1;
  charges.sort(bydate);
  credits.sort(bydate);

  let [periodStart, periodEnd] = parsePeriod(rows);
  if (!periodStart) {
    const all = [...charges, ...credits].map((c) => c.date).sort();
    periodStart = all[0];
    periodEnd = all[all.length - 1];
  }

  const total = Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  const stated = statedTotal(wb);
  const check = stated === null ? null : {
    stated: Math.round(stated * 100) / 100,
    parsed: total,
    ok: Math.abs(stated - total) < 0.01,
  };

  const title = clean((rows[0] || [])[1]);
  return {
    card: title.split("/")[0].trim() || "American Express",
    periodStart, periodEnd, charges, credits, total, check, skipped,
  };
}
