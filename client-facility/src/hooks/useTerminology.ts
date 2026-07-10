import { useEffect, useState } from 'react';
import { getTerminology, type Terminology } from '../api/client';
import { getMeta, setMeta } from '../db/store';

const CACHE_KEY = 'terminology';

// Cache-first terminology: show the last cached value immediately (works
// offline), then refresh from the server when reachable. The danger-sign
// checklist and capability chips are driven by this, so the client's vocabulary
// always matches what the server validates against.
export function useTerminology(): Terminology | null {
  const [terminology, setTerminology] = useState<Terminology | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await getMeta<Terminology>(CACHE_KEY);
      if (cached && alive) setTerminology(cached);
      try {
        const fresh = await getTerminology();
        await setMeta(CACHE_KEY, fresh);
        if (alive) setTerminology(fresh);
      } catch {
        // Offline or unauthorized; the cached value (if any) stands.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return terminology;
}
