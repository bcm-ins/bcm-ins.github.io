import data from '../../data/community.json';
export function GET(){
  const users=new Map(),replies=[];
  function add(login,avatar){if(/^[A-Za-z0-9-]{1,39}$/.test(login))users.set(login,{login,avatarUrl:avatar||''});}
  const posts=data.discussions.map(p=>{
    add(p.author,p.avatar);
    for(const c of p.thread||[]){for(const r of [c,...c.replies]){add(r.author,r.avatar);if(!r.isMinimized)replies.push({id:r.id,number:p.number,title:p.title,author:r.author,body:r.body.slice(0,500),createdAt:r.createdAt});}}
    return {number:p.number,title:p.title,excerpt:p.excerpt,author:p.author,updatedAt:p.updatedAt,type:p.type,comments:p.comments};
  });
  return new Response(JSON.stringify({generatedAt:data.generatedAt,users:[...users.values()],posts,replies}),{headers:{'Content-Type':'application/json'}});
}
