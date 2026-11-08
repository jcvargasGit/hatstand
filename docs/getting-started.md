# Getting started

Hatstand runs from source, so you build it on your own computer. There are no signed builds or automatic updates yet.

## What you need

- Git
- Node.js 22
- pnpm
- At least one agent: [Claude Code](https://claude.ai/code), signed in, or GitHub Copilot CLI (`npm install -g @github/copilot`)

## Run it

```bash
git clone https://github.com/jcvargasGit/hatstand.git
cd hatstand
pnpm install
pnpm dev
```

`pnpm dev` keeps its data in `~/.hatstand-dev`, so it is safe for trying things out. Then follow the guided setup to add your first client.

## macOS

To use Hatstand day to day, install it as an app. This builds the folder you are in and installs it in Applications, with your data in `~/.hatstand`:

```bash
pnpm install:app
```

The app is not signed with a developer certificate, so macOS may ask you to confirm it the first time, and to allow the keychain after each install. macOS asks once for access to the keychain when you save your first key.

If the app is open, the new version waits until you close it, because replacing it would stop your sessions. When your sessions can stop, close Hatstand and run `pnpm install:app --apply`.

### Change Hatstand while you use it

To work on Hatstand from inside Hatstand, keep two copies. `pnpm release` builds what is in `main` and installs it. You can run it from any worktree of the repository, or press **Update installed app** at the bottom of the sidebar in `pnpm dev`. `pnpm dev` is the other copy: it uses `~/.hatstand-dev`, and restarting it does not touch the sessions of the installed app.

`pnpm release` needs a clean checkout of `main` that is not running Hatstand, so run `pnpm dev` from another worktree.

To try your changes with your real clients and tasks, close `pnpm dev` and run `pnpm dev:sync`. It replaces the development data with a copy and only reads the real folder. The copy leaves out sessions and worktrees, and it cannot change repository hooks or your git settings. It still points to your real repositories, so an agent started there works on your real code.

## Linux

Support for Linux is experimental. See [Tested on Linux](#tested-on-linux) for what has been tested.

### Install the packages it needs

`node-pty`, which runs the terminals, compiles when you install. Hatstand also needs a secret store to save keys. On Ubuntu and Debian:

```bash
sudo apt install git python3 make g++ gnome-keyring libsecret-1-0
```

KDE users can use KWallet instead of GNOME Keyring.

### Run it

There is no app package for Linux yet, so run it from your clone. Set `HATSTAND_HOME` to keep your data in the usual folder:

```bash
pnpm build
HATSTAND_HOME=~/.hatstand pnpm start
```

To update, run `git pull`, `pnpm install` and `pnpm build`.

### Common problems

**The sandbox stops Electron from starting.** Ubuntu 24.04 and later restrict what Electron's sandbox needs, and the error mentions `chrome-sandbox` or the SUID sandbox. Give Electron permission with an AppArmor profile, running these lines inside your clone:

```bash
ELECTRON=$(node -p "require('electron')" | tail -1)
sudo tee /etc/apparmor.d/hatstand-electron >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>
profile hatstand-electron "$ELECTRON" flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/hatstand-electron
```

Avoid `--no-sandbox`, because Hatstand displays content from outside your computer, such as pull request comments.

**"The system keychain is not available".** Hatstand found no secret store, so it refuses to save keys rather than protect them with a fixed password. Install GNOME Keyring or KWallet and make sure it is unlocked. If your desktop is not detected, as can happen with a tiling window manager, tell Electron which one you use:

```bash
XDG_CURRENT_DESKTOP=GNOME HATSTAND_HOME=~/.hatstand pnpm start
```

**`pnpm install` fails while building `node-pty`.** Install `python3`, `make` and `g++`, then run it again.

### Tested on Linux

Tested in a container with Ubuntu 24.04 on arm64: installing, the linter, type checks, unit tests, the build, and the end-to-end tests on a virtual screen. The agent in those tests is a fake one, and the container ran without the Electron sandbox.

Not tested yet: a real Linux desktop, x86-64, other distributions, GNOME Keyring or KWallet outside the tests, and the AppArmor steps above. If you try any of these, please [tell us how it went](https://github.com/jcvargasGit/hatstand/issues/new/choose).

## Without internet

Without internet, or on a machine that cannot download Electron or build `node-pty`, `pnpm install` warns and finishes. `pnpm test`, `pnpm type-check` and `pnpm build` still work there. The app itself needs Electron to open. Download the Electron zip of the version in `node_modules/electron/package.json` for that machine, check it against `node_modules/electron/checksums.json`, unzip it outside the repository, and set `ELECTRON_OVERRIDE_DIST_PATH` to that folder for `pnpm dev` and `pnpm test:e2e`. On Linux as root, `pnpm dev` adds `--no-sandbox`, which Electron requires there.

## End-to-end tests

`pnpm test:e2e` builds the app and drives it with the window hidden, throwaway data and a fake agent. To run only some suites, build first and name them:

```bash
pnpm build && node tests/e2e/run.mjs smoke clients
```

The end-to-end tests also run on Linux. Without a screen, such as in a container, each suite runs on a virtual screen with `xvfb-run`, so install `xvfb`. They need Electron itself; if it could not be downloaded during install, the runner says where to put it. On Linux the tests set `HATSTAND_TEST_KEYCHAIN=1`, because Playwright starts Electron without a keychain there, so their secrets use a key that is not secret. Do not set it yourself.

## Where to go next

- [User guide](user-guide.md): clients, tasks, guides and the board
- [How Hatstand protects your data](security.md): do this before you add a real client
