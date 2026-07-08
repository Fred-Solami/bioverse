import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

// Route table. Auth guarding, referral creation, inbound queue and sync arrive
// in later slices (see docs/PWA-PLAN.md); Slice 1 establishes the shell that
// loads and navigates offline.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
