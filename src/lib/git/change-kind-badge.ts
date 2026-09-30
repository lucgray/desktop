import type { ChangeKind } from "./types";
import type { TranslationKey } from "@/lib/i18n";

/** The status letter, screen-reader label, and colour token per change kind.
 *  Shared so the Changes list and the commit dialog's staged summary read the
 *  same letter and colour for the same file. */
export const KIND_BADGE: Record<
  ChangeKind,
  { letter: string; label: string; className: string }
> = {
  added: { letter: "A", label: "Added", className: "text-success" },
  untracked: { letter: "U", label: "Untracked", className: "text-success" },
  modified: { letter: "M", label: "Modified", className: "text-warning" },
  typechange: { letter: "T", label: "Type changed", className: "text-warning" },
  deleted: { letter: "D", label: "Deleted", className: "text-destructive" },
  renamed: { letter: "R", label: "Renamed", className: "text-info" },
  copied: { letter: "C", label: "Copied", className: "text-info" },
  conflicted: {
    letter: "!",
    label: "Conflicted",
    className: "text-destructive",
  },
};

const KIND_LABEL_KEYS: Record<ChangeKind, TranslationKey> = {
  added: "dataUi.changes.added",
  untracked: "dataUi.changes.untracked",
  modified: "dataUi.changes.modified",
  typechange: "dataUi.changes.typeChanged",
  deleted: "dataUi.changes.deleted",
  renamed: "dataUi.changes.renamed",
  copied: "dataUi.changes.copied",
  conflicted: "dataUi.changes.conflicted",
};

export function changeKindLabel(kind: ChangeKind, t: (key: TranslationKey) => string) {
  return t(KIND_LABEL_KEYS[kind]);
}
