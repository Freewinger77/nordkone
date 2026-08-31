import { looksLikeBadPrice, mapPool, splitFreshListingUrls } from './scrape-nettikone.js';

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

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('scrape plan ok', plan);
