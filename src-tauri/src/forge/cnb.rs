//! CNB account and repository access through the documented OpenAPI.

use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri_plugin_http::reqwest::{self, Client, Method, Url};

use crate::error::{AppError, AppResult};
use crate::forge::model::{
    namespace_set, Capabilities, ForgeRepo, ForgeRepoList, ForgeStatus, Implemented, Provider,
};
use crate::forge::Forge;

const HOST: &str = "cnb.cool";
const API_BASE: &str = "https://api.cnb.cool/";
const TOKEN_KEY: &str = "token";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;

static CLIENT: OnceLock<Client> = OnceLock::new();
static CREDENTIAL_SEED_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static MIGRATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn client() -> AppResult<&'static Client> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = Client::builder()
        .user_agent(concat!("GitDesktop/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Command(format!("CNB HTTP client initialization failed: {e}")))?;
    Ok(CLIENT.get_or_init(|| built))
}

fn cnb_error(message: impl Into<String>) -> AppError {
    AppError::Command(format!("CNB: {}", message.into()))
}

async fn stored_token() -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(|| crate::secrets::read_forge_secret(HOST, TOKEN_KEY))
        .await
        .map_err(|e| cnb_error(format!("credential storage unavailable: {e}")))?
}

async fn migrate_legacy() -> AppResult<()> {
    let _guard = MIGRATION_LOCK.lock().await;
    let Some(token) = stored_token().await?.filter(|token| !token.is_empty()) else {
        return Ok(());
    };
    let identity = user(&token).await?;
    if identity.username.is_empty() {
        return Err(cnb_error("legacy account has no username; migration cannot continue"));
    }
    let previous = crate::forge::accounts::active(Provider::Cnb, HOST).await?;
    let existing = crate::forge::accounts::list().await?.into_iter().find(|account| {
        account.provider == Provider::Cnb && account.host == HOST && account.login == identity.username
    });
    if let Some(ref existing) = existing {
        if crate::forge::accounts::managed_token(existing).await? != token {
            return Err(cnb_error("legacy token conflicts with a managed account of the same login"));
        }
        if previous.is_none() {
            crate::forge::accounts::set_active(&existing.id).await?;
        }
    } else {
        crate::forge::accounts::add_managed(Provider::Cnb, HOST, &identity.username, None, &token).await?;
    }
    if let Some(previous) = previous {
        crate::forge::accounts::set_active(&previous.id).await?;
    }
    tauri::async_runtime::spawn_blocking(|| crate::secrets::delete_forge_secret(HOST, TOKEN_KEY))
        .await
        .map_err(|e| cnb_error(format!("legacy credential cleanup unavailable: {e}")))??;
    Ok(())
}

async fn active_account() -> AppResult<Option<crate::forge::accounts::AccountRecord>> {
    migrate_legacy().await?;
    crate::forge::accounts::active(Provider::Cnb, HOST).await
}

pub async fn account_for_repo(repo_path: &str) -> AppResult<crate::forge::accounts::AccountRecord> {
    migrate_legacy().await?;
    crate::forge::accounts::for_repo(Provider::Cnb, HOST, repo_path).await?
        .ok_or_else(|| cnb_error("No CNB account is selected for this repository"))
}

pub async fn account_info_for_repo(repo_path: &str) -> AppResult<CnbAccountInfo> {
    let token = token_for_repo(repo_path).await?;
    let identity = user(&token).await?;
    Ok(CnbAccountInfo { username: identity.username, nickname: identity.nickname })
}

async fn required_token() -> AppResult<String> {
    let account = active_account().await?
        .ok_or_else(|| cnb_error("No CNB account is connected. Add a CNB access token."))?;
    crate::forge::accounts::managed_token(&account).await
}

async fn token_for_repo(repo_path: &str) -> AppResult<String> {
    crate::forge::accounts::managed_token(&account_for_repo(repo_path).await?).await
}

async fn seed_token_for_url(token: &str, url: &str) -> AppResult<()> {
    let _guard = CREDENTIAL_SEED_LOCK.lock().await;
    if token.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
        return Err(cnb_error("stored access token contains invalid characters"));
    }
    let parsed = checked_git_url(url)?;
    let path = parsed.path().trim_start_matches('/');
    let key = format!("protocol=https\nhost={HOST}\npath={path}\nusername=cnb\n");
    let input = format!("{key}password={token}\n\n");
    crate::git::runner::run_git_input(
        None,
        &["-c", "credential.useHttpPath=true", "credential", "approve"],
        Some(&input),
        crate::git::runner::DEFAULT_TIMEOUT,
    )
    .await
    .map_err(|_| cnb_error("Git Credential Manager could not store the CNB credential"))?;

    // `approve` can exit successfully even with no credential helper configured.
    let lookup = format!("{key}\n");
    let filled = crate::git::runner::run_git_input(
        None,
        &["-c", "credential.useHttpPath=true", "-c", "credential.interactive=false", "credential", "fill"],
        Some(&lookup),
        crate::git::runner::DEFAULT_TIMEOUT,
    )
    .await
    .map_err(|_| cnb_error("Git Credential Manager did not return the CNB credential"))?;
    let expected = format!("password={token}");
    if !filled.stdout_lossy().lines().any(|line| line == expected) {
        return Err(cnb_error("Git Credential Manager returned a different CNB credential"));
    }
    Ok(())
}

pub async fn seed_git_credential_for_repo(repo_path: &str, url: &str) -> AppResult<()> {
    checked_git_url(url)?;
    let expected = repo_slug(repo_path).await?;
    let actual = crate::forge::remote_path(url)
        .ok_or_else(|| cnb_error("cannot read repository path from Git URL"))?;
    if expected != actual {
        return Err(cnb_error("Git URL does not match the repository origin"));
    }
    let token = token_for_repo(repo_path).await?;
    seed_token_for_url(&token, url).await
}

pub async fn seed_git_credential_for_clone(url: &str) -> AppResult<()> {
    checked_git_url(url)?;
    let token = required_token().await?;
    seed_token_for_url(&token, url).await
}

fn checked_git_url(url: &str) -> AppResult<Url> {
    let parsed = Url::parse(url).map_err(|_| cnb_error("invalid CNB Git URL"))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(HOST)
        || parsed.password().is_some() || (!parsed.username().is_empty() && parsed.username() != "cnb")
        || parsed.query().is_some() || parsed.fragment().is_some()
        || parsed.path().trim_matches('/').is_empty()
    {
        return Err(cnb_error("CNB Git URL must use HTTPS on cnb.cool without embedded credentials"));
    }
    Ok(parsed)
}

/// Keep credentials out of Git arguments and reject embedded URL passwords.
pub fn git_credential_entries(url: &str) -> AppResult<Vec<String>> {
    checked_git_url(url)?;
    Ok(vec![
        "credential.interactive=false".to_owned(),
        "credential.useHttpPath=true".to_owned(),
        "credential.username=cnb".to_owned(),
    ])
}

fn api_url(repo_slug: Option<&str>, path: &str) -> AppResult<Url> {
    let mut url = Url::parse(API_BASE).map_err(|e| cnb_error(e.to_string()))?;
    let (pathname, query) = path.split_once('?').map_or((path, None), |(p, q)| (p, Some(q)));
    let valid_segment = |segment: &str| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && !segment.chars().any(|c| matches!(c, '\\' | '#' | '?' | '%'))
    };
    if pathname.is_empty() || pathname.starts_with('/') || pathname.split('/').any(|s| !valid_segment(s)) {
        return Err(cnb_error("invalid API path"));
    }
    let mut parts = url.path_segments_mut().map_err(|_| cnb_error("invalid API base"))?;
    if let Some(slug) = repo_slug {
        if slug.split('/').count() < 2 || slug.split('/').any(|s| !valid_segment(s)) {
            return Err(cnb_error("invalid repository path"));
        }
        for segment in slug.split('/') {
            parts.push(segment);
        }
    }
    for segment in pathname.split('/') {
        parts.push(segment);
    }
    drop(parts);
    url.set_query(query);
    Ok(url)
}

async fn send(token: &str, method: Method, url: Url, body: Option<Value>) -> AppResult<Value> {
    let mut request = client()?
        .request(method, url)
        .bearer_auth(token)
        .header(reqwest::header::ACCEPT, "application/vnd.cnb.api+json, application/json");
    if let Some(body) = body {
        let encoded = serde_json::to_vec(&body)
            .map_err(|e| cnb_error(format!("cannot encode request body: {e}")))?;
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(encoded);
    }
    let response = request
        .send()
        .await
        .map_err(|e| cnb_error(format!("request failed: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        // Response bodies can echo request details. Do not surface or log them here.
        let detail = match status.as_u16() {
            401 => "access token is invalid or expired",
            403 => "access token lacks the required permission",
            404 => "repository or API resource was not found",
            429 => "API rate limit exceeded",
            _ => "API request failed",
        };
        return Err(cnb_error(format!("{detail} (HTTP {status})")));
    }
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(Value::Null);
    }
    let body = response
        .text()
        .await
        .map_err(|e| cnb_error(format!("cannot read API response: {e}")))?;
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body)
        .map_err(|e| cnb_error(format!("invalid API response: {e}")))
}

/// Repository calls use the bound account; an unbound repository uses the active account.
pub async fn request_for_repo(
    repo_path: &str,
    repo_slug: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> AppResult<Value> {
    let token = token_for_repo(repo_path).await?;
    send(&token, method, api_url(Some(repo_slug), path)?, body).await
}

async fn user(token: &str) -> AppResult<CnbUser> {
    let value = send(token, Method::GET, api_url(None, "user")?, None).await?;
    serde_json::from_value(value).map_err(|e| cnb_error(format!("invalid user response: {e}")))
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CnbAccountInfo {
    pub username: String,
    pub nickname: Option<String>,
}

#[derive(Deserialize)]
struct CnbUser {
    username: String,
    nickname: Option<String>,
}

/// Validate a token and add or update only the matching account.
pub async fn set_account(token: &str) -> AppResult<CnbAccountInfo> {
    let token = token.trim();
    if token.is_empty() {
        return Err(cnb_error("access token is empty"));
    }
    if token.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
        return Err(cnb_error("access token contains invalid characters"));
    }
    let identity = user(token).await?;
    if identity.username.is_empty() {
        return Err(cnb_error("user response has no username"));
    }
    migrate_legacy().await?;
    crate::forge::accounts::add_managed(Provider::Cnb, HOST, &identity.username, None, token).await?;
    Ok(CnbAccountInfo {
        username: identity.username,
        nickname: identity.nickname,
    })
}

pub async fn clear_account() -> AppResult<()> {
    let account = active_account().await?
        .ok_or_else(|| cnb_error("No CNB account is connected"))?;
    crate::forge::accounts::remove(&account.id).await?;
    Ok(())
}

/// Read the connected account without exposing the token.
pub async fn account() -> AppResult<Option<CnbAccountInfo>> {
    let Some(account) = active_account().await? else {
        return Ok(None);
    };
    let token = crate::forge::accounts::managed_token(&account).await?;
    let identity = user(&token).await?;
    Ok(Some(CnbAccountInfo {
        username: identity.username,
        nickname: identity.nickname,
    }))
}

pub struct CnbForge;

impl Forge for CnbForge {
    async fn status(&self, repo_path: &str) -> AppResult<ForgeStatus> {
        let repo = repo_slug(repo_path).await?;
        migrate_legacy().await?;
        let token = crate::forge::accounts::for_repo(Provider::Cnb, HOST, repo_path).await?;
        let (installed, authenticated, login) = match token {
            Some(account) => {
                let token = crate::forge::accounts::managed_token(&account).await?;
                let identity = user(&token).await?;
                (true, true, Some(identity.username))
            }
            _ => (false, false, None),
        };
        Ok(ForgeStatus {
            provider: Some(Provider::Cnb),
            installed,
            authenticated,
            repo: Some(repo),
            host: Some(HOST.to_owned()),
            login,
            capabilities: Capabilities::for_provider(Provider::Cnb),
            implemented: Implemented::for_provider(Provider::Cnb),
            probe_error: None,
        })
    }
}

/// The full CNB repository slug from the HTTPS origin URL.
pub async fn repo_slug(repo_path: &str) -> AppResult<String> {
    let remote = crate::git::remote::git_remote_url(repo_path.to_owned(), "origin".to_owned()).await?;
    checked_git_url(&remote)?;
    let slug = crate::forge::remote_path(&remote)
        .ok_or_else(|| cnb_error("cannot read repository path from origin"))?;
    api_url(Some(&slug), "-")?;
    Ok(slug)
}

#[derive(Deserialize)]
struct CnbRepo {
    path: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    visibility_level: String,
    #[serde(default)]
    status: i32,
    #[serde(default)]
    forked_from_repo: Option<Value>,
    #[serde(default)]
    last_updated_at: Option<CnbTime>,
}

#[derive(Deserialize)]
struct CnbTime {
    time: Option<String>,
    valid: bool,
}

fn convert_repo(repo: CnbRepo) -> AppResult<ForgeRepo> {
    let (owner, _) = repo.path.rsplit_once('/')
        .ok_or_else(|| cnb_error(format!("invalid repository path: {}", repo.path)))?;
    let owner = owner.to_owned();
    let mut url = api_url(Some(&repo.path), "-")?;
    url.set_host(Some(HOST)).map_err(|_| cnb_error("invalid CNB clone host"))?;
    let clone_url = url.as_str().trim_end_matches("/-").to_owned();
    Ok(ForgeRepo {
        full_name: repo.path,
        owner,
        name: repo.name,
        private: repo.visibility_level != "Public",
        archived: repo.status == 1,
        fork: repo.forked_from_repo.is_some_and(|value| !value.is_null()),
        clone_url,
        // CNB documents HTTPS only. An empty SSH URL must not invite a broken clone.
        ssh_url: String::new(),
        description: repo.description,
        pushed_at: repo.last_updated_at.and_then(|time| time.valid.then_some(time.time).flatten()),
    })
}

/// List every accessible repository; an API pagination cap is reported as an error.
pub async fn list_repos() -> AppResult<ForgeRepoList> {
    let token = required_token().await?;
    let viewer = user(&token).await?.username;
    let mut repos = Vec::new();
    for page in 1..=MAX_PAGES {
        let path = format!("user/repos?page={page}&page_size={PAGE_SIZE}&role=Guest&order_by=last_updated_at&desc=true");
        let value = send(&token, Method::GET, api_url(None, &path)?, None).await?;
        let batch: Vec<CnbRepo> = serde_json::from_value(value)
            .map_err(|e| cnb_error(format!("invalid repository list: {e}")))?;
        let last = batch.len() < PAGE_SIZE;
        for repo in batch {
            // CNB KeyStore repositories cannot be cloned to a local machine.
            if repo.visibility_level == "Secret" {
                continue;
            }
            repos.push(convert_repo(repo)?);
        }
        if last {
            return Ok(ForgeRepoList {
                owned_namespaces: namespace_set([viewer.clone()]),
                viewer,
                repos,
            });
        }
    }
    Err(cnb_error("repository list exceeds 100 pages; narrow the query before cloning"))
}

/// The authenticated user's personal namespace for clone-browser grouping.
pub async fn owned_namespaces() -> AppResult<Vec<String>> {
    let token = required_token().await?;
    let viewer = user(&token).await?.username;
    Ok(namespace_set([viewer]))
}
