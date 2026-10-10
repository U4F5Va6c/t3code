# Codeup Fork 的维护与个人安装

本 Fork：<https://github.com/U4F5Va6c/t3code>。上游：<https://github.com/pingdotgg/t3code>。

当前 `codeup-integration` 分支只建立维护约定，没有实现 Codeup / ProjeX Provider，也没有已验证的自有桌面或 iOS 安装包。设计基线为上游 `a7223f3969428170cc13bd7859aa59098b2f94b1`，后续以实际合入提交为准。

## 分支与上游同步

- `upstream` 指向 pingdotgg/t3code，只拉取上游变更。
- `origin` 指向个人 Fork，默认推送到这里。
- `main` 保持上游主线，不放定制提交；`codeup-integration` 是长期集成分支。
- 功能分支从 `codeup-integration` 创建。Codeup Provider、ProjeX、移动签名与发布分别保持清楚的提交边界。

每周或遇到需要的上游修复时同步。先确保工作区干净，记录当前 Fork 提交，再执行：

```sh
git fetch upstream --prune
git fetch origin --prune
git switch main
git merge --ff-only upstream/main
git push origin main
git switch codeup-integration
git pull --ff-only origin codeup-integration
git switch -c sync/upstream-YYYYMMDD
git merge --no-ff upstream/main
```

`YYYYMMDD` 换成本次日期，分支已存在时选新名称。第一次发布集成分支前不执行其 `git pull`。发生冲突时逐项处理；放弃本轮同步用 `git merge --abort`。不要用 `reset --hard` 或强推覆盖共享分支。

同步分支完成相关测试、类型检查和手动验收后，再通过 Fork 内部 PR 合入 `codeup-integration`。PR 目标不要误选上游仓库。只有明确要贡献上游时才另开上游 PR。

## 独立 Source Control 的边界

Codeup 实现放在新 `packages/source-control-codeup`，复用现有 SourceControlDriver 和 PullRequestProvider 契约。GitHub Provider 内部实现保持不动。设置中使用独立的 Codeup 入口和凭据绑定，仓库 remote 识别后交给对应 driver。

现有注册表、provider 类型、URL 解析、设置页面、图标、Web/mobile 的穷尽映射需要最小加法修改；当前架构不是动态插件系统，因此不能承诺新增目录就自动获得所有 UI 能力。

ProjeX 是独立工作项领域：需求/缺陷/任务不伪装成 PR。工作项可关联多个仓库、MR 和线程，状态以 ProjeX 回读为准。未来 UI 与 Agent MCP 共用服务器服务及权限检查。

Codeup git host 与 API host 分离；凭据、缓存和资源身份包含组织范围。只为验证过的 diff、评审、评论、合并和检查声明 capability。GitHub 专属 stack、merge queue、跨环境凭据路由等不会自动适用于 Codeup。

所有 Git 和云效调用在 server/environment 执行；iPhone 不运行 aliyun CLI，也不直接保存公司 PAT。

## 开发与验证

按根 README 安装 Vite+；当前 package.json 要求 Node `^24.13.1`，包管理器为 `pnpm@11.10.0`。使用匹配版本后在根目录执行 `vp i`。

开发使用独立状态：

```sh
vp run dev --home-dir "$PWD/.t3-codeup-dev"
```

该目录不应提交；首次使用前加入本机 `.git/info/exclude`。不要连接生产 `~/.t3/userdata`，不要覆盖现有服务或复用生产端口。需要 tailnet 分享时依照 [开发指南](development.md) 的 `--share` 流程，不改官方服务的网络映射。

按根 AGENTS.md 运行改动范围内的 tests、lint、typecheck；全仓检查由配置好的 CI 承担。新增 Provider 应覆盖身份/URL、多页/限流、未知状态、写请求超时、MR SHA 与 CI 不匹配、多组织隔离；共享代码变化还需验证原有 GitHub 行为。发布前验证 Web、桌面、移动及远程连接。

Fork 初始关闭 GitHub Actions，避免直接启用上游的发布、EAS、包仓库等流程。准备 CI 时先审查 `.github/workflows`：启用所需验证工作流，禁用或替换发布工作流及 secrets，再开启仓库 Actions。不要导入上游生产 secrets。

## 在自己的 iPhone 安装

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

1. 从验证过的同一个集成提交构建 server、桌面和 mobile，记录上游 SHA、Fork SHA、工具链与构建结果；版本标签使用 `codeup-vX.Y.Z`。
2. 桌面设置自己的 app ID、名称、数据目录、签名及更新来源。开发阶段可设置 `T3CODE_DISABLE_AUTO_UPDATE=true`；正式制品将 `T3CODE_DESKTOP_UPDATE_REPOSITORY` 指向自己的发布仓库。不要让 Fork 更新器覆盖官方版本或反过来覆盖 Fork。
3. 先在独立 environment 验证认证、仓库识别、工作项关联、MR 评审与 CI，再升级日常环境。升级前停止该 environment 并备份其数据；数据库迁移后不能假设旧程序能直接读新数据库。
4. 免费签名通过 Xcode 重装更新，保持自己的 bundle ID；付费后可选择设备签名或自己的 TestFlight。原生依赖、entitlements 或 runtimeVersion 变化必须重建安装包，不能只推 JS OTA。
5. 回退使用上一套配对构建和必要的数据备份。Git 提交回退不能代替数据回退。

官方商店客户端不保证理解 Fork 新增的 provider 类型；原生 Codeup 页面需使用匹配的 Fork 客户端。Skill 与 CLI/MCP 工作流可先独立使用。

## 参考

- [上游移动构建说明](../../apps/mobile/README.md)
- [Apple Personal Team 与开发者账号](https://developer.apple.com/help/account/basics/about-your-developer-account)
- [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/)
- [Expo 开发构建](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo Apple 账号要求](https://docs.expo.dev/app-signing/apple-developer-program-roles-and-permissions/)
