import { splitFreshListingUrls } from './scrape-nettikone.js';

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

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('scrape plan ok', plan);
