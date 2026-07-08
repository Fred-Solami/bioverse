import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './store/auth';

// Route guard. While the session hydrates we show a splash rather than flashing
// the login screen; an unauthenticated user is redirected to /login.
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'loading') {
    return <div className="splash">Loading…</div>;
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
