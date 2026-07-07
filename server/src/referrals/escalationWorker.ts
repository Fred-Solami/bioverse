import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool } from '../db.js';
import {
  evaluateEscalations,
  DEFAULT_THRESHOLDS,
  type EscalationThresholds,
  type ReferralSnapshot,
} from './escalation.js';

// Escalation worker: scans non-terminal referrals for SLA breaches and raises
// alerts. Idempotent via the (referral_id, alert_type) unique constraint, so it
// is safe to run on any interval. In production this runs on a timer; in tests
// scanAndRaise() is called directly with an injected `now`/thresholds.

interface SnapshotRow {
  id: string;
  priority: string;
  current_status: string;
  from_facility_id: string;
  to_facility_id: string | null;
  from_district: string | null;
  initiated_at: Date;
  dispatched_at: Date | null;
  treated_at: Date | null;
  status_since: Date | null;
}

export async function scanAndRaise(
  now: Date = new Date(),
  thresholds: EscalationThresholds = DEFAULT_THRESHOLDS,
): Promise<number> {
  const { rows } = await pool.query<SnapshotRow>(
    `SELECT r.id, r.priority, r.current_status, r.from_facility_id, r.to_facility_id,
            ff.district AS from_district,
            r.created_at AS initiated_at,
            (SELECT max(occurred_at) FROM referral_events e
              WHERE e.referral_id = r.id AND e.to_status = 'DISPATCHED') AS dispatched_at,
            (SELECT max(occurred_at) FROM referral_events e
              WHERE e.referral_id = r.id AND e.to_status = 'TREATED') AS treated_at,
            (SELECT max(occurred_at) FROM referral_events e
              WHERE e.referral_id = r.id AND e.to_status = r.current_status) AS status_since
       FROM referrals r
       JOIN facilities ff ON ff.id = r.from_facility_id
      WHERE r.current_status NOT IN ('CLOSED', 'CANCELLED')`,
  );

  let raised = 0;
  for (const row of rows) {
    const snap: ReferralSnapshot = {
      priority: row.priority,
      current_status: row.current_status,
      initiated_at: row.initiated_at,
      dispatched_at: row.dispatched_at,
      treated_at: row.treated_at,
      status_since: row.status_since ?? row.initiated_at,
    };

    for (const spec of evaluateEscalations(snap, now, thresholds)) {
      const facilityIds: string[] = [];
      if (spec.notifyReferrer) facilityIds.push(row.from_facility_id);
      if (spec.notifyReceiver && row.to_facility_id) facilityIds.push(row.to_facility_id);

      const res = await pool.query(
        `INSERT INTO referral_alerts
           (referral_id, alert_type, severity, district, facility_ids, detail)
         VALUES ($1, $2, $3, $4, $5::uuid[], $6)
         ON CONFLICT (referral_id, alert_type) DO NOTHING`,
        [
          row.id,
          spec.alert_type,
          spec.severity,
          spec.notifyDistrict ? row.from_district : null,
          facilityIds,
          JSON.stringify({ priority: row.priority, status: row.current_status }),
        ],
      );
      raised += res.rowCount ?? 0;
    }
  }
  return raised;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  scanAndRaise()
    .then((n) => {
      console.log(`Escalation scan complete: ${n} new alert(s) raised.`);
      return closePool();
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
      return closePool();
    });
}
