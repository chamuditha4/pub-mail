import { useCallback, useEffect, useState } from 'react';
import { api, type ApiKeyMetadata } from './api.js';

const SCOPES = [
  'inboxes:write',
  'inboxes:read',
  'messages:read',
  'messages:delete',
  'domains:read',
  'private_domains:read',
  'usage:read',
];

export function ApiKeys(props: { onError: (m: string) => void }) {
  const { onError } = props;
  const [keys, setKeys] = useState<ApiKeyMetadata[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(['inboxes:write', 'messages:read']),
  );
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setKeys(await api.listApiKeys());
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggle(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function create() {
    setBusy(true);
    try {
      const key = await api.createApiKey(name.trim(), [...selected]);
      setCreated(key.key);
      setName('');
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeApiKey(id);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className="admin">
      <div className="card">
        <h3>Create an API key</h3>
        {created && (
          <div className="notice key-once">
            <div>
              <strong>Copy this key now — it won’t be shown again:</strong>
              <br />
              <code>{created}</code>
            </div>
            <button onClick={() => navigator.clipboard.writeText(created)}>Copy</button>
          </div>
        )}
        <label>
          Name
          <input
            value={name}
            placeholder="e.g. my script"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="scopes">
          {SCOPES.map((s) => (
            <label key={s} className="checkbox">
              <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} />
              <code>{s}</code>
            </label>
          ))}
        </div>
        <button
          className="primary"
          disabled={busy || !name.trim() || selected.size === 0}
          onClick={create}
        >
          {busy ? 'Creating…' : 'Create key'}
        </button>
      </div>

      <div className="card">
        <h3>Your API keys</h3>
        {keys.length === 0 ? (
          <p className="muted">No keys yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="domains-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>
                      <code>tm_live_{k.key_prefix}…</code>
                    </td>
                    <td className="scopes-cell">{k.scopes.join(', ')}</td>
                    <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
                    <td>
                      <button onClick={() => revoke(k.id)}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted">
        Use a key as <code>Authorization: Bearer tm_live_…</code>. See the API guide for examples.
      </p>
    </div>
  );
}
