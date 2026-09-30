import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import {
  currentMonitor,
  getCurrentWindow,
  type Monitor,
} from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { CopyIconButton } from "@/components/CopyIconButton";
import { PathText } from "@/components/path-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n";
import type { AuthStatus } from "@/lib/ai/agent";
import {
  cliFloorWarning,
  type ToolStatus,
  useSystemHealth,
} from "@/lib/system/health";

/** Per-tool display metadata. `auth` marks tools that have a login concept;
 *  git (always local) doesn't. */
const TOOL_META: Record<
  string,
  { name: string; install: string; auth: boolean; role: string }
> = {
  git: {
    name: "Git",
    install: "https://git-scm.com/downloads",
    auth: false,
    role: "remainingUi.aboutRequiredGit",
  },
  gh: {
    name: "GitHub CLI",
    install: "https://cli.github.com",
    auth: true,
    role: "remainingUi.aboutGithubCli",
  },
  glab: {
    name: "GitLab CLI",
    install: "https://gitlab.com/gitlab-org/cli",
    auth: true,
    role: "remainingUi.aboutGitlabCli",
  },
  claude: {
    name: "Claude Code",
    install: "https://docs.anthropic.com/en/docs/claude-code/overview",
    auth: true,
    role: "remainingUi.aboutClaude",
  },
  codex: {
    name: "Codex CLI",
    install: "https://developers.openai.com/codex/cli/",
    auth: true,
    role: "remainingUi.aboutCodex",
  },
  copilot: {
    name: "GitHub Copilot CLI",
    install: "https://github.com/github/copilot-cli",
    // No non-interactive auth-status command, so login state stays Unknown.
    auth: false,
    role: "remainingUi.aboutCopilot",
  },
  opencode: {
    name: "opencode",
    install: "https://opencode.ai",
    // No non-interactive auth-status command, so login state stays Unknown.
    auth: false,
    role: "remainingUi.aboutOpenCode",
  },
};

function AuthState({ authed }: { authed: AuthStatus }) {
  const { t } = useTranslation();
  if (authed === "authed") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <CheckCircleIcon weight="fill" className="size-3 text-success" />
        {t("settings.signedIn")}
      </span>
    );
  }
  if (authed === "notAuthed") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <WarningCircleIcon weight="fill" className="size-3 text-warning" />
        {t("settings.notSignedIn")}
      </span>
    );
  }
  return null;
}

function ToolRow({ tool }: { tool: ToolStatus }) {
  const { t } = useTranslation();
  const meta = TOOL_META[tool.id];
  if (!meta) return null;
  // An installed-but-too-old tool gets the same install link as a missing one,
  // since the fix is the same download.
  const floorWarning = tool.found
    ? cliFloorWarning(tool.id, tool.version)
    : null;
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {tool.found ? (
            <CheckCircleIcon
              weight="fill"
              className="size-3.5 shrink-0 text-success"
            />
          ) : (
            <WarningCircleIcon
              weight="fill"
              className="size-3.5 shrink-0 text-warning"
            />
          )}
          <span className="font-medium">{meta.name}</span>
          <span className="text-muted-foreground">
            {tool.found ? t("remainingUi.installed") : t("remainingUi.notFound")}
          </span>
          {meta.auth && tool.found && <AuthState authed={tool.authed} />}
        </p>
        {tool.found ? (
          // Flex row, not one truncating line: PathText is a flex box, so the
          // version has to be a sibling item rather than inline text. Spacing
          // rides `gap-1` because a flex line box trims a collapsible space,
          // and both text items shrink so a long version banner truncates
          // rather than pushing the path out of the row.
          <p className="flex min-w-0 gap-1 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">
              {tool.version ?? "version unknown"}
            </span>
            {tool.path ? (
              <>
                <span className="shrink-0">·</span>
                <PathText path={tool.path} className="font-mono" />
              </>
            ) : null}
          </p>
        ) : (
          <p className="truncate text-[11px] text-muted-foreground">
            {t(meta.role as import("@/lib/i18n").TranslationKey)}
          </p>
        )}
        {floorWarning ? (
          <p className="text-[11px] text-warning">{floorWarning}</p>
        ) : null}
      </div>
      {!tool.found || floorWarning ? (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 cursor-pointer"
          onClick={() => openUrl(meta.install)}
        >
          {tool.found ? t("remainingUi.update") : t("remainingUi.install")}
          <ArrowSquareOutIcon data-icon="inline-end" />
        </Button>
      ) : null}
    </li>
  );
}

interface WindowGeo {
  x: number;
  y: number;
  width: number;
  height: number;
  monitor: Monitor | null;
}

/**
 * The window's live outer position, size, and monitor — physical (device)
 * pixels, which is what the OS reports and what a multi-monitor user would paste
 * back to position the app. Updates as the window is moved or resized; the
 * monitor is re-read on move since dragging across displays changes it.
 */
function useWindowGeometry(): WindowGeo | null {
  const [geo, setGeo] = useState<WindowGeo | null>(null);
  useEffect(() => {
    const win = getCurrentWindow();
    let active = true;
    const unlisteners: Array<() => void> = [];
    const track = (p: Promise<() => void>) =>
      p
        .then((u) => (active ? unlisteners.push(u) : u()))
        .catch(() => undefined);

    Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()])
      .then(([pos, size, monitor]) => {
        if (active)
          setGeo({
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
            monitor,
          });
      })
      .catch(() => undefined);

    track(
      win.onMoved(({ payload }) => {
        setGeo((g) => (g ? { ...g, x: payload.x, y: payload.y } : g));
        // Crossing displays changes the active monitor (and its scale factor).
        currentMonitor()
          .then((m) => active && setGeo((g) => (g ? { ...g, monitor: m } : g)))
          .catch(() => undefined);
      }),
    );
    track(
      win.onResized(({ payload }) => {
        setGeo((g) =>
          g ? { ...g, width: payload.width, height: payload.height } : g,
        );
      }),
    );

    return () => {
      active = false;
      for (const u of unlisteners) u();
    };
  }, []);
  return geo;
}

/**
 * Settings → About: app/OS info plus the status of every external CLI
 * GitDesktop relies on (installed?, version, path, sign-in), with a download
 * link for any that are missing or too old for a feature that needs them.
 */
export function AboutSection() {
  const { t } = useTranslation();
  const health = useSystemHealth();
  const geo = useWindowGeometry();
  const appInfo = useQuery({
    queryKey: ["app-info"] as const,
    queryFn: async () => ({
      version: await getVersion(),
      tauri: await getTauriVersion(),
    }),
    staleTime: Number.POSITIVE_INFINITY,
    // A local read: react-query's default "online" mode would park it offline.
    networkMode: "always",
  });

  const sys = health.data?.system;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">{t("settings.about")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.aboutDescription")}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t("settings.appVersion")}</dt>
        <dd className="font-mono">{appInfo.data?.version ?? "…"}</dd>
        <dt className="text-muted-foreground">{t("settings.operatingSystem")}</dt>
        <dd>{sys ? `${sys.os} ${sys.osVersion} (${sys.arch})` : "…"}</dd>
        <dt className="text-muted-foreground">{t("settings.tauriRuntime")}</dt>
        <dd className="font-mono">{appInfo.data?.tauri ?? "…"}</dd>
        <dt className="text-muted-foreground">{t("settings.windowPosition")}</dt>
        <dd className="flex items-center gap-1.5 font-mono">
          {geo ? `${geo.x}, ${geo.y}` : "…"}
          {geo && (
            <CopyIconButton
              text={`x=${geo.x} y=${geo.y} w=${geo.width} h=${geo.height}`}
              label={t("settings.copyCoordinates")}
              toast={t("remainingUi.windowCoordinatesCopied")}
              // Pulls the 24px hit target back to the row's 16px text line so the
              // value keeps its label's baseline and the grid's row rhythm.
              className="-my-1"
            />
          )}
        </dd>
        <dt className="text-muted-foreground">{t("settings.windowSize")}</dt>
        <dd className="font-mono">
          {geo ? `${geo.width} × ${geo.height}` : "…"}
        </dd>
        <dt className="text-muted-foreground">{t("settings.display")}</dt>
        <dd>
          {geo?.monitor ? (
            <>
              {geo.monitor.name || t("settings.primaryDisplay")}
              <span className="text-muted-foreground">
                {" · scale ×"}
                {geo.monitor.scaleFactor}
              </span>
            </>
          ) : (
            "…"
          )}
        </dd>
      </dl>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("settings.components")}
          </h3>
          <Button
            variant="ghost"
            size="xs"
            disabled={health.isFetching}
            onClick={() => health.refetch()}
          >
            {health.isFetching ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ArrowClockwiseIcon data-icon="inline-start" />
            )}
            {t("settings.recheck")}
          </Button>
        </div>
        {health.isPending ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : health.isError ? (
          <p className="py-2 text-xs text-muted-foreground">
            {t("settings.healthCheckFailed")}
          </p>
        ) : (
          <ul className="divide-y">
            {health.data?.tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
