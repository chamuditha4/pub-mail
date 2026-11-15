import { useCallback, useEffect, useState } from 'react';
import { api, type AbuseReport, type BlocklistEntry, type PlatformMetrics } from './api.js';

const METRIC_LABELS: Array<[keyof PlatformMetrics, string]> = [
  ['users', 'Users'],
  ['active_domains', 'Active domains'],
  ['active_inboxes', 'Active inboxes'],
  ['messages_total', 'Messages'],
  ['messages_ready', 'Ready'],
  ['messages_failed', 'Failed'],
  ['active_api_keys', 'API keys'],
  ['blocklist_entries', 'Blocklist'],
  ['open_abuse_reports', 'Open reports'],
];

export function AdminConsole(props: { onError: (m: string) => void }) {
  const { onError } = props;
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [blocks, setBlocks] = useState<BlocklistEntry[]>([]);
  const [reports, setReports] = useState<AbuseReport[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [m, b, r] = await Promise.all([
        api.adminMetrics(),
        api.adminBlocklist(),
        api.adminAbuseReports('open'),
      ]);
      setMetrics(m);
      setBlocks(b);
      setReports(r);
    } catch (e) {
      onError((e as Error).message);
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

  return (
    <div className="admin">
      <div className="metric-grid">
        {METRIC_LABELS.map(([key, label]) => (
          <div className="metric" key={key}>
            <span className="metric-value">{metrics ? metrics[key] : '—'}</span>
            <span className="metric-label">{label}</span>
          </div>
        ))}
      </div>

      <BlocklistCard blocks={blocks} onError={onError} onChanged={refresh} act={act} />

      <div className="card">
        <h3>Open abuse reports</h3>
        {reports.length === 0 ? (
          <p className="muted">No open reports.</p>
        ) : (
          <div className="table-scroll">
            <table className="domains-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Details</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.subject_type}
                      {r.subject_value ? (
                        <>
                          : <code>{r.subject_value}</code>
                        </>
                      ) : null}
                    </td>
                    <td className="scopes-cell">{r.details}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td className="row-actions">
                      <button onClick={() => act(() => api.adminSetReportStatus(r.id, 'reviewed'))}>
                        Reviewed
                      </button>
                      <button onClick={() => act(() => api.adminSetReportStatus(r.id, 'closed'))}>
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BlocklistCard(props: {
  blocks: BlocklistEntry[];
  onError: (m: string) => void;
  onChanged: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [type, setType] = useState('sender');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  async function add() {
    if (!value.trim()) return;
    await props.act(async () => {
      await api.adminAddBlock({
        entry_type: type,
        value: value.trim(),
        reason: reason.trim() || undefined,
      });
      setValue('');
      setReason('');
    });
  }

  return (
    <div className="card">
      <h3>Abuse blocklist</h3>
      <div className="field-grid">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="sender">sender</option>
            <option value="recipient">recipient</option>
            <option value="domain">domain</option>
            <option value="ip">ip</option>
          </select>
        </label>
        <label>
          Value
          <input
            value={value}
            placeholder="spammer@example.com"
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label>
          Reason (optional)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="primary" disabled={!value.trim()} onClick={add}>
          Block
        </button>
      </div>
      {props.blocks.length === 0 ? (
        <p className="muted">Nothing blocked.</p>
      ) : (
        <div className="table-scroll">
          <table className="domains-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Value</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {props.blocks.map((b) => (
                <tr key={b.id}>
                  <td>{b.entry_type}</td>
                  <td>
                    <code>{b.value}</code>
                  </td>
                  <td className="scopes-cell">{b.reason ?? '—'}</td>
                  <td>
                    <button onClick={() => props.act(() => api.adminRemoveBlock(b.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
