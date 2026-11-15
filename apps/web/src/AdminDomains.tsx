import { useCallback, useEffect, useState } from 'react';
import { api, type AdminDomain } from './api.js';

const INGEST_WORKER = 'tmp-mail-ingest';

export function AdminDomains(props: { onError: (m: string) => void }) {
  const { onError } = props;
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [automation, setAutomation] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.manageDomains();
      setDomains(res.data);
      setAutomation(res.routing_automation);
      setIsAdmin(res.is_admin);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  // Deleting a domain destroys every inbox and message on it, including other
  // users'. Ask for the name to be typed out before calling the API.
  async function remove(d: AdminDomain) {
    const typed = window.prompt(
      `Permanently delete ${d.name}? Every inbox and message on this domain is erased and cannot be recovered.\n\nType the domain name to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== d.name) {
      onError('The name you typed does not match. Nothing was deleted.');
      return;
    }
    await act(() => api.deleteManagedDomain(d.id, d.name));
  }

  return (
    <div className="admin">
      <AddDomainForm onError={onError} onAdded={refresh} />

      <div className="card">
        <h3>Domains</h3>
        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : domains.length === 0 ? (
          <p className="muted">No domains yet. Add one above.</p>
        ) : (
          <div className="table-scroll">
            <table className="domains-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Pool</th>
                  <th>Anon</th>
                  <th>Catch-all</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <code>{d.name}</code>
                    </td>
                    <td>
                      <span className={`status status-${d.status}`}>{d.status}</span>
                    </td>
                    <td>{d.pool_type}</td>
                    <td>{d.allow_anonymous_inboxes ? 'yes' : 'no'}</td>
                    <td>{d.catch_all ? 'on' : 'off'}</td>
                    <td className="row-actions">
                      <button
                        onClick={() =>
                          act(() => api.updateManagedDomain(d.id, { catch_all: !d.catch_all }))
                        }
                        title="Deliver mail for unclaimed addresses to your unibox"
                      >
                        {d.catch_all ? 'Disable catch-all' : 'Enable catch-all'}
                      </button>
                      {isAdmin && d.status !== 'active' && (
                        <button
                          onClick={() =>
                            act(() => api.updateManagedDomain(d.id, { status: 'active' }))
                          }
                        >
                          Activate
                        </button>
                      )}
                      {d.pool_type === 'private' ? (
                        <button
                          onClick={() =>
                            act(() =>
                              api.updateManagedDomain(d.id, {
                                pool_type: 'public',
                                allow_anonymous_inboxes: true,
                              }),
                            )
                          }
                        >
                          Publish
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            act(() =>
                              api.updateManagedDomain(d.id, {
                                pool_type: 'private',
                                allow_anonymous_inboxes: false,
                              }),
                            )
                          }
                        >
                          Make private
                        </button>
                      )}
                      {automation && d.zone_id && (
                        <>
                          <button onClick={() => act(() => api.enableDomainRouting(d.id))}>
                            Enable routing
                          </button>
                          <button onClick={() => act(() => api.verifyDomain(d.id))}>Verify</button>
                        </>
                      )}
                      <button
                        className="danger"
                        onClick={() => remove(d)}
                        title="Permanently delete this domain and all mail on it"
                      >
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

      <ActivationGuide automation={automation} />
    </div>
  );
}

function AddDomainForm(props: { onError: (m: string) => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [pool, setPool] = useState<'public' | 'private'>('private');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.createManagedDomain({
        name: name.trim().toLowerCase(),
        zone_id: zoneId.trim() || undefined,
        pool_type: pool,
        allow_anonymous_inboxes: anon,
      });
      setName('');
      setZoneId('');
      props.onAdded();
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Add a domain</h3>
      <div className="field-grid">
        <label>
          Domain name
          <input value={name} placeholder="example.com" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Cloudflare zone ID (optional)
          <input
            value={zoneId}
            placeholder="for routing automation"
            onChange={(e) => setZoneId(e.target.value)}
          />
        </label>
        <label>
          Pool
          <select value={pool} onChange={(e) => setPool(e.target.value as 'public' | 'private')}>
            <option value="private">private</option>
            <option value="public">public</option>
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
          Allow anonymous inboxes
        </label>
      </div>
      <button className="primary" disabled={busy || !name.trim()} onClick={submit}>
        {busy ? 'Adding…' : 'Add domain'}
      </button>
    </div>
  );
}

function ActivationGuide(props: { automation: boolean }) {
  return (
    <div className="card guide">
      <h3>How to activate a domain</h3>
      <ol>
        <li>
          Add the domain to <strong>Cloudflare</strong> (same account as this platform) and make
          sure its nameservers are active.
        </li>
        <li>
          Enable <strong>Email Routing</strong> for the zone (Cloudflare dashboard → the domain →
          Email → Email Routing → Get started). This adds the required MX and SPF records.
        </li>
        <li>
          Set the <strong>catch-all</strong> action to <strong>Send to a Worker</strong> and choose{' '}
          <code>{INGEST_WORKER}</code>.
        </li>
        <li>
          Register the domain here (form above). Paste its <strong>Zone ID</strong> if you want the
          one-click automation below.
        </li>
        <li>
          Once routing shows <em>ready</em>, click <strong>Activate</strong> (and{' '}
          <strong>Publish</strong> to make it selectable by everyone), then send a test email.
        </li>
      </ol>
      {props.automation ? (
        <p className="muted">
          Routing automation is enabled: with a Zone ID set, use <strong>Enable routing</strong> and{' '}
          <strong>Verify</strong> to configure Email Routing and the catch-all for you.
        </p>
      ) : (
        <p className="muted">
          Routing automation is off (no Cloudflare API token configured). Follow the manual steps
          above, then click <strong>Activate</strong>.
        </p>
      )}
      <p className="muted">
        <strong>Catch-all:</strong> when enabled, mail sent to any address on your domain that
        nobody has created an inbox for is delivered to <em>your</em> unibox (with the real
        recipient shown). Mail to inboxes other users created still goes to them, never to you.
      </p>
    </div>
  );
}
