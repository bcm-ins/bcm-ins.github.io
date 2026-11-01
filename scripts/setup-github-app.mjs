// One-time, loopback-only GitHub App manifest setup. No credentials are written to disk.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const api = process.env.COMMUNITY_API;
if (!api || new URL(api).protocol !== 'https:') throw new Error('Set COMMUNITY_API to the deployed HTTPS Worker origin.');
const port = 8977;
const nonce = randomBytes(24).toString('hex');
const origin = `http://127.0.0.1:${port}`;
const manifest = {
  name: 'cam-ins-community-bcm-ins',
  url: 'https://bcm-ins.github.io',
  description: 'GitHub sign-in and Markdown article publishing for the cam-ins camera community.',
  hook_attributes: { url: `${api}/unused-webhook`, active: false },
  redirect_url: `${origin}/callback`,
  callback_urls: [`${api}/auth/callback`],
  public: true,
  default_permissions: { discussions: 'write', metadata: 'read' },
  default_events: [],
  request_oauth_on_install: false,
};
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let complete = false, busy = false;
function page(response, body, code = 200) {
  response.writeHead(code, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'"});
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>cam-ins · 连接 GitHub App</title><style>body{font:16px/1.8 system-ui;max-width:760px;margin:60px auto;padding:24px;background:#f6f8f2;color:#34472e}button,a{font:inherit;color:#365f25}button{padding:12px 20px;cursor:pointer}code{overflow-wrap:anywhere}</style>${body}</html>`);
}
function upload(secrets) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','-c','backend/wrangler.jsonc'],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    // Do not print CLI output: even failure diagnostics must not expose secret inputs.
    child.stdout.resume();child.stderr.resume();child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error('Cloudflare secret upload failed; credentials remain only in this process.')));
    child.stdin.end(JSON.stringify(secrets));
  });
}
let pending;
const server=http.createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${port}`)return page(res,'Invalid host',403);
  const url=new URL(req.url,origin);
  if(req.method!=='GET')return page(res,'Method not allowed',405);
  if(url.pathname===`/setup/${nonce}`){
    if(complete)return page(res,'<h1>已完成连接</h1><p>可关闭此页，返回社区登录。</p>');
    return page(res,`<h1>连接 cam-ins GitHub App</h1><p>请使用 <b>bcm-ins</b> 账号创建应用。</p><ul><li>仓库权限：Discussions 读写，以及必需的 Metadata 只读。</li><li>回调：<code>${escape(api)}/auth/callback</code></li><li>不请求源码、工作流、邮件或其他账号权限。</li><li>应用密钥将通过本机直接配置到你的 Cloudflare Worker，不显示或保存在网页。</li></ul><form action="https://github.com/settings/apps/new?state=${nonce}" method="post"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button type="submit">在 GitHub 检查并创建应用 →</button></form>`);
  }
  if(url.pathname==='/callback' && url.searchParams.get('state')===nonce){
    if(complete)return page(res,'<h1>已完成连接</h1>');
    if(busy)return page(res,'正在配置，请稍后刷新。',409);
    const code=url.searchParams.get('code');
    if(!code || !/^[a-zA-Z0-9_-]{10,512}$/.test(code))return page(res,'授权码无效。',400);
    busy=true;
    try{
      if(!pending){
        const result=await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,{method:'POST',headers:{Accept:'application/vnd.github+json','User-Agent':'cam-ins-setup'},signal:AbortSignal.timeout(30000)});
        if(!result.ok)throw new Error('GitHub manifest conversion failed.');
        const app=await result.json();
        if(app.owner?.login!=='bcm-ins' || !app.client_id || !app.client_secret)throw new Error('App owner or credentials invalid.');
        pending={secrets:{GITHUB_CLIENT_ID:app.client_id,GITHUB_CLIENT_SECRET:app.client_secret,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')},info:{id:app.id,slug:app.slug,html_url:app.html_url,owner:app.owner.login,permissions:app.permissions,callback:manifest.callback_urls[0]}};
        // The installation private key and webhook secret are not needed or persisted.
      }
      await upload(pending.secrets);
      await writeFile('qa/github-app.json',JSON.stringify(pending.info,null,2));
      const appUrl=pending.info.html_url;
      pending=undefined;complete=true;
      console.log('GitHub App created and Worker secrets configured. Public metadata: qa/github-app.json');
      page(res,`<h1>应用已连接</h1><p>下一步：安装到 <b>bcm-ins/bcm-ins.github.io</b>。请选择 Only select repositories，仅勾选该仓库。</p><p><a href="${escape(appUrl)}/installations/new">前往 GitHub 安装应用 →</a></p><p>完成后返回社区编辑器，使用 GitHub 登录。</p>`);
    }catch{console.log('Setup incomplete. Refresh the callback to retry; no credentials were logged.');page(res,'<h1>连接尚未完成</h1><p>请保留此页并通知助手检查。可刷新本页重试。</p>',502);}
    finally{busy=false;}
    return;
  }
  page(res,'Not found',404);
});
server.listen(port,'127.0.0.1',()=>console.log(`Setup page: ${origin}/setup/${nonce}`));
setTimeout(()=>server.close(),3600000).unref();
