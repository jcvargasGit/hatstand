import type { TaskSource } from './schemas';

const GITHUB_KEY = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

function parseUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function fromUrl(url: URL): TaskSource | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const link = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  if (url.hostname === 'github.com') {
    const [owner, repo, kind, number] = parts;
    if (owner && repo && (kind === 'issues' || kind === 'pull') && number && /^\d+$/.test(number) && parts.length === 4) {
      return { kind: 'github', key: `${owner}/${repo}#${number}`, url: link };
    }
    return null;
  }
  const marker = parts.indexOf('-');
  if (marker > 0) {
    const [kind, number] = parts.slice(marker + 1);
    if ((kind === 'issues' || kind === 'work_items') && number && /^\d+$/.test(number) && parts.length === marker + 3) {
      return { kind: 'gitlab', key: `${parts.slice(0, marker).join('/')}#${number}`, url: link };
    }
  }
  const [browse, key] = parts;
  if (browse === 'browse' && key && JIRA_KEY.test(key) && parts.length === 2) return { kind: 'jira', key, url: link };
  return null;
}

export function parseIssueReference(input: string): TaskSource {
  const text = input.trim();
  const url = parseUrl(text);
  const source = url ? fromUrl(url) : null;
  if (source) return source;
  const github = GITHUB_KEY.exec(text);
  if (github) return { kind: 'github', key: text, url: `https://github.com/${github[1]}/${github[2]}/issues/${github[3]}` };
  if (JIRA_KEY.test(text)) return { kind: 'jira', key: text };
  throw new Error('Paste the link of a GitHub, GitLab or Jira issue, or a key like owner/repo#12 or ABC-12.');
}
