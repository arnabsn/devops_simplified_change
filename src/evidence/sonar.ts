import * as core from '@actions/core';
import { QualityInput } from '../sn-client';

const METRIC_KEYS = [
  'bugs',
  'vulnerabilities',
  'code_smells',
  'coverage',
  'duplicated_lines_density',
  'security_rating',
  'reliability_rating',
  'sqale_rating',
  'alert_status'
].join(',');

interface SonarMeasure {
  metric: string;
  value?: string;
}

interface SonarResponse {
  component?: { measures?: SonarMeasure[] };
}

export async function collectSonar(opts: {
  hostUrl: string;
  token: string;
  projectKey: string;
}): Promise<QualityInput> {
  const url = `${opts.hostUrl.replace(/\/$/, '')}/api/measures/component?component=${encodeURIComponent(
    opts.projectKey
  )}&metricKeys=${METRIC_KEYS}`;

  const auth = Buffer.from(`${opts.token}:`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`Sonar measures fetch failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as SonarResponse;
  const measures = json.component?.measures ?? [];
  const map = new Map(measures.map((m) => [m.metric, m.value ?? '']));
  const gate = map.get('alert_status') ?? 'UNKNOWN';

  core.info(`Sonar quality gate: ${gate}`);

  return {
    scannerName: 'SonarQube',
    projectName: opts.projectKey,
    scanUrl: `${opts.hostUrl.replace(/\/$/, '')}/dashboard?id=${encodeURIComponent(opts.projectKey)}`,
    shortDescription: `Quality Gate ${gate}`,
    details: measures.map((m) => ({ category: m.metric, value: m.value ?? '' }))
  };
}
