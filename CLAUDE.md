# Working in this repository

Rules for coding agents, such as Claude Code. People should read [CONTRIBUTING.md](CONTRIBUTING.md), which also applies to agents.

## Do not interrupt the person

Do not open a visible Hatstand window while the person is working.

- Test with `pnpm test` and `pnpm test:e2e`. The end-to-end tests run with the window hidden.
- Start the app yourself only with `HATSTAND_HEADLESS=1` and a throwaway `HATSTAND_HOME`.
- Use `pnpm dev`, `pnpm start` or `HATSTAND_SHOW_WINDOW=1` only when the person asks to see the window.

## Do not touch real data

- `pnpm dev` and `pnpm start` use `~/.hatstand-dev`. The app the person works in uses `~/.hatstand`, so never point a test at that folder.
- `pnpm dev:sync` copies real data to `~/.hatstand-dev` when the person asks. Keep repositories and git settings out of what that copy can change (`HATSTAND_DEV_COPY`).
- Never write real client names, keys, tickets, internal URLs or documents in this repository. Use made-up data such as `acme` and `example.com`.
- Never bypass git hooks with `--no-verify`.

## Before you finish

Run `pnpm lint`, `pnpm type-check` and `pnpm test`, and run `pnpm test:e2e` when behavior changes. Report what you ran and what failed.

Keep macOS and Linux working, and read [Architecture](docs/architecture.md) before changing the structure.
