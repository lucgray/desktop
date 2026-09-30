//! CNB's My Work column, scoped to repositories opened in this app.
//! CNB exposes repository PR lists, but no account-wide PR inbox.

use std::collections::BTreeSet;

use serde_json::Value;
use tauri_plugin_http::reqwest::{Method, Url};

use crate::error::{AppError, AppResult};
use crate::forge::cnb;
use crate::forge::model::Provider;
use crate::forge::my_work::{
    merge_legs, normalize_updated_at, MyWorkItem, MyWorkLeg, MyWorkPage, MY_WORK_LIMIT,
};

const RESOLVE_CONCURRENCY: usize = 16;
const REQUEST_CONCURRENCY: usize = 4;
const PAGE_SIZE: usize = 100;
const MAX_PAGES_PER_FILTER: usize = 2;

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn item(repo: &str, raw: &Value) -> Option<MyWorkItem> {
    let number = raw
        .get("number")
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64()))?;
    let title = text(raw, "title")?.to_owned();
    let (owner, name) = repo.rsplit_once('/')?;
    let updated_at = text(raw, "updated_at")
        .or_else(|| text(raw, "last_acted_at"))
        .unwrap_or_default();
    Some(MyWorkItem {
        provider: Provider::Cnb,
        number,
        title,
        is_pull_request: true,
        repo_full_name: repo.to_owned(),
        repo_owner: owner.to_owned(),
        repo_name: name.to_owned(),
        host: "cnb.cool".to_owned(),
        url: format!("https://cnb.cool/{repo}/-/pulls/{number}"),
        updated_at: normalize_updated_at(updated_at),
        author_login: raw
            .get("author")
            .and_then(|author| text(author, "username"))
            .map(str::to_owned),
    })
}

fn list_path(filter: &str, names: &str, page: usize) -> AppResult<String> {
    let mut url = Url::parse("https://api.cnb.cool/")
        .map_err(|e| AppError::Command(format!("Invalid CNB API URL: {e}")))?;
    url.query_pairs_mut()
        .append_pair("state", "open")
        .append_pair("order_by", "-updated_at")
        .append_pair("page", &page.to_string())
        .append_pair("page_size", &PAGE_SIZE.to_string())
        .append_pair(filter, names);
    Ok(format!("-/pulls?{}", url.query().unwrap_or_default()))
}

async fn list_filtered(repo_path: &str, repo: &str, filter: &str, names: &str) -> AppResult<MyWorkLeg> {
    let mut items = Vec::new();
    let mut capped = false;
    for page in 1..=MAX_PAGES_PER_FILTER {
        let path = list_path(filter, names, page)?;
        let response = cnb::request_for_repo(repo_path, repo, Method::GET, &path, None).await?;
        let rows = response.as_array().ok_or_else(|| {
            AppError::Command(format!("CNB returned a non-list PR page for {repo}"))
        })?;
        let full = rows.len() >= PAGE_SIZE;
        for row in rows {
            if let Some(pr) = item(repo, row) {
                items.push(pr);
            } else {
                capped = true;
            }
        }
        if !full {
            return Ok(MyWorkLeg { items, capped });
        }
        if page == MAX_PAGES_PER_FILTER {
            capped = true;
        }
    }
    Ok(MyWorkLeg { items, capped })
}

async fn resolve_repo(path: &str) -> Option<(String, String)> {
    let remote = crate::git::remote::git_remote_url(path.to_owned(), "origin".to_owned())
        .await
        .ok()?;
    if !remote.to_ascii_lowercase().starts_with("https://")
        || crate::forge::remote_host(&remote).as_deref() != Some("cnb.cool")
    {
        return None;
    }
    let slug = crate::forge::remote_path(&remote)?;
    (slug.split('/').count() >= 2).then_some((slug, path.to_owned()))
}

/// Open PRs authored by or requesting review from the connected CNB user.
/// Each repository has two server-filtered, paginated legs. Up to four repositories
/// run in parallel, with at most two requests per repository at a time. A failed
/// leg or a capped page marks the answer incomplete; if all legs fail, return the
/// error instead of presenting a false empty inbox.
pub async fn cnb_my_work(repo_paths: Vec<String>) -> AppResult<MyWorkPage> {
    let mut repos = BTreeSet::new();
    for batch in repo_paths.chunks(RESOLVE_CONCURRENCY) {
        let resolved = crate::forge::futures_join_all(batch.iter().map(|path| resolve_repo(path)))
            .await;
        repos.extend(resolved.into_iter().flatten());
    }
    if repos.is_empty() {
        return Ok(MyWorkPage::empty());
    }

    let targets: Vec<(String, String)> = repos.into_iter().collect();
    let mut legs = Vec::new();
    let mut failed = false;
    let mut last_error = None;
    for batch in targets.chunks(REQUEST_CONCURRENCY) {
        let results = crate::forge::futures_join_all(batch.iter().map(|(repo, repo_path)| {
            async move {
                let account = cnb::account_info_for_repo(repo_path).await?;
                if account.username.is_empty() {
                    return Err(AppError::Command("CNB did not report the repository account name".into()));
                }
                let mut names = vec![account.username];
                if let Some(nickname) = account.nickname.filter(|n| !n.is_empty()) {
                    if !names.contains(&nickname) {
                        names.push(nickname);
                    }
                }
                let names = names.join(",");
                Ok::<_, AppError>(tokio::join!(
                    list_filtered(repo_path, repo, "authors", &names),
                    list_filtered(repo_path, repo, "reviewers", &names)
                ))
            }
        }))
        .await;
        for result in results {
            let (authored, review_requested) = match result {
                Ok(legs) => legs,
                Err(error) => {
                    failed = true;
                    last_error = Some(error);
                    continue;
                }
            };
            for result in [authored, review_requested] {
                match result {
                    Ok(leg) => legs.push(leg),
                    Err(error) => {
                        failed = true;
                        last_error = Some(error);
                    }
                }
            }
        }
    }
    if legs.is_empty() {
        return Err(last_error.unwrap_or_else(|| {
            AppError::Command("CNB did not return any pull request pages".into())
        }));
    }
    let mut page = merge_legs(legs, MY_WORK_LIMIT);
    page.truncated |= failed;
    Ok(page)
}
