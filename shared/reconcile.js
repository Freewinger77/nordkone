const DESK_LABELS = new Set([
  'Interested',
  'No Answer',
  'Callback',
  'Call Now',
  'Booked',
  'Deal Won',
  'Deal Lost',
  'Lost / Sold',
  'Not Interested',
  'Opted Out',
  'Review',
  'Replied',
]);

const SOFT_DESK_LABELS = new Set(['Review', 'No Answer', 'Callback', 'Call Now', 'Interested', 'Replied']);
const THIN_DESK_LABELS = new Set(['Callback', 'Call Now', 'Interested']);

const STALE_BOOKING_MS = 14 * 24 * 60 * 60 * 1000;
const CALLBACK_MESSAGE_MIN = 5;

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

export function conversationDepth(conversation = {}) {
  const messages = conversation.messages || [];
  if (messages.length) return messages.length;
  return Number(conversation.inbound_count || 0) + Number(conversation.outbound_count || 0);
}

export function isDeepConversation(conversation = {}) {
  return conversationDepth(conversation) >= CALLBACK_MESSAGE_MIN;
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
  const deep = isDeepConversation(conversation);
  const callbackIntent = interestedSignal || callbackSignal;

  let stage;
  const deskWins =
    desk &&
    DESK_LABELS.has(desk) &&
    !(bookedSignal && SOFT_DESK_LABELS.has(desk)) &&
    !(THIN_DESK_LABELS.has(desk) && !deep && !bookedSignal);
  if (deskWins && desk === 'Interested' && deep && !bookedSignal) stage = 'Callback';
  else if (deskWins && desk === 'Call Now') stage = 'Callback';
  else if (deskWins && desk === 'Lost / Sold') stage = 'Deal Lost';
  else if (deskWins) stage = desk;
  else if (opted) stage = 'Opted Out';
  else if (sold) stage = 'Deal Lost';
  else if (notInterested) stage = 'Not Interested';
  else if (bookedSignal) stage = 'Booked';
  else if (inbound && deep && callbackIntent) stage = 'Callback';
  else if (inbound && (classified === 'unclear' || derived === 'needs_review') && !interestedSignal) stage = 'Review';
  else if (inbound) stage = 'Replied';
  else stage = 'No Answer';

  const won = stage === 'Deal Won';
  const lost = stage === 'Deal Lost' || sold;
  const booked = stage === 'Booked';
  const callback = stage === 'Callback';
  const awaiting = callback || stage === 'Interested';
  const thinReply = stage === 'Replied';
  const opportunity = booked || callback || lost || won;

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
    callback,
    awaiting,
    thinReply,
    opportunity,
    sold,
    opted,
  };
}

export function isOpenOpportunity(lead) {
  return Boolean((lead.callback || lead.awaiting) && !lead.lost && !lead.booked && !lead.won);
}

export function matchesFlowFilter(lead, key) {
  if (!key || key === 'messaged') return true;
  if (key === 'replied') return Boolean(lead.replied);
  if (key === 'noreply') return Boolean(lead.noReply);
  if (key === 'callback' || key === 'interested') return isOpenOpportunity(lead);
  if (key === 'opportunities') return Boolean(lead.opportunity);
  if (key === 'await' || key === 'awaitReply') return Boolean(lead.thinReply);
  if (key === 'notint') return Boolean(lead.notInterestedSignal);
  if (key === 'review') return Boolean(lead.reviewSignal);
  if (key === 'won') return Boolean(lead.won);
  if (key === 'lost') return Boolean(lead.lost);
  if (key === 'booked') return Boolean(lead.booked);
  if (key === 'pipeline') return Boolean(lead.callback || lead.awaiting || lead.booked);
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
    callback: 0,
    await: 0,
    awaitReply: 0,
    opportunities: 0,
    pipeline: 0,
  };

  for (const lead of leads) {
    if (lead.replied) counts.replied += 1;
    if (lead.noReply) counts.noreply += 1;
    if (isOpenOpportunity(lead)) counts.interested += 1;
    if (lead.notInterestedSignal) counts.notint += 1;
    if (lead.reviewSignal) counts.review += 1;
    if (lead.won) counts.won += 1;
    if (lead.lost) counts.lost += 1;
    if (lead.booked) counts.booked += 1;
    if (lead.callback) counts.callback += 1;
    if (lead.awaiting) counts.await += 1;
    if (lead.thinReply) counts.awaitReply += 1;
    if (lead.opportunity) counts.opportunities += 1;
    if (lead.callback || lead.awaiting || lead.booked) counts.pipeline += 1;
  }

  return counts;
}

export const FLOW_FILTERS = {
  messaged: { label: 'Messaged', test: (lead) => matchesFlowFilter(lead, 'messaged') },
  replied: { label: 'Replied', test: (lead) => matchesFlowFilter(lead, 'replied') },
  noreply: { label: 'No reply', test: (lead) => matchesFlowFilter(lead, 'noreply') },
  opportunities: { label: 'Opportunities', test: (lead) => matchesFlowFilter(lead, 'opportunities') },
  booked: { label: 'Booked', test: (lead) => matchesFlowFilter(lead, 'booked') },
  callback: { label: 'Call Now', test: (lead) => matchesFlowFilter(lead, 'callback') },
  lost: { label: 'Lost / Sold', test: (lead) => matchesFlowFilter(lead, 'lost') },
  notint: { label: 'Not interested', test: (lead) => matchesFlowFilter(lead, 'notint') },
  review: { label: 'Review', test: (lead) => matchesFlowFilter(lead, 'review') },
  awaitReply: { label: 'Awaiting reply', test: (lead) => matchesFlowFilter(lead, 'awaitReply') },
  won: { label: 'Deal won', test: (lead) => matchesFlowFilter(lead, 'won') },
  pipeline: { label: 'Open pipeline', test: (lead) => matchesFlowFilter(lead, 'pipeline') },
};
