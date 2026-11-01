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

// Only the first content block defines boards. Tags in code samples or later text never create boards.
export function parseBoards(body) {
  const text = String(body || '').replace(/\r\n/g, '\n').trimStart();
  const lines = text.split('\n');
  let start = /^#{1,6}\s+板块(?:（.*?）|\(.*?\))?\s*$/.test(lines[0]) ? 1 : 0;
  while (start < lines.length && !lines[start].trim()) start++;
  const tagLine = lines[start] || '';
  const tokens = tagLine.trim().split(/\s+/);
  const explicit = [];
  const warnings = [];
  for (const token of tokens) {
    if (!token.startsWith('#')) continue;
    const name = token.slice(1).normalize('NFKC');
    if (!name || name.length > 80 || !/^[\p{L}\p{N}_+./-]+$/u.test(name) || name.split('/').some((s) => !s || s === '.' || s === '..') || name.split('/').length > 5) {
      warnings.push('存在无法识别的板块标签，请查看板块命名说明。'); continue;
    }
    if (!explicit.includes(name)) explicit.push(name);
  }
  if (explicit.length > 12) { warnings.push('每篇文章最多列出 12 个板块。'); explicit.splice(12); }
  const expanded = new Set();
  for (const name of explicit) { const parts = name.split('/'); for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/')); }
  const content = explicit.length ? lines.slice(start + 1).join('\n').trimStart() : text;
  return { boards: [...expanded], explicitBoards: explicit, content, boardWarnings: [...new Set(warnings)] };
}

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
