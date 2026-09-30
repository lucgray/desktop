import { GithubLogoIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { DIALOG_SCROLL } from "@/components/dialog-scroll";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { githubProtectionsToRules } from "@/lib/branch-rules/github";
import { matchesGlob } from "@/lib/branch-rules/match";
import {
  useBranchRules,
  useSaveBranchRules,
  useSaveSharedBranchRules,
  useSharedBranchRules,
} from "@/lib/branch-rules/queries";
import {
  ALL_MERGE_METHODS,
  type BranchRulesConfig,
  EMPTY_BRANCH_RULES,
  type MergeMethod,
} from "@/lib/branch-rules/types";
import { ghBranchProtections } from "@/lib/git/api";
import { forgeFeatureReady, useForgeStatus } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

const MERGE_METHOD_KEYS: Record<MergeMethod, TranslationKey> = {
  merge: "branchRulesUi.mergeCommit",
  squash: "branchRulesUi.squash",
  rebase: "branchRulesUi.rebase",
};

export function BranchRulesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  // Which set of rules we're editing: the user's personal (app-data) rules or
  // the repo's shared, committed `.gitdesktop/branch-rules.json`. Both are
  // always enforced (merged) — this only chooses what this dialog edits.
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const personal = useBranchRules(repoPath);
  const shared = useSharedBranchRules(repoPath);
  const savePersonal = useSaveBranchRules(repoPath);
  const saveShared = useSaveSharedBranchRules(repoPath);
  const gh = useForgeStatus(repoPath);
  // Importing branch protections is a GitHub-only operation for now — the
  // repoActions flag is on for GitLab too (view/star), so the provider check is
  // load-bearing here.
  const ghReady =
    forgeFeatureReady(gh.data, "repoActions") && gh.data?.provider === "github";
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<BranchRulesConfig>(EMPTY_BRANCH_RULES);
  const [testName, setTestName] = useState("");
  const patternInputId = useId();
  const hintInputId = useId();
  const testNameInputId = useId();
  // Keyed by row position, like the list itself — Add and Remove hand focus to a
  // neighbour rather than dropping it to the body.
  const promotionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const addPromotionRef = useRef<HTMLButtonElement>(null);

  const active = scope === "shared" ? shared : personal;
  const saving = scope === "shared" ? saveShared : savePersonal;

  // Seed the editable draft from the active scope when the dialog opens or the
  // scope changes (switching scopes discards any unsaved edits in the other).
  const seededScope = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededScope.current = null;
      return;
    }
    if (seededScope.current !== scope && active.data) {
      seededScope.current = scope;
      setDraft(active.data);
    }
  }, [open, scope, active.data]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(active.data ?? null);

  function setNaming(patch: Partial<BranchRulesConfig["naming"]>) {
    setDraft((d) => ({ ...d, naming: { ...d.naming, ...patch } }));
  }

  function addProtection() {
    setDraft((d) => ({
      ...d,
      protections: [
        ...d.protections,
        {
          id: crypto.randomUUID(),
          pattern: "",
          blockDeletion: true,
          blockForcePush: true,
          requirePr: false,
          allowedMergeMethods: [...ALL_MERGE_METHODS],
        },
      ],
    }));
  }

  function toggleMergeMethod(id: string, method: MergeMethod, on: boolean) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.map((p) =>
        p.id === id
          ? {
              ...p,
              allowedMergeMethods: on
                ? ALL_MERGE_METHODS.filter(
                    (m) => p.allowedMergeMethods.includes(m) || m === method,
                  )
                : p.allowedMergeMethods.filter((m) => m !== method),
            }
          : p,
      ),
    }));
  }

  function updateProtection(
    id: string,
    patch: Partial<BranchRulesConfig["protections"][number]>,
  ) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  }

  function removeProtection(id: string) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.filter((p) => p.id !== id),
    }));
  }

  // Promotion branches are bare patterns with no per-entry settings, so they're
  // edited by position rather than by an id the way protections are. Focus follows
  // the edit — deferred to after the re-render, since the row being focused doesn't
  // exist (or has shifted) until then.
  function addPromotionBranch() {
    const next = draft.promotionBranches.length;
    setDraft((d) => ({
      ...d,
      promotionBranches: [...d.promotionBranches, ""],
    }));
    requestAnimationFrame(() => promotionRefs.current[next]?.focus());
  }

  function updatePromotionBranch(index: number, pattern: string) {
    setDraft((d) => ({
      ...d,
      promotionBranches: d.promotionBranches.map((p, i) =>
        i === index ? pattern : p,
      ),
    }));
  }

  function removePromotionBranch(index: number) {
    const emptied = draft.promotionBranches.length === 1;
    setDraft((d) => ({
      ...d,
      promotionBranches: d.promotionBranches.filter((_, i) => i !== index),
    }));
    // The survivors shift down one, so index-1 IS the row above — and index 0 lands
    // on whichever row took its place. With none left, Add is the nearest control
    // that outlives the removal.
    requestAnimationFrame(() => {
      if (emptied) addPromotionRef.current?.focus();
      else promotionRefs.current[Math.max(0, index - 1)]?.focus();
    });
  }

  // Pulls GitHub's branch protection rules into the draft (deduped by pattern),
  // for the user to review and save. Read-only against GitHub.
  async function importFromGitHub() {
    setImporting(true);
    try {
      const mapped = githubProtectionsToRules(
        await ghBranchProtections(repoPath),
      );
      if (mapped.length === 0) {
        toast.info(
          t("branchRulesUi.importNone"),
        );
        return;
      }
      setDraft((d) => {
        const byPattern = new Map(d.protections.map((p) => [p.pattern, p]));
        for (const m of mapped) byPattern.set(m.pattern, m);
        return { ...d, protections: [...byPattern.values()] };
      });
      toast.success(
        mapped.length === 1
          ? t("branchRulesUi.importOne")
          : t("branchRulesUi.importMany", { count: mapped.length }),
      );
    } catch (e) {
      toastError(e);
    } finally {
      setImporting(false);
    }
  }

  function doSave() {
    saving.mutate(draft, {
      onSuccess: () => {
        toast.success(
          scope === "shared"
            ? t("branchRulesUi.savedShared")
            : t("branchRulesUi.savedPersonal"),
        );
        onOpenChange(false);
      },
      onError: toastError,
    });
  }

  const promotionBranches = draft.promotionBranches;
  const namePattern = draft.naming.pattern.trim();
  const testMatches = namePattern !== "" && matchesGlob(namePattern, testName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("branchRulesUi.title")}</DialogTitle>
          <DialogDescription>
            {t("branchRulesUi.description")}
          </DialogDescription>
        </DialogHeader>

        {/* Header and footer stay pinned; the rules (many protections + merge
            toggles) scroll so the dialog can't outgrow the viewport. */}
        <div className={cn(DIALOG_SCROLL, "min-h-0 flex-1 space-y-4")}>
          <div className="space-y-1.5">
            <div className="flex gap-1">
              <Button
                variant={scope === "personal" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setScope("personal")}
              >
                {t("branchRulesUi.personal")}
              </Button>
              <Button
                variant={scope === "shared" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setScope("shared")}
              >
                {t("branchRulesUi.shared")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {scope === "shared" ? (
                <>
                  {t("branchRulesUi.sharedHelp")}
                </>
              ) : (
                t("branchRulesUi.personalHelp")
              )}
            </p>
          </div>

          {active.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-6">
              <section className="space-y-2">
                <h3 className="text-xs font-medium">{t("branchRulesUi.newBranchNames")}</h3>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={draft.naming.enabled}
                    onCheckedChange={(c) => setNaming({ enabled: c === true })}
                  />
                  {t("branchRulesUi.requirePattern")}
                </label>
                {draft.naming.enabled && (
                  <div className="space-y-2 pl-6">
                    <div className="space-y-1">
                      <Label htmlFor={patternInputId} className="text-xs">
                        {t("branchRulesUi.pattern")}
                      </Label>
                      <Input
                        id={patternInputId}
                        value={draft.naming.pattern}
                        onChange={(e) => setNaming({ pattern: e.target.value })}
                        placeholder="{feature,fix,chore}/*"
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={hintInputId} className="text-xs">
                        {t("branchRulesUi.rejectedHint")}
                      </Label>
                      <Input
                        id={hintInputId}
                        value={draft.naming.hint}
                        onChange={(e) => setNaming({ hint: e.target.value })}
                        placeholder="feature/login, fix/crash"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={testNameInputId} className="text-xs">
                        {t("branchRulesUi.tryName")}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={testNameInputId}
                          value={testName}
                          onChange={(e) => setTestName(e.target.value)}
                          placeholder="feature/login"
                          className="font-mono"
                        />
                        {testName.trim() !== "" && (
                          <span
                            className={
                              testMatches
                                ? "shrink-0 text-xs text-success"
                                : "shrink-0 text-xs text-destructive"
                            }
                          >
                            {testMatches ? t("branchRulesUi.matches") : t("branchRulesUi.rejected")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium">{t("branchRulesUi.protectedBranches")}</h3>
                  <div className="flex gap-1">
                    {ghReady && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={importing}
                        onClick={importFromGitHub}
                        title={t("branchRulesUi.importTitle")}
                      >
                        <GithubLogoIcon data-icon="inline-start" />
                        {t("branchRulesUi.importGithub")}
                      </Button>
                    )}
                    <Button variant="outline" size="xs" onClick={addProtection}>
                      <PlusIcon data-icon="inline-start" />
                      {t("branchRulesUi.add")}
                    </Button>
                  </div>
                </div>
                {draft.protections.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("branchRulesUi.noProtected")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {draft.protections.map((p) => (
                      <div
                        key={p.id}
                        className="space-y-2 rounded-md border p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            value={p.pattern}
                            onChange={(e) =>
                              updateProtection(p.id, {
                                pattern: e.target.value,
                              })
                            }
                            placeholder="main"
                            className="font-mono"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("branchRulesUi.remove")}
                            onClick={() => removeProtection(p.id)}
                          >
                            <TrashIcon />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={p.blockDeletion}
                              onCheckedChange={(c) =>
                                updateProtection(p.id, {
                                  blockDeletion: c === true,
                                })
                              }
                            />
                            {t("branchRulesUi.blockDeletion")}
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={p.blockForcePush}
                              onCheckedChange={(c) =>
                                updateProtection(p.id, {
                                  blockForcePush: c === true,
                                })
                              }
                            />
                            {t("branchRulesUi.blockForcePush")}
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={p.requirePr}
                              onCheckedChange={(c) =>
                                updateProtection(p.id, {
                                  requirePr: c === true,
                                })
                              }
                            />
                            {t("branchRulesUi.requirePr")}
                          </label>
                        </div>
                        <div>
                          <span className="text-[11px] text-muted-foreground">
                            {t("branchRulesUi.allowedMerges")}
                            {p.requirePr ? ` · ${t("branchRulesUi.viaPr")}` : ""}
                          </span>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                            {ALL_MERGE_METHODS.map((m) => (
                              <label
                                key={m}
                                className="flex cursor-pointer items-center gap-1.5 text-xs"
                              >
                                <Checkbox
                                  checked={p.allowedMergeMethods.includes(m)}
                                  onCheckedChange={(c) =>
                                    toggleMergeMethod(p.id, m, c === true)
                                  }
                                />
                                {t(MERGE_METHOD_KEYS[m])}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium">{t("branchRulesUi.promotionBranches")}</h3>
                  <Button
                    ref={addPromotionRef}
                    variant="outline"
                    size="xs"
                    onClick={addPromotionBranch}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t("branchRulesUi.add")}
                  </Button>
                </div>
                {promotionBranches.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("branchRulesUi.noPromotions")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {promotionBranches.map((pattern, i) => (
                      // Position IS the identity here: the entries are bare
                      // strings, so two blank rows would share any value-derived
                      // key. The inputs stay controlled from the array, so a
                      // removal re-renders the survivors correctly.
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          ref={(el) => {
                            promotionRefs.current[i] = el;
                          }}
                          value={pattern}
                          onChange={(e) =>
                            updatePromotionBranch(i, e.target.value)
                          }
                          placeholder="staging"
                          className="font-mono"
                          aria-label={t("branchRulesUi.promotionPattern", { index: i + 1 })}
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("branchRulesUi.removePromotion", { pattern: pattern || i + 1 })}
                          onClick={() => removePromotionBranch(i)}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("branchRulesUi.cancel")}
          </Button>
          <DisabledReasonButton
            // Below `sm` the footer stacks and stretches the wrapper span; the
            // Button fills it to match the stretched Cancel beside it.
            className="w-full"
            onClick={doSave}
            disabled={!dirty || saving.isPending}
            reason={!dirty ? t("branchRulesUi.noChanges") : t("branchRulesUi.saving")}
          >
            {scope === "shared" ? t("branchRulesUi.saveRepository") : t("branchRulesUi.saveChanges")}
          </DisabledReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
