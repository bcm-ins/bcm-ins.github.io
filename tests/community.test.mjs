import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, normalizeDiscussion, safeGithubUrl, parseBoards, collectBoards } from '../src/lib/community.mjs';
import { collectDiscussions } from '../scripts/sync-discussions.mjs';

test('Untrusted article content cannot inject executable HTML or unsafe links', () => {
  const html = renderMarkdown('<script>alert(1)</script><img src="https://example.com/a.png" onerror="alert(2)"><a href="javascript:alert(3)">x</a><iframe src="https://example.com"></iframe><form><input type="password" name="token"></form><svg onload="alert(4)"></svg>');
  assert.doesNotMatch(html, /<script|onerror|javascript:|<iframe|<form|password|<svg|onload/i);
  assert.match(html, /disabled/);
  assert.match(html, /loading="lazy"/);
});
test('Markdown retains useful hardware documentation formatting', () => {
  const html = renderMarkdown('## 测量\n\n| ISO | RN |\n| --- | --- |\n| 100 | 2.1 |\n\n```c\nregister_write(0x01);\n```\n\n[Release](https://github.com/a/b/releases/tag/v1)');
  assert.match(html, /<table>/); assert.match(html, /<h2>测量/); assert.match(html, /register_write/); assert.match(html, /nofollow ugc/);
});
test('All pages are collected and deleted items are not retained from old snapshots', async () => {
  let calls = 0;
  const d = (number) => ({ number, title: 't', body: '', bodyText: '', url: `https://github.com/bcm-ins/bcm-ins.github.io/discussions/${number}`, updatedAt: '2026-11-02T00:00:00Z', createdAt: '2026-11-02T00:00:00Z' });
  const result = await collectDiscussions(async (_query, vars) => {
    calls++;
    assert.equal(vars.after, calls === 1 ? null : 'next');
    return { repository: { discussions: { totalCount: 2, nodes: [d(calls)], pageInfo: { hasNextPage: calls === 1, endCursor: 'next' } } } };
  });
  assert.equal(calls, 2); assert.deepEqual(result.discussions.map((x) => x.number), [1,2]);
});
test('Unavailable source and inconsistent pagination fail without publishing an empty forum', async () => {
  await assert.rejects(collectDiscussions(async () => ({ repository: null })), /unavailable/);
  await assert.rejects(collectDiscussions(async () => ({ repository: { discussions: { totalCount: 2, nodes: [], pageInfo: { hasNextPage: false } } } })), /count changed/);
});
test('Author deletion and forged discussion links have safe fallbacks', () => {
  assert.equal(safeGithubUrl('javascript:alert(1)'), 'https://github.com/bcm-ins/bcm-ins.github.io/discussions');
  assert.equal(normalizeDiscussion({ number: 1, title: 'title', author: null }).author, '已注销用户');
  assert.throws(() => normalizeDiscussion({ number: '../admin' }), /number/);
});
test('Multiple hierarchical boards include ancestors and can be changed by editing the first block', () => {
  const a = parseBoards('### 板块\n\n#相机固件/索尼/a7c2 #软件与工具\n\n### 正文\n测量');
  assert.deepEqual(a.boards, ['相机固件', '相机固件/索尼', '相机固件/索尼/a7c2', '软件与工具']);
  assert.equal(a.content, '### 正文\n测量');
  assert.deepEqual(parseBoards('#相机硬件\n\nchanged').boards, ['相机硬件']);
  assert.equal(collectBoards([{ boards: a.boards }]).find((b) => b.name === '相机固件/索尼').count, 1);
});
test('Board parser ignores code and later hashtags and rejects unsafe names', () => {
  assert.deepEqual(parseBoards('正文\n\n#不应进入板块').boards, []);
  assert.deepEqual(parseBoards('```c\n#include <stdio.h>\n```').boards, []);
  assert.deepEqual(parseBoards('#../oops #相机固件//索尼 #<script>\n正文').boards, []);
  assert.equal(parseBoards('#相机固件/索尼\n\n代码\n#无关').boards.includes('无关'), false);
});
