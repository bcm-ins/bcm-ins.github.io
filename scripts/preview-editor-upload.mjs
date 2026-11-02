// Isolated browser regression server: in-memory media, synthetic session, no GitHub/Cloudflare calls.
// Run after pnpm build. Never deploy this server or its bootstrap script.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';
import {uploadImage,serveImage} from '../backend/images.mjs';
const origin='http://127.0.0.1:4322',root=resolve('dist'),sql=new DatabaseSync(':memory:');
sql.exec(await readFile('backend/migrations/0002_images.sql','utf8'));
const DB={prepare(query){let args=[];return{bind(...values){args=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this;},async first(){return sql.prepare(query).get(...args)||null;}};}};
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const token='localtest'.padEnd(43,'x');
function chunk(type,data){const tag=Buffer.from(type),all=Buffer.concat([tag,data]);let crc=0xffffffff;for(const b of all){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,all,sum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(320,0);header.writeUInt32BE(180,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc(180*(1+320*3));for(let y=0;y<180;y++)for(let x=0;x<320;x++){const i=y*(1+320*3)+1+x*3;pixels[i]=40+x/2;pixels[i+1]=100+y/2;pixels[i+2]=210;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
await mkdir('qa',{recursive:true});await writeFile('qa/editor-upload-fixture.png',png);
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,origin);let response;
    if(url.pathname==='/__qa-bootstrap.js')response=new Response(`sessionStorage.setItem('cam-ins:session:v1',JSON.stringify({session:${JSON.stringify(token)},user:{login:'local-test-user'},expiresAt:Date.now()+3600000}));`,{headers:{'Content-Type':'text/javascript'}});
    else if(url.pathname==='/images'&&req.method==='POST'){
      if(req.headers.authorization!==`Bearer ${token}`||req.headers.origin!==origin)fail(401,'Local fixture session required');
      const request=new Request(url,{method:'POST',headers:req.headers,body:req,duplex:'half'});
      const data=await uploadImage(request,{DB},{user_id:1,token:'synthetic'},{fail,github:async()=>({viewer:{login:'local-test-user'}}),limit:async()=>{},now:()=>Math.floor(Date.now()/1000)});
      response=Response.json(data,{status:201});
    }else if(url.pathname.startsWith('/images/'))response=await serveImage(new Request(url,{method:req.method}),{DB},fail);
    else if(url.pathname==='/session')response=Response.json({user:{login:'local-test-user'}});
    else{
      let path=decodeURIComponent(url.pathname);if(path.endsWith('/'))path+='index.html';const file=resolve(root,'.'+path);if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\'))fail(403,'Invalid path');let data=await readFile(file);
      const type=extname(file);if(type==='.html'){
        data=data.toString().replace(/(<meta name="cam-ins-api" content=")[^"]+/,`$1${origin}`).replaceAll('https://cam-ins-community-api.cam-ins-community.workers.dev',origin).replace("upgrade-insecure-requests",'').replace('<head>','<head><script src="/__qa-bootstrap.js"></script>').replace('<body>','<body><p style="border:1px solid #e5b953;padding:10px;text-align:center;background:#fffbeb;font-size:12px">本地上传回归 · 测试账号 · 图片仅保存在内存 · 不发布文章</p>');
      }
      response=new Response(data,{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[type]||'application/octet-stream'}});
    }
    if(!response)fail(404,'Not found');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(e.status||404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
server.listen(4322,'127.0.0.1',()=>console.log(`Isolated editor preview: ${origin}/publish/`));
