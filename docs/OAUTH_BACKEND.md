# 站内写作与 GitHub 授权

Pages 提供静态页面；Cloudflare Worker 负责 GitHub App OAuth 与受限发文接口；GitHub Discussions 是 Markdown 原文来源。回复、通知、举报、置顶和锁帖仍在 GitHub 管理。

## 当前资源

- 前端：`https://bcm-ins.github.io`
- API：`https://cam-ins-community-api.cam-ins-community.workers.dev`
- Worker：`cam-ins-community-api`
- D1：`cam-ins-community`，绑定 `DB`，结构见 `backend/migrations/`。
- GitHub App：`https://github.com/apps/cam-ins-community-bcm-ins`，ID `5569249`，所有者 `bcm-ins`。
- App 只申请 Discussions 读写、Metadata 只读；安装于社区仓库。发布使用访问者自己的用户令牌，不使用管理员 PAT 或安装令牌代发。
- OAuth callback：API 的 `/auth/callback`；网页接续页 `/auth/callback/`。

## 配置与发布

Worker 的非秘密设置见 `backend/wrangler.jsonc`。环境秘密仅保存在 Cloudflare：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`TOKEN_ENCRYPTION_KEY`（32 随机字节的 base64url）。不得提交密钥或把它们加入 `PUBLIC_` 变量。

```sh
pnpm exec wrangler d1 migrations apply cam-ins-community --remote -c backend/wrangler.jsonc
pnpm exec wrangler deploy -c backend/wrangler.jsonc
```

已有 GitHub App 无需重建。新环境可运行 `scripts/setup-github-app.mjs`，事先设置 `COMMUNITY_API` 为后端 HTTPS 源；本机临时入口只监听 127.0.0.1，用户确认创建后，程序将密钥通过 stdin 交给 Wrangler，忽略不需要的私钥和 webhook secret，不落盘凭据。完成后停止临时程序。

GitHub 仓库 Actions variable `PUBLIC_COMMUNITY_API` 指向 API 源。前端 CSP 和 API CORS 仅允许配置的源。部署后用 `/health` 检查配置是否齐全，但这不代替实际 OAuth 与发文测试。Worker 不由 Pages 工作流自动部署，变更后需要单独执行部署命令。

Windows 本机的 Wrangler 配置位置由 `XDG_CONFIG_HOME=E:/UserData/bcm18/Config` 指定；缓存 `XDG_CACHE_HOME=E:/Caches`，TEMP/TMP 指向 E:/Temp/bcm18。禁用 Wrangler 遥测，日志定向 E:/Temp/bcm18。不要输出令牌，也不要从浏览器提取登录 cookie。

## 会话与授权边界

- GitHub OAuth state + S256 PKCE；回调原子消费授权状态。
- 返回网页的是一次性、120 秒有效且绑定浏览器 verifier 的票据，不是 GitHub token。
- 网页仅在 sessionStorage 保存随机会话标识；D1 只保存其 SHA-256。GitHub token 以 AES-GCM 加密保存，最长约 8 小时，不使用 refresh token 延期。
- 退出登录立即删除当前会话；GitHub 应用授权撤销由 GitHub 应用设置管理。
- 每 6 小时清理过期会话、票据、授权流程、幂等记录和限流记录。D1 本身的恢复机制仍遵循 Cloudflare 保留策略。
- API 固定社区仓库及三种分类，编辑同时检查作者身份和 GitHub viewerCanUpdate。不能修改他人文章，类型调整继续由维护者在 GitHub 完成。
- 发布限流、正文大小限制、请求幂等；不确定的网络失败保留 pending，提示检查原帖，避免重复文章。
- Markdown 在浏览器预览和服务端静态构建各自清理；浏览器 CSP 禁止内联脚本。

## 维护与限制

密钥轮换时，新的加密密钥会令旧会话无法解密，应先清空旧会话与登录票据，让用户重新登录。不要在有未完成发布时盲目重试或清除幂等记录。

当前草稿只保存在当前设备，发布后全部公开。新文章和板块在 Pages 自动构建后可读；成功页提供即时 GitHub 原帖入口。普通成员是否可发文仍受 GitHub 账号状态、仓库限制和 App 权限约束。

无需自管服务器。当前设计使用 Workers/D1 免费层；超出平台配额时需要评估请求量或套餐，不自动升级付费资源。

测试：`pnpm test` 覆盖真实 SQLite 表结构、授权状态与票据重放、令牌加密、CORS、会话失效、作者隔离、仓库固定及重复请求。GitHub API 在单元测试中模拟；上线验收另行记录真实流程。
