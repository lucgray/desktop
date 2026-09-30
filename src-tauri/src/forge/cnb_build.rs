//! CNB Cloud Native Build API, using the shared CNB account transport.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest::{Method, Url};

use crate::error::{AppError, AppResult};
use crate::forge::cnb;

fn valid_build_id(value: &str) -> AppResult<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains(['/', '\\', '#', '?', '%'])
        || value.chars().any(char::is_control)
    {
        return Err(AppError::InvalidArgument("Invalid CNB build identifier.".into()));
    }
    Ok(())
}

fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> AppResult<T> {
    serde_json::from_value(value)
        .map_err(|error| AppError::Command(format!("Cannot read CNB build response: {error}")))
}

async fn read<T: serde::de::DeserializeOwned>(repo_path: &str, slug: &str, path: &str) -> AppResult<T> {
    decode(cnb::request_for_repo(repo_path, slug, Method::GET, path, None).await?)
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildListFilter {
    pub event: Option<String>,
    pub status: Option<String>,
    pub sha: Option<String>,
    pub sn: Option<String>,
    pub source_ref: Option<String>,
    pub target_ref: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPipeline {
    pub id: Option<String>,
    pub status: Option<String>,
    pub labels: Option<String>,
    pub create_time: Option<String>,
    pub duration: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSummary {
    pub sn: String,
    pub status: Option<String>,
    pub title: Option<String>,
    pub event: Option<String>,
    pub build_log_url: Option<String>,
    pub create_time: Option<String>,
    pub duration: Option<i64>,
    pub sha: Option<String>,
    pub slug: Option<String>,
    pub source_ref: Option<String>,
    pub target_ref: Option<String>,
    pub user_name: Option<String>,
    #[serde(default)]
    pub pipelines: Vec<BuildPipeline>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPage {
    #[serde(default)]
    pub data: Vec<BuildSummary>,
    pub total: Option<u64>,
    pub timestamp: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStage {
    pub id: Option<String>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub duration: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStatus {
    pub id: Option<String>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub duration: Option<i64>,
    #[serde(default)]
    pub stages: Vec<BuildStage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStatus {
    pub status: Option<String>,
    #[serde(default)]
    pub pipelines_status: HashMap<String, PipelineStatus>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDetail {
    pub summary: BuildSummary,
    pub status: BuildStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageLog {
    pub id: Option<String>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub duration: Option<i64>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    #[serde(default)]
    pub content: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBuildRequest {
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBuildResult {
    pub sn: Option<String>,
    pub build_log_url: Option<String>,
    pub message: Option<String>,
    pub success: Option<bool>,
}

async fn list_builds_for_slug(
    repo_path: &str,
    slug: &str,
    page: u32,
    page_size: u32,
    filter: &BuildListFilter,
) -> AppResult<BuildPage> {
    if page == 0 || !(1..=100).contains(&page_size) {
        return Err(AppError::InvalidArgument("Invalid CNB build page or page size.".into()));
    }
    let mut url = Url::parse("https://api.cnb.cool/-/build/logs")
        .map_err(|error| AppError::Command(format!("Invalid CNB build URL: {error}")))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("page", &page.to_string());
        query.append_pair("page_size", &page_size.to_string());
        for (key, value) in [
            ("event", &filter.event),
            ("status", &filter.status),
            ("sha", &filter.sha),
            ("sn", &filter.sn),
            ("sourceRef", &filter.source_ref),
            ("targetRef", &filter.target_ref),
        ] {
            if let Some(value) = value {
                query.append_pair(key, value);
            }
        }
    }
    let query = url.query().unwrap_or("");
    read(repo_path, slug, &format!("-/build/logs?{query}")).await
}

/// GET /{repo}/-/build/logs. Page numbers start at 1; page size is at most 100.
pub async fn list_builds(
    repo_path: &str,
    page: u32,
    page_size: u32,
    filter: &BuildListFilter,
) -> AppResult<BuildPage> {
    let slug = cnb::repo_slug(repo_path).await?;
    list_builds_for_slug(repo_path, &slug, page, page_size, filter).await
}

/// GET /{repo}/-/build/status/{sn}.
pub async fn get_build_status(repo_path: &str, sn: &str) -> AppResult<BuildStatus> {
    valid_build_id(sn)?;
    let slug = cnb::repo_slug(repo_path).await?;
    read(repo_path, &slug, &format!("-/build/status/{sn}")).await
}

/// CNB has no separate build-detail route. Combine its SN-filtered history row
/// with the live status, including pipeline and stage states.
pub async fn get_build_detail(repo_path: &str, sn: &str) -> AppResult<BuildDetail> {
    valid_build_id(sn)?;
    let slug = cnb::repo_slug(repo_path).await?;
    let filter = BuildListFilter {
        sn: Some(sn.to_string()),
        ..BuildListFilter::default()
    };
    let status_path = format!("-/build/status/{sn}");
    let (page, status) = tokio::try_join!(
        list_builds_for_slug(repo_path, &slug, 1, 1, &filter),
        read::<BuildStatus>(repo_path, &slug, &status_path)
    )?;
    let summary = page
        .data
        .into_iter()
        .find(|build| build.sn == sn)
        .ok_or_else(|| AppError::Command(format!("CNB build {sn} was not found.")))?;
    Ok(BuildDetail { summary, status })
}

/// GET /{repo}/-/build/logs/stage/{sn}/{pipelineId}/{stageId}.
pub async fn get_stage_log(
    repo_path: &str,
    sn: &str,
    pipeline_id: &str,
    stage_id: &str,
) -> AppResult<StageLog> {
    valid_build_id(sn)?;
    valid_build_id(pipeline_id)?;
    valid_build_id(stage_id)?;
    let slug = cnb::repo_slug(repo_path).await?;
    read(repo_path, &slug, &format!("-/build/logs/stage/{sn}/{pipeline_id}/{stage_id}")).await
}

/// POST /{repo}/-/build/start. Only api_trigger events are accepted by CNB.
pub async fn start_build(repo_path: &str, input: &StartBuildRequest) -> AppResult<StartBuildResult> {
    if input.event != "api_trigger"
        && !input
            .event
            .strip_prefix("api_trigger_")
            .is_some_and(|suffix| !suffix.is_empty())
    {
        return Err(AppError::InvalidArgument(
            "CNB build event must be api_trigger or start with api_trigger_.".into(),
        ));
    }
    let slug = cnb::repo_slug(repo_path).await?;
    let body = serde_json::to_value(input)
        .map_err(|error| AppError::Command(format!("Cannot encode CNB build request: {error}")))?;
    decode(cnb::request_for_repo(repo_path, &slug, Method::POST, "-/build/start", Some(body)).await?)
}

#[tauri::command]
pub async fn cnb_list_builds(
    repo_path: String,
    page: u32,
    page_size: u32,
    filter: BuildListFilter,
) -> AppResult<BuildPage> {
    list_builds(&repo_path, page, page_size, &filter).await
}

#[tauri::command]
pub async fn cnb_get_build_status(repo_path: String, sn: String) -> AppResult<BuildStatus> {
    get_build_status(&repo_path, &sn).await
}

#[tauri::command]
pub async fn cnb_get_stage_log(
    repo_path: String,
    sn: String,
    pipeline_id: String,
    stage_id: String,
) -> AppResult<StageLog> {
    get_stage_log(&repo_path, &sn, &pipeline_id, &stage_id).await
}

#[tauri::command]
pub async fn cnb_start_build(
    repo_path: String,
    input: StartBuildRequest,
) -> AppResult<StartBuildResult> {
    start_build(&repo_path, &input).await
}
