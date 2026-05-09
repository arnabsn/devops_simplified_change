import * as fs from 'fs';
import { QualityInput } from '../sn-client';

interface SnykVuln {
  severity?: string;
}

interface SnykReport {
  vulnerabilities?: SnykVuln[];
  projectName?: string;
}

export function collectSecurity(opts: {
  scanner: string;
  resultsPath: string;
  projectName: string;
}): QualityInput {
  const raw = fs.readFileSync(opts.resultsPath, 'utf8');
  const lower = opts.scanner.toLowerCase();

  if (lower === 'snyk') return parseSnyk(raw, opts.projectName);
  if (lower === 'trivy') return parseTrivy(raw, opts.projectName);

  throw new Error(`Unsupported security-scanner: ${opts.scanner} (snyk|trivy supported)`);
}

function parseSnyk(raw: string, projectName: string): QualityInput {
  const reports: SnykReport[] = (() => {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [j];
  })();

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of reports) {
    for (const v of r.vulnerabilities ?? []) {
      const sev = (v.severity ?? '').toLowerCase();
      if (sev in counts) counts[sev as keyof typeof counts]++;
    }
  }

  return {
    scannerName: 'Snyk',
    projectName,
    shortDescription: `${counts.critical}C/${counts.high}H/${counts.medium}M/${counts.low}L`,
    details: [
      { category: 'critical', value: counts.critical },
      { category: 'high', value: counts.high },
      { category: 'medium', value: counts.medium },
      { category: 'low', value: counts.low }
    ]
  };
}

interface TrivyResult {
  Vulnerabilities?: { Severity?: string }[];
}

function parseTrivy(raw: string, projectName: string): QualityInput {
  const j = JSON.parse(raw) as { Results?: TrivyResult[] };
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const r of j.Results ?? []) {
    for (const v of r.Vulnerabilities ?? []) {
      const sev = (v.Severity ?? '').toLowerCase();
      if (sev in counts) counts[sev as keyof typeof counts]++;
    }
  }

  return {
    scannerName: 'Trivy',
    projectName,
    shortDescription: `${counts.critical}C/${counts.high}H/${counts.medium}M/${counts.low}L`,
    details: Object.entries(counts).map(([k, v]) => ({ category: k, value: v }))
  };
}
