import type { Playbook } from '../shared/schemas';

const NOTHING_PUBLISHED = 'Do not post, publish or change anything outside this computer.';

export const BUILTIN_PLAYBOOKS: Record<string, Playbook> = {
  implement: {
    name: 'Implement a task',
    description: 'Understand the task, plan, build and test it, commit, open a pull request you approve, and close its reviews.',
    steps: [
      {
        name: 'Understand the task',
        prompt: `Read "{task}", its checklist and {link}. Read the code it touches. Tell me what has to change, how we will know it works, and what is still unclear. Do not change any code yet. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Plan the work',
        prompt: `Write your plan in the task notes: the changes by repository, the tests you will add, and the risks. Stop for my review, and do not change any code yet. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Build it',
        prompt: `Implement the plan as it now reads in the task notes, with tests, following the conventions of each repository. Do not commit yet. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Test it',
        prompt: `Run the tests, type checks and linters of each repository you changed, and fix what fails. Check each acceptance criterion and name the test that proves it. Report what you ran and the result. If you could not run something, say so. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Commit it',
        prompt: `Commit your work on this task's branch, following this client's rules for commits. If the repository has no copy for this task, say so and skip this step. Do not push. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Open the pull request',
        approval: true,
        prompt: 'Push the branch and open a pull request for what I approved, describing what changed and how it was tested. Then give me the link.',
      },
      {
        name: 'Copilot review',
        approval: true,
        prompt: 'Read the Copilot comments on the pull request. If this repository has no Copilot review, say so and skip this step. For each one, fix it, or if it is wrong, draft a reply with the evidence. Tell me what you plan to push and post, and wait for my approval each time.',
      },
      {
        name: 'Team review',
        approval: true,
        prompt: 'Read the review comments and failed checks on the pull request from people and other tools. For each one, fix it, or if it is wrong, draft a reply with the evidence. Tell me what you plan to push and post, and wait for my approval each time. When nothing is open, tell me the pull request is waiting for me to merge it. Do not merge it.',
      },
    ],
  },
  'pr-review': {
    name: 'Review a pull request',
    description: 'Read a pull request, draft comments, post what you approve, and follow the replies.',
    steps: [
      {
        name: 'Read the PR',
        prompt: `Read the pull request for "{task}" ({link}) and the ticket it mentions. Use this client's review skill if it has one. Summarize what changes and the main risks. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Draft comments',
        prompt: `Write your review comments as a draft in the task notes, with the file and line of each one. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Post comments',
        approval: true,
        prompt: 'Post to the pull request only the comments I approved, as they now read in the task notes.',
      },
      {
        name: 'Check replies',
        prompt: `Read the new replies on the pull request. Draft your answers in the task notes, and tell me which ones need my decision. ${NOTHING_PUBLISHED}`,
      },
    ],
  },
  bug: {
    name: 'Investigate a bug',
    description: 'Go from a ticket to a likely cause, with evidence from logs and code.',
    steps: [
      {
        name: 'Read the ticket',
        prompt: `Read {ticket} and everything linked from it ({link}). Tell me the reported behavior, the expected behavior and what is still unknown. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Logs and code',
        prompt: `Inspect the relevant logs and code for "{task}" using read-only commands. Record what you find in the task notes. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Likely cause',
        prompt: `Explain the most likely cause, the evidence for it, how sure you are, and what would confirm it. Propose a fix and do not apply it yet. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Comment or fix',
        approval: true,
        prompt: 'Do what I approved: apply the fix on a branch, or post the findings on {ticket}.',
      },
    ],
  },
  backlog: {
    name: 'Create tasks from requirements',
    description: 'Turn requirements and context into tasks you review, then create them in the tracker.',
    steps: [
      {
        name: 'Gather context',
        prompt: `For "{task}", read the description, the client's knowledge, and previous related tickets and documents. Tell me what you found and what is missing. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Draft the tasks',
        prompt: `Draft the tasks in the task notes, each with a title, description and acceptance criteria, using this client's conventions. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Create the tasks',
        approval: true,
        prompt: "Create in this client's tracker only the tasks I approved, as they now read in the task notes. Then list their links.",
      },
    ],
  },
  rfc: {
    name: 'Write an RFC',
    description: 'Write an architecture document, review it, and publish it.',
    steps: [
      {
        name: 'Gather context',
        prompt: `For "{task}", read the requirements, the client's knowledge and related decisions. Tell me the problem, the constraints and the open questions. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Draft the RFC',
        prompt: `Draft the RFC as a Markdown file in this client's knowledge folder, never inside a repository: context, options with trade-offs, recommendation and risks. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Publish',
        approval: true,
        prompt: "Publish the RFC I approved to this client's documentation tool, such as Confluence, and give me the link.",
      },
    ],
  },
  testing: {
    name: 'Test a change',
    description: 'Plan the tests, run them, keep the evidence, and report the result.',
    steps: [
      {
        name: 'Plan the tests',
        prompt: `For "{task}", read the requirements and write the cases to run in the task notes, with the expected result of each. Stop for my review. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Run them',
        prompt: `Run the cases as they now read in the task notes. Do not change anything outside this computer unless I approved it. Record what you ran. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Keep the evidence',
        prompt: `Record the result of each case in the task notes, with the logs or output that support it. Say which cases you could not run. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Report',
        prompt: `Summarize what passed, what failed, the likely cause of each failure, and what to do next. ${NOTHING_PUBLISHED}`,
      },
    ],
  },
  release: {
    name: 'Prepare a release',
    description: 'List what is pending per environment, gather the repositories and tickets, and check the release.',
    steps: [
      {
        name: 'Pending by environment',
        prompt: `For "{task}", using read-only commands, find what is pending in each environment. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Repositories and tickets',
        prompt: `Write in the task notes the list of repositories, with the tickets that go in each one and the order to deploy them. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Check the release',
        prompt: `Check that each item has its pull request merged and its checks passing. Tell me what is missing, and what would block this release. ${NOTHING_PUBLISHED}`,
      },
    ],
  },
  report: {
    name: 'Write a report',
    description: 'Gather the facts, draft the report or answer, and deliver what you approve.',
    steps: [
      {
        name: 'Gather the facts',
        prompt: `For "{task}", gather the facts from the code, tickets and notes using read-only commands. Record where each one came from in the task notes. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Draft it',
        prompt: `Draft the report or the answer in the task notes. Separate what you checked from what you assume. ${NOTHING_PUBLISHED}`,
      },
      {
        name: 'Deliver',
        approval: true,
        prompt: 'Deliver only what I approved, as it now reads in the task notes, where I told you to.',
      },
    ],
  },
  'aws-debug': {
    name: 'Debug with AWS logs',
    description: 'Sign in, read CloudWatch logs, and report what they show.',
    steps: [
      {
        name: 'Sign in',
        you: 'Sign in with the AWS profile of this client. You can run it in this terminal with an exclamation mark, such as: ! aws sso login --profile your-profile',
      },
      {
        name: 'Read the logs',
        prompt: `Using read-only AWS commands, read the CloudWatch logs relevant to "{task}". Record the time range, the log groups and what you find in the task notes. Do not change anything in AWS.`,
      },
      {
        name: 'Findings',
        prompt: 'Summarize the possible failures with the log lines that support them, and propose what to check next. Do not change anything in AWS.',
      },
    ],
  },
  observability: {
    name: 'Check dashboards',
    description: 'Inspect dashboards in a browser you connect, and report what they show.',
    steps: [
      {
        name: 'Connect a browser',
        you: 'Connect your browser tool to this session and sign in with the account of this client. Hatstand does not manage the browser, so the agent sees what that browser can open. Check that it is the right account.',
      },
      {
        name: 'Inspect dashboards',
        prompt: `Using the browser, inspect the dashboards relevant to "{task}". Do not change any dashboard or setting. Record the panels, the time range and what you see in the task notes.`,
      },
      {
        name: 'Findings',
        prompt: `Summarize what the dashboards show, what looks wrong, and what to check next. ${NOTHING_PUBLISHED}`,
      },
    ],
  },
};
