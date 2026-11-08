// Every runtime string the page shows, one table keyed by id: design.md § Page copy, § UX
// (S1-S9, E1-E32), § Data handling (AI disclosure), § Safety S1 (disclaimer). Quoted copy is
// verbatim; figures, names and codes are filled at run time. Lines marked "gap" have no text in
// design.md and are the smallest honest wording (listed for the ux-specialist in README.md).
// Usage everywhere: T.key(...args) -> string. A missing key renders "[COPY: key]" (never silent).

const CONTACT = 'business@xirdie.com';
const s = (n, one, many) => (Number(n) === 1 ? one : many);
const andList = (xs) => (xs.length <= 1 ? String(xs[0] ?? '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const cap1 = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const minutes = (sec) => (sec >= 90 ? `about ${Math.round(sec / 60)} minutes left` : sec >= 45 ? 'about a minute left' : 'less than a minute left');

const COPY = {
  // header, toggle, drop zone (S1, S2)
  skipLink: () => 'Skip to the converter',
  skipMain: () => 'Skip to the content', // gap (privacy/terms have no converter)
  toggleLegend: () => 'What are you converting?',
  toggleSt: () => 'Statements',
  toggleRc: () => 'Receipts',
  dropSt: () => 'Drop statement PDFs here, or',
  dropRc: () => 'Drop receipt photos or PDFs here, or',
  chooseFiles: () => 'Choose files',
  chooseMobile: () => 'Choose PDFs or photos',
  dropHint: () => 'PDF, JPG, PNG, WebP or HEIC · up to 50 files · nothing is uploaded until you pay',
  dropHintPaid: () => 'PDF, JPG, PNG, WebP or HEIC · up to 50 files · nothing leaves this tab until you press Run my paid job', // qa #13
  readingFile: (name) => `Reading ${name} in your browser…`,
  photoNote: () => 'Photos are read as statement pages. Converting receipts? Switch to Receipts above.',
  filePages: (n) => `${n} ${s(n, 'page', 'pages')}`,
  fileText: () => 'text',
  fileScanned: () => 'scanned',
  remove: () => 'Remove',
  tryAgain: () => 'Try again',
  reload: () => 'Reload',
  pwLabel: (name) => `Password for ${name}`,
  pwOpen: () => 'Open',
  pwLeave: () => 'Leave this file out',
  pwNote: () => 'The password stays in this tab.',

  // errors E1-E32 (§ UX Error states, exact copy)
  E1: (n) => `One job takes up to 50 files. The last ${n} you added ${s(n, 'was', 'were')} left out.`,
  E1names: (n) => `${s(n, 'The file', `The ${n} files`)} left out`, // gap (the collapsed names)
  E2: (name, mb) => `${name} is ${mb} MB; the limit is 50 MB a file. Download a smaller copy from your bank, or split it by date.`,
  E3: (name) => `${name} can't be read. Sumline reads PDF, JPG, PNG, WebP and HEIC.`,
  E4: (name) => `${name} couldn't be opened; it may be damaged. Download it again and drop it here.`,
  E5: (name) => `That password didn't open ${name}.`,
  E6: (name) => `${name} couldn't be converted in this browser. Share it as a JPEG, or on iPhone set Settings › Camera › Formats to Most Compatible.`,
  E7: () => "The photo reader didn't load. Check your connection and drop the photo again.",
  E8: (n) => `This job has ${n} scanned pages; one job takes up to 250. Remove files to continue.`,
  E9: (n) => `This job has ${n} text pages; one job takes up to 1,000. Remove files to continue.`,
  E10: (n) => `$9 covers up to 60 scanned pages. This job has ${n}: choose the 250-page pack ($29), the monthly plan ($19, 150 pages a month), or remove files.`,
  E11: (page, name) => `Page ${page} of ${name}: the browser found no rows. The AI reader will read it in the paid run (no page cost).`,
  E12: () => "Your browser blocked a new tab. Checkout opens here; after paying you'll choose the same files again (nothing was uploaded).",
  E13: () => "Didn't finish? You weren't charged. Your files are still here.",
  E14: () => "Payments are paused: the converter can't reach its server right now. Your files have not left this tab.",
  E15: () => 'Reading scanned pages is temporarily unavailable; try again in a few minutes.',
  E16: (sid) => `We couldn't confirm your payment yet. Your purchase code is ${sid}. Reload this tab to try again; it stays valid for 30 days. Still stuck? Email ${CONTACT} with the code and we'll fix it or refund you.`,
  E16tool: (sid) => `We couldn't confirm your payment yet. Your purchase code is ${sid}. Press Try again; the code stays valid for 30 days and your files are still in this tab. Still stuck? Email ${CONTACT} with the code and we'll fix it or refund you.`, // qa #10
  E16restore: () => "We couldn't check this code just now. Try Restore again in a minute; the code stays valid.", // qa #10
  E17: () => `This link doesn't match a completed Sumline payment. If you were charged, email ${CONTACT} with the email you paid with and we'll sort it out.`,
  E18: () => 'This $9 purchase was already used for another set of files. Each $9 job covers one upload.',
  E19: () => `This purchase code is more than 30 days old, so its job can't be resumed. Questions: ${CONTACT} with the code.`,
  E20: () => "Your monthly plan isn't active (cancelled, or a payment failed). Restart it in Manage subscription, or pay $9 for this job.",
  E21: (n, left, reset) => `This job needs ${n} scanned pages; your plan has ${left} left${reset ? ` until ${reset}` : ''}. Remove pages, use a pack, or pay $9 for this job.`,
  E22: (left, n) => `Your pack has ${left} pages left; this job needs ${n}. Remove pages, or add a 250-page pack for $29.`,
  E23: (n, cap) => `This job has ${n} scanned pages; your $9 job covers ${cap}. Remove files to bring it to ${cap} or fewer.`,
  E24: () => 'Too many tries from this connection in the last minute. Wait a minute, then press Try again. Your payment and pages are safe.',
  E25: (sec) => `The AI reader is busy; continuing in ${sec} s.`,
  E26: (n, pages) => `${n} ${s(n, "page couldn't", "pages couldn't")} be read yet (${s(n, 'page', 'pages')} ${andList(pages)}). Trying again costs nothing.`,
  E27: (sid, n) => `We could not finish this job. Download the ${n} finished pages (marked INCOMPLETE in the file), or email ${CONTACT} with purchase code ${sid} and we will refund you in full.`,
  E27none: (sid) => `We could not finish this job. Email ${CONTACT} with purchase code ${sid} and we will refund you in full.`, // qa #32 (no page finished)
  E28: () => 'Your paid job stopped before it finished. Drop the same files to resume it; no new charge (once per job).',
  E29: () => "That isn't a purchase code. It starts with cs_live_ and was shown after checkout.",
  E30: () => "The Excel builder didn't load. Check your connection and press Download again, or choose CSV.",
  E32: () => 'Sumline reads your files inside your browser, so it needs JavaScript turned on.',

  // preview (S3) and status wording (S7)
  previewH2: () => 'Your preview',
  previewNote: () => 'Read by code in your browser. No AI was used for this preview.',
  period: (a, b) => `Statement period ${a} to ${b}`,
  mixedNote: (n) => `${n} scanned ${s(n, 'page', 'pages')} in this file ${s(n, 'is', 'are')} read by the AI reader in the paid run; the balance check runs then.`, // gap (mixed PDF)
  showRows: (n) => (n >= 15 ? 'Show the first 15 rows' : `Show the first ${n} ${s(n, 'row', 'rows')}`),
  rowsCaption: (name) => `First rows of ${name}`,
  needAi: (n) => `${n} ${s(n, 'row needs', 'rows need')} the AI reader (included in the paid run)`,
  thumbAlt: (page, name) => `Page ${page} of ${name}`,
  scanCounts: (scan, text) => `${scan} scanned ${s(scan, 'page', 'pages')}${text ? ` · ${text} text ${s(text, 'page', 'pages')} (free, not counted)` : ''}`,
  receiptCounts: (img, text) => `${img} receipt ${s(img, 'image', 'images')}${text ? ` · ${text} receipt ${s(text, 'page', 'pages')} with text` : ''}`,
  chipReconciled: () => 'Reconciled',
  chipFlagged: (n) => `Flagged (${n} ${s(n, 'row', 'rows')})`,
  chipUnreconciled: () => 'Unreconciled',
  lnOpening: () => 'Opening',
  lnCredits: () => '+ credits',
  lnDebits: () => '− debits',
  lnComputed: () => '=',
  lnPrinted: () => 'statement says',
  lnNotPrinted: () => 'not printed',
  lnOffBy: (x) => `off by ${x}`,
  srLine: (o, c, d, comp, printed, status, off) => `Opening balance ${o}, plus credits ${c}, minus debits ${d}, equals ${comp}. ${printed ? `The statement says ${printed}.` : 'The statement prints no closing balance.'} ${status === 'reconciled' ? 'Reconciled.' : `Flagged${off ? `: off by ${off}` : ''}.`}`,
  lineCard: (rows, printed, ok, diff, name) => `Rows sum to ${rows} · statement's ${name === 'debits' ? 'debits' : 'charges'} total ${printed} · ${ok ? 'totals match' : `totals differ by ${diff}`}. No running balance, so each row can't be checked on its own.`, // qa #16
  lineNoBalance: () => 'Unreconciled (no running balance). This statement prints no balance to check the rows against; check the total yourself.',
  lineReceipts: (ok, total, flagged) => `Unreconciled (receipts have no balance to check against). Subtotal + tax + tip = total on ${ok} of ${total} receipts; ${flagged} flagged.`,
  notReadRow: (page) => `NOT READ: page ${page}`,
  incomplete: (n) => `INCOMPLETE: ${n} ${s(n, 'page', 'pages')} not read`,

  // price box (S3) and returning buyers (S8)
  jobLine: (st, total, scan, text, fit) => `This job: ${st ? `${st} ${s(st, 'statement', 'statements')} · ` : ''}${total} ${s(total, 'page', 'pages')} (${scan} scanned, ${text} text) · ${fit}`, // qa #34: photos count as pages
  jobLineReceipts: (n, fit) => `This job: ${n} ${s(n, 'receipt', 'receipts')} · ${fit}`,
  fitOne: () => 'fits the $9 job (60 scanned pages)',
  fitText: () => 'the $9 job: all rows, reconciliation check, XLSX + CSV', // CEO 11:4x: a text-only job
  fitOver: () => 'more than the $9 job covers: choose the 250-page pack ($29), the monthly plan ($19, 150 pages a month), or remove files',
  fitNone: () => 'remove files',
  plansLegend: () => 'Choose how to pay',
  planOne: () => '$9 · this job (up to 60 scanned pages)',
  planOneText: () => '$9 · this job: all rows, reconciliation check, XLSX + CSV', // CEO 11:4x
  planMonthly: () => '$19 a month · 150 pages a month, cancel any time in Manage subscription (footer)', // qa #38
  planPack: () => '$29 · 250 pages, no expiry',
  packLink: () => 'Catching up a year? 250 pages for $29',
  anchorLine: () => 'Typing up 60 pages by hand is about a $100 freelance job. This is $9, checked against the balance.',
  ctaOne: () => 'Convert this job: $9',
  ctaPlan: () => 'Monthly: $19 (150 pages)',
  ctaPack: () => 'Pack: $29 (250 pages)',
  underCta: () => 'Secure checkout by Stripe opens in a new tab. Your files stay here.',
  checkoutOff: () => "Checkout isn't connected on this copy of the site.", // gap (preview without test links)
  runPlan: (left) => `Run with my plan (${left} pages left)`,
  usePack: (left) => `Use my pack (${left} left)`,
  buySomethingElse: () => 'Buy something else',
  resumeOne: () => 'Resume my $9 job (same files)',
  runPaid: () => 'Run my paid job',

  // pay (S4)
  payPanel: () => 'Checkout is open in a new tab. Pay there and your job starts here by itself.',
  payPhone: () => 'On a phone, come back to this tab after paying.',
  reopenCheckout: () => 'Reopen checkout',
  changePlan: () => 'Change plan',
  continueCheckout: () => 'Continue to checkout',

  // paid.html (S5)
  paidChecking: () => 'Checking your payment…', // gap (before /verify answers)
  paidProblemH1: () => "We couldn't confirm this payment", // gap (E16/E17 heading)
  paidH1: (what) => `Payment received: Sumline ${what}`,
  kindOne: () => '$9 job',
  kindPlan: () => 'monthly plan',
  kindPack: () => '250-page pack',
  codeLabel: () => 'Your purchase code',
  copyBtn: () => 'Copy',
  copied: () => 'Copied',
  keepCode: () => 'Keep it to use remaining pages on another device.',
  keepCodeOne: () => 'Keep it in case you need support or a refund.', // qa #33, buyer #10
  ackLine: () => 'Your files are in your other tab; this tab can close.',
  closeTab: () => 'Close this tab',
  switchBack: () => 'Switch back to your Sumline tab.',
  noAckLine: () => 'If Sumline is still open in another tab with your files, go back to it: your job starts there. Closed it? Drop the same files here to run your job.',
  claimedLine: () => 'Your job is running in your other tab.',
  backToSumline: () => 'Back to Sumline',

  // paid output (S6)
  runH2: () => 'Converting your job',
  progressStart: () => 'Starting your job…', // gap (before the first batch)
  progress: (i, n, sec) => `Reading page ${i} of ${n}, ${minutes(sec)}`,
  keepOpen: () => 'Keep this tab open until it finishes.',
  rerunLine: (n) => `${n} ${s(n, "page didn't", "pages didn't")} add up. Re-reading ${s(n, 'it', 'them')} with a stronger model, free.`,
  finish: () => 'Finish the remaining pages',
  downloadFinished: (n) => `Download the ${n} finished pages`,
  doneH2: () => 'Your spreadsheet is ready',
  resultCaption: () => 'Your rows, with the check for each',
  flagReason: (reason, page, reread) => `${cap1(reason)}, on page ${page}.${reread ? ' Re-read once by a stronger model; still off.' : ''} Check it against page ${page} of your statement.`, // qa #27
  previewReread: () => 'The paid run reads this page again with the AI reader (no page cost).', // qa #9
  tooLongNote: () => 'This page is too long for the AI re-read; its rows stay flagged in the file.', // qa #9 (O1 pages)
  refundLead: () => 'Not happy with the flagged rows?',
  refundLink: () => 'Request a refund',
  refundSubject: (sid) => `Sumline refund request ${sid}`,
  refundBody: (sid, files, n) => `Purchase code: ${sid}\nStatement file: ${files}\nFlagged rows: ${n}\n\nPlease don't paste account numbers.`,
  disclosureLabel: () => 'Automated output: AI-extracted. Check against your statement before use. Not tax or accounting advice.',
  aiDisclosure: () => "Automated extraction. Scanned pages and receipts are read by AI (Claude Haiku 5.5 by Anthropic; pages whose balance didn't add up are re-read by Claude Sonnet 5.5) and checked by arithmetic, not by a person. Text PDFs are read by code in your browser.",
  browserOnly: () => 'This job was read by code in your browser; no AI was used.',
  receiptsNote: () => 'Categories are suggestions, not advice.',
  formatLegend: () => 'File format',
  fmtXlsx: () => 'Excel (.xlsx)',
  fmtCsv: () => 'CSV',
  download: (f) => `Download spreadsheet (.${f === 'csv' ? 'csv' : 'xlsx'})`,
  cleared: () => 'Your files and page images were cleared from this tab.',
  downloadToo: (f) => (f === 'csv' ? 'Download as CSV too' : 'Download as Excel too'),
  clearNow: () => 'Clear now',
  convertMore: () => 'Convert more files',
  offerLine: () => 'Doing this monthly? $19/month for 150 pages · Catching up a year? 250 pages for $29',
  planLeft: (left, reset) => `${left} pages left${reset ? ` until ${reset}` : ''}`,
  packLeft: (n) => `${n} pack pages left`,
  clearedAll: () => 'Everything was cleared from this tab.',
  manageSub: () => 'Manage subscription (opens Stripe)',

  // table column headings (page); the file's own header row is in output.js
  col_file: () => 'File', col_page: () => 'Page', col_date: () => 'Date', col_description: () => 'Description',
  col_debit: () => 'Debit', col_credit: () => 'Credit', col_amount: () => 'Amount', col_balance: () => 'Balance',
  col_check: () => 'Check', col_image: () => 'Image', col_vendor: () => 'Vendor', col_tax: () => 'Tax',
  col_total: () => 'Total', col_currency: () => 'Currency', col_category: () => 'Category (suggestion)',

  // inside the file (D14, S1)
  checkHeader: () => 'check (AI-extracted; check against your statement before use; not tax or accounting advice)',
  sumAutomated: () => 'Automated output: read by AI and by code, checked by arithmetic, not by a person.',
  sumModels: (m) => `Models: ${m}`,
  sumRunDate: (d) => `Run date: ${d}`,
  sumLegend: () => 'Status legend: ok = the row carries the balance forward · ok (re-read) = re-read once by a stronger model, now adds up · FLAGGED = does not add up, check it against your statement · NOT READ = the page could not be read · unreconciled = no running balance to check against',
  sumColStatement: () => 'Statement', sumColOpening: () => 'Opening', sumColCredits: () => 'Credits', sumColDebits: () => 'Debits',
  sumColComputed: () => 'Computed closing', sumColPrinted: () => 'Printed closing', sumColDifference: () => 'Difference', sumColStatus: () => 'Status',

  // footer (S9), Restore / Forget (S8), Report a problem
  footerNav: () => 'Sumline',
  footReport: () => 'Report a problem',
  footManage: () => 'Manage subscription',
  newTabStripe: () => '(opens Stripe in a new tab)', // qa #30, visually hidden
  reportLink: () => 'Report a problem',
  runFiles: (files, pages, scan, text) => `${files} ${s(files, 'file', 'files')} · ${pages} ${s(pages, 'page', 'pages')} (${scan} scanned, ${text} text)`, // qa #11
  footRestore: () => 'Restore purchase',
  footForget: () => 'Forget my purchases',
  footPrivacy: () => 'Privacy',
  footTerms: () => 'Terms',
  footHub: () => 'More tools',
  contactLead: () => 'Contact:',
  restoreLabel: () => 'Purchase code',
  restoreBtn: () => 'Restore',
  restoreLabelTest: () => 'Purchase or test code', // R1 1a: dry or owner preview only
  runOne: () => 'Run my $9 job', // R1 note 2
  usesCode: (last4) => `Uses purchase code cs_…${last4}`, // R1 note 2
  restoredPlan: (left, reset) => `Restored: Sumline monthly plan, ${left} pages left${reset ? ` until ${reset}` : ''}.`,
  restoredPack: (left) => `Restored: Sumline 250-page pack, ${left} pages left.`,
  restoredOne: (unused) => (unused ? 'Restored: Sumline $9 job, not used yet.' : 'Restored: Sumline $9 job, already used.'), // "already used": gap
  forgetPrompt: (n) => `Forget ${n} purchase ${s(n, 'code', 'codes')} saved in this browser? Pages left stay on your purchase; you'll need the code to use them again.`,
  forgetNone: () => 'No purchase codes are saved in this browser.', // gap
  forgotten: () => 'Forgotten. No purchase codes are saved in this browser now.', // gap
  forgetBtn: () => 'Forget',
  keepBtn: () => 'Keep',
  bugWhat: () => 'What happened? (required)',
  bugHint: () => "Please don't paste account numbers or statement rows.",
  bugEmail: () => 'Your email (optional, only to reply)',
  bugAlso: () => "We'll also send this page's address, your browser, and your purchase code if this browser has one.",
  bugSee: () => 'See exactly what we send',
  bugSend: () => 'Send report',
  bugSent: (id) => `Thanks. Your report id is ${id}. Quote it if you email ${CONTACT}. We read reports weekly and reply if you left an email.`, // qa #37
  bugWait: () => 'Still checking, press Send again in a second.', // qa #37
  bug429all: () => `Reports are full for today: email ${CONTACT}`, // plan.md BUG_GLOBAL_PER_DAY (CTO 13:50), qa #41
  bug429: () => `You've sent 5 reports today, the daily limit. Please email ${CONTACT} instead.`,
  bug403: () => `The anti-bot check didn't pass. Try again, or email ${CONTACT}.`,
  bugNetwork: () => "Couldn't send. Your text is still here; try again.",
  bugRequired: () => 'Please say what happened first.', // gap
};

const missing = (k) => (...a) => `[COPY: ${String(k)}${a.length ? ' | ' + a.map((x) => String(x)).join(' | ') : ''}]`;
export const T = new Proxy(COPY, { get: (o, k) => (typeof k === 'string' && k in o ? o[k] : missing(k)) });
export const COPY_KEYS = Object.keys(COPY);
