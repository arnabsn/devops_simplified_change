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
      expect(r.scannerName).toBe('Snyk');
      expect(r.projectName).toBe('proj');
      expect(r.shortDescription).toBe('1C/2H/1M/0L');
      expect(r.details).toContainEqual({ category: 'critical', value: 1 });
      fs.unlinkSync(p);
    });

    it('aggregates counts across array of reports', () => {
      const p = writeTmp([
        { vulnerabilities: [{ severity: 'low' }, { severity: 'low' }] },
        { vulnerabilities: [{ severity: 'high' }] }
      ]);
      const r = collectSecurity({ scanner: 'snyk', resultsPath: p, projectName: 'proj' });
      expect(r.shortDescription).toBe('0C/1H/0M/2L');
      fs.unlinkSync(p);
    });

    it('returns zeros when no vulnerabilities', () => {
      const p = writeTmp({ vulnerabilities: [] });
      const r = collectSecurity({ scanner: 'snyk', resultsPath: p, projectName: 'proj' });
      expect(r.shortDescription).toBe('0C/0H/0M/0L');
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
      expect(r.scannerName).toBe('Trivy');
      expect(r.shortDescription).toBe('1C/1H/1M/1L');
      fs.unlinkSync(p);
    });

    it('handles empty Results array', () => {
      const p = writeTmp({ Results: [] });
      const r = collectSecurity({ scanner: 'trivy', resultsPath: p, projectName: 'app' });
      expect(r.shortDescription).toBe('0C/0H/0M/0L');
      fs.unlinkSync(p);
    });

    it('is case-insensitive for scanner name', () => {
      const p = writeTmp({ Results: [] });
      expect(() => collectSecurity({ scanner: 'Trivy', resultsPath: p, projectName: 'app' })).not.toThrow();
      fs.unlinkSync(p);
    });
  });

  it('throws on unsupported scanner', () => {
    const p = writeTmp({});
    expect(() => collectSecurity({ scanner: 'checkmarx', resultsPath: p, projectName: 'app' }))
      .toThrow('Unsupported security-scanner');
    fs.unlinkSync(p);
  });
});