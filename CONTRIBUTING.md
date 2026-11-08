# Contributing to Hatstand

Thanks for your interest. Hatstand is maintained in free time, so small and focused pull requests get reviewed fastest.

## Before you start

- **Bugs, docs and tests:** open a pull request directly, or an issue first if the fix is not obvious.
- **New features and larger changes:** open an issue first and wait for a reply, so your work does not go to waste.
- **Security problems:** do not open an issue. Follow [SECURITY.md](SECURITY.md).

By taking part, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need Git, Node.js 22 and pnpm. On Linux you also need a C++ toolchain and a secret store. See [Getting started](docs/getting-started.md).

```bash
git clone https://github.com/<you>/hatstand.git
cd hatstand
pnpm install
pnpm dev
```

`pnpm dev` keeps its data in `~/.hatstand-dev`. Never point a test at `~/.hatstand`, which holds the data of the app you work in.

## Check your work

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:e2e   # builds and drives the real app with a hidden window, throwaway data and a fake agent
```

CI runs these on macOS and Linux. To run the end-to-end tests on a Linux machine, see [Getting started](docs/getting-started.md#run-the-end-to-end-tests-on-linux).

## Code rules

- Prefer readable code over clever code, and pure functions for validators and transformers.
- Infer types from Zod schemas instead of writing them by hand. Do not use `any`; use `unknown` with a type guard.
- Add a comment only when the code cannot explain why it does something.
- Write behavior tests for schemas, main-process logic and components. Do not test page styling.
- Keep platform checks small, and keep macOS and Linux working. See [Architecture](docs/architecture.md).

## Never commit real data

Hatstand exists to keep client data out of repositories, and this repository follows the same rule.

- Use only made-up names in tests, fixtures, docs and screenshots, such as `acme` and `example.com`.
- Do not paste real logs, tokens, ticket numbers, internal URLs, customer names or client documents, not even in an issue.
- If you find real data in this repository, report it privately through [SECURITY.md](SECURITY.md).

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/), such as `fix: keep the sidebar open after a reload`.
- Keep one topic in each pull request, and update the docs when behavior or setup changes.
- For a visible change, add a screenshot that uses made-up data.
- Sign off every commit with `git commit -s`. See below.

A maintainer reviews and merges each pull request.

### Developer Certificate of Origin

Contributions are accepted under the [Apache-2.0 license](LICENSE) and the [Developer Certificate of Origin](https://developercertificate.org/). The sign-off line says you have the right to submit your work. You keep your copyright, and there is no separate agreement to sign.

```
Signed-off-by: Your Name <you@example.com>
```

Check that you can submit the work if your employer or a client may have rights over what you write.

### AI assistance

Coding agents are welcome. You are responsible for what you submit: read it, test it, and be ready to explain it.
