# CNB CLI 功能说明

## 目标

提供 Windows 优先、可独立运行的 `cnb` 命令行工具，让开发者在终端管理 CNB 仓库和 Pull Request。命令设计参考 GitHub CLI 的分组、帮助、认证和结构化输出习惯；实现只调用 CNB 官方 API，不复用或复制 GitHub CLI 源码。

## 首版范围

- `cnb --help`、`cnb version`：输出命令帮助和版本。
- `cnb auth login`、`cnb auth status`、`cnb auth logout`：录入、检查和移除 CNB Access Token。登录提示优先隐藏输入；凭据保存在 Windows Credential Manager，不写入配置文件、日志或命令历史。
- `cnb repo view [OWNER/REPO]`：显示仓库信息。省略参数时从当前目录的 `origin` remote 推断 CNB 仓库。
- `cnb pr list`：列出当前仓库 Pull Requests，支持状态、数量、作者、评审人、处理人、标签、目标分支、更新时间和排序筛选。列表分页依据 OpenAPI 默认页大小逐页请求。
- `cnb pr view <NUMBER|URL>`：显示 PR 详情，以及 API 明确支持的差异文件、提交、CI 状态、评审和评论。
- `cnb pr create`：从当前分支创建 Pull Request，支持标题、正文、目标分支和草稿选项。
- `cnb pr comment <NUMBER> --body <TEXT>`：新增 PR 评论。
- `cnb pr review <NUMBER> --approve|--request-changes|--comment`：提交评审及可选正文。
- `cnb pr merge <NUMBER>`：执行合并；必须明确选择支持的合并方式，调用前二次确认，`--yes` 可用于自动化。
- `cnb pr list` 的额外筛选参数对应 OpenAPI 已核实字段：`--authors`、`--reviewers`、`--assignees`、`--labels`、`--base`、`--updated-time-begin`、`--updated-time-end`、`--order` 及三个多值筛选操作符。
- `--json`：对仓库、PR 列表和详情输出稳定 JSON；默认输出格式化文本。
- 错误信息说明失败原因和可操作的修复方式；非交互环境不等待输入。

## 平台/API 边界

- API 根地址使用 CNB 官方 OpenAPI 公布的 `https://api.cnb.cool`。
- CNB OpenAPI 的仓库 API 声明 Bearer 身份验证；所有 API 请求都必须提供 Access Token，通过 `Authorization: Bearer` 发送。公开仓库默认只读权限不代表可匿名调用。
- 已核实的权限：仓库详情 `repo-basic-info:r`；PR 查询、创建和合并分别要求 `repo-pr:r`、`repo-pr:rw`；评论与评审读取/写入分别要求 `repo-notes:r`、`repo-notes:rw`。Token 范围不足由服务端返回 403，CLI 明确呈现，不尝试绕过。
- PR 创建仅发送 `base`、`body`、`head`、`title`；CNB schema 没有确认 draft 字段，因此 `--draft` 明确报错。普通评论仅发送 `body`；评审仅发送已确认的 `event` 和用户提供时的 `body`；合并仅发送明确选择的 `merge_style`，不发送 `force`。
- `cnb pr view` 使用 OpenAPI 明确列出的详情、files、commits、commit-statuses、comments、reviews 路由。`api.Pull` schema 未声明网页链接字段；如服务端响应也不含该字段，CLI 不拼造 URL，网页链接项仍未完成。
- 首版支持 CNB 官方 API 已公开的仓库和 Pull Request 能力；能力缺失或服务端拒绝时返回明确错误，不伪装成成功。
- 仓库识别只接受 CNB remote URL；GitHub、GitLab、Bitbucket remote 给出平台不匹配提示。
- 支持 HTTPS remote。SSH URL 仅用于识别仓库，不从 Git 配置提取或显示私钥。
- API 请求设定超时，处理分页、非成功 HTTP 状态和无效响应；Token 不出现在错误文本。

## 首版不包含

Issue 管理、Release、Workflow 操作、通用任意 API 代理、插件系统、多平台统一命令、交互式全屏终端界面，以及 OAuth 浏览器授权。以上能力在 CNB API 覆盖和首版使用反馈明确后再定。

## 验收标准

1. Windows 原生构建出独立 `cnb.exe`，不依赖 Docker。
2. 没有 Token 时所有仓库 API 请求都给出认证提示；权限不足时呈现服务端 403。CNB 官方文档说明，Token 默认对公开仓库只读，对私有仓库无权限。
3. 已配置且具备相应范围的 Token 可读取 CNB 仓库与 PR 数据，并能输出 JSON。
4. 创建、评论、评审、合并命令仅使用已核实的 API 请求体字段；写请求失败状态和权限问题清楚可见。
5. 帮助包含命令、参数、示例和认证说明。
6. 用户可安全登出，敏感 Token 不落入普通配置文件和日志。

## 实现约束

- 先依据 CNB 官方 OpenAPI 核对每个操作的请求路径、权限、分页和响应形状；没有依据的命令不得猜 API。
- 使用 Rust 与 Windows Credential Manager；避免复制 GitHub CLI 的源码或依赖其运行时。
- 已核实 OpenAPI 中另有 PR reviewers、labels、review inline comments 和 replies 等路由，但首版没有对应的交互命令，不声称支持这些写入能力。
- CLI 仅承担 CNB CLI 职责，不在首版改动 GitDesktop 现有 GitHub、GitLab、Bitbucket 行为。

## 交付边界

- 文件范围：`cnb-cli/**`、`changelog.d/added-cnb-cli.md`、本说明文件。
- Docs-sync: orchestrator handles README integration after parallel implementation; add a changelog fragment; do not edit marketing site or GitDesktop provider adapters.
- Verification: `cargo check --manifest-path cnb-cli/Cargo.toml` and `cargo build --manifest-path cnb-cli/Cargo.toml --release`；不运行测试。

## GitHub CLI 参考

参考 `cli/cli` 官方开源仓库的命令分组、帮助文档、认证边界、当前仓库自动识别、JSON 输出和 PR 工作流。官方源码目录按 `pkg/cmd/<command>/<subcommand>/` 组织。本项目采用 Rust 和 CNB API 独立实现。
