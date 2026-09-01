import {
  classifyInbound,
  extractEmailAddress,
  isBrokerageInterestText,
  isEmailOfferText,
  isNeedsReviewReply,
  isNoCallRequest,
  normalizeInboundClassification,
  persistableInboundClass,
} from '../shared/intent.js';

let failed = 0;

function expect(name, actual, wanted) {
  if (actual !== wanted) {
    console.error(name, { actual, wanted });
    failed += 1;
  }
}

const emailAsk = classifyInbound('Ei käy. Laita kirjallisena sähköpostiin kiitos.');
expect('email ask class', emailAsk.classification, 'needs_review');
expect('email ask human', emailAsk.needs_human, true);
expect('email ask review', isNeedsReviewReply('Ei käy. Laita kirjallisena sähköpostiin kiitos.'), true);

expect('email address is offer', isEmailOfferText('Vaikka sähköpostilla myynti@mktek.fi'), true);
expect('extract email', extractEmailAddress('Vaikka sähköpostilla myynti@mktek.fi'), 'myynti@mktek.fi');
expect('no call is review', isNeedsReviewReply('Ei soitella kiitos'), true);
expect('no call detect', isNoCallRequest('Ei soitella kiitos'), true);
expect('written no phone is review', isNeedsReviewReply('Minulle ei sovi puhua puhelimessa juuri nyt. Voidaanko keskustella mieluummin kirjallisesti'), true);
expect('at work delay is not email', isEmailOfferText('Töissä en voi puhua'), false);
expect('at work delay is not no-call bucket', isNoCallRequest('Töissä en voi puhua'), false);

const hinnasto = 'Ok. Laita palkkio hinnasto niin katsotaan!';
expect('hinnasto is not a review override', isNeedsReviewReply(hinnasto), false);
expect('provikka is brokerage interest', isBrokerageInterestText('Mikä provikka on'), true);
expect('välitys palkkio is brokerage interest', isBrokerageInterestText('Paljon välitys palkkio'), true);

const hardNo = classifyInbound('Ei kiinnosta');
expect('hard no class', hardNo.classification, 'not_interested');
expect('hard no review', isNeedsReviewReply('Ei kiinnosta'), false);

const eiKay = classifyInbound('Ei käy');
expect('ei kay class', eiKay.classification, 'needs_review');
expect('ei kay review', isNeedsReviewReply('Ei käy'), true);

for (const label of ['ready_for_call', 'booked', 'machine_available', 'needs_review', 'interested']) {
  expect(`accept ${label}`, normalizeInboundClassification(label), label);
}
expect('drop garbage', normalizeInboundClassification('call_now'), null);
expect('persist needs_review', persistableInboundClass('needs_review'), 'needs_human');
expect('persist ready_for_call', persistableInboundClass('ready_for_call'), 'interested');
expect('persist machine_available', persistableInboundClass('machine_available'), 'unclear');

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('classify ok');
