import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useSync } from '../hooks/useSync';
import { listLocalReferrals, type LocalReferral } from '../data/referrals';

const ROLE_LABELS: Record<string, string> = {
  CHW: 'Community health worker',
  FACILITY_STAFF: 'Facility staff',
  FACILITY_INCHARGE: 'Facility in-charge',
  DISTRICT_OFFICER: 'District officer',
  MOH_ADMIN: 'MOH administrator',
};

export function Dashboard() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [referrals, setReferrals] = useState<LocalReferral[] | null>(null);
  const { syncing, pending, version, lastError, trigger } = useSync(!!user);

  // Re-read the local projection after every completed sync.
  useEffect(() => {
    void listLocalReferrals().then(setReferrals);
  }, [version]);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Referrals</h1>
          <p className="muted">
            {user?.username ?? user?.sub}
            {user?.role ? ` · ${ROLE_LABELS[user.role] ?? user.role}` : ''}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => void logout()} data-testid="logout">
          Sign out
        </button>
      </div>

      <div className="dash-actions">
        <Link to="/referrals/new" className="btn btn-primary" data-testid="new-referral">
          + New referral
        </Link>
        <Link to="/dispatch" className="btn btn-ghost" data-testid="dispatch-link">
          Dispatch
        </Link>
        <button
          className="btn btn-ghost"
          onClick={() => void trigger()}
          disabled={syncing}
          data-testid="sync-now"
        >
          {syncing ? 'Syncing…' : pending > 0 ? `Sync (${pending})` : 'Sync'}
        </button>
      </div>

      {lastError && <p className="offline-banner">{lastError}</p>}

      {referrals === null ? null : referrals.length === 0 ? (
        <div className="card empty-state" data-testid="dashboard-ready">
          <p className="empty-title">No referrals yet</p>
          <p className="muted">Create one. It's saved on this device and syncs when you're online.</p>
        </div>
      ) : (
        <ul className="ref-list" data-testid="referral-list">
          {referrals.map((r) => (
            <li key={r.id} className="card ref-row">
              <div className="ref-main">
                <span className={`pri pri-${r.priority.toLowerCase()}`}>{r.priority}</span>
                <div>
                  <div className="ref-patient">{r.patient_name}</div>
                  <div className="muted ref-reason">{r.reason || r.reference}</div>
                </div>
              </div>
              <div className="ref-meta">
                <span className="status">{r.current_status}</span>
                {r.sync === 'pending' && (
                  <span className="badge badge-pending" data-testid="pending-badge">
                    Pending sync
                  </span>
                )}
                {r.sync === 'rejected' && (
                  <span className="badge badge-rejected" data-testid="rejected-badge">
                    Needs review
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
