const HARD_NOT_INTERESTED_RE = /\b(ei kiinnosta|en myy|ei tarvetta|ei kiitos)\b/i;
const WRITTEN_FOLLOWUP_RE = /(sähköpost|sahkopost|e-?mail|kirjallis)/i;
const CALL_REJECT_RE = /\bei\s+k[aä]y\b/i;
const INTERESTED_RE = /\b(kylla|kyllä|joo|juu|on kaupan|edelleen|soita|tarjous|kiinnostaa|voitte soittaa)\b/i;
const SOLD_RE = /\b(myyty|meni jo|ei ole enää|ei ole enaa|kaupat tehty)\b/i;
const OPTED_OUT_RE = /\b(älä|ala laita|lopeta|poista|ei viesteja|ei viestejä|stop)\b/i;

export function isHardNotInterested(message = '') {
  return HARD_NOT_INTERESTED_RE.test(String(message || ''));
}

export function isWrittenFollowupRequest(message = '') {
  return WRITTEN_FOLLOWUP_RE.test(String(message || ''));
}

export function isNeedsReviewReply(message = '') {
  const text = String(message || '');
  if (!text.trim() || isHardNotInterested(text)) return false;
  return isWrittenFollowupRequest(text) || CALL_REJECT_RE.test(text);
}

export function isBrokerageInterestText(message = '') {
  return /(palkkio|provisio|välityspalkk|välitys\s*%|prosentteina|hinnasto)/i.test(String(message || ''));
}

export function classifyInbound(message = '') {
  const text = String(message || '').toLowerCase();

  if (OPTED_OUT_RE.test(text)) {
    return { classification: 'opted_out', needs_human: false };
  }

  if (SOLD_RE.test(text)) {
    return { classification: 'sold', needs_human: false };
  }

  if (isNeedsReviewReply(text)) {
    return { classification: 'needs_review', needs_human: true };
  }

  if (HARD_NOT_INTERESTED_RE.test(text)) {
    return { classification: 'not_interested', needs_human: false };
  }

  if (INTERESTED_RE.test(text)) {
    return { classification: 'interested', needs_human: false };
  }

  return { classification: 'unclear', needs_human: true };
}

export const INBOUND_CLASSIFICATIONS = new Set([
  'interested',
  'sold',
  'not_interested',
  'unclear',
  'needs_human',
  'opted_out',
  'machine_available',
  'ready_for_call',
  'booked',
  'needs_review',
]);

export function normalizeInboundClassification(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return INBOUND_CLASSIFICATIONS.has(normalized) ? normalized : null;
}

export function listingStatusFromClass(classification) {
  const map = {
    unclear: 'replied',
    machine_available: 'replied',
    ready_for_call: 'interested',
    booked: 'interested',
    needs_review: 'needs_human',
    needs_human: 'needs_human',
    interested: 'interested',
    sold: 'sold',
    not_interested: 'not_interested',
    opted_out: 'opted_out',
  };
  return map[classification] || 'replied';
}

export function sessionStatusFromClass(classification) {
  if (classification === 'unclear' || classification === 'machine_available') return 'replied';
  if (classification === 'needs_review') return 'needs_human';
  if (classification === 'booked') return 'interested';
  return classification;
}

export function shouldForceNeedsHuman(classification) {
  return classification === 'needs_review' || classification === 'needs_human' || classification === 'unclear';
}

export function persistableInboundClass(classification) {
  const map = {
    needs_review: 'needs_human',
    machine_available: 'unclear',
    ready_for_call: 'interested',
    booked: 'interested',
  };
  return map[classification] || classification;
}
