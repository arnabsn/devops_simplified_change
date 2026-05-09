import { execFileSync } from 'child_process';
import { CommitInput } from '../sn-client';

const SEP = '';
const REC = '';

export function collectCommitsAuto(serverUrl: string, repo: string): CommitInput[] {
  const range = resolveRange();
  if (!range) return [];

  const fmt = ['%H', '%s', '%an', '%aI'].join(SEP);
  const out = execFileSync('git', ['log', range, `--format=${fmt}${REC}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });

  return out
    .split(REC)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): CommitInput => {
      const [sha, message, author, timestamp] = line.split(SEP);
      return {
        sha,
        message,
        author,
        timestamp,
        url: `${serverUrl}/${repo}/commit/${sha}`
      };
    });
}

function resolveRange(): string | null {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (tag) return `${tag}..HEAD`;
  } catch {
    // no tags — fall through
  }
  // Fallback: last 50 commits.
  return '-50';
}
