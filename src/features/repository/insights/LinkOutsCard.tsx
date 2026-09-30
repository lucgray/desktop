import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { forgeRepoUrl } from "@/lib/git/api";
import { useActiveGhHost } from "@/lib/git/host";
import { toastError } from "@/lib/toast";
import { type TranslationKey, useTranslation } from "@/lib/i18n";

// Insights surfaces GitHub only renders on the web (no usable API) — link out
// rather than show an empty panel. See [[api-hardstop-github-link]].
const LINKS: { label: TranslationKey; suffix: string; publicOnly?: boolean }[] = [
  { label: "insightsUi.linkPulse", suffix: "/pulse" },
  { label: "insightsUi.linkNetworkGraph", suffix: "/network" },
  // "Dependents" only exists for public repos that others depend on; it 404s otherwise.
  { label: "insightsUi.linkDependents", suffix: "/network/dependents", publicOnly: true },
  { label: "insightsUi.linkActionsUsage", suffix: "/actions/metrics/usage" },
  { label: "insightsUi.linkActionsPerformance", suffix: "/actions/metrics/performance" },
];

// GitLab's analytics equivalents also only render on the web. Branch-scoped
// pages (contributor graphs) are omitted — their URLs need a ref and don't
// redirect reliably.
const GITLAB_LINKS: { label: TranslationKey; suffix: string }[] = [
  { label: "insightsUi.linkActivity", suffix: "/activity" },
  { label: "insightsUi.linkCiAnalytics", suffix: "/-/pipelines/charts" },
  {
    label: "insightsUi.linkValueStreamAnalytics",
    suffix: "/-/analytics/value_stream_analytics",
  },
];

// Bitbucket's equivalents also only render on the web. It has no analytics
// dashboards, but these views (commits, branches, pipelines) have no usable API
// here — link out rather than show an empty panel.
const BITBUCKET_LINKS: { label: TranslationKey; suffix: string }[] = [
  { label: "insightsUi.commits", suffix: "/commits/" },
  { label: "insightsUi.branches", suffix: "/branches/" },
  { label: "insightsUi.pipelines", suffix: "/pipelines" },
  { label: "insightsUi.linkDeployments", suffix: "/deployments" },
];

export function GitLabLinkOutsCard({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  async function open(suffix: string) {
    try {
      const url = await forgeRepoUrl(repoPath);
      await openUrl(`${url}${suffix}`);
    } catch (e) {
      toastError(e);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("insightsUi.webOnlyInsights")}
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {GITLAB_LINKS.map((l) => (
          <Button
            key={l.label}
            variant="outline"
            size="sm"
            className="cursor-pointer justify-start"
            onClick={() => open(l.suffix)}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            {t(l.label)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function BitbucketLinkOutsCard({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  async function open(suffix: string) {
    try {
      const url = await forgeRepoUrl(repoPath);
      await openUrl(`${url}${suffix}`);
    } catch (e) {
      toastError(e);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("insightsUi.webOnlyViews")}
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {BITBUCKET_LINKS.map((l) => (
          <Button
            key={l.label}
            variant="outline"
            size="sm"
            className="cursor-pointer justify-start"
            onClick={() => open(l.suffix)}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            {t(l.label)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function LinkOutsCard({
  repoPath,
  isPublic,
}: {
  repoPath: string;
  isPublic?: boolean;
}) {
  const { t } = useTranslation();
  async function open(suffix: string) {
    try {
      const url = await forgeRepoUrl(repoPath);
      await openUrl(`${url}${suffix}`);
    } catch (e) {
      toastError(e);
    }
  }
  // Stars-over-time has no native GitHub page; star-history.com is the de-facto
  // tool, but it only covers github.com — hidden on Enterprise hosts.
  const host = useActiveGhHost();
  const canStarHistory = host === "github.com";
  async function openStars() {
    try {
      const url = await forgeRepoUrl(repoPath);
      const slug = url
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\/$/, "");
      await openUrl(`https://star-history.com/#${slug}&Date`);
    } catch (e) {
      toastError(e);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("insightsUi.webOnlyInsights")}
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {LINKS.filter((l) => !l.publicOnly || isPublic).map((l) => (
          <Button
            key={l.label}
            variant="outline"
            size="sm"
            className="cursor-pointer justify-start"
            onClick={() => open(l.suffix)}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            {t(l.label)}
          </Button>
        ))}
        {canStarHistory && (
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer justify-start"
            onClick={openStars}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            {t("insightsUi.starsOverTime")}
          </Button>
        )}
      </div>
    </div>
  );
}
