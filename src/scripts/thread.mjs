import {apiRequest,readSession,login} from '../lib/auth-client.mjs';
import {el,markdown,userLink,button,date,profileHref} from '../lib/dom.mjs';
const root=document.querySelector('[data-thread]');
const number=Number(root.dataset.number||new URLSearchParams(location.search).get('number'));
const $=s=>root.querySelector(s),status=$('[data-thread-status]'),body=$('#reply-body'),message=$('[data-reply-message]');
const comments=$('[data-comments]'),form=$('[data-reply-form]'),submit=$('[data-submit-reply]');
let post,pageInfo,live=false,busy=false,loading=false,replyToId=null,editingId=null,targetAuthor='',requestId='',fingerprint='';
const draftKey=`cam-ins:reply:v1:${number}`;
function note(text,error=false){message.textContent=text;message.classList.toggle('error',error);}
function save(){try{localStorage.setItem(draftKey,JSON.stringify({body:body.value,replyToId,editingId,targetAuthor,requestId,fingerprint}));$('[data-reply-save]').textContent='草稿已保存到此设备';}catch{$('[data-reply-save]').textContent='草稿无法保存，请复制备份';}}
function mode(){
  $('[data-reply-title]').textContent=editingId?'编辑回复':replyToId?`回复 @${targetAuthor}`:'发表回复';
  $('[data-cancel-reply]').hidden=!editingId&&!replyToId;
  submit.textContent=readSession()?(editingId?'保存修改':'发表回复'):'登录并回复';
}
try{const d=JSON.parse(localStorage.getItem(draftKey)||'null');if(d){body.value=d.body||'';replyToId=d.replyToId;editingId=d.editingId;targetAuthor=d.targetAuthor;requestId=d.requestId||'';fingerprint=d.fingerprint||'';}}catch{}
body.addEventListener('input',save);mode();
function reset(){replyToId=null;editingId=null;targetAuthor='';requestId='';fingerprint='';mode();save();}
$('[data-cancel-reply]').addEventListener('click',reset);
$('[data-preview-reply]').addEventListener('click',e=>{const panel=$('[data-reply-preview]');panel.hidden=!panel.hidden;e.currentTarget.setAttribute('aria-pressed',String(!panel.hidden));panel.replaceChildren(markdown(body.value||'*暂无内容*'));});
async function signedIn(){if(readSession())return true;save();await login(location.pathname+location.search+'#reply-composer');return false;}
async function action(operation,payload,control,onSuccess){
  if(control.disabled)return;
  control.disabled=true;
  try{if(!await signedIn())return;await apiRequest(`/threads/${number}/${operation}`,{method:'POST',body:JSON.stringify({...payload,requestId:crypto.randomUUID()})});onSuccess();note('操作已保存。');}catch(e){note(e.message,true);}finally{control.disabled=false;}
}
function selectReply(c,parent){
  if(body.value.trim() && (editingId!==c.id || !editingId) && !confirm('切换回复对象将替换当前输入。继续？'))return;
  editingId=null;replyToId=parent?.id||c.id;targetAuthor=c.author;body.value=parent?`@${c.author} `:'';requestId='';fingerprint='';mode();save();body.focus();form.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderComment(c,parent){
  const box=el('article',{class:`comment-card${parent?' comment-child':''}`,id:`comment-${c.id}`});
  const meta=el('header',{class:'comment-meta'},userLink(c.author),el('time',{datetime:c.createdAt},date(c.createdAt)));
  if(c.isAnswer)meta.append(el('span',{class:'answer-badge'},'已采纳'));
  box.append(meta,c.isMinimized?el('p',{class:'moderated-content'},'此回复已由维护者折叠。'):markdown(c.body));
  const actions=el('div',{class:'comment-actions'});
  const locked=post.locked||post.closed;
  if(!c.isMinimized){
    const reply=button('回复',()=>selectReply(c,parent));reply.disabled=locked;actions.append(reply);
    const vote=button(`${c.hasUpvoted?'已赞':'点赞'} ${c.upvotes||0}`,()=>action('vote',{commentId:c.id,enabled:!c.hasUpvoted},vote,()=>{c.upvotes=(c.upvotes||0)+(c.hasUpvoted?-1:1);c.hasUpvoted=!c.hasUpvoted;vote.textContent=`${c.hasUpvoted?'已赞':'点赞'} ${c.upvotes}`;vote.setAttribute('aria-pressed',String(c.hasUpvoted));}),{'aria-pressed':String(!!c.hasUpvoted)});vote.disabled=locked||(live&&!c.canUpvote&&!c.hasUpvoted);actions.append(vote);
  }
  if(live&&!c.isMinimized&&c.author===readSession()?.user.login&&c.canEdit){
    const edit=button('编辑',()=>{if(body.value.trim()&&!confirm('编辑将替换当前输入，继续？'))return;editingId=c.id;replyToId=null;targetAuthor=c.author;body.value=c.body;requestId='';fingerprint='';mode();save();body.focus();form.scrollIntoView({behavior:'smooth',block:'center'});});edit.disabled=locked;actions.append(edit);
  }
  if(live&&c.author===readSession()?.user.login&&c.canDelete){
    const remove=button('删除',async()=>{if(!confirm('删除这条回复及其跟帖？GitHub 上的原内容也会删除，无法撤销。'))return;remove.disabled=true;try{await apiRequest(`/threads/${number}/comments`,{method:'DELETE',body:JSON.stringify({commentId:c.id,requestId:crypto.randomUUID()})});box.replaceWith(el('p',{class:'deleted-comment'},'回复已删除'));if(!parent){post.comments=Math.max(0,post.comments-1);$('[data-comment-count]').textContent=`(${post.comments})`;}note('回复已删除。');}catch(e){note(e.message,true);remove.disabled=false;}});remove.disabled=locked;actions.append(remove);
  }
  if(live&&(c.canAnswer||c.canUnanswer)){
    const answer=button(c.isAnswer?'取消采纳':'采纳为答案',()=>action('answer',{commentId:c.id,enabled:!c.isAnswer},answer,()=>{load();}));answer.disabled=locked;actions.append(answer);
  }
  const collapse=button('收起',()=>{const collapsed=collapse.getAttribute('aria-expanded')==='false';box.querySelectorAll(':scope > .prose,:scope > .comment-children').forEach(n=>n.hidden=!collapsed);collapse.textContent=collapsed?'收起':'展开';collapse.setAttribute('aria-expanded',String(collapsed));},{'aria-expanded':'true'});actions.append(collapse);box.append(actions);
  if(!parent){
    const children=el('div',{class:'comment-children'});for(const r of c.replies||[])children.append(renderComment(r,c));box.append(children);
    if(c.replyPageInfo?.hasNextPage){const more=button('加载更多跟帖',async()=>{more.disabled=true;try{const data=await apiRequest(`/threads/${number}/replies?${new URLSearchParams({parentId:c.id,after:c.replyPageInfo.endCursor})}`);for(const r of data.comments)children.append(renderComment(r,c));c.replyPageInfo=data.pageInfo;more.hidden=!data.pageInfo.hasNextPage;}catch(e){note(e.message,true);}finally{more.disabled=false;}});children.append(more);}
  }
  return box;
}
async function boardLink(board){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(board));const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16);return el('a',{class:'tag',href:`/boards/${id}/`},'#'+board.replaceAll('/',' / '));}
async function renderPost(){
  const article=$('[data-post-content]');article.replaceChildren();
  const boards=el('div',{class:'post-boards'});for(const board of post.explicitBoards||[])boards.append(await boardLink(board));
  const meta=el('div',{class:'post-meta'},userLink(post.author),el('time',{datetime:post.createdAt},date(post.createdAt)),el('span',{},({article:'知识文章',question:'问题',release:'固件 / 软件发布'})[post.type]));
  if(post.locked||post.closed)meta.append(el('span',{class:'state-badge'},post.locked?'已锁定':'已关闭'));
  article.append(boards,el('h1',{},post.title),meta,markdown(post.content));
  document.title=`${post.title} · cam-ins`;
  const controls=el('div',{class:'post-actions'});
  const vote=button(`${post.hasUpvoted?'已赞':'点赞'} ${post.upvotes||0}`,()=>action('vote',{enabled:!post.hasUpvoted},vote,()=>{post.upvotes=(post.upvotes||0)+(post.hasUpvoted?-1:1);post.hasUpvoted=!post.hasUpvoted;vote.textContent=`${post.hasUpvoted?'已赞':'点赞'} ${post.upvotes}`;vote.setAttribute('aria-pressed',String(post.hasUpvoted));}),{'aria-pressed':String(!!post.hasUpvoted)});vote.disabled=post.locked||post.closed||(live&&!post.canUpvote&&!post.hasUpvoted);
  controls.append(vote,el('a',{class:'control',href:'#reply-composer'},'回复'));
  if(post.author===readSession()?.user.login)controls.append(el('a',{class:'control',href:`/publish/?edit=${number}`},'编辑文章'));
  article.append(controls);
  const source=el('details',{class:'source-details'},el('summary',{},'原文与同步信息'),el('p',{},'内容保存在 GitHub Discussions。'));
  if(post.url?.startsWith('https://github.com/'))source.append(el('a',{href:post.url,class:'control'},'GitHub 原文'));
  article.append(source);
  $('[data-author-card]').replaceChildren(userLink(post.author),el('a',{class:'control',href:profileHref(post.author)},'查看个人主页'));
  const boardList=$('[data-thread-boards]');boardList.replaceChildren();for(const board of post.boards||[])boardList.append(await boardLink(board));
  body.disabled=submit.disabled=!!(post.locked||post.closed);if(body.disabled)note('文章已锁定或关闭，无法发表回复。');
}
async function load(append=false){
  if(loading)return;loading=true;$('[data-refresh]').disabled=true;
  try{
    let data;live=!!readSession();
    if(live)data=await apiRequest(`/threads/${number}${append?'?after='+encodeURIComponent(pageInfo.endCursor):''}`);
    else{const response=await fetch(`/api/threads/${number}.json`,{cache:'no-store'});if(!response.ok)throw Error('文章正在同步或已删除。登录后可获取实时内容。');data=await response.json();}
    post=data.post;pageInfo=data.pageInfo;status.classList.remove('error');
    await renderPost();
    if(!append)comments.replaceChildren();
    comments.querySelector('.empty-comments')?.remove();
    for(const c of data.comments)if(!document.getElementById(`comment-${c.id}`))comments.append(renderComment(c));
    if(!comments.children.length)comments.append(el('p',{class:'empty-comments'},'暂无回复'));
    $('[data-comment-count]').textContent=`(${post.comments})`;
    $('[data-more-comments]').hidden=!pageInfo.hasNextPage;
    status.textContent=live?'已加载实时讨论':`公开回复 · 同步于 ${date(data.generatedAt)}。登录后实时刷新。`;
    mode();
    if(location.hash.startsWith('#comment-'))document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }catch(e){status.textContent=e.message;status.classList.add('error');if(!post)$('[data-post-content]').replaceChildren(el('h1',{},'文章暂不可用'),el('p',{},e.message));}
  finally{loading=false;$('[data-refresh]').disabled=false;}
}
$('[data-refresh]').addEventListener('click',()=>load());$('[data-more-comments]').addEventListener('click',()=>load(true));
form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;if(!body.value.trim()){note('请输入回复内容。',true);return;}
  busy=true;
  try{if(!await signedIn()){busy=false;return;}}catch(e){busy=false;note(e.message,true);return;}
  const payload={body:body.value,replyToId:replyToId||undefined,commentId:editingId||undefined};const current=JSON.stringify(payload);
  if(current!==fingerprint){fingerprint=current;requestId=crypto.randomUUID();}save();busy=true;submit.disabled=true;note('正在保存…');
  try{
    const data=await apiRequest(`/threads/${number}/comments`,{method:editingId?'PUT':'POST',body:JSON.stringify({...payload,requestId})});
    const old=editingId&&document.getElementById(`comment-${editingId}`);
    const parent=replyToId||data.comment.replyToId;
    const rendered=renderComment(data.comment,parent?{id:parent}:null);
    if(old){const children=old.querySelector('.comment-children');if(children){rendered.querySelector('.comment-children')?.remove();rendered.append(children);}old.replaceWith(rendered);}
    else if(parent&&document.getElementById(`comment-${parent}`))document.getElementById(`comment-${parent}`).querySelector('.comment-children').append(rendered);
    else{comments.querySelector('.empty-comments')?.remove();comments.prepend(rendered);}
    if(!editingId&&!parent){post.comments++;$('[data-comment-count]').textContent=`(${post.comments})`;}
    body.value='';reset();try{localStorage.removeItem(draftKey);}catch{}note('回复已保存。');rendered.scrollIntoView({behavior:'smooth',block:'center'});
  }catch(e){note(e.message,true);}finally{busy=false;submit.disabled=!!(post?.locked||post?.closed);mode();}
});
if(Number.isSafeInteger(number)&&number>0)load();else{$('[data-post-content]').textContent='文章编号无效。';form.hidden=true;}
