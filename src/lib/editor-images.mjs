import {backendUrl,readSession} from './auth-client.mjs';
export const imageTypes=['image/png','image/jpeg','image/webp'];
export function validateImageFile(file){if(!imageTypes.includes(file.type))throw Error('支持 PNG、JPG 和 WebP；请先转换 HEIC、GIF 或 SVG。');if(!file.size||file.size>20*1024*1024)throw Error('原图需在 20 MB 以内。');}
export function safeLink(value){let url;try{url=new URL(value);}catch{throw Error('请输入完整的 https:// 或 http:// 网址。');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('只支持不含账号密码的 HTTP / HTTPS 链接。');return url.href.replaceAll('(','%28').replaceAll(')','%29');}
export function markdownLabel(value){return String(value).replace(/[\[\]\\\r\n]/g,' ').trim().slice(0,150);}
export async function prepareImage(file){
  validateImageFile(file);
  const bitmap=await createImageBitmap(file).catch(()=>{throw Error('图片无法解码，请重新导出为 PNG / JPG / WebP。');});
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>80000000)throw Error('图片分辨率过大，请缩小后上传。');
    const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器不支持图片处理，请使用图片网址。');context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.9,.78,.64,.5]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob&&blob.size<=1048576&&imageTypes.includes(blob.type))return blob;}
    throw Error('压缩后仍超过 1 MB，请裁剪图片或使用外部图片网址。');
  }finally{bitmap.close();}
}
export async function sendImage(blob){
  const session=readSession(),api=backendUrl();if(!session)throw Error('请先使用页面上的 GitHub 登录，再选择图片。文字草稿会保留。');if(!api)throw Error('图片服务尚未配置。');
  const response=await fetch(api+'/images',{method:'POST',headers:{'Content-Type':blob.type,Authorization:`Bearer ${session.session}`},body:blob,credentials:'omit',signal:AbortSignal.timeout(60000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'图片上传失败，请重试。');
  if(new URL(data.url).origin!==new URL(api).origin||!/^\/images\/[a-f0-9]{64}$/.test(new URL(data.url).pathname))throw Error('图片服务返回了无效地址。');
  return data;
}
