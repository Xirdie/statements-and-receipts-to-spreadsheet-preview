// Output builder (D14, D15, D16): rows -> CSV (RFC 4180) or XLSX (SheetJS, loaded only on an
// XLSX download; E30 if it fails). The `check` column header carries the disclaimer; the
// Transactions sheet and the CSV hold no note rows (import-ready); the XLSX Summary sheet opens
// with the disclaimer and the AI disclosure, then the per-statement reconciliation and
// INCOMPLETE when pages were NOT READ.
import { T } from './copy.js';
import { fmtCents } from './reconcile.js';

const ST_COLS = ['file', 'page', 'date', 'description', 'debit', 'credit', 'amount', 'balance', '#check', 'note'];
const RC_COLS = ['file', 'image', 'date', 'vendor', 'subtotal', 'tax', 'tip', 'total', 'currency', 'payment', 'card_last4', 'category (suggestion)', '#check', 'note'];
const NUM = new Set(['debit', 'credit', 'amount', 'balance', 'subtotal', 'tax', 'tip', 'total']);
const KEY = { 'category (suggestion)': 'category' };

export function columns(mode) {
  return (mode === 'rc' ? RC_COLS : ST_COLS).map((c) => (c === '#check' ? T.checkHeader() : c));
}

function cellValue(col, row) {
  if (col === '#check') return row.check ?? '';
  const k = KEY[col] || col;
  const v = row[k];
  if (v === null || v === undefined) return '';
  if (NUM.has(k)) return Number.isFinite(Number(v)) ? Number(v) : '';
  return v;
}

// Spreadsheet-formula guard for text cells (CSV only; XLSX stores strings as strings).
function safeText(s) {
  const t = String(s);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function csvField(v) {
  const s = typeof v === 'number' ? v.toFixed(2) : safeText(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCsv(mode, rows) {
  const cols = mode === 'rc' ? RC_COLS : ST_COLS;
  const lines = [columns(mode).map(csvField).join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => {
      const v = cellValue(c, r);
      return (c === 'page' || c === 'image') && v !== '' ? String(v) : csvField(v);
    }).join(','));
  }
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

let xlsxP = null;
export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxP) {
    xlsxP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/xlsx.mini.min.js', import.meta.url).href;
      s.async = true;
      s.onload = () => (window.XLSX ? res(window.XLSX) : rej(new Error('xlsx')));
      s.onerror = () => { s.remove(); rej(new Error('xlsx')); };
      document.head.append(s);
    });
    xlsxP.catch(() => { xlsxP = null; });
  }
  return xlsxP;
}

const money = (c) => (c === null || c === undefined ? '' : Number((c / 100).toFixed(2)));

// summary: {units, mode, models: [..], runDate, browserOnly, notReadPages}
function summaryAoa(job, info) {
  const aoa = [
    [T.disclosureLabel()],
    [info.browserOnly ? T.browserOnly() : T.aiDisclosure()],
    [T.sumAutomated()],
    [T.sumModels(info.models.join(', ') || '-')],
    [T.sumRunDate(info.runDate)],
    [T.sumLegend()],
  ];
  if (job.mode === 'rc') aoa.push([T.receiptsNote()]);
  aoa.push([]);
  if (job.mode === 'st') {
    aoa.push([T.sumColStatement(), T.sumColOpening(), T.sumColCredits(), T.sumColDebits(), T.sumColComputed(), T.sumColPrinted(), T.sumColDifference(), T.sumColStatus()]);
    for (const u of job.units) {
      const r = u.result;
      if (!r) { aoa.push([u.name, '', '', '', '', '', '', T.chipUnreconciled()]); continue; }
      const l = r.line;
      const status = r.status === 'reconciled' ? T.chipReconciled() : r.status === 'flagged' ? T.chipFlagged(r.flaggedRows) : T.chipUnreconciled();
      aoa.push([u.name, money(l.opening), money(l.credits), money(l.debits), money(l.computed), money(l.printed), l.diff === null ? '' : money(l.diff), status]);
    }
  } else {
    aoa.push([T.lineReceipts(job.summary.okReceipts, job.summary.receipts, job.summary.flaggedReceipts)]);
  }
  if (job.summary.notReadPages.length) {
    aoa.push([]);
    aoa.push([T.incomplete(job.summary.notReadPages.length)]);
  }
  return aoa;
}

export async function buildXlsx(job, rows, info) {
  const XLSX = await loadXlsx();
  const cols = job.mode === 'rc' ? RC_COLS : ST_COLS;
  const data = [columns(job.mode), ...rows.map((r) => cols.map((c) => cellValue(c, r)))];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = cols.map((c) => ({ wch: c === 'description' || c === 'vendor' ? 40 : c === '#check' ? 34 : c === 'file' ? 22 : 12 }));
  XLSX.utils.book_append_sheet(wb, ws, job.mode === 'rc' ? 'Receipts' : 'Transactions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa(job, info)), 'Summary');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function fileName(ext, d = new Date()) {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `sumline-${iso}.${ext}`;
}

// Hands the file to the browser, then revokes the object URL.
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export { fmtCents };
