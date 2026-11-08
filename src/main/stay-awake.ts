import type { StayAwakeMode } from '../shared/schemas';

type Blocker = {
  start(type: 'prevent-display-sleep'): number;
  stop(id: number): void;
};

export const shouldStayAwake = (mode: StayAwakeMode, liveSessions: number) => mode === 'always' || (mode === 'sessions' && liveSessions > 0);

export class StayAwake {
  private blockerId: number | null = null;

  constructor(private readonly blocker: Blocker) {}

  get active(): boolean {
    return this.blockerId !== null;
  }

  apply(keepAwake: boolean): void {
    if (keepAwake && this.blockerId === null) this.blockerId = this.blocker.start('prevent-display-sleep');
    if (!keepAwake && this.blockerId !== null) {
      this.blocker.stop(this.blockerId);
      this.blockerId = null;
    }
  }
}
