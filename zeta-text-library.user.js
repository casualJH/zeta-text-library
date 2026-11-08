// ==UserScript==
// @name         제타 텍스트 보관함
// @namespace    zeta-text-library
// @version      0.0.3
// @updateURL    https://raw.githubusercontent.com/casualJH/zeta-text-library/main/zeta-text-library.user.js
// @downloadURL  https://raw.githubusercontent.com/casualJH/zeta-text-library/main/zeta-text-library.user.js
// @description  OOC·유저 프로필·세계관 등 텍스트를 공통 탭/폴더에 보관하고 복사·백업하는 도구
// @match        https://zeta-ai.io/*
// @match        https://*.zeta-ai.io/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('ztv-host')) return;

  const VERSION = '0.0.3';
  const DATA_KEY = 'zeta-text-vault-data-v1';
  const UI_KEY = 'zeta-text-vault-ui-v1';
  const uid = () => 'ztv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => { try { const x = GM_getValue(key, null); return x == null ? fallback : JSON.parse(x); } catch (_) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } } };
  const write = (key, value) => { const serialized = JSON.stringify(value); try { GM_setValue(key, serialized); } catch (_) { try { localStorage.setItem(key, serialized); } catch (e) { notify('데이터 저장에 실패했습니다. 저장 공간을 확인하세요.'); } } };
  const defaultData = () => ({ schema: 1, folders: [
    {id:'ooc',parentId:null,name:'OOC'},
    {id:'profile',parentId:null,name:'유저 프로필'},
    {id:'other',parentId:null,name:'기타'},
    {id:'ooc-summary',parentId:'ooc',name:'요약'},
    {id:'ooc-style',parentId:'ooc',name:'문체'}
  ], entries: [] });
  const defaultUi = () => ({ buttonText:'📚',buttonSize:48,buttonPos:null,panelPos:null,panelW:380,panelH:540,theme:'auto' });
  const safePos = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? {x:p.x,y:p.y} : null;
  const asNumber = (n, fallback, min, max) => Number.isFinite(+n) ? Math.max(min, Math.min(max, +n)) : fallback;
  const sanitizeText = (v, max) => String(v ?? '').slice(0,max);
  function normalizeData(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.folders) || !Array.isArray(value.entries)) throw Error('보관함 데이터 형식이 올바르지 않습니다.');
    if (value.folders.length > 2000 || value.entries.length > 20000) throw Error('가져올 데이터가 허용 크기를 초과했습니다.');
    const ids = new Set();
    const folders = [];
    for (const f of value.folders) {
      if (!f || typeof f !== 'object') continue;
      const id = sanitizeText(f.id,100);
      if (!id || ids.has(id)) continue;
      ids.add(id);
      folders.push({id,parentId:f.parentId == null ? null : sanitizeText(f.parentId,100),name:sanitizeText(f.name,100).trim() || '이름 없는 폴더'});
    }
    for (const f of folders) if (f.parentId && (f.parentId === f.id || !ids.has(f.parentId))) f.parentId=null;
    // This version supports two folder levels; fix unexpected deeper/circular ancestry on import.
    const map = new Map(folders.map(f=>[f.id,f]));
    for (const f of folders) if (f.parentId && map.get(f.parentId)?.parentId) f.parentId=null;
    const entryIds = new Set();
    const entries = [];
    for (const e of value.entries) {
      if (!e || typeof e !== 'object') continue;
      const id = sanitizeText(e.id,100);
      if (!id || entryIds.has(id)) continue;
      entryIds.add(id);
      const folderId = e.folderId == null ? null : sanitizeText(e.folderId,100);
      entries.push({id,folderId:ids.has(folderId)?folderId:null,title:sanitizeText(e.title,200),body:sanitizeText(e.body,200000),createdAt:sanitizeText(e.createdAt,50),updatedAt:sanitizeText(e.updatedAt,50)});
    }
    return {schema:1,folders,entries};
  }
  let data;
  try { data = normalizeData(read(DATA_KEY,defaultData())); } catch (_) { data=defaultData(); }
  // Preserve existing content while adding the new default tabs for existing installations.
  // Do not rename or delete user-created folders or their content.
  if (!data.folders.some(f=>f.id==='other' || (f.parentId===null && f.name==='기타'))) {
    const oldWorld=data.folders.find(f=>f.id==='world' && f.parentId===null && f.name==='세계관');
    if (oldWorld && !data.entries.some(e=>e.folderId==='world') && !data.folders.some(f=>f.parentId==='world')) {
      oldWorld.name='기타';
    } else {
      data.folders.push({id:'other',parentId:null,name:'기타'});
    }
  }
  if (data.folders.some(f=>f.id==='ooc')) {
    for (const [id,name] of [['ooc-summary','요약'],['ooc-style','문체']]) {
      if (!data.folders.some(f=>f.parentId==='ooc' && f.name===name)) {
        data.folders.push({id:data.folders.some(f=>f.id===id)?uid():id,parentId:'ooc',name});
      }
    }
  }
  write(DATA_KEY,data);
  const oldUi = read(UI_KEY, defaultUi());
  let ui = {...defaultUi(), ...(oldUi && typeof oldUi === 'object' ? oldUi : {})};
  ui.theme = ['light','dark','auto'].includes(ui.theme) ? ui.theme : 'auto';
  ui.buttonText = sanitizeText(ui.buttonText,32);
  ui.buttonSize = asNumber(ui.buttonSize,48,32,100);
  ui.panelW = asNumber(ui.panelW,380,260,1600);
  ui.panelH = asNumber(ui.panelH,540,240,1600);
  ui.buttonPos = safePos(ui.buttonPos);
  ui.panelPos = safePos(ui.panelPos);
  let category='all', sub='all', query='', selected=new Set(), showPanel=false, currentPage='main', editorId=null, editingFolderId=null, toastTimer=0;

  const host = document.createElement('div');
  host.id='ztv-host';
  host.style.cssText='position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
  document.documentElement.append(host);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host { all:initial; color-scheme:light; font-family: -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; font-size:14px; }
    * {box-sizing:border-box} button,input,textarea,select {font:inherit} button {cursor:pointer;touch-action:manipulation} button:disabled{opacity:.4;cursor:default}
    #launcher {position:fixed;right:16px;bottom:calc(24px + env(safe-area-inset-bottom));z-index:3;display:flex;align-items:center;justify-content:center;min-height:32px;min-width:32px;padding:5px 10px;background:#242633;color:#fff;border:1px solid #595d72;border-radius:999px;box-shadow:0 3px 14px #0004;pointer-events:auto;touch-action:none;white-space:nowrap;user-select:none;max-width:70vw;overflow:hidden}
    #panel {position:fixed;right:16px;bottom:calc(85px + env(safe-area-inset-bottom));z-index:2;width:380px;height:540px;max-width:calc(100vw - 12px);max-height:calc(100dvh - 14px);background:#fff;color:#242633;border:1px solid #c9cbd4;border-radius:14px;box-shadow:0 12px 45px #0005;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden}
    #panel[hidden] {display:none} #header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px;background:#f7f7fa;border-bottom:1px solid #e5e5ed;touch-action:none;user-select:none;cursor:move;flex-shrink:0}
    #header strong{font-size:14px} #header .controls{display:flex;gap:5px} #content{padding:12px;overflow:auto;overscroll-behavior:contain;flex:1;min-height:0} #footer {display:flex;gap:7px;padding:10px 12px;border-top:1px solid #e5e5ed;flex-shrink:0;flex-wrap:wrap;background:#fff}
    .btn{border:1px solid #d7d8e0;color:#303240;background:#fff;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;min-height:31px} .btn.primary{background:#35384a;color:#fff;border-color:#35384a} .btn.sm{padding:4px 7px;min-height:27px} .btn.danger{color:#ad3044} .btn.active{background:#33374b;color:#fff;border-color:#33374b} .btn:hover{filter:brightness(.96)}
    .tabs{display:flex;gap:5px;overflow-x:auto;scrollbar-width:thin;padding:2px 0 9px;flex-wrap:nowrap} .tabs .btn{flex:0 0 auto;white-space:nowrap} .muted{color:#777a87;font-size:12px} .headrow{display:flex;justify-content:space-between;align-items:center;gap:7px;margin:8px 0} .subline{border-top:1px solid #e9e9ee;padding-top:10px}
    .entry{border:1px solid #e0e1e8;border-radius:10px;padding:10px;margin:9px 0;background:#fff} .entry-title{display:flex;align-items:center;gap:7px;justify-content:space-between;font-weight:700;overflow-wrap:anywhere} .preview{font-size:12px;color:#565a67;white-space:pre-wrap;overflow-wrap:anywhere;max-height:90px;overflow:hidden;margin:8px 0} .actions{display:flex;gap:5px;justify-content:flex-start;align-items:center;flex-wrap:wrap} .actions .copy-main{background:#35384a;color:#fff;border-color:#35384a;font-weight:700;padding-left:12px;padding-right:12px} .actions .copy-main:hover{filter:brightness(1.12)} .actions .pick-label{margin-left:auto}
    input[type=text],input[type=search],textarea,select{width:100%;border:1px solid #cccfd8;border-radius:8px;padding:9px;background:#fff;color:#242633;min-width:0} textarea{resize:vertical;min-height:150px;line-height:1.5} #entry-body{resize:none;overflow-y:hidden;height:auto} label.field{display:block;margin:10px 0 5px;font-size:12px;font-weight:700} .row{display:flex;gap:7px;align-items:center} .row>*{min-width:0} .fill{flex:1} .box{background:#f7f7fa;border:1px solid #e7e7ee;padding:10px;border-radius:9px;margin:9px 0} .folder-row{display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid #ededf2} .folder-row .name{flex:1;overflow-wrap:anywhere} .folder-row.child{padding-left:15px} .empty{text-align:center;padding:25px 4px;color:#858894;font-size:12px}
    #grip{position:absolute;right:0;bottom:0;width:30px;height:30px;cursor:nwse-resize;touch-action:none;z-index:4;display:flex;align-items:flex-end;justify-content:flex-end;padding:5px;color:#7c8194;font-size:19px;line-height:1;user-select:none} #toast{position:absolute;bottom:47px;left:12px;right:12px;text-align:center;background:#303449;color:white;border-radius:8px;padding:8px;font-size:12px;pointer-events:none;display:none;z-index:6}
    .check{width:17px;height:17px;accent-color:#383d55;flex:none} .tiny{font-size:11px} .spacer{flex:1} .inline{display:flex;align-items:center;gap:5px;flex-wrap:wrap} .settingshint{line-height:1.6} .no-select{user-select:none}
    @media(max-width:420px){#content{padding:10px}#header{padding:10px} #footer{padding:9px} .entry{padding:9px}}
    :host([data-theme="dark"]) {color-scheme:dark}
    :host([data-theme="dark"]) #panel {background:#1c1e27;color:#f0f1f7;border-color:#505365}
    :host([data-theme="dark"]) #header {background:#252735;border-color:#434656}
    :host([data-theme="dark"]) #footer {background:#1c1e27;border-color:#434656}
    :host([data-theme="dark"]) .btn {background:#292c39;color:#eef0f8;border-color:#575b6d}
    :host([data-theme="dark"]) .btn.active,:host([data-theme="dark"]) .btn.primary {background:#747da4;color:#fff;border-color:#747da4}
    :host([data-theme="dark"]) .btn.danger {color:#ff9ba8}
    :host([data-theme="dark"]) .actions .copy-main {background:#747da4;color:#fff;border-color:#949dc5}
    :host([data-theme="dark"]) .entry {background:#242735;border-color:#4b5061}
    :host([data-theme="dark"]) .preview {color:#d0d3df}
    :host([data-theme="dark"]) .muted,:host([data-theme="dark"]) .empty {color:#aaafc3}
    :host([data-theme="dark"]) .box {background:#282b39;border-color:#454a5b}
    :host([data-theme="dark"]) .subline,:host([data-theme="dark"]) .folder-row {border-color:#454a5b}
    :host([data-theme="dark"]) input[type=text],:host([data-theme="dark"]) input[type=search],:host([data-theme="dark"]) input[type=file],:host([data-theme="dark"]) textarea,:host([data-theme="dark"]) select {background:#252838;color:#f1f2f8;border-color:#5c6175}
    :host([data-theme="dark"]) input::placeholder,:host([data-theme="dark"]) textarea::placeholder {color:#9da3b7}
    :host([data-theme="dark"]) #grip {color:#adb4cf}
    :host([data-theme="dark"]) .check {accent-color:#929ac3}
  </style>
  <button type="button" id="launcher" aria-label="제타 텍스트 보관함 열기"></button>
  <section id="panel" hidden aria-label="제타 텍스트 보관함">
    <div id="header"><strong>제타 텍스트 보관함</strong><div class="controls"><button class="btn sm" data-act="settings" aria-label="설정">⚙</button><button class="btn sm" data-act="close" aria-label="닫기">✕</button></div></div>
    <main id="content"></main><footer id="footer"></footer><div id="toast"></div><div id="grip" title="끌어서 창 크기 조절">◢</div>
  </section>`;
  const $ = s => root.querySelector(s);
  const launcher=$('#launcher'), panel=$('#panel'), content=$('#content'), footer=$('#footer');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)');
  function applyTheme(){ const dark=ui.theme==='dark' || (ui.theme==='auto' && !!prefersDark?.matches);host.dataset.theme=dark?'dark':'light'; }
  prefersDark?.addEventListener?.('change',()=>{if(ui.theme==='auto')applyTheme();});
  const persist = () => write(DATA_KEY,data);
  const persistUi = () => write(UI_KEY,ui);
  const folders = parent => data.folders.filter(f=>f.parentId===parent);
  const folderById = id => data.folders.find(f=>f.id===id);
  const rootOf = id => {const f=folderById(id);return f?(f.parentId||f.id):null;};
  const descendants = id => new Set([id,...folders(id).map(f=>f.id)]);
  function notify(message) { const t=$('#toast');if(!t)return; t.textContent=message;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display='none',2300); }
  const clamp = (x,min,max) => Math.max(min, Math.min(x, Math.max(min,max)));
  function setPosition(element,pos) {
    if (!pos){element.style.left='';element.style.top='';element.style.right='';element.style.bottom='';return;}
    const w=element.offsetWidth||48,h=element.offsetHeight||48;
    const x=clamp(pos.x,4,innerWidth-w-4),y=clamp(pos.y,4,innerHeight-h-4);
    element.style.left=x+'px';element.style.top=y+'px';element.style.right='auto';element.style.bottom='auto';
    pos.x=x;pos.y=y;
  }
  function applyUi() {
    applyTheme();
    launcher.textContent=ui.buttonText || '📚';
    launcher.style.fontSize=Math.round(ui.buttonSize*.38)+'px';
    launcher.style.minHeight=ui.buttonSize+'px';
    launcher.style.minWidth=ui.buttonSize+'px';
    panel.style.width=Math.min(ui.panelW, Math.max(260,innerWidth-12))+'px';
    panel.style.height=Math.min(ui.panelH, Math.max(240,innerHeight-14))+'px';
    setPosition(launcher,ui.buttonPos);
    if(showPanel) setPosition(panel,ui.panelPos);
  }
  function entryVisible(e) {
    const q=query.trim().toLowerCase();
    if(q && !(e.title+'\n'+e.body).toLowerCase().includes(q))return false;
    if(category==='all')return true;
    if(category==='uncategorized')return !e.folderId || !folderById(e.folderId);
    if(rootOf(e.folderId)!==category)return false;
    return sub==='all' || e.folderId===sub;
  }
  function renderTabs(){
    const mainTabs=[{id:'all',name:'전체'},...folders(null),{id:'uncategorized',name:'미분류'}];
    return `<div class="tabs">${mainTabs.map(f=>`<button class="btn sm ${category===f.id?'active':''}" data-act="cat" data-id="${esc(f.id)}">${esc(f.name)}</button>`).join('')}<button class="btn sm" data-act="newfolder" data-parent="">＋ 폴더</button></div>`;
  }
  function renderSub(){
    if(category==='all'||category==='uncategorized')return '';
    const children=folders(category);
    return `<div class="subline"><div class="tabs"><button class="btn sm ${sub==='all'?'active':''}" data-act="sub" data-id="all">전체</button>${children.map(f=>`<button class="btn sm ${sub===f.id?'active':''}" data-act="sub" data-id="${esc(f.id)}">${esc(f.name)}</button>`).join('')}<button class="btn sm" data-act="newfolder" data-parent="${esc(category)}">＋ 하위 폴더</button></div></div>`;
  }
  function card(e){
    const path=e.folderId ? [folderById(rootOf(e.folderId))?.name,folderById(e.folderId)?.parentId?folderById(e.folderId)?.name:null].filter(Boolean).join(' / ') : '미분류';
    return `<article class="entry"><div class="entry-title"><span>${esc(e.title||'제목 없음')}</span><span class="muted">${esc(path)}</span></div><div class="preview">${esc(e.body)}</div><div class="actions"><button class="btn sm copy-main" data-act="copy" data-id="${esc(e.id)}">복사</button><button class="btn sm" data-act="edit" data-id="${esc(e.id)}">수정</button><button class="btn sm" data-act="moveentry" data-id="${esc(e.id)}" data-step="-1" title="항목 위로">↑</button><button class="btn sm" data-act="moveentry" data-id="${esc(e.id)}" data-step="1" title="항목 아래로">↓</button><label class="row tiny pick-label" title="여러 항목 선택"><input class="check" type="checkbox" data-pick="${esc(e.id)}" ${selected.has(e.id)?'checked':''}>선택</label></div></article>`;
  }
  function renderMain(){
    const visible=data.entries.filter(entryVisible);
    content.innerHTML=`${renderTabs()}${renderSub()}<div class="headrow"><span class="muted">${visible.length}개 항목</span><button class="btn sm" data-act="folders">폴더 관리</button></div><input type="search" id="search" placeholder="제목 또는 본문 검색" value="${esc(query)}" aria-label="텍스트 검색"><div id="results">${visible.length?visible.map(card).join(''):'<div class="empty">저장된 텍스트가 없습니다.</div>'}</div>`;
    footer.innerHTML=`<button class="btn primary" data-act="newentry">＋ 새 텍스트</button><button class="btn" data-act="copyselected" ${selected.size?'':'disabled'}>선택 복사 (${selected.size})</button><button class="btn" data-act="backup">백업</button>`;
  }
  function optionsHtml(selectedId){
    return `<option value="" ${!selectedId?'selected':''}>미분류</option>`+folders(null).map(f=>`<option value="${esc(f.id)}" ${selectedId===f.id?'selected':''}>${esc(f.name)}</option>`+folders(f.id).map(c=>`<option value="${esc(c.id)}" ${selectedId===c.id?'selected':''}>　↳ ${esc(c.name)}</option>`).join('')).join('');
  }
  function resizeEditorBody(){
    const field=$('#entry-body');
    if(!field)return;
    field.style.height='auto';
    field.style.height=Math.max(150,field.scrollHeight+2)+'px';
  }
  function renderEditor(){
    const entry=editorId?data.entries.find(e=>e.id===editorId):null;
    const initialFolder=entry?.folderId || (category==='all'||category==='uncategorized'?null:(sub==='all'?category:sub));
    content.innerHTML=`<h3>${entry?'텍스트 수정':'새 텍스트 저장'}</h3><label class="field" for="entry-title">제목</label><input id="entry-title" type="text" maxlength="200" value="${esc(entry?.title||'')}" placeholder="제목을 입력하세요"><label class="field" for="entry-folder">저장 폴더</label><select id="entry-folder">${optionsHtml(initialFolder)}</select><label class="field" for="entry-body">본문</label><textarea id="entry-body" maxlength="200000" placeholder="OOC, 프로필, 세계관 등 원하는 텍스트">${esc(entry?.body||'')}</textarea><div class="muted">저장된 내용은 모든 제타 채팅방에서 공통으로 사용할 수 있습니다.</div>`;
    resizeEditorBody();
    footer.innerHTML=`<button class="btn primary" data-act="saveentry">저장</button><button class="btn" data-act="main">취소</button>${entry?`<button class="btn danger" data-act="delete" data-id="${esc(entry.id)}" style="margin-left:auto">삭제</button>`:''}`;
  }
  function renderFolders(){
    content.innerHTML=`<h3>폴더 관리</h3><div class="muted settingshint">폴더 이름 변경·순서 이동·삭제가 가능합니다. 폴더 삭제 시 보관한 텍스트는 미분류로 이동합니다.</div>${data.folders.length?folders(null).map(f=>folderRow(f)+folders(f.id).map(child=>folderRow(child)).join('')).join(''):'<div class="empty">폴더가 없습니다.</div>'}<div class="box"><strong>폴더 추가</strong><label class="field">상위 폴더</label><select id="folder-parent"><option value="">대분류 (최상위)</option>${folders(null).map(f=>`<option value="${esc(f.id)}" ${category===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select><label class="field">새 폴더 이름</label><input id="folder-name" type="text" maxlength="100" placeholder="폴더 이름"><button class="btn primary" style="margin-top:8px" data-act="addfolder">추가</button></div>`;
    footer.innerHTML=`<button class="btn" data-act="main">← 보관함으로</button>`;
  }
  function folderRow(f){const siblings=folders(f.parentId);const i=siblings.findIndex(x=>x.id===f.id);return `<div class="folder-row ${f.parentId?'child':''}"><span class="name">${f.parentId?'↳ ':''}${esc(f.name)}</span><button class="btn sm" data-act="movefolder" data-id="${esc(f.id)}" data-step="-1" ${i===0?'disabled':''}>↑</button><button class="btn sm" data-act="movefolder" data-id="${esc(f.id)}" data-step="1" ${i===siblings.length-1?'disabled':''}>↓</button><button class="btn sm" data-act="renamefolder" data-id="${esc(f.id)}">수정</button><button class="btn sm danger" data-act="deletefolder" data-id="${esc(f.id)}">삭제</button></div>`;}
  function renderFolderEdit(){
    const f=folderById(editingFolderId);
    if(!f){currentPage='folders';render();return;}
    content.innerHTML=`<h3>폴더 이름 변경</h3><label class="field">폴더 이름</label><input id="rename-name" type="text" maxlength="100" value="${esc(f.name)}">`;
    footer.innerHTML=`<button class="btn primary" data-act="saverename">저장</button><button class="btn" data-act="folders">취소</button>`;
  }
  function renderSettings(){
    content.innerHTML=`<h3>창 및 실행 버튼 설정</h3><label class="field" for="theme-select">화면 테마</label><select id="theme-select"><option value="auto" ${ui.theme==='auto'?'selected':''}>기기 설정에 따르기</option><option value="light" ${ui.theme==='light'?'selected':''}>라이트 모드</option><option value="dark" ${ui.theme==='dark'?'selected':''}>다크 모드</option></select><div class="box settingshint">창 상단을 끌어 위치를 이동하고, 오른쪽 아래 ◢ 모서리를 끌어 창 크기를 조절합니다. 실행 버튼 자체를 끌어서 위치를 옮길 수 있습니다.</div><label class="field">실행 버튼 글자 / 이모지 (직접 입력)</label><input id="button-text" maxlength="32" type="text" value="${esc(ui.buttonText)}" placeholder="📚 또는 OOC, 보관함"><label class="field" for="button-size">실행 버튼 크기: <span id="button-size-value">${ui.buttonSize}px</span></label><input id="button-size" type="range" min="32" max="100" step="2" value="${ui.buttonSize}"><div class="box"><div class="muted">현재 창 크기: <span id="panel-dimensions">${Math.round(ui.panelW)} × ${Math.round(ui.panelH)}px</span></div><div class="muted">창 내부의 내용이 길면 내부만 스크롤됩니다.</div></div><div class="box settingshint"><strong>초기화</strong><div class="muted">UI 초기화는 버튼 글자·크기, 창 크기·위치, 테마를 기본값으로 되돌리고 저장된 폴더와 텍스트는 유지합니다.</div><button class="btn" style="margin-top:8px" data-act="resetui">UI 설정 초기화</button></div><div class="box settingshint"><strong>보관함 전체 초기화</strong><div class="muted">저장한 모든 텍스트와 사용자 폴더를 삭제하고 기본 폴더( OOC / 유저 프로필 / 기타 및 OOC의 요약 / 문체 )로 복원합니다. 창·버튼 설정은 그대로 유지됩니다. 실행 전 JSON 백업을 권장합니다.</div><button class="btn danger" style="margin-top:8px" data-act="resetlibrary">보관함 전체 초기화</button></div>`;
    footer.innerHTML=`<button class="btn primary" data-act="savesettings">설정 저장</button><button class="btn" data-act="main">돌아가기</button>`;
  }
  function renderBackup(){
    content.innerHTML=`<h3>백업 및 복원</h3><div class="box settingshint">폴더, 텍스트 및 창·버튼 설정을 하나의 JSON 파일로 백업합니다. 파일은 직접 보관해야 합니다.</div><button class="btn primary" data-act="export">JSON 전체 백업 다운로드</button><hr style="border:0;border-top:1px solid #e5e5ed;margin:16px 0"><h3>JSON 가져오기</h3><label class="field">백업 파일 선택</label><input id="import-file" type="file" accept=".json,application/json"><label class="field">복원 방식</label><label class="row" style="margin:10px 0"><input type="radio" name="import-mode" value="merge" checked> 기존 데이터에 합치기</label><label class="row" style="margin:10px 0"><input type="radio" name="import-mode" value="replace"> 기존 데이터를 모두 바꾸기</label><div class="muted">합치기는 동일한 ID의 항목을 중복 추가하지 않습니다. 바꾸기는 기존 보관 내용을 교체하므로 주의하세요.</div>`;
    footer.innerHTML=`<button class="btn primary" data-act="import">가져오기</button><button class="btn" data-act="main">돌아가기</button>`;
  }
  function render(){ if(!showPanel)return; switch(currentPage){case 'editor':renderEditor();break;case 'folders':renderFolders();break;case 'folderedit':renderFolderEdit();break;case 'settings':renderSettings();break;case 'backup':renderBackup();break;default:renderMain();} }
  function go(page){currentPage=page;render();content.scrollTop=0;}
  function downloadJson(){
    const backup={format:'zeta-text-vault',version:VERSION,exportedAt:new Date().toISOString(),data,ui};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='zeta-text-library-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);notify('백업 파일 다운로드를 요청했습니다.');
  }
  async function importJson(){
    const file=$('#import-file')?.files?.[0]; if(!file){notify('JSON 파일을 선택하세요.');return;}
    if(file.size>40*1024*1024){notify('40MB 이하의 백업 파일을 선택하세요.');return;}
    const mode=root.querySelector('input[name="import-mode"]:checked')?.value||'merge';
    let parsed,incoming;
    try {parsed=JSON.parse(await file.text());if(parsed?.format!=='zeta-text-vault')throw Error('제타 텍스트 보관함 백업이 아닙니다.');incoming=normalizeData(parsed.data);}catch(e){notify('가져오기 실패: '+(e.message||'형식 오류'));return;}
    if(!confirm(mode==='replace'?'기존 폴더와 텍스트를 모두 백업 내용으로 교체할까요?':'백업 항목을 기존 보관함에 합칠까요?'))return;
    if(mode==='replace') {data=incoming;if(parsed.ui&&typeof parsed.ui==='object'){ui={...defaultUi(),...parsed.ui};ui.buttonPos=safePos(ui.buttonPos);ui.panelPos=safePos(ui.panelPos);ui.buttonText=sanitizeText(ui.buttonText,32);ui.buttonSize=asNumber(ui.buttonSize,48,32,100);ui.panelW=asNumber(ui.panelW,380,260,1600);ui.panelH=asNumber(ui.panelH,540,240,1600);ui.theme=['light','dark','auto'].includes(ui.theme)?ui.theme:'auto';persistUi();}}
    else {
      const existingFolders=new Set(data.folders.map(f=>f.id));
      const remap=new Map();
      for(const f of incoming.folders){const id=existingFolders.has(f.id)?uid():f.id;remap.set(f.id,id);existingFolders.add(id);}
      for(const f of incoming.folders) data.folders.push({...f,id:remap.get(f.id),parentId:f.parentId?(remap.get(f.parentId)||null):null});
      const existingEntries=new Set(data.entries.map(e=>e.id));
      for(const e of incoming.entries){const id=existingEntries.has(e.id)?uid():e.id;existingEntries.add(id);data.entries.push({...e,id,folderId:e.folderId?(remap.get(e.folderId)||null):null});}
    }
    persist();selected.clear();category='all';sub='all';query='';applyUi();go('main');notify('백업을 가져왔습니다.');
  }
  async function copyText(value){
    let ok=false;
    try {if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);ok=true;}}catch(_){}
    if(!ok){
      const area=document.createElement('textarea');area.value=value;area.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';document.body.append(area);area.focus();area.select();try{ok=document.execCommand('copy');}catch(_){}area.remove();
    }
    notify(ok?'클립보드에 복사했습니다.':'자동 복사 실패: Safari 클립보드 권한을 확인하세요.');
  }
  function removeFolder(id){const ids=descendants(id);if(!confirm('폴더를 삭제할까요? 내부 텍스트는 미분류로 이동합니다.'))return;data.entries.forEach(e=>{if(ids.has(e.folderId))e.folderId=null;});data.folders=data.folders.filter(f=>!ids.has(f.id));selected.clear();if(ids.has(category)){category='all';sub='all';}if(ids.has(sub))sub='all';persist();render();}
  function moveEntry(id,step){
    const e=data.entries.find(x=>x.id===id);if(!e)return;
    const visible=data.entries.filter(entryVisible);
    const index=visible.findIndex(x=>x.id===id),neighbor=visible[index+step];
    if(!neighbor)return;
    const a=data.entries.indexOf(e),b=data.entries.indexOf(neighbor);
    [data.entries[a],data.entries[b]]=[data.entries[b],data.entries[a]];
    persist();render();
  }
  function moveFolder(id,step){const f=folderById(id);if(!f)return;const siblings=folders(f.parentId);const i=siblings.findIndex(x=>x.id===id),neighbor=siblings[i+step];if(!neighbor)return;const a=data.folders.indexOf(f),b=data.folders.indexOf(neighbor);[data.folders[a],data.folders[b]]=[data.folders[b],data.folders[a]];persist();render();}
  function handleAction(act,id,el){
    switch(act){
      case 'close':showPanel=false;panel.hidden=true;return;
      case 'main':go('main');return;
      case 'settings':go('settings');return;
      case 'folders':go('folders');return;
      case 'backup':go('backup');return;
      case 'cat':category=id;sub='all';selected.clear();render();return;
      case 'sub':sub=id;selected.clear();render();return;
      case 'newfolder':go('folders');if(el.dataset.parent!==undefined){const s=$('#folder-parent');if(s)s.value=el.dataset.parent||'';}return;
      case 'addfolder':{const parent=$('#folder-parent')?.value||null,name=$('#folder-name')?.value.trim();if(!name){notify('폴더 이름을 입력하세요.');return;}if(data.folders.some(f=>f.parentId===parent&&f.name===name)){notify('같은 이름의 폴더가 이미 있습니다.');return;}data.folders.push({id:uid(),parentId:parent,name});persist();render();notify('폴더를 추가했습니다.');return;}
      case 'renamefolder':editingFolderId=id;go('folderedit');return;
      case 'saverename':{const f=folderById(editingFolderId),name=$('#rename-name')?.value.trim();if(!f||!name){notify('폴더 이름을 입력하세요.');return;}if(data.folders.some(x=>x.id!==f.id&&x.parentId===f.parentId&&x.name===name)){notify('같은 이름의 폴더가 있습니다.');return;}f.name=name;persist();go('folders');return;}
      case 'deletefolder':removeFolder(id);return;
      case 'movefolder':moveFolder(id,+el.dataset.step);return;
      case 'moveentry':moveEntry(id,+el.dataset.step);return;
      case 'newentry':editorId=null;go('editor');return;
      case 'edit':editorId=id;go('editor');return;
      case 'saveentry':{
        const title=$('#entry-title')?.value.trim(),body=$('#entry-body')?.value??'',folderId=$('#entry-folder')?.value||null;
        if(!title){notify('제목을 입력하세요.');return;}
        if(!body.trim()){notify('본문을 입력하세요.');return;}
        const now=new Date().toISOString();
        if(editorId){const e=data.entries.find(x=>x.id===editorId);if(!e)return;Object.assign(e,{title,body,folderId,updatedAt:now});}
        else data.entries.push({id:uid(),title,body,folderId,createdAt:now,updatedAt:now});
        persist();go('main');notify('저장했습니다.');return;
      }
      case 'delete':{if(currentPage!=='editor'||editorId!==id)return;const e=data.entries.find(x=>x.id===id);if(!e||!confirm('"'+e.title+'" 항목을 삭제할까요?'))return;data.entries=data.entries.filter(x=>x.id!==id);selected.delete(id);editorId=null;persist();go('main');return;}
      case 'copy':{const e=data.entries.find(x=>x.id===id);if(e)void copyText(e.body);return;}
      case 'copyselected':{const values=data.entries.filter(e=>selected.has(e.id)).map(e=>e.body);if(values.length)void copyText(values.join('\n\n'));return;}
      case 'export':downloadJson();return;
      case 'import':void importJson();return;
      case 'savesettings':ui.theme=['light','dark','auto'].includes($('#theme-select')?.value)?$('#theme-select').value:'auto';ui.buttonText=sanitizeText($('#button-text')?.value||'📚',32);ui.buttonSize=asNumber($('#button-size')?.value,48,32,100);persistUi();applyUi();go('main');notify('설정을 저장했습니다.');return;
      case 'resetui':{
        if(!confirm('UI 설정을 초기화할까요?\n버튼 글자·크기, 창 위치·크기 및 테마가 기본값으로 돌아갑니다.\n저장된 폴더와 텍스트는 그대로 유지됩니다.'))return;
        ui=defaultUi();persistUi();applyUi();render();notify('UI 설정을 초기화했습니다.');return;
      }
      case 'resetlibrary':{
        if(!confirm('보관함 전체를 초기화할까요?\n모든 저장 텍스트와 사용자 폴더가 삭제되며 기본 폴더만 복원됩니다.\n복구하려면 미리 JSON 백업을 해야 합니다.'))return;
        if(!confirm('마지막 확인입니다. 정말 모든 보관함 데이터와 폴더를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.'))return;
        data=defaultData();category='all';sub='all';query='';selected.clear();editorId=null;editingFolderId=null;
        persist();go('main');notify('보관함을 기본 상태로 초기화했습니다.');return;
      }
    }
  }
  root.addEventListener('click', event=>{
    const b=event.target.closest('[data-act]');if(!b||b.disabled)return;
    handleAction(b.dataset.act,b.dataset.id,b);
  });
  root.addEventListener('change',event=>{
    const t=event.target;
    if(t.matches('[data-pick]')){t.checked?selected.add(t.dataset.pick):selected.delete(t.dataset.pick);const button=footer.querySelector('[data-act="copyselected"]');if(button){button.disabled=!selected.size;button.textContent=`선택 복사 (${selected.size})`;}}
  });
  root.addEventListener('input',event=>{
    const t=event.target;
    if(t.id==='entry-body'){resizeEditorBody();return;}
    if(t.id==='search'){query=t.value;const items=data.entries.filter(entryVisible);$('#results').innerHTML=items.length?items.map(card).join(''):'<div class="empty">검색 결과가 없습니다.</div>';return;}
    if(t.id==='theme-select'){ui.theme=t.value;applyTheme();persistUi();return;}
    if(t.id==='button-size'){$('#button-size-value').textContent=t.value+'px';ui.buttonSize=asNumber(t.value,48,32,100);applyUi();return;}
    if(t.id==='button-text'){ui.buttonText=sanitizeText(t.value,32);applyUi();}
  });
  const pointerDrag = (handle,target,type) => {
    let suppressClick=false;
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==undefined&&event.button!==0)return;
      if(type==='panel'&&event.target.closest('button,input,select,textarea'))return;
      const rect=target.getBoundingClientRect(),startX=event.clientX,startY=event.clientY;
      let moving=false;const pointerId=event.pointerId;
      const move=e=>{
        if(e.pointerId!==pointerId)return;
        const dx=e.clientX-startX,dy=e.clientY-startY;
        if(!moving&&Math.hypot(dx,dy)<5)return;
        moving=true;e.preventDefault();
        if(type==='resize'){
          const maxW=Math.max(260,innerWidth-rect.left-4),maxH=Math.max(240,innerHeight-rect.top-4);
          ui.panelW=clamp(rect.width+dx,260,maxW);ui.panelH=clamp(rect.height+dy,240,maxH);
          panel.style.width=ui.panelW+'px';panel.style.height=ui.panelH+'px';
          const dims=$('#panel-dimensions');if(dims)dims.textContent=Math.round(ui.panelW)+' × '+Math.round(ui.panelH)+'px';
        }else{
          const p={x:clamp(rect.left+dx,4,innerWidth-rect.width-4),y:clamp(rect.top+dy,4,innerHeight-rect.height-4)};
          target.style.left=p.x+'px';target.style.top=p.y+'px';target.style.right='auto';target.style.bottom='auto';
          if(type==='button')ui.buttonPos=p;else ui.panelPos=p;
        }
      };
      const end=e=>{if(e.pointerId!==pointerId)return;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);if(moving){persistUi();if(type==='button'){suppressClick=true;setTimeout(()=>{suppressClick=false;},350);}}};
      window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
    });
    if(type==='button')handle.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();return;}showPanel=!showPanel;panel.hidden=!showPanel;if(showPanel){applyUi();render();}});
  };
  pointerDrag(launcher,launcher,'button');
  pointerDrag($('#header'),panel,'panel');
  pointerDrag($('#grip'),panel,'resize');
  window.addEventListener('resize',()=>{applyUi();persistUi();});
  applyUi();
})();