import { invoke } from "@/lib/tauri/invoke";
import type {
  CnbBuildListFilter,
  CnbBuildDetail,
  CnbBuildPage,
  CnbStageLog,
  CnbStartBuildRequest,
  CnbStartBuildResult,
} from "../types/cnb-build";

// Command names and argument keys are the contract for the Rust command registration.
export const cnbListBuilds = (
  repoPath: string,
  page: number,
  pageSize: number,
  filter: CnbBuildListFilter = {},
) =>
  invoke<CnbBuildPage>("forge_cnb_build_list", {
    repoPath,
    page,
    pageSize,
    filter,
  });

export const cnbGetBuildDetail = (repoPath: string, sn: string) =>
  invoke<CnbBuildDetail>("forge_cnb_build_detail", { repoPath, sn });

export const cnbGetStageLog = (
  repoPath: string,
  sn: string,
  pipelineId: string,
  stageId: string,
) =>
  invoke<CnbStageLog>("forge_cnb_build_stage_log", {
    repoPath,
    sn,
    pipelineId,
    stageId,
  });

export const cnbStartBuild = (repoPath: string, input: CnbStartBuildRequest) =>
  invoke<CnbStartBuildResult>("forge_cnb_build_start", { repoPath, input });
