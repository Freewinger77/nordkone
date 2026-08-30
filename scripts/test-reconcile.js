import { countFlow, isOpenOpportunity, matchesFlowFilter, reconcileLead } from '../shared/reconcile.js';

const now = Date.parse('2026-08-29T18:00:00.000Z');

function lead(input) {
  return { id: input.listing?.nettikone_id || input.conversation?.source_customer_id, ...reconcileLead({ ...input, now }) };
}

const fixtures = [
  lead({
    listing: { nettikone_id: 'sold-1', status: 'sold', price_text: '10 000 €' },
    conversation: { status: 'sold', interest_status: 'sold', last_inbound_at: '2026-08-01', inbound_count: 1 },
  }),
  lead({
    listing: { nettikone_id: 'int-1', status: 'interested' },
    conversation: { status: 'interested', interest_status: 'interested', last_inbound_at: '2026-08-20', inbound_count: 1 },
  }),
  lead({
    listing: { nettikone_id: 'call-1', status: 'interested' },
    conversation: {
      status: 'interested',
      interest_status: 'interested',
      derived_status: 'ready_for_call',
      last_inbound_at: '2026-08-29',
      inbound_count: 2,
      outbound_count: 3,
      messages: [
        { direction: 'outbound' },
        { direction: 'inbound', classification: 'interested' },
        { direction: 'outbound' },
        { direction: 'inbound', classification: 'interested' },
        { direction: 'outbound' },
      ],
    },
  }),
  lead({
    listing: { nettikone_id: 'book-1', status: 'replied' },
    conversation: {
      status: 'replied',
      interest_status: 'unclear',
      last_inbound_at: '2026-08-29',
      inbound_count: 2,
      calendar_booking: { event_id: 'e1', start: '2026-08-29T10:00:00.000Z', status: 'booked' },
    },
  }),
  lead({
    listing: { nettikone_id: 'old-book', status: 'interested' },
    conversation: {
      status: 'interested',
      interest_status: 'interested',
      last_inbound_at: '2026-07-21',
      inbound_count: 1,
      calendar_booking: { event_id: 'old', start: '2026-07-21T16:00:00.000Z', status: 'booked', attendee_response: 'declined' },
    },
  }),
  lead({
    listing: { nettikone_id: 'silent', status: 'contacted' },
    conversation: { status: 'contacted', inbound_count: 0 },
  }),
  lead({
    listing: { nettikone_id: 'nope', status: 'not_interested' },
    conversation: { status: 'not_interested', interest_status: 'not_interested', last_inbound_at: '2026-08-10', inbound_count: 2 },
  }),
  lead({
    listing: { nettikone_id: 'review', status: 'replied' },
    conversation: { status: 'replied', interest_status: 'unclear', last_inbound_at: '2026-08-28', inbound_count: 1 },
  }),
  lead({
    listing: { nettikone_id: 'won-1', desk_status: 'Deal Won', status: 'interested' },
    conversation: { status: 'interested', interest_status: 'interested', last_inbound_at: '2026-08-22', inbound_count: 1 },
  }),
  lead({
    listing: { nettikone_id: 'mixed', status: 'not_interested' },
    conversation: {
      status: 'not_interested',
      interest_status: 'not_interested',
      last_inbound_at: '2026-08-12',
      inbound_count: 2,
      messages: [
        { direction: 'inbound', classification: 'not_interested' },
        { direction: 'inbound', classification: 'interested' },
      ],
    },
  }),
];

const counts = countFlow(fixtures, { eligible: 10 });
const expectCounts = {
    messaged: 10,
    replied: 9,
    noreply: 1,
    interested: 1,
    notint: 2,
  review: 1,
  won: 1,
  lost: 1,
  booked: 1,
  callback: 1,
  await: 1,
};

const stages = Object.fromEntries(fixtures.map((row) => [row.id, row.stage]));
const expectStages = {
  'sold-1': 'Deal Lost',
  'int-1': 'Replied',
  'call-1': 'Callback',
  'book-1': 'Booked',
  'old-book': 'Replied',
  silent: 'No Answer',
  nope: 'Not Interested',
  review: 'Review',
  'won-1': 'Deal Won',
  mixed: 'Not Interested',
};

let failed = 0;
for (const [key, value] of Object.entries(expectCounts)) {
  if (counts[key] !== value) {
    console.error(`count ${key}: got ${counts[key]} want ${value}`);
    failed += 1;
  }
}
for (const [id, stage] of Object.entries(expectStages)) {
  if (stages[id] !== stage) {
    console.error(`stage ${id}: got ${stages[id]} want ${stage}`);
    failed += 1;
  }
}

const interested = fixtures.filter((row) => matchesFlowFilter(row, 'callback'));
if (interested.length !== counts.callback || interested[0]?.id !== 'call-1') {
  console.error('callback filter/count mismatch', interested.map((row) => row.id), counts.callback);
  failed += 1;
}
const lost = fixtures.filter((row) => matchesFlowFilter(row, 'lost'));
if (lost.length !== counts.lost || lost[0]?.id !== 'sold-1') {
  console.error('lost filter mismatch', lost.map((row) => row.id));
  failed += 1;
}
const booked = fixtures.filter((row) => matchesFlowFilter(row, 'booked'));
if (booked.length !== 1 || booked[0].id !== 'book-1') {
  console.error('booked filter mismatch', booked.map((row) => row.id));
  failed += 1;
}
const won = fixtures.find((row) => row.id === 'won-1');
if (!won?.won || isOpenOpportunity(won) || interested.some((row) => row.id === 'won-1')) {
  console.error('won should not count as an open opportunity', won);
  failed += 1;
}

const reviewStays = lead({
  listing: { nettikone_id: 'review-plain', desk_status: 'Review', status: 'needs_human' },
  conversation: {
    status: 'needs_human',
    interest_status: 'unclear',
    desk_status: 'Review',
    last_inbound_at: '2026-08-29',
    inbound_count: 1,
  },
});
if (reviewStays.stage !== 'Review') {
  console.error('Review without a booking should stay Review', reviewStays.stage);
  failed += 1;
}

const reviewBooked = lead({
  listing: { nettikone_id: 'review-booked', desk_status: 'Review', status: 'needs_human' },
  conversation: {
    status: 'needs_human',
    interest_status: 'unclear',
    desk_status: 'Review',
    last_inbound_at: '2026-08-29',
    inbound_count: 2,
    calendar_booking: {
      event_id: '1cj313c2g0240j2pbb42c9ho44',
      start: '2026-08-30T07:00:00.000Z',
      status: 'booked',
    },
  },
});
if (reviewBooked.stage !== 'Booked' || !reviewBooked.booked) {
  console.error('Review + active calendar booking should flip to Booked', reviewBooked);
  failed += 1;
}

const lostBooked = lead({
  listing: { nettikone_id: 'lost-booked', desk_status: 'Deal Lost', status: 'sold' },
  conversation: {
    status: 'sold',
    interest_status: 'sold',
    desk_status: 'Deal Lost',
    last_inbound_at: '2026-08-29',
    inbound_count: 1,
    calendar_booking: { event_id: 'keep-lost', start: '2026-08-30T10:00:00.000Z', status: 'booked' },
  },
});
if (lostBooked.stage !== 'Deal Lost') {
  console.error('Deal Lost should not be overridden by a booking', lostBooked.stage);
  failed += 1;
}

const wonBooked = lead({
  listing: { nettikone_id: 'won-booked', desk_status: 'Deal Won', status: 'interested' },
  conversation: {
    status: 'interested',
    desk_status: 'Deal Won',
    last_inbound_at: '2026-08-29',
    inbound_count: 1,
    calendar_booking: { event_id: 'keep-won', start: '2026-08-30T11:00:00.000Z', status: 'booked' },
  },
});
if (wonBooked.stage !== 'Deal Won') {
  console.error('Deal Won should not be overridden by a booking', wonBooked.stage);
  failed += 1;
}

const notIntBooked = lead({
  listing: { nettikone_id: 'notint-booked', desk_status: 'Not Interested', status: 'not_interested' },
  conversation: {
    status: 'not_interested',
    desk_status: 'Not Interested',
    last_inbound_at: '2026-08-29',
    inbound_count: 1,
    calendar_booking: { event_id: 'keep-notint', start: '2026-08-30T12:00:00.000Z', status: 'booked' },
  },
});
if (notIntBooked.stage !== 'Not Interested') {
  console.error('Not Interested should not be overridden by a booking', notIntBooked.stage);
  failed += 1;
}

function thread(count, classification = 'interested') {
  return Array.from({ length: count }, (_, index) => ({
    direction: index % 2 === 0 ? 'outbound' : 'inbound',
    classification: index % 2 ? classification : undefined,
  }));
}

const thinReply = lead({
  listing: { nettikone_id: 'thin-reply' },
  conversation: {
    status: 'interested',
    interest_status: 'interested',
    derived_status: 'ready_for_call',
    last_inbound_at: '2026-08-29',
    inbound_count: 1,
    messages: thread(3),
  },
});
if (thinReply.stage !== 'Replied' || thinReply.callback || thinReply.awaiting) {
  console.error('one-reply interested chat should stay Replied', thinReply);
  failed += 1;
}

const deepCallback = lead({
  listing: { nettikone_id: 'deep-callback' },
  conversation: {
    status: 'interested',
    interest_status: 'interested',
    derived_status: 'ready_for_call',
    last_inbound_at: '2026-08-29',
    inbound_count: 2,
    messages: thread(5),
  },
});
if (deepCallback.stage !== 'Callback' || !deepCallback.callback) {
  console.error('5+ message interested chat should be Callback', deepCallback);
  failed += 1;
}

const prunedCallback = lead({
  listing: { nettikone_id: 'pruned-callback', desk_status: 'Replied' },
  conversation: {
    status: 'interested',
    interest_status: 'interested',
    desk_status: 'Replied',
    last_inbound_at: '2026-07-21',
    inbound_count: 4,
    messages: thread(9),
  },
});
if (prunedCallback.stage !== 'Replied' || prunedCallback.callback) {
  console.error('persisted Replied should drop a stale callback', prunedCallback);
  failed += 1;
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ok', { counts, stages });
