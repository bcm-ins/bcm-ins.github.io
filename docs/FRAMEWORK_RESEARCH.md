# GitHub Pages 相机硬件社区框架调研

核查日期：2026-11-02（Asia/Taipei）。范围：13 个开源项目、GitHub Pages / Discussions / Releases 官方文档。本报告依据当日上游 README、仓库元数据和文档；未对 13 个项目逐一生产部署或做性能跑分，不以 star 数替代功能判断。证据索引见 [RESEARCH_SOURCES.json](RESEARCH_SOURCES.json)。

## 需求与最终决策

用户要求用 GitHub 账号参与相机硬件交流，所有帖子统一为 Markdown 文章，左侧标识区分知识文章 / 问题 / 固件或软件发布。板块作为独立维度，放在文章最开头，支持 `#相机固件/索尼/a7c2` 层级、多板块归属、用户新增及后期修改。用户已明确接受首版进入 GitHub Discussions 发文与回复。

采用 **Astro + GitHub Discussions + GitHub Actions + 作者各自的 GitHub Releases**。Discussions 是实际社区引擎，Astro 是展示层；不是从零实现认证、编辑器、通知、权限、评论或版主系统。网站品牌为 cam-ins，实际账户、仓库与站点归属 bcm-ins。

## 候选比较

| 方案 | 内容与登录 | 讨论管理 | Pages 适配与结论 |
| --- | --- | --- | --- |
| [GitHub Discussions](https://docs.github.com/en/discussions) | GitHub 账户、Markdown 主帖与回复；分类可设问答 / 公告 | 问答答案、分类、置顶、关闭、锁帖、删除，权限沿用 GitHub | Pages 外的成熟社区后端；首版采用，发文与回复到 GitHub |
| [giscus](https://github.com/giscus/giscus) | 基于 Discussions 的页面评论；OAuth 授权 giscus App | 在 GitHub 管理讨论 | 可在 Pages 嵌入；需要安装并授权第三方 App。是评论组件，不提供完整社区文章流和多层板块；首版不增加这项依赖 |
| [Utterances](https://github.com/utterance/utterances) | GitHub Issues 评论，GitHub OAuth | Issues 管理 | 易接静态博客，适合页面评论；问答与社区分类不如 Discussions 贴合。核查时最后 push 为 2024-08-15，不据此直接断言停维护 |
| [Gitalk](https://github.com/gitalk/gitalk) | 当日主分支已是 2.x Discussions / GitHub App 方案，不是旧版 Issues-only | 对接 GitHub 数据 | README 开头写「No backend」，后文明确 OAuth token endpoint 要自行部署，Cloudflare / CloudBase / Node 可选；不误称纯 Pages 即可。README 还提示发布到 npm 的状态，不能只按旧教程安装 |
| [Gitment](https://github.com/imsun/gitment) | GitHub Issues 评论，旧 OAuth 接入示例 | 依靠 Issues | 旧文档示例包含 client secret 字段，不沿用到公开静态站；核查时最后 push 2021-10-05。此项目不作为新站首选 |
| [Gmeek](https://github.com/Meekdai/Gmeek) | Pages + Issues + Actions，以 Issues 写博客 | Issues 评论与标签 | 很适合个人博客；本次需要开放多作者、问答、层级多板块与独立文章类型，直接采用会有较多结构改造 |
| [Hexo](https://github.com/hexojs/hexo) | Node 静态博客、Markdown；登录/评论另接 | 本身不是论坛 | Pages 适用，主题丰富；适合博客，动态社区仍需 Discussions 等外部系统 |
| [Hugo](https://github.com/gohugoio/hugo) | Go 静态内容站、Markdown、分类 | 本身不提供社区账号/版主管理 | Pages 适用，构建快；可承担同样门户角色，但此次交互列表和内容同步采用已有 Node 工具链更直接 |
| [Astro](https://github.com/withastro/astro) | 静态内容站、组件化页面，必要部分使用浏览器 JS | 由外部社区引擎承担 | 采用。静态生成文章全文和板块页，筛选/搜索只有少量脚本。不是宣称 Astro 自带论坛 |
| [Docusaurus](https://github.com/meta/docusaurus) | React 文档与博客，Markdown/MDX | 评论与登录另接 | Pages 适用，偏版本化文档。多作者社区流并非其主要模型；不把成员 Markdown 当作可执行 MDX |
| [Discourse](https://github.com/discourse/discourse) | 完整社区应用，支持社交登录集成 | 成熟分类、信任体系、用户组与管理机制 | 需独立应用及数据库 / Redis，不能直接放 Pages 运行。全站内互动、多版主及大规模社区的主要后续候选 |
| [Flarum](https://github.com/flarum/framework) | PHP 论坛，登录能力可扩展 | 标签、讨论与扩展机制 | 需要 PHP / 数据库服务，不可纯 Pages。借鉴清爽讨论列表与类型/标签布局 |
| [NodeBB](https://github.com/NodeBB/NodeBB) | Node.js 论坛，数据库与实时通信 | 分类、成员及讨论管理 | 需要常驻服务与数据库，不可纯 Pages。适合未来独立部署 BBS |
| [Talkyard](https://github.com/debiki/talkyard) | 讨论、问答、聊天及嵌入评论 | 独立社区服务 | 可与静态博客组合，但后端需另外托管；不满足本轮只使用 GitHub 服务的简洁起步目标 |

上表为 13 个开源项目加 GitHub 原生 Discussions。Astro 本轮采用 7.4.4，marked 18.1.2；依赖审计发现的旧版本问题已通过升级处理，esbuild 使用已修复版本覆盖。完整依赖版本固定在 pnpm-lock.yaml，后续更新应重新检查。

## 账号、权限与文件发布的实际边界

1. **Pages 是静态托管。** 不在前端放 OAuth client secret 或个人访问令牌，也不让浏览器拿仓库管理员令牌代理普通用户发帖。
2. **用户使用已有 GitHub 身份。** 无本站会员密码、自动注册数据库、私信或独立权限系统。本站的「用 GitHub 参与」前往 Discussions，不伪装为本站已经登录。
3. **版主管理用 GitHub。** 官方支持答案、关闭、锁帖及编辑/删除。triage 等细分角色依仓库归属与 GitHub 权限模型而定；当前是个人仓库，不能宣称已经拥有组织的独立版主角色。后续多版主应考虑组织化。
4. **发帖不等于发布仓库 Release。** 普通社区成员没有社区仓库的写权限，所以二进制放作者自己的 Releases，文章中嵌入链接。网站不提供伪上传按钮，不将成员提升为源码维护者。
5. **GitHub 可用性决定互动可用性。** 访问 GitHub 受限时静态快照仍可阅读，发帖、通知和下载链接可能不可用；不承诺大陆网络连通性或服务可用性 SLA。

## 类型和板块是两套独立维度

| 社区标识 | GitHub 原生分类 | 说明 |
| --- | --- | --- |
| 知识文章 ≡ | General | 完整 Markdown 正文 |
| 问题 ? | Q&A | Markdown 正文并支持答案状态 |
| 固件 / 软件发布 ↓ | Show and tell | Markdown 正文，内嵌下载 / 源码 / 文档链接 |

系统公告及其他旧分类按知识文章展示。文章类型由 GitHub 分类决定；分类调整遵循 GitHub 权限。板块来自正文首段，不需要作者拥有仓库 label 管理权限。

```markdown
#相机固件/索尼/a7c2 #软件与工具

## 我的文章
这里是正文，可放图片、代码和固件链接。
```

同时支持表单产生的 `### 板块` 加标签行。只读取首个内容块，忽略正文后部和代码中的 #。自动加入全部父级，一文多板块；编辑会重新计算归属；新标签自动进入板块目录。标签采用允许字符、长度、层数和数量限制，路径以标签名散列生成，不把用户字符串作为本地路径。板块标签不执行代码。

这种方案满足「用户自行增加板块」，代价是新板块不经过单独预审。需要治理同义名、错拼和滥用，维护者可以编辑原文或处理不当帖子。自动生成的空板块不保留，六个初始入口保留。正式独立论坛如果要板块级权限、私密板块、板主或标签别名，应更换后端数据模型。

## 内容生命周期与同步

- 原始 Markdown 及讨论保存在 GitHub；文章页和板块页由 Actions 在构建期读取 GraphQL 生成。
- 发表、编辑、删除、分类改变、答案、锁定及回复变化触发构建；额外每 6 小时兜底同步反应数等未触发事件。
- 静态网站没有「瞬间同步」保证；GitHub 原帖是实时状态。构建失败保留上次部署，不能默默发布空论坛。
- 每批 100 篇分页，当前明确上限 2,000 篇；超过上限构建失败提示扩容，不静默截断。内容同步不写回仓库，避免不断提交镜像历史。
- 删除原帖后下一次完整构建不再生成对应页面。CDN、搜索引擎和外部副本不保证即时清除。
- 未引入浏览器端 Markdown 执行。成员内容经过 marked 解析和 sanitize-html 清洗；不允许 script、事件属性、iframe、表单或 javascript URL。
- CI 只给予构建读取内容/讨论权限，部署阶段单独给予 Pages / OIDC 权限；不将成员正文拼入 shell。依赖使用锁文件，Actions 固定提交。

## 界面取舍

参考 Discourse / Flarum 的左侧板块、文章列表、类型图标、简明元信息与移动端优先信息层级，结合 GitHub Discussions 的真实账号和 Markdown 内容。没有复制商标或抓取他人文章作为伪社区数据。

页面开头展示多板块标签；左侧图标严格对应文章类型。阅读页提供源码原文链接和讨论入口；发布页清晰说明将跳到 GitHub。搜索覆盖标题、摘要、作者和板块，非全文搜索；目录可以浏览新标签和层级。

## 规模、成本与后续路径

官方 Pages 文档当前列出已发布站点 1 GB、每月 100 GB 软带宽限制等。固件包和大图不应堆进 Pages；下载由原作者 Release 承担。自定义 Actions 的构建限制与额度按 GitHub 当前政策执行，活跃社区频繁评论触发重建会增加 Actions 使用量，应在规模增长时按事件合并、定时批处理或独立后端优化。

如果需要站内完整登录和回复，可首先评估 giscus，但它仍是嵌入评论，不能自动提供完整 BBS 会员和权限体系。如果需要独立版主角色、私信、信任等级、审核队列、板块权限或更大规模实时更新，迁移到 Discourse / Flarum / NodeBB，并规划账号映射、原文和回复迁移、旧链接跳转。

## 官方资料

- [Pages 的静态托管定义](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Discussions 管理](https://docs.github.com/en/discussions/managing-discussions-for-your-community/moderating-discussions)
- [分类和权限](https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions)
- [讨论表单](https://docs.github.com/en/discussions/managing-discussions-for-your-community/creating-discussion-category-forms)
- [表单语法](https://docs.github.com/en/discussions/managing-discussions-for-your-community/syntax-for-discussion-category-forms)
- [Releases 权限](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

这些文档的开源 Markdown 已在本轮读取；各项目上游链接和元数据见同目录证据索引。
