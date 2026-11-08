// Output that arrives while the terminal reads what was already printed is both queued and
// part of that read. Each chunk carries where it ends in the session's output, so only the
// chunks that end after the read are written again.
export function newerThan<Chunk extends { end: number }>(pending: Chunk[], readUpTo: number): Chunk[] {
  return pending.filter((chunk) => chunk.end > readUpTo);
}
