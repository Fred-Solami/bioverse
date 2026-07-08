import { useOnline } from '../hooks/useOnline';

export function Dashboard() {
  const online = useOnline();
  return (
    <section>
      <h1>Referrals</h1>
      <p className="muted" data-testid="dashboard-ready">
        The facility client is ready. Referral creation, the inbound queue and
        sync land in the next slices.
      </p>
      <p className="muted">
        {online
          ? 'Connected — changes will sync as you make them.'
          : 'Working offline — changes are saved on this device and will sync when you reconnect.'}
      </p>
    </section>
  );
}
