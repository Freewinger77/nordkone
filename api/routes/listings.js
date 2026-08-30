import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { normalizePhone } from '../lib/phone.js';
import { CAMPAIGN_NAME, CLIENT_KEY, SOURCE_SYSTEM, listingRowToResponse } from '../lib/campaign.js';
import { bookingFromRecord, isActiveBooking } from '../../shared/reconcile.js';
import { isNeedsReviewReply } from '../../shared/intent.js';

const router = Router();

router.get('/summary', async (_req, res) => {
  const supabase = createSupabase();
  const [
    eligible,
    contactedListings,
    interestedListings,
    soldListings,
    notInterestedListings,
    optedOutListings,
    descriptionPhones,
    revealedPhones,
    missingPhones,
    contacted,
    replied,
    interestedSessions,
    needsHumanSessions,
  ] = await Promise.all([
    countListings(supabase, { status: 'eligible', hasPhone: true }),
    countListings(supabase, { status: 'contacted' }),
    countListings(supabase, { status: 'interested' }),
    countListings(supabase, { status: 'sold' }),
    countListings(supabase, { status: 'not_interested' }),
    countListings(supabase, { status: 'opted_out' }),
    countListings(supabase, { phoneSource: 'description' }),
    countListings(supabase, { phoneSource: 'revealed_contact' }),
    countListings(supabase, { phoneSource: 'missing' }),
    countSessions(supabase),
    countSessions(supabase, { replied: true }),
    countSessions(supabase, { interestStatus: 'interested' }),
    countSessions(supabase, { interestStatus: 'needs_human' }),
  ]);
  const derivedStatusCounts = await buildDerivedStatusSummary(supabase);

  res.json({
    client_key: CLIENT_KEY,
    display_name: 'NordKone',
    eligible,
    eligible_prospects: eligible,
    contacted_listings: contactedListings,
    interested_listings: interestedListings,
    sold_listings: soldListings,
    not_interested_listings: notInterestedListings,
    opted_out_listings: optedOutListings,
    description_phone_count: descriptionPhones,
    revealed_phone_count: revealedPhones,
    missing_phone_count: missingPhones,
    contacted,
    replied,
    interested: interestedSessions || interestedListings,
    needs_human: needsHumanSessions,
    opt_outs: optedOutListings,
    derived_status_counts: derivedStatusCounts,
  });
});

router.get('/listings', async (req, res) => {
  const supabase = createSupabase();
  const limit = clamp(Number(req.query.limit || 50), 1, 200);
  const status = req.query.status ? String(req.query.status) : null;
  const q = req.query.q ? String(req.query.q).trim() : null;

  let query = supabase
    .from('nordkone_listings')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  query = applyStatusFilter(query, status);

  if (q) {
    const like = escapeLike(q);
    query = query.or(
      `machine_title.ilike.%${like}%,seller_name.ilike.%${like}%,nettikone_id.ilike.%${like}%,normalized_phone.ilike.%${like}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  res.json({ listings: (data || []).map(listingRowToResponse) });
});

router.patch('/leads/status', async (req, res) => {
  const supabase = createSupabase();
  const deskStatus = String(req.body?.desk_status || req.body?.status || '').trim();
  const listingStatus = deskStatusToListingStatus(deskStatus);

  if (!listingStatus) {
    return res.status(400).json({ error: 'unsupported desk_status' });
  }

  const listing = await loadListing(supabase, {
    listing_id: req.body?.listing_id,
    nettikone_id: req.body?.nettikone_id || req.body?.source_customer_id,
  });

  const now = new Date().toISOString();
  const rawData = {
    ...(listing.raw_data || {}),
    desk_status: deskStatus,
    desk_status_updated_at: now,
  };

  const { data: updated, error: listingError } = await supabase
    .from('nordkone_listings')
    .update({
      status: listingStatus,
      raw_data: rawData,
      updated_at: now,
    })
    .eq('id', listing.id)
    .eq('client_key', CLIENT_KEY)
    .select()
    .single();

  if (listingError) throw listingError;

  if (listing.prospect_id) {
    await supabase
      .from('campaign_prospects')
      .update({
        status: listingStatus === 'opted_out' ? 'opted_out' : 'replied',
        interest_status: deskStatus,
        updated_at: now,
      })
      .eq('id', listing.prospect_id)
      .eq('client_key', CLIENT_KEY);
  }

  const { data: session } = await supabase
    .from('campaign_outbound_sessions')
    .select('id')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('source_customer_id', listing.nettikone_id)
    .maybeSingle();

  if (session?.id) {
    await supabase
      .from('campaign_outbound_sessions')
      .update({
        status: listingStatus,
        interest_status: deskStatus,
        raw_data: {
          ...((await loadSessionRaw(supabase, session.id)) || {}),
          desk_status: deskStatus,
        },
        updated_at: now,
      })
      .eq('id', session.id)
      .eq('client_key', CLIENT_KEY);
  }

  res.json({ listing: listingRowToResponse(updated) });
});

router.get('/interested', async (_req, res) => {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from('nordkone_listings')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .in('status', ['interested', 'needs_human'])
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  res.json({ listings: (data || []).map(listingRowToResponse) });
});

router.get('/conversations', async (req, res) => {
  const supabase = createSupabase();
  const limit = clamp(Number(req.query.limit || 200), 1, 500);

  const { data: sessions, error: sessionError } = await supabase
    .from('campaign_outbound_sessions')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (sessionError) throw sessionError;

  const sessionRows = sessions || [];
  const sessionIds = sessionRows.map((session) => session.id).filter(Boolean);
  const sourceIds = [...new Set(sessionRows.map((session) => session.source_customer_id).filter(Boolean))];

  const [inboundResult, listingResult] = await Promise.all([
    sessionIds.length
      ? supabase
          .from('campaign_inbound_events')
          .select('*')
          .eq('client_key', CLIENT_KEY)
          .in('session_id', sessionIds)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    sourceIds.length
      ? supabase
          .from('nordkone_listings')
          .select('*')
          .eq('client_key', CLIENT_KEY)
          .in('nettikone_id', sourceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (inboundResult.error) throw inboundResult.error;
  if (listingResult.error) throw listingResult.error;

  const inboundBySession = groupBy(inboundResult.data || [], 'session_id');
  const listingByNettikoneId = new Map(
    (listingResult.data || []).map((listing) => [listing.nettikone_id, listingRowToResponse(listing)])
  );

  const conversations = sessionRows.map((session) => {
    const listing = listingByNettikoneId.get(session.source_customer_id) || listingFromSession(session);
    const inboundEvents = inboundBySession.get(session.id) || [];
    const messages = buildConversationMessages(session, inboundEvents);
    const derivedStatus = deriveLeadStatus({ listing, session, events: inboundEvents });
    const calendarBooking = extractCalendarMetadata(inboundEvents[inboundEvents.length - 1] || {}, session);

    return {
      session_id: session.id,
      source_customer_id: session.source_customer_id,
      prospect_id: session.prospect_id,
      number: session.number,
      status: session.status,
      interest_status: session.interest_status,
      desk_status: session.raw_data?.desk_status || listing?.desk_status || null,
      derived_status: derivedStatus,
      inbound_count: session.inbound_count || 0,
      outbound_count: session.outbound_count || 0,
      last_inbound_at: session.last_inbound_at,
      last_outbound_at: session.last_outbound_at,
      updated_at: session.updated_at,
      calendar_booking: calendarBooking,
      listing,
      messages,
      latest_message: messages[messages.length - 1] || null,
    };
  });

  res.json({ conversations });
});

router.get('/calendar-calls', async (req, res) => {
  const supabase = createSupabase();
  const limit = clamp(Number(req.query.limit || 50), 1, 150);

  const { data: events, error: eventError } = await supabase
    .from('campaign_inbound_events')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .in('classification', ['interested', 'needs_human', 'ready_for_call', 'booked'])
    .order('received_at', { ascending: false })
    .limit(limit * 3);

  if (eventError) throw eventError;

  const eventRows = events || [];
  const sourceIds = [...new Set(eventRows.map((event) => event.source_customer_id).filter(Boolean))];
  const sessionIds = [...new Set(eventRows.map((event) => event.session_id).filter(Boolean))];

  const [listingResult, sessionResult] = await Promise.all([
    sourceIds.length
      ? supabase
          .from('nordkone_listings')
          .select('*')
          .eq('client_key', CLIENT_KEY)
          .in('nettikone_id', sourceIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase
          .from('campaign_outbound_sessions')
          .select('*')
          .eq('client_key', CLIENT_KEY)
          .in('id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (listingResult.error) throw listingResult.error;
  if (sessionResult.error) throw sessionResult.error;

  const listingByNettikoneId = new Map(
    (listingResult.data || []).map((listing) => [listing.nettikone_id, listingRowToResponse(listing)])
  );
  const sessionById = new Map((sessionResult.data || []).map((session) => [session.id, session]));
  const seenBooked = new Set();
  const seenPending = new Set();
  const bookedCalls = [];
  const pendingCallbacks = [];

  for (const event of eventRows) {
    const listing = listingByNettikoneId.get(event.source_customer_id);
    const session = sessionById.get(event.session_id);
    const calendar = extractCalendarMetadata(event, session);
    const dedupeKey = event.source_customer_id || event.number || event.id;

    const row = {
      id: `call-${event.id}`,
      status: calendar?.status || 'pending_call',
      scheduled_start: calendar?.start || null,
      scheduled_end: calendar?.end || null,
      calendar_event_id: calendar?.event_id || null,
      calendar_link: calendar?.link || null,
      assigned_to: calendar?.assigned_to || 'Roope',
      received_at: event.received_at || event.created_at,
      source_customer_id: event.source_customer_id,
      number: event.number,
      callback_number: extractCallbackNumber(event) || event.number,
      latest_message: event.message,
      reply_message: event.raw_event?.reply_message || event.raw_event?.agent_reply_message || null,
      classification: event.classification,
      needs_human: event.needs_human,
      listing,
    };

    const sessionBooking = extractCalendarMetadata(event, session);
    const activeBooking = isActiveBooking(sessionBooking || calendar);
    if (activeBooking && !seenBooked.has(`${dedupeKey}:${calendar?.event_id || sessionBooking?.event_id || calendar?.start || event.id}`)) {
      seenBooked.add(`${dedupeKey}:${calendar?.event_id || sessionBooking?.event_id || calendar?.start || event.id}`);
      bookedCalls.push({
        ...row,
        status: sessionBooking?.status || calendar?.status || row.status,
        scheduled_start: sessionBooking?.start || calendar?.start || row.scheduled_start,
        scheduled_end: sessionBooking?.end || calendar?.end || row.scheduled_end,
        calendar_event_id: sessionBooking?.event_id || calendar?.event_id || row.calendar_event_id,
        calendar_link: sessionBooking?.link || calendar?.link || row.calendar_link,
        attendee_response: sessionBooking?.attendee_response || calendar?.attendee_response || null,
      });
      continue;
    }

    if (deriveLeadStatus({ listing, session, events: [event] }) === 'ready_for_call' && !seenPending.has(dedupeKey)) {
      seenPending.add(dedupeKey);
      pendingCallbacks.push(row);
    }

    if (bookedCalls.length >= limit && pendingCallbacks.length >= limit) break;
  }

  res.json({
    booked_calls: bookedCalls.slice(0, limit),
    pending_callbacks: pendingCallbacks.slice(0, limit),
    calls: [...bookedCalls, ...pendingCallbacks].slice(0, limit),
  });
});

router.get('/outbound/candidates', async (req, res) => {
  const supabase = createSupabase();
  const limit = clamp(Number(req.query.limit || 10), 1, 50);
  const config = await loadCampaignConfig(supabase);
  const dailyCap = clamp(Number(config?.daily_cap || 0), 0, 500);
  const sentToday = await countSessions(supabase, { sentSince: startOfTodayIso() });

  if (!config?.outbound_enabled) {
    return res.json({
      candidates: [],
      control: {
        outbound_enabled: false,
        daily_cap: dailyCap,
        sent_today: sentToday,
        remaining_today: 0,
        reason: 'outbound_disabled',
      },
    });
  }

  const remainingToday = Math.max(dailyCap - sentToday, 0);
  if (remainingToday <= 0) {
    return res.json({
      candidates: [],
      control: {
        outbound_enabled: true,
        daily_cap: dailyCap,
        sent_today: sentToday,
        remaining_today: 0,
        reason: 'daily_cap_reached',
      },
    });
  }

  const { data, error } = await supabase
    .from('nordkone_listings')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('status', 'eligible')
    .not('normalized_phone', 'is', null)
    .order('first_seen_at', { ascending: true })
    .limit(Math.min(limit, remainingToday));

  if (error) throw error;

  res.json({
    control: {
      outbound_enabled: true,
      daily_cap: dailyCap,
      sent_today: sentToday,
      remaining_today: remainingToday,
      reason: 'ok',
    },
    candidates: (data || []).map((row) => {
      const listing = listingRowToResponse(row);
      return {
        ...listing,
        outbound_message: buildOutboundMessage(listing.machine_title),
      };
    }),
  });
});

router.get('/outbound/context', async (req, res) => {
  const supabase = createSupabase();
  const rawNumber = String(req.query.number || req.query.phone || req.query.q || '').trim();
  const number = normalizePhone(rawNumber);

  if (!number) return res.status(400).json({ error: 'valid number is required' });

  const { data: session, error: sessionError } = await supabase
    .from('campaign_outbound_sessions')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('number', number)
    .order('last_outbound_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionError) throw sessionError;

  let listing = null;
  if (session?.source_customer_id) {
    const { data, error } = await supabase
      .from('nordkone_listings')
      .select('*')
      .eq('client_key', CLIENT_KEY)
      .eq('nettikone_id', session.source_customer_id)
      .maybeSingle();

    if (error) throw error;
    listing = data ? listingRowToResponse(data) : listingFromSession(session);
  }

  res.json({
    context_source: session ? 'outbound_session' : 'none',
    session,
    listing,
    listings: listing ? [listing] : [],
  });
});

router.post('/outbound/sent', async (req, res) => {
  const supabase = createSupabase();
  const {
    nettikone_id,
    source_customer_id,
    listing_id,
    number,
    message,
    provider = 'wasup',
    provider_message_id,
    raw_data = {},
  } = req.body || {};

  const listing = await loadListing(supabase, {
    listing_id,
    nettikone_id: nettikone_id || source_customer_id,
  });

  const normalized = normalizePhone(number || listing.normalized_phone);
  if (!normalized) return res.status(400).json({ error: 'valid number is required' });

  const outboundMessage = message || buildOutboundMessage(listing.machine_title);
  const existingSession = await loadExistingSession(supabase, listing.nettikone_id);
  const config = await loadCampaignConfig(supabase);
  const dailyCap = clamp(Number(config?.daily_cap || 0), 0, 500);
  const sentToday = await countSessions(supabase, { sentSince: startOfTodayIso() });

  if (!existingSession) {
    if (!config?.outbound_enabled) {
      return res.status(409).json({
        error: 'outbound_disabled',
        message: 'Outbound is off. Turn it on in controls before sending a first message.',
      });
    }
    if (sentToday >= dailyCap) {
      return res.status(409).json({
        error: 'daily_cap_reached',
        message: `Daily cap of ${dailyCap} first messages has been reached.`,
      });
    }
  }

  const sessionPayload = {
    client_key: CLIENT_KEY,
    prospect_id: listing.prospect_id || null,
    source_system: SOURCE_SYSTEM,
    source_customer_id: listing.nettikone_id,
    campaign_name: CAMPAIGN_NAME,
    number: normalized,
    message: outboundMessage,
    provider,
    provider_message_id: provider_message_id || null,
    first_outbound_at: existingSession?.first_outbound_at || new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
    status: 'contacted',
    raw_data: {
      ...raw_data,
      listing_id: listing.id,
      nettikone_id: listing.nettikone_id,
      listing_url: listing.listing_url,
      machine_title: listing.machine_title,
    },
    updated_at: new Date().toISOString(),
  };

  const sessionQuery = existingSession
    ? supabase
        .from('campaign_outbound_sessions')
        .update({
          ...sessionPayload,
          outbound_count: Number(existingSession.outbound_count || 0) + 1,
        })
        .eq('id', existingSession.id)
    : supabase.from('campaign_outbound_sessions').insert({
        ...sessionPayload,
        outbound_count: 1,
      });

  const { data: session, error: sessionError } = await sessionQuery.select().single();
  if (sessionError) throw sessionError;

  const now = new Date().toISOString();
  const { error: listingError } = await supabase
    .from('nordkone_listings')
    .update({ status: 'contacted', updated_at: now })
    .eq('id', listing.id)
    .eq('client_key', CLIENT_KEY);

  if (listingError) throw listingError;

  if (listing.prospect_id) {
    const { error: prospectError } = await supabase
      .from('campaign_prospects')
      .update({ status: 'contacted', updated_at: now })
      .eq('id', listing.prospect_id)
      .eq('client_key', CLIENT_KEY);

    if (prospectError) throw prospectError;
  }

  res.json({ session });
});

router.post('/message-status', async (req, res) => {
  const supabase = createSupabase();
  const {
    provider_message_id,
    status,
    number,
    nettikone_id,
    source_customer_id,
    provider = 'wasup',
  } = req.body || {};

  if (!status) return res.status(400).json({ error: 'status is required' });

  const { data: session } = provider_message_id
    ? await supabase
        .from('campaign_outbound_sessions')
        .select('id,source_customer_id')
        .eq('client_key', CLIENT_KEY)
        .eq('provider_message_id', provider_message_id)
        .maybeSingle()
    : { data: null };

  const { error } = await supabase.from('campaign_message_status').insert({
    client_key: CLIENT_KEY,
    session_id: session?.id || null,
    source_customer_id: source_customer_id || nettikone_id || session?.source_customer_id || null,
    number: number ? normalizePhone(number) : null,
    provider,
    provider_message_id: provider_message_id || null,
    status,
    raw_event: req.body,
  });

  if (error) throw error;
  res.json({ ok: true });
});

router.post('/calendar-booking', async (req, res) => {
  const supabase = createSupabase();
  const {
    session_id,
    source_customer_id,
    nettikone_id,
    number,
    event_id,
    status = event_id ? 'booked' : 'failed',
    start,
    end,
    link,
    assigned_to = 'Roope',
    calendar_id = 'hi@wasup.co',
    attendee = 'roope261@gmail.com',
    attendee_response,
    error,
    raw_event = {},
  } = req.body || {};

  const normalized = number ? normalizePhone(number) : null;
  const sourceCustomerId = source_customer_id || nettikone_id || null;

  let query = supabase
    .from('campaign_outbound_sessions')
    .select('id,raw_data,booked_at,source_customer_id,prospect_id,status')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM);

  if (session_id) query = query.eq('id', session_id);
  else if (sourceCustomerId) query = query.eq('source_customer_id', sourceCustomerId);
  else if (normalized) query = query.eq('number', normalized);
  else return res.status(400).json({ error: 'session_id, source_customer_id, nettikone_id, or number is required' });

  const { data: session, error: sessionError } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return res.status(404).json({ error: 'session not found' });

  const rawData = session.raw_data || {};
  const now = new Date().toISOString();
  const bookingStatus = String(status || '').toLowerCase();
  const bookingFailed = ['cancelled', 'canceled', 'declined', 'failed'].includes(bookingStatus);
  const booked = !bookingFailed && Boolean(event_id || start || link);
  const bookedAt = session.booked_at || rawData.booked_at || now;
  const nextRawData = {
    ...rawData,
    calendar_booking: {
      event_id: event_id || null,
      id: event_id || null,
      status,
      start: start || null,
      end: end || null,
      link: link || null,
      htmlLink: link || null,
      assigned_to,
      calendar_id,
      attendee,
      attendee_response: attendee_response || null,
      error: error || null,
      source: raw_event.source || 'wf2',
      updated_at: now,
      raw_event,
    },
    ...(booked
      ? {
          desk_status: 'Booked',
          desk_status_updated_at: now,
          booked_at: bookedAt,
        }
      : {}),
  };

  const sessionPatch = {
    raw_data: nextRawData,
    updated_at: now,
  };
  if (booked) {
    sessionPatch.booked_at = bookedAt;
    sessionPatch.status = 'interested';
    sessionPatch.interest_status = 'interested';
    sessionPatch.stop_reminders = true;
  }

  const { data: updated, error: updateError } = await supabase
    .from('campaign_outbound_sessions')
    .update(sessionPatch)
    .eq('id', session.id)
    .select('id,source_customer_id,raw_data,booked_at,status,interest_status')
    .single();

  if (updateError) throw updateError;

  const listingId = updated.source_customer_id || sourceCustomerId || session.source_customer_id;
  if (booked && listingId) {
    const { data: listing } = await supabase
      .from('nordkone_listings')
      .select('id,raw_data')
      .eq('client_key', CLIENT_KEY)
      .eq('nettikone_id', listingId)
      .maybeSingle();

    if (listing?.id) {
      await supabase
        .from('nordkone_listings')
        .update({
          status: deskStatusToListingStatus('Booked'),
          raw_data: {
            ...(listing.raw_data || {}),
            desk_status: 'Booked',
            desk_status_updated_at: now,
          },
          updated_at: now,
        })
        .eq('id', listing.id)
        .eq('client_key', CLIENT_KEY);
    }
  }

  res.json({ ok: true, session: updated });
});

function buildOutboundMessage(machineTitle) {
  return `Moikka! Sulla oli Nettikoneessa ${machineTitle || 'kone'} myynnissä. Onko se edelleen kaupan?`;
}

function listingFromSession(session = {}) {
  const rawData = session.raw_data || {};
  const nettikoneId = session.source_customer_id || rawData.nettikone_id;
  if (!nettikoneId && !rawData.listing_url && !rawData.machine_title) return null;

  return {
    source_customer_id: nettikoneId,
    nettikone_id: nettikoneId,
    listing_url: rawData.listing_url || null,
    canonical_url: rawData.listing_url || null,
    machine_title: rawData.machine_title || nettikoneId || 'kone',
    normalized_phone: session.number,
    status: session.status,
    interest_status: session.interest_status,
    raw_data: rawData,
  };
}

function buildConversationMessages(session = {}, inboundEvents = []) {
  const messages = [];

  if (session.message) {
    messages.push({
      id: `session-${session.id}-outbound`,
      direction: 'outbound',
      sender: 'NordKone',
      message: session.message,
      at: session.first_outbound_at || session.last_outbound_at || session.created_at,
      meta: 'WF-1',
    });
  }

  for (const event of inboundEvents) {
    if (event.raw_event?.message_id === 'manual-wf2-check') continue;

    messages.push({
      id: `inbound-${event.id}`,
      direction: 'inbound',
      sender: 'Seller',
      message: event.message,
      at: event.received_at || event.created_at,
      classification: event.classification,
      needs_human: event.needs_human,
    });

    const replyMessage = event.raw_event?.reply_message || event.raw_event?.agent_reply_message;
    if (replyMessage) {
      messages.push({
        id: `reply-${event.id}`,
        direction: 'outbound',
        sender: 'NordKone',
        message: replyMessage,
        at: event.received_at || event.created_at,
        meta: 'WF-2',
      });
    }
  }

  return messages.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function extractCalendarMetadata(event = {}, session = {}) {
  const rawEvent = event?.raw_event || {};
  const rawSession = session?.raw_data || {};
  const candidate =
    rawEvent.calendar ||
    rawEvent.calendar_booking ||
    rawEvent.calendarBooking ||
    rawSession.calendar ||
    rawSession.calendar_booking ||
    rawSession.calendarBooking ||
    (rawEvent.classification === 'booked' && (rawEvent.call_start || rawEvent.start || rawEvent.event_id)
      ? {
          start: rawEvent.call_start || rawEvent.start,
          event_id: rawEvent.event_id || rawEvent.calendar_event_id,
          status: 'booked',
        }
      : null);

  if (!candidate) return null;

  return {
    event_id: candidate.event_id || candidate.eventId || candidate.id || null,
    link: candidate.link || candidate.htmlLink || candidate.calendar_link || null,
    start: candidate.start || candidate.scheduled_start || candidate.call_start || null,
    end: candidate.end || candidate.scheduled_end || candidate.call_end || null,
    status: candidate.status || 'booked',
    assigned_to: candidate.assigned_to || candidate.attendee || 'Roope',
    attendee_response: candidate.attendee_response || candidate.attendeeResponse || candidate.responseStatus || null,
  };
}

function isCallLikeEvent(event = {}) {
  const text = [
    event.message,
    event.raw_event?.reply_message,
    event.raw_event?.agent_reply_message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return [
    'puhelu',
    'soitto',
    'soittaa',
    'soitamme',
    'soitella',
    'heti',
    'nyt',
    'tavoitettavissa',
    'sopii',
    'klo',
    'min kuluttua',
  ].some((term) => text.includes(term));
}

function extractCallbackNumber(event = {}) {
  const text = String(event.message || '');
  const match = text.match(/(?:\+358|0)\s?\d[\d\s-]{6,}/);
  return match ? normalizePhone(match[0]) : null;
}

function groupBy(rows = [], key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

async function loadListing(supabase, { listing_id, nettikone_id }) {
  if (!listing_id && !nettikone_id) {
    const error = new Error('nettikone_id or listing_id is required');
    error.status = 400;
    throw error;
  }

  const query = supabase.from('nordkone_listings').select('*').eq('client_key', CLIENT_KEY);
  const { data, error } = listing_id
    ? await query.eq('id', listing_id).single()
    : await query.eq('nettikone_id', nettikone_id).single();

  if (error) throw error;
  return data;
}

function deskStatusToListingStatus(deskStatus) {
  const map = {
    Interested: 'interested',
    'No Answer': 'contacted',
    Callback: 'replied',
    'Call Now': 'replied',
    Booked: 'interested',
    'Deal Won': 'interested',
    'Deal Lost': 'sold',
    'Lost / Sold': 'sold',
    'Not Interested': 'not_interested',
    'Opted Out': 'opted_out',
    Review: 'needs_human',
    Replied: 'replied',
    Eligible: 'eligible',
    Contacted: 'contacted',
  };
  return map[deskStatus] || null;
}

async function loadSessionRaw(supabase, sessionId) {
  const { data, error } = await supabase
    .from('campaign_outbound_sessions')
    .select('raw_data')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data?.raw_data || {};
}

async function loadExistingSession(supabase, nettikoneId) {
  const { data, error } = await supabase
    .from('campaign_outbound_sessions')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('source_customer_id', nettikoneId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function buildDerivedStatusSummary(supabase) {
  const [sessionResult, listingResult, inboundResult] = await Promise.all([
    supabase
      .from('campaign_outbound_sessions')
      .select('*')
      .eq('client_key', CLIENT_KEY)
      .eq('source_system', SOURCE_SYSTEM),
    supabase.from('nordkone_listings').select('*').eq('client_key', CLIENT_KEY),
    supabase
      .from('campaign_inbound_events')
      .select('*')
      .eq('client_key', CLIENT_KEY)
      .order('received_at', { ascending: true }),
  ]);

  if (sessionResult.error) throw sessionResult.error;
  if (listingResult.error) throw listingResult.error;
  if (inboundResult.error) throw inboundResult.error;

  const sessions = sessionResult.data || [];
  const listings = listingResult.data || [];
  const inboundEvents = inboundResult.data || [];
  const listingByNettikoneId = new Map(listings.map((listing) => [listing.nettikone_id, listing]));
  const eventsByLead = new Map();

  for (const event of inboundEvents) {
    const key = event.source_customer_id || event.number;
    if (!key) continue;
    if (!eventsByLead.has(key)) eventsByLead.set(key, []);
    eventsByLead.get(key).push(event);
  }

  const counts = {
    ready_to_contact: 0,
    contacted: sessions.length,
    replies: sessions.filter((session) => session.last_inbound_at).length,
    machine_available: 0,
    interested: 0,
    ready_for_call: 0,
    booked: 0,
    needs_review: 0,
    opt_out: listings.filter((listing) => listing.status === 'opted_out').length,
  };
  const derivedBuckets = new Set(['machine_available', 'interested', 'ready_for_call', 'booked', 'needs_review']);

  const seen = new Set();

  for (const session of sessions) {
    const key = session.source_customer_id || session.number;
    if (!key) continue;
    seen.add(key);
    const listing = listingByNettikoneId.get(session.source_customer_id);
    const events = eventsByLead.get(key) || [];
    const derivedStatus = deriveLeadStatus({ listing, session, events });
    if (derivedBuckets.has(derivedStatus)) counts[derivedStatus] += 1;
  }

  for (const listing of listings) {
    if (seen.has(listing.nettikone_id)) continue;
    const events = eventsByLead.get(listing.nettikone_id) || eventsByLead.get(listing.normalized_phone) || [];
    const derivedStatus = deriveLeadStatus({ listing, session: null, events });
    if (derivedStatus === 'ready_to_contact' && listing.normalized_phone) counts.ready_to_contact += 1;
    else if (derivedBuckets.has(derivedStatus)) counts[derivedStatus] += 1;
  }

  return counts;
}

function deriveLeadStatus({ listing = {}, session = {}, events = [] } = {}) {
  const listingStatus = listing?.status || '';
  const sessionStatus = session?.status || '';
  const interest = session?.interest_status || listing?.interest_status || '';
  const booking = extractCalendarMetadata(events[events.length - 1] || {}, session || {}) || bookingFromRecord(session || {});

  const latest = events[events.length - 1] || {};
  const latestInbound = latest.message || '';
  const latestText = `${latestInbound} ${latest.raw_event?.reply_message || ''}`;
  const reviewReply = Boolean(latestInbound && isNeedsReviewReply(latestInbound));

  if (listingStatus === 'opted_out' || sessionStatus === 'opted_out' || interest === 'opted_out') return 'opt_out';
  if (listingStatus === 'sold' || sessionStatus === 'sold' || interest === 'sold') return 'sold';
  if (interest === 'booked' || latest.classification === 'booked') return 'booked';
  if (interest === 'ready_for_call' || sessionStatus === 'ready_for_call' || latest.classification === 'ready_for_call') {
    return 'ready_for_call';
  }
  if (interest === 'needs_review' || latest.classification === 'needs_review') return 'needs_review';
  if (interest === 'machine_available' || latest.classification === 'machine_available') return 'machine_available';
  if (
    !reviewReply &&
    (listingStatus === 'not_interested' || sessionStatus === 'not_interested' || interest === 'not_interested')
  ) {
    return 'not_interested';
  }
  if (isActiveBooking(booking)) return 'booked';
  if (reviewReply) return 'needs_review';
  if (listingStatus === 'interested' || sessionStatus === 'interested' || interest === 'interested') {
    if (isReadyForCallText(latestText)) return 'ready_for_call';
    return 'interested';
  }
  if (!session && listingStatus === 'eligible') return 'ready_to_contact';
  if (!events.length) return session ? (session.last_inbound_at ? 'needs_review' : 'contacted') : listingStatus || 'ready_to_contact';

  const fullText = events.map((event) => `${event.message || ''} ${event.raw_event?.reply_message || ''}`).join(' ');

  if (containsAny(fullText, ['myyty', 'meni jo', 'kaupat tehty', 'ei ole enää']) || events.some((event) => event.classification === 'sold')) {
    return 'sold';
  }
  if (containsAny(fullText, ['älä lähetä', 'poista', 'lopeta', 'stop']) || events.some((event) => event.classification === 'opted_out')) {
    return 'opt_out';
  }
  if (containsAny(fullText, ['ei kiinnosta', 'ei tarvetta', 'en tarvitse']) || events.some((event) => event.classification === 'not_interested')) {
    return 'not_interested';
  }
  if (isReadyForCallText(latestText)) return 'ready_for_call';
  if (isCommercialInterestText(fullText)) return 'interested';
  if (isMachineAvailableText(fullText)) return 'machine_available';
  if (events.some((event) => event.classification === 'needs_human')) return 'needs_review';
  if (events.some((event) => event.classification === 'interested')) return 'interested';

  return 'needs_review';
}

function containsAny(value = '', terms = []) {
  const text = String(value || '').toLowerCase();
  return terms.some((term) => text.includes(term));
}

function isReadyForCallText(value = '') {
  return containsAny(value, [
    'voit soittaa',
    'voi soittaa',
    'soittaa heti',
    'soita',
    'vaikka nyt',
    'vaikka heti',
    'huomenna',
    'klo',
    'iltapäiv',
    '13 jälkeen',
    'sopii',
    'käy hyvin',
    'milloin vain',
    'tavoitettavissa',
    'heti',
    'nyt',
    'min kuluttua',
  ]);
}

function isCommercialInterestText(value = '') {
  return containsAny(value, [
    'välitys',
    'prosent',
    'miten tämä toimii',
    'ostohinta',
    'tarjous',
    'voitteko auttaa',
    'haluan myydä',
    'kiinnostaa',
    'myyntimalli',
  ]);
}

function isMachineAvailableText(value = '') {
  return containsAny(value, [
    'on se',
    'on vielä',
    'kyllä on',
    'joo on',
    'juu on',
    'myytävänä',
    'myynnissä',
    'löytyy vielä',
    'vielä on',
  ]);
}

async function countListings(supabase, { status, hasPhone, phoneSource } = {}) {
  let query = supabase
    .from('nordkone_listings')
    .select('id', { count: 'exact', head: true })
    .eq('client_key', CLIENT_KEY);

  if (status) query = query.eq('status', status);
  if (phoneSource) query = query.eq('phone_source', phoneSource);
  if (hasPhone) query = query.not('normalized_phone', 'is', null);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function countSessions(supabase, { replied, interestStatus, sentSince } = {}) {
  let query = supabase
    .from('campaign_outbound_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM);

  if (replied) query = query.not('last_inbound_at', 'is', null);
  if (interestStatus) query = query.eq('interest_status', interestStatus);
  if (sentSince) query = query.gte('last_outbound_at', sentSince);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function loadCampaignConfig(supabase) {
  const { data, error } = await supabase
    .from('campaign_client_config')
    .select('outbound_enabled,daily_cap,campaign_name')
    .eq('client_key', CLIENT_KEY)
    .maybeSingle();

  if (error) throw error;
  return data || { outbound_enabled: false, daily_cap: 0, campaign_name: CAMPAIGN_NAME };
}

function startOfTodayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function applyStatusFilter(query, status) {
  if (!status || status === 'all') return query;
  if (status === 'eligible') return query.eq('status', 'eligible').not('normalized_phone', 'is', null);
  if (status === 'replied') return query.in('status', ['replied', 'interested', 'sold', 'not_interested', 'opted_out', 'needs_human']);
  return query.eq('status', status);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function escapeLike(value) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export default router;
