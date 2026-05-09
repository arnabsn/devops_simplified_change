jest.mock('@actions/core', () => ({ info: jest.fn(), debug: jest.fn(), warning: jest.fn() }));

import { collectSonar } from '../evidence/sonar';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe('collectSonar', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps sonar measures to QualityInput', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({
      component: {
        measures: [
          { metric: 'bugs', value: '3' },
          { metric: 'coverage', value: '82.5' },
          { metric: 'alert_status', value: 'OK' }
        ]
      }
    }));

    const r = await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'my-proj' });

    expect(r.scannerName).toBe('SonarQube');
    expect(r.projectName).toBe('my-proj');
    expect(r.shortDescription).toBe('Quality Gate OK');
    expect(r.details).toContainEqual({ category: 'bugs', value: '3' });
    expect(r.details).toContainEqual({ category: 'coverage', value: '82.5' });
  });

  it('sets scanUrl based on hostUrl and projectKey', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ component: { measures: [] } }));

    const r = await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'my-proj' });
    expect(r.scanUrl).toBe('https://sonar.example.com/dashboard?id=my-proj');
  });

  it('strips trailing slash from hostUrl', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ component: { measures: [] } }));

    const r = await collectSonar({ hostUrl: 'https://sonar.example.com/', token: 'tok', projectKey: 'p' });
    expect(r.scanUrl).not.toContain('//dashboard');
  });

  it('URL-encodes projectKey in API request', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ component: { measures: [] } }));

    await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'my proj' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('my%20proj');
  });

  it('uses UNKNOWN gate when alert_status absent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ component: { measures: [] } }));

    const r = await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'tok', projectKey: 'p' });
    expect(r.shortDescription).toBe('Quality Gate UNKNOWN');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });

    await expect(collectSonar({ hostUrl: 'https://sonar.example.com', token: 'bad', projectKey: 'p' }))
      .rejects.toThrow('Sonar measures fetch failed: 401');
  });

  it('sends Basic auth header with token', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ component: { measures: [] } }));

    await collectSonar({ hostUrl: 'https://sonar.example.com', token: 'mytoken', projectKey: 'p' });
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const auth = (opts.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe(`Basic ${Buffer.from('mytoken:').toString('base64')}`);
  });
});