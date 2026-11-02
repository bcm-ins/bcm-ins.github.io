export const MAX_IMAGE_BYTES=1048576;
const USER_QUOTA=32*MAX_IMAGE_BYTES,SITE_QUOTA=256*MAX_IMAGE_BYTES;
export function imageMime(bytes){
  const b=new Uint8Array(bytes);
  if(b.length<16)return null;
  if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10)return 'image/png';
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
  return null;
}
export async function readImage(request,fail){
  if(Number(request.headers.get('Content-Length'))>MAX_IMAGE_BYTES)fail(413,'图片压缩后不能超过 1 MB。');
  const reader=request.body?.getReader();if(!reader)fail(400,'请选择图片。');
  const parts=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_IMAGE_BYTES){await reader.cancel();fail(413,'图片压缩后不能超过 1 MB。');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const mime=imageMime(bytes);if(!mime||mime!==request.headers.get('Content-Type')?.split(';')[0])fail(415,'只支持 PNG、JPEG 和 WebP 图片，不支持 SVG 或其他附件。');
  return {bytes,mime};
}
export async function serveImage(request,env,fail){
  const id=new URL(request.url).pathname.match(/^\/images\/([a-f0-9]{64})$/)?.[1];
  if(!id||!['GET','HEAD'].includes(request.method))return null;
  const row=await env.DB.prepare('SELECT mime,size,data FROM images WHERE id=?').bind(id).first();
  if(!row)fail(404,'图片不存在。');
  const bytes=row.data instanceof ArrayBuffer?row.data:new Uint8Array(row.data);
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':row.mime,'Content-Length':String(row.size),'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});
}
export async function uploadImage(request,env,auth,{fail,github,limit,now}){
  await limit(env,`image:${auth.user_id}`,20,86400);
  const {bytes,mime}=await readImage(request,fail);
  // Recheck the GitHub grant before accepting persistent public content.
  await github(auth.token,'query { viewer { login } }',{});
  const salt=new TextEncoder().encode(`${auth.user_id}:`),digestInput=new Uint8Array(salt.length+bytes.length);digestInput.set(salt);digestInput.set(bytes,salt.length);
  const id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',digestInput))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const prior=await env.DB.prepare('SELECT id FROM images WHERE id=? AND user_id=?').bind(id,auth.user_id).first();
  if(!prior){
    // The quota check and insertion are one atomic SQLite statement, including concurrent uploads.
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO images(id,user_id,mime,size,data,created_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM images WHERE user_id=?) + ? <= ?
      AND (SELECT COALESCE(SUM(size),0) FROM images) + ? <= ? RETURNING id`)
      .bind(id,auth.user_id,mime,bytes.length,bytes.buffer,now(),auth.user_id,bytes.length,USER_QUOTA,bytes.length,SITE_QUOTA).first();
    if(!inserted){const concurrent=await env.DB.prepare('SELECT id FROM images WHERE id=? AND user_id=?').bind(id,auth.user_id).first();if(!concurrent)fail(507,'图片存储额度已满，请使用已有图片链接或联系维护者。');}
  }
  return {url:new URL('/images/'+id,request.url).href,size:bytes.length,mime};
}
