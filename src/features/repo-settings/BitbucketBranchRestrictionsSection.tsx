import { CaretLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useBbBranchRestrictions,
  useBbCreateBranchRestriction,
  useBbDeleteBranchRestriction,
  useBbUpdateBranchRestriction,
} from "@/lib/git/queries";
import type { BitbucketBranchRestriction } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { AsyncListBody, InlineConfirm } from "./parts";

/** The restriction kinds the app offers, with human labels. `needsValue` kinds
 *  carry a numeric argument (a required count). Only "push" and
 *  "require_approvals_to_merge" were live-validated; the rest share the same
 *  create shape and surface server errors verbatim if the API rejects them. */
const KINDS: { value: string; key: TranslationKey; needsValue?: boolean }[] = [
  { value: "push", key: "repoSettings.preventPushes" },
  { value: "force", key: "repoSettings.preventForcePushes" },
  { value: "delete", key: "repoSettings.preventBranchDeletion" },
  { value: "restrict_merges", key: "repoSettings.restrictMerges" },
  {
    value: "require_approvals_to_merge",
    key: "repoSettings.requireApprovalsToMerge",
    needsValue: true,
  },
  {
    value: "require_passing_builds_to_merge",
    key: "repoSettings.requirePassingBuilds",
    needsValue: true,
  },
  { value: "require_tasks_to_be_completed", key: "repoSettings.requireResolvedTasks" },
];

/** Base UI's <Select> resolves value → label from an `items` map; without it a
 *  closed select falls back to the raw value ("push") until reopened. */
const KIND_ITEMS: Record<string, string> = Object.fromEntries(
  KINDS.map((o) => [o.value, o.key]),
);

function kindLabel(kind: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const item = KINDS.find((k) => k.value === kind);
  return item ? t(item.key) : kind;
}

function kindNeedsValue(kind: string): boolean {
  return KINDS.find((k) => k.value === kind)?.needsValue ?? false;
}

/** Bitbucket branch restrictions: list the repo's rules, add one (kind + glob
 *  pattern, plus a count for approval/build kinds), edit a rule's pattern and
 *  value (the kind is fixed), and delete with a confirm. */
export function BitbucketBranchRestrictionsSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const { t } = useTranslation();
  const restrictions = useBbBranchRestrictions(repoPath, open);
  const remove = useBbDeleteBranchRestriction(repoPath);
  // null = list; "new" = create form; a restriction = edit form.
  const [editing, setEditing] = useState<
    BitbucketBranchRestriction | "new" | null
  >(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Awaited, not per-call callbacks: this subtree unmounts when the dialog
  // closes or the rail crossfades to another section, and react-query drops
  // per-call callbacks on unmount — the outcome would never reach the user.
  async function handleRemove(id: string) {
    try {
      await remove.mutateAsync(id);
      toast.success(t("repoSettings.restrictionDeleted"));
      setConfirming(null);
    } catch (e) {
      toastError(e);
    }
  }

  if (editing) {
    return (
      <RestrictionForm
        repoPath={repoPath}
        restriction={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("repoSettings.branchRestrictionIntro")}
        </p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          {t("repoSettings.addRestriction")}
        </Button>
      </div>

      <AsyncListBody
        loading={restrictions.isPending}
        error={restrictions.error}
        empty={restrictions.data?.length === 0}
        emptyLabel={t("repoSettings.noBranchRestrictions")}
        skeletonClassName="h-12 w-full"
        errorTitle={t("repoSettings.loadBranchRestrictionsFailed")}
        errorHint={t("repoSettings.branchRestrictionsAdminRequired")}
      >
        {restrictions.data?.map((r) => (
          <div key={r.id} className="rounded-md border p-2 text-xs">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1">
                <span className="font-medium">{kindLabel(r.kind, t)}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-mono" title={r.pattern}>
                  {r.pattern}
                </span>
                {r.value != null && (
                  <span className="text-muted-foreground"> · {r.value}</span>
                )}
              </p>
              {confirming === r.id ? (
                <InlineConfirm
                  prompt={t("repoSettings.deleteQuestion")}
                  actLabel={t("repoSettings.delete")}
                  pending={remove.isPending}
                  onCancel={() => setConfirming(null)}
                  onAct={() => handleRemove(r.id)}
                />
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(r)}
                  >
                    {t("repoSettings.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirming(r.id)}
                  >
                    {t("repoSettings.delete")}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </AsyncListBody>
    </div>
  );
}

function RestrictionForm({
  repoPath,
  restriction,
  onDone,
}: {
  repoPath: string;
  restriction: BitbucketBranchRestriction | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const create = useBbCreateBranchRestriction(repoPath);
  const update = useBbUpdateBranchRestriction(repoPath);
  const editing = restriction !== null;

  const [kind, setKind] = useState(restriction?.kind ?? "push");
  const [pattern, setPattern] = useState(restriction?.pattern ?? "");
  const [value, setValue] = useState(
    restriction?.value != null ? String(restriction.value) : "1",
  );

  const pending = create.isPending || update.isPending;
  const needsValue = kindNeedsValue(kind);
  const trimmed = pattern.trim();
  const numValue = Number(value);
  const valueValid =
    !needsValue ||
    (Number.isInteger(numValue) && numValue >= 1 && numValue <= 10);
  const canSave = trimmed.length > 0 && valueValid && !pending;
  const warning = !trimmed
    ? t("repoSettings.enterBranchPattern")
    : !valueValid
      ? t("repoSettings.enterRestrictionCount")
      : null;

  async function submit() {
    const payloadValue = needsValue ? numValue : null;
    try {
      if (restriction) {
        await update.mutateAsync({
          id: restriction.id,
          kind: restriction.kind,
          pattern: trimmed,
          value: payloadValue,
        });
      } else {
        await create.mutateAsync({
          kind,
          pattern: trimmed,
          value: payloadValue,
        });
      }
      toast.success(editing ? t("repoSettings.restrictionUpdated") : t("repoSettings.restrictionAdded"));
      onDone();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <Button size="sm" variant="ghost" onClick={onDone}>
        <CaretLeftIcon data-icon="inline-start" />
        {t("repoSettings.backToRestrictions")}
      </Button>
      <div className="space-y-3 rounded-md border p-3">
        <div className="space-y-1.5">
          <Label htmlFor="bb-restriction-kind">{t("repoSettings.restriction")}</Label>
          <Select
            items={KIND_ITEMS}
            value={kind}
            disabled={editing}
            onValueChange={(v) => {
              if (v) setKind(v);
            }}
          >
            <SelectTrigger id="bb-restriction-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing && (
            <p className="text-[11px] text-muted-foreground">
              {t("repoSettings.restrictionKindLocked")}
            </p>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="bb-restriction-pattern">{t("repoSettings.branchPattern")}</Label>
            <Input
              id="bb-restriction-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="main or release/*"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          {needsValue && (
            <div className="space-y-1.5">
              <Label htmlFor="bb-restriction-value">{t("repoSettings.count")}</Label>
              <Input
                id="bb-restriction-value"
                type="number"
                min={1}
                max={10}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-20"
              />
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("repoSettings.globHelpPrefix")} <span className="font-mono">release/*</span> {t("repoSettings.globHelpSuffix")}
        </p>
        {warning && <p className="text-[11px] text-warning">{warning}</p>}
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="outline" size="sm" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={submit}>
            {pending && <Spinner data-icon="inline-start" />}
            {editing ? t("repoSettings.saveChanges") : t("repoSettings.add")}
          </Button>
        </div>
      </div>
    </div>
  );
}
