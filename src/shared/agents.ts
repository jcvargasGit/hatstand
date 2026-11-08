import type { Account } from './schemas';

type AgentInfo = {
  name: string;
  command: string;
  signInArgs: string[];
  installCommand: string;
  configDirVariable: string;
  signInExample: string;
};

export const AGENT_INFO: Record<Account['type'], AgentInfo> = {
  'claude-code': {
    name: 'Claude Code',
    command: 'claude',
    signInArgs: ['auth', 'login'],
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    configDirVariable: 'CLAUDE_CONFIG_DIR',
    signInExample: 'CLAUDE_CONFIG_DIR=<folder> claude',
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    command: 'copilot',
    signInArgs: ['login'],
    installCommand: 'npm install -g @github/copilot',
    configDirVariable: 'COPILOT_HOME',
    signInExample: 'COPILOT_HOME=<folder> copilot login',
  },
};
