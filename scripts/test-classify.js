import { classifyInbound, isNeedsReviewReply } from '../shared/intent.js';

let failed = 0;

function expect(name, actual, wanted) {
  if (actual !== wanted) {
    console.error(name, { actual, wanted });
    failed += 1;
  }
}

const emailAsk = classifyInbound('Ei käy. Laita kirjallisena sähköpostiin kiitos.');
expect('email ask class', emailAsk.classification, 'unclear');
expect('email ask human', emailAsk.needs_human, true);
expect('email ask review', isNeedsReviewReply('Ei käy. Laita kirjallisena sähköpostiin kiitos.'), true);

const hinnasto = 'Ok. Laita palkkio hinnasto niin katsotaan!';
expect('hinnasto is not a review override', isNeedsReviewReply(hinnasto), false);

const hardNo = classifyInbound('Ei kiinnosta');
expect('hard no class', hardNo.classification, 'not_interested');
expect('hard no review', isNeedsReviewReply('Ei kiinnosta'), false);

const eiKay = classifyInbound('Ei käy');
expect('ei kay class', eiKay.classification, 'unclear');
expect('ei kay review', isNeedsReviewReply('Ei käy'), true);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('classify ok');
