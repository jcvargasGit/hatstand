const XTERM_TRACKPAD_DAMPING = 0.3;
const XTERM_TRACKPAD_DELTA_LIMIT = 50;

export function wheelSensitivity(deltaY: number, appReceivesWheel: boolean): number {
  const dampedByXterm = appReceivesWheel && Math.abs(deltaY) < XTERM_TRACKPAD_DELTA_LIMIT;
  return dampedByXterm ? 1 / XTERM_TRACKPAD_DAMPING : 1;
}
