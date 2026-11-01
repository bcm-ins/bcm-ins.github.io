import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { random, hash, seal, unseal } from '../backend/worker.mjs';
import { validateArticle } from '../src/lib/boards.mjs';

function db() {
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../backend/migrations/0001_sessions.sql',import.meta.url),'utf8'));
  return {prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);}};},async batch(queries){return Promise.all(queries.map(q=>q.run()));},sql};
}
const envFor=()=>({DB:db(),SITE_ORIGIN:'https://bcm-ins.github.io',REPOSITORY:'bcm-ins/bcm-ins.github.io',REPOSITORY_ID:'repo-test',CATEGORY_ARTICLE:'article-test',CATEGORY_QUESTION:'question-test',CATEGORY_RELEASE:'release-test',GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-secret',TOKEN_ENCRYPTION_KEY:random()});
function request(path,{method='GET',body,token,origin='https://bcm-ins.github.io'}={}){return new Request('https://community.example'+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});}
async function authenticated(env){const token=random();await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').bind(await hash(token),await seal('github-user-secret',env.TOKEN_ENCRYPTION_KEY),'alice',123,Math.floor(Date.now()/1000)+3600).run();return token;}
const article={title:'传感器记录',body:'## 观察\n\n记录与链接。',type:'article',boards:['相机固件/索尼/a7c2','软件与工具'],requestId:'request_12345678901234567890'};

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
