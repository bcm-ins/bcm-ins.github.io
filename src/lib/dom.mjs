import { marked } from 'marked';
import DOMPurify from 'dompurify';
export function el(tag,attrs={},...children){const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){if(value==null)continue;if(key==='class')node.className=value;else node.setAttribute(key,String(value));}for(const child of children.flat()){if(child!=null)node.append(typeof child==='string'?document.createTextNode(child):child);}return node;}
export function markdown(text){const node=el('div',{class:'prose'});if(!DOMPurify.isSupported){node.textContent=text||'';return node;}node.innerHTML=DOMPurify.sanitize(marked.parse(text||'',{gfm:true}),{USE_PROFILES:{html:true},FORBID_TAGS:['form','input','button','textarea','style','iframe','video','audio'],FORBID_ATTR:['style','srcset']});node.querySelectorAll('a').forEach(a=>{a.rel='nofollow ugc noopener noreferrer';});return node;}
export const profileHref=login=>`/u/?user=${encodeURIComponent(login)}`;
export const postHref=number=>`/post/?number=${Number(number)}`;
export function userLink(login){return /^[A-Za-z0-9-]{1,39}$/.test(login||'')?el('a',{href:profileHref(login),class:'user-link'},'@'+login):el('span',{},login||'已注销用户');}
export function date(value){return new Date(value).toLocaleString('zh-CN',{dateStyle:'medium',timeStyle:'short'});}
export function button(label,action,attrs={}){const b=el('button',{type:'button',class:'control',...attrs},label);b.addEventListener('click',action);return b;}
