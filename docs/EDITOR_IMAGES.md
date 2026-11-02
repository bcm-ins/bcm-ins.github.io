# Markdown 编辑器与图片

2026-11-02。文章与回复共用 CodeMirror 6 Markdown 编辑器，参考其官方组合式扩展接口：https://codemirror.net/docs/ 。保留 Markdown 为原始内容，不将正文转换为私有富文本格式。

工具栏提供粗体、斜体、标题、引用、列表、代码块、表格、链接、图片、撤销与重做。支持语法高亮、自动换行、键盘快捷键和撰写 / 对照 / 预览模式；移动端对照视图上下排列。草稿仍使用原有 localStorage 数据，旧草稿可直接恢复。

## 上传链路

1. 图片选择、拖拽或剪贴板文件进入同一处理函数。PNG / JPEG / WebP，单个原文件最多 20 MiB，最多 80 MP，单批最多 6 张。
2. 浏览器通过 createImageBitmap 和 Canvas 重绘，最长边缩至 2,400 px，优先 WebP 编码，逐级调质量直到不超过 1 MiB；重新编码不保留原始 EXIF / GPS。不支持的文件提示转换，不上传原文件。
3. 用现有站内会话向 Worker POST /images 发送二进制，服务器检查来源、会话、有效 GitHub 授权、流式字节限制、允许的文件签名与 MIME。
4. 以用户 ID + 图片字节的 SHA-256 作为标识，同一用户重复上传幂等；在一个 SQLite 语句中检查存储配额并插入。
5. 返回 /images/{sha256} 的公开地址，插入 ![说明](网址)。GET / HEAD 不需要登录，响应固定图片 Content-Type、nosniff、sandbox 和一天浏览器缓存。

上传期间暂停正文编辑及发布，保证插入位置稳定；失败恢复操作且保留正文。同批前面已成功的图片保留，不因后一张失败撤销。图片面板明确说明立即公开。撤销插入只影响正文；图片链接可能已被其他文章使用，不自动删除数据库记录。

## 存储与部署

沿用已授权的 Cloudflare D1，无新增服务账号、GitHub 权限或付费产品。迁移文件 backend/migrations/0002_images.sql 仅添加 images 表和索引，不修改旧表。

这是有界的小型社区图片存储：1 MiB / 图片、32 MiB / 用户、全站 256 MiB 图片字节；20 次上传请求 / 用户 / UTC 日。超限返回明确错误，不自动购买容量、不自动删除旧图。全站配额不含 SQLite 索引和记录开销。规模增长时应将二进制迁移到 R2 等对象存储并保留旧图片 URL 的读取兼容；不要直接扩大 D1 配额。

图片不属于 GitHub 仓库文件，GitHub Markdown 中保存的是公开图片链接。固件、大型附件、HEIC、GIF、SVG 不走此接口；使用已有 HTTPS 下载 / 图片链接。

```sh
node node_modules/wrangler/bin/wrangler.js d1 migrations apply cam-ins-community --remote --config backend/wrangler.jsonc
node node_modules/wrangler/bin/wrangler.js deploy --config backend/wrangler.jsonc
```

遵循 OAUTH_BACKEND.md 的本机 E 盘配置与日志路径。维护者移除图片时先确认准确 URL / 上传者并评估引用影响；删除后浏览器缓存、第三方副本不保证立即消失。

## 验证方法

pnpm test 覆盖上传身份与来源、失效授权、MIME 欺骗、SVG 拒绝、无 Content-Length 大流、配额、重复字节、公开读取以及 CodeMirror 格式 / 撤销 / 图片链接、模拟粘贴与拖入、失败解锁。

pnpm build 后运行 node scripts/preview-editor-upload.mjs，打开 http://127.0.0.1:4322/publish/。该回归服务仅绑定本机，使用显式标记的测试账号和内存 SQLite，无真实 GitHub / Cloudflare 请求。可选择其生成的 qa/editor-upload-fixture.png 验证浏览器真实编码、上传、存储及显示。脚本只用于开发，不属于 Pages 或 Worker 部署入口，不提供生产认证旁路。

生产授权上传需用户在自己的浏览器登录后验证；本地测试账号不能证明真实 OAuth 会话上传成功。
