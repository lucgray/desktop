/**
 * The one wording for each commit-level action that changes the working tree or
 * writes history. The History list, the commit detail view's ⋯ menu, Compare's
 * commit context menu, and a tag's Checkout all ask through these, so no route
 * can pose a different question than its twin. Prompts go through
 * `useConfirm.getState().ask(...)`.
 */

import { translateCurrent } from "@/lib/i18n";

const short = (hash: string) => hash.slice(0, 7);

/** Checking out a commit and checking out a tag land in the same detached HEAD,
 *  so both name their entity and share the explanation. */
export function checkoutDetachedConfirm(kind: "commit" | "tag", name: string) {
  const localizedKind = translateCurrent(kind === "commit" ? "dataUi.commitConfirm.kindCommit" : "dataUi.commitConfirm.kindTag");
  return {
    title: translateCurrent("dataUi.commitConfirm.checkoutTitle", { kind: localizedKind, name }),
    body: translateCurrent("dataUi.commitConfirm.checkoutBody", { kind: localizedKind }),
    confirmLabel: translateCurrent("dataUi.commitConfirm.checkout", { kind: localizedKind }),
  };
}

export const checkoutCommitConfirm = (hash: string) =>
  checkoutDetachedConfirm("commit", short(hash));

/** A silent checkout reads as a dead end (Compare flips to its detached-HEAD
 *  empty state with no acknowledgment), so every checkout route — commit or
 *  tag — reports success through this one template. */
const checkedOutDetached = (name: string) =>
  translateCurrent("dataUi.commitConfirm.checkedOut", { name });

export function checkoutCommitSuccessToast(hash: string) {
  return checkedOutDetached(short(hash));
}

export function checkoutTagSuccessToast(tag: string) {
  return checkedOutDetached(tag);
}

export const revertCommitConfirm = (hash: string) => ({
  title: translateCurrent("dataUi.commitConfirm.revertTitle", { hash: short(hash) }),
  body: translateCurrent("dataUi.commitConfirm.revertBody", { hash: short(hash) }),
  confirmLabel: translateCurrent("dataUi.commitConfirm.revert"),
});

/** `branch` names the destination when the caller already holds repo status;
 *  without it the copy says "the current branch" rather than subscribing a view
 *  to status for a string only this prompt reads. */
export const cherryPickCommitConfirm = (
  hash: string,
  branch: string | null,
) => ({
  title: translateCurrent("dataUi.commitConfirm.cherryPickTitle", { hash: short(hash) }),
  body: translateCurrent("dataUi.commitConfirm.cherryPickBody", { hash: short(hash), branch: branch ?? translateCurrent("dataUi.commitConfirm.currentBranch") }),
  confirmLabel: translateCurrent("dataUi.commitConfirm.cherryPick"),
});

/** A parentless commit has nothing to soft-reset to, so undo deletes the branch
 *  ref instead — the one undo that doesn't just re-stage in place. Scoped to the
 *  branch, never the repository: an orphan branch's first commit takes this path
 *  while the repository's history carries on elsewhere. */
export const undoRootCommitConfirm = () => ({
  title: translateCurrent("dataUi.commitConfirm.undoRootTitle"),
  body: translateCurrent("dataUi.commitConfirm.undoRootBody"),
  confirmLabel: translateCurrent("dataUi.commitConfirm.undoRoot"),
  confirmVariant: "destructive",
} as const);
