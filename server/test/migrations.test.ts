import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(testDir, '..', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('migrations', () => {
  it('are sequentially numbered from 0001 with no gaps or duplicates', () => {
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('cover the DESIGN.md §9 DDL plus the v0.1 auth additions', () => {
    expect(files).toEqual([
      '0001_facilities.sql',
      '0002_users.sql',
      '0003_identity.sql',
      '0004_referrals.sql',
      '0005_stock.sql',
      '0006_audit.sql',
      '0007_sync.sql',
      '0008_refresh_tokens.sql', // v0.1: rotating refresh tokens (DESIGN.md §15)
    ]);
  });

  it('contain no obviously unbalanced statements', () => {
    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      const opens = (sql.match(/\(/g) ?? []).length;
      const closes = (sql.match(/\)/g) ?? []).length;
      expect(opens, `${file} parentheses`).toBe(closes);
      expect(sql.trim().length, `${file} not empty`).toBeGreaterThan(0);
    }
  });
});

describe('seed data', () => {
  it('facilities.sample.json is valid and every entry has required fields', () => {
    const seed = JSON.parse(
      readFileSync(
        path.join(testDir, '..', 'seed', 'facilities.sample.json'),
        'utf8',
      ),
    ) as Array<Record<string, unknown>>;

    expect(seed.length).toBeGreaterThan(0);
    const codes = new Set<string>();
    for (const f of seed) {
      expect(typeof f.zhfr_code).toBe('string');
      expect(f.zhfr_code as string).toMatch(/^DEV-/); // dev data must be unmistakable
      expect(codes.has(f.zhfr_code as string)).toBe(false);
      codes.add(f.zhfr_code as string);
      expect(typeof f.name).toBe('string');
      expect([
        'HEALTH_POST',
        'HEALTH_CENTRE',
        'L1_HOSPITAL',
        'L2_HOSPITAL',
        'L3_HOSPITAL',
        'PHARMACY',
      ]).toContain(f.facility_type);
      expect([
        'MOH',
        'FAITH_BASED',
        'PRIVATE',
        'ZDF',
        'ZNS',
        'POLICE',
        'CORRECTIONAL',
      ]).toContain(f.ownership);
      expect(typeof f.district).toBe('string');
      expect(typeof f.province).toBe('string');
      expect(typeof f.capabilities).toBe('object');
    }
  });
});
