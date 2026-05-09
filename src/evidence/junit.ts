import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { TestSummaryInput } from '../sn-client';

interface JUnitAttrs {
  tests?: string | number;
  failures?: string | number;
  errors?: string | number;
  skipped?: string | number;
  time?: string | number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

export function parseJUnit(path: string, toolName?: string): TestSummaryInput {
  const xml = fs.readFileSync(path, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const doc = parser.parse(xml) as Record<string, unknown>;

  const suites = collectSuites(doc);
  let total = 0,
    failed = 0,
    skipped = 0,
    duration = 0;

  for (const s of suites) {
    total += num(s.tests);
    failed += num(s.failures) + num(s.errors);
    skipped += num(s.skipped);
    duration += num(s.time);
  }

  const passed = Math.max(0, total - failed - skipped);
  const out: TestSummaryInput = { total, passed, failed, skipped, duration };
  if (toolName) out.toolName = toolName;
  return out;
}

function collectSuites(doc: Record<string, unknown>): JUnitAttrs[] {
  const root = (doc.testsuites ?? doc.testsuite) as unknown;
  if (!root) return [];
  const arr = Array.isArray(root) ? root : [root];
  const suites: JUnitAttrs[] = [];
  for (const r of arr) {
    const rec = r as Record<string, unknown>;
    if (rec.testsuite) {
      const inner = rec.testsuite;
      const innerArr = Array.isArray(inner) ? inner : [inner];
      for (const s of innerArr) suites.push(s as JUnitAttrs);
    } else {
      suites.push(rec as JUnitAttrs);
    }
  }
  return suites;
}
