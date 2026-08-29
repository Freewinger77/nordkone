const DESK_LABELS = new Set([
  'Interested',
  'No Answer',
  'Callback',
  'Booked',
  'Deal Won',
  'Deal Lost',
  'Not Interested',
  'Opted Out',
  'Review',
]);

const STALE_BOOKING_MS = 14 * 24 * 60 * 60 * 1000;

export function bookingFromRecord(record = {}) {
  const raw = record.raw_data || record.raw_event || record;
  return (
    record.calendar_booking ||
    record.calendar ||
    raw.calendar_booking ||
    raw.calendarBooking ||
    raw.calendar ||
    null
  );
}

export function isActiveBooking(booking, now = Date.now()) {
  if (!booking) return false;
  const status = String(booking.status || '').toLowerCase();
  if (['cancelled', 'canceled', 'declined', 'failed'].includes(status)) return false;
  const response = String(
    booking.attendee_response || booking.attendeeResponse || booking.responseStatus || ''
  ).toLowerCase();
  if (response === 'declined') return false;
  const start = booking.start || booking.scheduled_start || booking.call_start;
  if (start) {
    const time = new Date(start).getTime();
    if (Number.isFinite(time) && time < now - STALE_BOOKING_MS) return false;
  }
  return Boolean(booking.event_id || booking.id || booking.start || booking.link || booking.htmlLink);
}

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function hasInbound(conversation = {}) {
  if (conversation.last_inbound_at) return true;
  if (Number(conversation.inbound_count) > 0) return true;
  return (conversation.messages || []).some((message) => message.direction === 'inbound');
}

function latestClassification(conversation = {}) {
  const inbound = (conversation.messages || []).filter((message) => message.direction === 'inbound');
  const last = inbound.at(-1);
  return norm(last?.classification || conversation.interest_status);
}

export function reconcileLead({ listing = {}, conversation = {}, calendarCalls = [], now = Date.now() } = {}) {
  const desk = listing.desk_status || conversation.desk_status || listing.raw_data?.desk_status;
  const listingStatus = norm(listing.status);
  const sessionStatus = norm(conversation.status);
  const interest = norm(conversation.interest_status || listing.interest_status);
  const derived = norm(conversation.derived_status);
  const classified = latestClassification(conversation);
  const inbound = hasInbound(conversation);

  const booking =
    conversation.calendar_booking ||
    bookingFromRecord(conversation) ||
    bookingFromRecord(listing);
  const calendarHit = calendarCalls.some((call) => {
    const sameLead =
      call.source_customer_id === listing.nettikone_id ||
      call.source_customer_id === conversation.source_customer_id ||
      (call.number && call.number === conversation.number);
    if (!sameLead) return false;
    return isActiveBooking(
      {
        start: call.scheduled_start,
        status: call.status,
        event_id: call.calendar_event_id,
        link: call.calendar_link,
        attendee_response: call.attendee_response,
      },
      now
    );
  });
  const bookedSignal = isActiveBooking(booking, now) || calendarHit;

  const sold =
    listingStatus === 'sold' ||
    sessionStatus === 'sold' ||
    interest === 'sold' ||
    derived === 'sold' ||
    classified === 'sold';
  const opted =
    listingStatus === 'opted_out' ||
    sessionStatus === 'opted_out' ||
    interest === 'opted_out' ||
    derived === 'opt_out' ||
    classified === 'opted_out';
  const notInterested =
    listingStatus === 'not_interested' ||
    sessionStatus === 'not_interested' ||
    interest === 'not_interested' ||
    derived === 'not_interested' ||
    classified === 'not_interested';
  const interestedSignal =
    !sold &&
    !notInterested &&
    !opted &&
    (listingStatus === 'interested' ||
      sessionStatus === 'interested' ||
      interest === 'interested' ||
      derived === 'interested' ||
      derived === 'machine_available' ||
      classified === 'interested');
  const callbackSignal = derived === 'ready_for_call' || classified === 'needs_human';

  let stage;
  if (desk && DESK_LABELS.has(desk)) stage = desk;
  else if (opted) stage = 'Opted Out';
  else if (sold) stage = 'Deal Lost';
  else if (notInterested) stage = 'Not Interested';
  else if (bookedSignal) stage = 'Booked';
  else if (interestedSignal && callbackSignal) stage = 'Callback';
  else if (interestedSignal) stage = 'Interested';
  else if (callbackSignal && inbound) stage = 'Callback';
  else if (inbound) stage = 'Review';
  else stage = 'No Answer';

  const won = stage === 'Deal Won';
  const lost = stage === 'Deal Lost' || sold;
  const booked = stage === 'Booked';
  const awaiting = stage === 'Interested' || stage === 'Callback';

  return {
    stage,
    replied: inbound,
    noReply: !inbound,
    interestedSignal,
    notInterestedSignal: !sold && (notInterested || opted),
    reviewSignal: stage === 'Review',
    won,
    lost,
    booked,
    awaiting,
    sold,
    opted,
  };
}

export function matchesFlowFilter(lead, key) {
  if (!key || key === 'messaged') return true;
  if (key === 'replied') return Boolean(lead.replied);
  if (key === 'noreply') return Boolean(lead.noReply);
  if (key === 'interested') return Boolean(lead.interestedSignal);
  if (key === 'notint') return Boolean(lead.notInterestedSignal);
  if (key === 'review') return Boolean(lead.reviewSignal);
  if (key === 'won') return Boolean(lead.won);
  if (key === 'lost') return Boolean(lead.lost);
  if (key === 'booked') return Boolean(lead.booked);
  if (key === 'await') return Boolean(lead.awaiting);
  if (key === 'pipeline') return Boolean(lead.awaiting || lead.booked);
  return true;
}

export function countFlow(leads = [], summary = null) {
  const counts = {
    eligible: summary?.eligible || 0,
    messaged: leads.length,
    replied: 0,
    noreply: 0,
    interested: 0,
    notint: 0,
    review: 0,
    won: 0,
    lost: 0,
    booked: 0,
    await: 0,
    pipeline: 0,
  };

  for (const lead of leads) {
    if (lead.replied) counts.replied += 1;
    if (lead.noReply) counts.noreply += 1;
    if (lead.interestedSignal) counts.interested += 1;
    if (lead.notInterestedSignal) counts.notint += 1;
    if (lead.reviewSignal) counts.review += 1;
    if (lead.won) counts.won += 1;
    if (lead.lost) counts.lost += 1;
    if (lead.booked) counts.booked += 1;
    if (lead.awaiting) counts.await += 1;
    if (lead.awaiting || lead.booked) counts.pipeline += 1;
  }

  return counts;
}

export const FLOW_FILTERS = {
  messaged: { label: 'Messaged', test: (lead) => matchesFlowFilter(lead, 'messaged') },
  replied: { label: 'Replied', test: (lead) => matchesFlowFilter(lead, 'replied') },
  noreply: { label: 'No reply', test: (lead) => matchesFlowFilter(lead, 'noreply') },
  interested: { label: 'Interested', test: (lead) => matchesFlowFilter(lead, 'interested') },
  notint: { label: 'Not interested', test: (lead) => matchesFlowFilter(lead, 'notint') },
  review: { label: 'Review', test: (lead) => matchesFlowFilter(lead, 'review') },
  won: { label: 'Deal won', test: (lead) => matchesFlowFilter(lead, 'won') },
  lost: { label: 'Deal lost', test: (lead) => matchesFlowFilter(lead, 'lost') },
  booked: { label: 'Booked', test: (lead) => matchesFlowFilter(lead, 'booked') },
  await: { label: 'Awaiting booking', test: (lead) => matchesFlowFilter(lead, 'await') },
  pipeline: { label: 'Open pipeline', test: (lead) => matchesFlowFilter(lead, 'pipeline') },
};
