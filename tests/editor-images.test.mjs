import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImageFile,safeLink,markdownLabel} from '../src/lib/editor-images.mjs';
import {imageMime,readImage} from '../backend/images.mjs';
test('Image picker validates file types and budgets; URL insertion rejects executable protocols and escapes Markdown',()=>{
  validateImageFile({type:'image/png',size:100});
  for(const f of [{type:'image/svg+xml',size:10},{type:'image/jpeg',size:21*1024*1024},{type:'image/webp',size:0}])assert.throws(()=>validateImageFile(f));
  for(const url of ['javascript:alert(1)','data:image/svg+xml,hello','https://name:secret@example.org/a'])assert.throws(()=>safeLink(url));
  assert.equal(safeLink('https://example.org/(image).png'),'https://example.org/%28image%29.png');assert.equal(markdownLabel('a]\n![b'),'a  ! b');
  assert.equal(imageMime(new Uint8Array(30)),null);
});
test('Streaming upload rejects oversized bodies even without Content-Length',async()=>{
  let reads=0;const stream=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(600000));if(reads===3)c.close();}});
  await assert.rejects(readImage(new Request('https://api.example/images',{method:'POST',headers:{'Content-Type':'image/png'},body:stream,duplex:'half'}),(status,message)=>{throw Error(`${status} ${message}`);}),/413/);
});
