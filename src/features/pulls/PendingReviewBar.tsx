import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Markdown } from "@/components/markdown/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommentEditor } from "@/features/conversations/CommentEditor";
import { useForgeStatus } from "@/lib/git/queries";
import type { RemoteLens } from "@/lib/git/types";
import { useTranslation } from "@/lib/i18n";
import {
  type ReviewDraft,
  useClearReviewDrafts,
  useRemoveReviewDraft,
  useReviewDrafts,
  useUpdateReviewDraft,
} from "@/lib/pulls/review-drafts";

/** The anchor label for a draft: "Lines a–b" for a range, "Line b" otherwise. */
function draftLabel(draft: ReviewDraft, t: ReturnType<typeof useTranslation>["t"]): string {
  if (draft.startLine && draft.startLine !== draft.line) {
    return t("pullDetail.linesRange", { start: draft.startLine, end: draft.line });
  }
  return t("pullDetail.lineNumber", { line: draft.line });
}

/**
 * One pending draft comment, rendered under its anchored diff line (the Files
 * tab) or in a list: a `Pending` badge (semantic token + text, never color
 * alone), a markdown body preview, and always-visible Edit (inline editor swap)
 * and Delete (confirm) controls — no hover-reveal. Wired to the draft store's
 * update/remove hooks. Exported for PrFilesPane's draft anchors.
 */
export function DraftCommentCard({
  repoPath,
  lens,
  number,
  draft,
}: {
  repoPath: string;
  /** The origin|upstream lens the parent PR view resolved (scopes the drafts). */
  lens: RemoteLens;
  number: number;
  draft: ReviewDraft;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateDraft = useUpdateReviewDraft(repoPath, lens, number);
  const removeDraft = useRemoveReviewDraft(repoPath, lens, number);
  // A draft body carries the same references the posted comment will, so the
  // preview linkifies them against the PR's repo.
  const provider = useForgeStatus(repoPath).data?.provider;
  const refs = provider ? { provider, repoPath, lens } : undefined;

  const next = body.trim();
  const canSave = next.length > 0 && next !== draft.body.trim();

  // Awaited rather than per-call mutate callbacks: these cards unmount on a tab
  // switch away from Files, and react-query drops per-call callbacks once an
  // observer has no listeners. The catches do nothing because both draft hooks
  // toast failures at mutation level, which fires for `mutateAsync` rejections
  // too, so a catch of our own would double-report.
  async function saveEdit() {
    if (!canSave) return;
    try {
      await updateDraft.mutateAsync({ id: draft.id, body: next });
      setEditing(false);
    } catch {
      // Reported at hook level (see above).
    }
  }

  async function deleteDraft() {
    try {
      await removeDraft.mutateAsync(draft.id);
      setConfirmDelete(false);
    } catch {
      // Reported at hook level (see above).
    }
  }

  return (
    <div className="space-y-1.5 rounded border bg-background px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="shrink-0 text-warning">
          {t("pullDetail.pending")}
        </Badge>
        <span className="truncate font-mono text-muted-foreground">
          {draftLabel(draft, t)}
        </span>
        {!editing && (
          <>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                setBody(draft.body);
                setEditing(true);
              }}
            >
              {t("pullDetail.edit")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              {t("pullDetail.delete")}
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <CommentEditor
          value={body}
          onChange={setBody}
          onSubmit={() => void saveEdit()}
          onCancel={() => setEditing(false)}
          canSubmit={canSave}
          pending={updateDraft.isPending}
          ariaLabel={t("pullDetail.editPendingComment")}
          textareaClassName="max-h-48 min-h-16 resize-y"
        />
      ) : (
        <Markdown refs={refs}>{draft.body}</Markdown>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        title={t("pullDetail.deletePendingComment")}
        body={t("pullDetail.deletePendingCommentBody")}
        confirmLabel={t("pullDetail.delete")}
        confirmVariant="destructive"
        pending={removeDraft.isPending}
        onConfirm={() => void deleteDraft()}
      />
    </div>
  );
}

/**
 * The pending-review status bar: hidden until at least one draft comment exists,
 * then a compact "Review in progress · N pending comment(s)" line with a primary
 * "Submit review…" (opens the parent's submit dialog via `onSubmit`) and a
 * destructive-styled "Discard" (confirmed before clearing). Reads its own draft
 * count; self-contained and non-sticky (P5 places it at a stable slot). No layout
 * shift on appearance — it simply renders nothing at zero drafts.
 */
export function PendingReviewBar({
  repoPath,
  lens,
  number,
  onSubmit,
}: {
  repoPath: string;
  /** The origin|upstream lens the parent PR view resolved (scopes the drafts). */
  lens: RemoteLens;
  number: number;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const drafts = useReviewDrafts(repoPath, lens, number);
  const clearDrafts = useClearReviewDrafts(repoPath, lens, number);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const count = drafts.data?.length ?? 0;

  async function discard() {
    try {
      await clearDrafts.mutateAsync(undefined);
      setConfirmDiscard(false);
    } catch {
      // Awaited with a do-nothing catch: see DraftCommentCard.
    }
  }

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-3 border-y bg-muted/40 px-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 text-muted-foreground">
        <span className="font-medium text-foreground">{t("pullDetail.reviewInProgress")}</span>{" "}
        · {t(count === 1 ? "pullDetail.pendingCommentCountOne" : "pullDetail.pendingCommentCountMany", { count })}
      </span>
      <Button size="xs" onClick={onSubmit}>
        {t("pullDetail.submitReviewEllipsis")}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive"
        onClick={() => setConfirmDiscard(true)}
      >
        {t("common.discard")}
      </Button>
      <ConfirmDialog
        open={confirmDiscard}
        onCancel={() => setConfirmDiscard(false)}
        title={t("pullDetail.discardPendingReview")}
        body={t("pullDetail.discardPendingReviewBody", { count })}
        confirmLabel={t("pullDetail.discardReview")}
        confirmVariant="destructive"
        pending={clearDrafts.isPending}
        onConfirm={() => void discard()}
      />
    </div>
  );
}
