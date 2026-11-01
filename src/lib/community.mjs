import { parseBoards } from './boards.mjs';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { createHash } from 'node:crypto';

export const repo = 'bcm-ins/bcm-ins.github.io';
export const github = `https://github.com/${repo}`;
export const types = [
  { key: 'article', name: '知识文章', symbol: '≡', category: 'general', description: '测量、拆解、实验与技术笔记。' },
  { key: 'question', name: '问题', symbol: '?', category: 'q-a', description: '描述现象，附上复现方法，一起找答案。' },
  { key: 'release', name: '固件 / 软件发布', symbol: '↓', category: 'show-and-tell', description: '介绍你的作品，附版本、下载和使用说明。' },
];
export const typeFor = (key) => types.find((t) => t.key === key) || types[0];
export const starterBoards = ['相机固件', '相机固件/索尼', '相机固件/索尼/a7c2', '相机硬件', '软件与工具', '社区建设'];
export const boardId = (name) => createHash('sha256').update(name).digest('hex').slice(0, 16);
export const boardHref = (name) => `/boards/${boardId(name)}/`;
export const boardName = (name) => name.split('/').at(-1);

export { parseBoards } from './boards.mjs';

export function collectBoards(discussions) {
  const names = new Set([...starterBoards, ...discussions.flatMap((d) => d.boards)]);
  const roots = ['相机固件', '相机硬件', '软件与工具', '社区建设'];
  const rank = (name) => { const index = roots.indexOf(name.split('/')[0]); return index < 0 ? roots.length : index; };
  return [...names].map((name) => ({ name, id: boardId(name), depth: name.split('/').length - 1, count: discussions.filter((d) => d.boards.includes(name)).length })).sort((a,b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'zh-CN'));
}
export const newTopic = (slug = '') => `${github}/discussions/new${slug ? `?category=${encodeURIComponent(slug)}` : ''}`;
export const formatDate = (value) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', month: 'short', day: 'numeric' }).format(new Date(value));

export function safeGithubUrl(value, fallback = `${github}/discussions`) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : fallback; } catch { return fallback; }
}

export function renderMarkdown(value) {
  return sanitizeHtml(marked.parse(value || '', { gfm: true }), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary', 'del', 'input'],
    allowedAttributes: {
      a: ['href', 'title', 'rel'], img: ['src', 'alt', 'title', 'loading'],
      input: ['type', 'checked', 'disabled'], code: ['class'], th: ['align'], td: ['align'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow ugc noopener noreferrer' }),
      img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }),
      input: (_tag, attrs) => ({ tagName: 'input', attribs: { type: 'checkbox', disabled: 'disabled', ...(Object.hasOwn(attrs, 'checked') ? { checked: 'checked' } : {}) } }),
    },
  });
}

export function normalizeDiscussion(d) {
  if (!Number.isSafeInteger(d.number) || d.number < 1) throw new Error('Invalid discussion number');
  const parsed = parseBoards(d.body);
  const category = d.category?.slug || 'general';
  return {
    number: d.number, title: String(d.title), body: String(d.body || ''),
    excerpt: String(d.bodyText || '').replace(/\s+/g, ' ').replace(/^(?:板块(?:（.*?）)?\s*)?(?:#[^\s]+\s*)+/, '').replace(/^正文\s*/, '').slice(0, 180),
    url: safeGithubUrl(d.url), createdAt: d.createdAt, updatedAt: d.updatedAt,
    author: d.author?.login || '已注销用户',
    ...parsed, type: category === 'q-a' ? 'question' : category === 'show-and-tell' ? 'release' : 'article',
    category, comments: d.comments?.totalCount || 0,
    upvotes: d.upvoteCount || 0, answered: !!d.isAnswered, locked: !!d.locked, closed: !!d.closed,
    labels: (d.labels?.nodes || []).map((l) => l.name),
  };
}
