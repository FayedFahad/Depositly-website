import test from 'node:test';
import assert from 'node:assert/strict';
import {FDR, Transfer, createCloudBackup, emptyState, normalizeBackup} from '../assets/data-engine.js';

test('explicit phone payout and tenure choices survive website reads and backups independently', () => {
  const asset = {id:'independent', type:'FDR', interestType:'simple', name:'Independent terms', ownerName:'Sample Holder', ownership:'self', principal:30000000, rate:8, tds:15, start:'2026-10-01', first:'2027-01-01', maturity:'2027-01-09', cycle:3, cycleUnit:'months', tenureCount:100, tenureUnit:'days', autoRenew:false};
  const backup = createCloudBackup({...emptyState(), assets:[asset]});
  assert.deepEqual(normalizeBackup(backup).data.assets[0], asset);
  assert.deepEqual(Transfer.readInstrumentCSV(Transfer.instrumentCSV({...emptyState(), assets:[asset]})).assets[0].cycle, 3);
  assert.equal(FDR.normalizeAsset(asset), asset);
  assert.deepEqual(FDR.schedule(asset, asset.maturity).filter(event => !event.principal).map(event => event.date), ['2027-01-01', '2027-01-09']);
  const legacy = {...asset}; delete legacy.interestType;
  assert.equal(FDR.normalizeAsset(legacy).cycle, 100, 'Legacy correction remains available for old untyped records');
});
