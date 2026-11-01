// The first Markdown content block is the only source of board membership.
export function parseBoards(body) {
  const text = String(body || '').replace(/\r\n/g, '\n').trimStart();
  const lines = text.split('\n');
  let start = /^#{1,6}\s+板块(?:（.*?）|\(.*?\))?\s*$/.test(lines[0]) ? 1 : 0;
  while (start < lines.length && !lines[start].trim()) start++;
  const explicit = [];
  const warnings = [];
  for (const token of (lines[start] || '').trim().split(/\s+/)) {
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

export function validateArticle(input) {
  if (!input || typeof input !== 'object') throw new Error('文章格式不正确。');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!title || title.length > 180) throw new Error('请填写 1–180 字的标题。');
  if (!body || body.length > 60000) throw new Error('正文不能为空，且不能超过 60,000 字符。');
  if (!['article', 'question', 'release'].includes(input.type)) throw new Error('请选择有效的文章类型。');
  if (!Array.isArray(input.boards) || !input.boards.length || input.boards.length > 12 || input.boards.some(b => typeof b !== 'string' || /\s|#/.test(b))) throw new Error('请填写 1–12 个有效板块，名称内不含空格或 #。');
  const parsed = parseBoards(input.boards.map(b => `#${b}`).join(' '));
  if (parsed.boardWarnings.length || parsed.explicitBoards.length !== new Set(input.boards.map(b => b.normalize('NFKC'))).size) throw new Error('板块名称不正确；使用 / 分层，最多 5 层。');
  return { title, body, type: input.type, boards: parsed.explicitBoards, markdown: parsed.explicitBoards.map(b => `#${b}`).join(' ') + '\n\n' + body };
}
