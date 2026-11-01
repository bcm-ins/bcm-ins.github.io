# 参与 cam-ins

无需源码写入权限。进入 [Discussions](https://github.com/bcm-ins/bcm-ins.github.io/discussions)，使用 GitHub 账号发表 Markdown 文章。

| 类型 | GitHub 分类 |
| --- | --- |
| 知识文章 | General |
| 问题 | Q&A |
| 固件 / 软件发布 | Show and tell |

在表单「板块」字段（或手写 Markdown 的第一行）填写：

```markdown
#相机固件/索尼/a7c2 #软件与工具
```

新标签建立板块，斜杠建立父子层级，一篇文章可以进入多个板块。编辑原帖最开头的标签即可调整归属。原文、回复、答案和编辑权限由 GitHub 管理；网站同步展示公开文章。

知识文章欢迎测量、拆解、实验与资料整理。问题请说明机型、版本、现象与复现方法。发布作品时链接到作者自己的 Releases，给出版本、适配范围、SHA-256、许可和恢复说明；普通成员不能直接向社区仓库的 Releases 上传附件。

网站修改通过 pull request 提交。运行 `pnpm test`、`pnpm build`、`node scripts/verify-build.mjs`。不要提交密钥或把下载的固件二进制塞进网站源码。
