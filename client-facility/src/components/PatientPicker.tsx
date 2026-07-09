import { useEffect, useState } from 'react';
import { searchPatients, type PatientHit } from '../api/client';
import { listPatients, putPatient, type CachedPatient } from '../db/store';
import { useOnline } from '../hooks/useOnline';

function fullName(p: { given_name: string; family_name: string }): string {
  return `${p.given_name} ${p.family_name}`;
}

// A referral needs a server-known patient (the sync CREATE does an FK insert),
// so we search online and cache the choice; offline we filter the cache. Offline
// new-patient registration is out of scope for v0.3 (needs the server cascade).
export function PatientPicker({
  selected,
  onSelect,
}: {
  selected: CachedPatient | null;
  onSelect: (p: CachedPatient | null) => void;
}) {
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [cached, setCached] = useState<CachedPatient[]>([]);
  const [results, setResults] = useState<CachedPatient[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void listPatients().then(setCached);
  }, []);

  if (selected) {
    return (
      <div className="picked" data-testid="patient-selected">
        <div>
          <strong>{fullName(selected)}</strong>
          {selected.district ? <span className="muted"> · {selected.district}</span> : null}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => onSelect(null)}>
          Change
        </button>
      </div>
    );
  }

  async function run() {
    setNote(null);
    const q = query.trim();
    if (q.length < 2) {
      setNote('Enter at least 2 characters.');
      return;
    }
    if (online) {
      setBusy(true);
      try {
        const hits = await searchPatients({ name: q });
        setResults(hits as CachedPatient[]);
        if (hits.length === 0) setNote('No matches on the server.');
      } catch {
        setNote('Search failed — showing patients saved on this device.');
        setResults(filterCached(q));
      } finally {
        setBusy(false);
      }
    } else {
      const local = filterCached(q);
      setResults(local);
      if (local.length === 0) setNote('Offline — no matching patient saved on this device.');
    }
  }

  function filterCached(q: string): CachedPatient[] {
    const needle = q.toLowerCase();
    return cached.filter((p) => fullName(p).toLowerCase().includes(needle));
  }

  async function choose(p: PatientHit | CachedPatient) {
    const patient: CachedPatient = {
      id: p.id,
      given_name: p.given_name,
      family_name: p.family_name,
      sex: p.sex ?? null,
      birth_date: p.birth_date ?? null,
      district: p.district ?? null,
    };
    await putPatient(patient); // cache for offline reuse
    onSelect(patient);
  }

  return (
    <div className="picker">
      <div className="picker-row">
        <input
          className="input"
          placeholder={online ? 'Search patient by name' : 'Search saved patients'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), run())}
          data-testid="patient-search"
        />
        <button type="button" className="btn btn-ghost" onClick={() => void run()} disabled={busy}>
          {busy ? '…' : 'Search'}
        </button>
      </div>
      {note && <p className="muted picker-note">{note}</p>}
      {results.length > 0 && (
        <ul className="picker-results">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" className="picker-hit" onClick={() => void choose(p)}>
                <strong>{fullName(p)}</strong>
                {p.district ? <span className="muted"> · {p.district}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
