import React, { useEffect, useMemo, useRef, useState } from 'react';

const COPY = {
  en: {
    deskName: 'WhatsApp Lead Desk',
    pitch: 'Every reply and every call for <em>reselling construction equipment</em>, in one place.',
    campaign: 'Työkoneiden jälleenmyynti',
    internal: 'Internal tool. Authorised users only.',
    title: 'Sign in',
    lede: 'Use the shared desk account.',
    username: 'Username',
    password: 'Password',
    show: 'Show',
    hide: 'Hide',
    caps: 'Caps Lock is on.',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    missing: 'Enter your username and password.',
    wrong: 'Incorrect username or password.',
    offline: 'Could not reach the server. Try again.',
    lockedBefore: 'Too many attempts. Try again in ',
    lockedAfter: '.',
    lockedNow: 'Too many attempts. Try again shortly.',
  },
  fi: {
    deskName: 'WhatsApp-liidipöytä',
    pitch: 'Kaikki <em>työkoneiden jälleenmyynnin</em> vastaukset ja soitot yhdessä paikassa.',
    campaign: 'Työkoneiden jälleenmyynti',
    internal: 'Sisäinen työkalu. Vain valtuutetuille.',
    title: 'Kirjaudu sisään',
    lede: 'Käytä yhteistä tunnusta.',
    username: 'Käyttäjätunnus',
    password: 'Salasana',
    show: 'Näytä',
    hide: 'Piilota',
    caps: 'Caps Lock on päällä.',
    signIn: 'Kirjaudu',
    signingIn: 'Kirjaudutaan…',
    missing: 'Anna käyttäjätunnus ja salasana.',
    wrong: 'Virheellinen käyttäjätunnus tai salasana.',
    offline: 'Palvelimeen ei saada yhteyttä. Yritä uudelleen.',
    lockedBefore: 'Liian monta yritystä. Yritä uudelleen ',
    lockedAfter: ' kuluttua.',
    lockedNow: 'Liian monta yritystä. Yritä hetken kuluttua uudelleen.',
  },
};

function clock(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
}

export function Login({ onAuthed }) {
  const [lang, setLang] = useState(() => (localStorage.getItem('nordkone.lang') === 'fi' ? 'fi' : 'en'));
  const [username, setUsername] = useState(() => localStorage.getItem('nordkone.user') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [nudge, setNudge] = useState(0);
  const userRef = useRef(null);
  const passwordRef = useRef(null);
  const text = COPY[lang];
  const lockedLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    (username ? passwordRef.current : userRef.current)?.focus();
  }, []);

  useEffect(() => {
    if (!lockedLeft) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedLeft]);

  useEffect(() => {
    if (lockedUntil && lockedLeft === 0) {
      setLockedUntil(0);
      setError('');
      setInvalid(false);
    }
  }, [lockedLeft, lockedUntil]);

  const lockMessage = useMemo(() => {
    if (!lockedLeft) return '';
    return { before: text.lockedBefore, clock: clock(lockedLeft), after: text.lockedAfter };
  }, [lockedLeft, text]);

  function pickLang(next) {
    setLang(next);
    localStorage.setItem('nordkone.lang', next);
  }

  function showError(message, { mark = false } = {}) {
    setError(message);
    setInvalid(mark);
    setNudge((value) => value + 1);
  }

  function onCaps(event) {
    setCaps(typeof event.getModifierState === 'function' && event.getModifierState('CapsLock'));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || lockedLeft) return;

    const user = username.trim();
    if (!user || !password) {
      showError(text.missing);
      (user ? passwordRef.current : userRef.current)?.focus();
      return;
    }

    setError('');
    setInvalid(false);
    setBusy(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.success) {
        localStorage.setItem('nordkone.user', user);
        onAuthed(payload.username || user);
        return;
      }

      setPassword('');
      if (response.status === 429) {
        const seconds = Number(payload.retry_after || response.headers.get('Retry-After') || 0);
        if (seconds > 0) {
          setLockedUntil(Date.now() + seconds * 1000);
          setInvalid(true);
          setNudge((value) => value + 1);
        } else {
          showError(text.lockedNow, { mark: true });
        }
        return;
      }

      showError(response.status === 401 ? text.wrong : payload.error || text.offline, { mark: true });
      passwordRef.current?.focus();
    } catch {
      showError(text.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-app">
      <aside className="login-aside">
        <div className="login-wordmark">
          <img className="login-logo" src="/nordkone-logo.png" alt="NordKone" width="161" height="78" />
          <span>{text.deskName}</span>
        </div>
        <div className="login-grow" />
        <div className="login-pitch" dangerouslySetInnerHTML={{ __html: text.pitch }} />
        <div className="login-campaign">
          <span className="login-dot" />
          <span>{text.campaign}</span>
        </div>
        <div className="login-grow" />
        <div className="login-foot">{text.internal}</div>
      </aside>

      <div className="login-main">
        <div className="login-main-top">
          <div className="login-langs">
            <button aria-pressed={lang === 'en'} onClick={() => pickLang('en')} type="button">EN</button>
            <button aria-pressed={lang === 'fi'} onClick={() => pickLang('fi')} type="button">FI</button>
          </div>
        </div>

        <div className="login-panel">
          <h1>{text.title}</h1>
          <div className="login-lede">{text.lede}</div>

          <form noValidate onSubmit={submit}>
            <div className="login-field">
              <label htmlFor="nordkone-user">{text.username}</label>
              <div className="login-control">
                <input
                  ref={userRef}
                  aria-invalid={invalid || undefined}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  id="nordkone-user"
                  name="username"
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (!lockedLeft) {
                      setError('');
                      setInvalid(false);
                    }
                  }}
                  required
                  spellCheck={false}
                  type="text"
                  value={username}
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="nordkone-password">{text.password}</label>
              <div className="login-control has-toggle">
                <input
                  ref={passwordRef}
                  aria-invalid={invalid || undefined}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  id="nordkone-password"
                  name="password"
                  onBlur={() => setCaps(false)}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (!lockedLeft) {
                      setError('');
                      setInvalid(false);
                    }
                  }}
                  onKeyDown={onCaps}
                  onKeyUp={onCaps}
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-controls="nordkone-password"
                  aria-pressed={showPassword}
                  className="login-peek"
                  onClick={() => {
                    setShowPassword((value) => !value);
                    passwordRef.current?.focus();
                  }}
                  type="button"
                >
                  {showPassword ? text.hide : text.show}
                </button>
              </div>
              <div className="login-hint" data-shown={caps ? 'true' : 'false'}>{text.caps}</div>
            </div>

            <button className="login-submit" data-busy={busy ? 'true' : 'false'} disabled={busy || Boolean(lockedLeft)} type="submit">
              <span className="login-spinner" aria-hidden="true" />
              <span>{busy ? text.signingIn : text.signIn}</span>
            </button>
          </form>

          <div className="login-note" data-shown={error || lockMessage ? 'true' : 'false'}>
            <div className="login-error" key={nudge} role="alert">
              {lockMessage ? (
                <>
                  {lockMessage.before}
                  <span className="num" aria-hidden="true">{lockMessage.clock}</span>
                  {lockMessage.after}
                </>
              ) : error}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
