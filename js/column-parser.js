// Sumline column parser (design.md § Architecture "Column parser", gap G3; brief #7).
// Text-layer statement pages -> rows. Pure ES module: the browser runs it as a module Web
// Worker (message handler at the bottom), the harness and tests import its functions.
//
// Input: pages = [{ page, items: [{ str, x, y, w, h }] }] where x/y are the text item's
// origin in PDF points (pdf.js item.transform[4], [5]), w its width, h its font height.
// itemsFromTextContent() converts a pdf.js getTextContent() result.
//
// Steps: y-grouping (2 pt) -> lines; a row starts at a line whose first token is a date;
// money tokens -> right-edge x clustering -> debit / credit / amount / balance bands (header
// words name the bands; without a header the chain picks); continuation lines append to the
// description; opening / closing by keyword; three money grammars (US/UK, Indian, European)
// chosen per statement by majority vote; dates normalised from the statement period.

import { reconcileStatement } from './reconcile.js';

export const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ---------- money ----------
const CORE = {
  US: /^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/,
  IN: /^(?:\d{1,2}(?:,\d{2})*,\d{3}|\d+)\.\d{2}$/,
  EU: /^(?:\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+|\d+),\d{2}$/,
};
const CUR = /^(?:\$|£|€|₹|Rs\.?|INR|USD|EUR|GBP)\s*/;
const CUR_END = /\s*(?:\$|£|€|₹|INR|USD|EUR|GBP)$/;

// Splits sign markers and currency from a token. Returns {core, neg, suffix} or null.
export function splitMoney(raw) {
  let s = String(raw).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || !/\d/.test(s)) return null;
  let neg = false, suffix = null;
  const suf = s.match(/\s*\.?\s*\b(CR|DR|Cr|Dr|cr|dr)\.?$/);
  if (suf) { suffix = suf[1].toUpperCase(); s = s.slice(0, suf.index).trim(); }
  for (let guard = 0; guard < 6; guard++) {
    if (/[-−–]$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); continue; }
    if (s.endsWith('+')) { s = s.slice(0, -1).trim(); continue; }
    if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1).trim(); continue; }
    if (s.startsWith('+')) { s = s.slice(1).trim(); continue; }
    if (s.startsWith('(') && s.endsWith(')')) { neg = !neg; s = s.slice(1, -1).trim(); continue; }
    const c = s.match(CUR);
    if (c && c[0].length) { s = s.slice(c[0].length).trim(); continue; }
    const ce = s.match(CUR_END);
    if (ce && ce[0].length) { s = s.slice(0, ce.index).trim(); continue; }
    break;
  }
  if (!/^\d[\d., ]*\d$/.test(s)) return null;
  return { core: s, neg, suffix };
}

// Which grammars accept this token (as a money amount)?
export function grammarsOf(raw) {
  const m = splitMoney(raw);
  if (!m) return [];
  return Object.keys(CORE).filter((g) => CORE[g].test(m.core));
}

// Signed value in cents, or null. CR -> positive, DR -> negative; '-', '(…)' and a trailing
// '-' -> negative.
export function parseMoneyCents(raw, grammar) {
  const m = splitMoney(raw);
  if (!m || !CORE[grammar] || !CORE[grammar].test(m.core)) return null;
  const cents = parseInt(m.core.replace(/\D/g, ''), 10);
  let neg = m.neg;
  if (m.suffix === 'DR') neg = true;
  if (m.suffix === 'CR') neg = false;
  return { cents: neg ? -cents : cents, explicit: m.neg || m.suffix !== null };
}

export function parseMoney(raw, grammar) {
  const r = parseMoneyCents(raw, grammar);
  return r ? r.cents / 100 : null;
}

export function voteGrammar(tokens) {
  const votes = { US: 0, IN: 0, EU: 0 }, only = { US: 0, IN: 0, EU: 0 };
  for (const t of tokens) {
    const gs = grammarsOf(t);
    gs.forEach((g) => votes[g]++);
    if (gs.length === 1) only[gs[0]]++;
  }
  const order = ['US', 'IN', 'EU'];
  return order.slice().sort((a, b) => (votes[b] - votes[a]) || (only[b] - only[a]) || (order.indexOf(a) - order.indexOf(b)))[0];
}

// ---------- dates ----------
function monthOf(s) { return MONTHS[String(s).toLowerCase().replace(/\.$/, '')] || null; }

// Parses one date token (no year resolution). Returns {kind, a, b, y} or null.
//   iso: y-m-d; num: a/b[/y] (order decided per statement); dmon: d Mon [y]; mond: Mon d[, y]
export function matchDate(str) {
  const s = String(str).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return { kind: 'iso', y: +m[1], a: +m[2], b: +m[3] };
  if ((m = s.match(/^(\d{1,2})([/.\-])(\d{1,2})(?:\2(\d{4}|\d{2}))?\.?$/))) {
    const a = +m[1], b = +m[3];
    if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) return null;
    return { kind: 'num', a, b, y: m[4] ? yr(m[4]) : null };
  }
  if ((m = s.match(/^(\d{1,2})[ \-]?([A-Za-z]{3,9})\.?(?:[ \-,]+(\d{4}|\d{2}))?$/)) && monthOf(m[2])) {
    return { kind: 'dmon', a: +m[1], b: monthOf(m[2]), y: m[3] ? yr(m[3]) : null };
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?$/)) && monthOf(m[1])) {
    return { kind: 'mond', a: monthOf(m[1]), b: +m[2], y: m[3] ? yr(m[3]) : null };
  }
  return null;
}
function yr(s) { const n = +s; return s.length === 2 ? 2000 + n : n; }

// {month, day} for a matched date under the statement's numeric order ('MDY' | 'DMY').
function md(d, order) {
  if (d.kind === 'iso') return { m: d.a, d: d.b };
  if (d.kind === 'dmon') return { m: d.b, d: d.a };
  if (d.kind === 'mond') return { m: d.a, d: d.b };
  return order === 'DMY' ? { m: d.b, d: d.a } : { m: d.a, d: d.b };
}
function iso(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function validYmd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Full dates printed in free text (statement period, statement date, due dates).
const FULL_DATE_RES = [
  /(\d{4})-(\d{2})-(\d{2})/g,
  /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g,
  /\b(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.?,? (\d{4})\b/g,
  /\b([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b/g,
];
function fullDatesIn(text) {
  const out = [];
  FULL_DATE_RES.forEach((re, k) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (k === 0) out.push({ kind: 'iso', y: +m[1], a: +m[2], b: +m[3] });
      else if (k === 1) { const a = +m[1], b = +m[2]; if (a <= 31 && b <= 31 && (a <= 12 || b <= 12)) out.push({ kind: 'num', a, b, y: yr(m[3]) }); }
      else if (k === 2 && monthOf(m[2])) out.push({ kind: 'dmon', a: +m[1], b: monthOf(m[2]), y: +m[3] });
      else if (k === 3 && monthOf(m[1])) out.push({ kind: 'mond', a: monthOf(m[1]), b: +m[2], y: +m[3] });
    }
  });
  return out;
}

// ---------- lines and tokens ----------
export function itemsFromTextContent(tc) {
  return tc.items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height || it.transform[3]) }));
}

function toLines(items) {
  const sorted = items.slice().sort((p, q) => (q.y - p.y) || (p.x - q.x));
  const lines = [];
  for (const it of sorted) {
    const line = lines.length ? lines[lines.length - 1] : null;
    if (line && Math.abs(line.y - it.y) <= 2) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((p, q) => p.x - q.x);
    // split items on runs of 2+ spaces, estimating x by character share
    const toks = [];
    for (const it of l.items) {
      const parts = it.str.split(/(\s{2,})/);
      if (parts.length === 1) { toks.push({ str: it.str.trim(), x: it.x, x1: it.x + it.w, h: it.h }); continue; }
      const per = it.w / Math.max(1, it.str.length);
      let off = 0;
      for (const p of parts) {
        if (p.trim()) toks.push({ str: p.trim(), x: it.x + off * per, x1: it.x + (off + p.length) * per, h: it.h });
        off += p.length;
      }
    }
    // merge tokens that touch (a single word split across items)
    const merged = [];
    for (const t of toks) {
      const prev = merged[merged.length - 1];
      if (prev && t.x - prev.x1 < 0.6 && !/\s$/.test(prev.str)) { prev.str += t.str; prev.x1 = t.x1; }
      else merged.push({ ...t });
    }
    // a money value printed in the same text run as its label ("Opening balance £3,120.44")
    // becomes its own token; the longest money-shaped suffix wins ("1 234 567,89")
    const split = [];
    for (const t of merged) {
      const words = t.str.split(' ');
      let done = false;
      for (let k = Math.min(4, words.length - 1); k >= 1 && !done; k--) {
        const tail = words.slice(-k).join(' ');
        if (grammarsOf(tail).length && /\d[.,]\d{2}\b/.test(tail)) {
          const head = words.slice(0, -k).join(' ');
          const per = (t.x1 - t.x) / Math.max(1, t.str.length);
          split.push({ ...t, str: head, x1: t.x + head.length * per });
          split.push({ ...t, str: tail, x: t.x1 - tail.length * per });
          done = true;
        }
      }
      if (!done) split.push(t);
    }
    // a separate "Cr"/"Dr" (or trailing currency) item belongs to the money token before it
    const glued = [];
    for (const t of split) {
      const prev = glued[glued.length - 1];
      if (prev && /^(?:CR|DR|Cr|Dr|cr|dr)\.?$|^(?:€|EUR)$/.test(t.str) && grammarsOf(prev.str).length && t.x - prev.x1 < 12) {
        prev.str = `${prev.str} ${t.str}`; prev.x1 = t.x1;
      } else glued.push(t);
    }
    l.tokens = glued.filter((t) => t.str);
    l.text = l.tokens.map((t) => t.str).join(' ');
    l.h = Math.max(...l.items.map((i) => i.h || 0)) || 10;
  }
  return lines;
}

// A date at the start of the line: the first token, or the first 2-3 tokens joined
// ("02" "Sep"), or a date prefix inside the first token ("09/02 PAYROLL").
function dateAtStart(tokens) {
  if (!tokens.length) return null;
  for (let k = Math.min(3, tokens.length); k >= 1; k--) {
    const s = tokens.slice(0, k).map((t) => t.str).join(' ');
    const d = matchDate(s);
    if (d) return { d, consumed: k, rest: null };
  }
  const first = tokens[0].str;
  const m = first.match(/^(\S+(?: [A-Za-z]{3,9}\.?)?)\s+(.+)$/);
  if (m) {
    const d = matchDate(m[1]) || matchDate(first.split(/\s+/)[0]);
    if (d) {
      const head = matchDate(m[1]) ? m[1] : first.split(/\s+/)[0];
      return { d, consumed: 1, rest: first.slice(head.length).trim() };
    }
  }
  return null;
}

// ---------- keywords ----------
const OPEN_RE = /\b(opening balance|beginning balance|previous balance|starting balance|balance brought forward|brought forward|b\/f|anfangssaldo|alter kontostand)\b/i;
const CLOSE_RE = /\b(closing balance|ending balance|new balance|balance carried forward|carried forward|c\/f|endsaldo|neuer kontostand)\b/i;
const BF_RE = /\b(brought forward|b\/f)\b/i;
const CF_RE = /\b(carried forward|c\/f)\b/i;
const SUM_EXCLUDE = /\b(minimum|due|limit|available|past due|rewards?|apr|annual percentage|access line|points|overdraft limit)\b/i;
const SUM_CREDIT = /\b(payments?|credits?|deposits?|money in|paid in|additions|receipts)\b/i;
const SUM_DEBIT = /\b(purchases?|charges|withdrawals?|money out|paid out|debits?|fees|fee|interest|cash advances?|balance transfers?)\b/i;
const CARD_RE = /\b(minimum payment|credit limit|credit access line|payment due date)\b/i;
const HDR = {
  balance: /^(?:(?:closing |running |ledger )?balance(?: \(\w+\))?|saldo)$/i,
  debit: /^(?:debits?|withdrawals?(?: amt\.?)?|paid out|money out|dr|soll|withdrawal amount|debit amount)(?: \(\w+\))?$/i,
  credit: /^(?:credits?|deposits?(?: amt\.?)?|paid in|money in|cr|haben|deposit amount|credit amount|deposits? (?:and|&) additions)(?: \(\w+\))?$/i,
  amount: /^(?:\$ ?)?amount(?: \(\w+\))?$|^\$ amount$|^betrag/i,
};

function headerRoles(line) {
  const out = [];
  for (const t of line.tokens) {
    const s = t.str.replace(/\s+/g, ' ').trim();
    for (const role of Object.keys(HDR)) if (HDR[role].test(s)) { out.push({ role, x: t.x, x1: t.x1 }); break; }
  }
  return out;
}

// ---------- the parser ----------
export function parseStatement(pages, opts = {}) {
  const P = pages.map((p) => ({ page: p.page, lines: toLines(p.items) }));
  const allTokens = [];
  P.forEach((p) => p.lines.forEach((l) => l.tokens.forEach((t) => allTokens.push(t.str))));
  const grammar = opts.grammar || voteGrammar(allTokens);
  const isMoney = (s) => parseMoneyCents(s, grammar) !== null;

  // pass 1: classify lines
  const dated = []; // {pi, li, date, consumed, rest, money: [tok], text}
  P.forEach((p, pi) => p.lines.forEach((l, li) => {
    l.pi = pi; l.li = li;
    const ds = dateAtStart(l.tokens);
    l.date = ds;
    const after = ds ? l.tokens.slice(ds.consumed) : l.tokens;
    l.money = after.filter((t) => isMoney(t.str));
    l.lower = l.text.toLowerCase();
  }));

  // date order: any first part > 12 -> DMY, any second part > 12 -> MDY, else by grammar
  let order = null;
  const numDates = [];
  P.forEach((p) => p.lines.forEach((l) => { if (l.date && l.date.d.kind === 'num') numDates.push(l.date.d); }));
  if (numDates.some((d) => d.a > 12)) order = 'DMY';
  else if (numDates.some((d) => d.b > 12)) order = 'MDY';
  else order = grammar === 'US' && !opts.dmy ? 'MDY' : 'DMY';
  if (opts.dateOrder) order = opts.dateOrder;

  // statement period anchors: full dates on non-row lines
  const anchors = [];
  P.forEach((p) => p.lines.forEach((l) => {
    if (l.date && l.money.length) return;
    for (const d of fullDatesIn(l.text)) {
      const { m, d: dd } = md(d, order);
      if (validYmd(d.y, m, dd)) anchors.push(Date.UTC(d.y, m - 1, dd));
    }
  }));
  const latest = anchors.length ? Math.max(...anchors) : null;
  const earliest = anchors.length ? Math.min(...anchors) : null;
  const fallbackYear = opts.year || (latest ? new Date(latest).getUTCFullYear() : new Date().getUTCFullYear());
  const toIso = (d) => {
    const { m, d: dd } = md(d, order);
    let y = d.y;
    if (!y) {
      y = latest ? new Date(latest).getUTCFullYear() : fallbackYear;
      if (latest && Date.UTC(y, m - 1, dd) > latest + 7 * 864e5) y -= 1;
    }
    return validYmd(y, m, dd) ? iso(y, m, dd) : null;
  };

  const kind = CARD_RE.test(P.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n')) && /new balance/i.test(allTokens.join(' ')) ? 'card' : 'bank';

  // candidate transaction lines: date-led with money and no balance keyword
  const isKeyword = (l) => OPEN_RE.test(l.lower) || CLOSE_RE.test(l.lower);
  const rowLines = [];
  P.forEach((p) => p.lines.forEach((l) => { if (l.date && l.money.length && !isKeyword(l) && toIso(l.date.d)) rowLines.push(l); }));

  // bands: cluster the right edges of money tokens on row lines
  const edges = [];
  rowLines.forEach((l) => l.money.forEach((t) => edges.push(t.x1)));
  edges.sort((a, b) => a - b);
  let bands = [];
  for (const e of edges) {
    const b = bands[bands.length - 1];
    if (b && e - b.max <= 8) { b.max = e; b.sum += e; b.n++; }
    else bands.push({ min: e, max: e, sum: e, n: 1 });
  }
  bands.forEach((b) => { b.x = b.sum / b.n; });
  if (rowLines.length >= 5) bands = bands.filter((b) => b.n >= 2);

  // roles from the header line(s)
  let hdr = [];
  for (const p of P) {
    for (const l of p.lines) {
      if (l.date) continue;
      const roles = headerRoles(l);
      if (roles.length >= 2 || (roles.length === 1 && /\bdate\b/i.test(l.text))) { hdr = roles; break; }
    }
    if (hdr.length) break;
  }
  const assignFromHeader = () => bands.map((b) => {
    let best = null, bestD = Infinity;
    for (const h of hdr) {
      const d = b.x >= h.x - 6 && b.x <= h.x1 + 6 ? 0 : Math.min(Math.abs(b.x - h.x), Math.abs(b.x - h.x1));
      if (d < bestD) { bestD = d; best = h; }
    }
    return best && bestD <= 60 ? best.role : null;
  });
  let roleSets = [];
  const fromHdr = hdr.length ? assignFromHeader() : [];
  if (fromHdr.length && fromHdr.every((r) => r)) roleSets = [fromHdr];
  else if (bands.length === 1) roleSets = [['amount']];
  else if (bands.length === 2) roleSets = [['amount', 'balance'], ['debit', 'credit']];
  else if (bands.length === 3) roleSets = [['debit', 'credit', 'balance'], ['credit', 'debit', 'balance']];
  else if (bands.length >= 4) {
    const base = bands.map(() => null);
    base[bands.length - 1] = 'balance'; base[bands.length - 2] = 'credit'; base[bands.length - 3] = 'debit';
    const alt = base.slice(); alt[bands.length - 2] = 'debit'; alt[bands.length - 3] = 'credit';
    roleSets = [base, alt];
  } else roleSets = [[]];

  const build = (roles) => buildStatement({ P, bands, roles, grammar, toIso, kind, isKeyword, isMoney });
  let best = null;
  for (const roles of roleSets) {
    const st = build(roles);
    if (roleSets.length === 1) { best = st; break; }
    const r = reconcileStatement(st);
    const score = r.failedPages.length * 1000 + r.flaggedRows + (r.status === 'unreconciled' ? 500 : 0);
    if (!best || score < best._score) { best = st; best._score = score; }
  }
  delete best._score;
  best.format = grammar;
  best.dateOrder = order;
  best.period = earliest ? { start: new Date(earliest).toISOString().slice(0, 10), end: new Date(latest).toISOString().slice(0, 10) } : null;
  best.kind = kind;
  return best;
}

// Without a header, candidate role sets are ranked by the chain (fewest failed pages).

function buildStatement({ P, bands, roles, grammar, toIso, kind, isKeyword, isMoney }) {
  const bandOf = (t) => {
    let bi = -1, bd = Infinity;
    bands.forEach((b, i) => { const d = Math.abs(t.x1 - b.x); if (d < bd) { bd = d; bi = i; } });
    return bd <= 12 && roles[bi] ? roles[bi] : null;
  };
  const cents = (t) => parseMoneyCents(t.str, grammar);
  let opening = null, closing = null;
  const summary = {};
  const summarySeen = new Set();
  const out = [];
  for (const p of P) {
    const page = { page: p.page, rows: [], opening: null, closing: null };
    let last = null; // last row on this page: {row, line, descX}
    let lastLineY = null;
    for (const l of p.lines) {
      const lastMoney = l.money.length ? cents(l.money[l.money.length - 1]) : null;
      if (isKeyword(l) && l.money.length) {
        const v = lastMoney.cents / 100;
        if (OPEN_RE.test(l.lower)) {
          if (opening === null) opening = v;
          if (BF_RE.test(l.lower) && page.opening === null) page.opening = v;
        }
        if (CLOSE_RE.test(l.lower) && !OPEN_RE.test(l.lower)) {
          closing = v;
          if (CF_RE.test(l.lower)) page.closing = v;
        }
        last = null;
        continue;
      }
      const iso = l.date && l.money.length ? toIso(l.date.d) : null;
      const assigned = l.money.map((t) => ({ t, role: bandOf(t) }));
      const onBands = assigned.filter((a) => a.role);
      const mkRow = (date, descTokens, restText) => {
        const row = { date, desc: '', amount: 0, balance: null };
        let amt = 0, hasAmt = false;
        for (const { t, role } of onBands) {
          const c = cents(t);
          if (role === 'debit') { amt -= Math.abs(c.cents); hasAmt = true; }
          else if (role === 'credit') { amt += Math.abs(c.cents); hasAmt = true; }
          else if (role === 'amount') { amt += kind === 'card' ? -c.cents : c.cents; hasAmt = true; }
          else if (role === 'balance') row.balance = c.cents / 100;
        }
        const words = [];
        if (restText) words.push(restText);
        const used = new Set(onBands.map((a) => a.t));
        for (const t of descTokens) if (!used.has(t) && !/^(?:\$|£|€|₹|INR|EUR|USD|GBP)$/.test(t.str)) words.push(t.str);
        row.desc = words.join(' ').replace(/\s+/g, ' ').trim();
        row.amount = amt / 100;
        return { row, hasAmt };
      };
      if (iso && onBands.length) {
        const { row, hasAmt } = mkRow(iso, l.tokens.slice(l.date.consumed), l.date.rest);
        if (!hasAmt) { if (opening === null && !out.length && !page.rows.length && row.balance !== null) opening = row.balance; last = null; continue; }
        page.rows.push(row);
        const descTok = l.tokens.slice(l.date.consumed).find((t) => !onBands.some((a) => a.t === t));
        last = { row, descX: descTok ? descTok.x : null, h: l.h, y: l.y };
        lastLineY = l.y;
        continue;
      }
      // undated row (date printed once per day): money on the bands, description aligned
      if (!l.date && last && last.descX !== null && onBands.length === l.money.length && onBands.length
          && Math.abs(l.tokens[0].x - last.descX) <= 6 && !/\btotals?\b/i.test(l.lower)) {
        const { row, hasAmt } = mkRow(last.row.date, l.tokens, null);
        if (hasAmt) {
          page.rows.push(row);
          last = { row, descX: last.descX, h: l.h, y: l.y };
          continue;
        }
      }
      // summary / totals lines (used only when there is no balance column)
      if (!l.date && l.money.length && !SUM_EXCLUDE.test(l.lower)) {
        const label = l.tokens.filter((t) => !isMoney(t.str)).map((t) => t.str).join(' ').toLowerCase().replace(/[^a-z& ]/g, ' ').replace(/\s+/g, ' ').trim();
        const isC = SUM_CREDIT.test(label), isD = SUM_DEBIT.test(label);
        if (label && (isC !== isD) && label.split(' ').length <= 6) {
          if (!summarySeen.has(label)) {
            summarySeen.add(label);
            const v = Math.abs(cents(l.money[0]).cents);
            const key = isC ? 'credits_total' : 'debits_total';
            summary[key] = Math.round(((summary[key] || 0) * 100) + v) / 100;
          }
          last = null;
          continue;
        }
      }
      // continuation line: no money, aligned with or right of the description, close below
      if (!l.date && !l.money.length && last && last.descX !== null && l.tokens[0].x >= last.descX - 3
          && (last.y - l.y) <= 1.7 * (last.h || 10) && !headerRoles(l).length) {
        const firstBand = bands.length ? Math.min(...bands.map((b) => b.min)) : Infinity;
        const words = l.tokens.filter((t) => t.x1 < firstBand - 20).map((t) => t.str);
        if (words.length) {
          last.row.desc = (last.row.desc + ' ' + words.join(' ')).replace(/\s+/g, ' ').trim();
          last.y = l.y;
          continue;
        }
      }
      if (l.tokens.length) last = null;
    }
    out.push(page);
  }
  const hasBalanceColumn = roles.includes('balance');
  const st = { kind, opening, closing, summary: Object.keys(summary).length || kind === 'card' ? summary : null, hasBalanceColumn, columns: roles, pages: out };
  if (st.summary && kind === 'card') {
    st.summary.previous_balance = opening;
    st.summary.new_balance = closing;
  }
  return st;
}

// ---------- AI page records -> one statement (design.md: dates normalised by code) ----------
// The model copies dates as printed and reports date_format; code resolves the order and the
// year from the statement period, so the model never invents a year.
export function normaliseDate(raw, { order = 'MDY', latest = null } = {}) {
  const d = matchDate(String(raw || '').trim());
  if (!d) return null;
  const { m, d: dd } = md(d, order);
  let y = d.y;
  if (!y) {
    if (!latest) return null;
    const L = Date.parse(latest + 'T00:00:00Z');
    y = new Date(L).getUTCFullYear();
    if (Date.UTC(y, m - 1, dd) > L + 7 * 864e5) y -= 1;
  }
  return validYmd(y, m, dd) ? iso(y, m, dd) : null;
}

export function latestDateIn(text, order = 'MDY') {
  let best = null;
  for (const d of fullDatesIn(String(text || ''))) {
    const { m, d: dd } = md(d, order);
    if (!validYmd(d.y, m, dd)) continue;
    const t = Date.UTC(d.y, m - 1, dd);
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString().slice(0, 10);
}

// records: [{ page, out: record_page tool input | null, truncated?, schemaError? }] for ONE
// statement, in page order. Returns the reconcile.js statement shape.
export function statementFromRecords(records) {
  const outs = records.map((r) => r.out).filter(Boolean);
  const fmt = (outs.find((o) => o.date_format && o.date_format !== 'unknown') || {}).date_format;
  const order = fmt === 'DMY' ? 'DMY' : 'MDY';
  const period = (outs.find((o) => o.statement_period) || {}).statement_period || '';
  const latest = latestDateIn(period, order);
  const firstNum = (k) => { for (const o of outs) if (typeof o[k] === 'number') return o[k]; return null; };
  const lastNum = (k) => { for (let i = outs.length - 1; i >= 0; i--) if (typeof outs[i][k] === 'number') return outs[i][k]; return null; };
  const summary = (outs.find((o) => o.summary && typeof o.summary === 'object') || {}).summary || null;
  const hasBal = outs.some((o) => o.has_balance_column === true);
  const kind = summary && typeof summary.previous_balance === 'number' && typeof summary.new_balance === 'number' && !hasBal ? 'card' : 'bank';
  return {
    kind,
    opening: firstNum('opening_balance') ?? (summary ? summary.previous_balance ?? null : null),
    closing: lastNum('closing_balance') ?? (summary ? summary.new_balance ?? null : null),
    summary,
    hasBalanceColumn: hasBal,
    pages: records.map((r) => ({
      page: r.page,
      truncated: !!r.truncated,
      schemaError: !!r.schemaError,
      hasTransactions: r.out ? r.out.has_transactions === true : undefined,
      rows: r.out && Array.isArray(r.out.rows) ? r.out.rows.map((x) => ({
        date: normaliseDate(x.d, { order, latest }), desc: String(x.t ?? ''), amount: typeof x.a === 'number' ? x.a : null,
        balance: typeof x.b === 'number' ? x.b : null,
      })) : [],
    })),
  };
}

// ---------- Web Worker entry (browser only) ----------
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function' && typeof process === 'undefined') {
  self.onmessage = (e) => {
    try { self.postMessage({ ok: true, statement: parseStatement(e.data.pages, e.data.opts || {}) }); }
    catch (err) { self.postMessage({ ok: false, error: String(err && err.message || err) }); }
  };
}
