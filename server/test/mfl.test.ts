import { describe, expect, it } from 'vitest';
import { parseCsv, parseMfl } from '../src/interop/zhfr/mfl.js';

const HEADER =
  'province,district,name,HMIS_code,DHIS2_UID,smartcare_GUID,eLMIS_ID,iHRIS_ID,' +
  'location,ownership,facility_type,longitude,latitude,' +
  'catchment_population_head_count,catchment_population_cso,operation_status';

describe('parseCsv', () => {
  it('handles quoted fields with embedded commas and quotes', () => {
    const rows = parseCsv('a,"b, with comma","say ""hi"""\r\nc,d,e\n');
    expect(rows).toEqual([
      ['a', 'b, with comma', 'say "hi"'],
      ['c', 'd', 'e'],
    ]);
  });
});

describe('parseMfl', () => {
  it('maps a real-shaped row onto the facility schema', () => {
    const csv = [
      HEADER,
      'Central,Chibombo,Chamakubi Health Post,10010001,pXhz0PLiYZX,7b46450b78a04a1db64c0fc9bb014773,,facility|1,Rural,GRZ,Health Post,27.64199073,-14.79990288,6624,6624,Operational',
    ].join('\n');

    const { facilities, skipped, typeFallbacks, ownershipFallbacks } = parseMfl(csv);
    expect(skipped).toBe(0);
    expect(typeFallbacks).toBe(0);
    expect(ownershipFallbacks).toBe(0);
    expect(facilities).toHaveLength(1);
    expect(facilities[0]).toMatchObject({
      zhfr_code: '10010001',
      name: 'Chamakubi Health Post',
      facility_type: 'HEALTH_POST',
      ownership: 'MOH', // GRZ → MOH
      district: 'Chibombo',
      province: 'Central',
      longitude: 27.64199073,
      latitude: -14.79990288,
      dhis2_uid: 'pXhz0PLiYZX',
      smartcare_guid: '7b46450b78a04a1db64c0fc9bb014773',
      elmis_id: null,
      is_active: true,
    });
  });

  it('maps hospital levels and marks non-operational facilities inactive', () => {
    const csv = [
      HEADER,
      'Copperbelt,Ndola,Ndola Central Hospital,20020001,abc123,,,,Urban,GRZ,Central Hospital,28.6,-12.9,,,Operational',
      'Copperbelt,Ndola,Closed Clinic,20020002,,,,,Urban,Private,Urban Health Centre,28.7,-13.0,,,Non-Operational',
    ].join('\n');

    const { facilities } = parseMfl(csv);
    expect(facilities[0]).toMatchObject({ facility_type: 'L3_HOSPITAL', is_active: true });
    expect(facilities[1]).toMatchObject({
      facility_type: 'HEALTH_CENTRE',
      ownership: 'PRIVATE',
      is_active: false,
    });
  });

  it('maps the live dataset vocabulary exactly (census 2026-07-07)', () => {
    const csv = [
      HEADER,
      'Copperbelt,Ndola,L2 Hosp,1,,,,,Urban,GRZ,Hospital - Level 2,28.6,-12.9,,,Operational',
      'Copperbelt,Ndola,L3 Hosp,2,,,,,Urban,GRZ,Hospital - Level 3,28.6,-12.9,,,Operational',
      'Copperbelt,Ndola,Zonal HC,3,,,,,Urban,NGO,Zonal Health Centre,28.6,-12.9,,,Operational',
      'Copperbelt,Ndola,Border HP,4,,,,,Rural,Military,Border Health Post,28.6,-12.9,,,Operational',
    ].join('\n');
    const r = parseMfl(csv);
    expect(r.typeFallbacks).toBe(0);
    expect(r.ownershipFallbacks).toBe(0);
    expect(r.facilities.map((f) => f.facility_type)).toEqual([
      'L2_HOSPITAL', 'L3_HOSPITAL', 'HEALTH_CENTRE', 'HEALTH_POST',
    ]);
    expect(r.facilities.map((f) => f.ownership)).toEqual([
      'MOH', 'MOH', 'PRIVATE', 'ZDF',
    ]);
  });

  it('falls back heuristically on unknown labels and counts it', () => {
    const csv = [
      HEADER,
      'Lusaka,Lusaka,Mystery Hospital Annex,30030001,,,,,Urban,Some NGO,Mini Hospital,28.3,-15.4,,,Operational',
    ].join('\n');
    const r = parseMfl(csv);
    expect(r.facilities[0]!.facility_type).toBe('L1_HOSPITAL'); // contains "hospital"
    expect(r.typeFallbacks).toBe(1);
    expect(r.ownershipFallbacks).toBe(1);
  });

  it('skips rows missing the HMIS code and tolerates missing coordinates', () => {
    const csv = [
      HEADER,
      'Lusaka,Lusaka,No Code Facility,,,,,,Urban,GRZ,Health Post,,,,,Operational',
      'Lusaka,Lusaka,No Coords Post,30030002,,,,,Rural,GRZ,Health Post,,,,,Operational',
    ].join('\n');
    const r = parseMfl(csv);
    expect(r.skipped).toBe(1);
    expect(r.facilities[0]).toMatchObject({ longitude: null, latitude: null });
  });

  it('fails loudly when the published contract drifts', () => {
    expect(() => parseMfl('a,b,c\n1,2,3')).toThrow(/contract changed/);
  });
});
