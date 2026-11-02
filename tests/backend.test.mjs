import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { random, hash, seal, unseal } from '../backend/worker.mjs';
import { validateArticle } from '../src/lib/boards.mjs';

function db() {
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../backend/migrations/0001_sessions.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../backend/migrations/0002_images.sql',import.meta.url),'utf8'));
  return {prepare(query){let args=[];return{bind(...values){args=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this;},async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);}};},async batch(queries){return Promise.all(queries.map(q=>q.run()));},sql};
}
const envFor=()=>({DB:db(),SITE_ORIGIN:'https://bcm-ins.github.io',REPOSITORY:'bcm-ins/bcm-ins.github.io',REPOSITORY_ID:'repo-test',CATEGORY_ARTICLE:'article-test',CATEGORY_QUESTION:'question-test',CATEGORY_RELEASE:'release-test',GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-secret',TOKEN_ENCRYPTION_KEY:random()});
function request(path,{method='GET',body,token,origin='https://bcm-ins.github.io'}={}){return new Request('https://community.example'+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});}
async function authenticated(env){const token=random();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').bind(await hash(token),await seal('github-user-secret',env.TOKEN_ENCRYPTION_KEY),'alice',123,Math.floor(Date.now()/1000)+3600).run();return token;}
const article={title:'传感器记录',body:'## 观察\n\n记录与链接。',type:'article',boards:['相机固件/索尼/a7c2','软件与工具'],requestId:'request_12345678901234567890'};

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
const imageRequest=(token,bytes=png,mime='image/png',origin='https://bcm-ins.github.io')=>new Request('https://community.example/images',{method:'POST',headers:{Origin:origin,'Content-Type':mime,...(token?{Authorization:`Bearer ${token}`}:{})},body:bytes});
test('Image upload requires an active session and origin, deduplicates bytes and serves public images safely',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{viewer:{login:'alice'}}}));
  try{
    assert.equal((await worker.fetch(imageRequest(null),env)).status,401);
    assert.equal((await worker.fetch(imageRequest(token,png,'image/png','https://foreign.example'),env)).status,403);
    const first=await worker.fetch(imageRequest(token),env);assert.equal(first.status,201);const result=await first.json();assert.match(result.url,/\/images\/[a-f0-9]{64}$/);
    assert.deepEqual(await (await worker.fetch(imageRequest(token),env)).json(),result);assert.equal(env.DB.sql.prepare('SELECT COUNT(*) n FROM images').get().n,1);
    const image=await worker.fetch(new Request(result.url),env);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.match(image.headers.get('content-security-policy'),/sandbox/);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),png);
    const head=await worker.fetch(new Request(result.url,{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await worker.fetch(new Request('https://community.example/images/'+'0'.repeat(64)),env)).status,404);
  }finally{globalThis.fetch=originalFetch;}
});
test('Image endpoint rejects active formats, spoofed MIME, oversized bodies, expired grants and storage exhaustion',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;
  try{
    for(const [bytes,mime,expected] of [[new TextEncoder().encode('<svg onload="alert(1)"></svg>'),'image/svg+xml',415],[png,'image/jpeg',415],[new Uint8Array(1048577),'image/png',413]])assert.equal((await worker.fetch(imageRequest(token,bytes,mime),env)).status,expected);
    globalThis.fetch=async()=>new Response('{}',{status:401});assert.equal((await worker.fetch(imageRequest(token),env)).status,401);
    globalThis.fetch=async()=>new Response(JSON.stringify({data:{viewer:{login:'alice'}}}));
    for(let i=0;i<32;i++)env.DB.sql.prepare('INSERT INTO images VALUES(?,?,?,?,?,?)').run(String(i),123,'image/png',1048576,png,1);
    assert.equal((await worker.fetch(imageRequest(token),env)).status,507);
  }finally{globalThis.fetch=originalFetch;}
});

test('Article payload validates hierarchy, lengths and enum without executing Markdown',()=>{
  assert.match(validateArticle(article).markdown,/^#相机固件\/索尼\/a7c2 #软件与工具\n/);
  for(const bad of [{...article,type:'admin'},{...article,boards:['../x']},{...article,title:''},{...article,boards:['a b']},{...article,body:'x'.repeat(60001)}])assert.throws(()=>validateArticle(bad));
});
test('Stored GitHub tokens are authenticated encryption; wrong keys and tampering fail',async()=>{
  const key=random(),secret='github-user-token-private';const encrypted=await seal(secret,key);
  assert.equal(encrypted.includes(secret),false);assert.equal(await unseal(encrypted,key),secret);
  await assert.rejects(unseal(encrypted,random()));
  const [iv,data]=encrypted.split('.');await assert.rejects(unseal(iv+'.'+(data[0]==='a'?'b':'a')+data.slice(1),key));
});
test('CORS, session expiry and logout reject unauthenticated or foreign requests',async()=>{
  const env=envFor(),token=await authenticated(env);
  assert.equal((await worker.fetch(request('/posts',{method:'POST',body:article,token,origin:'https://evil.example'}),env)).status,403);
  assert.equal((await worker.fetch(request('/session'),env)).status,401);
  assert.equal((await worker.fetch(request('/session',{token}),env)).status,200);
  assert.equal((await worker.fetch(request('/session',{token,method:'DELETE'}),env)).status,200);
  assert.equal((await worker.fetch(request('/session',{token}),env)).status,401);
  const preflight=await worker.fetch(new Request('https://community.example/posts',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}),env);assert.equal(preflight.status,403);
});
test('OAuth callback is single-use and ticket is bound to the initiating browser PKCE verifier',async()=>{
  const env=envFor(),verifier=random(),browserState=random();const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('access_token')?{access_token:'private-github-token',expires_in:28800}:{id:123,login:'alice'}),{status:200});
  try{
    const start=await worker.fetch(request(`/auth/start?challenge=${await hash(verifier)}&state=${browserState}`),env);
    const oauth=new URL(start.headers.get('Location'));assert.equal(oauth.origin,'https://github.com');assert.equal(oauth.searchParams.get('code_challenge_method'),'S256');
    const callback=`/auth/callback?state=${oauth.searchParams.get('state')}&code=fake-code`;
    const reply=await worker.fetch(request(callback),env);assert.equal(reply.status,302);
    assert.equal((await worker.fetch(request(callback),env)).status,400);
    const target=new URL(reply.headers.get('Location'));assert.equal(target.origin,env.SITE_ORIGIN);assert.equal(target.href.includes('private-github-token'),false);
    const fragment=new URLSearchParams(target.hash.slice(1));assert.equal(fragment.get('state'),browserState);
    const ticket=fragment.get('ticket');
    assert.equal((await worker.fetch(request('/session/exchange',{method:'POST',body:{ticket,verifier:random()}}),env)).status,401);
    const exchanged=await worker.fetch(request('/session/exchange',{method:'POST',body:{ticket,verifier}}),env);const data=await exchanged.json();assert.equal(data.user.login,'alice');assert.equal(JSON.stringify(data).includes('private-github-token'),false);
    assert.equal((await worker.fetch(request('/session/exchange',{method:'POST',body:{ticket,verifier}}),env)).status,401);
    assert.equal((await worker.fetch(request('/session',{token:data.session}),env)).status,200);
  }finally{globalThis.fetch=originalFetch;}
});
test('Publication is attributed to user and restricted to configured repository; repeated requests are idempotent',async()=>{
  const env=envFor(),token=await authenticated(env);const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer github-user-secret');const payload=JSON.parse(options.body);assert.equal(payload.variables.input.repositoryId,'repo-test');assert.equal(payload.variables.input.categoryId,'article-test');assert.match(payload.variables.input.body,/^#相机固件/);return new Response(JSON.stringify({data:{createDiscussion:{discussion:{number:42,url:'https://github.com/bcm-ins/bcm-ins.github.io/discussions/42'}}}}));};
  try{
    const first=await worker.fetch(request('/posts',{method:'POST',body:article,token}),env);assert.equal(first.status,201);
    const again=await worker.fetch(request('/posts',{method:'POST',body:article,token}),env);assert.equal(again.status,200);assert.equal(calls,1);
    const changed=await worker.fetch(request('/posts',{method:'POST',body:{...article,title:'Different'},token}),env);assert.equal(changed.status,409);assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;}
});
test('Users cannot edit another author and network ambiguity cannot double-post',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{repository:{discussion:{id:'other',author:{login:'bob'},viewerCanUpdate:true}}}}));
  try{
    assert.equal((await worker.fetch(request('/posts/8',{method:'PUT',body:article,token}),env)).status,403);
    let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('timeout');};
    assert.equal((await worker.fetch(request('/posts',{method:'POST',body:article,token}),env)).status,502);
    assert.equal((await worker.fetch(request('/posts',{method:'POST',body:article,token}),env)).status,409);assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;}
});

const discussionFixture={id:'discussion-test',number:8,title:'Camera',body:'#相机固件\n\n正文',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',locked:false,closed:false,upvoteCount:0,viewerCanUpvote:true,author:{login:'alice'},category:{slug:'general'},comments:{totalCount:1},url:'https://github.com/bcm-ins/bcm-ins.github.io/discussions/8'};
const commentFixture={id:'comment-test',body:'回复内容',author:{login:'alice'},viewerCanUpdate:true,viewerCanDelete:true,viewerCanUpvote:true,viewerCanMarkAsAnswer:true,discussion:{number:8,repository:{nameWithOwner:'bcm-ins/bcm-ins.github.io'}},createdAt:'2026-11-01T00:00:00Z'};
test('Reply creation uses user identity, scopes the parent, and suppresses duplicate writes',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;let mutations=0;
  globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.Authorization,'Bearer github-user-secret');const {query,variables}=JSON.parse(options.body);let data;
    if(query.includes('repository(owner:'))data={repository:{discussion:discussionFixture}};
    else if(query.startsWith('mutation')){mutations++;assert.deepEqual(variables.input,{discussionId:'discussion-test',body:'实测回复',replyToId:'comment-test',clientMutationId:'reply_request_123456789'});data={addDiscussionComment:{comment:{...commentFixture,id:'new-comment'}}};}
    else data={node:commentFixture};return new Response(JSON.stringify({data}));};
  const body={body:' 实测回复 ',replyToId:'comment-test',requestId:'reply_request_123456789'};
  try{const result=await worker.fetch(request('/threads/8/comments',{token,method:'POST',body}),env);assert.equal(result.status,200);assert.equal((await result.json()).comment.author,'alice');assert.equal((await worker.fetch(request('/threads/8/comments',{token,method:'POST',body}),env)).status,200);assert.equal(mutations,1);
    globalThis.fetch=async(_url,options)=>{const {query}=JSON.parse(options.body);return new Response(JSON.stringify({data:query.includes('repository(owner:')?{repository:{discussion:discussionFixture}}:{node:{...commentFixture,discussion:{number:8,repository:{nameWithOwner:'other/repo'}}}}}));};
    assert.equal((await worker.fetch(request('/threads/8/comments',{token,method:'POST',body:{...body,requestId:'another_request_123456'}}),env)).status,404);
  }finally{globalThis.fetch=originalFetch;}
});
test('Reply permissions reject other authors, locked threads, and unauthorized answer marking',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;let d={...discussionFixture},c={...commentFixture,author:{login:'bob'},viewerCanMarkAsAnswer:false};
  globalThis.fetch=async(_url,options)=>{const {query}=JSON.parse(options.body);assert.equal(query.startsWith('mutation'),false);return new Response(JSON.stringify({data:query.includes('repository(owner:')?{repository:{discussion:d}}:{node:c}}));};
  const body={body:'change',commentId:'comment-test',requestId:'permission_test_123456'};
  try{for(const method of ['PUT','DELETE'])assert.equal((await worker.fetch(request('/threads/8/comments',{token,method,body}),env)).status,403);
    assert.equal((await worker.fetch(request('/threads/8/answer',{token,method:'POST',body:{...body,enabled:true}}),env)).status,403);
    d.locked=true;assert.equal((await worker.fetch(request('/threads/8/comments',{token,method:'POST',body}),env)).status,403);
  }finally{globalThis.fetch=originalFetch;}
});
test('Live comment pages hide minimized content and separate pagination for replies',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>{const {query,variables}=JSON.parse(options.body);let data;
    if(query.includes('repository(owner:'))data={repository:{discussion:discussionFixture}};
    else{assert.equal(variables.after,'page_two');data={node:{comments:{pageInfo:{hasNextPage:true,endCursor:'page_three'},nodes:[{...commentFixture,isMinimized:true,body:'hidden moderation text',replies:{nodes:[],totalCount:40,pageInfo:{hasNextPage:true,endCursor:'more_replies'}}}]}}};}return new Response(JSON.stringify({data}));};
  try{const result=await worker.fetch(request('/threads/8?after=page_two',{token}),env);assert.equal(result.status,200);const payload=await result.json();assert.equal(payload.comments[0].body,'');assert.equal(payload.comments[0].replyPageInfo.hasNextPage,true);assert.equal(payload.pageInfo.endCursor,'page_three');assert.equal(JSON.stringify(payload).includes('github-user-secret'),false);}finally{globalThis.fetch=originalFetch;}
});
test('Uncertain reply writes retain their request id instead of posting twice',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;let writes=0;
  globalThis.fetch=async(_url,options)=>{const {query}=JSON.parse(options.body);if(query.startsWith('mutation')){writes++;throw Error('network');}return new Response(JSON.stringify({data:{repository:{discussion:discussionFixture}}}));};
  const body={body:'reply',requestId:'uncertain_reply_123456'};
  try{assert.equal((await worker.fetch(request('/threads/8/comments',{token,method:'POST',body}),env)).status,502);assert.equal((await worker.fetch(request('/threads/8/comments',{token,method:'POST',body}),env)).status,409);assert.equal(writes,1);}finally{globalThis.fetch=originalFetch;}
});

test('Own reply editing, deletion retry, votes and answer mutations use scoped GitHub inputs',async()=>{
  const env=envFor(),token=await authenticated(env),originalFetch=globalThis.fetch;let mutations=[],deleted=false;
  globalThis.fetch=async(_url,options)=>{const {query,variables}=JSON.parse(options.body);let data;
    if(query.includes('repository(owner:'))data={repository:{discussion:discussionFixture}};
    else if(!query.startsWith('mutation'))data={node:deleted?null:commentFixture};
    else{mutations.push(variables.input);if(query.includes('updateDiscussionComment'))data={updateDiscussionComment:{comment:{...commentFixture,body:variables.input.body}}};else{if(query.includes('deleteDiscussionComment'))deleted=true;data={};}}
    return new Response(JSON.stringify({data}));
  };
  try{
    const base={commentId:'comment-test'};
    const edited=await worker.fetch(request('/threads/8/comments',{token,method:'PUT',body:{...base,body:'修改内容',requestId:'edit_reply_123456789'}}),env);assert.equal(edited.status,200);assert.equal((await edited.json()).comment.body,'修改内容');assert.equal(mutations[0].commentId,'comment-test');
    for(const operation of ['vote','answer'])assert.equal((await worker.fetch(request(`/threads/8/${operation}`,{token,method:'POST',body:{...base,enabled:true,requestId:operation+'_reply_123456789'}}),env)).status,200);
    assert.equal(mutations[1].subjectId,'comment-test');assert.equal(mutations[2].id,'comment-test');
    const body={...base,requestId:'delete_reply_123456789'};
    for(let i=0;i<2;i++)assert.equal((await worker.fetch(request('/threads/8/comments',{token,method:'DELETE',body}),env)).status,200);
    assert.equal(mutations.length,4);assert.equal(mutations[3].id,'comment-test');
  }finally{globalThis.fetch=originalFetch;}
});
