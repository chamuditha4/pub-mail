import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api,
  downloadAttachment,
  type CreatedInbox,
  type Domain,
  type MessageDetail,
  type MessageSummary,
  type OwnedInbox,
  type UniboxMessage,
  type User,
} from './api.js';
import { ApiGuide } from './ApiGuide.js';
import { AdminDomains } from './AdminDomains.js';
import { ApiKeys } from './ApiKeys.js';
import { AdminConsole } from './AdminConsole.js';
import { AbuseReport } from './AbuseReport.js';
import { Webhooks } from './Webhooks.js';
import { SeaScene, SkyScene } from './Scenery.js';

type View = 'mail' | 'api' | 'admin' | 'keys' | 'hooks' | 'ops' | 'report';

const STORAGE_KEY = 'tmp-mail.inbox';

interface StoredInbox {
  id: string;
  address: string;
  token: string;
  expires_at: string;
}

function loadStored(): StoredInbox | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredInbox) : null;
  } catch {
    return null;
  }
}

// Live updates via Server-Sent Events. On each 'message' signal we refetch; the
// browser's EventSource auto-reconnects when the ~60s server stream closes.
function useLiveUpdates(
  url: string | null,
  withCredentials: boolean,
  onPing: () => void,
  onClosed?: () => void,
) {
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url, { withCredentials });
    es.addEventListener('message', () => onPing());
    es.addEventListener('closed', () => {
      es.close();
      onClosed?.();
    });
    return () => es.close();
  }, [url, withCredentials, onPing, onClosed]);
}

function useCountdown(expiresAt: string | undefined): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return '';
  const secs = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function useDomains(onError: (m: string) => void) {
  const [domains, setDomains] = useState<Domain[]>([]);
  useEffect(() => {
    api
      .listDomains()
      .then(setDomains)
      .catch((e: Error) => onError(e.message));
  }, [onError]);
  return domains;
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, []);
  return [copied, copy];
}

export function App() {
  const [inbox, setInbox] = useState<StoredInbox | null>(loadStored);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [view, setView] = useState<View>('mail');

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const persist = useCallback((next: StoredInbox | null) => {
    setInbox(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    setUser(null);
    setView('mail');
  }

  const onCreated = useCallback(
    (c: CreatedInbox) =>
      persist({ id: c.id, address: c.address, token: c.access_token, expires_at: c.expires_at }),
    [persist],
  );

  const landing = !user && view === 'mail';

  return (
    <div className="site">
      <SiteHeader
        user={user ?? null}
        view={view}
        onView={setView}
        onAuth={() => {
          setView('mail');
          setShowAuth(true);
        }}
        onLogout={logout}
      />

      {landing ? (
        <Hero
          inbox={inbox}
          onCreated={onCreated}
          onError={setError}
          auth={
            showAuth ? (
              <AuthPanel
                onAuthed={(u: User) => {
                  setUser(u);
                  setShowAuth(false);
                }}
                onClose={() => setShowAuth(false)}
                onError={setError}
              />
            ) : null
          }
        />
      ) : (
        <PageHead view={view} user={user ?? null} />
      )}

      <main className="main">
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}

        {view === 'api' ? (
          <ApiGuide />
        ) : view === 'report' ? (
          <AbuseReport onError={setError} />
        ) : view === 'admin' && user ? (
          <AdminDomains onError={setError} />
        ) : view === 'keys' && user ? (
          <ApiKeys onError={setError} />
        ) : view === 'hooks' && user ? (
          <Webhooks onError={setError} />
        ) : view === 'ops' && user?.role === 'admin' ? (
          <AdminConsole onError={setError} />
        ) : user ? (
          <Unibox onError={setError} />
        ) : inbox ? (
          <InboxView inbox={inbox} onReset={() => persist(null)} onError={setError} />
        ) : (
          <FeatureRow />
        )}
      </main>

      <SiteFooter onView={setView} />
    </div>
  );
}

function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect x="2" y="7" width="28" height="20" rx="4" fill="#ffffff" />
        <path d="M4 11l12 8 12-8" fill="none" stroke="#1d4e6f" strokeWidth="2.6" />
        <circle cx="26" cy="8" r="6" fill="#e05a52" />
      </svg>
      <span>
        tmp<b>mail</b>
      </span>
    </span>
  );
}

function SiteHeader(props: {
  user: User | null;
  view: View;
  onView: (v: View) => void;
  onAuth: () => void;
  onLogout: () => void;
}) {
  const { user, view, onView } = props;
  const tabs: Array<[View, string]> = [
    ['mail', user ? 'Unified inbox' : 'Inbox'],
    ['api', 'API'],
    ...(user
      ? ([
          ['admin', 'Domains'],
          ['keys', 'API keys'],
          ['hooks', 'Webhooks'],
        ] as Array<[View, string]>)
      : []),
    ...(user?.role === 'admin' ? ([['ops', 'Admin']] as Array<[View, string]>) : []),
  ];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => onView('mail')}>
          <Logo />
        </button>

        <nav className="topnav">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={view === id ? 'active' : ''}
              onClick={() => onView(id)}
              aria-current={view === id ? 'page' : undefined}
            >
              {label}
            </button>
          ))}
          <a href={`${api.base}/docs`} target="_blank" rel="noreferrer">
            Docs ↗
          </a>
        </nav>

        <div className="topbar-actions">
          {user ? (
            <>
              <span className="who">@{user.username}</span>
              <button className="ghost" onClick={props.onLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button className="solid" onClick={props.onAuth}>
                Sign up
              </button>
              <button className="ghost" onClick={props.onAuth}>
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const PAGE_COPY: Record<Exclude<View, 'mail'> | 'unibox', [string, string]> = {
  unibox: ['Your unified inbox', 'Every address on your account, in one stream.'],
  api: ['REST API', 'Create inboxes and read mail straight from your code.'],
  admin: ['Domains', 'Register zones, enable routing, and set inbox policy.'],
  keys: ['API keys', 'Issue scoped keys. The secret is shown exactly once.'],
  hooks: ['Webhooks', 'Get signed HTTP callbacks when mail arrives.'],
  ops: ['Admin console', 'Platform metrics, abuse blocklist, and reports.'],
  report: ['Report abuse', 'Flag spam, phishing, or misuse for review.'],
};

function PageHead({ view, user }: { view: View; user: User | null }) {
  const [title, sub] = PAGE_COPY[view === 'mail' ? 'unibox' : view];
  return (
    <div className="page-head">
      <div className="page-head-inner">
        <h1>{title}</h1>
        <p>{view === 'mail' && user ? `Signed in as @${user.username}. ${sub}` : sub}</p>
      </div>
    </div>
  );
}

function Hero(props: {
  inbox: StoredInbox | null;
  onCreated: (c: CreatedInbox) => void;
  onError: (m: string) => void;
  /** When set, the hero shows this panel instead of the address widget. */
  auth?: ReactNode;
}) {
  const { inbox, onCreated, onError, auth } = props;
  const domains = useDomains(onError);
  const [domain, setDomain] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();
  const countdown = useCountdown(inbox?.expires_at);

  const selected = useMemo(
    () => domains.find((d) => d.name === domain) ?? domains[0],
    [domains, domain],
  );
  const activeDomain = selected?.name ?? '';

  async function create() {
    if (!activeDomain) return;
    setBusy(true);
    try {
      onCreated(await api.createInbox(activeDomain, localPart.trim() || undefined));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Carrying real UI (auth form, a live address) shortens the artwork so the
  // interactive part stays near the top of the page.
  const compact = Boolean(auth) || Boolean(inbox);

  return (
    <section className={compact ? 'hero compact' : 'hero'}>
      <SkyScene />

      <div className="hero-content">
        <h1>Catch email that disappears.</h1>

        {auth ? (
          auth
        ) : inbox ? (
          <>
            <p className="hero-lead">Now send your email to:</p>
            <div className="address-field">
              <input value={inbox.address} readOnly aria-label="Your temporary address" />
              <button className="copy" onClick={() => copy(inbox.address)}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a className="hero-cta" href="#inbox">
              Then check your inbox
            </a>
            <p className="hero-note">
              {countdown === '0:00' ? 'This address has expired.' : `Expires in ${countdown}`} · no
              signup, nothing to install
            </p>
          </>
        ) : (
          <>
            <p className="hero-lead">First, pick your address:</p>
            <div className="address-field compose">
              <input
                value={localPart}
                placeholder="random"
                aria-label="Address name"
                disabled={selected ? !selected.allow_custom_local_parts : false}
                onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
              />
              <span className="at">@</span>
              <select
                value={activeDomain}
                aria-label="Domain"
                onChange={(e) => setDomain(e.target.value)}
              >
                {domains.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="hero-cta" disabled={busy || !activeDomain} onClick={create}>
              {busy ? 'Creating…' : 'Create my address'}
            </button>
            <p className="hero-note">
              {domains.length === 0
                ? 'No public domains are available right now.'
                : 'Receive-only · auto-deleted on expiry · no signup'}
            </p>
          </>
        )}
      </div>

      <div className="hero-art">
        <SeaScene band={compact} />
      </div>
    </section>
  );
}

const FEATURES: Array<[string, string, string]> = [
  ['⚡', 'Instant addresses', 'Pick a name or take a random one. Mail arrives in seconds.'],
  ['🛡️', 'Safe by default', 'HTML is sanitized and remote images stay blocked until you ask.'],
  ['⏳', 'Deleted on expiry', 'Messages, raw MIME, and attachments are purged automatically.'],
  ['🔌', 'Built for automation', 'A REST API with SSE and webhooks for your test suites.'],
];

function FeatureRow() {
  return (
    <div className="features">
      {FEATURES.map(([icon, title, body]) => (
        <div className="feature" key={title}>
          <span className="feature-icon">{icon}</span>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}

function SiteFooter(props: { onView: (v: View) => void }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>
            A receive-only temporary mail service. It never sends, replies to, or forwards email.
          </p>
        </div>
        <div className="footer-col">
          <h4>Product</h4>
          <button onClick={() => props.onView('mail')}>Temporary inbox</button>
          <button onClick={() => props.onView('api')}>API guide</button>
          <button onClick={() => props.onView('keys')}>API keys</button>
        </div>
        <div className="footer-col">
          <h4>Developers</h4>
          <a href={`${api.base}/docs`} target="_blank" rel="noreferrer">
            API reference ↗
          </a>
          <a href={`${api.base}/openapi.json`} target="_blank" rel="noreferrer">
            openapi.json ↗
          </a>
          <a href={`${api.base}/health/ready`} target="_blank" rel="noreferrer">
            Service status ↗
          </a>
        </div>
        <div className="footer-col">
          <h4>Good to know</h4>
          <span>Not end-to-end encrypted</span>
          <span>Don&apos;t use for anything sensitive</span>
          <button onClick={() => props.onView('report')}>Report abuse</button>
        </div>
      </div>
      <div className="footer-legal">© {new Date().getFullYear()} tmpmail · receive-only</div>
    </footer>
  );
}

function AuthPanel(props: {
  onAuthed: (u: User) => void;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const { onAuthed, onError } = props;
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const u =
        mode === 'signup'
          ? await api.signup(username.trim().toLowerCase(), password)
          : await api.login(username.trim().toLowerCase(), password);
      onAuthed(u);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card auth">
      <button className="close" aria-label="Close" onClick={props.onClose}>
        ×
      </button>
      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Log in
        </button>
        <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
          Sign up
        </button>
      </div>
      <p className="muted">
        An account keeps your addresses permanently and unlocks the unified inbox, domains, and API
        keys.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Username
          <input
            value={username}
            autoComplete="username"
            placeholder="3–32 chars: a–z, 0–9, . _ -"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="at least 8 characters"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          className="primary block"
          type="submit"
          disabled={busy || !username || password.length < 8}
        >
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

function DomainPicker(props: {
  onCreate: (domain: string, localPart: string) => Promise<void>;
  onError: (m: string) => void;
  busy: boolean;
}) {
  const { onError } = props;
  const domains = useDomains(onError);
  const [domain, setDomain] = useState('');
  const [localPart, setLocalPart] = useState('');

  const selected = domains.find((d) => d.name === domain) ?? domains[0];
  const activeDomain = selected?.name ?? '';
  if (domains.length === 0) return <p className="muted">No domains are available to you.</p>;

  return (
    <div className="field-grid">
      <label>
        Domain
        <select value={activeDomain} onChange={(e) => setDomain(e.target.value)}>
          {domains.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Exact name (optional)
        <input
          value={localPart}
          placeholder="random"
          disabled={!selected?.allow_custom_local_parts}
          onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
        />
      </label>
      <button
        className="primary"
        disabled={props.busy || !activeDomain}
        onClick={() => props.onCreate(activeDomain, localPart.trim())}
      >
        {props.busy ? 'Creating…' : 'Create address'}
      </button>
    </div>
  );
}

function InboxView(props: {
  inbox: StoredInbox;
  onReset: () => void;
  onError: (m: string) => void;
}) {
  const { inbox, onReset, onError } = props;
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const countdown = useCountdown(inbox.expires_at);
  const expired = countdown === '0:00';
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMessages(await api.listMessages(inbox.id, inbox.token));
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 404) onReset();
      else onError(err.message);
    }
  }, [inbox.id, inbox.token, onReset, onError]);

  useEffect(() => {
    void refresh();
    // Safety poll (20s) as a fallback to the live SSE stream.
    timer.current = window.setInterval(refresh, 20000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [refresh]);

  useLiveUpdates(api.inboxEventsUrl(inbox.id, inbox.token), false, refresh, onReset);

  return (
    <section className="inbox" id="inbox">
      <div className="inbox-bar">
        <div className="inbox-bar-main">
          <span className="label">Receiving at</span>
          <code className="address">{inbox.address}</code>
        </div>
        <span className={expired ? 'chip expired' : 'chip'}>
          {expired ? 'Expired' : `Expires in ${countdown}`}
        </span>
        <span className="chip live">
          <i /> live
        </span>
        <div className="spacer" />
        <button onClick={refresh}>Refresh</button>
        <button className="primary" onClick={onReset}>
          New address
        </button>
      </div>
      <MessagePane
        messages={messages.map((m) => ({ ...m, recipient_address: inbox.address }))}
        openId={openId}
        onOpen={setOpenId}
        token={inbox.token}
        onChanged={refresh}
        onError={onError}
        showAddress={false}
      />
    </section>
  );
}

function Unibox(props: { onError: (m: string) => void }) {
  const { onError } = props;
  const [messages, setMessages] = useState<UniboxMessage[]>([]);
  const [inboxes, setInboxes] = useState<OwnedInbox[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [copied, copy] = useCopy();
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([api.uniboxMessages(), api.myInboxes()]);
      setMessages(m);
      setInboxes(i);
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    // Safety poll (20s) as a fallback to the live SSE stream.
    timer.current = window.setInterval(refresh, 20000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [refresh]);

  useLiveUpdates(api.meEventsUrl, true, refresh);

  async function create(domain: string, localPart: string) {
    setBusy(true);
    try {
      const created = await api.createInbox(domain, localPart || undefined);
      setLastCreated(created.address);
      setShowCreate(false);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inbox" id="inbox">
      <div className="inbox-bar">
        <div className="inbox-bar-main">
          <span className="label">Addresses</span>
          <strong>{inboxes.length}</strong>
        </div>
        <span className="chip live">
          <i /> live
        </span>
        <div className="spacer" />
        <button onClick={refresh}>Refresh</button>
        <button className="primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Close' : 'New address'}
        </button>
      </div>

      {lastCreated && (
        <div className="notice">
          <span>
            New address: <code>{lastCreated}</code>
          </span>
          <button onClick={() => copy(lastCreated)}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      )}
      {showCreate && (
        <div className="card">
          <DomainPicker onCreate={create} onError={onError} busy={busy} />
        </div>
      )}

      <MessagePane
        messages={messages}
        openId={openId}
        onOpen={setOpenId}
        onChanged={refresh}
        onError={onError}
        showAddress
      />
    </section>
  );
}

interface PaneMessage extends MessageSummary {
  recipient_address: string;
}

function MessagePane(props: {
  messages: PaneMessage[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  token?: string;
  onChanged: () => void;
  onError: (m: string) => void;
  showAddress: boolean;
}) {
  return (
    <div className="split">
      <ul className="message-list">
        {props.messages.length === 0 && (
          <li className="empty">
            <span className="empty-art">📨</span>
            <strong>Waiting for email…</strong>
            <span className="muted">New mail appears here the moment it arrives.</span>
          </li>
        )}
        {props.messages.map((m) => (
          <li
            key={m.id}
            className={m.id === props.openId ? 'active' : ''}
            onClick={() => props.onOpen(m.id)}
          >
            <div className="row">
              <span className="from">{m.sender_name || m.sender_address}</span>
              {m.has_attachments && <span className="badge">📎</span>}
              {m.status !== 'ready' && <span className="badge pending">{m.status}</span>}
            </div>
            <div className="subject">{m.subject || '(no subject)'}</div>
            {props.showAddress && <div className="to-addr">to {m.recipient_address}</div>}
            <div className="snippet">{m.snippet}</div>
          </li>
        ))}
      </ul>
      <div className="reader">
        {props.openId ? (
          <MessageReader
            key={props.openId}
            messageId={props.openId}
            token={props.token}
            onDeleted={() => {
              props.onOpen(null);
              props.onChanged();
            }}
            onError={props.onError}
          />
        ) : (
          <div className="placeholder">Select a message to read it.</div>
        )}
      </div>
    </div>
  );
}

function MessageReader(props: {
  messageId: string;
  token?: string;
  onDeleted: () => void;
  onError: (m: string) => void;
}) {
  const { messageId, token, onError } = props;
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    api
      .getMessage(messageId, token)
      .then(setMsg)
      .catch((e: Error) => onError(e.message));
  }, [messageId, token, onError]);

  if (!msg) return <div className="placeholder">Loading…</div>;
  if (msg.status === 'failed') {
    return <div className="placeholder">This message could not be processed safely.</div>;
  }
  if (msg.status !== 'ready') {
    return <div className="placeholder">Still processing this message…</div>;
  }

  return (
    <div className="reader-inner">
      <div className="reader-head">
        <h3>{msg.subject || '(no subject)'}</h3>
        <div className="reader-meta">
          <span>
            From{' '}
            <strong>
              {msg.sender_name ? `${msg.sender_name} <${msg.sender_address}>` : msg.sender_address}
            </strong>
          </span>
          <button
            className="danger"
            onClick={async () => {
              await api.deleteMessage(msg.id, token).catch(() => undefined);
              props.onDeleted();
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {msg.html_body_sanitized ? (
        <MessageHtml
          html={msg.html_body_sanitized}
          showImages={showImages}
          onShowImages={() => setShowImages(true)}
        />
      ) : (
        <pre className="reader-text">{msg.text_body || '(empty message)'}</pre>
      )}

      {msg.attachments.length > 0 && (
        <div className="attachments">
          <h4>Attachments</h4>
          <ul>
            {msg.attachments.map((a) => (
              <li key={a.id}>
                <span className="filename">{a.filename}</span>
                <span className="size">{Math.max(1, Math.round(a.size_bytes / 1024))} KB</span>
                {a.blocked ? (
                  <span className="badge pending">blocked</span>
                ) : (
                  <button
                    onClick={() =>
                      downloadAttachment(msg.id, a, token).catch((e: Error) => onError(e.message))
                    }
                  >
                    Download
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MessageHtml(props: { html: string; showImages: boolean; onShowImages: () => void }) {
  const html = props.showImages ? props.html.replace(/data-tm-blocked-src=/g, 'src=') : props.html;
  const hasBlocked = props.html.includes('data-tm-blocked-src=');
  return (
    <div className="reader-html">
      {hasBlocked && !props.showImages && (
        <div className="notice">
          <span>Remote images are blocked to protect your privacy.</span>
          <button onClick={props.onShowImages}>Load images</button>
        </div>
      )}
      <iframe
        title="message"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:12px;color:#111;overflow-wrap:anywhere}img{max-width:100%}</style>${html}`}
      />
    </div>
  );
}
