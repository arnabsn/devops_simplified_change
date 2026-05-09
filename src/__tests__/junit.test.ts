import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJUnit } from '../evidence/junit';

function writeTmp(xml: string): string {
  const p = path.join(os.tmpdir(), `junit-${Date.now()}-${Math.random()}.xml`);
  fs.writeFileSync(p, xml);
  return p;
}

describe('parseJUnit', () => {
  it('parses single testsuite element', () => {
    const p = writeTmp(`<testsuite tests="10" failures="2" errors="1" skipped="1" time="5.5"/>`);
    const r = parseJUnit(p);
    expect(r.total).toBe(10);
    expect(r.failed).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.passed).toBe(6);
    expect(r.duration).toBeCloseTo(5.5);
    fs.unlinkSync(p);
  });

  it('attaches toolName when provided', () => {
    const p = writeTmp(`<testsuite tests="5" failures="0" errors="0" skipped="0" time="1"/>`);
    const r = parseJUnit(p, 'MyTool');
    expect(r.toolName).toBe('MyTool');
    fs.unlinkSync(p);
  });

  it('omits toolName when not provided', () => {
    const p = writeTmp(`<testsuite tests="1" failures="0" errors="0" skipped="0" time="0"/>`);
    const r = parseJUnit(p);
    expect(r.toolName).toBeUndefined();
    fs.unlinkSync(p);
  });

  it('aggregates multiple nested testsuites under testsuites wrapper', () => {
    const p = writeTmp(`
      <testsuites>
        <testsuite tests="4" failures="1" errors="0" skipped="0" time="2"/>
        <testsuite tests="6" failures="0" errors="1" skipped="2" time="3"/>
      </testsuites>`);
    const r = parseJUnit(p);
    expect(r.total).toBe(10);
    expect(r.failed).toBe(2);
    expect(r.skipped).toBe(2);
    expect(r.passed).toBe(6);
    expect(r.duration).toBeCloseTo(5);
    fs.unlinkSync(p);
  });

  it('handles missing optional attributes without NaN', () => {
    const p = writeTmp(`<testsuite tests="3"/>`);
    const r = parseJUnit(p);
    expect(r.total).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.passed).toBe(3);
    expect(r.duration).toBe(0);
    fs.unlinkSync(p);
  });

  it('returns all zeros for empty testsuites', () => {
    const p = writeTmp(`<testsuites/>`);
    const r = parseJUnit(p);
    expect(r.total).toBe(0);
    expect(r.passed).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.skipped).toBe(0);
    fs.unlinkSync(p);
  });

  it('clamps passed to 0 when failures exceed total', () => {
    const p = writeTmp(`<testsuite tests="2" failures="5" errors="0" skipped="0" time="0"/>`);
    const r = parseJUnit(p);
    expect(r.passed).toBe(0);
    fs.unlinkSync(p);
  });
});