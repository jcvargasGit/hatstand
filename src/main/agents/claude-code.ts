import type { SessionState } from '../../shared/schemas';
import { CLEAR_STEP_DONE, STEP_DONE_COMMAND } from '../step-done-tool';
import { CHECK_PLAN_COMMAND } from '../check-plan-tool';
import { ACTIVITY_FILE_ENV, STATUS_FILE_ENV, WAITING_AT_PROMPT, type AgentAdapter } from './types';

export const BLOCK_HOOK_BYPASS_COMMAND = `if grep -Eq -- '--no-verify|git[^|;&]*commit[^|;&]* -[a-zA-Z]*n' ; then echo 'Hatstand blocks skipping git hooks, because they keep client data out of commits.' >&2; exit 2; fi`;

function statusHook(state: SessionState | typeof WAITING_AT_PROMPT) {
  return {
    hooks: [{ type: 'command', command: `printf ${state} > "$${STATUS_FILE_ENV}"` }],
  };
}

const activityHook = {
  hooks: [{ type: 'command', command: `awk 1 >> "$${ACTIVITY_FILE_ENV}"` }],
};

export const claudeCode: AgentAdapter = {
  buildLaunch({ account, company, task, sessionId, resume, promptFile, settingsFile, addDirs }) {
    const identity = resume ? ['--resume', sessionId] : ['--session-id', sessionId];
    const args = [
      ...identity,
      '--name',
      `${company.name}: ${task.title}`,
      '--append-system-prompt-file',
      promptFile,
      '--settings',
      settingsFile,
      ...(account.model ? ['--model', account.model] : []),
      ...(company.skipPermissions ? ['--dangerously-skip-permissions'] : []),
      ...(company.context.mcpConfigFile ? ['--mcp-config', company.context.mcpConfigFile] : []),
      ...(company.context.pluginDir ? ['--plugin-dir', company.context.pluginDir] : []),
      ...addDirs.flatMap((dir) => ['--add-dir', dir]),
    ];
    const env: Record<string, string> = account.configDir ? { CLAUDE_CONFIG_DIR: account.configDir } : {};
    return {
      command: 'claude',
      args,
      env,
    };
  },

  buildStatusSettings() {
    return JSON.stringify({
      permissions: { allow: [`Bash(${STEP_DONE_COMMAND}:*)`, `Bash(${CHECK_PLAN_COMMAND}:*)`] },
      hooks: {
        SessionStart: [activityHook],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: CLEAR_STEP_DONE }] }, statusHook('working')],
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: BLOCK_HOOK_BYPASS_COMMAND }] },
          { matcher: '*', ...statusHook('working') },
          { matcher: 'Agent|Task', ...activityHook },
        ],
        PostToolUse: [{ matcher: '*', ...statusHook('working') }],
        SubagentStart: [activityHook],
        SubagentStop: [activityHook],
        Notification: [
          { matcher: 'idle_prompt', ...statusHook(WAITING_AT_PROMPT) },
          { matcher: 'permission_prompt|elicitation_dialog', ...statusHook('needs-input') },
        ],
        PermissionRequest: [{ matcher: '*', ...statusHook('needs-input') }],
        Stop: [statusHook('idle'), activityHook],
      },
    });
  },
};
