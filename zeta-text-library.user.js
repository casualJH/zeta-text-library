// ==UserScript==
// @name         제타 텍스트 보관함
// @namespace    zeta-text-library
// @version      0.1.6
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

  const VERSION = '0.1.6';
  const DATA_KEY = 'zeta-text-vault-data-v1';
  const UI_KEY = 'zeta-text-vault-ui-v1';
  const uid = () => 'ztv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => { try { const x = GM_getValue(key, null); return x == null ? fallback : JSON.parse(x); } catch (_) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } } };
  const write = (key, value) => { const serialized = JSON.stringify(value); try { GM_setValue(key, serialized); } catch (_) { try { localStorage.setItem(key, serialized); } catch (e) { notify('데이터 저장에 실패했습니다. 저장 공간을 확인하세요.'); } } };
  const defaultData = () => ({ schema: 1, folders: [
    {id:'ooc',parentId:null,name:'OOC'},
    {id:'profile',parentId:null,name:'유저 프로필'},
    {id:'ooc-summary',parentId:'ooc',name:'요약'},
    {id:'ooc-style',parentId:'ooc',name:'문체'}
  ], entries: [], orders: {} });
  const defaultUi = () => ({ buttonText:'📚',buttonSize:48,buttonPos:null,panelPos:null,panelW:380,panelH:540,theme:'auto',allSortMode:'folder',sortModes:{},sortBases:{} });
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
    const validEntryIds=new Set(entries.map(e=>e.id));
    const orders={};
    if(value.orders && typeof value.orders==='object' && !Array.isArray(value.orders)){
      for(const [key,ids] of Object.entries(value.orders).slice(0,4005)){
        if(typeof key!=='string'||key.length>140||!Array.isArray(ids))continue;
        const unique=new Set();
        orders[key]=ids.filter(id=>typeof id==='string'&&validEntryIds.has(id)&&!unique.has(id)&&unique.add(id)).slice(0,20000);
      }
    }
    // Old backups without orders keep their existing entries array as the initial order.
    return {schema:1,folders,entries,orders};
  }
  let data;
  try { data = normalizeData(read(DATA_KEY,defaultData())); } catch (_) { data=defaultData(); }
  // v0.0.4: Remove the former built-in 기타 tab without deleting saved text.
  // User-created folders named 기타 have separate IDs and are preserved.
  const obsoleteDefaultIds = new Set(data.folders
    .filter(f => (f.id === 'other' || (f.id === 'world' && f.name === '기타')) && f.parentId === null)
    .map(f => f.id));
  if (obsoleteDefaultIds.size) {
    data.entries.forEach(e => { if (obsoleteDefaultIds.has(e.folderId)) e.folderId = null; });
    data.folders.forEach(f => { if (obsoleteDefaultIds.has(f.parentId)) f.parentId = null; });
    data.folders = data.folders.filter(f => !obsoleteDefaultIds.has(f.id));
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
  ui.allSortMode = ui.allSortMode==='folder'?'folder':'user';
  ui.sortModes = ui.sortModes && typeof ui.sortModes==='object' && !Array.isArray(ui.sortModes)?ui.sortModes:{};
  ui.sortBases = ui.sortBases && typeof ui.sortBases==='object' && !Array.isArray(ui.sortBases)?ui.sortBases:{};
  if(!['folderAsc','folderDesc','createdAsc','createdDesc','user'].includes(ui.sortModes.all))
    ui.sortModes.all='folderAsc';
  ui.buttonText = sanitizeText(ui.buttonText,32);
  ui.buttonSize = asNumber(ui.buttonSize,48,32,100);
  ui.panelW = asNumber(ui.panelW,380,260,1600);
  ui.panelH = asNumber(ui.panelH,540,240,1600);
  ui.buttonPos = safePos(ui.buttonPos);
  ui.panelPos = safePos(ui.panelPos);
  let category='all', sub='all', query='', selected=new Set(), selectionMode=false, showPanel=false, currentPage='main', editorId=null, editingFolderId=null, sortSettingsScope=null, toastTimer=0;

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
    .entry{border:1px solid #e0e1e8;border-radius:10px;padding:10px;margin:9px 0;background:#fff} .entry-title{display:flex;align-items:center;gap:7px;justify-content:space-between;font-weight:700;overflow-wrap:anywhere} .preview{font-size:12px;color:#565a67;white-space:pre-wrap;overflow-wrap:anywhere;max-height:90px;overflow:hidden;margin:8px 0} .actions{display:flex;gap:5px;justify-content:flex-start;align-items:center;flex-wrap:wrap} .actions .copy-main{background:#35384a;color:#fff;border-color:#35384a;font-weight:700;padding-left:12px;padding-right:12px} .actions .copy-main:hover{filter:brightness(1.12)} .actions .action-spacer{flex:1 1 6px;min-width:0} .actions .pick-label{margin-left:0} .actions .drag-handle{touch-action:none;cursor:grab;user-select:none;font-weight:800;padding:5px 10px} .actions .drag-handle:active{cursor:grabbing} .entry.drag-source{opacity:.5} .entry.drop-before{box-shadow:inset 0 3px 0 #8496d6} .entry.drop-after{box-shadow:inset 0 -3px 0 #8496d6} .entry.drag-group{outline:1px solid #8496d6} .sort-mode{display:flex;gap:5px;margin:10px 0 4px;flex-wrap:wrap} .group-heading{font-weight:700;font-size:12px;padding:9px 5px 4px;border-bottom:1px solid #ddd} .sort-mode{align-items:center} .sort-mode select{flex:1;min-width:145px;width:auto} .sort-label{font-weight:700;font-size:12px} .actions .pick-label[hidden]{display:none!important}
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
    <div id="header"><strong>제타 텍스트 보관함</strong><div class="controls"><button class="btn sm" type="button" data-act="toggletheme" id="theme-toggle" aria-label="테마 전환" title="라이트/다크 모드 전환">☾</button><button class="btn sm" data-act="settings" aria-label="설정">⚙</button><button class="btn sm" data-act="close" aria-label="닫기">✕</button></div></div>
    <main id="content"></main><footer id="footer"></footer><div id="toast"></div><div id="grip" title="끌어서 창 크기 조절">◢</div>
  </section>`;
  const $ = s => root.querySelector(s);
  const launcher=$('#launcher'), panel=$('#panel'), content=$('#content'), footer=$('#footer');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)');
  function applyTheme(){ const dark=ui.theme==='dark' || (ui.theme==='auto' && !!prefersDark?.matches);host.dataset.theme=dark?'dark':'light';const toggle=$('#theme-toggle');if(toggle){toggle.textContent=dark?'☀':'☾';toggle.setAttribute('aria-label',dark?'라이트 모드로 변경':'다크 모드로 변경');toggle.title=dark?'라이트 모드로 변경':'다크 모드로 변경';} }
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
  // Every scope has its own custom ordering; sorting by folder or registration
  // never changes another scope's order.
  const scopeKey=()=>category==='all'?'all':category==='uncategorized'?'uncategorized':sub==='all'?'folder:'+category:'folder:'+sub;
  const canChooseSort=()=>category==='all'||(category!=='uncategorized'&&sub==='all');
  const isValidSort=x=>['folderAsc','folderDesc','createdAsc','createdDesc','user'].includes(x);
  function sortModeFor(scope){return isValidSort(ui.sortModes?.[scope])?ui.sortModes[scope]:(scope==='all'||(scope.startsWith('folder:')&&folderById(scope.slice(7))?.parentId===null)?'folderAsc':'user');}
  const sortLabels={folderAsc:'폴더순',folderDesc:'폴더순(역순)',createdAsc:'등록순 ↑',createdDesc:'등록순 ↓',user:'사용자 정렬'};
  function sortedScope(scope,items){
    const ids=data.orders?.[scope]||[];
    const position=new Map(ids.map((id,i)=>[id,i]));
    return items.slice().sort((a,b)=>{
      const ai=position.has(a.id)?position.get(a.id):Infinity;
      const bi=position.has(b.id)?position.get(b.id):Infinity;
      return ai-bi;
    });
  }
  function entryDateOrder(items,desc=false){
    const indexed=new Map(data.entries.map((e,i)=>[e.id,i]));
    return items.slice().sort((a,b)=>{
      const ta=Date.parse(a.createdAt),tb=Date.parse(b.createdAt);
      const da=Number.isFinite(ta)?ta:indexed.get(a.id);
      const db=Number.isFinite(tb)?tb:indexed.get(b.id);
      const diff=da-db;
      return (desc?-diff:diff) || ((indexed.get(a.id)-indexed.get(b.id))*(desc?-1:1));
    });
  }
  function folderSorted(items,desc=false,scope=scopeKey()){
    const index=new Map();
    const folderOrder=category==='all'
      ?[...folders(null).flatMap(parent=>[parent.id,...folders(parent.id).map(f=>f.id)]),'uncategorized']
      :[category,...folders(category).map(f=>f.id)];
    folderOrder.forEach((id,i)=>index.set(id,i));
    const groupOf=e=>{
      if(!e.folderId || !folderById(e.folderId))return 'uncategorized';
      return e.folderId;
    };
    const sorted=items.slice().sort((a,b)=>{
      const ga=index.get(groupOf(a))??Number.MAX_SAFE_INTEGER;
      const gb=index.get(groupOf(b))??Number.MAX_SAFE_INTEGER;
      return ga-gb;
    });
    // Respect each folder's own custom ordering inside its group, when present.
    const result=[];
    for(let i=0;i<sorted.length;){
      const key=groupOf(sorted[i]);let j=i+1;
      while(j<sorted.length && groupOf(sorted[j])===key)j++;
      result.push(...sortedScope(key==='uncategorized'?'uncategorized':'folder:'+key,sorted.slice(i,j)));
      i=j;
    }
    return desc?result.reverse():result;
  }
  function baseOrdered(scope,items,mode){
    if(mode==='folderAsc'||mode==='folderDesc')return folderSorted(items,mode==='folderDesc',scope);
    if(mode==='createdAsc'||mode==='createdDesc')return entryDateOrder(items,mode==='createdDesc');
    return sortedScope(scope,items);
  }
  function scopeEntriesUnfiltered(){
    const original=query;query='';
    try{return data.entries.filter(entryVisible);}finally{query=original;}
  }
  function orderedVisible(){
    const scope=scopeKey(),items=data.entries.filter(entryVisible);
    return baseOrdered(scope,items,sortModeFor(scope));
  }
  function hasCustomOrder(scope){return Array.isArray(data.orders?.[scope]) && data.orders[scope].length>0;}
  function seedUserOrder(scope,basis){
    const ids=baseOrdered(scope,scopeEntriesUnfiltered(),basis).map(e=>e.id);
    data.orders[scope]=ids;
    persist();
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
  function card(e,disableDrag=false){
    const path=e.folderId ? [folderById(rootOf(e.folderId))?.name,folderById(e.folderId)?.parentId?folderById(e.folderId)?.name:null].filter(Boolean).join(' / ') : '미분류';
    return `<article class="entry" data-entry-id="${esc(e.id)}"><div class="entry-title"><span>${esc(e.title||'제목 없음')}</span><span class="muted">${esc(path)}</span></div><div class="preview">${esc(e.body)}</div><div class="actions"><button class="btn sm copy-main" data-act="copy" data-id="${esc(e.id)}">복사</button><span class="action-spacer" aria-hidden="true"></span><label class="row tiny pick-label" title="여러 항목 선택" ${selectionMode?'':'hidden'}><input class="check" type="checkbox" data-pick="${esc(e.id)}" ${selected.has(e.id)?'checked':''}>선택</label><button class="btn sm" data-act="edit" data-id="${esc(e.id)}">수정</button>${disableDrag?'':`<button class="btn sm drag-handle" type="button" data-drag-id="${esc(e.id)}" aria-label="순서 드래그 이동" title="끌어서 이동 · 선택한 항목은 함께 이동">⠿</button>`}</div></article>`;
  }
  function renderMain(){
    const visible=orderedVisible();
    const scope=scopeKey();
    const mode=sortModeFor(scope);
    const isGrouped=canChooseSort()&&(mode==='folderAsc'||mode==='folderDesc');
    let lastGroup=null;
    const results=visible.map(e=>{
      let heading='';
      if(isGrouped){
        const folder=e.folderId&&folderById(e.folderId);
        const key=folder?.id||'uncategorized';
        if(key!==lastGroup){lastGroup=key;heading=`<div class="group-heading">${esc(folder?.name||'미분류')}</div>`;}
      }
      return heading+card(e,mode!=='user');
    }).join('');
    const available=canChooseSort();
    const sortMenu=available?`<div class="sort-mode"><label class="sort-label" for="view-sort">정렬</label><select id="view-sort" aria-label="정렬 방식"><option value="folderAsc" ${mode==='folderAsc'?'selected':''}>폴더순</option><option value="folderDesc" ${mode==='folderDesc'?'selected':''}>폴더순(역순)</option><option value="createdAsc" ${mode==='createdAsc'?'selected':''}>등록순(오래된순)</option><option value="createdDesc" ${mode==='createdDesc'?'selected':''}>등록순(최신순)</option><option value="user" ${mode==='user'?'selected':''}>사용자 정렬</option></select>${mode==='user'?`<button class="btn sm" data-act="sortsettings">사용자 정렬 설정</button>`:''}</div>`:'';
    content.innerHTML=`${renderTabs()}${renderSub()}${sortMenu}<div class="headrow"><span class="muted">${visible.length}개 항목</span><button class="btn sm" data-act="folders">폴더 관리</button></div><input type="search" id="search" placeholder="제목 또는 본문 검색" value="${esc(query)}" aria-label="텍스트 검색"><div id="results">${visible.length?results:'<div class="empty">저장된 텍스트가 없습니다.</div>'}</div>`;
    footer.innerHTML=`<button class="btn primary" data-act="newentry">＋ 새 텍스트</button>${selectionMode?`<button class="btn" data-act="copyselected" ${selected.size?'':'disabled'}>선택 복사 (${selected.size})</button><button class="btn" data-act="moveselected" ${selected.size?'':'disabled'}>폴더 이동</button><button class="btn" data-act="selectionoff">취소</button>`:`<button class="btn" data-act="selectionon">선택</button>`}<button class="btn" data-act="backup">백업</button>`;
  }
  function renderSortSettings(){
    const scope=sortSettingsScope||scopeKey();
    const basis=['folderAsc','folderDesc','createdAsc','createdDesc'].includes(ui.sortBases?.[scope])?ui.sortBases[scope]:'createdAsc';
    const name=scope==='all'?'전체':scope.startsWith('folder:')?(folderById(scope.slice(7))?.name||'폴더')+' → 전체':'미분류';
    content.innerHTML=`<h3>사용자 정렬 설정</h3><div class="muted">적용 위치: ${esc(name)}</div><div class="box settingshint"><strong>기본 순서 (사용자 정렬 초기화 기준)</strong><div class="muted">사용자 정렬을 처음 만들거나 초기화할 때 사용할 순서를 선택하세요.</div><label class="field" for="sort-base">기준 선택</label><select id="sort-base"><option value="folderAsc" ${basis==='folderAsc'?'selected':''}>폴더순</option><option value="folderDesc" ${basis==='folderDesc'?'selected':''}>폴더순(역순)</option><option value="createdAsc" ${basis==='createdAsc'?'selected':''}>등록순(오래된순)</option><option value="createdDesc" ${basis==='createdDesc'?'selected':''}>등록순(최신순)</option></select></div><div class="box settingshint"><strong>사용자 정렬 초기화</strong><div class="muted">선택한 기준으로 이 위치의 사용자 정렬을 다시 만듭니다. 이미 드래그한 순서는 확인 후 덮어쓰며, 다른 폴더 순서와 텍스트는 변경하지 않습니다.</div><button class="btn primary" data-act="resetsort">기준 순서로 초기화</button></div>`;
    footer.innerHTML=`<button class="btn" data-act="main">← 목록으로</button>`;
  }
  function optionsHtml(selectedId){
    return `<option value="" ${!selectedId?'selected':''}>미분류</option>`+folders(null).map(f=>`<option value="${esc(f.id)}" ${selectedId===f.id?'selected':''}>${esc(f.name)}</option>`+folders(f.id).map(c=>`<option value="${esc(c.id)}" ${selectedId===c.id?'selected':''}>　↳ ${esc(c.name)}</option>`).join('')).join('');
  }
  function renderMoveSelected(){
    const count=data.entries.filter(e=>selected.has(e.id)).length;
    if(!count){selectionMode=false;go('main');return;}
    content.innerHTML=`<h3>선택 텍스트 폴더 이동</h3><div class="muted">${count}개 텍스트를 이동할 폴더를 선택하세요.</div><label class="field" for="move-selected-folder">이동할 폴더</label><select id="move-selected-folder">${optionsHtml(null)}</select><div class="box settingshint">텍스트 내용과 등록일은 유지됩니다. 이동한 항목은 새 폴더의 정렬 목록에 표시됩니다.</div>`;
    footer.innerHTML=`<button class="btn primary" data-act="confirmmoveselected">이동 (${count})</button><button class="btn" data-act="main">취소</button>`;
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
    content.innerHTML=`<h3>${entry?'텍스트 수정':'새 텍스트 저장'}</h3><label class="field" for="entry-title">제목</label><input id="entry-title" type="text" maxlength="200" value="${esc(entry?.title||'')}" placeholder="제목을 입력하세요"><label class="field" for="entry-folder">저장 폴더</label><select id="entry-folder">${optionsHtml(initialFolder)}</select><label class="field" for="entry-body">본문</label><textarea id="entry-body" maxlength="200000" placeholder="원하는 텍스트">${esc(entry?.body||'')}</textarea><div class="muted">저장된 내용은 모든 제타 채팅방에서 공통으로 사용할 수 있습니다.</div>`;
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
  function render(){ if(!showPanel)return; switch(currentPage){case 'editor':renderEditor();break;case 'folders':renderFolders();break;case 'folderedit':renderFolderEdit();break;case 'settings':renderSettings();break;case 'backup':renderBackup();break;case 'sortsettings':renderSortSettings();break;case 'moveselected':renderMoveSelected();break;default:renderMain();} }
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
    if(mode==='replace') {data=incoming;if(parsed.ui&&typeof parsed.ui==='object'){ui={...defaultUi(),...parsed.ui};ui.buttonPos=safePos(ui.buttonPos);ui.panelPos=safePos(ui.panelPos);ui.buttonText=sanitizeText(ui.buttonText,32);ui.buttonSize=asNumber(ui.buttonSize,48,32,100);ui.panelW=asNumber(ui.panelW,380,260,1600);ui.panelH=asNumber(ui.panelH,540,240,1600);ui.theme=['light','dark','auto'].includes(ui.theme)?ui.theme:'auto';
      ui.sortModes=ui.sortModes&&typeof ui.sortModes==='object'&&!Array.isArray(ui.sortModes)?ui.sortModes:{};
      ui.sortBases=ui.sortBases&&typeof ui.sortBases==='object'&&!Array.isArray(ui.sortBases)?ui.sortBases:{};
      if(!isValidSort(ui.sortModes.all))ui.sortModes.all='folderAsc';
      persistUi();}}
    else {
      const existingFolders=new Set(data.folders.map(f=>f.id));
      const remap=new Map();
      for(const f of incoming.folders){const id=existingFolders.has(f.id)?uid():f.id;remap.set(f.id,id);existingFolders.add(id);}
      for(const f of incoming.folders) data.folders.push({...f,id:remap.get(f.id),parentId:f.parentId?(remap.get(f.parentId)||null):null});
      const existingEntries=new Set(data.entries.map(e=>e.id));
      const entryRemap=new Map();
      for(const e of incoming.entries){const id=existingEntries.has(e.id)?uid():e.id;entryRemap.set(e.id,id);existingEntries.add(id);data.entries.push({...e,id,folderId:e.folderId?(remap.get(e.folderId)||null):null});}
      for(const [key,ids] of Object.entries(incoming.orders||{})){
        const destination=key.startsWith('folder:')?'folder:'+(remap.get(key.slice(7))||key.slice(7)):key;
        const list=data.orders[destination]||[];
        const known=new Set(list);
        for(const id of ids){const mapped=entryRemap.get(id);if(mapped&&!known.has(mapped)){list.push(mapped);known.add(mapped);}}
        data.orders[destination]=list;
      }
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
      case 'toggletheme':ui.theme=ui.theme==='auto'?'light':ui.theme==='light'?'dark':'light';persistUi();applyTheme();if(currentPage==='settings')renderSettings();return;
      case 'settings':go('settings');return;
      case 'folders':go('folders');return;
      case 'backup':go('backup');return;
      case 'cat':category=id;sub='all';selected.clear();render();return;
      case 'sortsettings':sortSettingsScope=scopeKey();go('sortsettings');return;
      case 'resetsort':{
        const scope=sortSettingsScope||scopeKey(),basis=$('#sort-base')?.value||'createdAsc';
        if(!['folderAsc','folderDesc','createdAsc','createdDesc'].includes(basis))return;
        if(hasCustomOrder(scope) && !confirm('현재 사용자 정렬 순서를 선택한 기준으로 초기화할까요?\n기존에 드래그로 지정한 순서가 덮어써집니다.'))return;
        ui.sortBases[scope]=basis;
        ui.sortModes[scope]='user';
        seedUserOrder(scope,basis);
        persistUi();go('main');notify('선택한 기준으로 사용자 정렬을 설정했습니다.');return;
      }
      case 'sub':sub=id;selected.clear();render();return;
      case 'newfolder':go('folders');if(el.dataset.parent!==undefined){const s=$('#folder-parent');if(s)s.value=el.dataset.parent||'';}return;
      case 'addfolder':{const parent=$('#folder-parent')?.value||null,name=$('#folder-name')?.value.trim();if(!name){notify('폴더 이름을 입력하세요.');return;}if(data.folders.some(f=>f.parentId===parent&&f.name===name)){notify('같은 이름의 폴더가 이미 있습니다.');return;}data.folders.push({id:uid(),parentId:parent,name});persist();render();notify('폴더를 추가했습니다.');return;}
      case 'renamefolder':editingFolderId=id;go('folderedit');return;
      case 'saverename':{const f=folderById(editingFolderId),name=$('#rename-name')?.value.trim();if(!f||!name){notify('폴더 이름을 입력하세요.');return;}if(data.folders.some(x=>x.id!==f.id&&x.parentId===f.parentId&&x.name===name)){notify('같은 이름의 폴더가 있습니다.');return;}f.name=name;persist();go('folders');return;}
      case 'deletefolder':removeFolder(id);return;
      case 'movefolder':moveFolder(id,+el.dataset.step);return;
      case 'moveentry':moveEntry(id,+el.dataset.step);return;
      case 'selectionon':selectionMode=true;selected.clear();render();return;
      case 'selectionoff':selectionMode=false;selected.clear();render();return;
      case 'moveselected':if(!selected.size)return;go('moveselected');return;
      case 'confirmmoveselected':{
        if(currentPage!=='moveselected'||!selected.size)return;
        const folderId=$('#move-selected-folder')?.value||null;
        if(folderId!==null&&!folderById(folderId)){notify('이동할 폴더를 다시 선택하세요.');return;}
        const entries=data.entries.filter(e=>selected.has(e.id));
        if(!entries.length)return;
        entries.forEach(e=>{e.folderId=folderId;});
        persist();selectionMode=false;selected.clear();go('main');notify(entries.length+'개 텍스트를 이동했습니다.');return;
      }
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
      case 'copyselected':{const values=orderedVisible().filter(e=>selected.has(e.id)).map(e=>e.body);if(values.length){void copyText(values.join('\n\n'));selectionMode=false;selected.clear();render();}return;}
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
    if(t.id==='view-sort'){
      const scope=scopeKey(),mode=t.value;
      if(!isValidSort(mode))return;
      ui.sortModes[scope]=mode;
      persistUi();
      if(mode==='user'&&!hasCustomOrder(scope)){sortSettingsScope=scope;go('sortsettings');return;}
      render();return;
    }
    if(t.id==='sort-base'){
      const scope=sortSettingsScope||scopeKey();
      if(['folderAsc','folderDesc','createdAsc','createdDesc'].includes(t.value)){
        ui.sortBases[scope]=t.value;persistUi();
      }
      return;
    }
    if(t.matches('[data-pick]')){t.checked?selected.add(t.dataset.pick):selected.delete(t.dataset.pick);const button=footer.querySelector('[data-act="copyselected"]');if(button){button.disabled=!selected.size;button.textContent=`선택 복사 (${selected.size})`;}const moveButton=footer.querySelector('[data-act="moveselected"]');if(moveButton)moveButton.disabled=!selected.size;}
  });
  root.addEventListener('input',event=>{
    const t=event.target;
    if(t.id==='entry-body'){resizeEditorBody();return;}
    if(t.id==='search'){query=t.value;const items=data.entries.filter(entryVisible);$('#results').innerHTML=items.length?items.map(card).join(''):'<div class="empty">검색 결과가 없습니다.</div>';return;}
    if(t.id==='theme-select'){ui.theme=t.value;applyTheme();persistUi();return;}
    if(t.id==='button-size'){$('#button-size-value').textContent=t.value+'px';ui.buttonSize=asNumber(t.value,48,32,100);applyUi();return;}
    if(t.id==='button-text'){ui.buttonText=sanitizeText(t.value,32);applyUi();}
  });
  // Pointer Events work on touch Safari as well as mouse/trackpad.
  // Only the handle begins a reorder, leaving card buttons and page scrolling usable.
  function reorderVisible(movingIds,targetId,after){
    const scope=scopeKey();
    if(sortModeFor(scope)!=='user')return;
    const visible=orderedVisible();
    const moving=new Set(movingIds);
    if(!visible.some(e=>e.id===targetId)||moving.has(targetId))return;
    const ordered=visible.filter(e=>!moving.has(e.id));
    const pos=ordered.findIndex(e=>e.id===targetId);
    if(pos<0)return;
    ordered.splice(pos+(after?1:0),0,...visible.filter(e=>moving.has(e.id)));
    const current=sortedScope(scope,scopeEntriesUnfiltered());
    const visibleIds=new Set(visible.map(e=>e.id));
    let index=0;
    data.orders[scope]=current.map(e=>visibleIds.has(e.id)?ordered[index++].id:e.id);
    persist();render();
  }
  root.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-drag-id]');
    if(!handle || currentPage!=='main' || event.button!==0 || sortModeFor(scopeKey())!=='user')return;
    const id=handle.dataset.dragId;
    const moving=selectionMode&&selected.has(id)&&selected.size>1
      ? orderedVisible().filter(e=>selected.has(e.id)).map(e=>e.id)
      : [id];
    const startX=event.clientX,startY=event.clientY,pid=event.pointerId;
    let started=false,hoverId=null,after=false;
    const clearMarks=()=>{root.querySelectorAll('.drag-source,.drag-group,.drop-before,.drop-after').forEach(el=>el.classList.remove('drag-source','drag-group','drop-before','drop-after'));};
    const move=e=>{
      if(e.pointerId!==pid)return;
      if(!started && Math.hypot(e.clientX-startX,e.clientY-startY)<7)return;
      if(!started){started=true;handle.setPointerCapture?.(pid);}
      e.preventDefault();
      clearMarks();
      for(const movingId of moving){const el=Array.from(root.querySelectorAll('[data-entry-id]')).find(node=>node.dataset.entryId===movingId);el?.classList.add(movingId===id?'drag-source':'drag-group');}
      // Native shadowRoot.elementFromPoint keeps the drop target inside the panel.
      const hit=root.elementFromPoint?.(e.clientX,e.clientY);
      const card=hit?.closest?.('[data-entry-id]');
      hoverId=null;
      if(card && !moving.includes(card.dataset.entryId)){
        hoverId=card.dataset.entryId;
        const bounds=card.getBoundingClientRect();
        after=e.clientY>bounds.top+bounds.height/2;
        card.classList.add(after?'drop-after':'drop-before');
      }
      const region=content.getBoundingClientRect();
      if(e.clientY<region.top+28)content.scrollTop-=12;
      else if(e.clientY>region.bottom-28)content.scrollTop+=12;
    };
    const finish=e=>{
      if(e.pointerId!==pid)return;
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('pointercancel',cancel);
      clearMarks();
      if(started&&hoverId)reorderVisible(moving,hoverId,after);
    };
    const cancel=e=>{
      if(e.pointerId!==pid)return;
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('pointercancel',cancel);
      clearMarks();
    };
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',cancel);
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