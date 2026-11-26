# Architecture

Hatstand is an Electron app. The main process owns all data, secrets and terminals. The renderer is React, sandboxed, and reaches the main process through one typed bridge.

```
src/shared     Zod schemas with inferred types, and the API contract
src/main       store, secrets, sessions, services, guard, trackers, agents
src/preload    the bridge exposed to the renderer
src/renderer   Today, task panel, client settings, agents
```

## Main process

`src/main/index.ts` is the composition point. It owns what needs Electron: the windows, the menu, the keychain cipher, dialogs, `shell`, notifications and the IPC registration. It builds the store, the sessions and the review monitor, and hands them to the services.

`src/main/services` holds the handlers of the API, one file per domain. A service receives what it needs as arguments (`ServiceContext` plus its own dependencies) and never imports `electron`, so a unit test builds it from a throwaway store and fakes. `tests/unit/services-composition.test.ts` fails if a service loads Electron or if two services answer the same method.

A handler that opens something on the desktop is split in two: `services/desktop-targets.ts` chooses the folder or file and checks it belongs to the client, and `index.ts` opens it. Add a method to the service of its domain, and to `DESKTOP_METHODS` only when it needs a dialog or `shell`.

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

## Session modules

`SessionManager` in `sessions.ts` owns the terminals (`node-pty`), the map of running sessions, and the one-second timer of each. The rest lives next to it:

- `session-state.ts`: what the agent reports, and the saved state of the session.
- `session-copies.ts`: the copies of the code of a task, and the requests of the agent for a new one.
- `session-guide.ts`: changing the step of a guide, and the steps the agent reports done.
- `session-plan-checks.ts`: the plan checks of a session that plans the backlog.
- `session-env.ts`: the environment the agent starts with.

Polling must stay cheap, because every running session does it every second. A tick that finds nothing new reads no session file, and a change reads only the file of that session (`Store.readSession`), never all of them.

## Changes outside git

Changes reads repositories with git (`git-changes.ts`). What an agent writes anywhere else comes from two sources, joined in one file per task (`outside-changes.ts`, `run/changes/<taskId>.json`):

- **Tool writes.** A `PostToolUse` hook of each adapter adds one line per file to the activity file of the session, with the path and never the content (`agents/file-writes.ts`). They are read when Changes is asked for, so they show while the agent works.
- **Snapshots.** `session-changes.ts` takes a snapshot of the folders the session can write to when the agent starts a turn, and compares it when the turn ends (`folder-snapshot.ts`). This finds files written with shell commands, and new repositories.

A snapshot skips the repositories of the client, heavy folders, and the files Hatstand writes itself, and stops at a file limit. A path inside a repository that git already reports for the task is never listed again. The page can only open or read a path that is in the record of that task.

## Task finished

The agent reports `done` in the `## Status` section of the task notes. That is a claim and it never closes the task.

`finishedWork` in `src/shared/task-finish.ts` works out at read time whether a task is ready to close. It uses the report of the agent, the pull requests, and the facts `ReviewMonitor` reads from git for each copy: whether the branch has its own commits, is in the main branch, and is clean. Code always decides over the report.

Reopening a closed task writes `in progress` in its notes, so an old report does not mark it as finished again.

## Agent environment

`buildAgentEnv` starts from a short allowlist rather than the app's environment, then adds the keys of that client. Keys of other clients and anything else in the app's environment do not reach the agent.

## One-shot agent runs

Some features ask the agent one question and read its answer, with no terminal. They run `claude -p --output-format json` through `execFileRunner` in `src/main/agent-run.ts`, which a test replaces with a fake. `src/shared/agent-output.ts` reads what the run printed.

- **Improve a description** (`description-suggestion.ts`): the agent may read the knowledge, the area and the repositories of the task, and change nothing.
- **Backlog chat** (`backlog-chat.ts`): the agent answers whether work is already done, planned or in progress. It gets the tasks of one client inside the prompt and nothing else: no tool, no MCP server, no folder, no key of the client, and it starts in an empty folder. `buildTaskContext` in `src/shared/backlog-chat.ts` writes that list. The tasks the answer names are matched against the real ones, so a status shown to the person always comes from the task.

## Keys

`SecretStore` in `src/main/secrets.ts` owns two files per client. `secrets.enc` holds names and values, sealed with the system keychain. `keys.yaml` holds what is not secret about each key: when it was saved, a note, and the last check. Saving a new value starts that key over, so a replaced key has no old check.

The renderer never receives a value. It gets `KeyInfo` from `listKeys`, and works out what to show with the pure functions in `src/shared/key-status.ts` and the catalog of known keys in `src/shared/known-keys.ts`.

`checkKey` in `src/main/key-check.ts` asks the provider of a token whether it works and when it expires. A call that fails with a 401 throws `KeyRejectedError`, and the caller marks the key with `noteRejectedKey`. Only a 401 marks a key: any other failure says nothing about it.

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
