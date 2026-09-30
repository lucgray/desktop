import { useState } from "react";
import { DiffStat } from "@/components/diff-stat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  forgeFeatureReady,
  useCodeFrequency,
  useCommitActivity,
  useCommunityInsights,
  useContributorActivity,
  useForgeStatus,
  useForkActivity,
  usePunchCard,
  useRepoDependencies,
  useRepoTraffic,
} from "@/lib/git/queries";
import type { ContributorChurn } from "@/lib/git/types";
import { useWorkflowRuns } from "@/lib/github/actions";
import { useTranslation } from "@/lib/i18n";
import { CommunityCard } from "./CommunityCard";
import {
  ActionsDurationChart,
  CodeFrequencyChart,
  CommitActivityChart,
  type RunDurationPoint,
} from "./charts";
import { DependenciesCard } from "./DependenciesCard";
import { ForkActivityCard } from "./ForkActivityCard";
import {
  BitbucketLinkOutsCard,
  GitLabLinkOutsCard,
  LinkOutsCard,
} from "./LinkOutsCard";
import { PunchCard } from "./PunchCard";
import { Empty, fmt, InsightCard } from "./primitives";
import { TrafficCard } from "./TrafficCard";

const WINDOW_WEEKS = 52;

function ChartSkeleton() {
  return <Skeleton className="h-40 w-full" />;
}

/** Top contributors as an accessible bar-list (name + commits + line churn). */
function ContributorsList({ data }: { data: ContributorChurn[] }) {
  const top = data.slice(0, 12);
  const max = Math.max(1, ...top.map((c) => c.commits));
  return (
    <ul className="space-y-1.5">
      {top.map((c) => (
        <li key={c.name} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium" title={c.name}>
              {c.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {fmt(c.commits)} {c.commits === 1 ? "commit" : "commits"} ·{" "}
              <DiffStat
                added={c.additions}
                deleted={c.deletions}
                format={fmt}
              />
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(c.commits / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function durationMinutes(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  // ms → minutes (÷60_000), rounded to 2 decimals (×100 / round / ÷100).
  return Math.round(((e - s) / 60_000) * 100) / 100;
}

/**
 * The wide Insights board: the local-git graphs (commit activity, code
 * frequency, contributors, punch card) over a trailing window, plus a GitHub
 * Actions duration/success trend and a community-health card. All local data is
 * computed from the clone (works offline, on private repos, with no token).
 */
export function InsightsBoard({
  repoPath,
  active,
}: {
  repoPath: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [allTime, setAllTime] = useState(false);
  const weeks = allTime ? 0 : WINDOW_WEEKS;

  const gh = useForgeStatus(repoPath);
  // The hosted cards gate on the insights flag; the CI card is forge-backed
  // (GitLab pipelines work), while community / traffic / dependencies are
  // GitHub-only APIs with no GitLab analogue and hide per provider.
  const canGh = active && forgeFeatureReady(gh.data, "insights");
  const isGitLab = gh.data?.provider === "gitlab";
  const isBitbucket = gh.data?.provider === "bitbucket";
  // Positive gate: the community / traffic / dependencies cards are GitHub-only
  // APIs, so fire them ONLY for GitHub. A `!isGitLab` shape would (with insights
  // now enabled for Bitbucket) light them up on Bitbucket repos too.
  const canGhOnly = canGh && gh.data?.provider === "github";
  // Fork activity is hosted-but-all-forge (like CI), so it rides its own flag
  // rather than the GitHub-only gate; ahead/behind is a separate flag because
  // only GitHub can compare across forks.
  const canForks = active && forgeFeatureReady(gh.data, "forkActivity");
  const canCompare = forgeFeatureReady(gh.data, "forkCompare");
  const forkProvider = gh.data?.provider ?? null;

  // These are heavy (full-history git scans + gh calls); gate them on the
  // Insights tab being visible. <Activity> keeps this mounted while hidden but
  // does NOT defer React Query fetches, so without this gate they'd run on
  // every repo open even if the user never opens Insights.
  const commitActivity = useCommitActivity(repoPath, weeks, active);
  const codeFreq = useCodeFrequency(repoPath, weeks, active);
  const punchCard = usePunchCard(repoPath, weeks, active);
  const contributors = useContributorActivity(repoPath, weeks, active);
  const community = useCommunityInsights(repoPath, canGhOnly);
  const traffic = useRepoTraffic(repoPath, canGhOnly);
  const dependencies = useRepoDependencies(repoPath, canGhOnly);
  const forkActivity = useForkActivity(repoPath, canForks);
  const runs = useWorkflowRuns(repoPath, canGh, active);

  const completed = (runs.data ?? []).filter((r) => r.status === "completed");
  const successRate = completed.length
    ? Math.round(
        (100 * completed.filter((r) => r.conclusion === "success").length) /
          completed.length,
      )
    : null;
  const durationPoints: RunDurationPoint[] = completed
    .filter((r) => r.startedAt)
    .slice(0, 30)
    .reverse()
    .map((r) => ({
      run: `#${r.number}`,
      minutes: durationMinutes(r.startedAt, r.updatedAt),
      conclusion: r.conclusion || "—",
    }));

  return (
    // `h-full`, not `flex-1`: the tab host this mounts in is a block element, so
    // a flex-item sizing hint is inert there and the grid's natural height would
    // leak into the document instead of scrolling inside the board.
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between border-b p-2">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">
          {t("insightsUi.title")}
        </h2>
        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label={t("insightsUi.timeWindow")}
        >
          <Button
            type="button"
            size="xs"
            variant={allTime ? "ghost" : "secondary"}
            aria-pressed={!allTime}
            onClick={() => setAllTime(false)}
          >
            {t("insightsUi.weeks", { count: WINDOW_WEEKS })}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={allTime ? "secondary" : "ghost"}
            aria-pressed={allTime}
            onClick={() => setAllTime(true)}
          >
            {t("insightsUi.allTime")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <InsightCard title={t("insightsUi.commitActivity")}>
            {commitActivity.isPending ? (
              <ChartSkeleton />
            ) : commitActivity.data?.length ? (
              <CommitActivityChart data={commitActivity.data} />
            ) : (
              <Empty>{t("insightsUi.noCommitsWindow")}</Empty>
            )}
          </InsightCard>

          <InsightCard title={t("insightsUi.codeFrequency")}>
            {codeFreq.isPending ? (
              <ChartSkeleton />
            ) : codeFreq.data?.length ? (
              <CodeFrequencyChart data={codeFreq.data} />
            ) : (
              <Empty>{t("insightsUi.noCodeChangesWindow")}</Empty>
            )}
          </InsightCard>

          <InsightCard title={t("insightsUi.contributors")} className="xl:col-span-2">
            {contributors.isPending ? (
              <ChartSkeleton />
            ) : contributors.data?.length ? (
              <ContributorsList data={contributors.data} />
            ) : (
              <Empty>{t("insightsUi.noContributorsWindow")}</Empty>
            )}
          </InsightCard>

          <InsightCard title={t("insightsUi.commitsByDayHour")} className="xl:col-span-2">
            {punchCard.isPending ? (
              <ChartSkeleton />
            ) : punchCard.data ? (
              <PunchCard grid={punchCard.data} />
            ) : (
              <Empty>{t("insightsUi.noCommitTimes")}</Empty>
            )}
          </InsightCard>

          {canGh && (
            <InsightCard
              title={isGitLab || isBitbucket ? t("insightsUi.pipelines") : t("insightsUi.actions")}
              action={
                successRate !== null && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {t("insightsUi.successRuns", { rate: successRate, count: completed.length })}
                  </span>
                )
              }
            >
              {runs.isPending ? (
                <ChartSkeleton />
              ) : durationPoints.length ? (
                <ActionsDurationChart data={durationPoints} />
              ) : (
                <Empty>
{t("insightsUi.noCompletedRuns", { type: isGitLab || isBitbucket ? t("insightsUi.pipelinesLower") : t("insightsUi.workflowRuns") })}
                </Empty>
              )}
            </InsightCard>
          )}

          {canForks && forkProvider && (
            <InsightCard
              title={t("insightsUi.forkActivity")}
              action={
                forkActivity.data?.totalCount != null && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {fmt(forkActivity.data.totalCount)}{" "}
                    {t(forkActivity.data.totalCount === 1 ? "insightsUi.forkOne" : "insightsUi.forkMany", { count: fmt(forkActivity.data.totalCount) })}
                  </span>
                )
              }
            >
              {forkActivity.isPending ? (
                <ChartSkeleton />
              ) : forkActivity.data ? (
                <ForkActivityCard
                  repoPath={repoPath}
                  data={forkActivity.data}
                  provider={forkProvider}
                  canCompare={canCompare}
                />
              ) : (
                <Empty>{t("insightsUi.forkUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {canGhOnly && (
            <InsightCard title={t("insightsUi.community")}>
              {community.isPending ? (
                <ChartSkeleton />
              ) : community.data ? (
                <CommunityCard data={community.data} />
              ) : (
                <Empty>{t("insightsUi.communityUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {canGhOnly && (
            <InsightCard title={t("insightsUi.traffic")} className="xl:col-span-2">
              {traffic.isPending ? (
                <ChartSkeleton />
              ) : traffic.data ? (
                <TrafficCard data={traffic.data} />
              ) : (
                <Empty>{t("insightsUi.trafficUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {canGhOnly && (
            <InsightCard title={t("insightsUi.dependencies")}>
              {dependencies.isPending ? (
                <ChartSkeleton />
              ) : dependencies.data ? (
                <DependenciesCard data={dependencies.data} />
              ) : (
                <Empty>{t("insightsUi.dependenciesUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {canGhOnly && (
            <InsightCard title={t("insightsUi.moreOnProvider", { provider: "GitHub" })}>
              <LinkOutsCard
                repoPath={repoPath}
                isPublic={community.data ? !community.data.private : undefined}
              />
            </InsightCard>
          )}

          {canGh && isGitLab && (
            // GitLab analytics that only render on the web (no usable API) —
            // link out rather than pretend they don't exist.
            <InsightCard title={t("insightsUi.moreOnProvider", { provider: "GitLab" })}>
              <GitLabLinkOutsCard repoPath={repoPath} />
            </InsightCard>
          )}

          {canGh && isBitbucket && (
            // Bitbucket views that only render on the web (no usable API) —
            // link out rather than pretend they don't exist.
            <InsightCard title={t("insightsUi.moreOnProvider", { provider: "Bitbucket" })}>
              <BitbucketLinkOutsCard repoPath={repoPath} />
            </InsightCard>
          )}
        </div>
      </div>
    </div>
  );
}
