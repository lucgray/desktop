import { ArrowSquareOutIcon, SparkleIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useLayoutEffect, useState } from "react";
import { toast } from "sonner";
import { LabeledGroup } from "@/components/form/labeled-group";
import { SelectClipText } from "@/components/select-clip-text";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { clipTitleFromText } from "@/lib/clip-title";
import { useActiveGhHost } from "@/lib/git/host";
import {
  useBranches,
  useGhScopes,
  useRepoSettings,
  useUpdateRepoSettings,
} from "@/lib/git/queries";
import type { Branch, RepoSettings, RepoSettingsInput } from "@/lib/git/types";
import { usePublishGenerateAction } from "@/lib/hotkeys/useGenerateChord";
import { useAiConfigured, useAiEnabled } from "@/lib/settings/queries";
import {
  cancelRepoDescGeneration,
  claimRepoDescGeneration,
  consumePendingRepoDesc,
  type RepoDescResult,
  registerRepoDescListener,
  settleRepoDescGeneration,
  useIsGeneratingRepoDesc,
} from "@/lib/stores/repo-description-generation";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { DescriptionField } from "./DescriptionField";
import { AsyncErrorCard } from "./parts";
import { GITHUB_TOPIC_RULES, TopicsField } from "./TopicsField";
import { useGenerateRepoDescription } from "./useGenerateRepoDescription";
import { useTranslation } from "@/lib/i18n";

export function GeneralSettingsSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const { t } = useTranslation();
  const settings = useRepoSettings(repoPath, open);
  const branches = useBranches(repoPath);

  if (settings.isPending) {
    return (
      <div className="min-w-0 space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <AsyncErrorCard title={t("repoSettings.loadSettingsFailed")} error={settings.error} />
    );
  }

  return (
    // Keyed by repo: a cache-warm switch would otherwise reconcile the form in
    // place, carrying the previous repo's draft and its generation's abort handle.
    <GeneralForm
      key={repoPath}
      repoPath={repoPath}
      settings={settings.data}
      branches={branches.data ?? []}
    />
  );
}

function toInput(s: RepoSettings): RepoSettingsInput {
  return {
    description: s.description ?? "",
    homepage: s.homepage ?? "",
    topics: s.topics,
    defaultBranch: s.defaultBranch,
    hasIssues: s.hasIssues,
    hasProjects: s.hasProjects,
    hasWiki: s.hasWiki,
    hasDiscussions: s.hasDiscussions,
    allowSquashMerge: s.allowSquashMerge,
    allowMergeCommit: s.allowMergeCommit,
    allowRebaseMerge: s.allowRebaseMerge,
    allowUpdateBranch: s.allowUpdateBranch,
    deleteBranchOnMerge: s.deleteBranchOnMerge,
    allowAutoMerge: s.allowAutoMerge,
    webCommitSignoffRequired: s.webCommitSignoffRequired,
    isTemplate: s.isTemplate,
    // null = don't send allow_forking (only mutable on org-owned private repos).
    allowForking: s.canChangeForking ? s.allowForking : null,
    squashMergeCommitTitle: s.squashMergeCommitTitle,
    squashMergeCommitMessage: s.squashMergeCommitMessage,
    mergeCommitTitle: s.mergeCommitTitle,
    mergeCommitMessage: s.mergeCommitMessage,
  };
}

/** Valid squash/merge title+message pairs (GitHub 422s an invalid combo). Each
 *  encodes its `title/message` enum pair; the UI offers them as one choice. */
const SQUASH_DEFAULTS = [
  {
    value: "COMMIT_OR_PR_TITLE/COMMIT_MESSAGES",
    label: "defaultCommitMessages",
  },
  { value: "PR_TITLE/PR_BODY", label: "pullRequestTitleAndDescription" },
  { value: "PR_TITLE/BLANK", label: "pullRequestTitle" },
] as const;
const MERGE_DEFAULTS = [
  { value: "MERGE_MESSAGE/PR_TITLE", label: "defaultMergeMessage" },
  { value: "PR_TITLE/PR_BODY", label: "pullRequestTitleAndDescription" },
  { value: "PR_TITLE/BLANK", label: "pullRequestTitle" },
] as const;

/** Repo settings that have NO GitHub API — only manageable in the browser.
 *  (The Sponsor button is editable in the Sponsor tab — it's `.github/FUNDING.yml`.) */
const WEB_ONLY_SETTINGS = [
  "webOnlyCommitComments",
  "webOnlyGitLfsArchives",
  "webOnlyPushLimits",
  "webOnlyAutoCloseIssues",
];

/** A muted readout of the gh token's OAuth scopes — context for what governance
 *  actions are available. Hidden for fine-grained/App tokens (no classic scopes). */
function GhScopesNote() {
  const { t } = useTranslation();
  const scopes = useGhScopes(useActiveGhHost());
  if (!scopes.data?.classic || scopes.data.scopes.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {t("repoSettings.githubScopesGrant")}{" "}
      <span className="font-mono">{scopes.data.scopes.join(", ")}</span>
    </p>
  );
}

/** A single dropdown for a default commit title+message pair. Keeps the current
 *  (possibly non-standard) value selectable so the picker never shows blank. */
function CommitMessageSelect({
  id,
  label,
  disabled,
  options,
  title,
  message,
  onChange,
}: {
  id: string;
  label: string;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  title: string;
  message: string;
  onChange: (title: string, message: string) => void;
}) {
  const { t } = useTranslation();
  const value = `${title}/${message}`;
  const opts = options.some((o) => o.value === value)
    ? options
    : [{ value, label: `${title} / ${message}` }, ...options];
  // Trigger labels, built per render because `opts` carries the synthesized
  // current pair — without them Base UI shows the raw "title/message" value.
  const translateOption = (label: string) => {
    switch (label) {
      case "defaultCommitMessages": return t("repoSettings.defaultCommitMessages");
      case "pullRequestTitleAndDescription": return t("repoSettings.pullRequestTitleAndDescription");
      case "pullRequestTitle": return t("repoSettings.pullRequestTitle");
      case "defaultMergeMessage": return t("repoSettings.defaultMergeMessage");
      default: return label;
    }
  };
  const items = Object.fromEntries(opts.map((o) => [o.value, translateOption(o.label)]));
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={disabled ? "text-muted-foreground" : ""}>
        {label}
      </Label>
      <Select
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          if (!v) return;
          const [t, m] = v.split("/");
          onChange(t, m);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue onMouseEnter={clipTitleFromText} />
        </SelectTrigger>
        <SelectContent className="max-w-[min(22rem,80vw)]">
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <SelectClipText>{translateOption(o.label)}</SelectClipText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Normalize a list of raw topic strings per GitHub's rules (slugified,
 *  deduped, capped 20) — used when the AI Generate result seeds topics. */
function normalizeTopics(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const t of raw) {
    const topic = GITHUB_TOPIC_RULES.normalize(t);
    if (topic) seen.add(topic);
  }
  // `maxTopics` is optional on `TopicRules`, so the `?? 20` satisfies the type;
  // the GitHub preset always sets 20, so the fallback never fires at runtime.
  return [...seen].slice(0, GITHUB_TOPIC_RULES.maxTopics ?? 20);
}

function GeneralForm({
  repoPath,
  settings,
  branches,
}: {
  repoPath: string;
  settings: RepoSettings;
  branches: Branch[];
}) {
  const { t } = useTranslation();
  const update = useUpdateRepoSettings(repoPath);
  const base = toInput(settings);
  const [form, setForm] = useState<RepoSettingsInput>(base);

  const aiEnabled = useAiEnabled();
  const aiConfigured = useAiConfigured();
  const openSettings = useUiStore((s) => s.openSettings);
  const repoName =
    useUiStore((s) => s.repoName) ?? repoPath.split(/[/\\]/).pop() ?? repoPath;
  const descGen = useGenerateRepoDescription(repoPath);
  // A run started here outlives this form (the dialog and the rail both unmount
  // their section immediately), so the store owns it: `generating` covers the
  // stream this mount launched, the store covers one it inherited.
  const storeBusy = useIsGeneratingRepoDesc(repoPath);
  const busy = descGen.generating || storeBusy;

  function set<K extends keyof RepoSettingsInput>(
    key: K,
    value: RepoSettingsInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Seeds the draft the way a manual edit would, so the Save bar goes live.
  const applyResult = useCallback(({ description, topics }: RepoDescResult) => {
    if (description) setForm((f) => ({ ...f, description }));
    if (topics.length)
      setForm((f) => ({ ...f, topics: normalizeTopics(topics) }));
  }, []);

  // Take a result that settled while no section was mounted, then stay the
  // recipient for one that settles during this mount. A LAYOUT effect: a settle
  // between the commit and a passive flush would find no listener and toast.
  useLayoutEffect(() => {
    const pending = consumePendingRepoDesc(repoPath);
    if (pending) applyResult(pending);
    return registerRepoDescListener(repoPath, applyResult);
  }, [repoPath, applyResult]);

  // Shared by the Generate button and the settings dialog's generate chord,
  // which this publishes to — the shell owns the chord because it owns the
  // DialogContent every section renders inside.
  async function runGenerate() {
    if (!claimRepoDescGeneration(repoPath, descGen.cancel)) return;
    let result: RepoDescResult | null = null;
    try {
      await descGen.generate({
        repoName,
        onResult: (r) => {
          result = r;
        },
      });
    } finally {
      // In a `finally` because nothing else clears the lane: a throw between
      // the claim and here would leave every surface for this repo busy.
      settleRepoDescGeneration(repoPath, result);
    }
  }
  const { hint: generateHint } = usePublishGenerateAction(
    aiEnabled && aiConfigured && !busy,
    runGenerate,
  );

  const mergeValid =
    form.allowSquashMerge || form.allowMergeCommit || form.allowRebaseMerge;
  const dirty = JSON.stringify(form) !== JSON.stringify(base);

  // Keep the current default selectable even if that branch isn't local; drop
  // agent-session branches (`gd/session/*`) — they're app-internal.
  const branchNames = branches
    .map((b) => b.name)
    .filter((n) => !n.startsWith("gd/session/"));
  const branchOptions = branchNames.includes(form.defaultBranch)
    ? branchNames
    : [form.defaultBranch, ...branchNames];

  // Awaited, not per-call callbacks: react-query drops those when this subtree
  // unmounts mid-flight — closing the dialog or switching the rail's section —
  // so the outcome would never reach the user.
  async function handleSave() {
    try {
      await update.mutateAsync(form);
      toast.success(t("repoSettings.settingsSaved"));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <DescriptionField
        id="repo-description"
        value={form.description}
        onChange={(v) => set("description", v)}
        placeholder={t("repoSettings.shortDescriptionPlaceholder")}
        generate={
          aiEnabled &&
          (!aiConfigured ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => openSettings("ai")}
            >
              <SparkleIcon data-icon="inline-start" />
              {t("repoSettings.setupAi")}
            </Button>
          ) : busy ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                if (descGen.generating) descGen.cancel();
                else cancelRepoDescGeneration(repoPath);
              }}
            >
              <Spinner data-icon="inline-start" />
              {t("common.cancel")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title={`${t("repoSettings.suggestDescriptionTopics")}${generateHint}`}
              onClick={runGenerate}
            >
              <SparkleIcon data-icon="inline-start" />
              {t("common.generate")}
            </Button>
          ))
        }
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="repo-topics">{t("repoSettings.topics")}</Label>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {form.topics.length} / 20
          </span>
        </div>
        <TopicsField
          id="repo-topics"
          topics={form.topics}
          onChange={(next) => set("topics", next)}
          rules={GITHUB_TOPIC_RULES}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="repo-homepage">{t("repoSettings.homepageUrl")}</Label>
          <Input
            id="repo-homepage"
            value={form.homepage}
            onChange={(e) => set("homepage", e.target.value)}
            placeholder="https://…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repo-default-branch">{t("repoSettings.defaultBranch")}</Label>
          <Select
            value={form.defaultBranch}
            onValueChange={(v) => {
              if (v) set("defaultBranch", v);
            }}
          >
            <SelectTrigger id="repo-default-branch" className="w-full">
              <SelectValue onMouseEnter={clipTitleFromText} />
            </SelectTrigger>
            <SelectContent className="max-w-[min(20rem,80vw)]">
              {branchOptions.map((b) => (
                <SelectItem key={b} value={b}>
                  <SelectClipText>{b}</SelectClipText>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <LabeledGroup label={t("repoSettings.features")}>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasIssues}
              onCheckedChange={(c) => set("hasIssues", c === true)}
            />
            {t("help.issues")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasProjects}
              onCheckedChange={(c) => set("hasProjects", c === true)}
            />
            {t("help.projects")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasWiki}
              onCheckedChange={(c) => set("hasWiki", c === true)}
            />
            {t("repoSettings.wiki")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasDiscussions}
              onCheckedChange={(c) => set("hasDiscussions", c === true)}
            />
            {t("help.discussions")}
          </label>
        </div>
      </LabeledGroup>

      <LabeledGroup label={t("repoSettings.pullRequestMerges")}>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.allowMergeCommit}
              onCheckedChange={(c) => set("allowMergeCommit", c === true)}
            />
            {t("repoSettings.mergeCommits")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.allowSquashMerge}
              onCheckedChange={(c) => set("allowSquashMerge", c === true)}
            />
            {t("repoSettings.squashMerging")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.allowRebaseMerge}
              onCheckedChange={(c) => set("allowRebaseMerge", c === true)}
            />
            {t("repoSettings.rebaseMerging")}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <CommitMessageSelect
            id="squash-default"
            label={t("repoSettings.squashMergeMessage")}
            disabled={!form.allowSquashMerge}
            options={SQUASH_DEFAULTS}
            title={form.squashMergeCommitTitle}
            message={form.squashMergeCommitMessage}
            onChange={(t, m) =>
              setForm((f) => ({
                ...f,
                squashMergeCommitTitle: t,
                squashMergeCommitMessage: m,
              }))
            }
          />
          <CommitMessageSelect
            id="merge-default"
            label={t("repoSettings.mergeCommitMessage")}
            disabled={!form.allowMergeCommit}
            options={MERGE_DEFAULTS}
            title={form.mergeCommitTitle}
            message={form.mergeCommitMessage}
            onChange={(t, m) =>
              setForm((f) => ({
                ...f,
                mergeCommitTitle: t,
                mergeCommitMessage: m,
              }))
            }
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Switch
            checked={form.allowUpdateBranch}
            onCheckedChange={(c) => set("allowUpdateBranch", c)}
          />
          {t("repoSettings.alwaysSuggestUpdatingBranches")}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.allowAutoMerge}
            onCheckedChange={(c) => set("allowAutoMerge", c)}
          />
          {t("repoSettings.allowAutoMerge")}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.deleteBranchOnMerge}
            onCheckedChange={(c) => set("deleteBranchOnMerge", c)}
          />
          {t("repoSettings.deleteHeadBranchesAfterMerge")}
        </label>
      </LabeledGroup>

      <LabeledGroup label={t("repoSettings.commits")}>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.webCommitSignoffRequired}
            onCheckedChange={(c) => set("webCommitSignoffRequired", c)}
          />
          {t("repoSettings.requireWebSignoff")}
        </label>
      </LabeledGroup>

      <LabeledGroup label={t("repoSettings.repository")}>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.isTemplate}
            onCheckedChange={(c) => set("isTemplate", c)}
          />
          {t("repoSettings.templateRepository")}
        </label>
        {/* GitHub only allows changing this on org-owned private repos. */}
        {settings.canChangeForking && (
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Switch
              checked={form.allowForking ?? false}
              onCheckedChange={(c) => set("allowForking", c)}
            />
            {t("repoSettings.allowForking")}
          </label>
        )}
      </LabeledGroup>

      {settings.htmlUrl && (
        <LabeledGroup label={t("repoSettings.onlyOnGithub")}>
          <p className="text-xs text-muted-foreground">
            {t("repoSettings.manageInBrowser")}
          </p>
          <ul className="space-y-1">
            {WEB_ONLY_SETTINGS.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  onClick={() => openUrl(`${settings.htmlUrl}/settings`)}
                >
                  {t(`repoSettings.${key}` as "repoSettings.webOnlyCommitComments" | "repoSettings.webOnlyGitLfsArchives" | "repoSettings.webOnlyPushLimits" | "repoSettings.webOnlyAutoCloseIssues")}
                  <ArrowSquareOutIcon className="size-3 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </LabeledGroup>
      )}

      <GhScopesNote />

      <div className="flex items-center justify-end gap-3 pt-2">
        {!mergeValid && (
          <span className="mr-auto text-xs text-destructive">
            {t("repoSettings.enableMergeMethod")}
          </span>
        )}
        <Button
          disabled={!dirty || !mergeValid || update.isPending || busy}
          onClick={handleSave}
        >
          {update.isPending && <Spinner data-icon="inline-start" />}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
