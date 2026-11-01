import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve('dist');
async function walk(dir) { const result = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) result.push(...await walk(p)); else result.push(p); } return result; }
const files = await walk(root);
let bytes = 0;
let links = 0;
for (const file of files) {
  bytes += (await stat(file)).size;
  if (!file.endsWith('.html')) continue;
  const html = await readFile(file, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i.test(html)) throw new Error(`Inline script would be blocked by CSP: ${file}`);
  if (/gh[opusr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(html)) throw new Error(`Possible token in ${file}`);
  for (const element of html.matchAll(/<(?:a|script|link|img)\b[^>]*>/g)) {
    // User-authored destinations are content, not deploy-time site invariants.
    if (/rel="[^"]*\bugc\b/.test(element[0]) || /^<img\b/.test(element[0])) continue;
    const match = element[0].match(/(?:href|src)="(\/(?!\/)[^"?#]*)(?:[^" ]*)"/);
    if (!match) continue;
    const url = decodeURIComponent(match[1]);
    const target = resolve(root, '.' + url, url.endsWith('/') ? 'index.html' : '');
    if (!target.startsWith(root)) throw new Error('Path escaped build root');
    try { await stat(target); } catch { throw new Error(`Broken internal link ${url} in ${file}`); }
    links++;
  }
}
const snapshot = JSON.parse(await readFile('src/data/community.json', 'utf8'));
for (const d of snapshot.discussions) {
  const html = await readFile(join(root, 'posts', String(d.number), 'index.html'), 'utf8');
  if (!html.includes(d.url)) throw new Error(`Missing canonical discussion link for #${d.number}`);
}
console.log(`Verified ${files.length} static files, ${links} local links, ${snapshot.totalCount} articles, ${(bytes / 1024).toFixed(1)} KiB.`);
