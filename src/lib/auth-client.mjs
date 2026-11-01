export const sessionKey = 'cam-ins:session:v1';
export const flowKey = 'cam-ins:oauth:v1';
export const backendUrl = () => (document.querySelector('meta[name="cam-ins-api"]')?.content || '').replace(/\/$/, '');
export function readSession() {
  try { const value = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); return value?.expiresAt > Date.now() && value?.session ? value : null; } catch { return null; }
}
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function login(returnTo = '/publish/') {
  const api = backendUrl(); if(!api) throw new Error('站内登录服务正在配置中。你可以先写作并保存草稿。');
  const verifier=random(),state=random();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  sessionStorage.setItem(flowKey,JSON.stringify({verifier,state,returnTo,expiresAt:Date.now()+600000}));
  location.assign(`${api}/auth/start?${new URLSearchParams({challenge,state})}`);
}
export async function apiRequest(path,options={}) {
  const api=backendUrl();if(!api)throw new Error('站内发布服务尚未配置完成。草稿可以保存或导出。');
  const session=readSession();
  const response=await fetch(api+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(session?{Authorization:`Bearer ${session.session}`}:{ }),...options.headers},credentials:'omit',signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok) { if(response.status===401)sessionStorage.removeItem(sessionKey);const e=new Error(data.error||'请求失败，请稍后再试。');e.status=response.status;throw e; }
  return data;
}
