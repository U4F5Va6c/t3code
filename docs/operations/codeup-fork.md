# Codeup Fork 的维护与个人安装

本 Fork：<https://github.com/U4F5Va6c/t3code>。上游：<https://github.com/pingdotgg/t3code>。

Codeup 原生适配已同步至官方 `v0.0.46-nightly.20261012.3010`（上游 `d83929ad0b`），覆盖本期 Source Control 与 MR 客户端验收；ProjeX 原生管理与 iOS 安装包暂缓。实际可验收提交和制品以 Fork PR 的 Codeup CI 为准。

按用户 2026-10-10 的决定，本期保留 Web/桌面原生集成，并优先确保目标机器上的 Agent 通过 `codeup` Skill 和 CLI/MCP 操作平台工作项与仓库。iOS/手机端原生集成、个人签名、真机构建和移动发布暂缓，不作为开发、发布或结项前提。当前范围与验收以 [总需求 #1](https://github.com/U4F5Va6c/t3code/issues/1) 和 [客户端验收 #8](https://github.com/U4F5Va6c/t3code/issues/8) 为准。

## 分支与上游同步

- `upstream` 指向 pingdotgg/t3code，只拉取上游变更。
- `origin` 指向个人 Fork，默认推送到这里。
- `main` 保持上游主线，不放定制提交；`codeup-integration` 是长期集成分支。
- 功能分支从 `codeup-integration` 创建。Codeup Provider、ProjeX 与发布分别保持清楚的提交边界。

跟进官方**已发布的 Nightly tag**；不要把未发布的 `main` 提交或仅修改版本号当成同步。持续检查、可选自动合并和 CI 发布由 [#15](https://github.com/U4F5Va6c/t3code/issues/15) 跟踪。人工同步先确保工作区干净，记录当前 Fork 提交，确认本次 Nightly tag，再执行：

```sh
git fetch upstream --prune
git fetch origin --prune
git switch main
git merge --ff-only upstream/main
git push origin main
git switch codeup-integration
git pull --ff-only origin codeup-integration
git switch -c sync/upstream-YYYYMMDD
git merge --no-ff <official-nightly-tag>
```

`YYYYMMDD` 换成本次日期，`<official-nightly-tag>` 换成已确认的官方 Nightly tag；分支已存在时选新名称。第一次发布集成分支前不执行其 `git pull`。发生冲突时逐项处理；放弃本轮同步用 `git merge --abort`。不要用 `reset --hard` 或强推覆盖共享分支。

同步分支完成相关测试、类型检查和手动验收后，再通过 Fork 内部 PR 以 Merge Commit 方式合入 `codeup-integration`，不 Squash。该分支受保护：必须经 PR 且 Codeup CI 通过，管理员同样不能直接推送或强推。合入后运行 `gh api repos/U4F5Va6c/t3code/actions/workflows --paginate -q '.workflows[]|select(.state=="active")|.path'`，除显式维护的 Fork 工作流外，新增上游工作流立即禁用。PR 目标不要误选上游仓库。只有明确要贡献上游时才另开上游 PR。

## 独立 Source Control 的边界

Codeup 实现放在新 `packages/source-control-codeup`，复用现有 SourceControlDriver 和 PullRequestProvider 契约。GitHub Provider 内部实现保持不动。设置中使用独立的 Codeup 入口和凭据绑定，仓库 remote 识别后交给对应 driver。

上游已把 provider kind 改为开放 slug，每个 host 包自带 `src/client/definition.ts`（展示、URL、能力、设置）和 `src/server/` driver。最近的完整参照是 `packages/source-control-gitcafe`（REST API + token 设置）；CLI 封装型参照是 `source-control-gitlab`。`source-control-azure-devops` 只覆盖 PR，不含工作项，不作为 ProjeX 参照。新 host 的注册点用以下命令列出，逐一照做：

```sh
git grep -il gitcafe -- apps packages ':!packages/source-control-gitcafe' ':!*.test.*'
```

共享类型影响 mobile 时只做必要的兼容处理，不新增手机原生云效入口。

ProjeX 是独立工作项领域：需求/缺陷/任务不伪装成 PR。工作项可关联多个仓库、MR 和线程，状态以 ProjeX 回读为准。未来 UI 与 Agent MCP 共用服务器服务及权限检查。

Codeup git host 与 API host 分离；凭据、缓存和资源身份包含组织范围。只为验证过的 diff、评审、评论、合并和检查声明 capability。GitHub 专属 stack、merge queue、跨环境凭据路由等不会自动适用于 Codeup。

所有 Git 和云效调用在 server/environment 执行；iPhone 不运行 aliyun CLI，也不直接保存公司 PAT。

目标执行环境必须具备对应版本的 Skill、CLI/MCP、API 凭据和 Git 鉴权。现有手机 App 可作为可选远程对话入口，但其与 Fork 服务端的兼容性尚未验证，不作为本期验收门槛。

## 开发与验证

按根 README 安装 Vite+；当前 package.json 要求 Node `^24.13.1`，包管理器为 `pnpm@11.10.0`。本机默认 Node 不满足时用版本管理器按命令切换（如 `fnm exec --using=24 vp i`），不改全局默认。

开发使用独立状态：

```sh
vp run dev --home-dir "$PWD/.t3-codeup-dev"
```

该目录不应提交；首次使用前加入本机 `.git/info/exclude`。使用 CodeGraph 时在本机根目录放 `codegraph.json`（`{ "exclude": [".repos/"] }`，同样加入 exclude）：`.repos/` 的 vendored 参考仓库会让索引内存超限中断。不要连接生产 `~/.t3/userdata`，不要覆盖现有服务或复用生产端口。需要 tailnet 分享时依照 [开发指南](development.md) 的 `--share` 流程，不改官方服务的网络映射。

按根 AGENTS.md 运行改动范围内的 tests、lint、typecheck；全仓检查由配置好的 CI 承担。新增 Provider 应覆盖身份/URL、多页/限流、未知状态、写请求超时、MR SHA 与 CI 不匹配、多组织隔离；共享代码变化还需验证原有 GitHub 行为及受影响的移动类型/兼容路径。发布前验证 Web、桌面、目标机器上的 Agent 及远程连接；本期不要求移动原生功能或真机验收。

Fork 只运行 `.github/workflows/codeup-ci.yml`：`codeup-integration` 的 PR 与推送执行上游同款 lint、typecheck 及 Source Control 相关包测试，使用 GitHub 托管 runner。上游工作流依赖 `blacksmith-*` runner 和发布 secrets，在 Fork 中全部手动禁用；默认 `GITHUB_TOKEN` 只读。web 与 server 大套件按根 AGENTS.md 在本地定向运行。不要导入上游生产 secrets。

## macOS Codeup Preview

指向 `codeup-integration` 的 PR 由 Codeup CI 构建 Apple Silicon（arm64）和 Intel（x64）DMG，以及 Mac arm64、Linux x64 独立后端。版本复用上游 Nightly 的基础版本推导规则，使用 `X.Y.Z-codeup.<日期>.<CI 运行号>`；同一运行的桌面、Web 与服务端使用相同版本和提交。图标、启动素材和星空背景复用 Nightly，应用身份保持独立。
在该 PR 的 Actions 运行中下载对应 `codeup-preview-macos-*` artifact，解压后核对
`COMMIT.txt` 与 PR head、`SHA256SUMS.txt` 与 DMG。制品保留 30 天。

安装为 **T3 Code (Codeup Preview).app**，可与原版同时存在：

- Bundle ID：`io.github.u4f5va6c.t3code.codeup-preview`。
- Chromium 配置：`~/Library/Application Support/t3code-codeup-preview`，不与原版共用运行中的 profile；主题和字体等设备偏好可通过设置对齐。
- 服务端数据：`~/.t3-codeup-preview`；忽略继承的 `T3CODE_HOME` 和固定端口配置。
- 专用协议：`t3code-codeup-preview://`，不接管原版链接和默认浏览器。
- 当前仍禁用自动更新；更新通过安装新的 Fork 制品完成。客户端更新与 Connections 后端升级分别由 #16、#17 跟踪，不能仅取消禁用开关就接入官方更新源。

应用使用 ad-hoc 本地签名，CI 会挂载最终 DMG 校验签名并启动包内 Electron；没有 Developer ID 签名或 Apple 公证。
首次打开可能需要在 macOS **系统设置 → 隐私与安全性** 中允许打开；
只对核对过提交和校验和的该应用放行，不要关闭全局 Gatekeeper。

首次启动会建立空的隔离 environment。可添加独立测试 checkout，也可连接隔离远程服务；
不要把原版数据库复制回去。Codeup 自动检测发生在实际执行 Git/API 的服务端机器上，
因此 Mac 客户端连接 Linux environment 时无需在 Mac 重复配置公司 PAT。
本机 Mac 需要能从应用进程找到凭据入口，见 [Codeup 认证](../user/source-control.md#codeup)。
用专用测试仓库验收 MR 列表、详情、diff、评论与线程徽标，合并操作也只在测试 MR 上进行。
本期复用 T3 现有的 MCP 关联、预览与监控链路；不新增 MR CRUD/评审专用 MCP 工具，
这些平台操作可由客户端执行，agent 仍可使用本机云效 CLI/Skill。
卸载时退出预览应用，再按需移除它的两个独立数据目录；保留原版目录。

## 暂缓：在自己的 iPhone 安装

以下内容仅保留为未来恢复时的参考，本期不执行 Xcode、签名、移动 OTA 或真机构建准备。恢复前重新核对届时的上游配置和 Apple/Expo 要求。

免费 Apple Account 可以使用 Xcode Personal Team 本地签名，不必为了第一次试用购买会员。免费描述文件 7 天到期，需要重新构建/安装；不能指望一次安装永久可用。付费 Developer Program 提供更多签名能力及 TestFlight 等分发途径；EAS 真机云构建通常也需要付费账号。先本地跑通，再决定是否付费。

首次准备：

1. 安装适配当前 macOS 和手机 iOS 的完整 Xcode，首次启动完成许可、平台 SDK 和组件安装。只有 Command Line Tools 不够。
2. 在 Xcode 登录自己的 Apple Account；用数据线配对并信任 iPhone，在设备开启 Developer Mode。Xcode 自动签名时选择自己的 Team。
3. 安装仓库要求的 Node/Vite+ 和依赖，准备 CocoaPods。检查 `xcodebuild -version` 能运行；必要时通过 `DEVELOPER_DIR` 指定 Xcode，不必改动整台机器的默认开发目录。
4. 在 `apps/mobile/app.config.ts` 建立 Fork 自己的 app name、URL scheme、bundle ID 和签名设置；自己的 bundle ID 应唯一。保留原版安装便于回退。

### 当前源码的签名与更新注意点

上游提供 `T3CODE_IOS_PERSONAL_TEAM=1` 与 `T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID`，会移除 widget/share extensions、push 与原生 Sign in with Apple 能力。它不意味着当前配置已全部可直接用于自己的账号：`ios.appleTeamId` 仍固定为上游 Team；Keychain group 仍引用 variant 的标识；associatedDomains 指向官方域名。首次真机构建前需在源码配置里改为自己的签名/标识，或去掉无需使用的能力，并核对 prebuild 后的 entitlements。仅在生成的 Xcode 工程里修改会被下一次 `prebuild --clean` 覆盖。

当前移动 OTA 默认指向官方 EAS 项目。个人 Fork 首先设置 `T3CODE_MOBILE_UPDATES_ENABLED=0`，使用本地安装包更新；以后启用 OTA 时创建自己的 EAS 项目、频道和发布权限，并保持 fingerprint/runtimeVersion 匹配。不要向官方 EAS 项目发布。

完成以上准备后的构建入口（在 `apps/mobile` 执行）：

```sh
T3CODE_IOS_PERSONAL_TEAM=1 \
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=io.github.u4f5va6c.t3code.codeup \
T3CODE_MOBILE_UPDATES_ENABLED=0 \
vp run ios:release
```

该命令只示范已有入口，不代表本 Fork 已完成签名适配或真机验收。连接真机并选择设备；如果 CLI 默认选择模拟器，可先按同样环境运行 Expo prebuild，再打开生成的 Xcode workspace，选择自己的 Team 和真机，以 Release 配置运行。

Release 包内嵌 JS，不需要 Metro 常驻；`ios:dev` 是迭代调试方式，需要开发服务。项目使用原生模块，不能靠 Expo Go 完成安装。`.env` / `.env.local` 在仓库根目录，不能把配置写到 `apps/mobile/.env`。

首次个人使用连接自己服务器的局域网/Tailscale 地址即可，T3 Connect 不必启用。手机仍需要能访问服务器，服务器还要保持运行；离开 Mac 后仅把 App 留在手机上不等于有独立 Agent 后端。

## 发布、更新与回退

1. 从验证过的同一个集成提交构建 server、Web 和桌面，记录上游 SHA、Fork SHA、Skill 版本、工具链与构建结果；版本标签使用 `vX.Y.Z-codeup.<日期>.<CI 运行号>`。本期不构建移动制品。
2. 桌面设置自己的 app ID、名称、数据目录、签名及更新来源。开发阶段可设置 `T3CODE_DISABLE_AUTO_UPDATE=true`；后续启用在线更新时必须同时提供 Fork 更新清单、安装制品、签名和独立频道，仅设置 `T3CODE_DESKTOP_UPDATE_REPOSITORY` 不足以让当前预览包自动更新。不要让 Fork 更新器覆盖官方版本或反过来覆盖 Fork。
3. 先在独立 environment 验证认证、仓库识别、工作项关联、MR 评审与 CI，再升级日常环境。升级前停止该 environment 并备份其数据；数据库迁移后不能假设旧程序能直接读新数据库。
4. 验证目标环境中的 Codex/Claude Code 能通过所配置的 Skill 与 CLI/MCP 完成平台操作和回读，远程断线后可以恢复；不以手机安装自签 App 为前提。
5. 回退使用上一套配对构建和必要的数据备份。Git 提交回退不能代替数据回退。

官方商店客户端不保证理解 Fork 新增的 provider 类型；原生 Codeup 页面需使用匹配的 Fork 客户端。Skill 与 CLI/MCP 工作流可先独立使用。

## 参考

- [上游移动构建说明](../../apps/mobile/README.md)
- [Apple Personal Team 与开发者账号](https://developer.apple.com/help/account/basics/about-your-developer-account)
- [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/)
- [Expo 开发构建](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo Apple 账号要求](https://docs.expo.dev/app-signing/apple-developer-program-roles-and-permissions/)
