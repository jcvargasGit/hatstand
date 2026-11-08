const QUIET_MS = 700;
const QUIET_AFTER_TRUST_MS = 1500;
const MAX_WAIT_MS = 15_000;
const TRUST_DIALOG = /trust(thefiles|thisfolder)|oneyoutrust/i;
const ESCAPE_SEQUENCES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g;

export function plainText(output: string): string {
  return output.replace(ESCAPE_SEQUENCES, '');
}

export function singleLine(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export class PromptPrefill {
  private recent = '';
  private quietTimer: NodeJS.Timeout | undefined;
  private deadline: NodeJS.Timeout | undefined;
  private finished = false;
  private waitingForTrust = false;
  private trustAnswered = false;

  constructor(
    private text: string,
    private readonly write: (text: string) => void,
  ) {}

  get isWaiting(): boolean {
    return !this.finished;
  }

  retarget(text: string | null): void {
    if (text === null) this.cancel();
    else this.text = text;
  }

  onOutput(data: string): void {
    if (this.finished) return;
    this.recent = (this.recent + plainText(data)).slice(-20_000);
    if (this.waitingForTrust) return;
    this.deadline ??= setTimeout(() => this.fire(), MAX_WAIT_MS);
    this.waitForQuiet();
  }

  onInput(data: string): void {
    if (this.finished || this.trustAnswered || !/[\r\n]/.test(data) || !this.showsTrustDialog()) return;
    this.waitingForTrust = false;
    this.trustAnswered = true;
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this.fire(), MAX_WAIT_MS);
    this.waitForQuiet();
  }

  private showsTrustDialog(): boolean {
    return TRUST_DIALOG.test(this.recent.replace(/\s+/g, ''));
  }

  private waitForQuiet(): void {
    clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.fire(), this.trustAnswered ? QUIET_AFTER_TRUST_MS : QUIET_MS);
  }

  private fire(): void {
    if (this.finished) return;
    clearTimeout(this.quietTimer);
    if (!this.trustAnswered && this.showsTrustDialog()) {
      clearTimeout(this.deadline);
      this.waitingForTrust = true;
      return;
    }
    this.cancel();
    this.write(this.text);
  }

  cancel(): void {
    this.finished = true;
    clearTimeout(this.quietTimer);
    clearTimeout(this.deadline);
  }
}
