import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useOnline } from '../hooks/useOnline';
import { listReferrals, type ServerReferral } from '../api/client';

// Referrals still in flight to a receiving facility: the ones a receiving
// clinician needs to act on (acknowledge arrival, mark treated, return
// feedback). Closed and cancelled referrals drop off.
const ACTIVE = ['MATCHED', 'DISPATCHED', 'IN_TRANSIT', 'RECEIVED', 'TREATED'];

export function Inbound() {
  const online = useOnline();
  const navigate = useNavigate();
  const facilityId = useAuth((s) => s.user?.facilityId);
  const [rows, setRows] = useState<ServerReferral[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) {
      setRows([]);
      return;
    }
    listReferrals()
      .then((all) =>
        setRows(all.filter((r) => r.to_facility_id === facilityId && ACTIVE.includes(r.current_status))),
      )
      .catch(() => setError('Could not load inbound referrals.'));
  }, [online, facilityId]);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Inbound</h1>
          <p className="muted">Referrals arriving at this facility</p>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          Back
        </button>
      </div>

      {!online ? (
        <p className="offline-banner">Reconnect to see referrals arriving at this facility.</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : rows === null ? null : rows.length === 0 ? (
        <div className="card empty-state" data-testid="inbound-empty">
          <p className="empty-title">Nothing inbound</p>
          <p className="muted">No referrals are on their way here right now.</p>
        </div>
      ) : (
        <ul className="ref-list" data-testid="inbound-list">
          {rows.map((r) => (
            <li key={r.id} className="card ref-row">
              <Link to={`/referrals/${r.id}`} className="ref-main" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className={`pri pri-${r.priority.toLowerCase()}`}>{r.priority}</span>
                <div>
                  <div className="ref-patient">{r.reference}</div>
                  <div className="muted ref-reason">from {r.from_facility_name}</div>
                </div>
              </Link>
              <span className="status">{r.current_status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
