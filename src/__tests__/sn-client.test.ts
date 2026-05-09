import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SNClient } from '../sn-client';

interface MockResp {
  ok: boolean;
  status?: number;
  text: () => Promise<string>;
}

function makeFetch(responses: MockResp[]) {
  const log: Array<[string, RequestInit | undefined]> = [];
  const fn = async (url: string, opts?: RequestInit): Promise<Response> => {
    log.push([url, opts]);
    const r = responses.shift();
    if (!r) throw new Error(`Unexpected fetch to ${url}`);
    return r as unknown as Response;
  };
  return { fn: fn as unknown as typeof fetch, log };
}

function apiResp(result: unknown): MockResp {
  return { ok: true, text: async () => JSON.stringify({ result }) };
}
function errResp(status: number, body = 'error'): MockResp {
  return { ok: false, status, text: async () => body };
}

describe('SNClient', () => {
  it('strips protocol and trailing slash from instance URL', async () => {
    const { fn, log } = makeFetch([apiResp({ artifactSysId: 'x', artifactVersionSysId: 'y' })]);
    const sn = new SNClient('https://dev12345.service-now.com/', 'u', 'p', fn);
    await sn.pushArtifact({ name: 'a', version: '1' });
    assert.ok(log[0][0].startsWith('https://dev12345.service-now.com/'));
    assert.ok(!log[0][0].includes('//api'));
  });

  it('sends Basic auth header', async () => {
    const { fn, log } = makeFetch([apiResp({ artifactSysId: 'x', artifactVersionSysId: 'y' })]);
    const sn = new SNClient('dev12345.service-now.com', 'myuser', 'mypass', fn);
    await sn.pushArtifact({ name: 'a', version: '1' });
    const authHeader = (log[0][1]?.headers as Record<string, string>)['Authorization'];
    assert.equal(authHeader, `Basic ${Buffer.from('myuser:mypass').toString('base64')}`);
  });

  it('pushArtifact returns sys ids', async () => {
    const { fn } = makeFetch([apiResp({ artifactSysId: 'art1', artifactVersionSysId: 'ver1' })]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    const r = await sn.pushArtifact({ name: 'myapp', version: '2.0' });
    assert.equal(r.artifactSysId, 'art1');
    assert.equal(r.artifactVersionSysId, 'ver1');
  });

  it('handles response without result wrapper', async () => {
    const { fn } = makeFetch([{ ok: true, text: async () => JSON.stringify({ artifactSysId: 'x', artifactVersionSysId: 'y' }) }]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    const r = await sn.pushArtifact({ name: 'a', version: '1' });
    assert.equal(r.artifactSysId, 'x');
  });

  it('pushTestResults returns testSummarySysId', async () => {
    const { fn } = makeFetch([apiResp({ testSummarySysId: 'ts1' })]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    const r = await sn.pushTestResults({ total: 10, passed: 9, failed: 1 });
    assert.equal(r.testSummarySysId, 'ts1');
  });

  it('pushQuality returns qualitySummarySysId', async () => {
    const { fn } = makeFetch([apiResp({ qualitySummarySysId: 'qs1', detailsCreated: 5, subdetailsCreated: 0 })]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    const r = await sn.pushQuality({ scannerName: 'SonarQube', projectName: 'proj' });
    assert.equal(r.qualitySummarySysId, 'qs1');
  });

  it('pushCommits returns commitSysIds', async () => {
    const { fn } = makeFetch([apiResp({ commitSysIds: ['c1', 'c2'], skipped: 0 })]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    const r = await sn.pushCommits([{ sha: 'abc' }, { sha: 'def' }]);
    assert.deepEqual(r.commitSysIds, ['c1', 'c2']);
  });

  it('getChangeState URL-encodes changeId', async () => {
    const { fn, log } = makeFetch([apiResp({ changeNumber: 'CHG001', state: '2', stateDisplayValue: 'Assess', approval: 'requested', approvalDisplayValue: 'Requested', changeSysId: 'sid' })]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    await sn.getChangeState('CHG 001');
    assert.ok(log[0][0].includes('CHG%20001'));
  });

  it('throws on API 4xx', async () => {
    const { fn } = makeFetch([errResp(401, 'Unauthorized')]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    await assert.rejects(
      () => sn.pushArtifact({ name: 'a', version: '1' }),
      /SN .* failed: 401/
    );
  });

  it('throws on API 500', async () => {
    const { fn } = makeFetch([errResp(500, 'Internal Error')]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    await assert.rejects(
      () => sn.pushArtifact({ name: 'a', version: '1' }),
      /SN .* failed: 500/
    );
  });

  it('throws on non-JSON API response', async () => {
    const { fn } = makeFetch([{ ok: true, text: async () => 'not json' }]);
    const sn = new SNClient('dev12345.service-now.com', 'u', 'p', fn);
    await assert.rejects(
      () => sn.pushArtifact({ name: 'a', version: '1' }),
      /non-JSON/
    );
  });
});