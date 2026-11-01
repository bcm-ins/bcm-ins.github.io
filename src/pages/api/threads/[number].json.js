import data from '../../../data/community.json';
export function getStaticPaths(){return data.discussions.map(post=>({params:{number:String(post.number)},props:{post}}));}
export function GET({props}){return new Response(JSON.stringify({post:props.post,comments:props.post.thread||[],pageInfo:{hasNextPage:false,endCursor:null},generatedAt:data.generatedAt}),{headers:{'Content-Type':'application/json'}});}
