/**
 * Identifies a command within one game: the same content at the same position. Do not key by
 * thread id: a new game's first command is sent before the server assigns one.
 */
export function commandKey(ply: number, content: string): string {
  return `${ply}:${content}`;
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
