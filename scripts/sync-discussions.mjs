import { writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeDiscussion, repo } from '../src/lib/community.mjs';
import { commentFields, publicComment } from '../src/lib/discussions.mjs';

export async function collectComments(request, number) {
  const [owner,name]=repo.split('/');const comments=[];let after=null;
  for(let page=0;page<40;page++){
    const data=await request(`query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){discussion(number:$number){comments(first:50,after:$after){pageInfo{hasNextPage endCursor} nodes{${commentFields} replies(first:50){totalCount pageInfo{hasNextPage endCursor} nodes{${commentFields}}}}}}}}`,{owner,name,number,after});
    const connection=data.repository?.discussion?.comments;if(!connection)throw Error('Discussion disappeared during comment sync; retry.');
    for(const c of connection.nodes){
      const replies=c.replies.nodes.map(r=>publicComment(r));let info=c.replies.pageInfo;
      for(let i=0;info.hasNextPage;i++){
        if(i>=39)throw Error('More than 2,000 replies in one thread.');
        const next=await request(`query($id:ID!,$after:String){node(id:$id){... on DiscussionComment{replies(first:50,after:$after){pageInfo{hasNextPage endCursor} nodes{${commentFields}}}}}}`,{id:c.id,after:info.endCursor});
        const page=next.node?.replies;if(!page || page.pageInfo.endCursor===info.endCursor)throw Error('Reply pagination did not advance.');
        replies.push(...page.nodes.map(r=>publicComment(r)));info=page.pageInfo;
      }
      comments.push({...publicComment(c),replies,replyCount:replies.length,replyPageInfo:{hasNextPage:false,endCursor:null}});
    }
    if(!connection.pageInfo.hasNextPage)return comments;
    if(!connection.pageInfo.endCursor||connection.pageInfo.endCursor===after)throw Error('Comment pagination did not advance.');
    after=connection.pageInfo.endCursor;
  }
  throw Error('More than 2,000 top-level comments; increase export limit after review.');
}

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
          author { login avatarUrl } category { slug } comments { totalCount } labels(first:20) { nodes { name } }
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
  let exportedComments=0;
  for(const post of snapshot.discussions){
    post.thread=post.comments?await collectComments(request,post.number):[];
    exportedComments+=post.thread.reduce((sum,c)=>sum+1+c.replies.length,0);
    if(exportedComments>20000)throw Error('Comment export exceeds 20,000; review pagination strategy.');
  }
  await mkdir('src/data', { recursive: true });
  await writeFile('src/data/community.json.tmp', JSON.stringify(snapshot, null, 2) + '\n');
  await rename('src/data/community.json.tmp', 'src/data/community.json');
  console.log(`Synchronized ${snapshot.totalCount} public discussions; credentials are not exported.`);
}
