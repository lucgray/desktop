export interface CnbBuildListFilter {
  event?: string;
  status?: string;
  sha?: string;
  sn?: string;
  sourceRef?: string;
  targetRef?: string;
}

export interface CnbBuildPipeline {
  id: string | null;
  status: string | null;
  labels: string | null;
  createTime: string | null;
  duration: number | null;
}

export interface CnbBuildSummary {
  sn: string;
  status: string | null;
  title: string | null;
  event: string | null;
  buildLogUrl: string | null;
  createTime: string | null;
  duration: number | null;
  sha: string | null;
  slug: string | null;
  sourceRef: string | null;
  targetRef: string | null;
  userName: string | null;
  pipelines: CnbBuildPipeline[];
}

export interface CnbBuildPage {
  data: CnbBuildSummary[];
  total: number | null;
  timestamp: number | null;
}

export interface CnbBuildStage {
  id: string | null;
  name: string | null;
  status: string | null;
  duration: number | null;
}

export interface CnbPipelineStatus {
  id: string | null;
  name: string | null;
  status: string | null;
  duration: number | null;
  stages: CnbBuildStage[];
}

export interface CnbBuildStatus {
  status: string | null;
  pipelinesStatus: Record<string, CnbPipelineStatus>;
}

export interface CnbBuildDetail {
  summary: CnbBuildSummary;
  status: CnbBuildStatus;
}

export interface CnbStageLog {
  id: string | null;
  name: string | null;
  status: string | null;
  error: string | null;
  duration: number | null;
  startTime: number | null;
  endTime: number | null;
  content: string[];
}

export interface CnbStartBuildRequest {
  event: string;
  branch?: string;
  tag?: string;
  sha?: string;
  title?: string;
  env?: Record<string, string>;
}

export interface CnbStartBuildResult {
  sn: string | null;
  buildLogUrl: string | null;
  message: string | null;
  success: boolean | null;
}
