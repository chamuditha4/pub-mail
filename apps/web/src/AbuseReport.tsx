import { useState } from 'react';
import { api } from './api.js';

export function AbuseReport(props: { onError: (m: string) => void }) {
  const [subjectType, setSubjectType] = useState('address');
  const [subjectValue, setSubjectValue] = useState('');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.submitAbuseReport({
        subject_type: subjectType,
        subject_value: subjectValue.trim() || undefined,
        details: details.trim(),
        reporter_email: email.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <h3>Report received</h3>
        <p className="muted">Thanks — our team will review it. You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Report abuse</h3>
      <p className="muted">
        Tell us about spam, phishing, or misuse of an address or domain. This platform is
        receive-only and never sends mail.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field-grid">
          <label>
            About
            <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
              <option value="address">an address</option>
              <option value="domain">a domain</option>
              <option value="message">a message</option>
              <option value="other">something else</option>
            </select>
          </label>
          <label>
            Which one (optional)
            <input
              value={subjectValue}
              placeholder="e.g. spammer@example.com"
              onChange={(e) => setSubjectValue(e.target.value)}
            />
          </label>
          <label>
            Your email (optional)
            <input
              value={email}
              placeholder="for follow-up"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        <label>
          Details
          <textarea
            value={details}
            rows={5}
            placeholder="What happened?"
            onChange={(e) => setDetails(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 5,
              padding: '9px 11px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              color: 'var(--text)',
              font: 'inherit',
            }}
          />
        </label>
        <button className="primary" type="submit" disabled={busy || details.trim().length < 3}>
          {busy ? 'Sending…' : 'Submit report'}
        </button>
      </form>
    </div>
  );
}
