// Turns an Amex statement into a keying sheet for Oracle EBS iExpenses.
//
// The EBS grid takes ten lines a page: Date, Receipt Amount, Expense Type,
// Justification. This lays the claim out in blocks of ten to match, guesses
// the type from the merchant and the travel zone from the town, and lets you
// copy each cell straight into the grid.
//
// Nothing here is authoritative. Every guess is a starting point you correct,
// and corrections are remembered so the same merchant is right next month.

import { parseStatement, StatementError } from "./amex.js";

/* ------------------------------------------------------------------ types */

// The Laitram dropdown, in its own order. Confirmed complete — 29 values.
// These strings must match EBS exactly or the pasted value won't select.
export const TYPES = [
  "Airfare & related expenses",
  "Amex offset (negative statement balance)",
  "Bank charge",
  "Books & Subscriptions",
  "Business entertainment & Gifts",
  "Business meals (Off-Site) with 3rd party",
  "Business meals (On-Site) with 3rd party",
  "Car rental & related expenses",
  "Education expenses",
  "Employee services & events",
  "Equipment maintenance",
  "Fixed assets (AUD100+ & 1YR+)",
  "Hotel & related expenses",
  "Internet expenses",
  "Kitchen & Meeting room supply (Non-food)",
  "Kitchen supply (milk,snacks,coffee,etc.)",
  "Meals(Off-Site - travel,recruiting,etc.)",
  "Meals(On-Site - meeting,OT,etc.)",
  "Medical exams",
  "Mobile phone expenses",
  "Office supplies",
  "Permits & Licenses",
  "Postage",
  "Small tools",
  "Telephone expenses (home/office)",
  "Test materials",
  "Transport (train,taxi,parking,toll,etc.)",
  "Uncategorized/All other expenses",
  "Uniforms",
];

export const UNCAT = "Uncategorized/All other expenses";
const MEALS_SOLO = "Meals(Off-Site - travel,recruiting,etc.)";
export const MEALS_3P = "Business meals (Off-Site) with 3rd party";

// Which types are a meal, so the "customer present" toggle knows when to show.
export const MEAL_TYPES = new Set([
  MEALS_SOLO, MEALS_3P,
  "Meals(On-Site - meeting,OT,etc.)",
  "Business meals (On-Site) with 3rd party",
]);

/* Merchant patterns, first match wins. Specific sits above general, so
   BP CONNECT hits fuel before anything merely containing "connect".

   Fuel maps to Car rental & related — there is no fuel or vehicle type in
   the dropdown, and the car sits under the rental bucket. */
const RULES = [
  // Fuel
  [/\b(BP|CALTEX|AMPOL|SHELL|COLES EXPRESS|WOOLWORTHS PETROL|7[- ]?ELEVEN|SEVEN ELEVEN|UNITED PETROLEUM|LIBERTY FUEL|METRO PETROL|MOBIL|PUMA ENERGY|VIVA ENERGY|FREEDOM FUELS|BUDGET PETROL|APCO|OTR)\b/i,
    "Car rental & related expenses"],
  [/\b(FUEL|PETROL|SERVICE STATION|ROADHOUSE|TRUCKSTOP)\b/i,
    "Car rental & related expenses"],
  // Vehicle hire and upkeep
  [/\b(HERTZ|AVIS|BUDGET RENT|EUROPCAR|THRIFTY|REDSPOT|SIXT|EAST COAST CAR|BAYSWATER CAR)\b/i,
    "Car rental & related expenses"],
  [/\b(CAR ?WASH|TYRE|TYREPOWER|BEAUREPAIRES|BOB JANE|ULTRA ?TUNE|REPCO|SUPERCHEAP AUTO|MIDAS|AUTOBARN)\b/i,
    "Car rental & related expenses"],

  // Air
  [/\b(QANTAS|VIRGIN AUSTRALIA|JETSTAR|REX AIRLINES|REGIONAL EXPRESS|AIR NEW ZEALAND|SINGAPORE AIR|EMIRATES|CATHAY|AIRLINES?|AIRWAYS)\b/i,
    "Airfare & related expenses"],
  [/\b(WEBJET|FLIGHT CENTRE|CORPORATE TRAVEL|CTM TRAVEL)\b/i,
    "Airfare & related expenses"],

  // Beds
  [/\b(MANTRA|IBIS|NOVOTEL|MERCURE|QUEST|RYDGES|OAKS|PEPPERS|HILTON|MARRIOTT|HYATT|CROWNE PLAZA|HOLIDAY INN|BEST WESTERN|COMFORT INN|QUALITY INN|NIGHTCAP|TRAVELODGE|ADINA|VIBE HOTEL|ATURA|ACCOR)\b/i,
    "Hotel & related expenses"],
  [/\b(HOTEL|MOTEL|MOTOR INN|RESORT|CARAVAN PARK|AIRBNB|BOOKING\.COM|EXPEDIA|WOTIF|AGODA)\b/i,
    "Hotel & related expenses"],

  // Getting around
  [/\b(UBER ?\*? ?TRIP|DIDI|TAXI|CABCHARGE|13 ?CABS|SILVER SERVICE|GOCATCH)\b/i,
    "Transport (train,taxi,parking,toll,etc.)"],
  [/\b(WILSON PARKING|SECURE PARKING|CARE PARK|ACE PARKING|PARKING|CAR ?PARK)\b/i,
    "Transport (train,taxi,parking,toll,etc.)"],
  [/\b(LINKT|E-?TOLL|EASTLINK|CITYLINK|ROAM EXPRESS|TRANSURBAN|TOLL)\b/i,
    "Transport (train,taxi,parking,toll,etc.)"],
  [/\b(OPAL|MYKI|GO ?CARD|TRANSLINK|V ?\/? ?LINE|TRAINLINK|METRO TRAINS|FERRY)\b/i,
    "Transport (train,taxi,parking,toll,etc.)"],

  // Phone, data, subscriptions
  [/\b(TELSTRA|OPTUS|VODAFONE|BOOST MOBILE|AMAYSIM|BELONG)\b/i, "Mobile phone expenses"],
  [/\b(NBN|SUPERLOOP|AUSSIE BROADBAND|TPG|IINET|EXETEL)\b/i, "Internet expenses"],
  [/\b(MICROSOFT|ADOBE|DROPBOX|ZOOM|LINKEDIN|CANVA|GOOGLE (ONE|STORAGE|WORKSPACE)|APPLE\.COM\/BILL|ANTHROPIC|OPENAI)\b/i,
    "Books & Subscriptions"],
  [/\b(AFR|AUSTRALIAN FINANCIAL|THE AGE|SUBSCRIPTION|BOOKTOPIA|DYMOCKS)\b/i,
    "Books & Subscriptions"],

  // Buying things
  [/\b(OFFICEWORKS|WINC|COMPLETE OFFICE|OFFICE ?NATIONAL|STAPLES)\b/i, "Office supplies"],
  [/\b(AUSTRALIA POST|AUSPOST|STARTRACK|COURIERS? ?PLEASE|TNT|DHL|FEDEX|TOLL IPEC|SENDLE)\b/i, "Postage"],
  [/\b(BUNNINGS|TOTAL TOOLS|SYDNEY TOOLS|MITRE ?10|HOME ?TIMBER|BLACKWOODS|RS COMPONENTS|TRADE ?TOOLS)\b/i, "Small tools"],
  [/\b(JB ?HI-?FI|HARVEY NORMAN|THE GOOD GUYS|DELL|LENOVO|APPLE STORE|CENTRECOM|SCORPTEC)\b/i,
    "Fixed assets (AUD100+ & 1YR+)"],
  [/\b(WORKWEAR|UNIFORM|HIP POCKET|RSEA|EMBROID|PPE|PROTECTOR ALSAFE)\b/i, "Uniforms"],

  // Food and drink — solo by default. Flip the row to 3rd party when a
  // customer was there; no descriptor can tell you that.
  [/\b(WOOLWORTHS|COLES|ALDI|IGA|FOODWORKS|COSTCO)\b/i,
    "Kitchen supply (milk,snacks,coffee,etc.)"],
  [/\b(MCDONALD|KFC|HUNGRY JACK|SUBWAY|RED ROOSTER|GUZMAN|ZAMBRERO|OPORTO|NANDO|GRILL'?D|SCHNITZ|BOOST JUICE|SUSHI|NOODLE|KEBAB|PIZZA|DOMINO|BAKERY|BAKERS DELIGHT|BANJO)\b/i,
    MEALS_SOLO],
  [/\b(CAFE|CAFÉ|COFFEE|ESPRESSO|ROASTER|BARISTA|GLORIA JEAN|MUFFIN BREAK|DONUT KING|ZARRAFFA|JAMAICA BLUE)\b/i,
    MEALS_SOLO],
  [/\b(RESTAURANT|BISTRO|TAVERN|BAR ?& ?GRILL|STEAKHOUSE|DINER|CANTEEN|BREWER|RSL|BOWLING CLUB|GOLF CLUB|LEAGUES CLUB)\b/i,
    MEALS_SOLO],
  [/\b(UBER ?EATS|MENULOG|DELIVEROO|DOORDASH)\b/i, MEALS_SOLO],

  // Gifts and entertaining
  [/\b(DAN MURPHY|BWS|LIQUORLAND|FIRST CHOICE|VINTAGE CELLARS|CELLARBRATIONS|FLORIST|HAMPER|GIFT ?CARD)\b/i,
    "Business entertainment & Gifts"],

  // Money noise
  [/\b(INTEREST|LATE PAYMENT|ANNUAL FEE|CARD FEE|FOREIGN (TRANSACTION|CURRENCY)|FX FEE|ATM|CASH ADVANCE)\b/i,
    "Bank charge"],
];

/* --------------------------------------------------------------- zoning */

// Justification is the travel zone, nothing finer. Border towns say border
// rather than being forced onto one side of a line that doesn't matter here.
export const ZONES = {
  NSW: "Travel New South Wales",
  VIC: "Travel Victoria",
  VICB: "Travel Victorian border",
  QLD: "Travel Queensland",
  QLDB: "Travel Queensland border",
  SA: "Travel South Australia",
  WA: "Travel Western Australia",
  TAS: "Travel Tasmania",
  NT: "Travel Northern Territory",
  ACT: "Travel Australian Capital Territory",
  NZ: "Travel New Zealand",
};

export const ZONE_ORDER =
  ["NSW", "VIC", "VICB", "QLD", "QLDB", "SA", "WA", "TAS", "NT", "ACT", "NZ"];

// State words as they appear in Amex descriptors. Checked before towns —
// an explicit state beats any lookup.
const STATE_WORDS = [
  [/\bNEW SOUTH WALES\b|\bNSW\b/i, "NSW"],
  [/\bVICTORIA\b|\bVIC\b/i, "VIC"],
  [/\bQUEENSLAND\b|\bQLD\b/i, "QLD"],
  [/\bSOUTH AUSTRALIA\b|\bS\.?A\.?\b(?! ?\d)/i, "SA"],
  [/\bWESTERN AUSTRALIA\b|\bW\.?A\.?\b(?! ?\d)/i, "WA"],
  [/\bTASMANIA\b|\bTAS\b/i, "TAS"],
  [/\bNORTHERN TERRITORY\b|\bNT\b/i, "NT"],
  [/\bAUSTRALIAN CAPITAL TERRITORY\b|\bACT\b|\bCANBERRA\b/i, "ACT"],
  [/\bNEW ZEALAND\b|\bNZ\b/i, "NZ"],
];

/* Towns by zone, comma separated. Any name appearing in two zones is dropped
   automatically at load — Richmond, Kingston, Maryborough and friends are real
   places in three states each, and a coin-flip is worse than no guess. Those
   fall through to the neighbouring-charges pass instead. */
const TOWNS = {
  // Twin towns either side of the Murray, where the state is genuinely moot.
  VICB: `albury, wodonga, lavington, thurgoona, howlong, corowa, wahgunyah,
    rutherglen, yarrawonga, mulwala, cobram, barooga, tocumwal, echuca, moama,
    barham, koondrook, swan hill, murray downs, robinvale, euston, wentworth,
    mildura, buronga, gol gol, nathalia, strathmerton, cohuna`,

  QLDB: `tweed heads, coolangatta, tugun, bilinga, currumbin, banora point,
    chinderah, kingscliff, goondiwindi, boggabilla, mungindi, wallangarra,
    jennings, texas`,

  NSW: `sydney, parramatta, penrith, liverpool, blacktown, campbelltown,
    chatswood, hornsby, bankstown, ryde, manly, bondi, mascot, botany,
    alexandria, marrickville, rosehill, silverwater, wetherill park, prestons,
    ingleburn, minto, moorebank, eastern creek, erskine park, kemps creek,
    huntingwood, seven hills, castle hill, rouse hill, baulkham hills,
    north sydney, chullora, yennora, villawood, revesby, padstow, peakhurst,
    kogarah, hurstville, rockdale, sutherland, caringbah, taren point,
    kirrawee, menai, newcastle, maitland, cessnock, singleton, muswellbrook,
    scone, tamworth, armidale, glen innes, inverell, moree, narrabri,
    gunnedah, dubbo, orange, bathurst, lithgow, mudgee, wellington, parkes,
    forbes, cowra, young, cootamundra, wagga wagga, junee, temora, griffith,
    leeton, narrandera, hay, west wyalong, condobolin, nyngan, bourke,
    coonamble, gilgandra, coonabarabran, quirindi, kempsey, port macquarie,
    taree, forster, wauchope, coffs harbour, grafton, casino, lismore,
    ballina, byron bay, murwillumbah, kyogle, nowra, bomaderry, ulladulla,
    batemans bay, moruya, bega, merimbula, eden, cooma, jindabyne, queanbeyan,
    goulburn, yass, crookwell, bowral, moss vale, mittagong, wollongong,
    port kembla, dapto, shellharbour, kiama, gosford, wyong, tuggerah,
    somersby, erina, terrigal, woy woy, katoomba, springwood, windsor, camden,
    picton, narellan, deniliquin, finley, berrigan, jerilderie, hillston,
    tumut, tumbarumba, gundagai, holbrook, culcairn, henty, lockhart, urana,
    corrimal, unanderra, raymond terrace, kurri kurri, rutherford, thornton,
    beresfield, tomago, wallsend, cardiff, warners bay, belmont, swansea nsw`,

  VIC: `melbourne, laverton, altona, sunshine, footscray, tottenham, brooklyn,
    derrimut, truganina, tarneit, werribee, hoppers crossing, point cook,
    williamstown, port melbourne, south melbourne, collingwood, preston,
    thomastown, campbellfield, somerton, craigieburn, broadmeadows,
    tullamarine, keilor, sunbury, melton, bacchus marsh, ballarat, geelong,
    north geelong, corio, lara, colac, torquay, ocean grove, queenscliff,
    warrnambool, portland, hamilton, ararat, stawell, horsham, nhill,
    dimboola, st arnaud, castlemaine, bendigo, kyneton, gisborne, woodend,
    seymour, shepparton, mooroopna, kyabram, tatura, benalla, wangaratta,
    myrtleford, bright, mansfield, alexandra, euroa, nagambie, wallan,
    kilmore, dandenong, keysborough, braeside, moorabbin, cheltenham, clayton,
    notting hill, mulgrave, rowville, bayswater, knoxfield, scoresby,
    ringwood, croydon, lilydale, healesville, yarra glen, pakenham,
    cranbourne, berwick, narre warren, frankston, mornington, rosebud,
    hastings, somerville, warragul, drouin, moe, morwell, traralgon, sale,
    bairnsdale, lakes entrance, orbost, leongatha, korumburra, wonthaggi,
    inverloch, foster, yarram, maffra, heyfield, rochester, elmore,
    heathcote, bannockburn, winchelsea, camperdown, terang, cobden, koroit,
    port fairy, casterton, coleraine, laverton north, dandenong south,
    braybrook, sunshine west, ravenhall, rockbank, deer park`,

  QLD: `brisbane, eagle farm, hemmant, murarrie, wacol, richlands, rocklea,
    archerfield, acacia ridge, darra, wynnum, cannon hill, northgate,
    geebung, brendale, strathpine, caboolture, morayfield, narangba,
    burpengary, redcliffe, ipswich, goodna, logan, browns plains, beenleigh,
    yatala, ormeau, gold coast, southport, nerang, robina, burleigh,
    helensvale, arundel, molendinar, sunshine coast, maroochydore, caloundra,
    kawana, nambour, noosa, gympie, hervey bay, bundaberg, childers, gin gin,
    gladstone, rockhampton, yeppoon, emerald, biloela, moura, mackay, sarina,
    proserpine, airlie beach, bowen, ayr, townsville, ingham, innisfail,
    cairns, mareeba, atherton, tully, mossman, port douglas, charters towers,
    hughenden, mount isa, cloncurry, longreach, barcaldine, roma, chinchilla,
    dalby, toowoomba, warwick, stanthorpe, kingaroy, murgon, oakey,
    pittsworth, gatton, laidley, esk, kilcoy, beaudesert, coominya,
    carole park, crestmead, berrinba, larapinta, willawong,
    windsor, springwood`,

  SA: `adelaide, port adelaide, wingfield, regency park, kilburn, dry creek,
    gepps cross, elizabeth, edinburgh, gawler, lonsdale, edwardstown,
    mile end, thebarton, hindmarsh, welland, woodville, findon, seaton,
    glenelg, noarlunga, aldinga, victor harbor, goolwa, murray bridge,
    tailem bend, bordertown, naracoorte, keith, mount gambier, millicent,
    penola, robe, meningie, loxton, berri, renmark, barmera, waikerie,
    morgan, clare, kapunda, nuriootpa, tanunda, angaston, balaklava,
    port wakefield, port pirie, port augusta, whyalla, port lincoln, ceduna,
    kadina, wallaroo, moonta, two wells, mount barker, murray bridge east`,

  WA: `perth, welshpool, kewdale, canning vale, malaga, osborne park, balcatta,
    bassendean, midland, forrestfield, jandakot, bibra lake, henderson,
    kwinana, rockingham, mandurah, pinjarra, bunbury, busselton,
    margaret river, manjimup, collie, albany, katanning, narrogin, northam,
    york, merredin, kalgoorlie, geraldton, carnarvon, karratha, port hedland,
    broome, kununurra, esperance, moora, dalwallinu, wongan hills, harvey,
    waroona, donnybrook, capel, dardanup, brunswick junction, myaree,
    naval base, hazelmere`,

  TAS: `hobart, moonah, glenorchy, derwent park, cambridge, huonville,
    new norfolk, sorell, launceston, kings meadows, mowbray, invermay,
    devonport, ulverstone, burnie, wynyard, smithton, penguin, latrobe,
    deloraine, scottsdale, george town, longford, campbell town, oatlands,
    st helens, strahan, bicheno, triabunna, bridgewater, margate, somerset`,

  NT: `darwin, palmerston, berrimah, winnellie, katherine, tennant creek,
    alice springs, nhulunbuy, jabiru, humpty doo, pinelands`,

  ACT: `fyshwick, belconnen, tuggeranong, woden, gungahlin, braddon, dickson,
    mawson, symonston, mitchell act, hume act, phillip act`,

  NZ: `auckland, penrose, mount wellington, manukau, east tamaki, hamilton,
    te rapa, tauranga, mount maunganui, rotorua, taupo, napier, new plymouth,
    palmerston north, wanganui, whanganui, lower hutt, porirua, nelson,
    blenheim, christchurch, ashburton, timaru, dunedin, invercargill,
    whangarei, masterton, feilding, levin, oamaru, hastings nz, albany nz`,
};

/* Build the lookup, discarding anything ambiguous across zones. A trailing
   disambiguator (" nz", " act") is stripped after the zone is assigned, so
   "albany nz" files Albany under NZ without colliding with Albany WA —
   both get dropped as ambiguous, which is the honest outcome. */
const TOWN_ZONE = new Map();
const AMBIGUOUS = new Set();
{
  const seen = new Map();
  for (const [zone, blob] of Object.entries(TOWNS)) {
    for (const raw of blob.split(",")) {
      const name = raw.trim().replace(/\s+/g, " ").toLowerCase();
      if (!name) continue;
      const key = name.replace(/ (nz|sa|wa|tas|act|nsw|vic|qld)$/, "");
      if (seen.has(key) && seen.get(key) !== zone) AMBIGUOUS.add(key);
      else seen.set(key, zone);
    }
  }
  for (const [k, v] of seen) if (!AMBIGUOUS.has(k)) TOWN_ZONE.set(k, v);
}

// Longest town name in words, so the scanner knows how wide to look.
const MAX_TOWN_WORDS = Math.max(...[...TOWN_ZONE.keys()].map((t) => t.split(" ").length));

/* ------------------------------------------------------- merchant keying */

/* Amex descriptors carry noise: gateway prefixes, store numbers, the town,
   the state. Strip all of it and what's left identifies the merchant, so a
   correction to "BP CONNECT" sticks whichever town you filled up in. */
export function merchantKey(description, city) {
  let s = " " + String(description || "").toUpperCase() + " ";

  // Payment gateway prefixes: SQ *, PAYPAL *, SP , TPG*, EZI*
  s = s.replace(/\b(SQ|SQUARE|PAYPAL|PP|SP|TPG|EZI|SUMUP|SHOPIFY|SEVEN|SPK)\s*\*/g, " ");
  s = s.replace(/\*/g, " ");

  // The town, if we know it, plus whatever city column came with the row
  if (city) s = s.replace(new RegExp("\\b" + esc(String(city).toUpperCase()) + "\\b", "g"), " ");
  for (const t of TOWN_ZONE.keys()) {
    const T = t.toUpperCase();
    if (s.includes(" " + T + " ")) s = s.replace(new RegExp("\\b" + esc(T) + "\\b", "g"), " ");
  }
  for (const t of AMBIGUOUS) {
    const T = t.toUpperCase();
    if (s.includes(" " + T + " ")) s = s.replace(new RegExp("\\b" + esc(T) + "\\b", "g"), " ");
  }

  // State words, store numbers, card tails, stray punctuation
  for (const [re] of STATE_WORDS) s = s.replace(new RegExp(re.source, "gi"), " ");
  s = s.replace(/\b\d{3,}\b/g, " ").replace(/[^A-Z0-9& ]/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();

  // First three words is enough to tell merchants apart without splitting
  // one chain into a key per store.
  return s.split(" ").filter(Boolean).slice(0, 3).join(" ") || "UNKNOWN";
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------------------------------- inference */

export function guessType(description) {
  const d = String(description || "");
  for (const [re, type] of RULES) if (re.test(d)) return type;
  return UNCAT;
}

/* Zone from the row itself: explicit state first, then the town. Returns
   null when the row gives us nothing — the caller fills those from the
   charges on either side. */
export function zoneFromRow(description, city) {
  const hay = `${description || ""} ${city || ""}`;

  for (const [re, zone] of STATE_WORDS) if (re.test(hay)) return { zone, via: "state" };

  // City column is cleaner than the descriptor, so try it on its own first.
  const cityKey = String(city || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (cityKey && TOWN_ZONE.has(cityKey)) return { zone: TOWN_ZONE.get(cityKey), via: "town" };
  if (cityKey && AMBIGUOUS.has(cityKey)) return null;

  // Then scan the descriptor for any town we know, longest match first.
  const words = String(description || "")
    .toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  for (let n = MAX_TOWN_WORDS; n >= 1; n--)
    for (let i = 0; i + n <= words.length; i++) {
      const cand = words.slice(i, i + n).join(" ");
      if (TOWN_ZONE.has(cand)) return { zone: TOWN_ZONE.get(cand), via: "town" };
    }

  return null;
}

/* Fill the gaps from neighbours. A charge with no location that sits between
   two Victorian charges is Victorian. Only fills when both sides agree —
   straddling a drive home shouldn't invent a zone. */
export function fillZoneGaps(rows) {
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    if (rows[i].zone) continue;
    let before = null, after = null;
    for (let j = i - 1; j >= 0; j--) if (rows[j].zoneVia !== "fill" && rows[j].zone) { before = rows[j].zone; break; }
    for (let j = i + 1; j < n; j++) if (rows[j].zoneVia !== "fill" && rows[j].zone) { after = rows[j].zone; break; }
    if (before && before === after) { rows[i].zone = before; rows[i].zoneVia = "fill"; }
  }
  return rows;
}

/* ---------------------------------------------------------- date format */

const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/* EBS wants DD-MON-YYYY, as its own tip says: 14-SEP-2026. */
export function ebsDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MON[m - 1]}-${y}`;
}

/* Receipt Amount goes in bare — no dollar sign, no thousands separator. */
export function ebsAmount(v) {
  return (Math.round(Number(v) * 100) / 100).toFixed(2);
}

/* --------------------------------------------------------- building rows */

/**
 * Turn parsed statement charges into keying rows.
 * @param {Array} charges  from parseStatement
 * @param {Object} overrides  { types: {key: type}, zones: {key: zone} }
 */
export function buildRows(charges, overrides = {}) {
  const typeOv = overrides.types || {};
  const zoneOv = overrides.zones || {};

  const rows = charges.map((c) => {
    const key = merchantKey(c.description, c.city);
    const hit = zoneFromRow(c.description, c.city);
    return {
      id: c.id,
      date: c.date,
      amount: c.amount,
      description: c.description,
      city: c.city || "",
      key,
      type: typeOv[key] || guessType(c.description),
      typeGuessed: !typeOv[key],
      zone: zoneOv[key] || (hit ? hit.zone : null),
      zoneVia: zoneOv[key] ? "saved" : hit ? hit.via : null,
      keyed: false,
      manual: false,
    };
  });

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return fillZoneGaps(rows);
}

export function justification(row) {
  if (row.justification) return row.justification;
  return row.zone ? ZONES[row.zone] : "";
}

export { parseStatement, StatementError };
