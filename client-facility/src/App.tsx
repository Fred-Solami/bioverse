import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './Layout';
import { Dashboard } from './pages/Dashboard';
import { NewReferral } from './pages/NewReferral';
import { Login } from './pages/Login';
import { RequireAuth } from './RequireAuth';
import { useAuth } from './store/auth';

// Route table. On mount we hydrate the session from IndexedDB (and refresh the
// token if online). Referral creation, inbound queue and sync arrive in later
// slices (docs/PWA-PLAN.md).
export function App() {
  const hydrate = useAuth((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/referrals/new"
          element={
            <RequireAuth>
              <NewReferral />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
