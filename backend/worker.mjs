import { parseBoards, validateArticle } from '../src/lib/boards.mjs';
import { communityRoute } from './community.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => Math.floor(Date.now() / 1000);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async text => b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const keyFor = secret => crypto.subtle.importKey('raw', unb64(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function seal(text, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), enc.encode(text));
  return `${b64(iv)}.${b64(ciphertext)}`;
}
export async function unseal(value, secret) {
  const [iv, ciphertext] = value.split('.');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(secret), unb64(ciphertext)));
}
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const ready = env => !!(env.DB && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
function redirect(url) { return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }

export function checkOrigin(request, env) {
  if (request.headers.get('Origin') !== env.SITE_ORIGIN) fail(403, '此请求来源不被允许。');
}
async function input(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, '请求必须为 JSON。');
  if (Number(request.headers.get('Content-Length')) > 300000) fail(413, '文章过长。');
  // Count bytes while streaming; do not buffer an arbitrarily large request.
  const reader = request.body?.getReader();
  if (!reader) fail(400, '请求内容为空。');
  const chunks = []; let size = 0;
  for (;;) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength; if(size > 300000) { await reader.cancel(); fail(413, '文章过长。'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  try { return JSON.parse(dec.decode(bytes)); } catch { fail(400, 'JSON 格式不正确。'); }
}
async function limit(env, key, max, seconds) {
  const window = Math.floor(now()/seconds);
  const row = await env.DB.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').bind(`${key}:${window}`, (window+2)*seconds, max).first();
  if (!row) fail(429, '操作过于频繁，请稍后再试。');
}
async function github(token, query, variables) {
  let response;
  try { response = await fetch('https://api.github.com/graphql', { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json', 'User-Agent':'cam-ins-community', 'X-GitHub-Api-Version':'2022-11-28' }, body:JSON.stringify({query,variables}), signal:AbortSignal.timeout(20000) }); }
  catch { fail(502, 'GitHub 暂时未响应。若正在发布，请先检查“我的文章”后再重试，避免重复。'); }
  if(response.status===401) fail(401, 'GitHub 授权已失效，请重新登录。');
  if(response.status===403 || response.status===429) fail(403, 'GitHub 暂时拒绝此操作，请检查账号权限或稍后重试。');
  if(!response.ok) fail(502, 'GitHub 服务暂时不可用，请稍后检查原帖。');
  const data = await response.json();
  if(data.errors?.length) fail(data.data?502:422, 'GitHub 未确认此操作。请刷新文章检查结果，并确认账号可参与讨论。');
  return data.data;
}
async function session(request,env) {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!bearer) fail(401,'请先登录 GitHub。');
  const sessionHash = await hash(bearer);
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE session_hash=? AND expires_at>?').bind(sessionHash, now()).first();
  if(!row) fail(401,'登录已过期，请重新登录；本地草稿仍会保留。');
  return {...row, sessionHash, token:await unseal(row.sealed_token,env.TOKEN_ENCRYPTION_KEY)};
}
async function getDiscussion(env, token, number) {
  const [owner,name] = env.REPOSITORY.split('/');
  const data = await github(token, 'query($owner:String!,$name:String!,$number:Int!) { repository(owner:$owner,name:$name) { discussion(number:$number) { id number title body url viewerCanUpdate author { login } category { id } } } }',{owner,name,number});
  if(!data.repository?.discussion) fail(404,'找不到这篇文章。');
  return data.repository.discussion;
}
async function handle(request,env) {
  const url = new URL(request.url); const path = url.pathname;
  if(path==='/health' && request.method==='GET') return json({ready:ready(env), service:'cam-ins-community'});
  if(!ready(env)) fail(503,'站内登录服务尚未配置完成，请稍后再来；草稿可以先在本机保存。');
  if(path==='/auth/start' && request.method==='GET') {
    const challenge=url.searchParams.get('challenge'),browserState=url.searchParams.get('state');
    if(!/^[A-Za-z0-9_-]{43}$/.test(challenge||'') || !/^[A-Za-z0-9_-]{43}$/.test(browserState||'')) fail(400,'请从社区发布页重新开始登录。');
    await limit(env,`auth:${await hash(request.headers.get('CF-Connecting-IP')||'unknown')}`,30,600);
    const state=random(),verifier=random();
    await env.DB.prepare('INSERT INTO oauth_flows VALUES (?,?,?,?,?)').bind(await hash(state),challenge,browserState,verifier,now()+600).run();
    const oauth=new URL('https://github.com/login/oauth/authorize');
    oauth.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:url.origin+'/auth/callback',state,code_challenge:await hash(verifier),code_challenge_method:'S256',allow_signup:'true'}).toString();
    return redirect(oauth.href);
  }
  if(path==='/auth/callback' && request.method==='GET') {
    const state=url.searchParams.get('state');
    if(!/^[A-Za-z0-9_-]{43}$/.test(state||'')) fail(400,'授权状态无效，请从社区重新登录。');
    const flow=await env.DB.prepare('DELETE FROM oauth_flows WHERE state_hash=? AND expires_at>? RETURNING *').bind(await hash(state),now()).first();
    if(!flow) fail(400,'授权已过期或已使用，请从社区重新登录。');
    const destination=new URL('/auth/callback/',env.SITE_ORIGIN);
    if(url.searchParams.has('error')) { destination.hash=new URLSearchParams({state:flow.browser_state,error:'授权未完成，可以返回编辑器重试。'}).toString(); return redirect(destination.href); }
    const code=url.searchParams.get('code'); if(!code || code.length>512) fail(400,'授权码无效。');
    const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:url.origin+'/auth/callback',code_verifier:flow.github_verifier}),signal:AbortSignal.timeout(20000)});
    if(!response.ok) fail(502,'GitHub 登录暂不可用，请重新开始登录。');
    const grant=await response.json(); if(!grant.access_token || grant.error) fail(401,'GitHub 授权失败，请重新登录。');
    const userResponse=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${grant.access_token}`,'User-Agent':'cam-ins-community',Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
    if(!userResponse.ok) fail(401,'无法确认 GitHub 身份，请重新登录。');
    const user=await userResponse.json();
    if(!Number.isSafeInteger(user.id)|| !/^[A-Za-z0-9-]+$/.test(user.login||'')) fail(401,'GitHub 身份信息无效。');
    const ticket=random(); const expiry=now()+Math.min(Number(grant.expires_in)||28800,28800)-60;
    await env.DB.prepare('INSERT INTO login_tickets VALUES (?,?,?,?,?,?,?)').bind(await hash(ticket),flow.browser_challenge,await seal(grant.access_token,env.TOKEN_ENCRYPTION_KEY),user.login,user.id,expiry,now()+120).run();
    destination.hash=new URLSearchParams({ticket,state:flow.browser_state}).toString();
    return redirect(destination.href);
  }
  checkOrigin(request,env);
  if(path==='/session/exchange' && request.method==='POST') {
    const body=await input(request);
    if(!/^[A-Za-z0-9_-]{43}$/.test(body.ticket||'')|| !/^[A-Za-z0-9_-]{43}$/.test(body.verifier||'')) fail(400,'登录验证信息不完整。');
    const row=await env.DB.prepare('DELETE FROM login_tickets WHERE ticket_hash=? AND browser_challenge=? AND expires_at>? RETURNING *').bind(await hash(body.ticket),await hash(body.verifier),now()).first();
    if(!row) fail(401,'授权已过期、已使用，或不是从此标签页发起。请重新登录。');
    const id=random();
    await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').bind(await hash(id),row.sealed_token,row.login,row.user_id,row.token_expires_at).run();
    return json({session:id,user:{login:row.login},expiresAt:row.token_expires_at*1000});
  }
  const auth=await session(request,env);
  if(path==='/session' && request.method==='GET') return json({user:{login:auth.login},expiresAt:auth.expires_at*1000});
  if(path==='/session' && request.method==='DELETE') { await env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(auth.sessionHash).run(); return json({loggedOut:true}); }
  const community=await communityRoute(request,env,auth,{github,fail,input,limit,hash,now});
  if(community)return json(community);
  const match=path.match(/^\/posts\/([1-9]\d{0,9})$/);
  if(match && request.method==='GET') {
    const d=await getDiscussion(env,auth.token,Number(match[1]));
    if(d.author?.login!==auth.login || !d.viewerCanUpdate) fail(403,'只能在这里编辑你自己发表的文章。');
    const parsed=parseBoards(d.body);
    return json({number:d.number,title:d.title,body:parsed.content,boards:parsed.explicitBoards,type:d.category.id===env.CATEGORY_QUESTION?'question':d.category.id===env.CATEGORY_RELEASE?'release':'article',url:d.url});
  }
  if((path==='/posts' && request.method==='POST') || (match && request.method==='PUT')) {
    let article; const body=await input(request);
    try { article=validateArticle(body); } catch(e) { fail(400,e.message); }
    if(!/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId||'')) fail(400,'发布请求标识无效。');
    const fingerprint=await hash(JSON.stringify({article,path}));
    const prior=await env.DB.prepare('SELECT * FROM submissions WHERE user_id=? AND request_id=?').bind(auth.user_id,body.requestId).first();
    if(prior) {
      if(prior.fingerprint!==fingerprint) fail(409,'这个发布标识已用于另一份内容，请重新提交。');
      if(prior.result_json) return json(JSON.parse(prior.result_json));
      fail(409,'这次发布正在处理或结果尚未确认。请先查看 GitHub 原帖，避免重复发布。');
    }
    await limit(env,`publish:${auth.user_id}`,12,600);
    const inserted=await env.DB.prepare('INSERT OR IGNORE INTO submissions(user_id,request_id,fingerprint,expires_at) VALUES (?,?,?,?) RETURNING request_id').bind(auth.user_id,body.requestId,fingerprint,now()+86400).first();
    if(!inserted) fail(409,'这次发布已经在处理中，请勿重复点击。');
    const categoryId=env[`CATEGORY_${article.type.toUpperCase()}`];
    try {
      let result;
      if(match) {
        const old=await getDiscussion(env,auth.token,Number(match[1]));
        if(old.author?.login!==auth.login || !old.viewerCanUpdate) fail(403,'只能修改自己的文章。');
        if(old.category.id!==categoryId) fail(422,'修改文章类型需要维护者调整 GitHub 分类；正文与板块可以直接保存。');
        result=(await github(auth.token,'mutation($input:UpdateDiscussionInput!) { updateDiscussion(input:$input) { discussion { number url } } }',{input:{discussionId:old.id,title:article.title,body:article.markdown}})).updateDiscussion.discussion;
      } else {
        result=(await github(auth.token,'mutation($input:CreateDiscussionInput!) { createDiscussion(input:$input) { discussion { number url } } }',{input:{repositoryId:env.REPOSITORY_ID,categoryId,title:article.title,body:article.markdown,clientMutationId:body.requestId}})).createDiscussion.discussion;
      }
      if(!result?.number) fail(502,'发布结果未确认，请先检查 GitHub 原帖。');
      await env.DB.prepare('UPDATE submissions SET status=?,result_json=? WHERE user_id=? AND request_id=?').bind('done',JSON.stringify(result),auth.user_id,body.requestId).run();
      return json(result,match?200:201);
    } catch(e) {
      if(e instanceof ApiError && e.status<500) await env.DB.prepare('DELETE FROM submissions WHERE user_id=? AND request_id=?').bind(auth.user_id,body.requestId).run();
      throw e;
    }
  }
  fail(404,'接口不存在。');
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    if(request.method==='OPTIONS') {
      if(origin!==env.SITE_ORIGIN) return json({error:'来源不被允许。'},403);
      return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':env.SITE_ORIGIN,'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600',Vary:'Origin'}});
    }
    let response;
    try { response=await handle(request,env); }
    catch(e) { response=json({error:e instanceof ApiError?e.message:'服务暂时不可用。请保留草稿，稍后再试。'},e instanceof ApiError?e.status:500); }
    const headers=new Headers(response.headers);
    if(origin===env.SITE_ORIGIN) { headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin'); }
    headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
    return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(_event,env) {
    if(!env.DB) return;
    await env.DB.batch(['oauth_flows','login_tickets','sessions','submissions','rate_limits'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).bind(now())));
  },
};
