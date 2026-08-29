import { Router } from 'express';
import {
  attemptKey,
  clearCookieHeader,
  clearFailures,
  cookieHeader,
  credentialsMatch,
  deskUsername,
  lockState,
  readCookie,
  recordFailure,
  signSession,
  verifySession,
} from '../lib/desk-auth.js';

const router = Router();

function wantsSecure(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

router.get('/me', (req, res) => {
  const session = verifySession(readCookie(req.get('cookie')));
  if (!session) return res.json({ ok: false });
  res.json({ ok: true, username: session.sub });
});

router.post('/login', (req, res) => {
  const username = String(req.body?.user ?? req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const key = attemptKey(req, username);
  const lock = lockState(key);

  if (lock.locked) {
    res.set('Retry-After', String(lock.retryAfter));
    return res.status(429).json({ error: 'locked', retry_after: lock.retryAfter });
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'missing' });
  }

  if (!credentialsMatch(username, password)) {
    const next = recordFailure(key);
    if (next.locked) {
      res.set('Retry-After', String(next.retryAfter));
      return res.status(429).json({ error: 'locked', retry_after: next.retryAfter });
    }
    return res.status(401).json({ error: 'invalid' });
  }

  clearFailures(key);
  res.set('Set-Cookie', cookieHeader(signSession(deskUsername()), { secure: wantsSecure(req) }));
  res.json({ success: true, username: deskUsername() });
});

router.post('/logout', (req, res) => {
  res.set('Set-Cookie', clearCookieHeader({ secure: wantsSecure(req) }));
  res.json({ ok: true });
});

export default router;
