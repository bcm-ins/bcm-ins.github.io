import {apiRequest,readSession,login,sessionKey} from '../lib/auth-client.mjs';
import {el,userLink,postHref,button,date} from '../lib/dom.mjs';
const $=s=>document.querySelector(s),session=readSession();
const user=new URLSearchParams(location.search).get('user')||session?.user.login;
const own=!!user&&user.toLowerCase()===session?.user.login.toLowerCase();
let snapshot={posts:[],replies:[],users:[]},posts=[],profile,tab='posts',pageInfo,liveLoaded=false,liveError='';
const list=$('[data-profile-list]'),status=$('[data-profile-status]');
function card(post){return el('article',{class:'profile-item'},el('h2',{},el('a',{href:postHref(post.number)},post.title)),el('p',{},post.excerpt||''),el('div',{class:'profile-item-actions'},el('time',{},date(post.updatedAt)),el('a',{class:'control',href:postHref(post.number)+'#comments'},`${post.comments||0} 条回复`),own?el('a',{class:'control',href:`/publish/?edit=${post.number}`},'编辑文章'):null));}
function render(){
  list.replaceChildren();document.querySelectorAll('[data-profile-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.profileTab===tab)));
  $('[data-profile-more]').hidden=tab!=='posts'||!pageInfo?.hasNextPage;
  if(tab==='posts')posts.forEach(p=>list.append(card(p)));
  if(tab==='replies')snapshot.replies.filter(r=>r.author.toLowerCase()===user.toLowerCase()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).forEach(r=>list.append(el('article',{class:'profile-item'},el('h2',{},el('a',{href:postHref(r.number)+`#comment-${r.id}`},r.title)),el('p',{},r.body),el('time',{},date(r.createdAt)))));
  if(tab==='drafts'&&own){try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key.startsWith('cam-ins:draft:v1:')&&!key.startsWith('cam-ins:reply:v1:'))continue;const draft=JSON.parse(localStorage.getItem(key));if(!draft?.title&&!draft?.body)continue;const id=key.split(':').at(-1),reply=key.includes(':reply:');const href=reply?postHref(id)+'#reply-composer':id==='new'?'/publish/':`/publish/?edit=${id}`;list.append(el('article',{class:'profile-item'},el('h2',{},el('a',{href},draft.title||`文章 #${id} 的回复草稿`)),el('p',{},(draft.body||'').slice(0,180)),el('span',{},'仅保存于当前设备')));}}catch{status.textContent='浏览器不允许读取本机草稿。';}}
  if(!list.children.length)list.append(el('p',{class:'empty-comments'},tab==='drafts'?'暂无本机草稿':tab==='replies'?'尚无已同步回复':'暂无文章'));
  if(tab==='replies')status.textContent=`回复动态同步于 ${date(snapshot.generatedAt)}。刚发布的回复在文章内立即显示。`;
  else if(tab==='drafts')status.textContent='本机草稿不公开；使用此浏览器的其他人也可能访问。';
  else status.textContent=liveLoaded?'已加载实时文章列表':`${liveError?liveError+' 显示公开快照。 ':''}公开文章同步于 ${date(snapshot.generatedAt)}`;
}
async function load(){
  if(!user){$('[data-profile-header]').replaceChildren(el('h1',{},'个人中心'),el('p',{},'登录后查看你的文章、回复和本机草稿。'),button('GitHub 登录',()=>login('/u/'),{class:'button'}));status.textContent='请先登录。';$('.profile-content').hidden=true;return;}
  if(!/^[A-Za-z0-9-]{1,39}$/.test(user)){$('[data-profile-header]').textContent='用户名无效。';$('.profile-content').hidden=true;return;}
  try{
    const response=await fetch('/api/community.json',{cache:'no-store'});if(!response.ok)throw Error('无法加载社区动态。');snapshot=await response.json();
    posts=snapshot.posts.filter(p=>p.author.toLowerCase()===user.toLowerCase());profile=snapshot.users.find(p=>p.login.toLowerCase()===user.toLowerCase())||{login:user};
    if(session){try{const data=await apiRequest(`/profiles/${user}`);profile=data.profile;posts=data.posts;pageInfo=data.pageInfo;liveLoaded=true;}catch(e){liveError=e.message;}}
    const identity=el('div',{class:'profile-identity'},el('span',{class:'profile-avatar','aria-hidden':'true'},profile.login.slice(0,1).toUpperCase()),el('div',{},el('h1',{},profile.name||profile.login),el('p',{},'@'+profile.login)));
    const header=$('[data-profile-header]');header.replaceChildren(identity);if(profile.bio)header.append(el('p',{class:'profile-bio'},profile.bio));
    const counts=el('div',{class:'profile-counts'},el('span',{},`${posts.length}${pageInfo?.hasNextPage?'+':''} 篇文章`),el('span',{},`${snapshot.replies.filter(r=>r.author.toLowerCase()===user.toLowerCase()).length} 条已同步回复`));header.append(counts);
    document.title=`${profile.login} · cam-ins`;
    $('[data-profile-tab="drafts"]').hidden=!own;
    const account=$('[data-profile-account]');
    if(session){account.append(userLink(session.user.login),el('a',{href:'/u/',class:'control'},'我的个人主页'),button('退出登录',async()=>{try{await apiRequest('/session',{method:'DELETE'});}catch(e){if(e.status!==401){status.textContent=e.message;return;}}sessionStorage.removeItem(sessionKey);location.assign('/u/');}));}
    else account.append(button('GitHub 登录',()=>login(location.pathname+location.search),{class:'button'}));
    render();
  }catch(e){status.textContent=e.message;$('[data-profile-header]').replaceChildren(el('h1',{},user),el('p',{},'个人主页暂不可用'));}
}
document.querySelectorAll('[data-profile-tab]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.profileTab;render();}));
$('[data-profile-more]').addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const data=await apiRequest(`/profiles/${user}?after=${encodeURIComponent(pageInfo.endCursor)}`);posts.push(...data.posts);pageInfo=data.pageInfo;render();}catch(error){status.textContent=error.message;}finally{$('[data-profile-more]').disabled=false;}});
load();
