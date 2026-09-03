import {
  applyCallLog,
  applyLabels,
  formatActivityWhen,
  listingCallFields,
  mergeActivity,
  nextMorningHelsinki,
  outcomeLabel,
} from '../shared/call-log.js';

let failed = 0;

function expect(name, actual, wanted) {
  if (actual !== wanted) {
    console.error(name, { actual, wanted });
    failed += 1;
  }
}

function expectTruthy(name, actual) {
  if (!actual) {
    console.error(name, { actual });
    failed += 1;
  }
}

const summer = nextMorningHelsinki(new Date('2026-09-01T12:00:00.000Z'));
expect('summer next morning utc', summer.toISOString(), '2026-09-02T06:00:00.000Z');
expect(
  'summer next morning helsinki hour',
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', hour12: false }).format(summer),
  '09'
);

const winter = nextMorningHelsinki(new Date('2026-01-15T12:00:00.000Z'));
expect('winter next morning utc', winter.toISOString(), '2026-01-16T07:00:00.000Z');

const deal = applyCallLog({
  listing: { desk_status: 'Callback', raw_data: { desk_status: 'Callback' } },
  outcome: 'deal',
  comment: '199€ deal',
  now: new Date('2026-09-01T03:45:00.000Z'),
});
expect('deal status', deal.desk_status, 'Deal Won');
expect('deal log outcome', deal.entry.outcome, 'deal');
expect('deal comment', deal.entry.comment, '199€ deal');
expect('deal log length', deal.raw_data.call_log.length, 1);

const lost = applyCallLog({ listing: {}, outcome: 'lost', now: new Date('2026-09-01T04:00:00.000Z') });
expect('lost status', lost.desk_status, 'Deal Lost');

const noAnswer = applyCallLog({
  listing: { desk_status: 'Callback' },
  outcome: 'no_answer',
  now: new Date('2026-09-01T04:00:00.000Z'),
});
expect('no answer status', noAnswer.desk_status, 'No Answer');
expect('no answer no snooze', noAnswer.entry.snooze_until, null);

const voicemail = applyCallLog({
  listing: { desk_status: 'Callback', raw_data: { desk_status: 'Callback' } },
  outcome: 'voicemail',
  now: new Date('2026-09-01T04:00:00.000Z'),
});
expect('voicemail keeps call now', voicemail.desk_status, 'Callback');

const wrong = applyCallLog({ listing: { desk_status: 'Callback' }, outcome: 'wrong_number' });
expect('wrong number', wrong.desk_status, 'Not Interested');

const callback = applyCallLog({
  listing: { desk_status: 'Interested' },
  outcome: 'callback',
  now: new Date('2026-09-01T12:00:00.000Z'),
});
expect('callback status', callback.desk_status, 'Callback');
expect('callback scheduled', callback.raw_data.callback_at, '2026-09-02T06:00:00.000Z');

const snoozeOnly = applyCallLog({
  listing: { desk_status: 'No Answer', raw_data: { desk_status: 'No Answer' } },
  snooze: true,
  comment: 'Try again tomorrow',
  now: new Date('2026-09-01T12:00:00.000Z'),
});
expect('snooze becomes call now', snoozeOnly.desk_status, 'Callback');
expect('snooze when', snoozeOnly.raw_data.callback_at, '2026-09-02T06:00:00.000Z');
expect('snooze outcome', snoozeOnly.entry.outcome, 'snooze');

const snoozeDeal = applyCallLog({
  listing: { desk_status: 'Callback' },
  outcome: 'deal',
  snooze: true,
  now: new Date('2026-09-01T12:00:00.000Z'),
});
expect('deal stays won when snoozed', snoozeDeal.desk_status, 'Deal Won');

let threw = false;
try {
  applyCallLog({ listing: {} });
} catch (error) {
  threw = error.status === 400;
}
expectTruthy('empty call rejected', threw);

let badOutcome = false;
try {
  applyCallLog({ listing: {}, outcome: 'hang_up' });
} catch (error) {
  badOutcome = error.status === 400;
}
expectTruthy('unknown outcome rejected', badOutcome);

const activity = mergeActivity(
  [
    { id: 'm1', direction: 'outbound', message: 'Moi', at: '2026-08-31T05:18:00.000Z' },
    { id: 'm2', direction: 'inbound', message: 'Joo', at: '2026-08-31T14:01:00.000Z' },
  ],
  [{ id: 'c1', at: '2026-09-01T03:45:00.000Z', outcome: 'deal', comment: '199€ deal' }]
);
expect('activity first is call', activity[0].kind, 'call');
expect('activity call title', activity[0].title, 'Deal — 199€ deal');
expect('activity reply title', activity[1].title, 'Customer replied');
expect('activity out title', activity[2].title, 'Outbound message sent');
expect('outcome label', outcomeLabel('no_answer'), 'No answer');

const fields = listingCallFields({
  raw_data: {
    call_log: [{ id: 'c1' }],
    callback_at: '2026-09-02T06:00:00.000Z',
    last_call_at: '2026-09-01T03:45:00.000Z',
    last_call_outcome: 'deal',
  },
});
expect('fields log', fields.call_log.length, 1);
expect('fields callback', fields.callback_at, '2026-09-02T06:00:00.000Z');
expect('activity when', formatActivityWhen('2026-09-01T03:45:00.000Z'), '01 Sept, 06:45');

const labelled = applyLabels({ listing: { raw_data: { labels: ['Hot'] } }, add: 'Email' });
expect('add label', labelled.labels.join(','), 'Hot,Email');
const dropped = applyLabels({ listing: { raw_data: labelled.raw_data }, remove: 'hot' });
expect('remove label case-insensitive', dropped.labels.join(','), 'Email');
expect('fields labels', listingCallFields({ raw_data: { labels: ['Hot', 'Hot', ''] } }).labels.join(','), 'Hot');

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('call-log ok');
