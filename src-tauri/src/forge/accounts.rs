//! Shared account identities and repository bindings for hosted providers.
//! Secrets remain in the OS keyring; the app-data index contains identities only.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::forge::model::Provider;

const INDEX_FILE: &str = "forge-accounts.json";
static INDEX_LOCK: Mutex<()> = Mutex::const_new(());
pub static GIT_NETWORK_IDENTITY_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountSource {
    Cli,
    Managed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    pub id: String,
    pub provider: Provider,
    pub host: String,
    pub login: String,
    pub source: AccountSource,
    pub email: Option<String>,
    secret_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub provider: Provider,
    pub host: String,
    pub login: String,
    pub source: AccountSource,
    pub email: Option<String>,
    pub is_active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountTarget {
    pub provider: Provider,
    pub host: String,
}

impl From<AccountRecord> for AccountView {
    fn from(record: AccountRecord) -> Self {
        Self {
            id: record.id, provider: record.provider, host: record.host,
            login: record.login, source: record.source, email: record.email,
            is_active: false,
        }
    }
}

#[derive(Default, Deserialize, Serialize)]
struct AccountIndex {
    #[serde(default)]
    accounts: Vec<AccountRecord>,
    #[serde(default)]
    active: HashMap<String, String>,
    #[serde(default)]
    bindings: HashMap<String, String>,
}

fn host_key(provider: Provider, host: &str) -> String {
    format!("{}:{}", provider_name(provider), host.to_ascii_lowercase())
}

fn provider_name(provider: Provider) -> &'static str {
    match provider {
        Provider::GitHub => "github",
        Provider::GitLab => "gitlab",
        Provider::Bitbucket => "bitbucket",
        Provider::Cnb => "cnb",
    }
}

fn repo_key(path: &str) -> AppResult<String> {
    let canonical = std::fs::canonicalize(Path::new(path))
        .map_err(|e| AppError::InvalidArgument(format!("Cannot open repository path: {e}")))?;
    let normalized = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let normalized = normalized.to_lowercase();
    Ok(normalized)
}

fn load_index() -> AppResult<AccountIndex> {
    let path = index_path()?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(AccountIndex::default()),
        Err(e) => return Err(AppError::Io(e)),
    };
    serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Command(format!("Account index is unreadable: {e}")))
}

fn save_index(index: &AccountIndex) -> AppResult<()> {
    let json = serde_json::to_vec(index)
        .map_err(|e| AppError::Command(format!("Cannot save account index: {e}")))?;
    crate::fsops::atomic_write(&index_path()?, &json)
}

fn index_path() -> AppResult<std::path::PathBuf> {
    dirs::data_dir()
        .map(|root| root.join(crate::local_prs::APP_IDENTIFIER).join(INDEX_FILE))
        .ok_or_else(|| AppError::Command("Cannot resolve app-data directory".into()))
}

async fn read_index() -> AppResult<AccountIndex> {
    tauri::async_runtime::spawn_blocking(load_index)
        .await
        .map_err(|e| AppError::Command(format!("Account index unavailable: {e}")))?
}

pub async fn list() -> AppResult<Vec<AccountRecord>> {
    Ok(read_index().await?.accounts)
}

pub async fn add_managed(
    provider: Provider,
    host: &str,
    login: &str,
    email: Option<&str>,
    token: &str,
) -> AppResult<AccountRecord> {
    if token.is_empty() || host.is_empty() || login.is_empty() {
        return Err(AppError::InvalidArgument("Account host, login and token are required".into()));
    }
    let _guard = INDEX_LOCK.lock().await;
    let host = host.to_ascii_lowercase();
    let login = login.to_owned();
    let email = email.map(str::to_owned);
    let token = token.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut index = load_index()?;
        let existing = index.accounts.iter().position(|a| {
            a.provider == provider && a.host == host && a.login == login
        });
        let id = existing
            .map(|position| index.accounts[position].id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let secret_key = format!("account_{id}");
        crate::secrets::set_forge_secret(&host, &secret_key, &token)?;
        let account = AccountRecord {
            id: id.clone(), provider, host: host.clone(), login,
            source: AccountSource::Managed, email, secret_key: Some(secret_key),
        };
        if let Some(position) = existing {
            index.accounts[position] = account.clone();
        } else {
            index.accounts.push(account.clone());
        }
        index.active.insert(host_key(provider, &host), id);
        save_index(&index)?;
        Ok(account)
    })
    .await
    .map_err(|e| AppError::Command(format!("Account storage unavailable: {e}")))?
}

pub async fn register_cli(provider: Provider, host: &str, login: &str) -> AppResult<AccountRecord> {
    if !matches!(provider, Provider::GitHub | Provider::GitLab) || host.is_empty() || login.is_empty() {
        return Err(AppError::InvalidArgument("Invalid CLI account identity".into()));
    }
    let _guard = INDEX_LOCK.lock().await;
    let host = host.to_ascii_lowercase();
    let login = login.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut index = load_index()?;
        if let Some(account) = index.accounts.iter().find(|a| {
            a.provider == provider && a.host == host && a.login == login
        }) {
            return Ok(account.clone());
        }
        let account = AccountRecord {
            id: uuid::Uuid::new_v4().to_string(), provider, host, login,
            source: AccountSource::Cli, email: None, secret_key: None,
        };
        index.accounts.push(account.clone());
        save_index(&index)?;
        Ok(account)
    })
    .await
    .map_err(|e| AppError::Command(format!("Account storage unavailable: {e}")))?
}

pub async fn active(provider: Provider, host: &str) -> AppResult<Option<AccountRecord>> {
    let index = read_index().await?;
    let selected = index.active.get(&host_key(provider, host));
    Ok(selected.and_then(|id| index.accounts.iter().find(|a| &a.id == id)).cloned())
}

pub async fn for_repo(provider: Provider, host: &str, path: &str) -> AppResult<Option<AccountRecord>> {
    let key = repo_key(path)?;
    let index = read_index().await?;
    let selected = index.bindings.get(&key).or_else(|| index.active.get(&host_key(provider, host)));
    let account = selected.and_then(|id| index.accounts.iter().find(|a| &a.id == id)).cloned();
    if let Some(ref account) = account {
        if account.provider != provider || !account.host.eq_ignore_ascii_case(host) {
            return Err(AppError::Command("Repository account does not match its provider and host".into()));
        }
    }
    Ok(account)
}

pub async fn binding_for_repo(path: &str) -> AppResult<Option<String>> {
    let key = repo_key(path)?;
    Ok(read_index().await?.bindings.get(&key).cloned())
}

pub async fn managed_token(account: &AccountRecord) -> AppResult<String> {
    if account.source != AccountSource::Managed {
        return Err(AppError::InvalidArgument("Account is managed by a CLI".into()));
    }
    let key = account.secret_key.clone().ok_or_else(|| {
        AppError::Command("Account credential reference is missing".into())
    })?;
    let host = account.host.clone();
    tauri::async_runtime::spawn_blocking(move || crate::secrets::read_forge_secret(&host, &key))
        .await
        .map_err(|e| AppError::Command(format!("Account credential unavailable: {e}")))??
        .ok_or_else(|| AppError::Command("Account credential is missing".into()))
}

/// Store the selected HTTPS credential under the exact repository path, then
/// confirm Git will return that credential before a network operation starts.
pub async fn seed_git_credential(url: &str, username: &str, token: &str) -> AppResult<Vec<String>> {
    let parsed = tauri_plugin_http::reqwest::Url::parse(url)
        .map_err(|_| AppError::InvalidArgument("Invalid HTTPS remote URL".into()))?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.query().is_some() || parsed.fragment().is_some()
        || username.is_empty() || username.chars().any(|c| matches!(c, '\r' | '\n' | '\0'))
        || token.is_empty() || token.chars().any(|c| matches!(c, '\r' | '\n' | '\0'))
    {
        return Err(AppError::InvalidArgument("Selected account requires a plain HTTPS remote URL".into()));
    }
    let authority = parsed.host_str().ok_or_else(|| AppError::InvalidArgument("Remote host is missing".into()))?;
    let authority = match parsed.port() {
        Some(port) => format!("{authority}:{port}"),
        None => authority.to_owned(),
    };
    if !crate::forge::is_safe_authority(&authority) {
        return Err(AppError::InvalidArgument("Invalid remote host".into()));
    }
    let path = parsed.path().trim_start_matches('/');
    if path.is_empty() || path.contains('\n') || path.contains('\r') {
        return Err(AppError::InvalidArgument("Invalid remote path".into()));
    }
    let key = format!("protocol=https\nhost={authority}\npath={path}\nusername={username}\n");
    let input = format!("{key}password={token}\n\n");
    crate::git::runner::run_git_input(None, &["-c", "credential.useHttpPath=true", "credential", "approve"], Some(&input), crate::git::runner::DEFAULT_TIMEOUT)
        .await.map_err(|_| AppError::Command("Git credential store rejected the selected account".into()))?;
    let result = crate::git::runner::run_git_input(None, &["-c", "credential.useHttpPath=true", "-c", "credential.interactive=false", "credential", "fill"], Some(&format!("{key}\n")), crate::git::runner::DEFAULT_TIMEOUT)
        .await.map_err(|_| AppError::Command("Git credential store did not return the selected account".into()))?;
    let filled = result.stdout_lossy();
    if !filled.lines().any(|line| line == format!("password={token}"))
        || !filled.lines().any(|line| line == format!("username={username}")) {
        return Err(AppError::Command("Git credential store returned a different account".into()));
    }
    Ok(vec![
        "credential.useHttpPath=true".to_owned(),
        "credential.interactive=false".to_owned(),
        format!("credential.username={username}"),
    ])
}

pub async fn set_active(id: &str) -> AppResult<()> {
    let _guard = INDEX_LOCK.lock().await;
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut index = load_index()?;
        let account = index.accounts.iter().find(|a| a.id == id)
            .ok_or_else(|| AppError::InvalidArgument("Unknown account".into()))?;
        let key = host_key(account.provider, &account.host);
        index.active.insert(key, id);
        save_index(&index)
    })
    .await
    .map_err(|e| AppError::Command(format!("Account storage unavailable: {e}")))?
}

pub async fn bind_repo(path: &str, id: Option<&str>) -> AppResult<()> {
    let key = repo_key(path)?;
    let remote = crate::git::remote::git_remote_url(path.to_owned(), "origin".to_owned()).await?;
    let host = crate::forge::remote_authority(&remote)
        .ok_or_else(|| AppError::InvalidArgument("Repository origin has no host".into()))?;
    let provider = crate::forge::detect_non_github(path).await
        .map(|(provider, _)| provider).unwrap_or(Provider::GitHub);
    let _guard = INDEX_LOCK.lock().await;
    let id = id.map(str::to_owned);
    tauri::async_runtime::spawn_blocking(move || {
        let mut index = load_index()?;
        if let Some(ref id) = id {
            let account = index.accounts.iter().find(|a| &a.id == id)
                .ok_or_else(|| AppError::InvalidArgument("Unknown account".into()))?;
            if account.provider != provider || !account.host.eq_ignore_ascii_case(&host) {
                return Err(AppError::InvalidArgument("Account does not match repository origin".into()));
            }
            index.bindings.insert(key, id.clone());
        } else {
            index.bindings.remove(&key);
        }
        save_index(&index)
    })
    .await
    .map_err(|e| AppError::Command(format!("Account storage unavailable: {e}")))?
}

pub async fn remove(id: &str) -> AppResult<()> {
    let _guard = INDEX_LOCK.lock().await;
    let id = id.to_owned();
    let (account, repo_paths) = tauri::async_runtime::spawn_blocking(move || {
        let mut index = load_index()?;
        let position = index.accounts.iter().position(|a| a.id == id)
            .ok_or_else(|| AppError::InvalidArgument("Unknown account".into()))?;
        let account = index.accounts[position].clone();
        let repo_paths: Vec<String> = index.bindings.iter()
            .filter(|(_, selected)| *selected == &id)
            .map(|(path, _)| path.clone()).collect();
        index.accounts.remove(position);
        index.active.retain(|_, selected| selected != &id);
        index.bindings.retain(|_, selected| selected != &id);
        save_index(&index)?;
        if let Some(ref key) = account.secret_key {
            crate::secrets::delete_forge_secret(&account.host, key)?;
        }
        Ok::<_, AppError>((account, repo_paths))
    })
    .await
    .map_err(|e| AppError::Command(format!("Account storage unavailable: {e}")))??;
    let username = match account.provider {
        Provider::Bitbucket => "x-bitbucket-api-token-auth",
        Provider::Cnb => "cnb",
        _ => &account.login,
    };
    let mut cleanup_errors = 0;
    for path in repo_paths {
        let result = async {
            let url = crate::git::remote::git_remote_url(path, "origin".to_owned()).await?;
            let url = if account.provider == Provider::Bitbucket {
                crate::forge::bitbucket::strip_https_userinfo(&url)
            } else { url };
            let parsed = tauri_plugin_http::reqwest::Url::parse(&url)
                .map_err(|_| AppError::InvalidArgument("Invalid Git credential URL".into()))?;
            if parsed.scheme() != "https" { return Ok::<_, AppError>(()); }
            let host = parsed.host_str().ok_or_else(|| AppError::InvalidArgument("Git credential host is missing".into()))?;
            let host = parsed.port().map_or_else(|| host.to_owned(), |port| format!("{host}:{port}"));
            let input = format!("protocol=https\nhost={host}\npath={}\nusername={username}\n\n", parsed.path().trim_start_matches('/'));
            crate::git::runner::run_git_input(None, &["-c", "credential.useHttpPath=true", "credential", "reject"], Some(&input), crate::git::runner::DEFAULT_TIMEOUT).await?;
            Ok(())
        }.await;
        if let Err(error) = result {
            eprintln!("Could not remove selected account Git credential: {error}");
            cleanup_errors += 1;
        }
    }
    if cleanup_errors > 0 {
        return Err(AppError::Command(format!("Account removed, but {cleanup_errors} Git credential entries could not be cleared")));
    }
    Ok(())
}

#[tauri::command]
pub async fn forge_accounts() -> AppResult<Vec<AccountView>> {
    let index = read_index().await?;
    Ok(index.accounts.into_iter().map(|account| {
        let is_active = index.active.get(&host_key(account.provider, &account.host)) == Some(&account.id);
        AccountView { is_active, ..account.into() }
    }).collect())
}

#[tauri::command]
pub async fn forge_account_for_repo(repo_path: String) -> AppResult<Option<AccountView>> {
    let remote = crate::git::remote::git_remote_url(repo_path.clone(), "origin".to_owned()).await?;
    let host = crate::forge::remote_authority(&remote)
        .ok_or_else(|| AppError::InvalidArgument("Repository origin has no host".into()))?;
    let provider = crate::forge::detect_non_github(&repo_path).await
        .map(|(provider, _)| provider).unwrap_or(Provider::GitHub);
    Ok(for_repo(provider, &host, &repo_path).await?.map(AccountView::from))
}

#[tauri::command]
pub async fn forge_account_repo_target(repo_path: String) -> AppResult<AccountTarget> {
    let remote = crate::git::remote::git_remote_url(repo_path.clone(), "origin".to_owned()).await?;
    let host = crate::forge::remote_authority(&remote)
        .ok_or_else(|| AppError::InvalidArgument("Repository origin has no host".into()))?;
    let provider = crate::forge::detect_non_github(&repo_path).await
        .map(|(provider, _)| provider).unwrap_or(Provider::GitHub);
    Ok(AccountTarget { provider, host })
}

#[tauri::command]
pub async fn forge_account_binding_for_repo(repo_path: String) -> AppResult<Option<String>> {
    binding_for_repo(&repo_path).await
}

#[tauri::command]
pub async fn forge_account_remove(id: String) -> AppResult<()> { remove(&id).await }

#[tauri::command]
pub async fn forge_account_register_cli(
    provider: Provider,
    host: String,
    login: String,
) -> AppResult<AccountView> {
    if !crate::forge::is_safe_authority(&host) {
        return Err(AppError::InvalidArgument("Invalid account host".into()));
    }
    match provider {
        Provider::GitHub => {
            let accounts = crate::github::pr::gh_accounts().await?;
            if !accounts.accounts.iter().any(|a| a.host.eq_ignore_ascii_case(&host) && a.login == login) {
                return Err(AppError::InvalidArgument("GitHub CLI account is not signed in".into()));
            }
        }
        Provider::GitLab => {
            let response = crate::forge::glab::run_glab_raw(
                None, &["api", "--hostname", &host, "user"], crate::forge::glab::GLAB_TIMEOUT,
            ).await?;
            if response.code != 0 {
                return Err(AppError::InvalidArgument("GitLab CLI account is not signed in".into()));
            }
            let value: serde_json::Value = serde_json::from_str(&response.stdout_lossy())
                .map_err(|e| AppError::Command(format!("Cannot read GitLab account: {e}")))?;
            if value.get("username").and_then(serde_json::Value::as_str) != Some(login.as_str()) {
                return Err(AppError::InvalidArgument("GitLab CLI account does not match login".into()));
            }
        }
        _ => return Err(AppError::InvalidArgument("Provider has no CLI account".into())),
    }
    Ok(register_cli(provider, &host, &login).await?.into())
}

#[tauri::command]
pub async fn forge_account_select(id: String) -> AppResult<()> { set_active(&id).await }

#[tauri::command]
pub async fn forge_account_bind_repo(repo_path: String, id: Option<String>) -> AppResult<()> {
    bind_repo(&repo_path, id.as_deref()).await
}
