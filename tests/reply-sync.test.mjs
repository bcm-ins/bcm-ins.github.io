import test from 'node:test';
import assert from 'node:assert/strict';
import {collectComments} from '../scripts/sync-discussions.mjs';
test('Public reply export collects all pages, strips viewer permissions and omits moderated body',async()=>{
  const c={id:'first',body:'text',author:{login:'alice'},viewerCanDelete:true,replies:{nodes:[],totalCount:1,pageInfo:{hasNextPage:true,endCursor:'r1'}}};let calls=0;
  const data=await collectComments(async(_q,v)=>{calls++;
    if(v.id){assert.equal(v.after,'r1');return{node:{replies:{nodes:[{id:'reply',body:'hidden',isMinimized:true,author:{login:'bob'},viewerCanDelete:true}],pageInfo:{hasNextPage:false,endCursor:'r2'}}}};}
    return{repository:{discussion:{comments:{nodes:v.after?[]:[c],pageInfo:{hasNextPage:!v.after,endCursor:v.after?'c2':'c1'}}}}};
  },8);
  assert.equal(calls,3);assert.equal(data[0].replies.length,1);assert.equal(data[0].replies[0].body,'');assert.equal('canDelete' in data[0],false);
});
