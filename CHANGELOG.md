# Changelog

Notable changes to Hatstand are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- First public version, run from source on macOS and, as an experiment, on Linux.
- Contribution, security and conduct policies, with CI on macOS and Linux.
- **Send back to backlog**, in an open task, moves a task that is not defined yet out of your tasks.
- **Open in new window** moves the New task form to a window of its own, with everything you wrote and chose.
- The first prompt of a task is sent without waiting for Enter. A setting in Settings turns this off.
- **Agent work**, beside the terminal: the repositories of the task, the files the agent changed and created, and its documents. Each one opens in your editor, and the list updates while the session runs.
- A button for each repository of a task that opens it in your editor, named after it. A task with its own copy offers the copy and the original repository.
- The guide **Investigate a topic**, for an open investigation that ends with a Markdown file in the folder of the task's area.

### Changed

- The Inbox is now called Backlog. The shortcut is the same.
- New task opens in the side panel, with the title and description on the left, the settings on the right and the buttons at the bottom.
- **Make it a task**, in the backlog, opens the same form with the item filled in, and saves that same item as a task.
- The **Details** tab of a task is now **Task settings**, and nothing appears in both Overview and Task settings. The shortcut is the same.
- The sidebar groups the tasks of each client by guide, also under **Needs you**. Tasks with no guide are under **Not classified**.
- The guides you use most come first when you choose one.
- A guide step the agent finished shows ✓, also when it finished several or a later one. The finished steps are kept with the task.
- On Linux, Hatstand refuses to save keys when there is no secret store, instead of protecting them with a fixed password.

### Fixed

- The terminal could show output twice when it arrived while the terminal was loading.
- Shift+Enter added a line in the terminal and also moved the task to Working, as if you had answered the agent.
- With Ctrl+Shift, the shortcuts with a number or a comma did nothing.
