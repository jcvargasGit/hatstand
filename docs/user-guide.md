# User guide

What each part of Hatstand does. To install it, see [Getting started](getting-started.md). For what protects your data, and the limits of that protection, see [How Hatstand protects your data](security.md).

## Find your way around

### Finding your way around

Press **⌘K** (Ctrl+Shift+K elsewhere) to search tasks, notes, clients, repositories and client documents across every active client, and to run actions. **⌘N** starts a task, **⌘J** jumps to the next task waiting for you, and **⌘,** opens settings.

In the terminal, **Shift+Enter** adds a new line, **⌘←** and **⌘→** move to the start and end of the line, **⌘⌫** deletes to the start of the line, and web links open with a click.

Drag clients in the sidebar to put them in the order you want, or press Alt with the up and down arrows on a client's name.

**Documents** in each client shows its planning repository, knowledge, skills and guides, with a preview, and opens them in your editor to change them. Files in the planning repository reach git only when they are committed. Knowledge and skills stay outside git.

A task's details list the uncommitted changes in its repositories, so you can read a diff without leaving Hatstand.

On Linux, the shortcuts shown with ⌘ use Ctrl+Shift. The terminal shortcuts with ⌘← and ⌘→ are for macOS, and on Linux your shell has Ctrl+A, Ctrl+E and Ctrl+U.

### Where your data lives

Everything about your clients stays in `~/.hatstand`, outside any repository. Hatstand refuses to start if that folder is inside a git repository. Set `HATSTAND_HOME` to use another location.

```
~/.hatstand/
  accounts.yaml
  companies/<client>/
    company.yaml
    secrets.enc      encrypted with your system keychain
    photo            saved copy of the client's photo
    instructions.md  starter file, for clients started from scratch
    knowledge/       created for every client
    plugin/skills/   created for every client, one folder per skill
    playbooks/       this client's task guides, when you add or customize one
    tasks/
  guard/             hashes only, no client text
  sessions/
  run/
```

Existing knowledge and skills folders can stay where they are. Hatstand passes them to the agent by path and copies nothing into your repositories.

### Stay awake

In **Settings**, choose whether Hatstand keeps the computer awake and the screen unlocked while a session is running, or while the app is open. It is off by default. Closing the lid, locking the screen yourself, or a company security policy can still put the computer to sleep.

## Clients

### Areas and links

Every client has one page with its links: Slack, Jira, GitHub, Confluence, production, staging and anything else you open often.

A client's work is split into areas, such as search or a mobile app. Every task belongs to an area. Each client has a **Core** area for tasks that belong to no other, and it cannot be deleted. Deleting another area moves its tasks to Core.

Each area has the same view as **Documents** for its private notes, instructions and tips, along with its links, tasks and repositories. Its files live in `~/.hatstand/companies/<client>/areas/<area>`, a folder named after the area when it is created, such as `areas/search`. Renaming the area keeps its folder, so sessions that run there can still resume. Agents read its files in its tasks. A client with no repositories works in the private folder of the task's area, so this also suits clients with no code. None of this reaches a repository.

When Hatstand starts, it moves folders made by older versions: areas named by an id get their readable name, and files of the removed client projects (`projects/`) that are not the starter text go to `areas/core/from-old-project-<id>`. It copies what it changes to `~/.hatstand/backups/folders-<date>` first, and does nothing once everything is in place.

### Monorepos and areas

An area can own whole repositories, folders inside a repository, or both. Under **Areas**, Hatstand reads each repository and offers to split it when it finds a pnpm, npm or Yarn workspace, Lerna, Nx, Turborepo, a Go or Cargo workspace, or usual folders such as `apps/` and `services/`. Nothing changes until you accept. Any repository can also be split by hand with **Several, by folder**.

The session opens at the top of the repository, and the agent is told to focus on the folders of the task's area. The repository keeps a single commit check.

### Planning repository

If a client keeps specs, tickets, RFCs and decisions in its own repository, choose it under **Planning**. You say which folder holds each kind of thing, and the map is saved with the client, outside git. Every session can reach that repository and is told to save lasting work there. Task notes stay your private draft.

Agents are told not to commit or push there unless you ask. This is an instruction, not a block. The repository has no commit protection, because what it holds may need to be committed. Choose it from **Planning**, or with **Use for planning** in the list of repositories. Either way it moves out of Repositories, and **Move back to Repositories** undoes that. The folder must be a git repository or a folder inside one.

If the client has no such repository, plans stay in a private default folder with no git. To keep them in git, **Create repository** makes one, by default next to the client's code. It has a `README.md`, `specs/`, `decisions/` and `templates/`, and one commit made with the git email of that folder. If that folder has no email, Hatstand stops and tells you. The repository has no remote, so it stays on this computer, with no backup, until you add one and push.

### Who commits

The Commit identity step of a client sets the name, email and GitHub user for a folder, with the same `includeIf` rule of git you could write by hand. It shows what it will write and waits for you. It adds one rule to your global git config, keeps a private copy of that file first, and writes its values in `~/.gitconfig.d/hatstand-<client>`. If the folder already has a rule of yours, it leaves your files alone and only checks them. Task copies follow the same rule, because git looks at where the repository really is. Agents of that client also get the identity directly, and are told not to change it. SSH keys and AWS profiles stay as you have them.

### Editing a client's files

Hatstand shows knowledge, skills, guides and area files, and you change them in your editor. **Edit in VS Code** opens a file, and what you change shows in Hatstand when you come back. Commit protection learns the new text when you come back to Hatstand and when a session starts. A commit made before either of those is checked against the previous version.

### Accounts for one client

An account can serve every client or only one. Add one in the client's **Agent** step, or under **Settings**. It then appears only for that client, and removing the client also removes the account from Hatstand. Its sign-in folder is not touched.

### GitHub Copilot

Accounts can use Claude Code or GitHub Copilot CLI, chosen per client or per task. Install Copilot with `npm install -g @github/copilot`, and leave the sign-in folder empty to use the login you already have.

Copilot would otherwise use a client's `GITHUB_TOKEN` or `GH_TOKEN` as its own login, so Hatstand keeps those two out of Copilot sessions. Git still authenticates with the client's token through Hatstand's credential helper, but `gh` inside the session uses its own login. To give a Copilot session a token of its own, save it as `COPILOT_GITHUB_TOKEN`.

The subagent panel and the notice for a session waiting at its prompt work with Claude Code only. Permission questions are reported for both.

### Archive or remove a client

In **Settings**, archive a client to hide it and its tasks while keeping everything. An archived client can be restored, or removed in one of two ways:

- **Keep the files:** the client's Hatstand folder moves to `~/.hatstand/removed/`. Its hashes stay, so commits in your other protected repositories keep blocking that knowledge.
- **Delete the files:** the client's Hatstand folder is deleted.

Both delete the client's saved keys and remove Hatstand's commit check from its repositories, restoring any hook that was there before. A repository another client also uses keeps its check. Hatstand never deletes repositories, folders you added from elsewhere, or Claude Code's conversations.

## Tasks

### The view of a task

Clicking a task opens one of three views, and a task with a running session opens on its terminal.

- **Overview** (⌘1): where the task is, where it goes, its notes, session, code and pull requests. Each copy of the code has **Open folder**, which opens its worktree in your file manager. Documents the agent saves for you, such as a report, appear there too, to read or open in your editor.
- **Details** (⌘2): settings, notes, repositories split into not selected and selected, and the changes. Only repositories this task changed appear there, with both uncommitted files and what it committed on its branch.
- **Terminal** (⌘3): the agent, using all the space. ⌘B hides the sidebar too, and **Full screen** (⌘Enter) gives the whole window to the terminal.

**Documents** can open everything of a client in your editor: repositories, planning, knowledge, skills and guides in one window. It uses the first one installed of VS Code, Cursor, Windsurf, Zed, Sublime Text and IntelliJ IDEA. The workspace file lives in `~/.hatstand`, out of every repository.

**New task** at the top of the list and the board opens the form, with the client you are looking at already chosen.

**Needs you** in the sidebar lists what is waiting for you, grouped by client in the order of your clients. Click its title to hide or show the list; Hatstand remembers your choice and keeps the total in view.

### Task numbers and issues

Each client numbers its tasks #1, #2 and so on. A deleted task keeps its number, and the next task gets a new one. Under **Details**, a task can be linked by hand to a GitHub, GitLab or Jira issue, by pasting its link or a key such as `owner/repo#12`. The task keeps its number, and both show in its header. An issue can be linked to one task only. Hatstand does not create or change issues.

### Stages

The guide decides how a task moves. **Implement a task** counts as code work, and so does a task with no guide in a client with repositories.

Code work goes through **Described**, **Planning**, **Implementing**, **Committed**, **PR open**, **Copilot review**, **Team review**, **Waiting for merge** and **Merged**. Hatstand moves it from what it can see: the session, the guide step, the commits and the pull request. Without a repository it stops at **Implementing**, and without Copilot on the pull request that stage is left out. Other guides follow their own steps.

A pull request counts as ready when its checks pass and no review thread is open, and it has an approval if the repository requires one. Open threads move the task to **Needs you**. Hatstand never merges for you, and you close the task yourself after the merge.

### Task guides

A guide lists the steps of a kind of work. Hatstand includes **Implement a task**, **Review a pull request**, **Investigate a bug**, **Create tasks from requirements**, **Write an RFC**, **Debug with AWS logs** and **Check dashboards**. Choose one when you create a task, or later in its details. In a client with repositories, a new task starts with **Implement a task**. You can turn that off in **Settings**.

Each step writes its prompt in the terminal without sending it. You read it and change it if you want. While there is text in the terminal, the button says **Send to agent**: it presses Enter for you, and Hatstand presses Enter only when you choose it. Hatstand never writes over your text, so send it or clear it before you change step.

**Next step** turns on when the agent says the step is finished, with no question left that blocks moving on. If the agent does not say so, you can still jump to any step, and write anything else to the agent. Hatstand knows you have text from the keys you press, not by reading the screen, so after an unusual way of clearing the box, **Send to agent** may send an empty Enter.

To change a guide for one client, open **Task guides** in its settings and choose **Customize**, or create a new one. Hatstand opens the copy so you can edit it. A guide is a YAML file:

```yaml
name: Review a pull request
type: pr-review
steps:
  - name: Read the PR
    prompt: 'Use /review-pr on {link} for "{task}". Do not post anything.'
  - name: Check the ticket
    you: Confirm the ticket {ticket} is the right one.
  - name: Post comments
    approval: true
    prompt: Post only the comments I approved.
```

The optional `type` tells Hatstand how to treat the task: `implementation`, `pr-review`, `investigation`, `design`, `planning`, `testing`, `release` or `report`. Only `implementation` waits for a merge to finish. In a client with repositories, a guide of your own without a `type` counts as `implementation`.

A task keeps its own copy of the steps, so editing a guide does not change tasks already underway. **A step marked `approval` is a label and an instruction to the agent, not a technical block.** An agent with broad permissions could still act early, so keep permission prompts on when that matters.

Hatstand does not manage a browser. For a browser step, connect your own tool to the session and sign in with the right client's account. The agent can see whatever that browser can open, so keep clients in separate browser profiles.

### Reading a repository, and changing it

The repositories you select in a task tell the agent where the work lives. It reads the original folders and does not change them.

When the agent needs to change a repository, it runs `hatstand-edit-repo "<name>"`. Hatstand then creates a git worktree in `~/.hatstand/worktrees/<client>/<task>`, on a new branch named `hatstand/<task>`. It starts from the remote's main branch, and it has no upstream, so a plain `git push` cannot reach main by accident. Two tasks in the same repository cannot change each other's files, and your own checkout stays as you left it.

A planning repository, or a repository that is a knowledge or skills folder, is for control and not for work: it is not offered for tasks, it gets no copy, it never appears as changed, and it has no commit protection, because what is in it may need to be committed. Choosing a registered repository as the planning repository moves it there.

Only repositories with a copy appear as changed. In review, the task lists them with what changed, and **Open in VS Code** opens all the task's copies in one window.

- The agent is told not to edit originals, and that instruction is not a technical block. If a repository has commit protection, a commit in the original during the session is refused. Editing a file there is not prevented.
- A copy starts without installed dependencies or ignored files such as `.env`. The agent is told to install what it needs.
- Commit protection also applies inside copies.
- **Remove copy**, in the task details, deletes the folder and keeps the branch. Hatstand refuses if a file is not committed.
- Choose **Shared folder** in the task details to work in the client's folder, as tasks created before this did. Changes then lists what changed since the agent first worked on the task, and hides older files until you ask for them.

### Board

**Today** can show a board. Tasks move by themselves from what is true right now: **Up next**, **Working**, **Needs you**, **In review**, **Ready to merge** and **Merged**. Hatstand reads the pull request of each task's branch every 90 seconds, with that client's own GitHub or GitLab token, and tells you when CI fails, someone requests changes, or a pull request can be merged. A GitLab token only goes to that client's GitLab address.

The Done column shows only the current work period. **See all closed** opens the rest.

The icon of a task shows its state, and hovering over it explains what it means: **Working**, **Running in the background**, **Needs your answer**, **Your turn** or **Paused**. While a pull request is open it shows where the review stands, such as **Waiting for review**, **Open comments** or **CI failing**. A green check means **Ready to close**. Each card shows its state, agent, branch, pull requests with CI and review, checklist and guide progress, and last activity, with actions to start, resume or stop a session, open its copies, and mark it done.

A task is ready to close when its work is finished, and you always close it yourself:

- A task that changed code is ready when all its work is in the main branch, through a pull request or a local merge. What the agent reports does not change this.
- Other tasks are ready when the agent writes `done` in the notes. Planning and design tasks commit their result in the planning repository first.

You can drag a card, or use its **Move to** list. Working starts or resumes the agent, and Done marks the task done. If the task still has stages left, Hatstand tells you first, and you can mark it done anyway. A running agent or a pull request decides where its card goes, so moving those cards is refused. Everywhere else, the card stays where you put it.

**Give this to the agent** saves the CI failures, the end of their logs and the open comments to a private file, and writes a prompt for the agent. You press Enter to send it. Hatstand never sends this on its own, because comments are written by other people, and the agent is told to treat them as information and not as instructions.

### Closed tasks

The **Closed tasks** tab of a client lists its finished tasks by work period, newest first. Set the length there, in days, weeks or calendar months, with the date the first period starts. Each client has its own, and the default is a calendar month. Tasks closed before this existed show an approximate date.

### Backlog

The **Backlog** of each client (⌘I) keeps work you have not defined yet, out of your tasks. Paste a list or a table and each row becomes an item, or keep it as one. Sidebar and Today remind you how many are waiting for review. **Make it a task** moves one to your tasks. **Send back to backlog**, in an open task, does the opposite: the task leaves your tasks and waits at the end of the backlog, with its notes and session history.

Each line you write or paste is a task. A line that starts with two spaces and a dash becomes a checklist item of the task above, so a list with sublists stays together. The backlog says how many tasks it will add before you add them. Items wait in a table: change their order by dragging or with the arrows, give them a priority, and sort by priority when you want to. Click a row to see and edit its details in a sidebar, which covers the table when the window is narrow. The checklist and priority stay when you make it a task, and the agent reads the checklist.

### Run with assistant

Tick the backlog tasks you want planned, and choose **Run with assistant** in that client's group. Each client has its own button, so a plan never mixes clients. Hatstand asks first. It shows the defaults for this client and warns when its agents ask for permission, because a run would stop at every prompt. It does not change that setting. Then it creates a planning task and starts its session, with the prompt written for you to send.

The assistant reads the tasks, and the code and documents they touch, and proposes:

- the order to build them, with the tasks each one waits for,
- the tasks that should not be developed at the same time, and why,
- the tasks left out because they need your decision first, with the question to answer.

It writes the plan as JSON in `~/.hatstand/companies/<client>/tasks/plans/<task>.json`, outside any repository, and names each task by its number, such as 12 for #12. A Zod schema checks it, and the assistant runs `hatstand-check-plan` to check it the same way before it finishes. The planning task shows the plan, and you can edit it there. Each change is checked as you make it.

**Approve plan** records that you reviewed this exact version. It does not start or change any task, and the backlog stays as it was. If the plan changes after you approve it, the approval no longer counts, and you approve it again.

The client's settings keep the defaults for a run: 2 tasks at a time, and stop at the commit. For now the assistant only proposes the plan.

The assistant gets no copy of any repository in this task, and commit protection refuses commits in the originals. Reading the code is allowed. Not editing files is an instruction, not a block.
