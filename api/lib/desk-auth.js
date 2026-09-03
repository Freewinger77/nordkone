import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'nordkone_desk';
export const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 45;

const attempts = new Map();

export function deskUsername() {
  return process.env.DESK_USERNAME || 'nordkone';
}

export function deskPassword() {
  return process.env.DESK_PASSWORD || 'Wasup@123';
}

export function sessionSecret() {
  return process.env.DESK_SESSION_SECRET || process.env.CRON_SECRET || process.env.API_KEY || 'nordkone-desk-session';
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function credentialsMatch(username, password) {
  const userOk = safeEqual(
    String(username || '').trim().toLowerCase(),
    String(deskUsername() || '').trim().toLowerCase(),
  );
  const passOk = safeEqual(String(password || ''), deskPassword());
  return userOk && passOk;
}

export function signSession(username, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      exp: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
    })
  ).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token, now = Date.now()) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.sub || !data.exp || data.exp <= now) return null;
    return data;
  } catch {
    return null;
  }
}

export function readCookie(header, name = COOKIE_NAME) {
  if (!header) return '';
  const parts = String(header).split(';');
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

export function cookieHeader(token, { secure = false, maxAge = SESSION_DAYS * 24 * 60 * 60 } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, maxAge)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader({ secure = false } = {}) {
  return cookieHeader('', { secure, maxAge: 0 });
}

export function attemptKey(req, username = '') {
  const forwarded = req.get?.('x-forwarded-for') || req.headers?.['x-forwarded-for'] || '';
  const ip = String(forwarded).split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}:${String(username || '').trim().toLowerCase()}`;
}

export function lockState(key, now = Date.now()) {
  const row = attempts.get(key);
  if (!row) return { locked: false, retryAfter: 0, failures: 0 };
  if (row.lockedUntil && row.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((row.lockedUntil - now) / 1000), failures: row.failures };
  }
  if (row.lockedUntil && row.lockedUntil <= now) {
    attempts.delete(key);
    return { locked: false, retryAfter: 0, failures: 0 };
  }
  return { locked: false, retryAfter: 0, failures: row.failures };
}

export function recordFailure(key, now = Date.now()) {
  const current = attempts.get(key) || { failures: 0, lockedUntil: 0 };
  const failures = current.failures + 1;
  const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_SECONDS * 1000 : 0;
  attempts.set(key, { failures: lockedUntil ? 0 : failures, lockedUntil });
  return lockState(key, now);
}

export function clearFailures(key) {
  attempts.delete(key);
}

export function resetAuthAttempts() {
  attempts.clear();
}
