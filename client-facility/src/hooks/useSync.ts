import { useCallback, useEffect, useState } from 'react';
import { syncNow, pendingCount, type SyncOutcome } from '../data/sync';
import { useOnline } from './useOnline';

// Drives the sync engine from the UI: syncs on mount and whenever connectivity
// returns, exposes a manual trigger, and bumps `version` after every completed
// sync so list views re-read the local projection.
export function useSync(enabled: boolean) {
  const online = useOnline();
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [version, setVersion] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    setPending(await pendingCount());
  }, []);

  const trigger = useCallback(async (): Promise<SyncOutcome | null> => {
    if (!enabled || !navigator.onLine) return null;
    setSyncing(true);
    setLastError(null);
    try {
      const outcome = await syncNow();
      return outcome;
    } catch {
      setLastError('Sync failed. Will retry when the connection improves.');
      return null;
    } finally {
      setSyncing(false);
      await refreshPending();
      setVersion((v) => v + 1);
    }
  }, [enabled, refreshPending]);

  useEffect(() => {
    void refreshPending();
    if (enabled && online) void trigger();
  }, [enabled, online, trigger, refreshPending]);

  return { syncing, pending, version, lastError, trigger };
}
