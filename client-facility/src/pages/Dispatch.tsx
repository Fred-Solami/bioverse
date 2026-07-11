import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnline } from '../hooks/useOnline';
import {
  listReferrals,
  getTransportOptions,
  assignTransport,
  type ServerReferral,
  type TransportOption,
} from '../api/client';

function km(distance: number | null): string {
  if (distance == null) return 'distance unknown';
  return `${(distance / 1000).toFixed(1)} km away`;
}

// Online coordinator surface: referrals that are MATCHED (destination chosen)
// but still need a vehicle. This is the m-mama dispatch-centre pattern; the
// offline field client gets its own transport view once sync lands (Slice 4).
export function Dispatch() {
  const online = useOnline();
  const navigate = useNavigate();
  const [referrals, setReferrals] = useState<ServerReferral[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setReferrals(await listReferrals('MATCHED'));
    } catch {
      setError('Could not load referrals awaiting transport.');
      setReferrals([]);
    }
  }

  useEffect(() => {
    if (online) void load();
    else setReferrals([]);
  }, [online]);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dispatch</h1>
          <p className="muted">Referrals awaiting transport</p>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          Back
        </button>
      </div>

      {!online ? (
        <p className="offline-banner">Dispatch needs a connection. Reconnect to coordinate transport.</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : referrals === null ? null : referrals.length === 0 ? (
        <div className="card empty-state" data-testid="dispatch-empty">
          <p className="empty-title">Nothing waiting</p>
          <p className="muted">No matched referrals need transport right now.</p>
        </div>
      ) : (
        <ul className="ref-list" data-testid="dispatch-list">
          {referrals.map((r) => (
            <li key={r.id} className="card">
              <div className="ref-row" style={{ padding: 0 }}>
                <div className="ref-main">
                  <span className={`pri pri-${r.priority.toLowerCase()}`}>{r.priority}</span>
                  <div>
                    <div className="ref-patient">{r.reference}</div>
                    <div className="muted ref-reason">
                      {r.from_facility_name} to {r.to_facility_name ?? 'destination'}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  data-testid="coordinate"
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                >
                  {openId === r.id ? 'Close' : 'Coordinate'}
                </button>
              </div>
              {openId === r.id && <TransportOptions referralId={r.id} onDone={load} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TransportOptions({ referralId, onDone }: { referralId: string; onDone: () => void }) {
  const [options, setOptions] = useState<TransportOption[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTransportOptions(referralId)
      .then(setOptions)
      .catch(() => setError('Could not load nearby vehicles.'));
  }, [referralId]);

  async function dispatch(resourceId: string, eta: number) {
    setBusyId(resourceId);
    setError(null);
    try {
      await assignTransport(referralId, { resource_id: resourceId, eta_minutes: eta });
      onDone(); // referral moves to DISPATCHED and drops off the list
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed.');
      setBusyId(null);
    }
  }

  if (error) return <p className="form-error" style={{ marginTop: '0.75rem' }}>{error}</p>;
  if (!options) return <p className="muted" style={{ marginTop: '0.75rem' }}>Finding vehicles…</p>;
  if (options.length === 0)
    return <p className="muted" style={{ marginTop: '0.75rem' }}>No available vehicles nearby.</p>;

  return (
    <ul className="picker-results" style={{ marginTop: '0.75rem' }} data-testid="vehicle-options">
      {options.map((o) => {
        const eta = o.distance_m != null ? Math.max(10, Math.round(o.distance_m / 1000 / 0.5)) : 30;
        return (
          <li key={o.id}>
            <div className="vehicle-row">
              <div>
                <strong>{o.name}</strong>
                {o.recommended && <span className="badge badge-pending" style={{ marginLeft: '0.5rem' }}>Nearest</span>}
                <div className="muted" style={{ fontSize: '0.82rem' }}>
                  {o.vehicle_type.replace('_', ' ').toLowerCase()} · {km(o.distance_m)}
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ width: 'auto' }}
                disabled={busyId != null}
                data-testid="dispatch-vehicle"
                onClick={() => void dispatch(o.id, eta)}
              >
                {busyId === o.id ? 'Dispatching…' : 'Dispatch'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
