# How Hatstand protects your data

Hatstand is built so that one client's data does not reach another client or a repository by accident. This page explains how it does that, and where that protection ends.

To report a problem, see [SECURITY.md](../SECURITY.md).

## How client data stays out of git

1. **Location.** Client data lives outside your repositories.
2. **No files in the repository.** Context reaches Claude Code through launch flags (`--add-dir`, `--plugin-dir`, `--append-system-prompt-file`).
3. **Commit check.** A pre-commit hook compares staged additions with hashes of every client's keys, knowledge, skills and instructions.
4. **No bypass by agents.** A Claude Code hook rejects `--no-verify` and `git commit -n`.

## How clients stay apart

An agent starts from a short allowlist of environment variables, then gets the keys of its client. Keys of other clients, and anything else in the app's environment, do not reach it. Each session also gets only that client's knowledge and skills.

## How keys are stored

Keys are saved in `secrets.enc`, encrypted with Electron's `safeStorage`:

- **macOS:** the Keychain. macOS asks once for access when you save your first key.
- **Linux:** GNOME Keyring, KWallet or another store that Electron supports. If there is none, Electron would fall back to a fixed password, so Hatstand refuses to save keys and tells you why. See [Getting started](getting-started.md#linux).

## What leaves your computer

Hatstand has no telemetry. It connects to the services you set up: GitHub, GitLab and Jira, with each client's keys. A GitLab token only goes to that client's GitLab address. It also downloads a client's photo when you give it a link. The agents you run talk to their own providers under their own terms.

## Limits

- The check runs where it is installed. Use **Protect repositories** in each client's Protection step, and again after your knowledge changes or you add repositories. The step lists any repository left unprotected and why.
- A repository that already has a pre-commit hook, or uses a shared hooks folder, is reported and left unchanged.
- Only exact matches count. Rewritten knowledge, or a key split across lines, is not detected.
- Knowledge is flagged at three or more matching lines of 40 characters or longer, to avoid false alarms.
- A person can still run `git commit --no-verify`, and an agent could find another way around the hook. This prevents accidents, and is not a security boundary against a hostile agent.
- Knowledge folders inside a repository can be committed there. Hatstand warns you when you add one.
- Agents can read the client's keys from their environment. Keep permission prompts on unless you trust the work.
- A step marked `approval` in a task guide is a label and an instruction to the agent, not a technical block. An agent with broad permissions could still act early.
- The agent is told not to edit the original repositories, and that instruction is not a technical block.
- Hatstand does not manage a browser. If you connect one to a session, the agent can see whatever that browser can open, so keep clients in separate browser profiles.

## Git access

Downloaded repositories keep no token on disk. In a client's sessions, git uses that client's token for its GitHub or GitLab host. Outside Hatstand, such as in your own terminal, git uses whatever login you have there, so a private repository may ask you to sign in.
