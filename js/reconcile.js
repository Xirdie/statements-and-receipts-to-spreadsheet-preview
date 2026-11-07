// Sumline reconciliation chain (design.md § Architecture "The chain", brief #3, #4, D9, D10).
// Pure and deterministic: no DOM, no network, no clock. This is the ONE copy; the browser,
// worker/harness and worker/test import it. All arithmetic is in integer cents, so the
// design's tolerance |expected - b| <= 0.005 is exact equality at cent resolution.
//
// Statement input (from column-parser.js, or from the AI's record_page output):
//   { kind: 'bank' | 'card', opening, closing, summary?: {previous_balance, credits_total,
//     debits_total, new_balance}, pages: [{ page, rows: [{date, desc, amount, balance}],
//     opening?, closing?, truncated?, schemaError?, hasTransactions? }] }
//   amount: signed, money out negative. balance: number or null. page.opening/closing are
//   printed "brought forward" / "carried forward" balances for that page, when printed.
//
// Output: { status: 'reconciled' | 'flagged' | 'unreconciled', failed, flipped,
//   failedPages: [page numbers], flaggedRows, rows: [{page, n, check}], line, checks, note }

export function toCents(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function fmtCents(c) {
  if (c === null || c === undefined) return '';
  const neg = c < 0;
  const a = Math.abs(c);
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + whole + '.' + String(a % 100).padStart(2, '0');
}

function flatten(st, sign) {
  const flat = [];
  st.pages.forEach((p, pi) => {
    (p.rows || []).forEach((r, ri) => {
      const a = toCents(r.amount);
      flat.push({ pi, ri, page: p.page, amount: a === null ? 0 : sign * a, balance: toCents(r.balance) });
    });
  });
  return flat;
}

// Running-balance chain over every row that carries a balance.
function runChain(st, sign) {
  const flat = flatten(st, sign);
  const failedPages = new Set();
  const flags = new Map(); // flat index -> reason
  const pageNotes = new Map(); // page index -> reason (page-level failures)
  let prev = toCents(st.opening);
  let derived = false;
  if (prev === null) {
    let s = 0;
    for (const r of flat) {
      s += r.amount;
      if (r.balance !== null) { prev = r.balance - s; derived = true; break; }
    }
  }
  const start = prev;
  let acc = 0;
  let lastBal = -1;
  let curPi = -1;
  let firstBalOnPage = true;
  let credits = 0, debits = 0;
  for (let i = 0; i < flat.length; i++) {
    const r = flat[i];
    if (r.pi !== curPi) {
      curPi = r.pi;
      firstBalOnPage = true;
      const po = toCents(st.pages[r.pi].opening);
      if (po !== null && r.pi > 0 && prev !== null && po !== prev + acc) {
        failedPages.add(r.pi); failedPages.add(r.pi - 1);
        pageNotes.set(r.pi, `brought forward ${fmtCents(po)} but the previous page ends at ${fmtCents(prev + acc)}`);
      }
    }
    acc += r.amount;
    if (r.amount > 0) credits += r.amount; else debits -= r.amount;
    if (r.balance !== null) {
      const exp = prev + acc;
      if (exp !== r.balance) {
        const off = fmtCents(Math.abs(r.balance - exp));
        flags.set(i, lastBal >= 0
          ? `balance off by ${off} between rows ${lastBal + 1} and ${i + 1}`
          : `balance off by ${off} at row ${i + 1} (from the opening balance)`);
        failedPages.add(r.pi);
        if (firstBalOnPage && r.pi > 0) failedPages.add(r.pi - 1);
      }
      prev = r.balance; acc = 0; lastBal = i; firstBalOnPage = false;
    }
    const lastOnPage = i === flat.length - 1 || flat[i + 1].pi !== r.pi;
    if (lastOnPage) {
      const pc = toCents(st.pages[r.pi].closing);
      if (pc !== null && pc !== prev + acc) {
        failedPages.add(r.pi);
        pageNotes.set(r.pi, `carried forward ${fmtCents(pc)} but the rows end at ${fmtCents(prev + acc)}`);
      }
    }
  }
  const end = prev === null ? null : prev + acc;
  const printed = toCents(st.closing);
  let closingNote = null;
  if (printed !== null && flat.length && end !== printed) {
    const lp = flat[flat.length - 1].pi;
    failedPages.add(lp);
    closingNote = `closing balance off by ${fmtCents(Math.abs(printed - end))}`;
  }
  return {
    flat, flags, pageNotes, failedPages, closingNote,
    line: { opening: start, derivedOpening: derived, credits, debits, computed: end, printed, diff: printed === null || end === null ? null : printed - end },
  };
}

// Statements with no balance column: the printed totals (card summary box, or totals lines)
// are the only check (D10). Failure flags every page of the statement; the label stays
// "unreconciled" (#4).
function runTotals(st, sign) {
  const flat = flatten(st, sign);
  let credits = 0, debits = 0;
  for (const r of flat) { if (r.amount > 0) credits += r.amount; else debits -= r.amount; }
  const sm = st.summary || {};
  const prevB = toCents(sm.previous_balance ?? st.opening);
  const newB = toCents(sm.new_balance ?? st.closing);
  const cr = toCents(sm.credits_total);
  const dr = toCents(sm.debits_total);
  const card = st.kind === 'card';
  const checks = [];
  if (dr !== null) checks.push({ name: card ? 'charges' : 'debits', rows: debits, printed: dr, ok: dr === debits });
  if (cr !== null) checks.push({ name: card ? 'payments' : 'credits', rows: credits, printed: cr, ok: cr === credits });
  if (prevB !== null && newB !== null) {
    const exp = card ? prevB + debits - credits : prevB + credits - debits;
    checks.push({ name: 'closing', rows: exp, printed: newB, ok: exp === newB });
    if (card && cr !== null && dr !== null) {
      checks.push({ name: 'summary', rows: prevB + dr - cr, printed: newB, ok: prevB + dr - cr === newB });
    }
  }
  const failed = checks.some((c) => !c.ok);
  const failedPages = new Set();
  if (failed) st.pages.forEach((p, pi) => { if ((p.rows || []).length) failedPages.add(pi); });
  const words = { charges: "statement's charges total", payments: "statement's payments total", debits: "statement's debits total", credits: "statement's credits total", closing: 'statement says', summary: 'summary box says' };
  const note = checks.map((c) => `${c.name === 'closing' || c.name === 'summary' ? 'computed' : 'rows sum to'} ${fmtCents(c.rows)} · ${words[c.name]} ${fmtCents(c.printed)} · ${c.ok ? 'match' : 'MISMATCH'}`).join('; ');
  return {
    flat, failedPages, checks, failed, note,
    line: { opening: prevB, credits, debits, computed: prevB === null ? null : (card ? prevB + debits - credits : prevB + credits - debits), printed: newB, diff: null },
  };
}

function pageLevelFailures(st, failedPages) {
  const reasons = new Map();
  st.pages.forEach((p, pi) => {
    let why = null;
    if (p.truncated) why = 'page read was cut short';
    else if (p.schemaError) why = 'page output failed validation';
    else if (p.hasTransactions === true && (p.rows || []).length === 0) why = 'page has transactions but none were read';
    if (why) { failedPages.add(pi); reasons.set(pi, why); }
  });
  return reasons;
}

export function reconcileStatement(st, opts = {}) {
  const reread = new Set(opts.reread || []);
  const anyBalance = st.pages.some((p) => (p.rows || []).some((r) => toCents(r.balance) !== null));
  let res, flipped = false, status, hasChecks;
  if (anyBalance) {
    res = runChain(st, 1);
    if (res.failedPages.size) {
      const f = runChain(st, -1);
      if (f.failedPages.size === 0) { res = f; flipped = true; }
    }
    status = res.failedPages.size ? 'flagged' : 'reconciled';
    hasChecks = true;
  } else {
    res = runTotals(st, 1);
    if (res.failed) {
      const f = runTotals(st, -1);
      if (!f.failed && f.checks.length) { res = f; flipped = true; }
    }
    status = 'unreconciled';
    hasChecks = res.checks.length > 0;
  }
  const pageReasons = pageLevelFailures(st, res.failedPages);
  const rows = [];
  let flaggedRows = 0;
  res.flat.forEach((r, i) => {
    let check;
    if (anyBalance) {
      check = res.flags.has(i) ? `FLAGGED: ${res.flags.get(i)}` : 'ok';
      const lastOnPage = i === res.flat.length - 1 || res.flat[i + 1].pi !== r.pi;
      if (check === 'ok' && lastOnPage && res.pageNotes.has(r.pi)) check = `FLAGGED: ${res.pageNotes.get(r.pi)}`;
      if (check === 'ok' && i === res.flat.length - 1 && res.closingNote) check = `FLAGGED: ${res.closingNote}`;
    } else {
      check = res.failed ? `FLAGGED: ${res.note}` : 'unreconciled';
    }
    if (pageReasons.has(r.pi) && !check.startsWith('FLAGGED')) check = `FLAGGED: ${pageReasons.get(r.pi)}`;
    if (check === 'ok' && reread.has(r.page)) check = 'ok (re-read)';
    if (check.startsWith('FLAGGED')) flaggedRows++;
    rows.push({ page: r.page, n: i + 1, check });
  });
  if (anyBalance && pageReasons.size && status === 'reconciled') status = 'flagged';
  const failedPages = [...res.failedPages].sort((a, b) => a - b).map((pi) => st.pages[pi].page);
  return {
    status,
    failed: failedPages.length > 0,
    flipped,
    failedPages,
    flaggedRows,
    rows,
    line: res.line,
    checks: res.checks || null,
    hasChecks,
    note: anyBalance ? null : (res.note || 'no running balance and no printed totals'),
  };
}

// The one-line reconciliation shown on the page (design.md § The flow, step 3).
export function reconciliationLine(result) {
  const l = result.line;
  if (result.status === 'unreconciled') return `Unreconciled (no running balance)${result.note ? ' · ' + result.note : ''}`;
  const head = `Opening ${fmtCents(l.opening)} + credits ${fmtCents(l.credits)} − debits ${fmtCents(l.debits)} = ${fmtCents(l.computed)}`;
  const tail = l.printed === null ? 'no closing balance printed' : `statement says ${fmtCents(l.printed)}`;
  return `${head} · ${tail} · ${result.status === 'reconciled' ? 'reconciled' : `flagged (${result.flaggedRows} rows)`}`;
}

// Receipts (design.md: fail if subtotal + tax + tip != total (±0.01) when a subtotal is
// printed, if total is missing or <= 0, or if the date does not parse; always labelled
// "unreconciled" with the arithmetic in the note).
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function checkReceipt(r) {
  const total = toCents(r.total);
  const sub = toCents(r.subtotal);
  const tax = toCents(r.tax) ?? 0;
  const tip = toCents(r.tip) ?? 0;
  let why = null, note;
  if (total === null || total <= 0) why = 'total missing';
  else if (!isIsoDate(r.date)) why = 'date not readable';
  if (sub !== null && total !== null) {
    const sum = sub + tax + tip;
    note = `subtotal + tax + tip = ${fmtCents(sum)} · total ${fmtCents(total)}`;
    if (!why && Math.abs(sum - total) > 1) why = `subtotal + tax + tip = ${fmtCents(sum)}, total ${fmtCents(total)}`;
  } else {
    note = 'no subtotal printed';
  }
  return { status: 'unreconciled', failed: why !== null, check: why ? `FLAGGED: ${why}` : 'unreconciled', note };
}
