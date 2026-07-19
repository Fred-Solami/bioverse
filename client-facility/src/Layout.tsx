import { Outlet, Link } from 'react-router-dom';
import { useOnline } from './hooks/useOnline';
import { UpdatePrompt } from './components/UpdatePrompt';

// App shell: header + connectivity badge, rendered around every route. The
// badge is the user's constant signal of whether work is queuing locally or
// syncing; the single most important affordance in an offline-first field app.
export function Layout() {
  const online = useOnline();
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          BioVerse <span className="brand-sub">Facility</span>
        </Link>
        <span
          className={`net ${online ? 'net-online' : 'net-offline'}`}
          data-testid="net-status"
          role="status"
        >
          {online ? 'Online' : 'Offline'}
        </span>
      </header>
      <UpdatePrompt />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
