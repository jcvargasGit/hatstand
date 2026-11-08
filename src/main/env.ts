const INHERITED_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'SSH_AUTH_SOCK'];

export type AgentEnvInput = {
  base: NodeJS.ProcessEnv;
  path: string;
  secrets: Record<string, string>;
  extra: Record<string, string>;
};

export function buildAgentEnv({ base, path, secrets, extra }: AgentEnvInput): Record<string, string> {
  const inherited = Object.fromEntries(
    INHERITED_KEYS.flatMap((key) => {
      const value = base[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  return {
    ...inherited,
    PATH: path,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...secrets,
    ...extra,
  };
}

export function parseEnvFile(text: string): Record<string, string> {
  const entries = text.split(/\r?\n/).flatMap((rawLine): [string, string][] => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return [];
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) return [];
    const [, name, value] = match;
    if (!name || value === undefined) return [];
    return [[name, unquote(value.trim())]];
  });
  return Object.fromEntries(entries);
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  if (quoted) return quoted[2] ?? '';
  return value.replace(/\s+#.*$/, '');
}

const SENSITIVE_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|API_?KEY|PRIVATE|CREDENTIAL|_PAT$)/i;
const MIN_SECRET_LENGTH = 8;

export function isSensitiveSecret(name: string, value: string): boolean {
  return value.length >= MIN_SECRET_LENGTH && SENSITIVE_NAME.test(name);
}
