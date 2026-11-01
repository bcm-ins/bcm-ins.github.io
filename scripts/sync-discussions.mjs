import { writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeDiscussion, repo } from '../src/lib/community.mjs';

export async function collectDiscussions(request) {
  const [owner, name] = repo.split('/');
  const items = [];
  let after = null;
  let totalCount = 0;
  for (let page = 0; page < 20; page++) {
    const result = await request(`query($owner:String!,$name:String!,$after:String) {
      repository(owner:$owner,name:$name) { discussions(first:100,after:$after,orderBy:{field:CREATED_AT,direction:DESC}) {
        totalCount pageInfo { hasNextPage endCursor }
        nodes { number title body bodyText url createdAt updatedAt locked closed isAnswered upvoteCount
          author { login } category { slug } comments { totalCount } labels(first:20) { nodes { name } }
        }
      } }
    }`, { owner, name, after });
    const connection = result.repository?.discussions;
    if (!connection) throw new Error('Repository or discussions unavailable; refusing an empty replacement.');
    totalCount = connection.totalCount;
    items.push(...connection.nodes.map(normalizeDiscussion));
    if (!connection.pageInfo.hasNextPage) {
      const unique = [...new Map(items.map((d) => [d.number, d])).values()];
      if (unique.length !== totalCount) throw new Error('Discussion count changed during sync; retry the build.');
      return { generatedAt: new Date().toISOString(), repository: repo, totalCount, discussions: unique.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) };
    }
    if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === after) throw new Error('Pagination did not advance');
    after = connection.pageInfo.endCursor;
  }
  throw new Error('More than 2,000 discussions. Increase the audited export limit before continuing.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN is required for build-time synchronization.');
  const request = async (query, variables) => {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'cam-ins-community-build' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`GitHub sync returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors) throw new Error(payload.errors.map((e) => e.message).join('; '));
    return payload.data;
  };
  const snapshot = await collectDiscussions(request);
  await mkdir('src/data', { recursive: true });
  await writeFile('src/data/community.json.tmp', JSON.stringify(snapshot, null, 2) + '\n');
  await rename('src/data/community.json.tmp', 'src/data/community.json');
  console.log(`Synchronized ${snapshot.totalCount} public discussions; credentials are not exported.`);
}
