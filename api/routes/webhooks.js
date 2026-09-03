import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { normalizePhone } from '../lib/phone.js';
import {
  classifyInbound,
  extractEmailAddress,
  isEmailOfferLeadStatus,
  isEmailOfferText,
  isKirjallinenLeadStatus,
  isNeedsReviewReply,
  isNoCallRequest,
  isSendEmailAction,
  isWrittenChannelText,
  isWrittenFollowupChannel,
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
  const calendarAction = payload.calendar_action || req.body?.calendar_action || payload.followup_channel;
  let classification = normalizeInboundClassification(providedClassification) || fallback.classification;
  let needsHuman =
    typeof payload.needs_human === 'boolean'
      ? payload.needs_human
      : shouldForceNeedsHuman(classification);

  const emailOffer =
    isEmailOfferLeadStatus(payload.lead_status) ||
    isEmailOfferLeadStatus(providedClassification) ||
    isSendEmailAction(calendarAction) ||
    isEmailOfferText(message);
  const writtenFollowup =
    emailOffer ||
    isKirjallinenLeadStatus(payload.lead_status) ||
    isKirjallinenLeadStatus(providedClassification) ||
    isWrittenFollowupChannel(payload.followup_channel) ||
    isWrittenFollowupChannel(calendarAction) ||
    isWrittenChannelText(message) ||
    isNoCallRequest(message);

  if (writtenFollowup || (classification === 'not_interested' && isNeedsReviewReply(message))) {
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
    const rawData = attachInboundSignals(session.raw_data || {}, payload, req.body, classification, now, message);
    const booked = classification === 'booked' || Boolean(rawData.calendar_booking && classification === 'booked');
    const emailReview =
      rawData.desk_status === 'Review' && ['email', 'written', 'kirjallinen'].includes(rawData.followup_channel);

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
      } else if (emailReview && !['Booked', 'Call Now', 'Callback', 'Deal Won', 'Deal Lost'].includes(session.raw_data?.desk_status)) {
        const { data: listing } = await supabase
          .from('nordkone_listings')
          .select('raw_data')
          .eq('client_key', CLIENT_KEY)
          .eq('nettikone_id', session.source_customer_id)
          .maybeSingle();
        const currentDesk = listing?.raw_data?.desk_status;
        if (!['Booked', 'Call Now', 'Callback', 'Deal Won', 'Deal Lost'].includes(currentDesk)) {
          listingPatch.raw_data = {
            ...(listing?.raw_data || {}),
            desk_status: 'Review',
            desk_status_updated_at: now,
            calendar_action: rawData.calendar_action,
            followup_channel: rawData.followup_channel,
            email_address: rawData.email_address || listing?.raw_data?.email_address || null,
          };
        }
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

function attachInboundSignals(rawData, payload, body, classification, now, message = '') {
  const next = {
    ...rawData,
    lead_status: payload.lead_status || classification,
    calendar_action: payload.calendar_action || body.calendar_action || rawData.calendar_action || null,
    call_time_text: payload.call_time_text || body.call_time_text || rawData.call_time_text || null,
    call_start: payload.call_start || body.call_start || rawData.call_start || null,
  };

  const sendEmail =
    isEmailOfferLeadStatus(payload.lead_status) ||
    isSendEmailAction(payload.calendar_action || body.calendar_action) ||
    isEmailOfferText(message) ||
    Boolean(extractEmailAddress(message));
  const writtenFollowup =
    sendEmail ||
    isKirjallinenLeadStatus(payload.lead_status) ||
    isWrittenFollowupChannel(payload.followup_channel) ||
    isWrittenChannelText(message) ||
    isNoCallRequest(message);

  if (classification === 'needs_review' && writtenFollowup) {
    next.calendar_action = sendEmail ? 'send_email' : payload.calendar_action || body.calendar_action || next.calendar_action || 'none';
    next.followup_channel =
      payload.followup_channel ||
      (sendEmail ? 'email' : 'kirjallinen');
    next.email_address = payload.email_address || extractEmailAddress(message) || rawData.email_address || null;
    if (!['Booked', 'Call Now', 'Callback', 'Deal Won', 'Deal Lost'].includes(rawData.desk_status)) {
      next.desk_status = 'Review';
      next.desk_status_updated_at = now;
    }
  }

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
