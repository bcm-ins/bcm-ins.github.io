import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap,placeholder,drawSelection,highlightActiveLine} from '@codemirror/view';
import {history,historyKeymap,defaultKeymap,undo,redo} from '@codemirror/commands';
import {markdown as markdownLanguage} from '@codemirror/lang-markdown';
import {syntaxHighlighting,defaultHighlightStyle} from '@codemirror/language';
import {markdown,el} from '../lib/dom.mjs';
import {readSession} from '../lib/auth-client.mjs';
import {prepareImage,sendImage,safeLink,markdownLabel} from '../lib/editor-images.mjs';

export function mountMarkdownEditor(textarea){
  const root=textarea.closest('[data-md-editor]');if(!root)return null;
  const $=s=>root.querySelector(s),preview=$('[data-md-preview]'),notice=$('[data-md-status]'),editable=new Compartment();
  let changing=false,uploading=false,viewMode='write',disabled=false;
  const limit=Number(textarea.getAttribute('maxlength'))||60000;
  function report(text,error=false){notice.hidden=!text;notice.textContent=text;notice.classList.toggle('error',error);}
  function repaint(){preview.replaceChildren(markdown(textarea.value||'*暂无内容*'));$('[data-md-count]').textContent=`${textarea.value.length.toLocaleString()} 字符`;}
  const view=new EditorView({parent:$('[data-md-code]'),state:EditorState.create({doc:textarea.value,extensions:[
    markdownLanguage(),syntaxHighlighting(defaultHighlightStyle),history(),drawSelection(),highlightActiveLine(),EditorView.lineWrapping,
    editable.of([EditorView.editable.of(true),EditorState.readOnly.of(false)]),placeholder(textarea.placeholder),
    EditorView.contentAttributes.of({'aria-label':textarea.id==='reply-body'?'回复内容':'Markdown 正文',spellcheck:'false'}),
    EditorState.changeFilter.of(tr=>{if(tr.newDoc.length>limit){report(`正文最多 ${limit.toLocaleString()} 字符。`,true);return false;}return true;}),
    keymap.of([{key:'Mod-b',run:()=>{format('bold');return true;}},{key:'Mod-i',run:()=>{format('italic');return true;}},...historyKeymap,...defaultKeymap]),
    EditorView.updateListener.of(update=>{if(update.docChanged&&!changing){textarea.value=update.state.doc.toString();textarea.dispatchEvent(new Event('input',{bubbles:true}));repaint();}}),
    EditorView.domEventHandlers({paste:event=>{const files=[...(event.clipboardData?.files||[])];if(files.length){event.preventDefault();upload(files);return true;}return false;},drop:(event,v)=>{const files=[...(event.dataTransfer?.files||[])];if(files.length){event.preventDefault();const pos=v.posAtCoords({x:event.clientX,y:event.clientY});if(pos!=null)v.dispatch({selection:{anchor:pos}});upload(files);return true;}return false;},dragover:event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();return true;}return false;}})
  ]})});
  textarea.hidden=true;textarea.required=false;
  // Existing draft/edit flows keep the textarea as their data source.
  function sync(){if(view.state.doc.toString()!==textarea.value){changing=true;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:textarea.value}});changing=false;}repaint();}
  function mode(value){viewMode=value;root.dataset.mode=value;$('[data-md-code]').parentElement.hidden=value==='preview';preview.hidden=value==='write';root.querySelectorAll('[data-md-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mdView===value)));repaint();}
  function insert(text,selectStart=0,selectLength=0){if(disabled)return;if(viewMode==='preview')mode('write');const {from,to}=view.state.selection.main;view.dispatch({changes:{from,to,insert:text},selection:{anchor:from+(selectLength?selectStart:text.length),head:from+(selectLength?selectStart+selectLength:text.length)},scrollIntoView:true});view.focus();}
  const formats={bold:['**','**','粗体文字'],italic:['*','*','斜体文字'],heading:['\n## ','\n','小节标题'],quote:['\n> ','\n','引用文字'],list:['\n- ','\n','列表内容'],code:['\n```text\n','\n```\n','代码或日志'],table:['\n| 项目 | 说明 |\n| --- | --- |\n| ',' | 内容 |\n','名称']};
  function format(name){const [before,after,fallback]=formats[name],{from,to}=view.state.selection.main,value=view.state.sliceDoc(from,to)||fallback;insert(before+value+after,before.length,value.length);}
  root.querySelectorAll('[data-md-format]').forEach(b=>b.addEventListener('click',()=>format(b.dataset.mdFormat)));
  root.querySelectorAll('[data-md-view]').forEach(b=>b.addEventListener('click',()=>mode(b.dataset.mdView)));
  $('[data-md-undo]').addEventListener('click',()=>{undo(view);view.focus();});$('[data-md-redo]').addEventListener('click',()=>{redo(view);view.focus();});
  function images(open){$('[data-md-image-panel]').hidden=!open;$('[data-md-images]').setAttribute('aria-expanded',String(open));}
  $('[data-md-images]').addEventListener('click',()=>images($('[data-md-image-panel]').hidden));$('[data-md-close-images]').addEventListener('click',()=>images(false));
  $('[data-md-link]').addEventListener('click',()=>{const {from,to}=view.state.selection.main;$('[data-md-link-text]').value=view.state.sliceDoc(from,to);$('[data-md-link-panel]').hidden=false;$('[data-md-link-url]').focus();});
  $('[data-md-close-link]').addEventListener('click',()=>{$('[data-md-link-panel]').hidden=true;});
  $('[data-md-insert-link]').addEventListener('click',()=>{try{insert(`[${markdownLabel($('[data-md-link-text]').value)||'链接'}](${safeLink($('[data-md-link-url]').value)})`);$('[data-md-link-panel]').hidden=true;}catch(e){$('[data-md-link-status]').textContent=e.message;}});
  $('[data-md-insert-image]').addEventListener('click',()=>{try{insert(`\n\n![${markdownLabel($('[data-md-image-alt]').value)||'图片'}](${safeLink($('[data-md-image-url]').value)})\n\n`);images(false);report('已插入图片链接。');}catch(e){report(e.message,true);}});
  $('[data-md-pick]').addEventListener('click',()=>{if(!readSession()){report('请先使用页面上的 GitHub 登录，再选择图片；文字草稿会保留。',true);return;}$('[data-md-files]').click();});
  $('[data-md-files]').addEventListener('change',e=>{upload([...e.target.files]);e.target.value='';});
  $('.md-upload-box').addEventListener('dragover',e=>{e.preventDefault();root.classList.add('is-dragging');});$('.md-upload-box').addEventListener('dragleave',()=>root.classList.remove('is-dragging'));$('.md-upload-box').addEventListener('drop',e=>{e.preventDefault();root.classList.remove('is-dragging');upload([...e.dataTransfer.files]);});
  async function upload(files){
    if(uploading||disabled)return;
    images(true);if(!readSession()){report('请先使用页面上的 GitHub 登录，再选择图片；文字草稿会保留。',true);return;}
    if(files.length>6){report('一次最多上传 6 张图片。',true);return;}
    uploading=true;view.dispatch({effects:editable.reconfigure([EditorView.editable.of(false),EditorState.readOnly.of(true)])});root.querySelectorAll('button,input').forEach(b=>b.disabled=true);root.dispatchEvent(new CustomEvent('md-upload-state',{bubbles:true,detail:{busy:true}}));
    try{for(let i=0;i<files.length;i++){const file=files[i];report(`正在处理图片 ${i+1}/${files.length}…`);try{
      const blob=await prepareImage(file);report(`正在上传 ${i+1}/${files.length} · ${Math.ceil(blob.size/1024)} KB…`);const result=await sendImage(blob),alt=markdownLabel(file.name.replace(/\.[^.]+$/,''))||'图片';
      insert(`\n\n![${alt}](${result.url})\n\n`);$('[data-md-upload-results]').append(el('div',{class:'md-upload-item'},el('img',{src:result.url,alt}),el('span',{},`${alt} · ${Math.ceil(result.size/1024)} KB`)));report(`${i+1} 张图片已上传并插入正文。`);
    }catch(e){report(`${file.name}：${e.name==='TimeoutError'?'上传超时，可重新选择；相同图片不会重复占用存储。':e.message}`,true);break;}}}
    finally{uploading=false;setDisabled(disabled);root.dispatchEvent(new CustomEvent('md-upload-state',{bubbles:true,detail:{busy:false}}));}
  }
  function setDisabled(value){disabled=!!value;view.dispatch({effects:editable.reconfigure([EditorView.editable.of(!disabled),EditorState.readOnly.of(disabled)])});root.querySelectorAll('button,input').forEach(b=>b.disabled=disabled);}
  repaint();
  return {sync,focus(){if(viewMode==='preview')mode('write');view.focus();},setDisabled,get uploading(){return uploading;},preview(){mode(viewMode==='preview'?'write':'preview');},destroy(){view.destroy();}};
}
