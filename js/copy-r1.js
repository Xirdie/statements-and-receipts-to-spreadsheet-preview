// R1 copy (revisions/round-1.md, verbatim where it has the words): the owner test path, the
// reviewer line and the DRY RUN labels. Loaded only when /status says mode "dry" or owner: true,
// so the public site never downloads it (V5 first view). Lines marked "gap" have no text in
// round-1.md and are the smallest honest wording.
const CONTACT = 'business@xirdie.com';

export const R = {
  // 3a: the reviewer line under the greyed button
  reviewerHead: () => 'Test preview: no real checkout here.',
  reviewerDry: () => 'To try the paid flow, enter a test code below: ',
  reviewerDryCodes: () => [['cs_dry_one_1', 'a $9 job'], ['cs_dry_pack_1', 'a 250-page pack'], ['cs_dry_plan_1', 'a monthly plan']],
  reviewerDryTail: () => ' Any number works in place of 1; each $9 code covers one upload. The run returns example rows marked DRY RUN, not rows read from your files.', // first sentence: gap (codes are once per job)
  reviewerOwner: () => "Owner: enter today's owner code below to run the real AI on your files, without paying.",
  fieldLabel: () => 'Test or purchase code',
  useCode: () => 'Use code',

  // 1a: owner code, CTA, run labels
  ownerEntered: () => 'Owner code ready. Press Run owner test; the code is checked when the run starts.', // gap (plan.md: no confirm shape for owner codes)
  ownerRestored: (left, cap) => `Owner test access for today: ${left} of ${cap} pages left, real AI reading of your files, no charge. Ends at 00:00 UTC.`,
  ownerCta: (left) => (left === null || left === undefined ? 'Run owner test' : `Run owner test (${left} pages left today)`),
  ownerUnder: () => 'Preview only. Your files are read by the real AI (Claude Haiku 5.5, Sonnet 5.5 for re-reads) and nothing is charged.',
  ownerOver: (n, left) => `This job needs ${n} scanned pages; owner test access has ${left} left today. Remove files or come back after 00:00 UTC.`,
  ownerBannerHead: () => 'OWNER TEST',
  ownerBannerBody: () => 'Real AI reading of your files on the preview. No payment was taken.',
  doneH2Owner: () => 'Your spreadsheet is ready (owner test)',
  sumOwner: () => 'OWNER TEST: preview run, real AI, no payment.',
  noteOwner: () => 'owner test',
  E33: () => "That code didn't work. Check it and try again, or run the owner script again for today's code.",
  E34: () => 'Too many wrong codes from this connection today. Owner test entry opens again after 00:00 UTC.', // gap (plan.md E34)
  E35: (used, cap) => `Today's owner test pages are used up (${used} of ${cap}). They reset at 00:00 UTC.`,
  E36: () => "Owner test access isn't available on this preview right now.",
  backToPreview: () => 'Back to the preview',

  // 3b: DRY RUN labels
  dryHead: () => 'DRY RUN: example rows, not your files.',
  dryBodySt: () => 'Scanned pages, receipts and text pages that needed the AI reader were not read; the rows marked DRY RUN are made up. Rows from text PDFs that added up were read from your files in this browser.',
  dryBodyRc: () => 'No receipt was read; every row is made up.',
  chipDry: () => 'DRY RUN',
  dryLineNote: () => 'Example figures, not your statement.',
  doneH2Dry: () => 'Example spreadsheet (dry run)',
  sumDry: () => 'DRY RUN: example rows, not your files.',
  noteDry: () => 'DRY RUN example row, not from your file',
  dryCheck: () => 'DRY RUN',
  contact: () => CONTACT,

  // R2 change 3 (revisions/round-2.md): the provider's reason on an owner test only
  notReadDetail: (d) => `NOT READ — provider said: ${d}`,
  notReadNoReply: () => 'NOT READ — no reply from the provider (network or timeout).',
  notReadListHead: () => 'Pages not read (owner test)',
  notReadItem: (file, page, d) => `${file}, page ${page}: ${d ? `provider said: ${d}` : 'no reply from the provider (network or timeout)'}`,
  noteNotRead: (d) => (d ? `provider said: ${d}` : 'no reply from the provider (network or timeout)'),
  sumNotRead: (file, page, d) => `${file} page ${page}: ${d ? `provider said: ${d}` : 'no reply from the provider (network or timeout)'}`,
  E37same: (d) => `Owner test: every page failed — provider said: ${d}. Press Finish the remaining pages to try again; if the same error comes back, the request needs fixing, not your files.`,
  E37diff: (d, n) => `Owner test: every page failed — first error: ${d} (${n} different errors; each page shows its own). Press Finish the remaining pages to try again.`,
};
