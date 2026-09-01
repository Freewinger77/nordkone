import assert from 'node:assert/strict';
import {
  credentialsMatch,
  lockState,
  recordFailure,
  resetAuthAttempts,
  signSession,
  verifySession,
} from '../api/lib/desk-auth.js';

resetAuthAttempts();

assert.equal(credentialsMatch('nordkone', 'Wasup@123'), true);
assert.equal(credentialsMatch('Nordkone', 'Wasup@123'), true);
assert.equal(credentialsMatch('NORDKONE', 'Wasup@123'), true);
assert.equal(credentialsMatch('NordKone', 'Wasup@123'), true);
assert.equal(credentialsMatch(' nordkone ', 'Wasup@123'), true);
assert.equal(credentialsMatch('nordkone', 'wasup@123'), false);
assert.equal(credentialsMatch('', ''), false);

const token = signSession('nordkone', 1_000);
assert.equal(verifySession(token, 1_001).sub, 'nordkone');
assert.equal(verifySession('nope', 1_001), null);
assert.equal(verifySession(token, 1_000 + 31 * 24 * 60 * 60 * 1000), null);

const key = '1.1.1.1:nordkone';
for (let i = 0; i < 4; i += 1) {
  const state = recordFailure(key, 5_000);
  assert.equal(state.locked, false);
}
const locked = recordFailure(key, 5_000);
assert.equal(locked.locked, true);
assert.ok(locked.retryAfter > 0);
assert.equal(lockState(key, 5_000).locked, true);
assert.equal(lockState(key, 5_000 + 46_000).locked, false);

console.log('auth tests passed');
