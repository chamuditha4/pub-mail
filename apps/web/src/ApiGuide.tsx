import { api } from './api.js';

const BASE = api.base;

function Code({ children }: { children: string }) {
  return (
    <pre className="code-block">
      <code>{children}</code>
    </pre>
  );
}

export function ApiGuide() {
  return (
    <div className="card guide">
      <h2>API guide</h2>
      <p className="muted">
        Base URL <code>{BASE}</code>. JSON in and out, <code>snake_case</code> keys, UTC RFC 3339
        timestamps. Every response includes an <code>X-Request-Id</code>. Interactive reference:{' '}
        <a href={`${BASE}/docs`} target="_blank" rel="noreferrer">
          /docs
        </a>{' '}
        ·{' '}
        <a href={`${BASE}/openapi.json`} target="_blank" rel="noreferrer">
          openapi.json
        </a>
        .
      </p>

      <h3>Authentication</h3>
      <ul>
        <li>
          <strong>Anonymous inbox:</strong> pass the inbox <code>access_token</code> (returned once
          at creation) as <code>Authorization: Bearer tmb_…</code>.
        </li>
        <li>
          <strong>Account (unibox):</strong> a session cookie set by <code>/v1/auth/login</code>;
          browser requests send it automatically.
        </li>
      </ul>

      <h3>1 · List available domains</h3>
      <Code>{`curl ${BASE}/v1/domains`}</Code>

      <h3>2 · Create an inbox</h3>
      <Code>{`curl -X POST ${BASE}/v1/inboxes \\
  -H 'Content-Type: application/json' \\
  -d '{"domain":"example.com","local_part":"myname","expires_in":3600}'

# → { "data": { "id": "01…", "address": "myname@example.com",
#              "access_token": "tmb_…", "expires_at": "…" } }`}</Code>

      <h3>3 · Poll for messages</h3>
      <Code>{`curl ${BASE}/v1/inboxes/INBOX_ID/messages \\
  -H 'Authorization: Bearer tmb_YOUR_TOKEN'`}</Code>

      <h3>4 · Read a message</h3>
      <Code>{`curl ${BASE}/v1/messages/MESSAGE_ID \\
  -H 'Authorization: Bearer tmb_YOUR_TOKEN'

# text_body and html_body_sanitized are returned; HTML is pre-sanitized
# and remote images are neutralized.`}</Code>

      <h3>5 · Download an attachment</h3>
      <Code>{`curl -OJ ${BASE}/v1/messages/MESSAGE_ID/attachments/ATTACHMENT_ID \\
  -H 'Authorization: Bearer tmb_YOUR_TOKEN'`}</Code>

      <h3>6 · Delete</h3>
      <Code>{`curl -X DELETE ${BASE}/v1/messages/MESSAGE_ID -H 'Authorization: Bearer tmb_YOUR_TOKEN'
curl -X DELETE ${BASE}/v1/inboxes/INBOX_ID   -H 'Authorization: Bearer tmb_YOUR_TOKEN'`}</Code>

      <h3>Account &amp; unified inbox</h3>
      <Code>{`# after signing in (cookie session):
curl ${BASE}/v1/me            --cookie 'tm_session=…'   # current user
curl ${BASE}/v1/me/inboxes    --cookie 'tm_session=…'   # your addresses
curl ${BASE}/v1/me/messages   --cookie 'tm_session=…'   # unified inbox`}</Code>

      <p className="muted">
        This platform is receive-only — it never sends, replies to, or forwards email.
      </p>
    </div>
  );
}
