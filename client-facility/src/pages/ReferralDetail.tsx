import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { getReferralDetail, type ReferralDetail as Detail } from '../api/client';
import { queueTransition } from '../data/referrals';
import { syncNow } from '../data/sync';

// The action the current user can take next, given the referral's status and
// which side of it they are on. Receiving facility acknowledges arrival, treats
// and returns feedback; the referrer closes the loop.
function nextAction(
  status: string,
  isReferrer: boolean,
  isReceiver: boolean,
  oversight: boolean,
): { to: string; label: string; feedback?: boolean } | null {
  const receiver = isReceiver || oversight;
  const referrer = isReferrer || oversight;
  if (status === 'DISPATCHED' && referrer) return { to: 'IN_TRANSIT', label: 'Mark en route' };
  if (status === 'IN_TRANSIT' && receiver) return { to: 'RECEIVED', label: 'Mark arrived' };
  if (status === 'RECEIVED' && receiver) return { to: 'TREATED', label: 'Mark treated' };
  if (status === 'TREATED' && receiver) return { to: 'FEEDBACK_RETURNED', label: 'Return feedback', feedback: true };
  if (status === 'FEEDBACK_RETURNED' && referrer) return { to: 'CLOSED', label: 'Close referral' };
  return null;
}

export function ReferralDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(await getReferralDetail(id));
    } catch {
      setError('Could not load this referral.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(to: string, feedback: boolean) {
    setBusy(true);
    setError(null);
    try {
      await queueTransition(id, to, feedback ? { note: outcome, payload: { outcome } } : {});
      await syncNow(); // push it straight through while we are online
      setOutcome('');
      await load();
    } catch {
      setError('Could not record that. It is saved and will sync when possible.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) return <section><p className="form-error">{error}</p></section>;
  if (!detail) return <section><p className="muted">Loading…</p></section>;

  const r = detail.referral;
  const action = nextAction(
    r.current_status,
    user?.facilityId === r.from_facility_id,
    user?.facilityId === r.to_facility_id,
    user?.role === 'DISTRICT_OFFICER' || user?.role === 'MOH_ADMIN',
  );

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{r.reference}</h1>
          <p className="muted">{r.from_facility_name} to {r.to_facility_name ?? 'destination'}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>Back</button>
      </div>

      <div className="card detail-summary">
        <span className={`pri pri-${r.priority.toLowerCase()}`}>{r.priority}</span>
        <span className="status detail-status">{r.current_status.replace('_', ' ')}</span>
        <p className="detail-reason">{r.reason}</p>
      </div>

      {error && <p className="form-error">{error}</p>}

      {action && (
        <div className="card action-card" data-testid="action-card">
          {action.feedback && (
            <label className="field">
              <span className="field-label">Outcome to send back to {r.from_facility_name}</span>
              <textarea
                className="input"
                rows={3}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="e.g. Delivered by C-section, mother and baby stable"
                data-testid="feedback-outcome"
              />
            </label>
          )}
          <button
            className="btn btn-primary"
            disabled={busy || (action.feedback && outcome.trim().length < 3)}
            onClick={() => void act(action.to, !!action.feedback)}
            data-testid="action-btn"
          >
            {busy ? 'Saving…' : action.label}
          </button>
        </div>
      )}

      <h2 className="timeline-head">Timeline</h2>
      <ol className="timeline" data-testid="timeline">
        {detail.events.map((e, i) => (
          <li key={i} className="tl-item">
            <span className="tl-dot" />
            <div>
              <div className="tl-status">{e.to_status.replace('_', ' ')}</div>
              {e.note && <div className="muted tl-note">{e.note}</div>}
              <div className="muted tl-time">{new Date(e.occurred_at).toLocaleString()}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
