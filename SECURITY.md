# Security policy

Hatstand runs coding agents with access to client keys, documents and repositories, so security reports matter here.

## Report a problem

Use [GitHub's private vulnerability reporting](https://github.com/jcvargasGit/hatstand/security/advisories/new). Please do not open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. Use made-up data in your report. Also use this channel if you find real client or company data in this repository.

This project is maintained in free time. Reports get a reply as soon as possible, on a best-effort basis, and there is no paid bounty.

## Supported versions

Only the latest `main` branch is supported. There are no signed releases yet.

## What counts

- A client's keys or documents reaching another client's session.
- A client's data reaching a repository despite an installed commit check, in a way [the documented limits](docs/security.md#limits) do not cover.
- Keys saved without encryption, or readable by a web page in the app.
- Code running from a web page, a pull request comment, or a tracker issue that Hatstand displays.

## What does not count

Hatstand prevents accidents. It is not a security boundary against a hostile agent. These are documented limits:

- An agent can read the keys of its client from its environment.
- A person can run `git commit --no-verify`, and an agent could find another way around the hook.
- Steps marked `approval` in a task guide are instructions to the agent, not technical blocks.

See [How Hatstand protects your data](docs/security.md).
