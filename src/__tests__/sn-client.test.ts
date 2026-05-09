jest.mock('@actions/core', () => ({ debug: jest.fn(), info: jest.fn(), warning: jest.fn() }));

import { SNClient } from '../sn-client';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function tokenResp(token = 'tok', expiresIn = 3600) {
  return { ok: true, text: async () => JSON.stringify({ access_token: token, expires_in: expiresIn }) };
}

function apiResp(result: unknown) {
  return { ok: true, text: async () => JSON.stringify({ result }) };
}

function errResp(status: number, body = 'error') {
  return { ok: false, status, text: async () => body };
}

describe('SNClient', () => {
  let sn: SNClient;

  beforeEach(() => {
    mockFetch.mockReset();
    sn = new SNClient('dev12345.service-now.com', 'cid', 'csec');
  });

  describe('constructor / URL normalisation', () => {
    it('strips https:// prefix and trailing slash', async () => {
      const client = new SNClient('https://dev12345.service-now.com/', 'a', 'b');
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(apiResp({ artifactSysId: 'x', artifactVersionSysId: 'y' }));
      await client.pushArtifact({ name: 'a', version: '1' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://dev12345.service-now.com/oauth_token.do');
    });
  });

  describe('token caching', () => {
    it('fetches token only once across multiple calls', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp('cached', 3600))
        .mockResolvedValue(apiResp({ artifactSysId: 'x', artifactVersionSysId: 'y' }));

      await sn.pushArtifact({ name: 'a', version: '1' });
      await sn.pushArtifact({ name: 'b', version: '2' });

      const tokenCalls = mockFetch.mock.calls.filter((c) => (c[0] as string).includes('oauth_token'));
      expect(tokenCalls).toHaveLength(1);
    });
  });

  describe('pushArtifact', () => {
    it('returns artifactSysId and artifactVersionSysId', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(apiResp({ artifactSysId: 'art1', artifactVersionSysId: 'ver1' }));

      const r = await sn.pushArtifact({ name: 'myapp', version: '2.0' });
      expect(r.artifactSysId).toBe('art1');
      expect(r.artifactVersionSysId).toBe('ver1');
    });

    it('handles response without result wrapper', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ artifactSysId: 'x', artifactVersionSysId: 'y' }) });

      const r = await sn.pushArtifact({ name: 'a', version: '1' });
      expect(r.artifactSysId).toBe('x');
    });
  });

  describe('pushTestResults', () => {
    it('returns testSummarySysId', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(apiResp({ testSummarySysId: 'ts1' }));

      const r = await sn.pushTestResults({ total: 10, passed: 9, failed: 1 });
      expect(r.testSummarySysId).toBe('ts1');
    });
  });

  describe('pushQuality', () => {
    it('returns qualitySummarySysId', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(apiResp({ qualitySummarySysId: 'qs1', detailsCreated: 5, subdetailsCreated: 0 }));

      const r = await sn.pushQuality({ scannerName: 'SonarQube', projectName: 'proj' });
      expect(r.qualitySummarySysId).toBe('qs1');
    });
  });

  describe('pushCommits', () => {
    it('returns commitSysIds array', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(apiResp({ commitSysIds: ['c1', 'c2'], skipped: 0 }));

      const r = await sn.pushCommits([{ sha: 'abc' }, { sha: 'def' }]);
      expect(r.commitSysIds).toEqual(['c1', 'c2']);
    });
  });

  describe('getChangeState', () => {
    it('URL-encodes changeId', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(apiResp({ changeNumber: 'CHG001', state: '2', stateDisplayValue: 'Assess', approval: 'requested', approvalDisplayValue: 'Requested', changeSysId: 'sid' }));

      await sn.getChangeState('CHG 001');
      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toContain('CHG%20001');
    });
  });

  describe('error handling', () => {
    it('throws on OAuth failure', async () => {
      mockFetch.mockResolvedValueOnce(errResp(401, 'Unauthorized'));
      await expect(sn.pushArtifact({ name: 'a', version: '1' })).rejects.toThrow('OAuth token request failed: 401');
    });

    it('throws on API 500', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce(errResp(500, 'Internal Error'));
      await expect(sn.pushArtifact({ name: 'a', version: '1' })).rejects.toThrow('SN /api/sn_devops/v1/agent/artifact failed: 500');
    });

    it('throws on non-JSON API response', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResp())
        .mockResolvedValueOnce({ ok: true, text: async () => 'not json' });
      await expect(sn.pushArtifact({ name: 'a', version: '1' })).rejects.toThrow('non-JSON');
    });
  });
});