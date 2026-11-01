# cam-ins · 相机硬件社区

网站：https://bcm-ins.github.io/
讨论：https://github.com/bcm-ins/bcm-ins.github.io/discussions

Astro 静态门户 + GitHub Discussions 社区。文章使用 Markdown，知识文章 / 问题 / 固件与软件发布共享同一阅读结构。原生 GitHub 负责登录、编辑、回复、通知和管理。

## 板块

文章第一段，或发文表单的「板块」栏：

```markdown
#相机固件/索尼/a7c2 #软件与工具
```

自动建立层级、支持多板块，用户编辑原文即可修改归属。发文类型与板块独立。使用说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 本地开发

需要 Node 24 和 pnpm 11.25.0。依赖版本以锁文件为准。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
node scripts/verify-build.mjs
pnpm dev
```

`src/data/community.json` 是启动时的公开文章快照，仅用于离线开发。正式发布的 Actions 每次从 GitHub 重新读取原帖，不以旧快照覆盖删除或修改。

```sh
# 在环境中提供仅用于构建的 GH_TOKEN 或 GITHUB_TOKEN，不把令牌写进文件。
pnpm sync
pnpm build
```

本机路径：E:/camins；Node / pnpm 使用已有运行时，所有项目产物与可迁移缓存均放 E 盘。GitHub CLI 在 E:/Tools/gh/bin/gh.exe，配置路径由本地 Git credential helper 指定；不把本机路径写进 CI 配置。

## 自动部署

`.github/workflows/pages.yml`：推送、讨论及回复事件触发更新，每 6 小时有一次兜底同步，也可手动运行。Pages 使用 GitHub Actions 发布源；默认分支 main。

构建仅读取公开讨论，GitHub token 不进入浏览器或产物。发布文件来自 dist；固件二进制由作者自己的 Releases 托管。同步最多 2,000 篇，达到上限会明确失败，需审阅后提升限制或迁移；不静默截断。

## 管理与接续

- [框架调研与架构取舍](docs/FRAMEWORK_RESEARCH.md)
- [社区公约](CODE_OF_CONDUCT.md)
- [启动讨论记录](docs/LAUNCH_DISCUSSIONS.json)
- 原文在 GitHub 编辑。板块首行可由作者修改；类型由 GitHub 分类决定，分类/置顶/锁定等操作遵循 GitHub 权限。
- 当前为个人仓库，维护者 bcm-ins。未创建其他版主账号，不宣称具备组织的独立 triage 权限。
- 网站问题通过 Issues 或 #社区建设 反馈。准备组织化、多版主或站内完整论坛时，先评估 Discourse / Flarum / NodeBB 的独立托管。
