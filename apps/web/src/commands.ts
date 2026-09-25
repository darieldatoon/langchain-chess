/** Identifies a command: the same content at the same position in the same thread. */
export function commandKey(threadId: string | null, ply: number, content: string): string {
  return `${threadId ?? "new"}:${ply}:${content}`;
}

/**
 * One message id per command key. A resend reuses the id, which the server treats as a no-op
 * (it ignores message ids it has already consumed); never mint a fresh id for the same key.
 */
export function createCommandIds(
  mint: () => string = () => crypto.randomUUID(),
): (key: string) => string {
  const ids = new Map<string, string>();
  return (key) => {
    const known = ids.get(key);
    if (known) return known;
    const id = mint();
    ids.set(key, id);
    return id;
  };
}
