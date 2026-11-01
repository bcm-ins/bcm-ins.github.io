import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseBoards, validateArticle } from '../lib/boards.mjs';
import { apiRequest, backendUrl, login, readSession, sessionKey } from '../lib/auth-client.mjs';

const $=selector=>document.querySelector(selector);
const title=$('#article-title'),body=$('#article-body'),boardInput=$('#board-input');
const message=$('[data-message]'),publish=$('[data-publish]');
const edit=new URLSearchParams(location.search).get('edit');
const editNumber=/^[1-9]\d{0,9}$/.test(edit||'')?Number(edit):null;
const key=`cam-ins:draft:v1:${editNumber||'new'}`;
let boards=[],busy=false,requestId='',fingerprint='',draftAvailable=true;
const draft =()=>({title:title.value,body:body.value,type:$('input[name=type]:checked')?.value||'article',boards,updatedAt:Date.now(),requestId,fingerprint});
function note(text,isError=false) { message.textContent=text;message.classList.toggle('error',isError); }
function save() {
  try {localStorage.setItem(key,JSON.stringify(draft()));$('[data-save-status]').textContent='草稿已保存到此设备';}
  catch {draftAvailable=false;$('[data-save-status]').textContent='浏览器无法保存草稿，请导出 Markdown 备份';}
  $('[data-word-count]').textContent=`${body.value.length.toLocaleString()} 字符`;
  $('[data-release-help]').hidden=$('input[name=type]:checked')?.value!=='release';
}
function preview() {
  $('[data-preview]').innerHTML=DOMPurify.sanitize(marked.parse(body.value||'*预览会显示在这里。*',{gfm:true}),{USE_PROFILES:{html:true},FORBID_TAGS:['form','input','button','textarea','style','iframe','video','audio'],FORBID_ATTR:['style','srcset']});
  $('[data-preview]').querySelectorAll('a').forEach(a=>{a.rel='nofollow ugc noopener noreferrer';a.target='_blank';});
}
function renderBoards() {
  const container=$('[data-selected-boards]');container.replaceChildren();
  for(const board of boards){const chip=document.createElement('span');chip.className='composer-board-chip';const text=document.createElement('span');text.textContent='#'+board;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`移除板块 ${board}`);remove.addEventListener('click',()=>{boards=boards.filter(b=>b!==board);renderBoards();save();});chip.append(text,remove);container.append(chip);}
}
function addBoard(){
  const raw=boardInput.value.trim();if(!raw)return true;
  const values=raw.split(/\s+/).filter(Boolean).map(s=>s.replace(/^#/,''));
  const parsed=parseBoards(values.map(s=>'#'+s).join(' '));
  if(parsed.boardWarnings.length || parsed.explicitBoards.length!==new Set(values.map(v=>v.normalize('NFKC'))).size){note('板块名称不正确。使用 / 分层，名称内不含空格，最多 5 层。',true);return false;}
  const all=[...new Set([...boards,...parsed.explicitBoards])];if(all.length>12){note('每篇文章最多添加 12 个板块。',true);return false;}
  boards=all;boardInput.value='';renderBoards();save();note('');return true;
}
function restore(value){
  title.value=typeof value.title==='string'?value.title.slice(0,180):'';
  body.value=typeof value.body==='string'?value.body.slice(0,60000):'';
  boards=Array.isArray(value.boards)?value.boards.filter(b=>typeof b==='string').slice(0,12):[];
  const radio=[...document.querySelectorAll('input[name=type]')].find(x=>x.value===value.type);if(radio)radio.checked=true;
  requestId=typeof value.requestId==='string'?value.requestId:'';fingerprint=typeof value.fingerprint==='string'?value.fingerprint:'';
  renderBoards();preview();save();
}
let hadDraft=false;
try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored){restore(stored);hadDraft=!!(stored.title||stored.body);}}catch{draftAvailable=false;}
const initialBoard=new URLSearchParams(location.search).get('board');
if(initialBoard && !hadDraft){boardInput.value=initialBoard;addBoard();}
function updateAccount(){
  const session=readSession();
  $('[data-account-status]').textContent=session?`以 @${session.user.login} 的身份发布`:'可以先写作，发布时使用 GitHub 账号登录。';
  $('[data-login]').hidden=!!session;$('[data-logout]').hidden=!session;
  publish.textContent=editNumber?'保存修改 ↗':'发布文章 ↗';
  const account=$('[data-account-link]');if(account)account.textContent=session?'@'+session.user.login:'GitHub 登录';
}
async function beginLogin(){save();try{await login(location.pathname+location.search);}catch(e){note(e.message,true);}}
$('[data-login]').addEventListener('click',beginLogin);
$('[data-logout]').addEventListener('click',async()=>{try{await apiRequest('/session',{method:'DELETE'});sessionStorage.removeItem(sessionKey);updateAccount();note('已退出此标签页的登录，草稿仍保留。');}catch(e){if(e.status===401){sessionStorage.removeItem(sessionKey);updateAccount();}note(e.message,true);}});
updateAccount();
if(!backendUrl())note('站内登录与发布服务正在配置中；你可以先写作、预览和导出草稿。');
if(editNumber){$('[data-editor-title]').textContent='继续完善这份记录。';if(!readSession())note('登录后可加载你的原文；当前草稿不会被覆盖。');else if(!hadDraft)apiRequest(`/posts/${editNumber}`).then(restore).catch(e=>note(e.message,true));}
boardInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addBoard();}});
$('[data-add-board]').addEventListener('click',addBoard);
let timer;[title,body].forEach(el=>el.addEventListener('input',()=>{save();clearTimeout(timer);timer=setTimeout(preview,180);}));
document.querySelectorAll('input[name=type]').forEach(el=>el.addEventListener('change',save));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{const view=button.dataset.view;$('.editor-panels').dataset.viewMode=view;body.hidden=view==='preview';$('[data-preview]').hidden=view==='write';body.required=view!=='preview';document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));preview();}));
const formats={bold:['**','**','粗体文字'],italic:['*','*','斜体文字'],heading:['\n## ','\n','小节标题'],link:['[','](https://)','链接文字'],image:['![','](https://)','图片说明'],code:['\n```text\n','\n```\n','代码或日志'],list:['\n- ','\n','列表内容']};
document.querySelectorAll('[data-format]').forEach(button=>button.addEventListener('click',()=>{const [before,after,placeholder]=formats[button.dataset.format];const selected=body.value.slice(body.selectionStart,body.selectionEnd)||placeholder;const start=body.selectionStart;body.setRangeText(before+selected+after,body.selectionStart,body.selectionEnd,'end');body.focus();body.setSelectionRange(start+before.length,start+before.length+selected.length);save();preview();}));
$('[data-release-template]').addEventListener('click',()=>{body.value+=(body.value?'\n\n':'')+'## 作品与版本\n\n## 适配范围与验证状态\n\n## 下载、源码与许可\n\n[下载 Release](https://github.com/你的账号/项目/releases)\n\n文件名：\nSHA-256：\n许可：\n\n## 安装、回退与已知问题\n';save();preview();});
$('[data-export]').addEventListener('click',()=>{const markdown=`# ${title.value.trim()||'未命名文章'}\n\n${boards.map(b=>'#'+b).join(' ')}\n\n${body.value}`;const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=(title.value.trim()||'cam-ins-draft').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);note('已导出 Markdown 文件。');});
$('[data-import]').addEventListener('click',()=>{if((title.value||body.value)&&!confirm('导入会替换当前编辑内容。建议先导出草稿。继续导入？'))return;$('[data-import-file]').click();});
$('[data-import-file]').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>300000){note('文件过大，请导入 300 KB 以内的 Markdown。',true);return;}const text=await file.text();const titleMatch=text.match(/^#\s+(.+)\r?\n/);const rest=titleMatch?text.slice(titleMatch[0].length).trimStart():text;const parsed=parseBoards(rest);restore({title:titleMatch?.[1]||file.name.replace(/\.md$/i,''),body:parsed.content,boards:parsed.explicitBoards,type:'article'});note('已导入，请检查类型和板块后发布。');e.target.value='';});
$('[data-composer]').addEventListener('submit',async e=>{
  e.preventDefault();if(busy || !addBoard())return;
  let article;try{article=validateArticle(draft());}catch(err){note(err.message,true);return;}
  if(!readSession()){await beginLogin();return;}
  const currentFingerprint=JSON.stringify(article);if(fingerprint!==currentFingerprint){requestId=crypto.randomUUID();fingerprint=currentFingerprint;save();}
  busy=true;publish.disabled=true;publish.textContent='正在保存…';note('正在将文章保存到 GitHub，请勿重复提交。');
  try{
    const result=await apiRequest(editNumber?`/posts/${editNumber}`:'/posts',{method:editNumber?'PUT':'POST',body:JSON.stringify({...article,requestId})});
    try{localStorage.removeItem(key);}catch{}
    $('[data-success]').hidden=false;
    const source=new URL(result.url);if(source.origin==='https://github.com')$('[data-success-github]').href=source.href;
    $('[data-success] h2').textContent=editNumber?'修改已保存。':'文章已发布。';note(`已保存为文章 #${result.number}。网站页面将在自动同步后更新。`);
    publish.textContent='已保存';busy=false;
    $('[data-composer]').querySelectorAll('input,textarea,button').forEach(el=>{el.disabled=true;});
    $('[data-success]').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(err){note(err.name==='TimeoutError'?'请求超时，草稿已保留。请先在 GitHub 检查是否已发布，再重试；同一份内容会复用发布标识。':err.message,true);busy=false;publish.disabled=false;updateAccount();}
});
window.addEventListener('beforeunload',e=>{if(busy || (!draftAvailable&&(title.value||body.value))){e.preventDefault();e.returnValue='';}});
save();preview();
