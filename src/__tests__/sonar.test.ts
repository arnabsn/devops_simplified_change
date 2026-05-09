import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectSonar } from '../evidence/sonar';

interface MockResp {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

let mockResp: MockResp;
let lastUrl: string;
let lastOpts: RequestInit;

global.fetch = (async (url: string, opts?: RequestInit) => {
  lastUrl = url;
  lastOpts = opts as RequestInit;
  return mockResp as Response;
}) as typeof fetch;

describe('collectSonar', () => {
  beforeEach(() => {
    lastUrl = '';
    lastOpts = {};
  });

  it('maps sonar measures to QualityInput', async () => {
    mockResp = {
      ok: true,
      json: async () => ({
        component: {
          measures: [
            { metric: 'bugs', value: '3' },
            { metric: 'coverage', value: '82.5' },
            { metric: 'alert_status', value: 'OK' }
          ]
        }
      })
    };
    const r = await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'my-proj' });
    assert.equal(r.scannerName, 'SonarQube');
    assert.equal(r.projectName, 'my-proj');
    assert.equal(r.shortDescription, 'Quality Gate OK');
    assert.ok(r.details?.some(d => d.category === 'bugs' && d.value === '3'));
  });

  it('sets scanUrl from hostUrl and projectKey', async () => {
    mockResp = { ok: true, json: async () => ({ component: { measures: [] } }) };
    const r = await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'my-proj' });
    assert.equal(r.scanUrl, 'https://sonar.example.com/dashboard?id=my-proj');
  });

  it('strips trailing slash from hostUrl', async () => {
    mockResp = { ok: true, json: async () => ({ component: { measures: [] } }) };
    const r = await collectSonar({ hostUrl: 'https://sonar.example.com/', token: 'tok', projectKey: 'p' });
    assert.ok(!r.scanUrl?.includes('//dashboard'));
  });

  it('URL-encodes projectKey in request', async () => {
    mockResp = { ok: true, json: async () => ({ component: { measures: [] } }) };
    await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'my proj' });
    assert.ok(lastUrl.includes('my%20proj'));
  });

  it('uses UNKNOWN gate when alert_status absent', async () => {
    mockResp = { ok: true, json: async () => ({ component: { measures: [] } }) };
    const r = await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'p' });
    assert.equal(r.shortDescription, 'Quality Gate UNKNOWN');
  });

  it('throws on non-2xx response', async () => {
    mockResp = { ok: false, status: 401, text: async () => 'Unauthorized' };
    await assert.rejects(
      () => collectSonar({ hostUrl: 'https://sonar.example.com', token: 'bad', projectKey: 'p' }),
      /Sonar measures fetch failed: 401/
    );
  });

  it('sends Basic auth header', async () => {
    mockResp = { ok: true, json: async () => ({ component: { measures: [] } }) };
    await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'mytoken', projectKey: 'p' });
    const auth = (lastOpts.headers as Record<string, string>)['Authorization'];
    assert.equal(auth, `Basic ${Buffer.from('mytoken:').toString('base64')}`);
  });
});