// Public constants mirrored from worker/src/constants.js (plan.md § Constants). The Worker
// enforces every one of these; the browser mirrors them so a legitimate job never hits a 4xx.
// Change a value in constants.js first, then here.

export const CAP = { one: 60, plan: 150, pack: 250 };            // scanned pages / receipt images per job
export const TEXT_ALLOWANCE = { one: 200, plan: 300, pack: 200 }; // text-fallback pages per job (D8)
export const PRICE = { one: 9, plan: 19, pack: 29 };              // USD, owner-approved round 1

export const MAX_FILES = 50;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES_IMG = 250;   // scanned pages or receipt images per job (D18)
export const MAX_PAGES_TEXT = 1000; // text pages per job (D18)

export const MAX_BATCH_DEFAULT = 8;   // /status.batch overrides it
export const SONNET_BATCH = 6;        // parts per Sonnet-ticket /pages request (O2)
export const BATCH_BYTES = 3500000;   // base64 bytes per /pages request (CTO 2)
export const TEXT_PAGE_CHARS = 8000;  // a longer text page is never sent (O1)

export const IMG_LONG_EDGE = 1568;
export const IMG_TOKEN_TARGET = 2464; // browser target; the Worker refuses > 2,500 by SOF
export const IMG_MAX_BYTES = 450 * 1000;
export const JPEG_QUALITIES = [0.8, 0.7, 0.6, 0.5];
export const THUMB_PX = 96;

export const TEXT_ITEMS_MIN = 20;     // a page is "text" with >= 20 text items containing digits
export const PREVIEW_ROWS = 15;       // D2
export const PLAN_PRESELECT_ABOVE = 20; // monthly pre-selected above 20 scanned pages (D20)

export const STATUS_TIMEOUT_MS = 5000;
export const VERIFY_TIMEOUT_MS = 15000;
export const VERIFY_RETRY_MS = [1000, 3000, 9000];
export const PAGES_TIMEOUT_MS = 90000;
export const PAGE_RETRY_MS = [2000, 6000, 15000]; // up to 3 attempts per page
export const DEFAULT_RETRY_AFTER_S = 10;
export const BUG_TIMEOUT_MS = 15000;
export const ACK_WAIT_MS = 2000;      // paid.html becomes the tool after 2 s with no ack
export const POPUP_FALLBACK_MS = 2000;
export const PROGRESS_EVERY_MS = 5000;
export const ONE_OFF_MAX_AGE_DAYS = 29;

// Purchase codes. Dry ids exist only on a dry-mode Worker; the Worker is the judge
// (a live Worker answers 400 bad-session to a cs_dry_ id, CTO 6).
export const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{20,80}$/;
export const DRY_SESSION_RE = /^cs_dry_(one|pack|plan)_[0-9]{1,6}$/;
export const isSessionId = (s) => typeof s === 'string' && (SESSION_RE.test(s) || DRY_SESSION_RE.test(s));

// Storage keys (tools.xirdie.com hosts several products on one origin, so every key is prefixed).
export const LS_PURCHASES = 'sumline.purchases';
export const SS_UTM = 'sumline.utm';
export const CHANNEL = 'sumline';

// Payment Link kinds (config.js) -> the Worker's kinds.
export const KIND_OF_LINK = { one_off: 'one', pack: 'pack', monthly: 'plan' };
export const LINK_OF_KIND = { one: 'one_off', pack: 'pack', plan: 'monthly' };

export const MODELS = { haiku: 'Claude Haiku 5.5', sonnet: 'Claude Sonnet 5.5' };

// R1 owner test path (plan.md § Owner test path): a 12-character Crockford base32 code, typed as
// XXXX-XXXX-XXXX (hyphens, spaces and case ignored). PREVIEW-ONLY (CTO R1 ruling): the page accepts
// it only when /status.owner is true, which the shipped Worker never reports; no URL entry exists.
export const normaliseOwner = (s) => String(s || '').toUpperCase().replace(/[\s-]+/g, '');
export const isOwnerCode = (s) => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(normaliseOwner(s));
