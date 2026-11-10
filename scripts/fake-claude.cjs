#!/usr/bin/env node
// A stand-in for the `claude` command, for machines with no signed-in agent.
// It answers the sign-in check, records each launch, and echoes what you type.
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const log = process.env.HATSTAND_SANDBOX_LOG;

if (args[0] === '--version') {
  console.log('0.0.0 (fake claude)');
  process.exit(0);
}
if (args[0] === 'auth') {
  if (args[1] === 'status') console.log(JSON.stringify({ loggedIn: true, email: 'dev@example.com', subscriptionType: 'fake' }));
  else console.log('Signed in to the fake claude.');
  process.exit(0);
}

if (log) {
  mkdirSync(log, { recursive: true });
  const record = { at: new Date().toISOString(), cwd: process.cwd(), args, envNames: Object.keys(process.env).sort() };
  appendFileSync(join(log, 'launches.jsonl'), `${JSON.stringify(record)}\n`);
}

const setState = (state) => {
  if (process.env.HATSTAND_STATUS_FILE) writeFileSync(process.env.HATSTAND_STATUS_FILE, state);
};

console.log('fake claude is ready. Type a line and press Enter; type /exit to quit.');
setState('needs-input');

let line = '';
const answer = (text) => {
  if (text.trim() === '/exit') process.exit(0);
  setState('working');
  setTimeout(() => {
    process.stdout.write(`fake claude heard: ${text}\r\n`);
    setState('needs-input');
  }, 500);
};

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  for (const char of chunk.toString()) {
    if (char === '\u0003') process.exit(0);
    if (char === '\r' || char === '\n') {
      process.stdout.write('\r\n');
      answer(line);
      line = '';
    } else {
      line += char;
      process.stdout.write(char);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
