use keyring::Entry;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::io::{self, IsTerminal, Read, Write};
use std::process::{Command, ExitCode};
use std::time::Duration;

const API: &str = "https://api.cnb.cool";
const SERVICE: &str = "cnb-cli";
const ACCOUNT: &str = "access-token";

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("cnb: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print_help();
        return Ok(());
    }
    if args == ["version"] || args == ["--version"] || args == ["-V"] {
        println!("cnb {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }

    if args.first().is_some_and(|arg| arg == "auth") {
        return auth(&args[1..]);
    }

    let json_output = args.iter().any(|arg| arg == "--json");
    let args: Vec<String> = args.into_iter().filter(|arg| arg != "--json").collect();
    if args.starts_with(&["repo".into(), "view".into()]) {
        let repo = if let Some(repo) = args.get(2) {
            parse_repo(repo)?
        } else {
            current_repo()?
        };
        let value = api_request("GET", &format!("/{repo}"), None, false)?;
        output(&value, json_output)?;
        return Ok(());
    }
    if args.first().is_some_and(|arg| arg == "pr") {
        return pull_requests(&args[1..], json_output);
    }
    Err(format!(
        "unknown command '{}'. Run `cnb --help` for usage.",
        args[0]
    ))
}

fn auth(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("login") => {
            let token = if args.iter().any(|arg| arg == "--with-token") {
                if io::stdin().is_terminal() {
                    return Err(
                        "--with-token reads from stdin; pipe a token into this command.".into(),
                    );
                }
                let mut token = String::new();
                io::stdin()
                    .read_to_string(&mut token)
                    .map_err(|e| format!("cannot read token: {e}"))?;
                token.trim().to_owned()
            } else {
                if !io::stdin().is_terminal() {
                    return Err("interactive token entry requires a terminal; use `cnb auth login --with-token` with piped input.".into());
                }
                eprint!("CNB Access Token: ");
                io::stderr().flush().map_err(|e| e.to_string())?;
                let token = read_hidden_line()?;
                eprintln!();
                token.trim().to_owned()
            };
            if token.is_empty() {
                return Err("token cannot be empty".into());
            }
            credential_entry()?
                .set_password(&token)
                .map_err(|e| format!("Windows Credential Manager could not save the token: {e}"))?;
            println!("CNB token saved in Windows Credential Manager.");
            Ok(())
        }
        Some("status") => match credential_entry()?.get_password() {
            Ok(_) => {
                println!("Authenticated: CNB token is stored in Windows Credential Manager.");
                Ok(())
            }
            Err(keyring::Error::NoEntry) => {
                println!("Not authenticated. Run `cnb auth login`.");
                Ok(())
            }
            Err(e) => Err(format!("cannot read Windows Credential Manager: {e}")),
        },
        Some("logout") => match credential_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {
                println!("CNB token removed.");
                Ok(())
            }
            Err(e) => Err(format!(
                "cannot remove token from Windows Credential Manager: {e}"
            )),
        },
        _ => Err("usage: cnb auth <login [--with-token]|status|logout>".into()),
    }
}

fn pull_requests(args: &[String], json_output: bool) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("list") => {
            let repo = selected_repo(args)?;
            let state = option_value(args, "--state").unwrap_or_else(|| "open".into());
            if !["open", "closed", "all"].contains(&state.as_str()) {
                return Err("--state must be open, closed, or all".into());
            }
            let limit = option_value(args, "--limit")
                .unwrap_or_else(|| "30".into())
                .parse::<usize>()
                .map_err(|_| "--limit must be a positive integer")?;
            if limit == 0 {
                return Err("--limit must be greater than zero".into());
            }
            let mut filters = vec![("state", state)];
            for (option, parameter) in [
                ("--authors", "authors"),
                ("--reviewers", "reviewers"),
                ("--assignees", "assignees"),
                ("--labels", "labels"),
                ("--base", "base_ref"),
                ("--updated-time-begin", "updated_time_begin"),
                ("--updated-time-end", "updated_time_end"),
            ] {
                if let Some(value) = option_value(args, option) {
                    filters.push((parameter, value));
                }
            }
            for (option, parameter) in [
                ("--reviewers-operator", "reviewers_operator"),
                ("--assignees-operator", "assignees_operator"),
                ("--labels-operator", "labels_operator"),
            ] {
                if let Some(value) = option_value(args, option) {
                    if !["contains_any", "contains_all"].contains(&value.as_str()) {
                        return Err(format!("{option} must be contains_any or contains_all"));
                    }
                    filters.push((parameter, value));
                }
            }
            let order = option_value(args, "--order").unwrap_or_else(|| "-created_at".into());
            if !["created_at", "-created_at", "-updated_at"].contains(&order.as_str()) {
                return Err("--order must be created_at, -created_at, or -updated_at".into());
            }
            filters.push(("order_by", order));
            let mut items = Vec::new();
            let mut page = 1;
            while items.len() < limit {
                let url = paged_url(&format!("/{repo}/-/pulls"), page, &filters)?;
                let batch = api_request("GET", &url, None, false)?;
                let batch = batch
                    .as_array()
                    .ok_or("CNB returned an invalid pull request list response")?;
                let count = batch.len();
                items.extend(batch.iter().cloned());
                if count < 10 {
                    break;
                }
                page += 1;
            }
            items.truncate(limit);
            output(&Value::Array(items), json_output)?;
            Ok(())
        }
        Some("view") => {
            let identifier = args
                .get(1)
                .ok_or("usage: cnb pr view <NUMBER|URL> [--repo OWNER/REPO] [--json]")?;
            let (repo, number) = resolve_pr(identifier, args)?;
            let mut details =
                api_request("GET", &format!("/{repo}/-/pulls/{number}"), None, false)?;
            let files = api_request(
                "GET",
                &format!("/{repo}/-/pulls/{number}/files"),
                None,
                false,
            )?;
            let commits = all_pages(&format!("/{repo}/-/pulls/{number}/commits"))?;
            let statuses = api_request(
                "GET",
                &format!("/{repo}/-/pulls/{number}/commit-statuses"),
                None,
                false,
            )?;
            let comments = all_pages(&format!("/{repo}/-/pulls/{number}/comments"))?;
            let reviews = all_pages(&format!("/{repo}/-/pulls/{number}/reviews"))?;
            if let Some(object) = details.as_object_mut() {
                object.insert("files".into(), files);
                object.insert("commits".into(), commits);
                object.insert("commit_statuses".into(), statuses);
                object.insert("comments".into(), comments);
                object.insert("reviews".into(), reviews);
            }
            output(&details, json_output)?;
            Ok(())
        }
        Some("create") => create_pr(args, json_output),
        Some("comment") => comment_pr(args, json_output),
        Some("review") => review_pr(args, json_output),
        Some("merge") => merge_pr(args, json_output),
        _ => Err("usage: cnb pr <list|view|create|comment|review|merge>".into()),
    }
}

fn create_pr(args: &[String], json_output: bool) -> Result<(), String> {
    if args.iter().any(|arg| arg == "--draft") {
        return Err(
            "CNB OpenAPI PullCreationForm has no draft field; draft creation is unavailable."
                .into(),
        );
    }
    let repo = selected_repo(args)?;
    let title = option_value(args, "--title").ok_or("cnb pr create requires --title")?;
    let base = option_value(args, "--base").ok_or("cnb pr create requires --base")?;
    let head = match option_value(args, "--head") {
        Some(head) => head,
        None => current_branch()?,
    };
    let body = option_value(args, "--body").unwrap_or_default();
    let payload = json!({"title": title, "body": body, "base": base, "head": head});
    let value = api_request("POST", &format!("/{repo}/-/pulls"), Some(payload), true)?;
    output(&value, json_output)?;
    Ok(())
}

fn comment_pr(args: &[String], json_output: bool) -> Result<(), String> {
    let identifier = args
        .get(1)
        .ok_or("usage: cnb pr comment <NUMBER|URL> --body <TEXT> [--repo OWNER/REPO]")?;
    let (repo, number) = resolve_pr(identifier, args)?;
    let body = option_value(args, "--body").ok_or("cnb pr comment requires --body")?;
    let value = api_request(
        "POST",
        &format!("/{repo}/-/pulls/{number}/comments"),
        Some(json!({"body": body})),
        true,
    )?;
    output(&value, json_output)?;
    Ok(())
}

fn review_pr(args: &[String], json_output: bool) -> Result<(), String> {
    let identifier = args.get(1).ok_or(
        "usage: cnb pr review <NUMBER|URL> --approve|--request-changes|--comment [--body TEXT]",
    )?;
    let (repo, number) = resolve_pr(identifier, args)?;
    let events: Vec<_> = [
        ("--approve", "approve"),
        ("--request-changes", "request_changes"),
        ("--comment", "comment"),
    ]
    .into_iter()
    .filter(|(option, _)| args.iter().any(|arg| arg == option))
    .collect();
    if events.len() != 1 {
        return Err(
            "choose exactly one review event: --approve, --request-changes, or --comment".into(),
        );
    }
    let event = events[0].1;
    let mut payload = json!({"event": event});
    if let Some(body) = option_value(args, "--body") {
        payload["body"] = json!(body);
    }
    let value = api_request(
        "POST",
        &format!("/{repo}/-/pulls/{number}/reviews"),
        Some(payload),
        true,
    )?;
    output(&value, json_output)?;
    Ok(())
}

fn merge_pr(args: &[String], json_output: bool) -> Result<(), String> {
    let identifier = args
        .get(1)
        .ok_or("usage: cnb pr merge <NUMBER|URL> --merge|--squash|--rebase [--yes]")?;
    let (repo, number) = resolve_pr(identifier, args)?;
    let styles: Vec<_> = [
        ("--merge", "merge"),
        ("--squash", "squash"),
        ("--rebase", "rebase"),
    ]
    .into_iter()
    .filter(|(option, _)| args.iter().any(|arg| arg == option))
    .collect();
    if styles.len() != 1 {
        return Err("select exactly one merge method: --merge, --squash, or --rebase".into());
    }
    let style = styles[0].1;
    if !args.iter().any(|arg| arg == "--yes") {
        if !io::stdin().is_terminal() {
            return Err("merge confirmation needs a terminal; inspect the PR and pass --yes to confirm explicitly.".into());
        }
        eprint!("Merge CNB PR {number} using {style}? Type 'merge' to continue: ");
        io::stderr().flush().map_err(|e| e.to_string())?;
        let mut answer = String::new();
        io::stdin()
            .read_line(&mut answer)
            .map_err(|e| e.to_string())?;
        if answer.trim() != "merge" {
            return Err("merge cancelled".into());
        }
    }
    let value = api_request(
        "PUT",
        &format!("/{repo}/-/pulls/{number}/merge"),
        Some(json!({"merge_style": style})),
        true,
    )?;
    output(&value, json_output)?;
    Ok(())
}

fn resolve_pr(identifier: &str, args: &[String]) -> Result<(String, String), String> {
    if identifier.starts_with("http://") || identifier.starts_with("https://") {
        let url = reqwest::Url::parse(identifier).map_err(|_| "invalid pull request URL")?;
        if !matches!(url.host_str(), Some("cnb.cool" | "www.cnb.cool")) {
            return Err("pull request URL must use cnb.cool".into());
        }
        let pieces: Vec<_> = url
            .path_segments()
            .ok_or("invalid pull request URL")?
            .collect();
        let pulls = pieces
            .iter()
            .position(|part| *part == "pull" || *part == "pulls")
            .ok_or("URL does not contain a CNB pull request path")?;
        let repo = parse_repo(&pieces[..pulls].join("/"))?;
        let number = pieces
            .get(pulls + 1)
            .ok_or("pull request URL is missing its number")?
            .to_string();
        if number.parse::<u64>().is_err() {
            return Err("pull request number must be numeric".into());
        }
        return Ok((repo, number));
    }
    if identifier.parse::<u64>().is_err() {
        return Err("pull request number must be numeric".into());
    }
    let repo = selected_repo(args)?;
    Ok((repo, identifier.to_owned()))
}

fn current_repo() -> Result<String, String> {
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .output()
        .map_err(|e| format!("cannot run git to read origin: {e}"))?;
    if !output.status.success() {
        return Err("no origin remote found; pass --repo OWNER/REPO".into());
    }
    let remote = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    parse_repo(&remote)
        .map_err(|_| "origin is not a supported CNB remote; pass --repo OWNER/REPO".into())
}

fn current_branch() -> Result<String, String> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .output()
        .map_err(|e| format!("cannot run git to read the current branch: {e}"))?;
    if !output.status.success() {
        return Err("cannot determine current branch".into());
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if branch.is_empty() {
        return Err(
            "detached HEAD has no branch to use for PR creation; pass --head explicitly".into(),
        );
    }
    Ok(branch)
}

fn parse_repo(input: &str) -> Result<String, String> {
    let mut value = input
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_owned();
    if value.contains("://") {
        let url = reqwest::Url::parse(&value).map_err(|_| "invalid repository URL")?;
        if !matches!(url.host_str(), Some("cnb.cool" | "www.cnb.cool")) {
            return Err("repository remote is not on cnb.cool".into());
        }
        value = url.path().trim_matches('/').to_owned();
    } else if let Some((host, path)) = value.split_once(':') {
        if host.ends_with("@cnb.cool") {
            value = path.trim_matches('/').to_owned();
        } else {
            return Err("SSH repository remote is not on cnb.cool".into());
        }
    }
    let pieces: Vec<_> = value.split('/').collect();
    if pieces.len() != 2
        || pieces.iter().any(|part| {
            part.is_empty() || matches!(*part, "." | "..") || part.contains(['?', '#', '\\', '%'])
        })
    {
        return Err("repository must be OWNER/REPO or a cnb.cool repository URL".into());
    }
    Ok(value)
}

fn api_request(
    method: &str,
    path: &str,
    body: Option<Value>,
    _write: bool,
) -> Result<Value, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "cannot initialize HTTPS client")?;
    let url = if path.starts_with("https://") {
        path.to_owned()
    } else {
        format!("{API}{path}")
    };
    let mut request = client
        .request(method.parse().map_err(|_| "unsupported HTTP method")?, url)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, concat!("cnb-cli/", env!("CARGO_PKG_VERSION")));
    let token = credential_entry()?.get_password().map_err(|error| match error {
        keyring::Error::NoEntry => "CNB OpenAPI requires Bearer authentication for repository API requests; run `cnb auth login`".to_owned(),
        _ => "cannot read token from Windows Credential Manager; run `cnb auth status`".to_owned(),
    })?;
    request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .map_err(|_| "CNB API request failed; check the network and retry")?;
    decode_response(response, &token)
}

fn decode_response(response: Response, token: &str) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().map_err(|_| {
        format!(
            "CNB API returned HTTP {} with an unreadable response",
            status.as_u16()
        )
    })?;
    if !status.is_success() {
        let fallback = match status.as_u16() {
            401 => "token is invalid or expired".into(),
            403 => "token lacks permission for this operation".into(),
            404 => "repository or pull request was not found".into(),
            _ => "CNB rejected the request".into(),
        };
        let detail = match serde_json::from_str::<Value>(&body) {
            Ok(value) => value
                .get("message")
                .or_else(|| value.get("error"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or(fallback),
            Err(error) if body.trim().is_empty() => {
                format!("{fallback}; CNB error body was empty ({error})")
            }
            Err(error) => {
                let excerpt: String = body.chars().take(240).collect();
                format!("{fallback}; non-JSON response ({error}): {excerpt}")
            }
        };
        let detail = detail.replace(token, "[redacted]");
        return Err(format!("CNB API HTTP {}: {detail}", status.as_u16()));
    }
    if body.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body).map_err(|_| "CNB API returned invalid JSON".into())
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|_| "cannot access Windows Credential Manager".into())
}

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .filter(|value| !value.starts_with("--"))
        .cloned()
}

fn selected_repo(args: &[String]) -> Result<String, String> {
    match option_value(args, "--repo") {
        Some(repo) => parse_repo(&repo),
        None => current_repo(),
    }
}

fn all_pages(path: &str) -> Result<Value, String> {
    let mut result = Vec::new();
    let mut page = 1;
    loop {
        let url = paged_url(path, page, &[])?;
        let value = api_request("GET", &url, None, false)?;
        let items = value
            .as_array()
            .ok_or("CNB returned an invalid paginated response")?;
        let count = items.len();
        result.extend(items.iter().cloned());
        if count < 10 {
            break;
        }
        page += 1;
    }
    Ok(Value::Array(result))
}

fn paged_url(path: &str, page: usize, filters: &[(&str, String)]) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse(&format!("{API}{path}")).map_err(|_| "cannot construct CNB API URL")?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("page", &page.to_string())
            .append_pair("page_size", "10");
        for (key, value) in filters {
            query.append_pair(key, value);
        }
    }
    Ok(url.into())
}

fn output<T: Serialize>(value: &T, json_output: bool) -> Result<(), String> {
    let value = serde_json::to_value(value)
        .map_err(|error| format!("cannot serialize CNB response: {error}"))?;
    if json_output {
        let output = serde_json::to_string(&value)
            .map_err(|error| format!("cannot encode JSON output: {error}"))?;
        println!("{output}");
        return Ok(());
    }
    match value {
        Value::Array(items) if items.iter().all(|item| item.get("number").is_some()) => {
            if items.is_empty() {
                println!("No pull requests found.");
            }
            for item in items {
                let number = item
                    .get("number")
                    .map(display_field)
                    .transpose()?
                    .unwrap_or_else(|| "?".into());
                let title = item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("(untitled)");
                let state = item
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                println!("#{number}  [{state}]  {title}");
            }
        }
        Value::Object(object) if object.contains_key("number") && object.contains_key("title") => {
            let number = object
                .get("number")
                .map(display_field)
                .transpose()?
                .unwrap_or_else(|| "?".into());
            let title = object
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("(untitled)");
            println!("Pull request #{number}: {title}");
            for field in ["state", "author", "head", "base"] {
                if let Some(value) = object.get(field) {
                    println!("{field}: {}", display_field(value)?);
                }
            }
            for field in ["files", "commits", "commit_statuses", "comments", "reviews"] {
                if let Some(value) = object.get(field) {
                    match value {
                        Value::Array(items) => {
                            println!("{field}: {} item(s)", items.len());
                            for item in items {
                                println!("  - {}", display_field(item)?);
                            }
                        }
                        Value::Null => println!("{field}: no value"),
                        Value::Object(_) => println!("{field}: details available"),
                        _ => println!("{field}: {}", display_field(value)?),
                    }
                }
            }
        }
        Value::Object(object) => {
            for field in [
                "path",
                "name",
                "description",
                "web_url",
                "open_pull_request_count",
                "visibility_level",
            ] {
                if let Some(value) = object.get(field) {
                    println!("{field}: {}", display_field(value)?);
                }
            }
            if object.get("path").is_none() {
                let output = serde_json::to_string_pretty(&Value::Object(object))
                    .map_err(|error| format!("cannot format CNB response: {error}"))?;
                println!("{output}");
            }
        }
        value => {
            let output = serde_json::to_string_pretty(&value)
                .map_err(|error| format!("cannot format CNB response: {error}"))?;
            println!("{output}");
        }
    }
    Ok(())
}

fn display_field(value: &Value) -> Result<String, String> {
    Ok(match value {
        Value::String(value) => value.clone(),
        Value::Null => "none".into(),
        Value::Object(_) | Value::Array(_) => serde_json::to_string(value)
            .map_err(|error| format!("cannot format response field: {error}"))?,
        _ => value.to_string(),
    })
}

fn print_help() {
    println!("CNB command line client\n\nUSAGE:\n  cnb <COMMAND>\n\nCOMMANDS:\n  auth login [--with-token]   Save a token in Windows Credential Manager\n  auth status                 Show whether a token is stored\n  auth logout                 Remove the stored token\n  repo view [OWNER/REPO]      Show repository details\n  pr list [--state open|closed|all] [--limit N] [--repo OWNER/REPO]\n          [--authors NAMES] [--reviewers NAMES] [--assignees NAMES]\n          [--labels NAMES] [--base BRANCH] [--updated-time-begin DATE]\n          [--updated-time-end DATE] [--order created_at|-created_at|-updated_at]\n  pr view <NUMBER|URL> [--repo OWNER/REPO] [--json]\n  pr create --title TEXT --base BRANCH [--body TEXT] [--head BRANCH]\n  pr comment <NUMBER> --body TEXT [--repo OWNER/REPO]\n  pr review <NUMBER> --approve|--request-changes|--comment [--body TEXT]\n  pr merge <NUMBER> --merge|--squash|--rebase [--yes]\n\nOPTIONS:\n  --json                      Emit compact JSON for repository and PR data\n  -h, --help                  Show this help\n  -V, --version               Show version\n\nEXAMPLES:\n  cnb auth login\n  cnb repo view owner/repo\n  cnb pr list --state open --limit 20\n  cnb pr create --title \"Add feature\" --base main\n\nCNB repository API calls require a Bearer Access Token. Configure it with `cnb auth login`.\nA token must include the repository and operation scopes required by CNB.\nUse `--yes` only when you explicitly intend to confirm a merge in automation.");
}

#[cfg(windows)]
fn read_hidden_line() -> Result<String, String> {
    use std::os::windows::io::AsRawHandle;
    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn GetConsoleMode(handle: *mut std::ffi::c_void, mode: *mut u32) -> i32;
        fn SetConsoleMode(handle: *mut std::ffi::c_void, mode: u32) -> i32;
    }
    let handle = io::stdin().as_raw_handle() as *mut std::ffi::c_void;
    let mut mode = 0u32;
    if unsafe { GetConsoleMode(handle, &mut mode) } == 0 {
        return Err("cannot read hidden token outside a Windows console; use --with-token".into());
    }
    if unsafe { SetConsoleMode(handle, mode & !0x0004) } == 0 {
        return Err("cannot disable token echo in the Windows console".into());
    }
    let mut token = String::new();
    let result = io::stdin()
        .read_line(&mut token)
        .map_err(|e| format!("cannot read token: {e}"));
    let restored = unsafe { SetConsoleMode(handle, mode) } != 0;
    if !restored {
        return Err("could not restore Windows console input mode".into());
    }
    result?;
    Ok(token)
}

#[cfg(not(windows))]
fn read_hidden_line() -> Result<String, String> {
    Err("hidden token input is supported on Windows; use --with-token on other platforms".into())
}
