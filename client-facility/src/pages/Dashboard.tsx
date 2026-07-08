import { useAuth } from '../store/auth';
import { useOnline } from '../hooks/useOnline';

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
  const online = useOnline();

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Referrals</h1>
          <p className="muted">
            Signed in as <strong>{user?.username ?? user?.sub}</strong>
            {user?.role ? ` · ${ROLE_LABELS[user.role] ?? user.role}` : ''}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => void logout()} data-testid="logout">
          Sign out
        </button>
      </div>

      <div className="card empty-state" data-testid="dashboard-ready">
        <p className="empty-title">No referrals yet</p>
        <p className="muted">
          {online
            ? 'Creating a referral arrives in the next slice. Changes will sync as you make them.'
            : 'Working offline — anything you create is saved on this device and syncs when you reconnect.'}
        </p>
      </div>
    </section>
  );
}
