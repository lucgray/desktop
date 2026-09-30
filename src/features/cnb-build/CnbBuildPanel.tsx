import { ArrowClockwiseIcon, PlayIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  cnbGetBuildDetail,
  cnbGetStageLog,
  cnbListBuilds,
  cnbStartBuild,
} from "@/lib/git/api/cnb-build";
import type {
  CnbBuildStage,
  CnbBuildSummary,
  CnbStartBuildRequest,
} from "@/lib/git/types/cnb-build";
import { useTranslation } from "@/lib/i18n";
import { useRovingRows } from "@/lib/list-keyboard-nav";
import { errorMessage } from "@/lib/tauri/invoke";

const copy = {
  en: {
    title: "CNB builds",
    refresh: "Refresh",
    start: "Run build",
    loading: "Loading builds…",
    empty: "No builds found",
    loadError: "Could not load builds",
    statusError: "Could not load build status",
    logError: "Could not load stage log",
    retry: "Retry",
    previous: "Previous",
    next: "Next",
    page: "Page",
    total: "Total",
    detail: "Build details",
    stages: "Stages",
    log: "Stage log",
    selectBuild: "Select a build to inspect its stages",
    selectStage: "Select a stage to read its log",
    noStages: "No stage details available",
    noLog: "No log output",
    pipeline: "Pipeline",
    branch: "Branch",
    tag: "Tag",
    sha: "Commit SHA",
    event: "Trigger event",
    buildTitle: "Title",
    env: "Environment variables",
    envHint: "JSON object with string values",
    invalidEnv: "Enter a JSON object with string values",
    requiredEvent: "Enter a trigger event",
    cancel: "Cancel",
    running: "Starting…",
    started: "Build started",
    startError: "Could not start build",
    unknown: "Unknown",
    pending: "Pending",
    runningStatus: "Running",
    success: "Succeeded",
    failed: "Failed",
    canceled: "Canceled",
    skipped: "Skipped",
  },
  "zh-CN": {
    title: "CNB 构建",
    refresh: "刷新",
    start: "手动触发",
    loading: "正在加载构建…",
    empty: "暂无构建记录",
    loadError: "加载构建失败",
    statusError: "加载构建状态失败",
    logError: "加载阶段日志失败",
    retry: "重试",
    previous: "上一页",
    next: "下一页",
    page: "页",
    total: "共",
    detail: "构建详情",
    stages: "执行阶段",
    log: "阶段日志",
    selectBuild: "选择一条构建记录查看阶段",
    selectStage: "选择一个阶段查看日志",
    noStages: "暂无阶段信息",
    noLog: "暂无日志",
    pipeline: "流水线",
    branch: "分支",
    tag: "标签",
    sha: "提交 SHA",
    event: "触发事件",
    buildTitle: "构建标题",
    env: "环境变量",
    envHint: "输入字符串值组成的 JSON 对象",
    invalidEnv: "请输入值为字符串的 JSON 对象",
    requiredEvent: "请输入触发事件",
    cancel: "取消",
    running: "正在触发…",
    started: "构建已触发",
    startError: "触发构建失败",
    unknown: "未知",
    pending: "等待中",
    runningStatus: "运行中",
    success: "成功",
    failed: "失败",
    canceled: "已取消",
    skipped: "已跳过",
  },
} as const;

type Copy = (typeof copy)["en"] | (typeof copy)["zh-CN"];
type StageRow = { pipelineId: string; stage: CnbBuildStage; key: string };

function statusText(status: string | null, labels: Copy) {
  if (!status) return labels.unknown;
  switch (status.toLowerCase()) {
    case "pending":
    case "queued":
    case "waiting":
      return labels.pending;
    case "running":
    case "in_progress":
      return labels.runningStatus;
    case "success":
    case "succeeded":
    case "completed":
      return labels.success;
    case "failed":
    case "failure":
    case "error":
      return labels.failed;
    case "canceled":
    case "cancelled":
      return labels.canceled;
    case "skipped":
      return labels.skipped;
    default:
      return status;
  }
}

function statusVariant(status: string | null): "destructive" | "secondary" {
  return ["failed", "failure", "error"].includes(status?.toLowerCase() ?? "")
    ? "destructive"
    : "secondary";
}

function buildTime(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function parseEnv(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((item) => typeof item !== "string")
  ) {
    throw new Error("Invalid environment variables");
  }
  return parsed as Record<string, string>;
}

function StartBuildDialog({
  repoPath,
  open,
  onOpenChange,
  onStarted,
  labels,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (sn: string | null) => void;
  labels: Copy;
}) {
  const id = useId();
  const [event, setEvent] = useState("api_trigger");
  const [branch, setBranch] = useState("");
  const [tag, setTag] = useState("");
  const [sha, setSha] = useState("");
  const [title, setTitle] = useState("");
  const [envText, setEnvText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!event.trim()) {
      setError(labels.requiredEvent);
      return;
    }
    let env: Record<string, string> | undefined;
    try {
      env = parseEnv(envText);
    } catch (cause) {
      console.error("CNB build environment could not be parsed", cause);
      setError(labels.invalidEnv);
      return;
    }
    const input: CnbStartBuildRequest = {
      event: event.trim(),
      ...(branch.trim() && { branch: branch.trim() }),
      ...(tag.trim() && { tag: tag.trim() }),
      ...(sha.trim() && { sha: sha.trim() }),
      ...(title.trim() && { title: title.trim() }),
      ...(env && { env }),
    };
    setError(null);
    setSubmitting(true);
    try {
      const result = await cnbStartBuild(repoPath, input);
      if (result.success === false)
        throw new Error(result.message ?? labels.startError);
      toast.success(result.message || labels.started);
      onOpenChange(false);
      onStarted(result.sn);
    } catch (cause) {
      console.error("CNB build start failed", cause);
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.start}</DialogTitle>
          <DialogDescription>{repoPath}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor={`${id}-event`}>{labels.event}</Label>
              <Input
                id={`${id}-event`}
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-branch`}>{labels.branch}</Label>
              <Input
                id={`${id}-branch`}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-tag`}>{labels.tag}</Label>
              <Input
                id={`${id}-tag`}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-sha`}>{labels.sha}</Label>
              <Input
                id={`${id}-sha`}
                value={sha}
                onChange={(e) => setSha(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-title`}>{labels.buildTitle}</Label>
              <Input
                id={`${id}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor={`${id}-env`}>{labels.env}</Label>
              <Textarea
                id={`${id}-env`}
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder='{"KEY":"value"}'
                spellCheck={false}
                className="font-mono"
                aria-describedby={`${id}-env-hint`}
              />
              <p
                id={`${id}-env-hint`}
                className="text-xs text-muted-foreground"
              >
                {labels.envHint}
              </p>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? labels.running : labels.start}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mount on a CNB repository surface. The parent owns provider gating and route registration. */
export function CnbBuildPanel({
  repoPath,
  active = true,
  pageSize = 20,
  refreshIntervalMs = 10000,
}: {
  repoPath: string;
  active?: boolean;
  pageSize?: number;
  refreshIntervalMs?: number;
}) {
  const { locale } = useTranslation();
  const labels = copy[locale];
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{
    repoPath: string;
    sn: string;
  } | null>(null);
  const [selectedStage, setSelectedStage] = useState<{
    sn: string;
    pipelineId: string;
    stageId: string;
  } | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const selectedSn = selected?.repoPath === repoPath ? selected.sn : null;
  const buildKey = ["repo", repoPath, "cnb-builds"] as const;
  const builds = useQuery({
    queryKey: [...buildKey, page, pageSize],
    queryFn: () => cnbListBuilds(repoPath, page, pageSize),
    enabled: active,
    refetchInterval:
      active && refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });
  const detail = useQuery({
    queryKey: [...buildKey, "detail", selectedSn],
    queryFn: () => cnbGetBuildDetail(repoPath, selectedSn as string),
    enabled: active && selectedSn !== null,
    refetchInterval:
      active && selectedSn && refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });
  const rows = builds.data?.data ?? [];
  const selectedBuild =
    detail.data?.summary ?? rows.find((row) => row.sn === selectedSn) ?? null;
  const buildNav = useRovingRows({
    items: rows,
    rowKey: (row: CnbBuildSummary) => row.sn,
  });
  const stageRows: StageRow[] = Object.entries(
    detail.data?.status.pipelinesStatus ?? {},
  ).flatMap(([pipelineId, pipeline]) =>
    pipeline.stages.flatMap((stage) =>
      stage.id
        ? [{ pipelineId, stage, key: JSON.stringify([pipelineId, stage.id]) }]
        : [],
    ),
  );
  const stageNav = useRovingRows({
    items: stageRows,
    rowKey: (row: StageRow) => row.key,
  });
  const activeStage = selectedStage?.sn === selectedSn ? selectedStage : null;
  const log = useQuery({
    queryKey: [
      ...buildKey,
      "log",
      selectedSn,
      activeStage?.pipelineId,
      activeStage?.stageId,
    ],
    queryFn: () =>
      cnbGetStageLog(
        repoPath,
        selectedSn as string,
        activeStage?.pipelineId as string,
        activeStage?.stageId as string,
      ),
    enabled: active && selectedSn !== null && activeStage !== null,
  });
  const total = builds.data?.total;
  const hasNext =
    total === null || total === undefined
      ? rows.length === pageSize
      : page * pageSize < total;

  function chooseBuild(sn: string) {
    setSelected({ repoPath, sn });
    setSelectedStage(null);
  }

  async function refresh() {
    try {
      await queryClient.invalidateQueries({ queryKey: buildKey });
    } catch (cause) {
      console.error("CNB builds refresh failed", cause);
      toast.error(errorMessage(cause));
    }
  }

  function started(sn: string | null) {
    setPage(1);
    if (sn) chooseBuild(sn);
    void refresh();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={labels.title}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">{labels.title}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={builds.isFetching}
          >
            <ArrowClockwiseIcon /> {labels.refresh}
          </Button>
          <Button size="sm" onClick={() => setStartOpen(true)}>
            <PlayIcon /> {labels.start}
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(15rem,35%)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            onKeyDown={buildNav.onRowKeyDown}
          >
            {builds.isPending && (
              <p className="p-4 text-xs text-muted-foreground">
                {labels.loading}
              </p>
            )}
            {builds.isError && (
              <div className="space-y-2 p-4 text-xs" role="alert">
                <p className="text-destructive">
                  {labels.loadError}: {errorMessage(builds.error)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void builds.refetch()}
                >
                  {labels.retry}
                </Button>
              </div>
            )}
            {builds.isSuccess && rows.length === 0 && (
              <p className="p-4 text-xs text-muted-foreground">
                {labels.empty}
              </p>
            )}
            {rows.map((build) => (
              <button
                key={build.sn}
                type="button"
                {...buildNav.rowProps(build)}
                onClick={() => chooseBuild(build.sn)}
                aria-current={selectedSn === build.sn ? "true" : undefined}
                className="flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring aria-current:bg-muted"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {build.title || `#${build.sn}`}
                  </span>
                  <Badge variant={statusVariant(build.status)}>
                    {statusText(build.status, labels)}
                  </Badge>
                </span>
                <span className="flex justify-between gap-2 text-muted-foreground">
                  <span className="truncate">
                    #{build.sn} ·{" "}
                    {build.sourceRef || build.event || labels.unknown}
                  </span>
                  <time className="shrink-0">
                    {buildTime(build.createTime, locale)}
                  </time>
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
            <span className="text-muted-foreground">
              {labels.page} {page}
              {total !== null && total !== undefined
                ? ` · ${labels.total} ${total}`
                : ""}
            </span>
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {labels.previous}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!hasNext}
                onClick={() => setPage((value) => value + 1)}
              >
                {labels.next}
              </Button>
            </div>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          {!selectedSn && (
            <p className="text-xs text-muted-foreground">
              {labels.selectBuild}
            </p>
          )}
          {selectedSn && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {selectedBuild?.title || `${labels.detail} #${selectedSn}`}
                </h3>
                <Badge
                  variant={statusVariant(
                    detail.data?.status.status ?? selectedBuild?.status ?? null,
                  )}
                >
                  {statusText(
                    detail.data?.status.status ?? selectedBuild?.status ?? null,
                    labels,
                  )}
                </Badge>
                {selectedBuild?.sha && (
                  <code className="text-xs text-muted-foreground">
                    {selectedBuild.sha.slice(0, 12)}
                  </code>
                )}
              </div>
              {detail.isPending && (
                <p className="text-xs text-muted-foreground">
                  {labels.loading}
                </p>
              )}
              {detail.isError && (
                <div role="alert" className="space-y-2 text-xs">
                  <p className="text-destructive">
                    {labels.statusError}: {errorMessage(detail.error)}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void detail.refetch()}
                  >
                    {labels.retry}
                  </Button>
                </div>
              )}
              {detail.isSuccess && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold">{labels.stages}</h4>
                  <div onKeyDown={stageNav.onRowKeyDown} className="space-y-3">
                    {Object.entries(detail.data.status.pipelinesStatus).map(
                      ([pipelineId, pipeline]) => (
                        <div
                          key={pipelineId}
                          className="space-y-1 border border-border p-2"
                        >
                          <div className="flex items-center justify-between gap-2 px-1 text-xs">
                            <span className="font-medium">
                              {pipeline.name ||
                                `${labels.pipeline} ${pipelineId}`}
                            </span>
                            <Badge variant={statusVariant(pipeline.status)}>
                              {statusText(pipeline.status, labels)}
                            </Badge>
                          </div>
                          <div>
                            {pipeline.stages.map((stage, index) => {
                              const stageId = stage.id;
                              const row = stageId
                                ? {
                                    pipelineId,
                                    stage,
                                    key: JSON.stringify([pipelineId, stageId]),
                                  }
                                : null;
                              return (
                                <button
                                  key={stageId ?? index}
                                  type="button"
                                  {...(row ? stageNav.rowProps(row) : {})}
                                  disabled={!stageId}
                                  onClick={() =>
                                    stageId &&
                                    setSelectedStage({
                                      sn: selectedSn,
                                      pipelineId,
                                      stageId,
                                    })
                                  }
                                  aria-current={
                                    activeStage?.pipelineId === pipelineId &&
                                    activeStage.stageId === stageId
                                      ? "true"
                                      : undefined
                                  }
                                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring aria-current:bg-muted disabled:opacity-60"
                                >
                                  <span className="truncate">
                                    {stage.name ||
                                      stageId ||
                                      `${labels.stages} ${index + 1}`}
                                  </span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {statusText(stage.status, labels)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  {stageRows.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {labels.noStages}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold">{labels.log}</h4>
                {!activeStage && (
                  <p className="text-xs text-muted-foreground">
                    {labels.selectStage}
                  </p>
                )}
                {activeStage && log.isPending && (
                  <p className="text-xs text-muted-foreground">
                    {labels.loading}
                  </p>
                )}
                {activeStage && log.isError && (
                  <div role="alert" className="space-y-2 text-xs">
                    <p className="text-destructive">
                      {labels.logError}: {errorMessage(log.error)}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void log.refetch()}
                    >
                      {labels.retry}
                    </Button>
                  </div>
                )}
                {activeStage && log.isSuccess && (
                  <pre className="max-h-96 overflow-auto border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-all select-text">
                    {log.data.content.join("\n") ||
                      log.data.error ||
                      labels.noLog}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <StartBuildDialog
        repoPath={repoPath}
        open={startOpen}
        onOpenChange={setStartOpen}
        onStarted={started}
        labels={labels}
      />
    </section>
  );
}
