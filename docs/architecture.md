# Architecture

Hatstand is an Electron app. The main process owns all data, secrets and terminals. The renderer is React, sandboxed, and reaches the main process through one typed bridge.

```
src/shared     Zod schemas with inferred types, and the API contract
src/main       store, secrets, sessions, guard, trackers, agents
src/preload    the bridge exposed to the renderer
src/renderer   Today, task panel, client settings, agents
```

## Model

- **Company** (shown as client): subdomains, projects, context, default account.
- **Task**: belongs to a company, with an optional subdomain, project and account. Its notes live next to it.
- **Session**: one agent process for a task. Tasks and sessions are separate, so a task can have many sessions over time.
- **Account**: owned by the developer. The order is task, then company, then global default.

"Where I was" lives on the task, because conversations from different agents are not interchangeable.

## Adding an agent

Implement `AgentAdapter` in `src/main/agents`: how to launch or resume it with client context, and how it reports status. Add its type to `accountSchema` and to `adapters` in `sessions.ts`.

## Session status

Claude Code hooks, passed with `--settings`, write the state to the file in `HATSTAND_STATUS_FILE`. The main process polls that file. No file is added to the repository.

## Task finished

The agent reports `done` in the `## Status` section of the task notes. That is a claim and it never closes the task.

`finishedWork` in `src/shared/task-finish.ts` works out at read time whether a task is ready to close. It uses the report of the agent, the pull requests, and the facts `ReviewMonitor` reads from git for each copy: whether the branch has its own commits, is in the main branch, and is clean. Code always decides over the report.

Reopening a closed task writes `in progress` in its notes, so an old report does not mark it as finished again.

## Agent environment

`buildAgentEnv` starts from a short allowlist rather than the app's environment, then adds the keys of that client. Keys of other clients and anything else in the app's environment do not reach the agent.

## Platforms

Hatstand runs on macOS, and on Linux as an experiment. Windows is not supported. Keep platform checks small and close to what they guard, and pass the platform in as a value so tests can cover both.

- **Keys:** `canEncryptSafely` in `src/main/secrets.ts` refuses Linux's fallback to a fixed password.
- **Shortcuts:** `src/renderer/src/lib/shortcuts.ts` uses ⌘ on macOS and Ctrl+Shift elsewhere. Linux has no application menu, because Electron's default one takes Ctrl+Shift+I.
- **Installing the app:** `scripts/install-app.mjs` and `scripts/release.mjs` are for macOS only, and `canInstallRelease` hides the update button elsewhere.
- **Terminals:** `node-pty` ships binaries for macOS and compiles when you install on Linux.

## Sessions end with the app

Terminals are child processes of the app, so quitting stops them. Reopening a task offers to resume the same conversation with `--resume`. A detached terminal host is future work.

## Credits

The design learned from reading these Apache-2.0 and MIT projects: [Emdash](https://github.com/generalaction/emdash) (agent capability declarations, per-project accounts, `safeStorage`), [agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) (agent interface, derived state) and [Mission Control](https://github.com/CiprianSpiridon/herdr-mission-control) (separating a connection from where it is used). No code was copied from them.
