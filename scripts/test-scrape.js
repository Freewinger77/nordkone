import { isListingLive, sortOutreachListings } from '../api/lib/campaign.js';
import { buildCatalogDiff, isListingActive, looksLikeBadPrice, mapPool, removalPatch, splitFreshListingUrls } from './scrape-nettikone.js';

let failed = 0;

const known = new Set(['2668627', '2655984']);
const seen = new Set();
const plan = splitFreshListingUrls(
  [
    'https://www.nettikone.com/kaivinkone/hitachi/2668627',
    'https://www.nettikone.com/kaivinkone/new/2777001',
    'https://www.nettikone.com/kaivinkone/hitachi/2668627',
    'https://www.nettikone.com/kaivinkone/lokomo/2655984',
  ],
  known,
  seen
);

if (plan.fresh.length !== 1 || !plan.fresh[0].includes('2777001')) {
  console.error('fresh urls should keep only unknown listings', plan);
  failed += 1;
}
if (plan.existing !== 2 || plan.discovered !== 3) {
  console.error('known listings should be skipped once', plan);
  failed += 1;
}

const emptyPage = splitFreshListingUrls(
  ['https://www.nettikone.com/kaivinkone/hitachi/2668627'],
  known,
  new Set()
);
if (emptyPage.fresh.length !== 0 || emptyPage.existing !== 1) {
  console.error('all-known page should have no fresh urls', emptyPage);
  failed += 1;
}

const poolSeen = [];
const pooled = await mapPool([1, 2, 3, 4, 5], 2, async (value) => {
  poolSeen.push(value);
  return value * 2;
});
if (pooled.join(',') !== '2,4,6,8,10' || poolSeen.length !== 5) {
  console.error('mapPool should keep order and visit every item', pooled, poolSeen);
  failed += 1;
}

if (looksLikeBadPrice(2_091_615, 119_225) !== true || looksLikeBadPrice(62_000, 60_000) !== false) {
  console.error('price guard should drop concatenated prices and keep modest moves');
  failed += 1;
}

const diff = buildCatalogDiff(new Set(['100', '200']), [
  { nettikone_id: '100', status: 'eligible', raw_data: {} },
  { nettikone_id: '300', status: 'eligible', raw_data: {} },
  { nettikone_id: '400', status: 'sold', raw_data: { listing_active: false } },
]);
if (diff.reseen.length !== 1 || diff.newIds.join(',') !== '200' || diff.removed.length !== 1 || diff.removed[0].nettikone_id !== '300') {
  console.error('catalog diff should split reseen, new, and removed', diff);
  failed += 1;
}
if (isListingActive({ raw_data: { listing_active: false } }) !== false) {
  console.error('inactive listing should not count as active');
  failed += 1;
}
const removedPatch = removalPatch({ status: 'eligible', raw_data: { desk_status: 'Callback' } }, '2026-09-03T12:00:00.000Z');
if (removedPatch.status !== 'ignored' || removedPatch.ineligible_reason !== 'removed_from_nettikone' || removedPatch.raw_data.listing_active !== false) {
  console.error('removal patch should mark eligible listings as taken down', removedPatch);
  failed += 1;
}
const keptPatch = removalPatch({ status: 'replied', raw_data: {} }, '2026-09-03T12:00:00.000Z');
if (keptPatch.status !== undefined || keptPatch.raw_data.removal_reason !== 'not_in_search_index') {
  console.error('removal patch should keep workflow status on messaged leads', keptPatch);
  failed += 1;
}

const ranked = sortOutreachListings([
  { nettikone_id: 'old', last_seen_at: '2026-06-01T00:00:00.000Z', first_seen_at: '2026-06-01T00:00:00.000Z', raw_data: { listing_active: true } },
  { nettikone_id: 'gone', last_seen_at: '2026-08-31T00:00:00.000Z', first_seen_at: '2026-08-01T00:00:00.000Z', raw_data: { listing_active: false } },
  { nettikone_id: 'fresh', last_seen_at: '2026-09-03T16:00:00.000Z', first_seen_at: '2026-09-03T16:00:00.000Z', raw_data: {} },
]);
if (ranked.map((row) => row.nettikone_id).join(',') !== 'fresh,old,gone') {
  console.error('outreach queue should put live freshest first and taken-down last', ranked);
  failed += 1;
}
if (isListingLive({ listing_active: false }) !== false || isListingLive({ raw_data: {} }) !== true) {
  console.error('live check should treat missing listing_active as live');
  failed += 1;
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('scrape plan ok', plan);
