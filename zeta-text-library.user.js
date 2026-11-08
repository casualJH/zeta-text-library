// ==UserScript==
// @name         제타 텍스트 보관함
// @namespace    zeta-text-library
// @version      0.0.4
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
  // v0.0.4: Remove the old built-in '기타' tab without deleting saved text.
  // User-created folders (even if also named '기타') are not affected.
  const obsoleteDefaultIds = new Set(data.folders
    .filter(f => (f.id === 'other' || (f.id === 'world' && f.name === '기타')) && f.parentId === null)
    .map(f => f.id));
  if (obsoleteDefaultIds.size) {
    data.entries.forEach(e => { if (obsoleteDefaultIds.has(e.folderId)) e.folderId = null; });
    data.folders.forEach(f => { if (obsoleteDefaultIds.has(f.parentId)) f.parentId = null; });
    data.folders = data.folders.filter(f => !obsoleteDefaultIds.has(f.id));
  }
;