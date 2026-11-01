import { parseBoards } from '../src/lib/boards.mjs';
import { commentFields, publicComment } from '../src/lib/discussions.mjs';

export async function communityRoute(request,env,auth,h) {
  const {github,fail,input,limit,hash,now}=h;
  const url=new URL(request.url), path=url.pathname;
  const [owner,name]=env.REPOSITORY.split('/');
  const match=path.match(/^\/threads\/([1-9]\d{0,9})(?:\/(comments|replies|vote|answer))?$/);
  const profile=path.match(/^\/profiles\/([A-Za-z0-9-]{1,39})$/);
  if(!match && !profile)return null;
  await limit(env,`read:${auth.user_id}`,180,600);
  function cursor(value){if(value && (value.length>256 || !/^[A-Za-z0-9+/=_-]+$/.test(value)))fail(400,'分页参数无效。');return value||null;}
  const after=cursor(url.searchParams.get('after'));
  if(profile && request.method==='GET') {
    const login=profile[1];
    const data=await github(auth.token,`query($login:String!,$q:String!,$after:String){
      user(login:$login){login name bio avatarUrl createdAt}
      search(query:$q,type:DISCUSSION,first:25,after:$after){pageInfo{hasNextPage endCursor} nodes{... on Discussion{number title bodyText createdAt updatedAt url author{login} repository{nameWithOwner} comments{totalCount} category{slug}}}}
    }`,{login,q:`repo:${env.REPOSITORY} author:${login} sort:updated-desc`,after});
    if(!data.user)fail(404,'找不到此用户。');
    return {profile:data.user,posts:data.search.nodes.filter(d=>d.repository?.nameWithOwner===env.REPOSITORY).map(d=>({number:d.number,title:d.title,excerpt:d.bodyText.slice(0,180),updatedAt:d.updatedAt,author:d.author?.login||login,comments:d.comments.totalCount,type:d.category.slug==='q-a'?'question':d.category.slug==='show-and-tell'?'release':'article'})),pageInfo:data.search.pageInfo};
  }
  if(!match)fail(405,'不支持此操作。');
  const number=Number(match[1]),operation=match[2];
  async function discussion() {
    const data=await github(auth.token,`query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){discussion(number:$number){id number title body url createdAt updatedAt locked closed isAnswered upvoteCount viewerHasUpvoted viewerCanUpvote author{login avatarUrl} category{id slug} viewerCanUpdate comments{totalCount}}}}`,{owner,name,number});
    const d=data.repository?.discussion;if(!d)fail(404,'文章不存在或已删除。');return d;
  }
  function validId(id){if(typeof id!=='string'|| !/^[A-Za-z0-9_=-]{5,150}$/.test(id))fail(400,'回复标识无效。');return id;}
  async function comment(id){
    const data=await github(auth.token,`query($id:ID!){node(id:$id){... on DiscussionComment{${commentFields} discussion{number repository{nameWithOwner}}}}}`,{id:validId(id)});
    const c=data.node;
    if(!c || c.discussion?.number!==number || c.discussion?.repository?.nameWithOwner!==env.REPOSITORY)fail(404,'此回复不属于当前文章。');
    return c;
  }
  if(!operation && request.method==='GET'){
    const d=await discussion();
    const data=await github(auth.token,`query($id:ID!,$after:String){node(id:$id){... on Discussion{comments(first:25,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{${commentFields} replies(first:20){totalCount pageInfo{hasNextPage endCursor} nodes{${commentFields}}}}}}}}`,{id:d.id,after});
    const connection=data.node.comments;
    const parsed=parseBoards(d.body);
    return {post:{number,title:d.title,body:d.body,content:parsed.content,boards:parsed.boards,explicitBoards:parsed.explicitBoards,author:d.author?.login||'已注销用户',avatar:d.author?.avatarUrl||'',type:d.category.slug==='q-a'?'question':d.category.slug==='show-and-tell'?'release':'article',createdAt:d.createdAt,updatedAt:d.updatedAt,locked:d.locked,closed:d.closed,answered:d.isAnswered,upvotes:d.upvoteCount,hasUpvoted:d.viewerHasUpvoted,canUpvote:d.viewerCanUpvote,canEdit:d.author?.login===auth.login&&d.viewerCanUpdate,url:d.url,comments:d.comments.totalCount},comments:connection.nodes.map(c=>({...publicComment(c,true),replies:c.replies.nodes.map(r=>publicComment(r,true)),replyPageInfo:c.replies.pageInfo,replyCount:c.replies.totalCount})),pageInfo:connection.pageInfo};
  }
  if(operation==='replies' && request.method==='GET'){
    const parent=await comment(url.searchParams.get('parentId'));
    if(parent.replyTo)fail(400,'请使用主回复加载讨论串。');
    const data=await github(auth.token,`query($id:ID!,$after:String){node(id:$id){... on DiscussionComment{replies(first:25,after:$after){pageInfo{hasNextPage endCursor} nodes{${commentFields}}}}}}`,{id:parent.id,after});
    return {comments:data.node.replies.nodes.map(c=>publicComment(c,true)),pageInfo:data.node.replies.pageInfo};
  }
  if(!['POST','PUT','DELETE'].includes(request.method))fail(405,'不支持此操作。');
  const body=await input(request);
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId||''))fail(400,'操作标识无效。');
  const fingerprint=await hash(JSON.stringify({path,method:request.method,body:{...body,requestId:undefined}}));
  const prior=await env.DB.prepare('SELECT * FROM submissions WHERE user_id=? AND request_id=?').bind(auth.user_id,body.requestId).first();
  if(prior){if(prior.fingerprint!==fingerprint)fail(409,'操作标识已用于不同内容。');if(prior.result_json)return JSON.parse(prior.result_json);fail(409,'操作结果尚未确认，请刷新讨论检查，勿重复提交。');}
  const d=await discussion();
  // Lock status is checked before every mutation. GitHub remains the final permission authority.
  if(d.locked || d.closed)fail(403,'文章已锁定或关闭，暂不能修改讨论。');
  let target;
  if(body.commentId)target=await comment(body.commentId);
  if(operation==='comments'){
    if(request.method==='POST' && body.replyToId){target=await comment(body.replyToId);if(target.replyTo)fail(400,'回复需关联主回复。');}
    if(request.method!=='DELETE' && (typeof body.body!=='string'|| !body.body.trim()||new TextEncoder().encode(body.body).length>50000))fail(400,'回复不能为空，且不能超过 50 KB。');
    if(request.method!=='POST' && (!target || target.author?.login!==auth.login || !(request.method==='DELETE'?target.viewerCanDelete:target.viewerCanUpdate)))fail(403,'只能修改或删除自己的回复。');
  }else if(operation==='vote'){
    if(request.method!=='POST'||typeof body.enabled!=='boolean')fail(400,'点赞参数无效。');
    const subject=target||d;
    if(body.enabled && !subject.viewerCanUpvote)fail(403,'当前账号不能点赞。');
  }else if(operation==='answer'){
    if(request.method!=='POST'|| !target || typeof body.enabled!=='boolean' || !(body.enabled?target.viewerCanMarkAsAnswer:target.viewerCanUnmarkAsAnswer))fail(403,'当前账号不能修改答案状态。');
  }else fail(404,'接口不存在。');
  await limit(env,`comment:${auth.user_id}`,30,600);
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO submissions(user_id,request_id,fingerprint,expires_at) VALUES (?,?,?,?) RETURNING request_id').bind(auth.user_id,body.requestId,fingerprint,now()+86400).first();
  if(!inserted)fail(409,'操作正在处理中。');
  try{
    let result;
    if(operation==='comments'){
      if(request.method==='POST'){
        const data=await github(auth.token,`mutation($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{${commentFields}}}}`,{input:{discussionId:d.id,body:body.body.trim(),...(body.replyToId?{replyToId:body.replyToId}:{}),clientMutationId:body.requestId}});
        result={comment:publicComment(data.addDiscussionComment.comment,true)};
      }else if(request.method==='PUT'){
        const data=await github(auth.token,`mutation($input:UpdateDiscussionCommentInput!){updateDiscussionComment(input:$input){comment{${commentFields}}}}`,{input:{commentId:target.id,body:body.body.trim(),clientMutationId:body.requestId}});
        result={comment:publicComment(data.updateDiscussionComment.comment,true)};
      }else{
        await github(auth.token,'mutation($input:DeleteDiscussionCommentInput!){deleteDiscussionComment(input:$input){clientMutationId}}',{input:{id:target.id,clientMutationId:body.requestId}});result={deleted:target.id};
      }
    }else if(operation==='vote'){
      const mutation=body.enabled?'addUpvote':'removeUpvote',type=body.enabled?'AddUpvoteInput':'RemoveUpvoteInput';
      await github(auth.token,`mutation($input:${type}!){${mutation}(input:$input){clientMutationId}}`,{input:{subjectId:target?.id||d.id,clientMutationId:body.requestId}});result={enabled:body.enabled};
    }else{
      const mutation=body.enabled?'markDiscussionCommentAsAnswer':'unmarkDiscussionCommentAsAnswer',type=body.enabled?'MarkDiscussionCommentAsAnswerInput':'UnmarkDiscussionCommentAsAnswerInput';
      await github(auth.token,`mutation($input:${type}!){${mutation}(input:$input){clientMutationId}}`,{input:{id:target.id,clientMutationId:body.requestId}});result={enabled:body.enabled};
    }
    await env.DB.prepare('UPDATE submissions SET status=?,result_json=? WHERE user_id=? AND request_id=?').bind('done',JSON.stringify(result),auth.user_id,body.requestId).run();return result;
  }catch(e){if(e.status && e.status<500)await env.DB.prepare('DELETE FROM submissions WHERE user_id=? AND request_id=?').bind(auth.user_id,body.requestId).run();throw e;}
}
