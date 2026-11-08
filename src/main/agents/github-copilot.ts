import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from '../../shared/schemas';
import { CLEAR_STEP_DONE, STEP_DONE_COMMAND } from '../step-done-tool';
import { CHECK_PLAN_COMMAND } from '../check-plan-tool';
import { writePrivateFile } from '../store';
import { STATUS_FILE_ENV, type AgentAdapter } from './types';

const HOOK_TIMEOUT_SEC = 10;
const SHELL_TOOL = `"toolName" *: *"(bash|powershell)"`;
const SKIPS_GIT_HOOKS = `--no-verify|git[^|;&]*commit[^|;&]* -[a-zA-Z]*n`;
const DENY_SKIPPING_HOOKS = JSON.stringify({
  permissionDecision: 'deny',
  permissionDecisionReason: 'Hatstand blocks skipping git hooks, because they keep client data out of commits.',
});

const report = (state: SessionState) => `printf ${state} > "$${STATUS_FILE_ENV}"`;
const command = (bash: string) => ({ type: 'command', bash, timeoutSec: HOOK_TIMEOUT_SEC });

const statusCommand = (state: SessionState) => command(`cat > /dev/null; ${report(state)}`);
const blockSkippingHooks = command(
  `input=$(cat); if printf '%s' "$input" | grep -Eq '${SHELL_TOOL}' && printf '%s' "$input" | grep -Eq -- '${SKIPS_GIT_HOOKS}'; then printf '%s' '${DENY_SKIPPING_HOOKS}'; fi`,
);
const beforeTool = command(`if grep -Eq '"toolName" *: *"ask_user"'; then ${report('needs-input')}; else ${report('working')}; fi`);
const onNotification = command(`if grep -Eq '"notification_type" *: *"(permission_prompt|elicitation_dialog)"'; then ${report('needs-input')}; fi`);

export const COPILOT_INSTRUCTIONS_FILE = 'hatstand.instructions.md';
const pluginDir = (sessionDir: string) => join(sessionDir, 'plugin');
const instructionsDir = (sessionDir: string) => join(sessionDir, 'instructions');

export const githubCopilot: AgentAdapter = {
  hiddenSecrets: ['GITHUB_TOKEN', 'GH_TOKEN'],

  buildLaunch({ account, company, task, sessionId, sessionDir, notesFile, resume, addDirs }) {
    const identity = resume ? ['--resume', sessionId] : ['--session-id', sessionId, '--name', `${company.name}: ${task.title}`];
    return {
      command: 'copilot',
      args: [
        ...identity,
        '--plugin-dir',
        pluginDir(sessionDir),
        `--allow-tool=write(${notesFile})`,
        `--allow-tool=shell(${STEP_DONE_COMMAND}:*)`,
        ...(task.backlogPlan ? [`--allow-tool=shell(${CHECK_PLAN_COMMAND}:*)`] : []),
        ...(account.model ? ['--model', account.model] : []),
        ...(company.skipPermissions ? ['--allow-all'] : []),
        ...(company.context.mcpConfigFile ? ['--additional-mcp-config', `@${company.context.mcpConfigFile}`] : []),
        ...(company.context.pluginDir ? ['--plugin-dir', company.context.pluginDir] : []),
        ...addDirs.flatMap((dir) => ['--add-dir', dir]),
      ],
      env: {
        COPILOT_CUSTOM_INSTRUCTIONS_DIRS: instructionsDir(sessionDir),
        ...(account.configDir ? { COPILOT_HOME: account.configDir } : {}),
      },
    };
  },

  buildStatusSettings() {
    return JSON.stringify({
      version: 1,
      hooks: {
        userPromptSubmitted: [command(`cat > /dev/null; ${CLEAR_STEP_DONE}; ${report('working')}`)],
        preToolUse: [blockSkippingHooks, beforeTool],
        postToolUse: [statusCommand('working')],
        notification: [onNotification],
        agentStop: [statusCommand('idle')],
      },
    });
  },

  prepareSession({ sessionDir, promptFile, settingsFile }) {
    writePrivateFile(join(pluginDir(sessionDir), 'plugin.json'), JSON.stringify({ name: 'hatstand-session', version: '0.0.1', description: 'Hatstand status hooks' }));
    writePrivateFile(join(pluginDir(sessionDir), 'hooks.json'), readFileSync(settingsFile));
    writePrivateFile(join(instructionsDir(sessionDir), COPILOT_INSTRUCTIONS_FILE), `---\napplyTo: "**"\n---\n${readFileSync(promptFile, 'utf8')}`);
  },
};
