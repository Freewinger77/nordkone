import { reconcileLead } from '../../../shared/reconcile.js';

export const DESK_STATUSES = [
  { label: 'Interested', dot: 'rgb(113,221,140)' },
  { label: 'No Answer', dot: 'rgb(255,204,0)' },
  { label: 'Callback', dot: 'rgb(76,152,253)' },
  { label: 'Booked', dot: 'rgb(79,80,127)' },
  { label: 'Deal Won', dot: 'rgb(113,221,140)' },
  { label: 'Deal Lost', dot: 'rgb(255,71,71)' },
  { label: 'Not Interested', dot: 'rgba(0,0,0,0.2)' },
  { label: 'Opted Out', dot: 'rgba(0,0,0,0.2)' },
  { label: 'Review', dot: 'rgb(184,153,235)' },
];

const STATUS_DOT = Object.fromEntries(DESK_STATUSES.map((row) => [row.label, row.dot]));

export const QUEUE_KEY = 'nordkone-work-queue-v2';

export {
  FLOW_FILTERS,
  countFlow,
  isOpenOpportunity,
  matchesFlowFilter,
  reconcileLead,
} from '../../../shared/reconcile.js';

export function statusDot(label) {
  if (label === 'Replied') return 'rgb(255,204,0)';
  return STATUS_DOT[label] || 'rgba(0,0,0,0.2)';
}

export function listingToDeskStatus(listing = {}, conversation = {}, calendarCalls = []) {
  return reconcileLead({ listing, conversation, calendarCalls }).stage;
}

export function listingStatusLabel(status) {
  const map = {
    eligible: 'Eligible',
    contacted: 'In session',
    replied: 'In session',
    interested: 'In session',
    sold: 'In session',
    not_interested: 'In session',
    opted_out: 'In session',
    needs_human: 'In session',
    ignored: 'Ignored',
  };
  return map[status] || status || 'Eligible';
}

export function cut(text, max = 30) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max).replace(/\s+$/, '')}…` : value;
}

export function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

export function parseEuroAmount(value) {
  if (value == null || value === '') return 0;
  const match = String(value).replace(/\s/g, '').match(/[\d.,]+/);
  if (!match) return 0;
  const raw = match[0];
  const normalized = raw.includes(',') && !raw.includes('.')
    ? raw.replace(',', '.')
    : raw.replace(/,/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

export function isSuspiciousPrice(priceText, priceEur) {
  const amount = Number(priceEur) || parseEuroAmount(priceText);
  return amount > 0 && amount < 20;
}

export function relativeAgo(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatHelsinkiTime(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Helsinki',
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${Number(pick('day'))}.${Number(pick('month'))}. ${pick('hour')}:${pick('minute')}`;
}

export function statusWash(label) {
  const color = STATUS_DOT[label] || 'rgba(0,0,0,0.2)';
  const match = String(color).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return 'rgba(0,0,0,0.04)';
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, 0.16)`;
}

export function formatHelsinkiClock(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Helsinki',
  }).format(new Date(value));
}

export function startOfHelsinkiWeek(offset = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const weekdayIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
  const monday = new Date(Date.UTC(year, month - 1, day - weekdayIndex + offset * 7));
  return monday;
}

export function buildWeek(offset, calls = []) {
  const monday = startOfHelsinkiWeek(offset);
  const todayKey = helsinkiDateKey(new Date());
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayCount = weekendVisible(monday, calls, todayKey) ? 7 : 5;

  const days = names.slice(0, weekdayCount).map((name, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    const key = helsinkiDateKey(date);
    const events = calls
      .filter((call) => call.scheduled_start && helsinkiDateKey(call.scheduled_start) === key)
      .map((call) => ({
        at: formatHelsinkiClock(call.scheduled_start),
        machine: call.listing?.machine_title || call.source_customer_id || call.number,
        phone: call.callback_number || call.number,
        leadId: call.source_customer_id || call.number,
      }));
    return {
      name,
      num: String(date.getUTCDate()),
      today: key === todayKey,
      events,
    };
  });

  const first = days[0];
  const last = days[4];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startMonth = monthNames[monday.getUTCMonth()];
  const endDate = new Date(monday);
  endDate.setUTCDate(monday.getUTCDate() + 4);
  const endMonth = monthNames[endDate.getUTCMonth()];
  const label =
    startMonth === endMonth
      ? `${first.num} – ${last.num} ${startMonth}`
      : `${first.num} ${startMonth} – ${last.num} ${endMonth}`;

  const count = days.reduce((sum, day) => sum + day.events.length, 0);
  return {
    label,
    count: count === 0 ? 'No calls booked' : count === 1 ? '1 call booked' : `${count} calls booked`,
    days,
  };
}

export function buildOutboundMessage(machineTitle, template) {
  const title = machineTitle || 'kone';
  if (template) return template.replaceAll('{kone}', title);
  return `Moikka! Sulla oli Nettikoneessa ${title} myynnissä. Onko se edelleen kaupan?`;
}

export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function ribbon(x0, x1, y0, y1, h) {
  const m = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${m} ${y0}, ${m} ${y1}, ${x1} ${y1} L ${x1} ${y1 + h} C ${m} ${y1 + h}, ${m} ${y0 + h}, ${x0} ${y0 + h} Z`;
}

export function smooth(vals, w, h, pad) {
  const max = Math.max(...vals, 1);
  const step = (w - pad * 2) / Math.max(vals.length - 1, 1);
  const pts = vals.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = (p0[0] + p1[0]) / 2;
    d += ` C ${cx} ${p0[1]}, ${cx} ${p1[1]}, ${p1[0]} ${p1[1]}`;
  }
  return d;
}

export function poly(vals, w, h, pad) {
  const max = Math.max(...vals, 1);
  const step = (w - pad * 2) / Math.max(vals.length - 1, 1);
  return vals
    .map((v, i) => `${pad + i * step} ${h - pad - (v / max) * (h - pad * 2)}`)
    .join(' L ')
    .replace(/^/, 'M ');
}

export function buildFlow(counts, activeStage) {
  const messaged = counts.messaged || 0;
  const replied = counts.replied || 0;
  const noreply = Math.max(messaged - replied, 0);
  const notint = counts.notint || 0;
  const review = counts.review || 0;
  const won = counts.won || 0;
  const lost = counts.lost || 0;
  const booked = counts.booked || 0;
  const callback = counts.callback || counts.await || 0;
  const scale = Math.max(messaged, 1);

  const cols = [
    [{ k: 'messaged', label: 'Messaged', v: messaged, pct: `${pct(messaged, counts.eligible || messaged)} of queue`, c: 'rgb(0,0,0)' }],
    [
      { k: 'replied', label: 'Replied', v: replied, pct: pct(replied, messaged), c: 'rgb(255,204,0)' },
      { k: 'noreply', label: 'No reply', v: noreply, pct: pct(noreply, messaged), c: 'rgba(0,0,0,0.2)' },
    ],
    [
      { k: 'callback', label: 'Callback', v: callback, pct: pct(callback, replied), c: 'rgb(76,152,253)' },
      { k: 'booked', label: 'Booked', v: booked, pct: pct(booked, replied), c: 'rgb(79,80,127)' },
      { k: 'review', label: 'Review', v: review, pct: pct(review, replied), c: 'rgb(184,153,235)' },
      { k: 'lost', label: 'Deal lost', v: lost, pct: pct(lost, replied), c: 'rgb(255,71,71)' },
      { k: 'won', label: 'Deal won', v: won, pct: pct(won, replied), c: 'rgb(113,221,140)' },
      { k: 'notint', label: 'Not interested', v: notint, pct: pct(notint, replied), c: 'rgba(0,0,0,0.2)' },
    ],
  ]
    .map((col, index) => col.filter((node) => node.v > 0 || (index === 0 && node.k === 'messaged')))
    .filter((col) => col.length);

  const linksSpec = [
    ['messaged', 'replied', replied],
    ['messaged', 'noreply', noreply],
    ['replied', 'callback', callback],
    ['replied', 'booked', booked],
    ['replied', 'review', review],
    ['replied', 'lost', lost],
    ['replied', 'won', won],
    ['replied', 'notint', notint],
  ].filter(([, target, value]) => value > 0 && cols.flat().some((node) => node.k === target));

  const vw = 1100;
  const bw = 16;
  const labelRoom = 208;
  const left = 10;
  const lastX = vw - labelRoom;
  const x = cols.map((_, index) => Math.round(left + ((lastX - left) * index) / Math.max(cols.length - 1, 1)));
  const top = 6;
  const height = 300;
  const gap = 16;
  const unit = height / scale;
  const lmin = 44;
  const map = {};
  const nodes = [];

  cols.forEach((col, ci) => {
    const lastCol = ci === cols.length - 1 && map.replied;
    let y = lastCol ? map.replied.y : top;
    let prevC = lastCol ? map.replied.y - lmin : -999;
    col.forEach((n) => {
      const h = Math.max(n.v * unit, 10);
      let lc = y + h / 2;
      if (lc - prevC < lmin) lc = prevC + lmin;
      prevC = lc;
      const node = {
        k: n.k,
        x: x[ci],
        y,
        h,
        w: bw,
        label: n.label,
        count: `${n.v} (${n.pct})`,
        c: n.c,
        lfg: activeStage === n.k ? 'rgb(79,80,127)' : 'rgb(0,0,0)',
        left: `${((x[ci] + bw + 14) / vw) * 100}%`,
        lc,
        outCur: y,
        inCur: y,
      };
      map[n.k] = node;
      nodes.push(node);
      y += h + gap;
    });
  });

  const vh = Math.max(...nodes.map((node) => node.y + node.h), 140) + 18;
  for (const node of nodes) {
    node.top = `${(node.lc / vh) * 100}%`;
  }

  const links = linksSpec.filter(([a, b]) => map[a] && map[b]).map(([a, b, v]) => {
    const s = map[a];
    const t = map[b];
    const remainS = Math.max(s.y + s.h - s.outCur, 8);
    const remainT = Math.max(t.y + t.h - t.inCur, 8);
    const h = Math.min(Math.max(v * unit, 8), remainS, remainT);
    const d = ribbon(s.x + s.w, t.x, s.outCur, t.inCur, h);
    s.outCur += h;
    t.inCur += h;
    return { d, from: a, to: b };
  });

  return { nodes, links, vw, vh };
}

export function weekdayReplySeries(conversations = []) {
  const office = [0, 0, 0, 0, 0, 0, 0];
  const after = [0, 0, 0, 0, 0, 0, 0];

  for (const conversation of conversations) {
    for (const message of conversation.messages || []) {
      if (message.direction !== 'inbound' || !message.at) continue;
      const parts = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        hour: '2-digit',
        hour12: false,
        timeZone: 'Europe/Helsinki',
      }).formatToParts(new Date(message.at));
      const weekday = parts.find((part) => part.type === 'weekday')?.value;
      const hour = Number(parts.find((part) => part.type === 'hour')?.value);
      const index = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday];
      if (index == null) continue;
      if (hour >= 8 && hour < 17 && index < 5) office[index] += 1;
      else after[index] += 1;
    }
  }

  return { office, after };
}

export function bookedSpark(calls = []) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Helsinki',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  });
  return days.map((key) =>
    calls.filter((call) => call.scheduled_start && call.scheduled_start.slice(0, 10) === key).length
  );
}

function helsinkiDateKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function weekendVisible(monday, calls, todayKey) {
  return [5, 6].some((offset) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + offset);
    const key = helsinkiDateKey(date);
    return (
      key === todayKey ||
      calls.some((call) => call.scheduled_start && helsinkiDateKey(call.scheduled_start) === key)
    );
  });
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}
