// Read-only integration check against GitHub. Does not create a login session or mutate content.
import {communityRoute} from '../backend/community.mjs';
import {collectComments} from './sync-discussions.mjs';
const token=process.env.GH_TOKEN;if(!token)throw Error('GH_TOKEN required');
const env={REPOSITORY:'bcm-ins/bcm-ins.github.io'};
const request=async(query,variables)=>{
  const response=await fetch('https://api.github.com/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'cam-ins-read-check'},body:JSON.stringify({query,variables})});
  const result=await response.json();if(!response.ok||result.errors)throw Error(JSON.stringify(result.errors||response.status));return result.data;
};
const helpers={github:(_token,q,v)=>request(q,v),limit:async()=>{},fail:(status,message)=>{throw Error(`${status} ${message}`);}};
const thread=await communityRoute(new Request('https://api.example/threads/3'),env,{token,user_id:1},helpers);
const profile=await communityRoute(new Request('https://api.example/profiles/bcm-ins'),env,{token,user_id:1},helpers);
const comments=await collectComments(request,3);
console.log(JSON.stringify({thread:thread.post.number,commentPage:thread.comments.length,publicCommentExport:comments.length,profile:profile.profile.login,profilePosts:profile.posts.length,readOnly:true}));
