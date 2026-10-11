# Issue tracker: GitHub（本 Fork）

本 Fork 的开发需求、规格和切片记录在 [U4F5Va6c/t3code](https://github.com/U4F5Va6c/t3code/issues) 的 GitHub Issues，使用 `gh`。接入后的公司业务项目才使用 ProjeX，见 `codeup` Skill；两者不做任务镜像。

本仓库同时有 `origin`（Fork）和 `upstream`（pingdotgg/t3code）。每条 `gh` 命令显式带 `-R U4F5Va6c/t3code`，不在上游开 Issue 或 PR。

## Conventions

- **Create an issue**：`gh issue create -R U4F5Va6c/t3code --title "..." --body-file <file>`，并加 `codeup-integration` 标签和所属 Milestone。
- **Read an issue**：`gh issue view <n> -R U4F5Va6c/t3code --json number,title,body,labels,comments`。
- **List issues**：`gh issue list -R U4F5Va6c/t3code --state open --json number,title,labels`，按 `--label` / `--milestone` 过滤。
- **Sub-issue**：`gh issue edit <parent> -R U4F5Va6c/t3code --add-sub-issue <child>`（`gh` 2.94+）；否则在子项正文顶部写 `Part of #<parent>`。
- **Comment**：`gh issue comment <n> -R U4F5Va6c/t3code --body-file <file>`。
- **Labels**：`gh issue edit <n> -R U4F5Va6c/t3code --add-label "..."` / `--remove-label "..."`。
- **Close**：合入后逐项核对验收，再 `gh issue close <n> -R U4F5Va6c/t3code --comment "..."`。

PR 的目标分支是 `codeup-integration`，不是默认的 `main`，所以 `Closes #n` 不会自动关闭 Issue；`implement-spec` 结束时按上面的 **Close** 显式关闭。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

在本 Fork 创建 GitHub Issue（见 **Create an issue**）。

## When a skill says "fetch the relevant ticket"

按 **Read an issue** 读取。提交信息中的 `-#<n>` 后缀指本 Fork 的 Issue 编号。

## ready-for-agent

使用同名 GitHub 标签 `ready-for-agent`（已创建）。本机未安装 `triage`，不使用其余分诊标签。

## Wayfinding operations

供 `/wayfinder` 使用。**Map** 是一个 Issue，**ticket** 是它的 sub-issue。

- **Map**：`gh issue create -R U4F5Va6c/t3code --label wayfinder:map`，正文为 Destination / Notes / Decisions so far / Not yet specified / Out of scope。标签缺失时先 `gh label create`。
- **Child ticket**：map 的 sub-issue，标签 `wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。
- **Blocking**：GitHub 原生依赖。`gh api --method POST repos/U4F5Va6c/t3code/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，`<blocker-db-id>` 来自 `gh api repos/U4F5Va6c/t3code/issues/<n> --jq .id`。所有 blocker 关闭即解除阻塞。
- **Frontier query**：map 下打开的 sub-issue，去掉 `issue_dependencies_summary.blocked_by > 0` 或已有 assignee 的，按 map 顺序取第一个。
- **Claim**：`gh issue edit <n> -R U4F5Va6c/t3code --add-assignee @me`，作为本会话的第一个写操作。
- **Resolve**：`gh issue comment <n>` 写答案，`gh issue close <n>`，再在 map 的 Decisions so far 追加一行指针。
