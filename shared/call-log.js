export const CALL_OUTCOMES = [
  { id: 'deal', label: 'Deal', deskStatus: 'Deal Won' },
  { id: 'lost', label: 'Lost opportunity', deskStatus: 'Deal Lost' },
  { id: 'no_answer', label: 'No answer', deskStatus: 'No Answer' },
  { id: 'voicemail', label: 'Voicemail', deskStatus: null },
  { id: 'wrong_number', label: 'Wrong number', deskStatus: 'Not Interested' },
  { id: 'callback', label: 'Call back', deskStatus: 'Callback' },
];

const TERMINAL_DESK = new Set(['Deal Won', 'Deal Lost', 'Not Interested', 'Opted Out']);

export function outcomeById(id) {
  return CALL_OUTCOMES.find((row) => row.id === id) || null;
}

export function outcomeLabel(id) {
  if (id === 'snooze') return 'Snoozed';
  return outcomeById(id)?.label || id || 'Call';
}

export function nextMorningHelsinki(from = new Date()) {
  const tz = 'Europe/Helsinki';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(from);
  const [year, month, day] = today.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextYmd = [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');

  for (const utcHour of [6, 7]) {
    const candidate = new Date(`${nextYmd}T${String(utcHour).padStart(2, '0')}:00:00.000Z`);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        hour12: false,
      }).format(candidate)
    );
    if (hour === 9) return candidate;
  }

  return new Date(`${nextYmd}T06:00:00.000Z`);
}

export function applyCallLog({
  listing = {},
  outcome = null,
  comment = '',
  snooze = false,
  now = new Date(),
} = {}) {
  const outcomeId = outcome ? String(outcome).trim() : '';
  if (!outcomeId && !snooze) {
    const error = new Error('Pick an outcome or snooze');
    error.status = 400;
    throw error;
  }
  if (outcomeId && !outcomeById(outcomeId)) {
    const error = new Error('unsupported call outcome');
    error.status = 400;
    throw error;
  }

  const spec = outcomeById(outcomeId);
  const raw = { ...(listing.raw_data || {}) };
  const log = Array.isArray(raw.call_log) ? [...raw.call_log] : [];
  const at = now instanceof Date ? now : new Date(now);
  const iso = at.toISOString();
  let deskStatus = listing.desk_status || raw.desk_status || null;

  if (spec?.deskStatus) deskStatus = spec.deskStatus;
  else if (!deskStatus) deskStatus = 'Callback';

  let callbackAt = raw.callback_at || null;
  const schedulesFollowUp = Boolean(snooze || outcomeId === 'callback');
  if (schedulesFollowUp) {
    callbackAt = nextMorningHelsinki(at).toISOString();
    if (!TERMINAL_DESK.has(deskStatus)) deskStatus = 'Callback';
  }

  const entry = {
    id: `call_${at.getTime()}`,
    at: iso,
    outcome: outcomeId || 'snooze',
    comment: String(comment || '').trim().slice(0, 2000),
    desk_status: deskStatus,
    snooze: Boolean(snooze),
    snooze_until: schedulesFollowUp ? callbackAt : null,
  };
  log.push(entry);

  return {
    desk_status: deskStatus,
    raw_data: {
      ...raw,
      desk_status: deskStatus,
      desk_status_updated_at: iso,
      call_log: log,
      callback_at: callbackAt,
      last_call_at: iso,
      last_call_outcome: entry.outcome,
    },
    entry,
  };
}

export function mergeActivity(messages = [], callLog = []) {
  const items = [];

  for (const message of messages) {
    const outbound = Boolean(message.out || message.direction === 'outbound');
    items.push({
      id: `msg_${message.id || items.length}`,
      at: message.at || message.when || null,
      kind: outbound ? 'out' : 'reply',
      title: outbound ? 'Outbound message sent' : 'Customer replied',
      body: message.message || message.text || '',
    });
  }

  for (const entry of callLog) {
    const label = outcomeLabel(entry.outcome);
    const note = String(entry.comment || '').trim();
    items.push({
      id: entry.id || `call_${items.length}`,
      at: entry.at,
      kind: 'call',
      title: note ? `${label} — ${note}` : label,
      body: note,
    });
  }

  return items.sort((left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0));
}

export function listingCallFields(row = {}) {
  const raw = row.raw_data || {};
  return {
    call_log: Array.isArray(row.call_log) ? row.call_log : Array.isArray(raw.call_log) ? raw.call_log : [],
    callback_at: row.callback_at || raw.callback_at || null,
    last_call_at: row.last_call_at || raw.last_call_at || null,
    last_call_outcome: row.last_call_outcome || raw.last_call_outcome || null,
    labels: normalizeLabels(row.labels || raw.labels),
  };
}

export const LABEL_MAX = 12;
export const LABEL_MAX_LEN = 24;

export function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, LABEL_MAX_LEN);
}

export function normalizeLabels(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const labels = [];
  for (const value of values) {
    const label = normalizeLabel(value);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= LABEL_MAX) break;
  }
  return labels;
}

export function applyLabels({ listing = {}, add = null, remove = null } = {}) {
  const raw = { ...(listing.raw_data || {}) };
  let labels = normalizeLabels(raw.labels || listing.labels);
  const drop = normalizeLabel(remove);
  if (drop) labels = labels.filter((label) => label.toLowerCase() !== drop.toLowerCase());
  const next = normalizeLabel(add);
  if (next && !labels.some((label) => label.toLowerCase() === next.toLowerCase())) {
    if (labels.length >= LABEL_MAX) {
      const error = new Error('Too many labels');
      error.status = 400;
      throw error;
    }
    labels.push(next);
  }
  if (!drop && !next) {
    const error = new Error('Add or remove a label');
    error.status = 400;
    throw error;
  }
  return {
    labels,
    raw_data: { ...raw, labels },
  };
}

export function formatActivityWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Helsinki',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('day')} ${pick('month')}, ${pick('hour')}:${pick('minute')}`;
}
