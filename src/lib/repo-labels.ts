/**
 * Accessible name for a repo-state glyph. One glyph stands for both states, so
 * the label names both; a plain repo stays unlabelled — nothing in the app
 * badges a repo "public".
 */
export function repoStateLabel(
  isPrivate: boolean,
  isFork: boolean,
  labels: { privateRepository: string; privateFork: string; fork: string },
): string | null {
  return isPrivate
    ? isFork
      ? labels.privateFork
      : labels.privateRepository
    : isFork
      ? labels.fork
      : null;
}
