# Task: flexible, ordered client configuration and onboarding

Status: draft, revision 3 (see [Revisions](#revisions))
Type: design and migration plan. It describes the implementation in enough detail to build it, but this task does not change code.

## Contents

1. [Goal](#1-goal)
2. [What we want, in one page](#2-what-we-want-in-one-page)
3. [How it works today](#3-how-it-works-today)
4. [Problems to solve](#4-problems-to-solve)
5. [What we take from Backstage and Claude Code](#5-what-we-take-from-backstage-and-claude-code)
6. [Backend design](#6-backend-design)
7. [Frontend design](#7-frontend-design)
8. [Migration plan](#8-migration-plan)
9. [Delivery in phases](#9-delivery-in-phases)
10. [Tests](#10-tests)
11. [Rules that do not change](#11-rules-that-do-not-change)
12. [Decisions for the person](#12-decisions-for-the-person)
13. [Done when](#13-done-when)
14. [Revisions](#revisions)

## 1. Goal

Someone who has never used Hatstand can add a client and start a first task in about two minutes, answering three questions and typing no path. After that:

- every folder and file the client uses is visible on one screen, with its state;
- the settings live in one readable, versioned YAML file per client, which a person can also edit by hand;
- settings combine in a fixed, visible order: Hatstand, then client, then area, then repository;
- existing clients move to the new format on their own, with a backup, without any file being moved.

## 2. What we want, in one page

| Today | After this task |
|---|---|
| `company.yaml` mixes the person's choices with facts Hatstand records | `client.yaml` holds only choices. `state.json` holds facts. |
| Folders are set in four different ways (`context.*`, `planning`, `rootDir`, `projects[].path`) | One `locations` section, one resolver, one screen |
| No version on any file | `apiVersion: hatstand/v2` and `kind: Client`, with migrations written on purpose |
| Folder changes go through `saveCompany` with no path checks | `setLocation` checks every path in the main process |
| The agent's settings have no layers and no explanation | Hatstand, client, area and repository layers, with written merge rules and an "Agent gets" screen that shows where each value comes from |
| A 13-step wizard is the first thing a new client sees | Three questions to start, then a setup checklist the person finishes when they need it |
| "LLM config", "plugin", "MCP" and absolute paths in the interface | Plain names, folder pickers, and defaults filled in |

## 3. How it works today

### 3.1 Files and folders

Everything is under the data folder (`HATSTAND_HOME`, `~/.hatstand` by default). The paths are defined in `src/main/paths.ts:63-115`.

| What | Where | Format | Class |
|---|---|---|---|
| Accounts and the default account | `accounts.yaml` | YAML, `accountsFileSchema` | Choice |
| App preferences | `preferences.yaml` | YAML, `preferencesSchema` | Choice |
| Client | `companies/<id>/company.yaml` | YAML, `companySchema` | Mixed (see 3.2) |
| Keys | `companies/<id>/secrets.enc` | JSON encrypted with `safeStorage` | Client data |
| Instructions | `companies/<id>/instructions.md` or `context.instructionsFile` | Markdown | Client data |
| Knowledge | `companies/<id>/knowledge` or `context.knowledgeDir` | Any files | Client data |
| Agent setup (skills, agents, commands, hooks) | `companies/<id>/plugin` or `context.pluginDir` | Claude Code plugin | Client data |
| MCP servers | `context.mcpConfigFile` (no default) | JSON | Client data |
| Guides | `companies/<id>/playbooks/*.yaml` | YAML, `playbookSchema` | Choice |
| Area files | `companies/<id>/areas/<folder>/` (`Instructions.md`, `Notes.md`, `Tips.md`) | Markdown | Client data |
| Planning | `planning.path`. Default `<client folder or the parent of its git root>/<id>-planning`. The unused default is `companies/<id>/planning` | Git repository | Client data |
| Client folder | `rootDir`. Default from `defaultClientFolder` | Folder | Choice |
| Repositories | `projects[].path` | Git repositories | Choice |
| Tasks | `companies/<id>/tasks/` (`<id>.json`, `.md`, `.feedback.md`, `.<name>.md`, `plans/`), `task-counter` | JSON and Markdown | State and client data |
| Leak guard | `guard/<id>.json`, and `.git/hooks/pre-commit` in each work repository | JSON | Derived |
| Git identity | The client's own gitconfig, plus an `includeIf.gitdir` rule in `~/.gitconfig` | gitconfig | Choice, applied outside |
| Sessions and runtime | `sessions/`, `run/`, `worktrees/<id>/<task>/`, `tools/` | Various | State |
| Backups and removed clients | `backups/`, `removed/` | Copies | State |

### 3.2 `companySchema`, field by field

Source: `src/shared/schemas.ts:144-169`. **C** means the person chose it, **S** means Hatstand recorded it, and **D** means it is derived from something else.

| Field | Written by | Class | Goes to |
|---|---|---|---|
| `id` | `createCompany` (slug of the name) | S | `client.yaml` `metadata.id` (fixed) |
| `name`, `color` | NewClientForm, IdentityStep | C | `client.yaml` `metadata` |
| `photo.sourceUrl` / `type`, `savedAt` | `setClientPhoto` | C / S | `metadata.photo` / `state.json` |
| `rootDir` | RepositoriesStep, RepoFolderImport, `resetClientFolder`, `addClonedProject` | C | `locations.clientFolder` |
| `defaultAccountId` | AgentChoice, AgentStep | C | `spec.defaults.account` |
| `defaultPlaybookId` | GuidesStep | C | `spec.defaults.guide` |
| `origin` | `createCompany` | S | `state.json` |
| `hasCode` | IdentityStep | C | `spec.hasCode` |
| `confirmedSteps` | SetupWizard | S | `state.json` |
| `gitSource` | `connectGitSource` | C | `spec.gitSource` |
| `skipPermissions` | AgentChoice | C | `spec.agent.skipPermissions` |
| `assistantRun` | AssistantRunSettings | C | `spec.assistantRun` |
| `protectedPaths` | `guardStatus`, `installGuard` (a copy of the hooks' state) | D | `state.json` |
| `subdomains[]` | Areas step, AreaPage, Hub, AreaCreator | C (the `folder` is S) | `spec.areas[]` |
| `defaultAreaId` | `withCoreArea` | S | `state.json` |
| `projects[]` | `addClonedProject`, RepoFolderImport, ProjectTable | C (the `id` is S) | `spec.repositories[]` |
| `context.knowledgeDir`, `pluginDir`, `instructionsFile`, `mcpConfigFile` | SetupWizard (ActiveFolder, FileField), `addStarterFiles` | C | `locations.*` |
| `planning.path`, `planning.places[]` | `setPlanningRepo`, `createPlanningRepo`, PlanningStep | C (places are suggested first) | `locations.planning`, `spec.planningPlaces[]` |
| `pastFolders[]` | `withFolderHistory` inside `saveCompany` | S | `state.json` |
| `links[]` | SetupWizard, ClientHubPage | C | `spec.links[]` |
| `workPeriod` | ClosedPage | C | `spec.workPeriod` |
| `gitIdentity` / `appliedAt` | `applyGitIdentity` | C / S | `spec.gitIdentity` / `state.json` |
| `archivedAt` | `archiveClient`, `restoreClient` | S | `state.json` |

Facts that `Store.snapshot()` (`src/main/store.ts:124-143`) works out and never stores: `localKnowledge`, `localPlugin`, `starterInstructions` and `clientFolders`.

### 3.3 Writes and checks

- `writePrivateFile` (`store.ts:52-58`) writes atomically: a temporary file with mode 0600, then a rename. Guides are the exception and use a plain `writeFileSync` (`playbooks.ts`).
- `saveCompany` (`store.ts:317-325`) does several things:
  - parses with Zod;
  - adds the Core area (`withCoreArea`);
  - records past folders (`withFolderHistory`);
  - names area folders (`placeAreaFolders`) and renames old folders;
  - writes the YAML;
  - creates the area starter files;
  - writes the "folder not in use" note into the default folder's `README.md` (`syncFolderPointers`).
- Folder changes have no handler of their own. The renderer sends the whole client to `saveCompany` (`index.ts:265`), so a custom folder inside git only produces a warning in the interface (`ActiveFolder.tsx:33`).
- Path rules (`paths.ts`):
  - `assertOutsideGit` runs only on the data folder, at startup.
  - `prepareCloneDir` checks the folder for downloads and for the client folder.
  - `resolveUserPath` checks only the paths typed in `PathPicker`.
  - `planningConflict` checks the planning repository.

### 3.4 What reaches the agent

`launch` in `src/main/sessions.ts:189-268` passes these:

- **Account:** `task.accountId`, then `company.defaultAccountId`, then the global default (`resolveAccount`). The account brings `configDir` (`CLAUDE_CONFIG_DIR` / `COPILOT_HOME`) and `model`.
- **Folders the agent can read** (`addDirs`): the knowledge folder, the task's area folder, the agent setup folder, the repositories and planning when they are outside the working folder, `tasks/`, and the task copies folder.
- **Agent setup:** `context.pluginDir`, or the default `plugin/` if it has files (`sessions.ts:230`). This becomes `--plugin-dir`, and `context.mcpConfigFile` becomes `--mcp-config` (Claude Code) or `--additional-mcp-config` (Copilot).
- **Prompt** (`task-prompt.ts:171-228`), in this order:
  1. the client and repositories;
  2. the task;
  3. the area, which points to `Instructions.md` and `Tips.md`;
  4. the client's links, then the area's links;
  5. the notes rules;
  6. knowledge;
  7. code;
  8. git identity;
  9. planning;
  10. the guide;
  11. the client's instructions, last.
- **Environment** (`env.ts` `buildAgentEnv`): a short allowlist, `PATH` with `tools/`, the client's keys, then git and Hatstand variables.

The layers that exist today, in practice:
- the account (global);
- the client (plugin, MCP, instructions, knowledge, keys, identity, permissions);
- the area (one more knowledge folder, its files and links).

Nothing is merged: each setting has a single value. The repository adds nothing of its own, because whatever is inside the repository is the repository's business.

### 3.5 Existing migrations

- **`area-migration.ts`:** runs at startup for every client, before `ensureClientFolders`. It backs up to `backups/folders-<stamp>/<id>/`, saves, moves `projects/` into `areas/core/`, and numbers and places tasks. If it fails, the client goes into `unmigrated` and is skipped.
- **When Zod reads a file:**
  - `fromFolderLists` takes `knowledgeDirs` and `pluginDirs` and keeps the first item.
  - `confirmedSteps` renames `'skills'` to `'llm-config'`.
- **When tasks are read:**
  - `projectId` becomes `projectIds`.
  - Tasks get a number and an area.
- No file has a version.

### 3.6 Interface

- **NewClientForm:** asks for a name and an origin (`scratch` or `existing`). It then opens **SetupWizard**, which is the same screen as "Client settings". It has 13 steps (`lib/setup-steps.ts:4-18`): name, agent, repositories, areas, planning, llm-config, knowledge, keys, links, identity, protection, guides and review.
- **Readiness** (`shared/readiness.ts`):
  - Only `workspace` is required (a client folder, a repository or an area).
  - Recommended: knowledge, llm-config, tracker, protection and identity.
  - Planning, Agent and Guides never show a check mark.
- **Folders after onboarding:**
  - `ActiveFolder` covers knowledge, llm-config and planning.
  - `rootDir` appears only in the Repositories step, and never for a client without code.
  - The `companies/<id>` folder is never named in the interface.
- **Duplicate controls:**
  - areas, in four places (the wizard, the Hub, AreaCreator and SubdomainSuggestions);
  - links, in two places (the wizard and the Hub);
  - accounts, in two places (AgentStep and Settings);
  - three ways into planning, within a single step.
- **Typed paths:**
  - "Download to" (`RepoSelection.tsx:112`);
  - the planning folder (`PlanningStep.tsx:107`);
  - the identity folder (`GitIdentityStep.tsx:68`);
  - "Or paste the full path" in every `PathPicker`.
- **Technical wording:** "LLM config", "plugin", "skills/<name>/SKILL.md", "MCP config file", "pre-commit hook", "env file", "subdomain", "read_api and write_repository".
- **Guides:** can only be edited as YAML, in an outside editor.
- **State management:** `useSnapshot` reloads everything when the window gets focus and on `state-changed`. There is no router: `View` in `App.tsx`. The wizard step is local state.

## 4. Problems to solve

1. **No single list of places.** `activeKnowledgeDir`, `activePluginDir`, `activePlanning`, `activeFolder`, `customFolder`, `clientRoots` (`client-files.ts`), `buildFingerprints` (`guard/service.ts`) and `launch` (`sessions.ts`) each rebuild part of the list in their own way.
2. **Choices and state in one file.** A person who edits `company.yaml` can break `pastFolders` or `protectedPaths` without knowing it. A downgrade, or a hand edit, loses facts.
3. **Folder changes have no checks in the main process.** The rule that client data stays out of git is only a warning in the interface.
4. **There are no files with a version.** Every format change ends up as another preprocess hidden in Zod.
5. **The layers are not explicit.** No one can see what the agent will receive for a task, or which layer each value comes from.
6. **Places spread across the computer.** Each default lives in a different place: the data folder, the client folder, or the parent of a git root.
7. **The first time is heavy.** 13 steps, technical words and typed paths.

## 5. What we take from Backstage and Claude Code

Sources: [Backstage, Writing configuration](https://backstage.io/docs/conf/writing), [Defining configuration](https://backstage.io/docs/conf/defining), [Descriptor format](https://backstage.io/docs/features/software-catalog/descriptor-format), [Claude Code settings](https://code.claude.com/docs/en/settings).

| Pattern | Source | In Hatstand |
|---|---|---|
| Envelope `apiVersion`, `kind`, `metadata`, `spec` | Backstage descriptors | `client.yaml` with `apiVersion: hatstand/v2`, `kind: Client`. The version drives migrations. |
| Locations that point to data kept elsewhere | Backstage `Location` | `spec.locations`: one entry per role, a relative or absolute path, and an optional `presence: optional`. |
| A schema for each part, merged together and checked at startup | Backstage `configSchema` | One Zod schema per section, in `src/shared/config/`. The client is checked on every read. |
| Visibility `secret` | Backstage `@visibility` | Keys are named in `spec.keys` and never written as values. Their values stay in `secrets.enc`. |
| References `$file` | Backstage includes | Instructions and MCP are paths, not content, as they are today. `$include` and `$env` are not needed. |
| `config:check` and `config:print` | Backstage CLI | The "Where things are" and "Agent gets" screens, plus `validateClientConfig`. |
| Single values: the higher level wins. Lists: combined. Objects: merged. | Claude Code `settings.json` (Backstage replaces whole lists) | The layer rules in 6.4. Lists are combined so that an area adds to the client without repeating it. |
| A local file outside git | Claude Code `settings.local.json` | The client file stays in the data folder, which `assertOutsideGit` already protects. |

We leave out Backstage's plugin system, remote URLs as sources, the catalog database, and overrides from `APP_CONFIG_*` environment variables.

## 6. Backend design

### 6.1 Folder structure

```
~/.hatstand/                       data folder, checked outside git (no change)
  settings.yaml                    NEW, kind: Settings. Hatstand layer and preferences.
  accounts.yaml                    no change
  companies/<id>/
    client.yaml                    NEW, kind: Client. Only the person's choices.
    state.json                     NEW. Facts Hatstand records. Not edited by hand.
    secrets.enc                    no change
    instructions.md, knowledge/, plugin/, playbooks/, areas/, tasks/   defaults, no change
  backups/config-v2-<stamp>/<id>/  NEW, migration backup
```

- `settings.yaml` replaces `preferences.yaml`: same fields, plus `agentDefaults` (see 6.4).
- `accounts.yaml` stays on its own because it holds per-client accounts.
- No client folder moves. Default folders keep their current paths.

### 6.2 `client.yaml` (v2)

A made-up example:

```yaml
apiVersion: hatstand/v2
kind: Client
metadata:
  id: acme
  name: Acme
  color: '#3b82f6'
  photo: { sourceUrl: https://example.com/logo.png }
spec:
  hasCode: true
  locations:
    clientFolder: ~/clients/acme
    knowledge: ~/clients/acme/knowledge     # missing = default in the data folder
    agentSetup: ~/clients/acme/agent-setup
    instructions: ~/clients/acme/instructions.md
    tools: ~/clients/acme/mcp.json          # MCP
    planning: ~/clients/acme/acme-planning
  defaults:
    account: work-claude
    guide: implementation
  gitSource: { provider: github, owner: acme }
  gitIdentity: { name: Ana Dev, email: ana@example.com, folder: ~/clients/acme }
  keys: [JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN]  # expected names, never values
  agent:
    skipPermissions: false
    knowledge: []                           # extra folders, added to locations.knowledge
  assistantRun: { parallel: 2, stopAt: commit }
  workPeriod: { every: 2, unit: weeks, startsOn: 2026-01-05 }
  links:
    - { label: Board, url: https://example.com/board }
  repositories:
    - id: r-api
      name: api
      path: repos/acme/api                  # relative to clientFolder
      area: payments
      splitByFolder: true
      agent:
        instructions: ~/clients/acme/notes/api.md
  areas:
    - id: payments
      name: Payments
      folder: payments
      description: Charges and refunds.
      folders: [{ repo: r-api, path: services/payments }]
      links: []
      agent:
        knowledge: [~/clients/acme/knowledge/payments]
  planningPlaces:
    - { name: Specs, folder: specs }
```

Decisions behind the format:

- **Paths can be relative.** A relative path resolves against `locations.clientFolder`, as a Backstage `Location` resolves against its own file. Moving the client folder then means changing one line. Absolute paths and paths starting with `~` still work.
- **Missing means the default.** That keeps the file short. The resolver says in each case whether the value is the default or a custom one.
- **Names in the file and in the interface.** `agentSetup` replaces `pluginDir` and `tools` replaces `mcpConfigFile`. The internal names stay in the code until phase 3.
- **Ids are written into the file.** Areas and repositories keep their `id`, so tasks keep pointing at them. `area` uses the area's id.
- **Hand comments are kept.** The writer uses `yaml`'s `parseDocument` and `Document`, not `stringify`, so comments a person added by hand survive a save from the interface.

### 6.3 `state.json`

```json
{
  "version": 1,
  "origin": "existing",
  "defaultAreaId": "a-core",
  "confirmedSteps": ["knowledge"],
  "pastFolders": [{ "section": "knowledge", "path": "/old/path", "leftAt": "2026-03-01T10:00:00Z" }],
  "protectedPaths": ["/home/ana/clients/acme/repos/acme/api"],
  "photo": { "type": "image/png", "savedAt": "2026-03-01T10:00:00Z" },
  "gitIdentityAppliedAt": "2026-03-01T10:00:00Z",
  "archivedAt": null
}
```

- JSON, so no one is tempted to edit it.
- If the file is missing or broken, it is rebuilt from the defaults and the client still opens. Everything in it can be recovered:
  - `protectedPaths` from the hooks;
  - `defaultAreaId` from `withCoreArea`;
  - the rest is history that can be lost.

### 6.4 Layers and merge rules

The order is Hatstand, then client, then area, then the task's repositories. A higher layer wins.

| Setting | Hatstand (`settings.yaml` `agentDefaults`) | Client | Area | Repository | Rule |
|---|---|---|---|---|---|
| Account | `defaultAccountId` (accounts.yaml) | `defaults.account` | — | — | The higher one wins. The task can override it (`task.accountId`). |
| Allow without asking | `skipPermissions` | `agent.skipPermissions` | — | — | The higher one wins. |
| Instructions | `instructions` (file) | `locations.instructions` | `areas/<folder>/Instructions.md` | `repositories[].agent.instructions` | Combined in this order, each under its own heading in the prompt. |
| Knowledge | — | `locations.knowledge` + `agent.knowledge[]` | `areas/<folder>` + `areas[].agent.knowledge[]` | `repositories[].agent.knowledge[]` | List: combined without duplicates. |
| Agent setup (plugin) | `agentSetup` | `locations.agentSetup` | `areas[].agent.agentSetup` | — | List: one `--plugin-dir` for each. |
| Tools (MCP) | `tools` | `locations.tools` | `areas[].agent.tools` | — | List: one flag for each file. |
| Links | — | `links[]` | `areas[].links[]` | — | List: combined, client first (as today). |
| Keys | — | `secrets.enc` | — | — | Only the client's. They are never inherited from another layer. |

- A value of `null` in a layer turns off what comes from below. For example, `agentSetup: null` in an area means that area does not use the client's plugin.
- **Check before building:** whether `claude` accepts `--plugin-dir` and `--mcp-config` more than once, and whether `copilot` accepts `--plugin-dir` and `--additional-mcp-config` more than once. If one does not, Hatstand combines the folders into `run/<session>/agent-setup/` for that session.
- The global `instructions` and `agentSetup` are new. They let a person keep their own way of working for every client without copying it.

One pure function decides all of this:

```ts
// src/shared/config/agent-setup.ts
type Layer = 'hatstand' | 'client' | 'area' | 'repository';
type Sourced<T> = { value: T; layer: Layer; file: string };
type AgentSetup = {
  account: Sourced<string>;
  skipPermissions: Sourced<boolean>;
  instructions: Sourced<string>[];
  knowledge: Sourced<string>[];
  agentSetup: Sourced<string>[];
  tools: Sourced<string>[];
  links: Sourced<ClientLink>[];
};
export function resolveAgentSetup(input: { settings: Settings; client: ClientFile; areaId?: string; repositoryIds: string[]; taskAccountId?: string }): AgentSetup;
```

`launch` and the "Agent gets" screen use the same function, so the screen always shows what the agent actually receives.

### 6.5 The location resolver

```ts
// src/main/locations.ts
type LocationRole = 'clientFolder' | 'knowledge' | 'agentSetup' | 'instructions' | 'tools' | 'planning' | 'guides' | 'areas' | 'repository';
type LocationProblem = 'missing' | 'inside-git' | 'inside-data-folder' | 'not-a-plugin' | 'not-a-git-repository' | 'empty';
type ResolvedLocation = {
  role: LocationRole;
  label: string;            // "Client documents", in plain language
  path: string;             // absolute
  source: 'default' | 'custom';
  kind: 'directory' | 'file';
  exists: boolean;
  files: number;            // countFolderFiles, at most 2000
  problems: LocationProblem[];
  ownerId?: string;         // repository or area
};
export function resolveLocations(paths: DataPaths, client: ClientFile): ResolvedLocation[];
```

These callers move to the resolver:

- `active-folders.ts`;
- `clientRoots` in `client-files.ts`;
- `buildFingerprints` in `guard/service.ts`;
- `launch` in `sessions.ts`;
- `clientFolders` in `snapshot()`;
- `defaultPlanningFolder` in `planning-repo.ts`.

The checks for each role:

| Role | Must exist | Outside git | Outside the data folder | Other |
|---|---|---|---|---|
| clientFolder | No (it is created) | Yes | Yes | — |
| knowledge, agentSetup, instructions, tools | No (warning) | Yes, **blocks** saving | Only when custom | agentSetup: `looksLikePlugin`, as a warning |
| planning | Yes | Must be its own git repository | Yes | `planningConflict` |
| repository | Yes | Must be a git repository | Yes | — |

### 6.6 Main-process API

New, or changed, in `src/shared/api.ts`:

```ts
getClientMap(companyId): Promise<ResolvedLocation[]>;
setLocation(companyId, role: LocationRole, path: string | null): Promise<ResolvedLocation>; // null = default
explainAgentSetup(companyId, { areaId?, repositoryIds? }): Promise<AgentSetup>;
validateClientConfig(companyId): Promise<ConfigProblem[]>;
openClientConfig(companyId): Promise<void>;   // opens client.yaml in the editor
```

- **`setLocation`** replaces folder changes through `saveCompany`. It:
  - checks the path with the rules in 6.5;
  - records the old folder in `state.json` (`pastFolders`);
  - updates the README note (`syncFolderPointers`);
  - refreshes the guard's fingerprints.

  It replaces the role of `resetClientFolder` and `setPlanningRepo`. Those two stay for one release as wrappers.
- **`saveCompany`** keeps accepting `Company` (see 6.7). It refuses changes to `context.*`, `planning.path` and `rootDir` and asks for `setLocation`, so no path can get past the checks.
- **`ConfigProblem`** is `{ path: string; line?: number; message: string }`. Each message is in plain language, for example: "spec.areas[1].folder: use lowercase letters, numbers and dashes".

### 6.7 Read, write, and the `Company` type

To keep the renderer from being rewritten in one go, the `Company` type stays as the internal model, and two adapters convert to and from it:

```ts
// src/main/client-config.ts
readClient(paths, id): { company: Company; problems: ConfigProblem[] };
writeClient(paths, company: Company): void;   // splits into client.yaml + state.json
toCompany(file: ClientFile, state: ClientState): Company;
fromCompany(company: Company): { file: ClientFile; state: ClientState };
```

- `Store.readCompany` and `Store.saveCompany` call these. The renderer does not notice the change until phase 3.
- **Round trip:** `toCompany(fromCompany(c))` returns `c` for every valid client. A property test checks this, and the migration relies on it (8.3).
- **A broken file:** `readClient` keeps the last good version in memory, marks the client `configProblems`, and **does not write** until the file is valid again. The interface shows a banner (7.6). The problems come from parsing with `parseDocument`, which reports the line.
- **Hand edits:** the snapshot already reloads when the window gets focus. `readClient` compares the file's `mtime` with the last read.

### 6.8 Schemas

New files in `src/shared/config/`:

- `client-file.ts`: `clientFileSchema` with `apiVersion: z.literal('hatstand/v2')`, `kind: z.literal('Client')`, and `metadata` and `spec` built from the existing pieces (`subdomainSchema` becomes `areaSchema`, plus `clientLinkSchema`, `gitSourceSchema`, `workPeriodSchema` and `assistantRunSchema`).
- `client-state.ts`: `clientStateSchema`.
- `settings-file.ts`: `settingsFileSchema` (kind: Settings), which includes `preferencesSchema` and `agentDefaults`.
- `agent-setup.ts`: `resolveAgentSetup`, pure, with no `fs`.
- `upgrade.ts`: `upgradeV1(raw: unknown): { file: ClientFile; state: ClientState }`. It applies `fromFolderLists`, the `skills` rename and the rest in one known place.

Types are inferred with `z.infer`. There is no `any`.

## 7. Frontend design

### 7.1 Principles

- **Three questions to start, then a checklist.** Everything has a working default. No step blocks anything except "Where is the work?".
- **The person never has to type a path.** Every path comes with a default filled in and a native picker. Pasting a path stays available behind "Paste a path".
- **The same words everywhere.**

| Today | New |
|---|---|
| LLM config | Agent setup |
| plugin, skills/…/SKILL.md | Skills and commands for the agent |
| MCP config file | Agent tools (MCP) |
| Knowledge | Client documents |
| pre-commit hook | Commit protection |
| env file | Keys file (.env) |
| subdomain | area |

- **Areas, links and accounts are edited in one place each.** Other screens link to that place.

### 7.2 First time (new client)

`NewClientForm` becomes `NewClientFlow`, with three screens:

1. **"What is this client called?"** Name. The color is picked on its own. Logo is optional.
2. **"Where is the work?"** Three choices:
   - **Download from GitHub or GitLab:** this uses `GitConnectionForm` and `RepoSelection`. The download folder comes filled in with `~/clients/<id>`, and "Change" opens the picker.
   - **It is already on this computer:** a folder picker, then `scanRepos`, with every repository found already checked.
   - **There is no code:** this sets `hasCode: false` and creates the default area.
3. **"Which agent?"** This uses `AgentChoice`: it shows the default account, offers "Sign in" if the agent is not set up, and links to "Add an account only for this client".

Then comes **"Ready"**. It shows a summary of the client map (7.4), a "New task" button, and a "Finish setup" link that opens the checklist.

- `origin` stays in `state.json`. It only changes the default chosen in screen 2.
- The client is created on screen 1 (`createCompany`), so leaving halfway leaves a client that still works. That is the case today too.

### 7.3 Client settings: a checklist instead of a wizard

`SetupWizard` becomes `ClientSetupPage`. The same 13 sections are grouped into five groups, and the `Review` step disappears, because the page itself is the review:

| Group | Sections | Readiness item |
|---|---|---|
| Basics | Name and logo, Agent | — |
| Work | Where things are (7.4), Repositories, Areas, Planning | `workspace` (required) |
| Agent | Agent setup, Client documents, What the agent gets (7.5), Task guides | `knowledge`, `llm-config` |
| Tools and keys | Keys, Links | `tracker` |
| Safety | Commit identity, Commit protection | `identity`, `protection` |

- **What the page shows:**
  - each group with its state ("Ready", "1 thing to check" or "Optional"), opening on the first group that has something pending;
  - the `ReadinessBadge` stays on TodayPage.
- **Continue and defaults:**
  - "Continue" never does anything silently.
  - Accepting a default is a visible "Use this folder" button.
  - `confirmedSteps` keeps recording the choice.
- **Steps that now show a check mark:**
  - Planning: when a planning repository exists or the person chooses "No planning repository".
  - Agent: when the account is signed in.
  - Guides: when the default guide is chosen, or "Built-in guides" is accepted.
- **Duplicates are removed:**
  - Areas are edited only in the client's Areas tab, and the Areas section links there.
  - Links are edited only in Settings, and the Hub shows them read-only.
  - `AreaCreator` and `SubdomainSuggestions` move to the Areas tab.

### 7.4 "Where things are"

The new component is `ClientMap.tsx`, with one `ClientMapRow.tsx` per place. Its hook is `hooks/useClientMap.ts`, and it gets its data from `getClientMap`.

```
Where things are                               [Open settings file]
------------------------------------------------------------------
Client folder        ~/clients/acme                    Ready   [Open] [Change]
Repositories         3 in ~/clients/acme/repos         Ready   [Manage]
Client documents     ~/clients/acme/knowledge          Ready   [Open] [Change] [Use default]
Agent setup          Default (Hatstand folder)          Empty   [Open] [Change]
Agent tools (MCP)    Not set                           Optional [Choose file]
Instructions         ~/clients/acme/instructions.md    Ready   [Edit]
Planning             ~/clients/acme/acme-planning      No backup: no remote  [Open]
Task guides          4 built-in, 1 for this client     Ready   [Manage]
------------------------------------------------------------------
Used before: 2 folders                                          [Show]
```

- **States:**
  - Ready.
  - Empty.
  - Missing: "This folder no longer exists. [Choose another] [Use default]".
  - Inside a git repository: "Client documents would end up in git. Choose a folder outside the repository." This one blocks saving.
- **Changing a folder:**
  - "Change" uses the existing `useFolderSwitch` and `FolderSwitchWarning`, which say "Nothing is moved or deleted".
  - "Used before" uses `PastFolders`.
- **No technical words:** the path is shown with `~`. The data folder is called "Hatstand folder".

### 7.5 "What the agent gets"

The new component is `AgentSetupExplain.tsx`, with the hook `hooks/useAgentSetupExplain.ts`.

- It has a picker for an area, plus optional repositories.
- It shows one row for each value, with a chip for its layer ("Hatstand", "Client", "Area: Payments", "Repository: api") and a link to the file.
- It answers "why did the agent read this?", which today requires reading the code.
- The task panel shows the same view, under "What the agent got", for the task's own area and repositories.

### 7.6 The settings file

- **"Open settings file"** opens `client.yaml` in the editor (`openClientConfig`).
- **`SettingsFileBanner.tsx`** appears when `validateClientConfig` returns problems:

  "The settings file for Acme has a problem on line 14: spec.areas[1].folder must use lowercase letters, numbers and dashes. Hatstand will not save changes for this client until it is fixed. [Open settings file]"

- Saving from the interface keeps the person's comments (6.2).

### 7.7 Renderer files

| New | Changed | Removed or merged |
|---|---|---|
| `NewClientFlow.tsx`, `WorkLocationStep.tsx`, `ReadyStep.tsx` | `NewClientForm.tsx` (to `NewClientFlow`) | — |
| `ClientSetupPage.tsx`, `SetupGroup.tsx` | `SetupWizard.tsx` (its sections are reused), `lib/setup-steps.ts` (groups) | The `review` step |
| `ClientMap.tsx`, `ClientMapRow.tsx`, `hooks/useClientMap.ts` | `ActiveFolder.tsx` (calls `setLocation`), `hooks/useFolderSwitch.ts` | — |
| `AgentSetupExplain.tsx`, `hooks/useAgentSetupExplain.ts` | `TaskPanel.tsx` (adds the view) | — |
| `SettingsFileBanner.tsx` | `ClientTabs.tsx` | Area editing in `ClientHubPage.tsx` |
| — | Copy in `SetupWizard.tsx`, `RepoFolderMap.tsx`, `SecretsSection.tsx`, `GitConnectionForm.tsx`, `CommitProtection.tsx`, `DocumentsPage.tsx` | — |

One component per file. Hooks go in `hooks/`. Errors show through `useAction`, one per section.

## 8. Migration plan

### 8.1 What moves and what does not

- **Files that change:** `companies/<id>/company.yaml` becomes `client.yaml` plus `state.json`, and `preferences.yaml` becomes `settings.yaml`.
- **Nothing else changes:** no client folder, document, repository, task or key is moved. Every path in use is written as is into `locations`. A default path is not written, so it keeps resolving to the same place.
- **New clients:** only they get the new defaults (decision D1).

### 8.2 When it runs

- It runs in `bootstrap` (`index.ts:127-140`), after `assertOutsideGit` and before `migrateClientFolders`, in the order of the version chain: `v1` to `v2`.
- `area-migration` then runs on the result, unchanged, through `readClient` and `writeClient`.
- The dev copy (`HATSTAND_DEV_COPY`) is migrated too. Run `pnpm dev:sync` first and test there.

### 8.3 Steps for each client (`src/main/config-migration.ts`)

1. **Detect.** If `client.yaml` exists and `company.yaml` does not, the client is already migrated: skip it. If both exist, an earlier migration was cut off: go to step 3.
2. **Back up.** Copy `company.yaml` and `preferences.yaml` to `backups/config-v2-<stamp>/<id>/`, with mode 0700.
3. **Convert.** `old = companySchema.parse(yaml)`, then `{file, state} = upgradeV1(old)`.
4. **Check.** `toCompany(file, state)` must equal `old` field by field. If it does not, stop, leave `company.yaml` as it was, and add the client to `unmigrated` with the field that differs.
5. **Write.** Write `client.yaml` and `state.json` with `writePrivateFile`, which is atomic.
6. **Read back.** `readClient` must return no problems, and the same `Company`.
7. **Retire the old file.** Move `company.yaml` to `company.v1.yaml` in the backup. This is the last step, so if anything fails before it, the client keeps working with the old file.
8. **Report.** Write `{ companyId, backup, from: 'v1', to: 'v2' }` to `backups/config-v2-<stamp>/report.json`.

### 8.4 Guarantees

- **It can run twice.** Step 1 decides from the files, not from a flag.
- **It resumes if it was cut off.** If both files exist, it starts again from the old one, because `company.yaml` is only removed at the end.
- **Dry run.** `node scripts/migrate-config.mjs --home <folder> --dry-run` prints, for each client, what it would write, which fields go to `state.json`, and the problems it finds, and changes nothing. It only accepts a `--home` that is not `~/.hatstand`, unless `--yes-real-data` is passed.
- **Going back.** `node scripts/restore-config.mjs --home <folder> --backup <stamp>` copies `company.yaml` and `preferences.yaml` back and removes `client.yaml`, `state.json` and `settings.yaml`. An earlier version of Hatstand then opens the data as before. The release notes explain this.
- **Fail safe.** If a client fails, the others continue. The failed one opens read-only with the banner "Hatstand could not update this client's settings. Your data is untouched. [Show details]".
- **Reading the old format.** `readClient` still accepts `company.yaml` (v1) during phases 2 and 3, so a restored backup works without migrating again. Phase 4 removes this.

### 8.5 Data that must survive

`upgradeV1` must keep each of these, with a test for each:

- the old `knowledgeDirs` and `pluginDirs` lists;
- the `skills` step;
- tasks with `projectId`;
- areas without `folder`;
- `rootDir` missing;
- a planning folder inside the client folder;
- `pastFolders` with 30 entries;
- per-client accounts;
- a client that is archived.

## 9. Delivery in phases

Each phase is a separate branch, works on its own, and passes `pnpm lint`, `pnpm type-check`, `pnpm test` and `pnpm test:e2e` on macOS and Linux.

| Phase | Content | Format change | Size |
|---|---|---|---|
| 0 | Tests that lock today's behavior: made-up v1 fixtures in `tests/fixtures/clients/` (acme, a client without code, an old client with `knowledgeDirs`), plus a `makeHome()` helper to replace the repeated `mkdtempSync` | No | S |
| 1 | `resolveLocations` and `setLocation`, with checks in the main process. Callers move over. The "Where things are" screen. | No | M |
| 2 | `client.yaml`, `state.json` and `settings.yaml`. The adapters, the migration, the scripts and the banner. | Yes (v2) | L |
| 3 | Layers: `resolveAgentSetup`, area and repository settings, global settings, "What the agent gets". The three-screen onboarding, the checklist and the new copy. | v2 grows | L |
| 4 | Remove reading v1, the `resetClientFolder` and `setPlanningRepo` wrappers, and `fromFolderLists`. | No | S |

Phase 1 already solves problems 1, 3 and 6 without touching the format. If the person wants to stop there, it is useful on its own.

## 10. Tests

### Unit tests (`tests/unit/`)

| File | Covers |
|---|---|
| `locations.test.ts` | Default and custom folders, missing folders, inside git, inside the data folder, relative paths |
| `set-location.test.ts` | Refuses a folder in git, records `pastFolders`, updates the README note, refreshes fingerprints |
| `client-config.test.ts` | Round trip `toCompany(fromCompany(c))`, comments kept, a broken file is not overwritten, `state.json` rebuilt |
| `config-migration.test.ts` | Each case in 8.5, running twice, resuming after a cut, a client that fails while the rest continue, the backup and the report |
| `agent-setup.test.ts` | Each row of the table in 6.4, `null` turning a value off, the order of instructions, lists without duplicates |
| `client-map.test.tsx`, `agent-setup-explain.test.tsx`, `new-client-flow.test.tsx` | Behavior: states, buttons, choosing a folder, the error when inside git |

### End to end (`tests/e2e/`)

- **`onboarding.mjs`** changes the most. It walks through the three screens and "Ready", then the checklist. The following change with it:
  - the headings of the 13 steps;
  - the "Continue" and "Skip for now" buttons;
  - "Download to" and "Folder for the new planning repository";
  - the percentages "83%" and "100%", which now come from the groups.
- **`workspaces.mjs`:** "Setup steps" becomes the groups, and "Planning folder, full path" becomes "Paste a path".
- **`clients.mjs`:** the identity folder comes filled in, and the client's links move to Settings.
- **New `config.mjs`:**
  - an old client in `HATSTAND_HOME` is migrated when Hatstand opens;
  - the map shows its folders;
  - a hand edit with an error shows the banner;
  - fixing the edit makes the banner go away.

All of these run with the window hidden and a throwaway `HATSTAND_HOME`.

## 11. Rules that do not change

- **Client data stays out of git:** knowledge, agent setup, instructions, keys and tasks never go into a git repository. `assertOutsideGit`, the new checks in `setLocation`, and the leak guard all enforce this.
- **No real data in this repository:** no real client names, keys, tickets or internal URLs, including in fixtures and screenshots. Use `acme` and `example.com`.
- **Platforms:** macOS and Linux keep working. Paths go through `node:path`, and no `/` is written into the code.
- **Code:** types inferred from Zod, no `any`, one component per file, and hooks in `hooks/`.
- **Tests:** never against `~/.hatstand`, and no visible window.
- **Keys:** they live only in `secrets.enc`, and `client.yaml` names them without values.

## 12. Decisions for the person

Each one has a recommendation. Phase 1 needs none of them, D2 and D3 must be decided before phase 2, and D1, D4 and D5 before phase 3.

| # | Question | Recommendation | Why |
|---|---|---|---|
| D1 | Where do a new client's default folders go: the Hatstand folder (as today) or `~/clients/<id>/`? | `~/clients/<id>/`, with `knowledge/`, `agent-setup/`, `instructions.md`, `repos/` and `<id>-planning/` inside. Existing clients keep their folders. | Everything for a client is in one folder that is easy to find and back up, which answers "many local origins". The client folder is not a git repository, and that is already checked. |
| D2 | Should `client.yaml` stay in the Hatstand folder, or go into the client folder? | Stay in the Hatstand folder. | It holds paths for this computer, it is next to `secrets.enc`, and it is already protected from git. |
| D3 | Should `accounts.yaml` join `settings.yaml`? | No. | Per-client accounts would complicate the merge, and nothing is gained. |
| D4 | Global settings (instructions and agent setup for every client): now, or later? | Now, in phase 3. | It is the layer missing today, and it costs one row in the table. |
| D5 | Repository settings: only Hatstand's extra instructions and knowledge, or also reading `.claude/` inside the repository? | Only the extras. | The repository's own files are its business, and the agent already reads them. |

## 13. Done when

- `resolveLocations` is the only place that knows where each thing for a client is. The `grep` for `context.knowledgeDir` and `context.pluginDir` outside `client-config.ts` and `locations.ts` returns nothing.
- No path reaches the disk without passing the checks in 6.5.
- A copy of real data, made with `pnpm dev:sync`, migrates without errors. Its backup and its report exist, and `restore-config.mjs` returns it to v1.
- In the e2e test, a new client reaches "New task" with three screens and no typed path.
- The "What the agent gets" screen and `launch` produce the same data, which a unit test compares.
- The decisions in section 12 are answered.

## Revisions

**Revision 1: technical design.** Inventory of every file and of every field in `companySchema`, with who writes it. The v2 format with envelope and `locations`, `state.json`, layers and merge rules, the resolver, the new API, the migration and the screens.

**Revision 2: checked against the code.**
- **The renderer is kept.** `Company` stays as the internal model, behind `toCompany` and `fromCompany`. Without this, phase 2 would have forced a rewrite of the whole renderer.
- **The migration can be undone safely.** It checks the round trip before writing, and removes `company.yaml` as its last step.
- **Hand edits are protected.** `parseDocument` keeps comments, and a broken file is not overwritten. Today `saveCompany` would overwrite it.
- **Paths are checked.** `saveCompany` refuses path changes, because today it lets a folder inside git through.
- **Two facts confirmed in the code:**
  - the default `plugin/` is only used if it has files (`sessions.ts:230`);
  - the default `planning/` is created but no longer used.
- **Open point:** whether both agents accept `--plugin-dir` and the MCP flags more than once.
- **Phase 1 stands on its own.** It is now separate, so it can be delivered without changing the format.

**Revision 3: experience and simplicity.**
- **Onboarding:** reduced to three questions plus "Ready", and the wizard became a checklist in five groups, without the Review step.
- **Wording:** the plain names were fixed in a table so they are the same in every screen.
- **Defaults:**
  - every path has a default filled in;
  - "Continue" no longer accepts things silently;
  - Planning, Agent and Guides can now show a check mark.
- **Duplicates removed:** areas, links and accounts are edited in one place each.
- **Decision D1:** gather a client's default folders under `~/clients/<id>/`. This is only for new clients, so nothing moves.
- **Tests:** the e2e changes are listed, along with the new `config.mjs` suite.
