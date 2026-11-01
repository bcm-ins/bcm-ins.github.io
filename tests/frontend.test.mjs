import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
const compiled=new Map();
async function launch(script,html,url='https://bcm-ins.github.io/posts/8/'){
  if(!compiled.has(script))compiled.set(script,(await build({entryPoints:[script],bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'})).outputFiles[0].text);
  const w=new JSDOM(`<meta name="cam-ins-api" content="https://api.example">${html}`,{url,runScripts:'outside-only'}).window;w.confirm=()=>true;
  Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.HTMLElement.prototype.scrollIntoView=()=>{};
  return {w,start(){w.eval(compiled.get(script));}};
}
async function until(check){for(let i=0;i<60;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI did not reach expected state');}
const threadHTML=`<section data-thread data-number="8"><article data-post-content></article><div data-author-card></div><div data-thread-boards></div><button data-refresh></button><span data-comment-count></span><p data-thread-status></p><form data-reply-form id="reply-composer"><h3 data-reply-title></h3><button type="button" data-cancel-reply hidden></button><textarea id="reply-body"></textarea><div data-reply-preview hidden></div><span data-reply-save></span><button type="button" data-preview-reply></button><button type="submit" data-submit-reply></button><p data-reply-message></p></form><div data-comments></div><button data-more-comments></button></section>`;
const post={number:8,title:'测试文章',content:'## 正文\n\n文章内容',author:'alice',type:'article',createdAt:'2026-11-01T00:00:00Z',comments:1,boards:['相机固件'],explicitBoards:['相机固件'],url:'https://github.com/bcm-ins/bcm-ins.github.io/discussions/8',canUpvote:true};
const c={id:'comment-root',body:'**有效内容**<img src=x onerror=alert(1)><script>alert(1)</script>',author:'bob',createdAt:'2026-11-01T00:00:00Z',replies:[],upvotes:0,canUpvote:true};
function signedIn(w){w.sessionStorage.setItem('cam-ins:session:v1',JSON.stringify({session:'a'.repeat(43),user:{login:'alice'},expiresAt:Date.now()+3600000}));}
test('Anonymous readers see in-page replies, sanitized Markdown, and a login-preserving reply draft',async()=>{
  const {w,start}=await launch('src/scripts/thread.mjs',threadHTML);w.fetch=async()=>new Response(JSON.stringify({post,comments:[c],pageInfo:{hasNextPage:false},generatedAt:'2026-11-01T00:00:00Z'}));
  try{start();await until(()=>w.document.querySelector('#comment-comment-root'));const card=w.document.querySelector('#comment-comment-root');assert.equal(card.querySelectorAll('script,[onerror]').length,0);assert.ok(card.querySelector('strong'));assert.equal(card.querySelector('.user-link').getAttribute('href'),'/u/?user=bob');
    const reply=[...card.querySelectorAll('button')].find(b=>b.textContent==='回复');reply.click();assert.equal(w.document.querySelector('[data-reply-title]').textContent,'回复 @bob');const body=w.document.querySelector('#reply-body');body.value='草稿内容';body.dispatchEvent(new w.Event('input'));assert.match(w.localStorage.getItem('cam-ins:reply:v1:8'),/草稿内容/);
    w.document.querySelector('[data-preview-reply]').click();assert.match(w.document.querySelector('[data-reply-preview]').textContent,/草稿内容/);assert.equal(w.document.querySelector('[data-submit-reply]').textContent,'登录并回复');
  }finally{w.close();}
});
test('Signed-in replies appear immediately, retain attribution and can be edited without navigation',async()=>{
  const {w,start}=await launch('src/scripts/thread.mjs',threadHTML);signedIn(w);let writes=0;
  w.fetch=async(url,options={})=>{
    if(options.method==='POST'||options.method==='PUT'){writes++;const payload=JSON.parse(options.body);assert.equal(payload.replyToId,undefined);return new Response(JSON.stringify({comment:{...c,id:'comment-own',author:'alice',body:payload.body,canEdit:true,canDelete:true}}));}
    return new Response(JSON.stringify({post,comments:[c],pageInfo:{hasNextPage:false}}));
  };
  try{start();await until(()=>w.document.querySelector('#comment-comment-root'));const body=w.document.querySelector('#reply-body');body.value='站内回复';const form=w.document.querySelector('form');form.dispatchEvent(new w.Event('submit',{cancelable:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>w.document.querySelector('#comment-comment-own'));assert.equal(writes,1);assert.match(w.document.querySelector('#comment-comment-own').textContent,/alice.*站内回复/s);
    [...w.document.querySelectorAll('#comment-comment-own button')].find(b=>b.textContent==='编辑').click();body.value='修改后的回复';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>w.document.querySelector('#comment-comment-own').textContent.includes('修改后的回复'));assert.equal(writes,2);assert.equal(w.location.pathname,'/posts/8/');
  }finally{w.close();}
});
test('Locked discussion disables writing and profile page links stay within the community',async()=>{
  const {w,start}=await launch('src/scripts/thread.mjs',threadHTML);signedIn(w);w.fetch=async()=>new Response(JSON.stringify({post:{...post,locked:true},comments:[c],pageInfo:{hasNextPage:false}}));
  try{start();await until(()=>w.document.querySelector('#comment-comment-root'));assert.equal(w.document.querySelector('#reply-body').disabled,true);assert.equal(w.document.querySelector('[data-submit-reply]').disabled,true);assert.ok([...w.document.querySelectorAll('[data-author-card] a')].every(a=>a.getAttribute('href').startsWith('/u/')));}finally{w.close();}
});

const profileHTML=`<section data-profile-header></section><section class="profile-content"><button data-profile-tab="posts"></button><button data-profile-tab="replies"></button><button data-profile-tab="drafts" hidden></button><p data-profile-status></p><div data-profile-list></div><button data-profile-more hidden></button></section><div data-profile-account></div>`;
test('Own profile combines live articles, synced replies and private local drafts with local navigation',async()=>{
  const {w,start}=await launch('src/scripts/profile.mjs',profileHTML,'https://bcm-ins.github.io/u/');signedIn(w);
  w.localStorage.setItem('cam-ins:reply:v1:8',JSON.stringify({body:'未公开的草稿'}));
  w.fetch=async url=>new Response(JSON.stringify(String(url).startsWith('/api/')?{generatedAt:'2026-11-01',posts:[],users:[],replies:[{id:'reply-one',author:'alice',number:8,title:'相机记录',body:'已同步回复',createdAt:'2026-11-01'}]}:{profile:{login:'alice',name:'Alice',bio:'硬件笔记'},posts:[post],pageInfo:{hasNextPage:false}}));
  try{start();await until(()=>w.document.querySelector('[data-profile-list] a'));assert.match(w.document.querySelector('[data-profile-header]').textContent,/Alice/);assert.equal(w.document.querySelector('[data-profile-tab="drafts"]').hidden,false);
    w.document.querySelector('[data-profile-tab="replies"]').click();assert.match(w.document.querySelector('[data-profile-list]').textContent,/已同步回复/);assert.equal(w.document.querySelector('[data-profile-list] a').getAttribute('href'),'/post/?number=8#comment-reply-one');
    w.document.querySelector('[data-profile-tab="drafts"]').click();assert.match(w.document.querySelector('[data-profile-list]').textContent,/未公开的草稿/);assert.equal(w.document.querySelector('[data-profile-list] a').getAttribute('href'),'/post/?number=8#reply-composer');
  }finally{w.close();}
});
test('Profile API failure is labelled as a snapshot, never as successfully loaded live data',async()=>{
  const {w,start}=await launch('src/scripts/profile.mjs',profileHTML,'https://bcm-ins.github.io/u/?user=bob');signedIn(w);
  w.fetch=async url=>String(url).startsWith('/api/')?new Response(JSON.stringify({generatedAt:'2026-11-01',posts:[],users:[],replies:[]})):new Response(JSON.stringify({error:'服务暂不可用'}),{status:502});
  try{start();await until(()=>w.document.querySelector('[data-profile-status]').textContent.includes('快照'));assert.equal(w.document.querySelector('[data-profile-tab="drafts"]').hidden,true);assert.doesNotMatch(w.document.querySelector('[data-profile-status]').textContent,/已加载实时/);}finally{w.close();}
});
