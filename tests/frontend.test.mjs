import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
const compiled=new Map();
async function launch(script,html,url='https://bcm-ins.github.io/posts/8/'){
  if(!compiled.has(script))compiled.set(script,(await build({entryPoints:[script],bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'})).outputFiles[0].text);
  const w=new JSDOM(`<meta name="cam-ins-api" content="https://api.example">${html}`,{url,runScripts:'outside-only',pretendToBeVisual:true}).window;w.confirm=()=>true;
  Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.Range.prototype.getClientRects=()=>[];w.Range.prototype.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0});
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

const editorHTML=`<div data-md-editor><div class="md-source"><textarea maxlength="60000" id="article-body"></textarea><div data-md-code></div></div><div data-md-preview></div><span data-md-count></span><p data-md-status></p><button data-md-view="write"></button><button data-md-view="split"></button><button data-md-view="preview"></button><button data-md-format="bold"></button><button data-md-undo></button><button data-md-redo></button><button data-md-images></button><div data-md-image-panel hidden><button data-md-close-images></button><button data-md-pick></button><input type="file" data-md-files/><div class="md-upload-box"></div><input data-md-image-url/><input data-md-image-alt/><button data-md-insert-image></button><div data-md-upload-results></div></div><button data-md-link></button><div data-md-link-panel><input data-md-link-text/><input data-md-link-url/><button data-md-close-link></button><button data-md-insert-link></button><p data-md-link-status></p></div></div>`;
test('CodeMirror format, undo, safe image URL and preview share the underlying Markdown draft',async()=>{
  const {w,start}=await launch('tests/fixtures/editor-entry.mjs',editorHTML);try{start();w.document.querySelector('[data-md-format="bold"]').click();assert.equal(w.document.querySelector('textarea').value,'**粗体文字**');w.document.querySelector('[data-md-undo]').click();assert.equal(w.document.querySelector('textarea').value,'');w.document.querySelector('[data-md-redo]').click();assert.equal(w.document.querySelector('textarea').value,'**粗体文字**');
    w.document.querySelector('[data-md-image-url]').value='javascript:alert(1)';w.document.querySelector('[data-md-insert-image]').click();assert.match(w.document.querySelector('[data-md-status]').textContent,/只支持/);assert.equal(w.document.querySelector('[data-md-preview] img'),null);
    w.document.querySelector('[data-md-image-url]').value='https://example.org/image.png';w.document.querySelector('[data-md-image-alt]').value='接口';w.document.querySelector('[data-md-insert-image]').click();w.document.querySelector('[data-md-view="preview"]').click();assert.equal(w.document.querySelector('[data-md-preview] img').getAttribute('src'),'https://example.org/image.png');assert.equal(w.document.querySelector('[data-md-code]').parentElement.hidden,true);
  }finally{w.editorFixture?.destroy();w.close();}
});
test('Pasted and dropped images upload once, insert Markdown, and unlock the editor after failures',async()=>{
  const {w,start}=await launch('tests/fixtures/editor-entry.mjs',editorHTML);signedIn(w);let uploads=0,failNext=false,closed=0;
  w.createImageBitmap=async()=>({width:320,height:180,close(){closed++;}});w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob(['processed-image'],{type:'image/webp'}));};
  w.fetch=async(url,options)=>{uploads++;assert.equal(url,'https://api.example/images');assert.equal(options.headers['Content-Type'],'image/webp');return failNext?new Response(JSON.stringify({error:'存储额度已满'}),{status:507}):new Response(JSON.stringify({url:'https://api.example/images/'+'a'.repeat(64),size:15,mime:'image/webp'}),{status:201});};
  try{start();const target=w.document.querySelector('.cm-content'),file=new w.File(['fixture'],'camera.png',{type:'image/png'}),paste=new w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{files:[file]}});target.dispatchEvent(paste);assert.equal(w.editorFixture.uploading,true);w.editorFixture.setDisabled(false);assert.equal(target.getAttribute('contenteditable'),'false');await until(()=>!w.editorFixture.uploading);assert.equal(uploads,1);assert.match(w.document.querySelector('textarea').value,/!\[camera\]\(https:\/\/api.example\/images\//);assert.equal(closed,1);
    failNext=true;const drop=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[file]}});w.document.querySelector('.md-upload-box').dispatchEvent(drop);await until(()=>!w.editorFixture.uploading);assert.equal(uploads,2);assert.match(w.document.querySelector('[data-md-status]').textContent,/存储额度已满/);assert.equal(w.document.querySelector('[data-md-pick]').disabled,false);assert.equal(w.document.querySelector('.cm-content').getAttribute('contenteditable'),'true');
  }finally{w.editorFixture?.destroy();w.close();}
});
