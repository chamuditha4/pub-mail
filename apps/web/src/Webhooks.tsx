import { useCallback, useEffect, useState } from 'react';
import { api, type WebhookMetadata } from './api.js';

const EVENTS = [
  'message.ready',
  'message.received',
  'message.failed',
  'message.deleted',
  'inbox.expiring',
  'inbox.expired',
];

export function Webhooks(props: { onError: (m: string) => void }) {
  const { onError } = props;
  const [hooks, setHooks] = useState<WebhookMetadata[]>([]);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(['message.ready']));
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setHooks(await api.listWebhooks());
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggle(ev: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const created = await api.createWebhook(url.trim(), [...selected]);
      setSecret(created.secret);
      setUrl('');
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rotate(id: string) {
    try {
      const res = await api.rotateWebhookSecret(id);
      setSecret(res.secret);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className="admin">
      <div className="card">
        <h3>Create a webhook</h3>
        {secret && (
          <div className="notice key-once">
            <div>
              <strong>Signing secret (shown once):</strong> <code>{secret}</code>
            </div>
            <button onClick={() => navigator.clipboard.writeText(secret)}>Copy</button>
          </div>
        )}
        <label>
          Endpoint URL (https)
          <input
            value={url}
            placeholder="https://your-app.example/webhooks/tmpmail"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="scopes">
          {EVENTS.map((ev) => (
            <label key={ev} className="checkbox">
              <input type="checkbox" checked={selected.has(ev)} onChange={() => toggle(ev)} />
              <code>{ev}</code>
            </label>
          ))}
        </div>
        <button
          className="primary"
          disabled={busy || !url.trim() || selected.size === 0}
          onClick={create}
        >
          {busy ? 'Creating…' : 'Create webhook'}
        </button>
      </div>

      <div className="card">
        <h3>Your webhooks</h3>
        {hooks.length === 0 ? (
          <p className="muted">No webhooks yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="domains-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Events</th>
                  <th>Status</th>
                  <th>Fails</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {hooks.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <code>{w.url}</code>
                    </td>
                    <td className="scopes-cell">{w.events.join(', ')}</td>
                    <td>
                      <span
                        className={`status status-${w.status === 'active' ? 'active' : 'paused'}`}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td>{w.failure_count}</td>
                    <td className="row-actions">
                      <button onClick={() => act(() => api.testWebhook(w.id))}>Test</button>
                      <button onClick={() => rotate(w.id)}>Rotate secret</button>
                      <button
                        onClick={() =>
                          act(() =>
                            api.updateWebhook(w.id, {
                              status: w.status === 'active' ? 'disabled' : 'active',
                            }),
                          )
                        }
                      >
                        {w.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button className="danger" onClick={() => act(() => api.deleteWebhook(w.id))}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted">
        Each delivery is signed:{' '}
        <code>Webhook-Signature: v1=HMAC_SHA256(secret, timestamp.event_id.body)</code>. Verify the
        signature and dedupe on <code>Webhook-Id</code>.
      </p>
    </div>
  );
}
