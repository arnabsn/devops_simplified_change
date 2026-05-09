import * as core from '@actions/core';

export async function setCommitStatus(opts: {
  token: string;
  owner: string;
  repo: string;
  sha: string;
  state: 'success' | 'failure' | 'pending' | 'error';
  context: string;
  description: string;
  targetUrl?: string;
}): Promise<void> {
  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/statuses/${opts.sha}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      state: opts.state,
      context: opts.context,
      description: opts.description.slice(0, 140),
      target_url: opts.targetUrl
    })
  });

  if (!res.ok) {
    core.warning(`GitHub status update failed: ${res.status} ${await res.text()}`);
  }
}
