# Changelog

Notable changes to Hatstand are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- First public version, run from source on macOS and, as an experiment, on Linux.
- Contribution, security and conduct policies, with CI on macOS and Linux.
- **Send back to backlog**, in an open task, moves a task that is not defined yet out of your tasks.

### Changed

- The Inbox is now called Backlog. The shortcut is the same.
- On Linux, Hatstand refuses to save keys when there is no secret store, instead of protecting them with a fixed password.

### Fixed

- The terminal could show output twice when it arrived while the terminal was loading.
- Shift+Enter added a line in the terminal and also moved the task to Working, as if you had answered the agent.
- With Ctrl+Shift, the shortcuts with a number or a comma did nothing.
