//! CNB pull requests over the documented OpenAPI routes.

use serde_json::{json, Value};
use tauri_plugin_http::reqwest::Method;

use crate::error::{AppError, AppResult};
use crate::forge::cnb;
use crate::forge::model::{CompletedReviewerOut, ForgeUserRef};
use crate::github::pr::{
    DraftCommentIn, PrAuthor, PrCommitOut, PrDetails, PrFileOut, PrInfo, PrListLabel,
    PrMergeability, PrRef, PrThreadOut, ReviewSubmitOut,
    RepoLabel,
};

async fn request(repo_path: &str, slug: &str, method: Method, path: &str, body: Option<Value>) -> AppResult<Value> {
    cnb::request_for_repo(repo_path, slug, method, path, body).await
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn number(value: &Value) -> AppResult<u64> {
    value
        .get("number")
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64()))
        .ok_or_else(|| AppError::Command("CNB returned a pull request without a valid number".into()))
}

fn branch(value: &Value, side: &str) -> String {
    text(&value[side], "ref")
        .strip_prefix("refs/heads/")
        .unwrap_or_else(|| text(&value[side], "ref"))
        .to_string()
}

fn state(value: &Value) -> String {
    text(value, "state").to_ascii_lowercase()
}

fn url(repo: &str, number: u64) -> String {
    format!("https://cnb.cool/{repo}/-/pulls/{number}")
}

fn login(value: &Value) -> String {
    ["username", "name", "nickname"]
        .into_iter()
        .map(|key| text(value, key))
        .find(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

async fn pages(repo_path: &str, repo: &str, path: &str) -> AppResult<Vec<Value>> {
    let mut values = Vec::new();
    for page in 1..=100 {
        let sep = if path.contains('?') { '&' } else { '?' };
        let url = format!("{path}{sep}page={page}&page_size=100");
        let data = request(repo_path, repo, Method::GET, &url, None).await?;
        let mut batch = data.as_array().ok_or_else(|| AppError::Command(
            format!("CNB returned a non-list response for {path}"),
        ))?.clone();
        let done = batch.len() < 100;
        values.append(&mut batch);
        if done { return Ok(values); }
    }
    Err(AppError::Command(format!("CNB {path} exceeds 100 pages")))
}

fn pr_info(repo: &str, value: &Value) -> AppResult<PrInfo> {
    let number = number(value)?;
    Ok(PrInfo {
        number,
        url: url(repo, number),
        title: text(value, "title").to_string(),
        base_ref_name: branch(value, "base"),
        head_ref_name: branch(value, "head"),
        is_draft: value["is_wip"].as_bool().unwrap_or(false),
        state: state(value),
        author: value.get("author").filter(|v| !v.is_null()).map(|v| PrAuthor { login: login(v) }),
        labels: value["labels"].as_array().map(|labels| labels.iter().map(|l| PrListLabel { name: text(l, "name").to_string() }).collect()).unwrap_or_default(),
        created_at: text(value, "created_at").to_string(),
        head_sha: text(&value["head"], "sha").to_string(),
        stack: None,
        stack_unknown: false,
        cross_repository: value["head"]["repo"]["path"] != value["base"]["repo"]["path"]
            && !value["head"]["repo"]["path"].is_null()
            && !value["base"]["repo"]["path"].is_null(),
    })
}

pub async fn list_prs(repo_path: &str, state: &str, limit: Option<u32>) -> AppResult<Vec<PrInfo>> {
    if !matches!(state, "open" | "closed") {
        return Err(AppError::InvalidArgument(format!("unknown PR state: {state}")));
    }
    let repo = cnb::repo_slug(repo_path).await?;
    let count = limit.unwrap_or(30).clamp(1, 100);
    let mut out = Vec::new();
    let mut page = 1;
    while out.len() < count as usize {
        // CNB distinguishes `merged` from `closed`; a closed tab needs both.
        let path = format!("-/pulls?page={page}&page_size=100&state={state}");
        let data = request(repo_path, &repo, Method::GET, &path, None).await?;
        let rows = data.as_array().ok_or_else(|| AppError::Command("CNB pull list was not an array".into()))?;
        for row in rows {
            out.push(pr_info(&repo, row)?);
            if out.len() >= count as usize { break; }
        }
        if rows.len() < 100 || page >= 20 { break; }
        page += 1;
    }
    Ok(out)
}

pub async fn view_pr(repo_path: &str, number: u64) -> AppResult<PrDetails> {
    let repo = cnb::repo_slug(repo_path).await?;
    let base = format!("-/pulls/{number}");
    let pr = request(repo_path, &repo, Method::GET, &base, None).await?;
    // CNB documents this route as an unpaginated list. Adding page parameters
    // here can duplicate files when a pull request changes 100 or more files.
    let files_data = request(repo_path, &repo, Method::GET, &format!("{base}/files"), None).await?
        .as_array()
        .cloned()
        .ok_or_else(|| AppError::Command("CNB pull files response was not a list".into()))?;
    let files: Vec<PrFileOut> = files_data
        .iter().map(|f| PrFileOut {
            path: text(f, "filename").to_string(),
            additions: f["additions"].as_u64().unwrap_or(0) as u32,
            deletions: f["deletions"].as_u64().unwrap_or(0) as u32,
        }).collect();
    let additions = files.iter().map(|f| f.additions).sum();
    let deletions = files.iter().map(|f| f.deletions).sum();
    let comments_data = pages(repo_path, &repo, &format!("{base}/comments")).await?;
    let comments: Vec<PrThreadOut> = comments_data
        .iter().map(|c| PrThreadOut {
            author: login(&c["author"]), author_avatar_url: String::new(),
            state: String::new(), body: text(c, "body").to_string(),
            date: text(c, "created_at").to_string(), id: text(c, "id").to_string(),
            url: String::new(), viewer_did_author: false, is_minimized: false,
            minimized_reason: String::new(), review_id: String::new(),
        }).collect();
    let commits_data = pages(repo_path, &repo, &format!("{base}/commits")).await?;
    let commits: Vec<PrCommitOut> = commits_data.iter().map(|commit| {
        let message = text(&commit["commit"], "message");
        let (headline, message_body) = message.split_once('\n').unwrap_or((message, ""));
        PrCommitOut {
            oid: text(commit, "sha").to_string(),
            headline: headline.to_string(),
            message_body: message_body.trim_start_matches('\n').to_string(),
            date: text(&commit["commit"]["author"], "date").to_string(),
            author: text(&commit["commit"]["author"], "name").to_string(),
        }
    }).collect();
    let reviews_data = pages(repo_path, &repo, &format!("{base}/reviews")).await?;
    let reviews: Vec<PrThreadOut> = reviews_data.iter().map(|review| PrThreadOut {
        author: login(&review["author"]),
        author_avatar_url: text(&review["author"], "avatar").to_string(),
        state: text(review, "state").to_ascii_uppercase(),
        body: text(review, "body").to_string(),
        date: text(review, "created_at").to_string(),
        id: text(review, "id").to_string(),
        url: String::new(), viewer_did_author: false,
        is_minimized: false, minimized_reason: String::new(), review_id: String::new(),
    }).collect();
    let reviewer_rows = pr["reviewers"].as_array().cloned().unwrap_or_default();
    let assignees: Vec<ForgeUserRef> = pr["assignees"].as_array().into_iter().flatten().map(|user| {
        let id = login(user);
        ForgeUserRef { id: id.clone(), label: id, avatar_url: text(user, "avatar").to_string(), is_bot: false }
    }).collect();
    let reviewers: Vec<ForgeUserRef> = reviewer_rows.iter().map(|entry| {
        let user = &entry["user"];
        let id = login(user);
        ForgeUserRef { id: id.clone(), label: id, avatar_url: text(user, "avatar").to_string(), is_bot: false }
    }).collect();
    let completed_reviewers = reviewer_rows.iter().filter_map(|entry| {
        let verdict = text(entry, "review_state");
        if !matches!(verdict, "approved" | "changes_requested" | "commented") { return None; }
        let user = &entry["user"];
        let id = login(user);
        Some(CompletedReviewerOut {
            user: ForgeUserRef { id: id.clone(), label: id, avatar_url: text(user, "avatar").to_string(), is_bot: false },
            state: verdict.to_ascii_uppercase(),
        })
    }).collect();
    let mergeability = match text(&pr, "mergeable_state") {
        "mergeable" => "mergeable",
        "conflict" | "no-merge-base" => "conflicting",
        "checking" | "merging" => "checking",
        _ => "unavailable",
    };
    Ok(PrDetails {
        id: String::new(), number, title: text(&pr, "title").to_string(),
        body: text(&pr, "body").to_string(), author: login(&pr["author"]),
        author_avatar_url: text(&pr["author"], "avatar").to_string(), state: state(&pr),
        is_draft: pr["is_wip"].as_bool().unwrap_or(false),
        base_ref_name: branch(&pr, "base"), head_ref_name: branch(&pr, "head"),
        additions, deletions, url: url(&repo, number), commits, files,
        reviews, comments, checks: Vec::new(),
        labels: pr["labels"].as_array().map(|items| items.iter().map(|l| RepoLabel {
            id: text(l, "id").to_string(), name: text(l, "name").to_string(),
            color: text(l, "color").to_string(), description: Some(text(l, "description").to_string()),
        }).collect()).unwrap_or_default(),
        assignees, reviewers, completed_reviewers,
        merge_commit_allowed: None, squash_merge_allowed: None, rebase_merge_allowed: None,
        stack: None, stack_members: Vec::new(), stack_unknown: false,
        mergeability: PrMergeability { state: mergeability.into(), detail: Some(text(&pr, "blocked_on").to_string()).filter(|v| !v.is_empty()) },
        cross_repository: pr["head"]["repo"]["path"] != pr["base"]["repo"]["path"]
            && !pr["head"]["repo"]["path"].is_null()
            && !pr["base"]["repo"]["path"].is_null(),
        maintainer_can_modify: None,
    })
}

pub async fn diff_pr(repo_path: &str, number: u64) -> AppResult<String> {
    let repo = cnb::repo_slug(repo_path).await?;
    let files = request(repo_path, &repo, Method::GET, &format!("-/pulls/{number}/files"), None).await?
        .as_array()
        .cloned()
        .ok_or_else(|| AppError::Command("CNB pull files response was not a list".into()))?;
    let mut diff = String::new();
    for file in files {
        let path = text(&file, "filename");
        let patch = text(&file, "patch");
        if path.is_empty() || patch.is_empty() { continue; }
        if patch.starts_with("diff --git ") {
            diff.push_str(patch);
            diff.push('\n');
            continue;
        }
        diff.push_str(&format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n"));
        diff.push_str(patch);
        diff.push('\n');
    }
    Ok(diff)
}

pub async fn create_pr(
    state: &crate::state::AppState,
    repo_path: &str,
    head: &str,
    base: &str,
    title: &str,
    body: &str,
) -> AppResult<PrRef> {
    for name in [head, base] {
        crate::git::branches::validate_ref_name(name)
            .map_err(|_| AppError::InvalidArgument(format!("invalid branch: {name}")))?;
    }
    if title.trim().is_empty() {
        return Err(AppError::InvalidArgument("a PR title is required".into()));
    }
    let repo = cnb::repo_slug(repo_path).await?;
    let credentials = crate::forge::credential_config_for_remote(repo_path, "origin").await?;
    let refspec = crate::git::remote::publish_refspec(head);
    let push_args = crate::git::remote::with_credentials(&credentials, &["push", "-u", "origin", &refspec]);
    let push_refs: Vec<&str> = push_args.iter().map(String::as_str).collect();
    crate::git::remote::run_git_mutating_with_creds(
        state,
        repo_path,
        &[],
        &push_refs,
        crate::git::runner::NETWORK_TIMEOUT,
    ).await?;
    let value = request(
        repo_path,
        &repo,
        Method::POST,
        "-/pulls",
        Some(json!({"head":head,"base":base,"title":title,"body":body})),
    ).await.map_err(|error| AppError::Command(format!(
        "The branch was pushed, but creating the CNB pull request failed: {error}"
    )))?;
    let number = number(&value)?;
    Ok(PrRef { number, url: url(&repo, number) })
}

pub async fn comment_pr(repo_path: &str, number: u64, body: &str) -> AppResult<()> {
    let repo = cnb::repo_slug(repo_path).await?;
    request(repo_path, &repo, Method::POST, &format!("-/pulls/{number}/comments"), Some(json!({"body":body}))).await?;
    Ok(())
}

pub async fn review_submit(
    repo_path: &str,
    number: u64,
    verdict: &str,
    summary: Option<&str>,
    comments: &[DraftCommentIn],
) -> AppResult<ReviewSubmitOut> {
    let event = match verdict {
        "approve" => "approve",
        "comment" => "comment",
        "request_changes" => "request_changes",
        other => return Err(AppError::InvalidArgument(format!("unknown CNB review verdict: {other}"))),
    };
    let mut review_comments = Vec::with_capacity(comments.len());
    for comment in comments {
        if comment.path.is_empty() || comment.line == 0 || comment.body.trim().is_empty() {
            return Err(AppError::InvalidArgument("CNB inline review comment needs a path, line, and body".into()));
        }
        let side = match comment.side.as_str() {
            "new" => "right",
            "old" => "left",
            _ => return Err(AppError::InvalidArgument("CNB review side must be new or old".into())),
        };
        review_comments.push(json!({
            "body": comment.body,
            "path": comment.path,
            "subject_type": "line",
            "start_line": comment.start_line.unwrap_or(comment.line),
            "end_line": comment.line,
            "start_side": side,
            "end_side": side,
        }));
    }
    let repo = cnb::repo_slug(repo_path).await?;
    request(
        repo_path,
        &repo,
        Method::POST,
        &format!("-/pulls/{number}/reviews"),
        Some(json!({"event":event,"body":summary.unwrap_or(""),"comments":review_comments})),
    ).await?;
    Ok(ReviewSubmitOut {
        posted: comments.len() as u32,
        total: comments.len() as u32,
        verdict_applied: verdict != "comment",
    })
}

pub async fn merge_pr(repo_path: &str, number: u64, method: &str) -> AppResult<()> {
    if !matches!(method, "merge" | "squash" | "rebase") {
        return Err(AppError::InvalidArgument("CNB merge style must be merge, squash, or rebase".into()));
    }
    let repo = cnb::repo_slug(repo_path).await?;
    request(repo_path, &repo, Method::PUT, &format!("-/pulls/{number}/merge"), Some(json!({"merge_style":method}))).await?;
    Ok(())
}
