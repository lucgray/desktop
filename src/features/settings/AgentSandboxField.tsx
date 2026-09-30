import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  buildCustomImage,
  type ContainerStatus,
  customImageStatus,
  prepareContainerSandbox,
  scaffoldCustomDockerfile,
} from "@/lib/ai/sandbox";
import { useContainerStatus } from "@/lib/ai/sandbox-queries";
import {
  type AGENT_ISOLATIONS,
  IMAGE_AGENT_IDS,
  NODE_VERSIONS,
} from "@/lib/settings/api";
import { toastError } from "@/lib/toast";
import { useTranslation } from "@/lib/i18n";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type AgentId = (typeof IMAGE_AGENT_IDS)[number];
type NodeVersion = (typeof NODE_VERSIONS)[number];
type AgentIsolation = (typeof AGENT_ISOLATIONS)[number];

/** Trigger labels — without them Base UI shows the raw version, dropping the
 *  "(LTS)" note the popup carries. Record-typed against NODE_VERSIONS, which
 *  `loadSettings` also heals against, so an added version can't reach one
 *  without the other. */
const NODE_VERSION_ITEMS: Record<NodeVersion, string> = {
  "24": "24 (LTS)",
  "22": "22",
  "20": "20",
};
/** Container-capable agents installed into the managed image. Record-typed against
 *  IMAGE_AGENT_IDS, which the checkbox row renders from, so a new agent can't reach
 *  the settings type without a label here. */
const IMAGE_AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  copilot: "GitHub Copilot",
};

/**
 * Opt-in control for running agent sessions inside a Docker/Podman container
 * (kernel-enforced filesystem confinement) instead of the host. When enabled it
 * also configures the managed image — the Node base version and which agent CLIs
 * to install — and offers Build / Rebuild (Rebuild pulls a fresh base + CLIs to
 * pick up updates). The image is stamped with its config so a stale one is
 * flagged for rebuild.
 */
export function AgentSandboxField({
  value,
  onChange,
  nodeVersion,
  onNodeVersion,
  providers,
  onProviders,
  repoPath,
}: {
  value: AgentIsolation;
  onChange: (value: AgentIsolation) => void;
  nodeVersion: NodeVersion;
  onNodeVersion: (v: NodeVersion) => void;
  providers: AgentId[];
  onProviders: (v: AgentId[]) => void;
  /** The open repo, for the per-repo custom-image row (null = no repo open). */
  repoPath: string | null;
}) {
  const { t } = useTranslation();
  const enabled = value === "container";
  const status = useContainerStatus({ nodeVersion, providers, enabled });
  const queryClient = useQueryClient();
  const [building, setBuilding] = useState(false);

  async function buildImage(force: boolean) {
    setBuilding(true);
    try {
      await prepareContainerSandbox(nodeVersion, providers, force);
      toast.success(force ? t("sandbox.imageRebuilt") : t("sandbox.imageBuilt"));
      await queryClient.invalidateQueries({
        queryKey: ["agentContainerStatus"],
      });
    } catch (e) {
      toastError(e);
    } finally {
      setBuilding(false);
    }
  }

  const toggleProvider = (id: AgentId, on: boolean) => {
    const next = on
      ? Array.from(new Set([...providers, id]))
      : providers.filter((p) => p !== id);
    if (next.length === 0) return; // keep at least one agent in the image
    onProviders(next);
  };

  return (
    <div className="space-y-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox
          checked={enabled}
          onCheckedChange={(c) =>
            onChange(c === true ? "container" : "worktree")
          }
        />
        {t("sandbox.runInContainer")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t("sandbox.description")}
      </p>
      {enabled && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{t("settingsAdvanced.nodeVersion")}</span>
              <Select
                items={NODE_VERSION_ITEMS}
                value={nodeVersion}
                onValueChange={(v) => v && onNodeVersion(v as NodeVersion)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("settingsAdvanced.nodeVersion")}
                  className="w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_VERSIONS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {NODE_VERSION_ITEMS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{t("settingsAdvanced.agents")}</span>
              {IMAGE_AGENT_IDS.map((id) => {
                const on = providers.includes(id);
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-1.5"
                  >
                    <Checkbox
                      checked={on}
                      // Can't uncheck the last remaining agent.
                      disabled={on && providers.length === 1}
                      onCheckedChange={(c) => toggleProvider(id, c === true)}
                    />
                    {IMAGE_AGENT_LABELS[id]}
                  </label>
                );
              })}
            </div>
          </div>
          <StatusLine
            status={status.data}
            loading={status.isLoading}
            building={building}
            onBuild={buildImage}
          />
          {repoPath && (
            <CustomImageSection
              repoPath={repoPath}
              basePresent={!!status.data?.imagePresent}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatusLine({
  status,
  loading,
  building,
  onBuild,
}: {
  status: ContainerStatus | undefined;
  loading: boolean;
  building: boolean;
  onBuild: (force: boolean) => void;
}) {
  const { t } = useTranslation();
  const buildBtn = (label: string, force: boolean) => (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={building}
      onClick={() => onBuild(force)}
      className="ml-2"
    >
      {building ? (
        <>
          <Spinner className="size-3" />
          {force ? t("sandbox.rebuilding") : t("sandbox.building")}
        </>
      ) : (
        label
      )}
    </Button>
  );

  if (loading) {
    return <Row tone="muted">{t("settingsAdvanced.checkingDockerPodman")}</Row>;
  }
  if (!status || !status.runtime) {
    return (
      <Row tone="warn">
        {t("sandbox.runtimeMissing")}
      </Row>
    );
  }
  if (!status.ready) {
    return (
      <Row tone="warn">
        {t("sandbox.engineStopped", { runtime: cap(status.runtime) })}
      </Row>
    );
  }
  if (!status.imagePresent) {
    return (
      <Row tone="muted">
        {t("sandbox.runtimeReadyBuild", { runtime: cap(status.runtime) })}
      {buildBtn(t("settingsAdvanced.buildImage"), false)}
      </Row>
    );
  }
  if (!status.imageMatches) {
    return (
      <Row tone="warn">
        {t("sandbox.imageOutdated")}
      {buildBtn(t("settingsAdvanced.rebuild"), true)}
      </Row>
    );
  }
  return (
    <Row tone="ok">
      {t("sandbox.imageReady", { runtime: cap(status.runtime) })}
      {buildBtn(t("settingsAdvanced.rebuildUpdate"), true)}
    </Row>
  );
}

type Tone = "ok" | "warn" | "muted";

/** Tone → semantic token. Success uses the app's green (matching the provider
 *  "Connected" line); warnings stay full-contrast; informational lines are muted. */
const TONE_CLASS: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-foreground",
  muted: "text-muted-foreground",
};

/** A status line: icon + text (never color alone). */
function Row({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CheckCircleIcon : WarningCircleIcon;
  return (
    <p className={`flex items-center gap-1.5 text-[11px] ${TONE_CLASS[tone]}`}>
      {tone !== "muted" && (
        <Icon weight="fill" className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

/** A compact `size="xs"` action button matching the base-image line's build buttons. */
function ActionButton({
  label,
  busyLabel,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  busyLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="ml-2 shrink-0"
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? (
        <>
          <Spinner className="size-3" />
          {busyLabel ?? t("sandbox.working")}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/**
 * A per-repo custom-image status line, shown below the base-image line when the active repo
 * ships a `.gitdesktop/agent.Dockerfile`. Mirrors the `Row` idiom (icon + text, never color
 * alone). The build runs the Dockerfile's arbitrary commands, so it is gated behind a review
 * dialog — the confirm-to-build guard against an untrusted repo.
 */
function CustomImageSection({
  repoPath,
  basePresent,
}: {
  repoPath: string;
  /** Whether the managed base image is built — the custom image is `FROM` it, so a build
   *  can't run until it exists. Scaffolding/reviewing stays available regardless. */
  basePresent: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["agentCustomImage", repoPath],
    queryFn: () => customImageStatus(repoPath),
    staleTime: 30_000,
    // A local file + container-runtime probe: react-query's default "online" mode
    // would park it offline.
    networkMode: "always",
  });
  const [busy, setBusy] = useState<"scaffold" | "build" | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["agentCustomImage", repoPath] });

  async function scaffold() {
    setBusy("scaffold");
    try {
      const created = await scaffoldCustomDockerfile(repoPath);
      toast.success(
        created
          ? t("sandbox.dockerfileAdded")
          : t("sandbox.dockerfileExists"),
      );
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function build(force: boolean) {
    setBusy("build");
    try {
      // Pass the reviewed contents so the backend refuses to build if the file changed on
      // disk since the dialog opened (only ever build what the user actually saw).
      await buildCustomImage(repoPath, status.data?.dockerfile ?? "", force);
      toast.success(force ? t("sandbox.customImageRebuilt") : t("sandbox.customImageBuilt"));
      setReviewOpen(false);
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  const data = status.data;
  if (!data) return null; // first load — the base line above already carries the state

  if (data.state === "none") {
    return (
      <Row tone="muted">
        {t("sandbox.baseImageDescription")}
        <ActionButton
          label={t("sandbox.addCustomTools")}
          busyLabel={t("sandbox.adding")}
          loading={busy === "scaffold"}
          disabled={busy !== null}
          onClick={scaffold}
        />
      </Row>
    );
  }

  const built = data.state === "built";
  const invalid = data.state === "invalid";
  const canBuild = !invalid; // "needsBuild" or "built"

  return (
    <>
      <Row tone={built ? "ok" : invalid ? "warn" : "muted"}>
        {invalid
          ? t("sandbox.dockerfileInvalid")
          : built
            ? t("sandbox.customImageInUse")
            : t("sandbox.customImageNotBuilt")}
        <ActionButton
          label={
            invalid
              ? t("sandbox.viewDockerfile")
              : built
                ? t("sandbox.viewRebuild")
                : t("sandbox.reviewBuild")
          }
          disabled={busy !== null}
          onClick={() => setReviewOpen(true)}
        />
      </Row>
      <ReviewDialog
        open={reviewOpen}
        onOpenChange={(o) => {
          if (busy !== "build") setReviewOpen(o);
        }}
        dockerfile={data.dockerfile ?? ""}
        error={data.error}
        canBuild={canBuild}
        basePresent={basePresent}
        built={built}
        building={busy === "build"}
        onBuild={() => build(built)}
      />
    </>
  );
}

/** The confirm-to-build review dialog: shows the Dockerfile (read-only) + a trust caution
 *  before running its build commands. The build action is omitted for an invalid file. */
function ReviewDialog({
  open,
  onOpenChange,
  dockerfile,
  error,
  canBuild,
  basePresent,
  built,
  building,
  onBuild,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dockerfile: string;
  error: string | null;
  canBuild: boolean;
  basePresent: boolean;
  built: boolean;
  building: boolean;
  onBuild: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {built ? t("sandbox.rebuildCustomTitle") : t("sandbox.buildCustomTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("sandbox.reviewDescription")}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="flex items-start gap-1.5 text-xs text-foreground">
            <WarningCircleIcon
              weight="fill"
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden
            />
            <span>{error}</span>
          </p>
        )}
        <pre className="max-h-72 overflow-auto whitespace-pre rounded-md border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
          {dockerfile}
        </pre>
        {canBuild && !basePresent && (
          <p className="flex items-start gap-1.5 text-xs text-foreground">
            <WarningCircleIcon
              weight="fill"
              className="mt-0.5 size-3.5 shrink-0"
              aria-hidden
            />
            <span>
              {t("sandbox.baseMustBuildFirst")}
            </span>
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={building}
            onClick={() => onOpenChange(false)}
          >
            {t("actions.cancel")}
          </Button>
          {canBuild && (
            <Button
              type="button"
              size="sm"
              disabled={building || !basePresent}
              onClick={onBuild}
            >
              {building ? (
                <>
                  <Spinner className="size-3" />
                  {built ? t("sandbox.rebuilding") : t("sandbox.building")}
                </>
              ) : built ? (
                t("sandbox.rebuildNoCache")
              ) : (
                t("settingsAdvanced.buildImage")
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
