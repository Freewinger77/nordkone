import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { normalizePhone } from '../lib/phone.js';
import {
  classifyInbound,
  isNeedsReviewReply,
  listingStatusFromClass,
  normalizeInboundClassification,
  persistableInboundClass,
  sessionStatusFromClass,
  shouldForceNeedsHuman,
} from '../lib/classify.js';
import { CLIENT_KEY, SOURCE_SYSTEM } from '../lib/campaign.js';

const router = Router();

router.post('/wasup/inbound', async (req, res) => {
  const supabase = createSupabase();
  const payload = req.body?.body || req.body || {};
  const rawNumber = payload.from_phone || payload.from || payload.number || payload.phone;
  const message = payload.message || payload.text || (typeof payload.body === 'string' ? payload.body : '');
  const number = normalizePhone(rawNumber);

  if (!number) return res.status(400).json({ error: 'valid sender number is required' });
  if (!message) return res.status(400).json({ error: 'message is required' });

  const providedClassification =
    payload.classification || payload.lead_status || req.body?.classification || req.body?.lead_status;
  const fallback = classifyInbound(message);
  let classification = normalizeInboundClassification(providedClassification) || fallback.classification;
  let needsHuman =
    typeof payload.needs_human === 'boolean'
      ? payload.needs_human
      : shouldForceNeedsHuman(classification);

  if (classification === 'not_interested' && isNeedsReviewReply(message)) {
    classification = 'needs_review';
    needsHuman = true;
  }

  const { data: session, error: sessionError } = await supabase
    .from('campaign_outbound_sessions')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('number', number)
    .order('first_outbound_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionError) throw sessionError;

  const { data: inbound, error: inboundError } = await supabase
    .from('campaign_inbound_events')
    .insert({
      client_key: CLIENT_KEY,
      session_id: session?.id || null,
      prospect_id: session?.prospect_id || null,
      source_system: SOURCE_SYSTEM,
      source_customer_id: session?.source_customer_id || payload.nettikone_id || null,
      number,
      message,
      classification: persistableInboundClass(classification),
      needs_human: needsHuman,
      raw_event: req.body,
    })
    .select()
    .single();

  if (inboundError) throw inboundError;

  if (session) {
    const now = new Date().toISOString();
    const rawData = attachInboundSignals(session.raw_data || {}, payload, req.body, classification, now);
    const booked = classification === 'booked' || Boolean(rawData.calendar_booking && classification === 'booked');

    await supabase
      .from('campaign_outbound_sessions')
      .update({
        last_inbound_at: now,
        inbound_count: Number(session.inbound_count || 0) + 1,
        status: sessionStatusFromClass(classification),
        interest_status: classification,
        stop_reminders: ['sold', 'not_interested', 'opted_out', 'booked'].includes(classification),
        raw_data: rawData,
        ...(booked && !session.booked_at ? { booked_at: rawData.booked_at || now } : {}),
        updated_at: now,
      })
      .eq('id', session.id)
      .eq('client_key', CLIENT_KEY);

    if (session.source_customer_id) {
      const listingPatch = {
        status: listingStatusFromClass(classification),
        updated_at: now,
      };
      if (booked) {
        const { data: listing } = await supabase
          .from('nordkone_listings')
          .select('raw_data')
          .eq('client_key', CLIENT_KEY)
          .eq('nettikone_id', session.source_customer_id)
          .maybeSingle();
        listingPatch.raw_data = {
          ...(listing?.raw_data || {}),
          desk_status: 'Booked',
          desk_status_updated_at: now,
          calendar_booking: rawData.calendar_booking || listing?.raw_data?.calendar_booking || null,
        };
      }

      await supabase
        .from('nordkone_listings')
        .update(listingPatch)
        .eq('client_key', CLIENT_KEY)
        .eq('nettikone_id', session.source_customer_id);
    }

    if (session.prospect_id) {
      await supabase
        .from('campaign_prospects')
        .update({
          status: listingStatusFromClass(classification) === 'opted_out' ? 'opted_out' : 'replied',
          interest_status: classification,
          updated_at: now,
        })
        .eq('id', session.prospect_id)
        .eq('client_key', CLIENT_KEY);
    }
  }

  res.json({
    ok: true,
    inbound,
    classification,
    needs_human: needsHuman,
  });
});

function attachInboundSignals(rawData, payload, body, classification, now) {
  const next = {
    ...rawData,
    lead_status: payload.lead_status || classification,
    calendar_action: payload.calendar_action || body.calendar_action || rawData.calendar_action || null,
    call_time_text: payload.call_time_text || body.call_time_text || rawData.call_time_text || null,
    call_start: payload.call_start || body.call_start || rawData.call_start || null,
  };

  const eventId =
    payload.event_id ||
    payload.calendar_event_id ||
    payload.calendar_booking?.event_id ||
    payload.calendar_booking?.id ||
    payload.calendarBooking?.event_id;
  const start = payload.call_start || payload.start || payload.calendar_booking?.start || payload.calendarBooking?.start;
  const link = payload.link || payload.htmlLink || payload.calendar_booking?.link || payload.calendar_booking?.htmlLink;
  const action = String(next.calendar_action || '').toLowerCase();
  const shouldBook =
    classification === 'booked' ||
    ['create', 'created', 'booked', 'book'].includes(action) ||
    Boolean(eventId && (start || link));

  if (shouldBook && (eventId || start || link)) {
    next.calendar_booking = {
      ...(rawData.calendar_booking || {}),
      event_id: eventId || rawData.calendar_booking?.event_id || null,
      id: eventId || rawData.calendar_booking?.id || null,
      status: 'booked',
      start: start || rawData.calendar_booking?.start || null,
      end: payload.end || payload.calendar_booking?.end || rawData.calendar_booking?.end || null,
      link: link || rawData.calendar_booking?.link || null,
      htmlLink: link || rawData.calendar_booking?.htmlLink || null,
      source: 'wf2',
      updated_at: now,
    };
    next.desk_status = 'Booked';
    next.desk_status_updated_at = now;
    next.booked_at = rawData.booked_at || now;
  }

  return next;
}

export default router;
