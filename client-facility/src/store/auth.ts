import { create } from 'zustand';
import * as api from '../api/client';
import { getSession, setSession, clearSession } from '../db/store';
import type { SessionUser } from '../types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: SessionUser | null;
  status: Status;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// Auth state. The cached `user` (from IndexedDB) lets the UI come up offline;
// on reconnect we exchange the refresh cookie for a live access token. Local
// work never blocks on having a valid token.
export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  async hydrate() {
    const stored = await getSession();
    if (!stored?.user) {
      set({ status: 'anonymous' });
      return;
    }
    // Show the cached identity immediately, then refresh the token if online.
    set({ user: stored.user, status: 'authenticated' });
    const refreshed = await api.refresh();
    if (refreshed) {
      api.setToken(refreshed.accessToken);
      const user = { ...stored.user, ...refreshed.user };
      await setSession({ user });
      set({ user });
    }
  },

  async login(username, password) {
    const res = await api.login(username, password);
    api.setToken(res.accessToken);
    const user: SessionUser = { ...res.user, username };
    await setSession({ user });
    set({ user, status: 'authenticated' });
  },

  async logout() {
    await api.logout();
    api.setToken(null);
    await clearSession();
    set({ user: null, status: 'anonymous' });
  },
}));
