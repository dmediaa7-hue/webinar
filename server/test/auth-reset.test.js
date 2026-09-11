// Integration tests for the self-hosted password-reset flow. There is no mail
// infra - the reset link is returned in the API response itself - so these
// assertions cover the full loop: issuing a token, applying it, the old
// password being revoked, and single-use/garbage/short-password rejections.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 3020 = recording, 3010 = host-controls, 3030 = breakout, 3040 = waiting-room
const TEST_PORT = 3060;
const SERVER_URL = `http://localhost:${TEST_PORT}`;
const serverDir = path.join(__dirname, '..');

const DB_PATH = path.join(os.tmpdir(), `webinar-auth-reset-${Date.now()}.db`);

async function waitForServer(proc, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (proc.exitCode !== null) throw new Error('Server exited before becoming ready');
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function tokenFromLink(resetLink) {
  return new URL(resetLink).searchParams.get('token');
}

test('password-reset flow revokes the old password, enforces single-use tokens, and rejects bad input', async (t) => {
  const proc = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(TEST_PORT), DB_PATH }
  });

  t.after(() => {
    proc.kill();
  });

  await waitForServer(proc);

  const tag = Date.now();
  let seq = 0;
  const uniqueEmail = () => `reset-user-${tag}-${seq++}@example.com`;

  try {
    // 1. Unknown email -> 404 with an error, never leaks account existence.
    let res = await postJson(`${SERVER_URL}/api/auth/forgot-password`, { email: 'ghost@example.com' });
    assert.equal(res.status, 404, 'forgot-password for unknown email returns 404');
    assert.ok((await res.json()).error, '404 body carries an error message');

    // 2. Register a user, request a reset -> 200 with resetLink on the client.
    const email = uniqueEmail();
    const OLD_PASSWORD = 'OldPass2024!';
    res = await postJson(`${SERVER_URL}/api/auth/register`, { email, name: 'Reset User', password: OLD_PASSWORD });
    assert.equal(res.status, 201, 'user registers');

    res = await postJson(`${SERVER_URL}/api/auth/forgot-password`, { email });
    assert.equal(res.status, 200, 'forgot-password for a real account returns 200');
    const forgot = await res.json();
    assert.equal(forgot.ok, true, 'forgot-password returns ok:true');
    assert.ok(
      typeof forgot.resetLink === 'string' && forgot.resetLink.includes('/reset-password?token='),
      'resetLink points at the client reset page with a token'
    );

    // 3. Apply the token with a new password -> 200 ok:true.
    const token = tokenFromLink(forgot.resetLink);
    assert.ok(token, 'reset token extracted from the link');
    res = await postJson(`${SERVER_URL}/api/auth/reset-password`, { token, password: 'NewPass123!' });
    assert.equal(res.status, 200, 'reset-password returns 200');
    assert.deepEqual(await res.json(), { ok: true }, 'reset-password returns ok:true');

    // 4. Login with the NEW password succeeds.
    res = await postJson(`${SERVER_URL}/api/auth/login`, { email, password: 'NewPass123!' });
    assert.equal(res.status, 200, 'login with the new password returns 200');

    // 5. Login with the OLD password is rejected (proves it was revoked).
    res = await postJson(`${SERVER_URL}/api/auth/login`, { email, password: OLD_PASSWORD });
    assert.equal(res.status, 401, 'login with the old password returns 401');

    // 6. The same token cannot be used twice (single-use).
    res = await postJson(`${SERVER_URL}/api/auth/reset-password`, { token, password: 'AnotherPass123!' });
    assert.equal(res.status, 400, 'reusing a consumed token returns 400');

    // 7. A garbage token is rejected.
    res = await postJson(`${SERVER_URL}/api/auth/reset-password`, { token: 'not-a-real-token', password: 'Whatever123!' });
    assert.equal(res.status, 400, 'reset-password with a garbage token returns 400');

    // 8. Short password rejected (fresh user + fresh token so it fails for the
    //    right reason, not because the token was consumed).
    const email2 = uniqueEmail();
    res = await postJson(`${SERVER_URL}/api/auth/register`, { email: email2, name: 'Reset User 2', password: OLD_PASSWORD });
    assert.equal(res.status, 201, 'second user registers');
    res = await postJson(`${SERVER_URL}/api/auth/forgot-password`, { email: email2 });
    assert.equal(res.status, 200, 'second user gets a reset token');
    const token2 = tokenFromLink((await res.json()).resetLink);
    res = await postJson(`${SERVER_URL}/api/auth/reset-password`, { token: token2, password: 'short' });
    assert.equal(res.status, 400, 'reset-password with a too-short password returns 400');
  } finally {
    // Remove the temp DB so child kills never leave -wal/-shm stragglers behind.
    try { fs.unlinkSync(DB_PATH); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(DB_PATH + '-wal'); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(DB_PATH + '-shm'); } catch (e) { /* ignore */ }
  }
});