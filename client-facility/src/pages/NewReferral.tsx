import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PatientPicker } from '../components/PatientPicker';
import { useTerminology } from '../hooks/useTerminology';
import { useAuth } from '../store/auth';
import { useOnline } from '../hooks/useOnline';
import { queueCreate, type Priority } from '../data/referrals';
import type { CachedPatient } from '../db/store';

const PRIORITIES: Priority[] = ['EMERGENCY', 'URGENT', 'ROUTINE'];

export function NewReferral() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const online = useOnline();
  const terminology = useTerminology();

  const [patient, setPatient] = useState<CachedPatient | null>(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState<Priority>('URGENT');
  const [dangerSigns, setDangerSigns] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(list: string[], code: string): string[] {
    return list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!patient) return setError('Select a patient.');
    if (reason.trim().length < 3) return setError('Enter a reason for referral.');
    if (!user) return setError('Session expired — sign in again.');

    setBusy(true);
    try {
      await queueCreate(
        {
          patient_id: patient.id,
          patient_name: `${patient.given_name} ${patient.family_name}`,
          reason,
          priority,
          danger_signs: dangerSigns,
          required_capabilities: capabilities,
          clinical_summary: summary,
        },
        user,
      );
      navigate('/', { replace: true });
    } catch {
      setError('Could not save the referral on this device.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>New referral</h1>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
          Cancel
        </button>
      </div>

      {!online && (
        <p className="offline-banner" data-testid="offline-banner">
          Offline — this referral is saved on the device and syncs when you reconnect.
        </p>
      )}

      <form className="card form" onSubmit={onSubmit}>
        <div className="field">
          <span className="field-label">Patient</span>
          <PatientPicker selected={patient} onSelect={setPatient} />
        </div>

        <div className="field">
          <span className="field-label">Priority</span>
          <div className="segmented" role="group" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button
                type="button"
                key={p}
                className={`seg ${priority === p ? 'seg-on' : ''} seg-${p.toLowerCase()}`}
                aria-pressed={priority === p}
                onClick={() => setPriority(p)}
              >
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Reason for referral</span>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="reason"
            required
          />
        </label>

        <div className="field">
          <span className="field-label">Danger signs</span>
          <div className="checks">
            {(terminology?.danger_signs ?? []).map((c) => (
              <label key={c.code} className={`check ${dangerSigns.includes(c.code) ? 'check-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={dangerSigns.includes(c.code)}
                  onChange={() => setDangerSigns((l) => toggle(l, c.code))}
                />
                {c.display}
              </label>
            ))}
            {!terminology && <p className="muted">Loading checklist…</p>}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Required capabilities</span>
          <div className="chips">
            {(terminology?.capabilities ?? []).map((c) => (
              <button
                type="button"
                key={c.code}
                className={`chip ${capabilities.includes(c.code) ? 'chip-on' : ''}`}
                aria-pressed={capabilities.includes(c.code)}
                onClick={() => setCapabilities((l) => toggle(l, c.code))}
              >
                {c.display}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Clinical summary (optional)</span>
          <textarea
            className="input"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>

        {error && (
          <p className="form-error" role="alert" data-testid="referral-error">
            {error}
          </p>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy} data-testid="referral-submit">
          {busy ? 'Saving…' : 'Create referral'}
        </button>
      </form>
    </section>
  );
}
