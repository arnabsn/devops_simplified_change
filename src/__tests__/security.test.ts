import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectSecurity } from '../evidence/security';

function writeTmp(data: unknown): string {
  const p = path.join(os.tmpdir(), `sec-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

describe('collectSecurity', () => {
  describe('snyk', () => {
    it('counts severity buckets from single report', () => {
      const p = writeTmp({
        vulnerabilities: [
          { severity: 'critical' },
          { severity: 'high' },
          { severity: 'high' },
          { severity: 'medium' }
        ]
      });
      const r = collectSecurity({ scanner: 'snyk', resultsPath: p, projectName: 'proj' });
      assert.equal(r.scannerName, 'Snyk');
      assert.equal(r.shortDescription, '1C/2H/1M/0L');
      assert.ok(r.details?.some(d => d.category === 'critical' && d.value === 1));
      fs.unlinkSync(p);
    });

    it('aggregates counts across array of reports', () => {
      const p = writeTmp([
        { vulnerabilities: [{ severity: 'low' }, { severity: 'low' }] },
        { vulnerabilities: [{ severity: 'high' }] }
      ]);
      const r = collectSecurity({ scanner: 'snyk', resultsPath: p, projectName: 'proj' });
      assert.equal(r.shortDescription, '0C/1H/0M/2L');
      fs.unlinkSync(p);
    });

    it('returns zeros when no vulnerabilities', () => {
      const p = writeTmp({ vulnerabilities: [] });
      const r = collectSecurity({ scanner: 'snyk', resultsPath: p, projectName: 'proj' });
      assert.equal(r.shortDescription, '0C/0H/0M/0L');
      fs.unlinkSync(p);
    });
  });

  describe('trivy', () => {
    it('counts Trivy vulnerability severities', () => {
      const p = writeTmp({
        Results: [
          { Vulnerabilities: [{ Severity: 'CRITICAL' }, { Severity: 'HIGH' }] },
          { Vulnerabilities: [{ Severity: 'MEDIUM' }, { Severity: 'LOW' }] }
        ]
      });
      const r = collectSecurity({ scanner: 'trivy', resultsPath: p, projectName: 'app' });
      assert.equal(r.scannerName, 'Trivy');
      assert.equal(r.shortDescription, '1C/1H/1M/1L');
      fs.unlinkSync(p);
    });

    it('handles empty Results array', () => {
      const p = writeTmp({ Results: [] });
      const r = collectSecurity({ scanner: 'trivy', resultsPath: p, projectName: 'app' });
      assert.equal(r.shortDescription, '0C/0H/0M/0L');
      fs.unlinkSync(p);
    });

    it('is case-insensitive for scanner name', () => {
      const p = writeTmp({ Results: [] });
      assert.doesNotThrow(() => collectSecurity({ scanner: 'Trivy', resultsPath: p, projectName: 'app' }));
      fs.unlinkSync(p);
    });
  });

  it('throws on unsupported scanner', () => {
    const p = writeTmp({});
    assert.throws(
      () => collectSecurity({ scanner: 'checkmarx', resultsPath: p, projectName: 'app' }),
      /Unsupported security-scanner/
    );
    fs.unlinkSync(p);
  });
});