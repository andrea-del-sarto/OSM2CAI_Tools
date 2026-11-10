// ==UserScript==
// @name         OSM2CAI Tools
// @namespace    https://osm2cai.cai.it/
// @version      0.13.0
// @updateURL    https://raw.githubusercontent.com/andrea-del-sarto/OSM2CAI_Tools/main/OSM2CAI_Tools.user.js
// @downloadURL  https://raw.githubusercontent.com/andrea-del-sarto/OSM2CAI_Tools/main/OSM2CAI_Tools.user.js
// @homepageURL   https://github.com/andrea-del-sarto/OSM2CAI_Tools
// @description  Strumenti per consultare OSM2CAI, verificare i percorsi escursionistici e riordinare le relazioni OSM.
// @author       andrea-del-sarto
// @license      GPL-3.0-only
// @match        https://www.openstreetmap.org/*
// @match        https://openstreetmap.org/*
// @match        https://hiking.waymarkedtrails.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      osm2cai.cai.it
// @connect      api.openstreetmap.org
// @connect      commons.wikimedia.org
// @connect      upload.wikimedia.org
// @run-at       document-start
// ==/UserScript==

// Copyright (C) 2026 andrea-del-sarto
// SPDX-License-Identifier: GPL-3.0-only
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License, version 3.
// This program is distributed WITHOUT ANY WARRANTY.
// See the LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html

(function () {
    'use strict';

    // La versione visualizzata nel popup proviene dai metadati Tampermonkey.
    const SCRIPT_VERSION = GM_info?.script?.version || '0.13.0';

    // Accetta esclusivamente una permutazione degli slot way: nessuna aggiunta,
    // rimozione, modifica di ruolo o movimento dei membri node/relation.
    function validateMemberReorder(before, after) {
        if (!Array.isArray(before) || !Array.isArray(after) ||
            before.length < 2 || before.length > 10000 || after.length !== before.length) return false;
        // La sequenza arriva anche dall'hash della pagina iD: non fidarsi di
        // identificativi enormi, nulli o non rappresentabili senza perdita.
        const valid = m => m && !Array.isArray(m) &&
            ['way','relation','node'].includes(m.type) &&
            typeof m.ref === 'string' && /^[1-9]\d{0,15}$/.test(m.ref) &&
            Number.isSafeInteger(Number(m.ref)) &&
            typeof m.role === 'string' && m.role.length <= 255;
        if (!before.every(valid) || !after.every(valid)) return false;
        const key = m => JSON.stringify([m.type,m.ref,m.role]);
        const counts = new Map();
        let ways = 0;
        for (let i=0; i<before.length; i++) {
            const b=before[i], a=after[i];
            if (b.type === 'way') {
                if (a.type !== 'way') return false;
                ways++;
            } else if (key(b) !== key(a)) return false;
            counts.set(key(b), (counts.get(key(b)) || 0) + 1);
        }
        if (ways < 2) return false;
        for (const m of after) {
            const k=key(m), count=counts.get(k) || 0;
            if (!count) return false;
            counts.set(k,count-1);
        }
        return [...counts.values()].every(n => n === 0);
    }

    // Integrazione dedicata alla pagina /id: l'ordine viene inserito nel grafo
    // e nella cronologia di iD, MA NON salvato sul server OSM.
    function applyOrderInsideID() {
        const raw = location.hash.match(/(?:^|[&#])osm2cai_members=([^&]+)/)?.[1];
        if (!raw) return;
        let job;
        try {
            if (raw.length > 120000) throw Error('Payload troppo grande');
            job = JSON.parse(decodeURIComponent(raw));
            if (!job || typeof job !== 'object' || Array.isArray(job) ||
                !/^[1-9]\d{0,15}$/.test(String(job.relationId)) ||
                !Number.isSafeInteger(Number(job.relationId)) || !Number.isSafeInteger(job.version) || job.version < 1 ||
                !Array.isArray(job.before) || !Array.isArray(job.after) ||
                job.before.length < 2 || job.before.length > 10000 ||
                job.after.length !== job.before.length) throw Error('Dati incompleti');
            if (!validateMemberReorder(job.before,job.after)) throw Error('Riordino non valido');
        } catch (e) { alert('OSM2CAI: richiesta di ordinamento non valida.'); return; }

        // L'istanza ufficiale iD è una variabile locale di /id: catturiamo
        // il contesto quando iD lo crea (il sito lo inizializza a DOMContentLoaded).
        const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        let captured = null;
        let attempts = 0;
        let finished = false;
        let timer = null;
        const stop = () => {
            finished = true;
            if (timer !== null) { clearInterval(timer); timer = null; }
            window.removeEventListener('pagehide', stop);
        };
        window.addEventListener('pagehide', stop, {once:true});
        // Copia superficiale delle esportazioni: evita di alterare l'oggetto
        // module namespace, che può essere immutabile.
        const proxy = api => {
            if (!api || typeof api.coreContext !== 'function') return api;
            const facade=Object.assign({},api);
            facade.coreContext=function (...args) {
                const ctx=api.coreContext.apply(api,args);
                captured=ctx;
                return ctx;
            };
            return facade;
        };
        try {
            let current = proxy(page.iD);
            Object.defineProperty(page,'iD', {
                configurable: true, enumerable: true,
                get() { return current; },
                set(v) { current=proxy(v); }
            });
        } catch(e) { stop(); alert('OSM2CAI: impossibile collegarsi a iD. Nessuna modifica applicata.'); return; }

        timer=setInterval(() => {
            if (finished) { stop(); return; }
            if (++attempts > 180) {
                stop();
                alert('OSM2CAI: relazione non caricata o contesto iD non disponibile. Nessuna modifica applicata.');
                return;
            }
            try {
                if (!captured || typeof captured.hasEntity !== 'function' ||
                    typeof captured.perform !== 'function') return;
                const entity=captured.hasEntity('r'+job.relationId);
                if (!entity || !Array.isArray(entity.members)) return;
                const norm = m => ({type:m.type,
                    ref:String(m.id ?? m.ref ?? '').replace(/^[nwr]/,''), role:m.role||''});
                const present=entity.members.map(norm);
                if (!validateMemberReorder(present, job.after)) {
                    stop();
                    alert('OSM2CAI: riordino non valido. Nessuna modifica applicata.');
                    return;
                }
                const canonical=a=>JSON.stringify(a);
                if (Number(entity.version) !== job.version || canonical(present)!==canonical(job.before)) {
                    stop();
                    alert('OSM2CAI: la relazione in iD non corrisponde alla versione analizzata. Nessuna modifica applicata.');
                    return;
                }
                if (canonical(job.before)===canonical(job.after)) {
                    stop(); return;
                }
                stop();
                const remaining = new Map();
                for (const m of entity.members) {
                    const k=canonical(norm(m));
                    if (!remaining.has(k)) remaining.set(k,[]);
                    remaining.get(k).push(m);
                }
                const reordered=job.after.map(m=>remaining.get(canonical(m))?.shift());
                if (reordered.some(m=>!m) || reordered.length!==entity.members.length) {
                    alert('OSM2CAI: membri non corrispondenti. Nessuna modifica applicata.'); return;
                }
                const rid='r'+job.relationId;
                // Verifica finale prima della mutazione del grafo.
                if (!validateMemberReorder(present, reordered.map(norm))) {
                    alert('OSM2CAI: i membri non rispettano la sequenza autorizzata.'); return;
                }
                captured.perform(graph => graph.replace(graph.entity(rid).update({members:reordered})),
                    'OSM2CAI: riordino membri relazione '+job.relationId);
                console.info('OSM2CAI: riordino applicato in iD (non salvato su OSM); verifica nella cronologia e salva manualmente.');
            } catch(e) {
                stop();
                alert('OSM2CAI: applicazione in iD non riuscita: '+(e?.message||String(e)));
            }
        },500);
    }
    // Applica correzioni di guidepost al grafo di iD, mai al server OSM.
    // Verifica la versione di ogni oggetto e impedisce sovrascritture di tag esistenti.
    function applyGuidepostsInsideID() {
        const raw=location.hash.match(/(?:^|[&#])osm2cai_guideposts=([^&]+)/)?.[1];
        if (!raw) return;
        let job;
        try {
            if (raw.length>90000) throw Error('Richiesta troppo grande');
            job=JSON.parse(decodeURIComponent(raw));
            if (!job || !/^[1-9]\d{0,15}$/.test(String(job.relationId)) ||
                !Number.isSafeInteger(Number(job.relationId)) ||
                !Number.isSafeInteger(job.relationVersion) || job.relationVersion<1 ||
                !Array.isArray(job.nodes) || job.nodes.length<1 || job.nodes.length>250 ||
                !Array.isArray(job.roles) || job.roles.length>250) throw Error('Richiesta non valida');
            const ids=new Set();
            for (const node of job.nodes) {
                if (!/^[1-9]\d{0,15}$/.test(String(node.id)) ||
                    !Number.isSafeInteger(Number(node.id)) || ids.has(String(node.id)) ||
                    !Number.isSafeInteger(node.version) || node.version<1 ||
                    !node.add || typeof node.add!=='object' || Array.isArray(node.add) ||
                    Object.entries(node.add).some(([k,v])=>
                        !['tourism','information','hiking'].includes(k) ||
                        ({tourism:'information',information:'guidepost',hiking:'yes'})[k]!==v)) throw Error('Tag non validi');
                ids.add(String(node.id));
            }
            const members=new Set();
            for (const role of job.roles) {
                if (!/^[1-9]\d{0,15}$/.test(String(role.id)) ||
                    !Number.isSafeInteger(Number(role.id)) || !ids.has(String(role.id)) ||
                    !Number.isSafeInteger(role.index) || role.index<0 || role.index>9999 ||
                    members.has(role.index)) throw Error('Ruoli non validi');
                members.add(role.index);
            }
        } catch(e) { alert('OSM2CAI: correzione segnaletica non valida: '+e.message); return; }
        const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
        let captured=null,done=false,attempts=0,timer=null,requestedMissing=false;
        const stop=()=>{done=true;if(timer!==null) clearInterval(timer);window.removeEventListener('pagehide',stop);};
        window.addEventListener('pagehide',stop,{once:true});
        const proxy=api=>{
            if (!api || typeof api.coreContext!=='function') return api;
            const facade=Object.assign({},api);
            facade.coreContext=function(...args){const ctx=api.coreContext.apply(api,args);captured=ctx;return ctx;};
            return facade;
        };
        try {
            let current=proxy(page.iD);
            Object.defineProperty(page,'iD',{configurable:true,enumerable:true,
                get(){return current;},set(v){current=proxy(v);}});
        } catch(e) {stop();alert('OSM2CAI: impossibile collegarsi a iD.');return;}
        timer=setInterval(()=>{
            if(done) return;
            if(++attempts>240){
                const missing=job.nodes.filter(n=>!captured?.hasEntity?.('n'+n.id)).map(n=>n.id);
                stop();alert('OSM2CAI: impossibile preparare le modifiche. '+missing.length+' nodi non caricati da iD ('+missing.slice(0,8).join(', ')+'). Nessuna correzione applicata.');return;}
            try {
                if (!captured || typeof captured.hasEntity!=='function' || typeof captured.perform!=='function') return;
                const relation=captured.hasEntity('r'+job.relationId);
                if (!relation || !Array.isArray(relation.members)) return;
                const nodes=job.nodes.map(n=>({spec:n,entity:captured.hasEntity('n'+n.id)}));
                if(nodes.some(n=>!n.entity)) {
                    // Le relazioni grandi possono trovarsi fuori dalla vista caricata.
                    // Richiedi gli oggetti esplicitamente al servizio OSM di iD,
                    // senza introdurre entità artificiose nel grafo dell'editor.
                    if (!requestedMissing && attempts>5) {
                        requestedMissing=true;
                        const missing=nodes.filter(n=>!n.entity).map(n=>'n'+n.spec.id);
                        try {
                            const osm=captured.services?.osm || page.iD?.services?.osm;
                            if(typeof osm?.loadMultiple==='function') osm.loadMultiple(missing,()=>{});
                            else if(typeof captured.loadEntity==='function')
                                for(const id of missing) captured.loadEntity(id);
                        } catch(err) { console.warn('OSM2CAI: caricamento nodi non riuscito',err); }
                    }
                    return;
                }
                const bad=Number(relation.version)!==job.relationVersion ||
                    nodes.some(({spec,entity})=>Number(entity.version)!==spec.version ||
                        Object.keys(spec.add).some(k=>entity.tags?.[k]!==undefined)) ||
                    job.roles.some(({id,index})=>{
                        const member=relation.members[index];
                        return !member || member.type!=='node' ||
                            String(member.id??member.ref).replace(/^n/,'')!==String(id) || Boolean(member.role);
                    });
                if(bad){stop();alert('OSM2CAI: dati modificati o tag/ruoli già presenti. Nessuna correzione applicata. Ripeti l’analisi.');return;}
                stop();
                captured.perform(graph=>{
                    let next=graph;
                    for(const {spec} of nodes){
                        const old=next.entity('n'+spec.id);
                        next=next.replace(old.update({tags:{...old.tags,...spec.add}}));
                    }
                    if(job.roles.length){
                        const old=next.entity('r'+job.relationId);
                        const members=old.members.map(m=>({...m}));
                        for(const {index} of job.roles) members[index].role='guidepost';
                        next=next.replace(old.update({members}));
                    }
                    return next;
                },'OSM2CAI: correzione segnaletica verticale');
                console.info('OSM2CAI: correzioni applicate in iD (non salvate su OSM); verifica nella cronologia e salva manualmente.');
            } catch(e){stop();alert('OSM2CAI: correzione non riuscita: '+(e?.message||String(e)));}
        },500);
    }

    if (/^\/id(?:\/|$)/i.test(location.pathname)) {
        if (location.hash.includes("osm2cai_guideposts=")) applyGuidepostsInsideID();
        else applyOrderInsideID();
        return;
    }

    const API = 'https://osm2cai.cai.it/api/v2/hiking-route-osm';
    const OSM2CAI = 'https://osm2cai.cai.it/resources/hiking-routes';
    const TIMEOUT = 12000;
    const ICON_LINK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

    const COLLAPSED_KEY = 'osm2cai-compact-collapsed';
    let collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';
    let inFlight = new Set();
    let relationIdShown = null;
    // L'ID mostrato non basta per riutilizzare una barra il cui caricamento
    // potrebbe essere stato annullato durante una navigazione intermedia.
    let relationLoad = null;
    let sequence = 0;
    let refreshTimer = null;
    let positionTimer = null;
    let lastUrl = location.href;
    const MAIN_BAR_HEIGHT = 60;
    const MEMBER_ROW_HEIGHT = 38;
    const BAR_HEIGHT = MAIN_BAR_HEIGHT + MEMBER_ROW_HEIGHT; // Altezza complessiva della barra
    const RAIL_WIDTH = 34;
    const BAR_WIDTH = 720; // Larghezza fissa anche durante il caricamento
    // Dimensioni costanti: non cambiano in base ai valori delle API.
    const METRIC_WIDTHS = [90, 55, 220, 135, 145];

    const isWmt = () => location.hostname === 'hiking.waymarkedtrails.org';
    // Non mostrare né interrogare OSM2CAI mentre è aperto l'editor OSM.
    function isOsmEditing() {
        if (isWmt()) {
            return false;
        }
        // OSM utilizza /edit per gli editor iD e Potlatch; supporto
        // anche ai percorsi /edit/... senza confondere la vista relazione.
        return /^\/edit(?:\/|$)/i.test(location.pathname);
    }
    function relationIdFromUrl() {
        if (isOsmEditing()) {
            return null;
        }
        if (isWmt()) {
            return location.hash.match(/route\?id=(\d+)/)?.[1] || null;
        }
        // OSM: relation/ID, inclusi slash finali, hash e varianti SPA.
        const direct = location.pathname.match(/\/relation\/(\d+)(?:\/|$)/)?.[1];
        if (direct) {
            return direct;
        }
        const routeInHash = location.hash.match(/\/relation\/(\d+)/)?.[1];
        if (routeInHash) {
            return routeInHash;
        }
        // Alcuni link OSM richiamano la relazione tramite parametri URL.
        const queryId = new URLSearchParams(location.search).get('relation');
        if (queryId && /^\d+$/.test(queryId)) {
            return queryId;
        }
        return null;
    }
    // Dettaglio delle modifiche OSM successive alla validazione (solo SDA 4).
    let modifiedAfterValidation = [];
    let modifiedHoverTimer = null;
    const $ = id => document.getElementById('osm2cai-' + id);

    function hideModifiedPopup() {
        clearTimeout(modifiedHoverTimer);
        const popup = $('modified-popup');
        if (popup) { popup.hidden = true; popup.style.display = 'none'; }
    }

    function scheduleHideModifiedPopup() {
        clearTimeout(modifiedHoverTimer);
        modifiedHoverTimer = setTimeout(hideModifiedPopup, 180);
    }

    function resetModifiedElements() {
        clearOrderMap();
        orderFull = null;
        orderRelationId = null;
        setMemberOrderIndicator('gray');
        modifiedAfterValidation = [];
        hideModifiedPopup();
    }

    function modifiedElementsSince(full, validationDate) {
        const elements = full?.elements;
        if (!Array.isArray(elements) || typeof validationDate !== 'string') { return []; }
        const stamp = validationDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(stamp)) { return []; }
        const ms = parseApiDate(stamp);
        if (!Number.isFinite(ms)) { return []; }
        const onlyDay = /^\d{4}-\d{2}-\d{2}$/.test(stamp);
        return elements.filter(item => {
            const modified = typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : NaN;
            return Number.isFinite(modified) && (onlyDay
                ? item.timestamp.slice(0, 10) > stamp
                : modified > ms);
        }).sort((a, b) => {
            const order = {relation: 0, way: 1, node: 2};
            const group = (order[a.type] ?? 3) - (order[b.type] ?? 3);
            return group || Date.parse(b.timestamp) - Date.parse(a.timestamp);
        });
    }

    function renderModifiedPopup() {
        const popup = $('modified-popup');
        if (!popup || !modifiedAfterValidation.length || $('sync')?.textContent !== 'da verificare') { return; }
        popup.replaceChildren();
        const heading = document.createElement('div');
        heading.style.cssText = 'font-weight:700;margin-bottom:7px';
        heading.textContent = 'Elementi modificati dopo la validazione (' + modifiedAfterValidation.length + ')';
        popup.appendChild(heading);
        const list = document.createElement('div');
        const maxItems = 80;
        for (const item of modifiedAfterValidation.slice(0, maxItems)) {
            if (!['node', 'way', 'relation'].includes(item.type) || !Number.isSafeInteger(Number(item.id))) { continue; }
            const line = document.createElement('div');
            line.style.cssText = 'padding:5px 0;border-bottom:1px solid rgba(128,128,128,.2)';
            const link = document.createElement('a');
            link.href = 'https://www.openstreetmap.org/' + item.type + '/' + encodeURIComponent(item.id);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.cssText = 'color:#4697f5;text-decoration:underline';
            link.textContent = item.type + ' ' + item.id;
            line.appendChild(link);
            const day = item.timestamp.slice(0, 10);
            const username = typeof item.user === 'string' && item.user.trim() ? item.user.trim() : 'utente non disponibile';
            line.appendChild(document.createTextNode(' — ' + day + ' — [' + username + ']'));
            list.appendChild(line);
        }
        popup.appendChild(list);
        if (modifiedAfterValidation.length > maxItems) {
            const remaining = document.createElement('div');
            remaining.style.cssText = 'margin-top:8px;font-style:italic';
            remaining.textContent = 'Visualizzati i primi ' + maxItems + ' elementi (relation, way, node) su ' + modifiedAfterValidation.length + '.';
            popup.appendChild(remaining);
        }
        const anchor = $('sync')?.closest('.oc-metric');
        if (!anchor) { return; }
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(480, window.innerWidth - 16);
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        popup.style.setProperty('position','fixed','important');
        popup.style.setProperty('left',left + 'px','important');
        popup.style.setProperty('top',Math.min(rect.bottom + 8, window.innerHeight - 110) + 'px','important');
        popup.style.setProperty('width',width + 'px','important');
        popup.style.setProperty('max-height','min(420px, 65vh)','important');
        popup.style.setProperty('overflow-y','auto','important');
        popup.style.setProperty('padding','12px 14px','important');
        popup.style.setProperty('border','1px solid #8797ac','important');
        popup.style.setProperty('border-radius','8px','important');
        popup.style.setProperty('box-shadow','0 7px 22px #0004','important');
        popup.style.setProperty('z-index','2147483002','important');
        popup.style.setProperty('pointer-events','auto','important');
        popup.style.setProperty('display','block','important');
        popup.hidden = false;
        applyModifiedPopupTheme();
    }

    function applyModifiedPopupTheme() {
        const popup = $('modified-popup');
        if (!popup) { return; }
        const dark = darkThemeEnabled();
        popup.style.setProperty('background', dark ? '#26282b' : '#fff', 'important');
        popup.style.setProperty('color', dark ? '#e4e8ed' : '#233344', 'important');
    }


    // Verifica dell'ordine: usa solo il full.json della relazione attualmente aperta.
    // Non scrive dati OSM e non interagisce con il modello interno di iD.
    let orderFull = null;
    let orderRelationId = null;
    // Segnalazioni temporanee indipendenti dai layer Leaflet/OSM.
    // Non usa né modifica oggetti della mappa appartenenti ad altri script.
    let orderMapIssues = [];
    let selectedGuidepostId = null;
    let orderMapArrows = [];
    let orderMapArrowsVisible = false;
    let orderNestedGeometryVisible = false;
    let orderMapVisible = false;
    let orderAnimationFrame = null;
    let orderRenderSignature = null;
    let orderLastCanvasNode = null;
    let orderPanelCache = {until:0, left:0, right:0};
    // Transizione SVG della sola anteprima geometrica nelle super-relazioni OSM.
    // La geometria di base resta quella dell'ultimo frame renderizzato.
    let osmTraceBaseView = null;
    let osmTraceTween = null;

    // Il ciclo veloce si attiva soltanto per pan/zoom o cambiamenti della vista.
    // A mappa ferma rimane un controllo leggero per aggiornamenti di URL e layout
    // che WMT non notifica a questo userscript tramite API pubbliche.
    let orderIdleTimer = null;
    let orderFastUntil = 0;
    let orderLastMotionSignature = null;
    let orderMotionChangedAt = 0;
    function startOrderAnimation(duration = 850) {
        orderFastUntil = Math.max(orderFastUntil, performance.now() + duration);
        if (orderAnimationFrame !== null) return;
        if (orderIdleTimer !== null) { clearTimeout(orderIdleTimer); orderIdleTimer = null; }
        const tick = () => {
            orderAnimationFrame = null;
            if ((!orderMapVisible && !orderMapArrowsVisible) || collapsed || isOsmEditing() ||
                orderRelationId !== relationIdFromUrl()) return;
            renderOrderMapOverlay();
            // renderOrderMapOverlay può già aver programmato un frame in caso
            // di cambiamento: evita due cicli concorrenti.
            if (orderAnimationFrame !== null) return;
            if (performance.now() < orderFastUntil) {
                orderAnimationFrame = requestAnimationFrame(tick);
            } else {
                scheduleOrderIdle();
            }
        };
        orderAnimationFrame = requestAnimationFrame(tick);
    }

    function scheduleOrderIdle() {
        if (orderIdleTimer !== null || orderAnimationFrame !== null) return;
        orderIdleTimer=setTimeout(() => {
            orderIdleTimer=null;
            if ((!orderMapVisible && !orderMapArrowsVisible) || collapsed || isOsmEditing() ||
                orderRelationId !== relationIdFromUrl()) return;
            renderOrderMapOverlay();
            // Se è iniziato un movimento, il rendering riattiva il ciclo rapido.
            if (orderAnimationFrame === null) scheduleOrderIdle();
        },420);
    }

    function clearOrderMap() {
        orderMapVisible = false;
        orderMapIssues = [];
        selectedGuidepostId = null;
        orderMapArrows = [];
        orderMapArrowsVisible = false;
        orderNestedGeometryVisible = false;
        if (orderAnimationFrame !== null) { cancelAnimationFrame(orderAnimationFrame); orderAnimationFrame = null; }
        if (orderIdleTimer !== null) { clearTimeout(orderIdleTimer); orderIdleTimer = null; }
        orderFastUntil=0; orderLastMotionSignature=null; orderMotionChangedAt=0;
        orderRenderSignature = null;
        orderLastCanvasNode = null;
        orderPanelCache.until = 0;
        document.getElementById('osm2cai-order-overlay')?.remove();
        orderDrag=null; orderDragOffset={x:0,y:0}; orderDragBase={x:0,y:0}; orderLastView=null;
        wmtCanvasBaseline=null; wmtCanvasBaselineKey=null;
        wmtZoomGesture=null;
        osmZoomGesture=null; osmLastZoom=null;
        osmTraceBaseView=null; osmTraceTween=null;

    }

    // Gli indicatori sono indipendenti da Leaflet/MapLibre e non alterano i loro layer.
    // Durante il drag seguiamo il movimento del puntatore; quando l’URL cambia
    // riproiettiamo le coordinate dalla nuova vista.
    let orderDrag = null;
    let orderDragOffset = {x:0,y:0};
    let orderDragBase = {x:0,y:0};
    let orderLastView = null;
    // Su WMT seguiamo la trasformazione effettiva del canvas OpenLayers,
    // senza stimare anticipatamente uno zoom intero ad ogni click o rotella.
    let wmtCanvasBaseline = null;
    let wmtCanvasBaselineKey = null;
    // Compensazione esclusiva dello zoom WMT quando il canvas viene ridisegnato
    // senza esporre una scala CSS misurabile. Non modifica il drag della 2.6.4.
    let wmtZoomGesture = null;
    let osmZoomGesture = null;
    let osmLastZoom = null;
    // Le frecce non devono essere mostrate in posizioni stimate durante
    // l’animazione: WMT può ridisegnare canvas senza trasformazione CSS.
    // Nascondimento basato sull'assestamento della vista, non su un timer fisso.
    // Mantiene un timeout di sicurezza solo se WMT non pubblica mai moveend.
    const WMT_ZOOM_STABLE_MS = 260;
    const WMT_ZOOM_MAX_MS = 2300;
    function beginWmtZoomGesture(direction, clientX, clientY) {
        if (!isWmt() || (!orderMapVisible && !orderMapArrowsVisible) || !direction) return;
        const view = orderView();
        if (!view) return;
        const {rect} = view;
        const anchor = Number.isFinite(clientX) && Number.isFinite(clientY)
            ? {x:clientX-rect.left,y:clientY-rect.top}
            : {x:rect.width/2,y:rect.height/2};
        const now = performance.now();
        if (!wmtZoomGesture || wmtZoomGesture.viewKey!==view.key || now-wmtZoomGesture.started>600) {
            wmtZoomGesture={viewKey:view.key,anchor,delta:direction,started:now,lastInput:now,lastMotion:now,viewUpdated:false};
        } else {
            // Due pulsanti premuti rapidamente possono sommare lo zoom.
            wmtZoomGesture.delta=Math.max(-3,Math.min(3,wmtZoomGesture.delta+direction));
            wmtZoomGesture.lastInput=now;
            wmtZoomGesture.lastMotion=now;
        }
        const pins=document.querySelector('#osm2cai-order-overlay #osm2cai-map-problems');
        if (pins) pins.style.visibility='hidden';
        startOrderAnimation(800);
    }
    document.addEventListener('wheel',event=>{
        if (!isWmt() || event.ctrlKey || Math.abs(event.deltaY)<2) return;
        const map=findOrderMapElement();
        if (map && map.contains(event.target)) {
            // La rotella tradizionale di OL avvia normalmente uno step per gesto.
            // Evita di accumulare decine di step sul trackpad ad alta frequenza.
            const now=performance.now();
            if (!wmtZoomGesture || now-wmtZoomGesture.lastInput>360)
                beginWmtZoomGesture(event.deltaY<0?1:-1,event.clientX,event.clientY);
            else {
                wmtZoomGesture.lastInput=now;
                wmtZoomGesture.lastMotion=now;
                startOrderAnimation(700);
            }
        }
    },{capture:true,passive:true});
    document.addEventListener('click',event=>{
        if (!isWmt() || !event.target.closest) return;
        const control=event.target.closest('.ol-zoom-in,.ol-zoom-out');
        if (control) beginWmtZoomGesture(control.classList.contains('ol-zoom-in')?1:-1);
    },true);
    // OSM: come su WMT, non mostrare frecce su una vista che sta ancora
    // animando lo zoom. Il drag non viene toccato, e non alteriamo i layer OSM.
    const OSM_ZOOM_STABLE_MS = 300;
    const OSM_ZOOM_MAX_MS = 1900;
    // Segna l'inizio del gesto senza prevedere livelli di zoom: un trackpad
    // può emettere molti eventi per un solo step. La geometria segue la vista
    // misurata dalle tessere in orderView(), senza scale cumulative stimate.
    function beginOsmZoomGesture() {
        if (isWmt() || (!orderMapVisible && !orderMapArrowsVisible)) return;
        const view=orderView();
        if (!view) return;
        const now=performance.now();
        if (!osmZoomGesture) {
            osmZoomGesture={started:now,lastInput:now,lastChange:now,
                startZoom:view.zoom,viewUpdated:false};
        } else {
            osmZoomGesture.lastInput=now;
            osmZoomGesture.lastChange=now;
        }
        // I pin sono ancorati alla vista geografica: durante l'animazione OSM
        // non devono restare fermi su una posizione precedente.
        const pins=document.querySelector('#osm2cai-order-overlay #osm2cai-map-problems');
        if (pins) pins.style.visibility='hidden';
        startOrderAnimation(750);
    }
    document.addEventListener('wheel',event=>{
        if (isWmt() || event.ctrlKey || Math.abs(event.deltaY)<1) return;
        const map=findOrderMapElement();
        if (map?.contains(event.target)) beginOsmZoomGesture();
    },{capture:true,passive:true});
    document.addEventListener('dblclick',event=>{
        if (isWmt()) return;
        const map=findOrderMapElement();
        if (map?.contains(event.target)) beginOsmZoomGesture();
    },true);
    document.addEventListener('click',event=>{
        if (isWmt() || !event.target.closest) return;
        const plus=event.target.closest('.leaflet-control-zoom-in,.ol-zoom-in,[data-testid="zoom-in"]');
        const minus=event.target.closest('.leaflet-control-zoom-out,.ol-zoom-out,[data-testid="zoom-out"]');
        if (plus || minus) beginOsmZoomGesture();
    },true);
    document.addEventListener('keydown',event=>{
        if (isWmt() || event.altKey || event.ctrlKey || event.metaKey ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable) return;
        if (['+','=','-','_'].includes(event.key) && findOrderMapElement())
            beginOsmZoomGesture();
    },true);
    function wmtCanvasFrame(map) {
        if (!isWmt() || typeof DOMMatrix === 'undefined') return null;
        // Il canvas dei layer principali viene trasformato da OpenLayers
        // durante zoom/pan; selezioniamo quello visibile più grande.
        const canvases = [...map.querySelectorAll('.ol-layer canvas')].filter(c => {
            const r=c.getBoundingClientRect();
            return r.width>200 && r.height>150 && getComputedStyle(c).display!=='none';
        });
        if (!canvases.length) return null;
        const canvas=canvases[0];
        const css=getComputedStyle(canvas);
        const transform=css.transform==='none' ? new DOMMatrix() : new DOMMatrix(css.transform);
        if (!transform.is2D) return null;
        const vw=map.getBoundingClientRect();
        // offsetLeft/Top e transform-origin sono in coordinate CSS, prima della trasformazione.
        const ox=(parseFloat(css.transformOrigin.split(' ')[0])||0);
        const oy=(parseFloat(css.transformOrigin.split(' ')[1])||0);
        const parent=canvas.offsetParent;
        const pr=parent?.getBoundingClientRect();
        if (!pr) return null;
        const topLeft=new DOMMatrix().translate(pr.left-vw.left+canvas.offsetLeft,pr.top-vw.top+canvas.offsetTop);
        const matrix=topLeft.translate(ox,oy).multiply(transform).translate(-ox,-oy);
        const vals=[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f];
        if (!vals.every(Number.isFinite) || Math.abs(matrix.a*matrix.d-matrix.b*matrix.c)<1e-9) return null;
        return {canvas,matrix};
    }

    function findOrderMapElement() {
        const selectors = isWmt()
            ? ['.ol-viewport', '.ol-layers', '.maplibregl-map', '.mapboxgl-map', '.leaflet-container', '#map', '[class*="map-container"]', '[class*="mapContainer"]']
            : ['#map', '.leaflet-container'];
        for (const selector of selectors) {
            for (const node of document.querySelectorAll(selector)) {
                const rect = node.getBoundingClientRect();
                if (rect.width > 250 && rect.height > 180 && rect.width <= window.innerWidth + 40) return node;
            }
        }
        return null;
    }

    // OSM/Leaflet: ricava l'inquadratura dalla posizione REALE delle tessere
    // già visualizzate. Serve quando l'URL non contiene #map= e quando la
    // vista della mappa è diversa da quella pubblicata nell'URL.
    // Non usa le API interne di Leaflet e non modifica i suoi layer.
    function osmVisibleTileView(map, rect) {
        if (isWmt()) return null;
        const images=map.querySelectorAll('img.leaflet-tile, .leaflet-tile-pane img');
        if (!images.length) return null;
        const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
        const tiles=[];
        for (const img of images) {
            const url=img.currentSrc || img.src || '';
            const match=url.match(/\/(\d{1,2})\/(\d+)\/(\d+)(?:@2x)?\.(?:png|jpe?g|webp)(?:[?#]|$)/i);
            if (!match) continue;
            const z=Number(match[1]), tx=Number(match[2]), ty=Number(match[3]);
            if (z<0 || z>22 || tx>=2**z || ty>=2**z) continue;
            const r=img.getBoundingClientRect();
            if (r.width<80 || r.height<80 || !Number.isFinite(r.left) ||
                r.right<rect.left || r.left>rect.right || r.bottom<rect.top || r.top>rect.bottom) continue;
            const css=getComputedStyle(img);
            if (css.visibility==='hidden' || css.display==='none' || Number(css.opacity)===0) continue;
            const dist=Math.hypot(Math.max(0,r.left-cx,cx-r.right),Math.max(0,r.top-cy,cy-r.bottom));
            tiles.push({z,tx,ty,r,dist});
        }
        if (!tiles.length) return null;
        // Durante i cambi layer Leaflet può conservare vecchie tessere.
        // Privilegia quelle più vicine al centro e il livello più diffuso.
        const counts=new Map();
        for (const t of tiles) counts.set(t.z,(counts.get(t.z)||0)+1);
        tiles.sort((a,b)=>a.dist-b.dist || counts.get(b.z)-counts.get(a.z));
        const t=tiles[0];
        const sx=t.r.width/256, sy=t.r.height/256;
        if (!(sx>0 && sy>0) || Math.abs(sx/sy-1)>0.1) return null;
        const zoom=t.z+Math.log2((sx+sy)/2);
        const n=2**t.z;
        const nx=(t.tx+(cx-t.r.left)/t.r.width)/n;
        const ny=(t.ty+(cy-t.r.top)/t.r.height)/n;
        const lon=(nx-Math.floor(nx))*360-180;
        const lat=Math.atan(Math.sinh(Math.PI*(1-2*ny)))*180/Math.PI;
        if (![zoom,lat,lon].every(Number.isFinite) || Math.abs(lat)>85 || zoom>25) return null;
        return {zoom,lat,lon};
    }

    function orderView() {
        const map = findOrderMapElement();
        if (!map) return null;
        const rect = map.getBoundingClientRect();
        // Su OSM la vista reale si legge prima dalle tessere Leaflet.
        // L'URL può mancare del tutto oppure essere aggiornato solo a moveend.
        const tileView = !isWmt() ? osmVisibleTileView(map,rect) : null;
        const match = (location.hash + '&' + location.search)
            .match(/(?:^|[#?&])map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
        const stored = isWmt() && !match
            ? (localStorage.getItem('position') || '').match(/^([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)$/)
            : null;
        const view = match || stored;
        if (!tileView && !view) return null;
        const zoom = tileView ? tileView.zoom : Number(view[1]);
        const lat = tileView ? tileView.lat : Number(view[2]);
        const lon = tileView ? tileView.lon : Number(view[3]);
        if (![zoom,lat,lon].every(Number.isFinite) || zoom < 0 || zoom > 25 ||
            Math.abs(lat) > 85 || Math.abs(lon) > 540) return null;
        return {map,rect,zoom,lat,lon,source:tileView?'tiles':'url',key:zoom.toFixed(5)+'/'+lat.toFixed(7)+'/'+lon.toFixed(7)};
    }

    // Mantieni il dislocamento cumulativo fino all'aggiornamento della vista
    // pubblicata dal sito: l'URL della mappa viene aggiornato solo a moveend.
    // Vale anche per più trascinamenti consecutivi effettuati prima di moveend.
    function beginOrderDrag(event) {
        if ((!orderMapVisible && !orderMapArrowsVisible) || event.button !== 0 || orderDrag) return;
        const map = findOrderMapElement();
        if (!map || !map.contains(event.target)) return;
        const view = orderView();
        if (!view) return;
        orderDrag = {id:event.pointerId,x:event.clientX,y:event.clientY};
        orderDragBase = {...orderDragOffset};
    }
    function moveOrderDrag(event) {
        if (!orderDrag || event.pointerId !== orderDrag.id ||
            (!orderMapVisible && !orderMapArrowsVisible)) return;
        orderDragOffset = {
            x:orderDragBase.x + event.clientX - orderDrag.x,
            y:orderDragBase.y + event.clientY - orderDrag.y
        };
        orderDrag.lastX = event.clientX;
        orderDrag.lastY = event.clientY;
        // Il ciclo rAF traccia già ogni frame durante i movimenti della mappa.
        startOrderAnimation();
    }
    function endOrderDrag(event) {
        if (!orderDrag || (event && event.pointerId !== orderDrag.id)) return;
        if (event) moveOrderDrag(event);
        orderDrag=null;
        // L'offset resta valido finché WMT/OSM non pubblica la nuova vista.
    }
    document.addEventListener('pointerdown', beginOrderDrag, true);
    document.addEventListener('pointermove', moveOrderDrag, true);
    document.addEventListener('pointerup', endOrderDrag, true);
    document.addEventListener('pointercancel', endOrderDrag, true);
    window.addEventListener('blur', () => { orderDrag=null; });
    // La sidebar WMT può trovarsi a DESTRA o a sinistra della mappa.
    // Identifichiamo soltanto pannelli visibili e laterali, senza cambiare
    // z-index o CSS della pagina. La clip è applicata al contenitore overlay,
    // dunque copre sia le frecce sia i punti critici anche durante l'animazione.
    function orderWmtPanelInsets(rect, map) {
        const now=performance.now();
        if (now<orderPanelCache.until) return orderPanelCache;
        const candidates=new Set(document.querySelectorAll(
            'aside,[id*="sidebar"],[class*="sidebar"],[class*="sidepanel"],'+
            '[id*="details"],[class*="details"],[id*="route"],[class*="route-panel"],'+
            '[class*="info-panel"],[role="complementary"]'));
        // Alcune versioni WMT non attribuiscono classi semantiche al riquadro:
        // ricaviamo allora il contenitore laterale dai suoi contenuti testuali.
        for (const x of [rect.left+Math.min(20,rect.width*.03),rect.right-Math.min(20,rect.width*.03)]) {
            const y=Math.min(window.innerHeight-5,Math.max(5,rect.top+rect.height*.53));
            for (const top of document.elementsFromPoint(x,y).slice(0,12)) {
                for(let el=top,depth=0;el&&depth<7;el=el.parentElement,depth++) {
                    if(el!==map) candidates.add(el);
                }
            }
        }
        let left=0,right=0;
        for (const panel of candidates) {
            if (panel===map || panel.contains(map)) continue;
            const r=panel.getBoundingClientRect();
            if (r.height<rect.height*.32 || r.width<170 || r.width>rect.width*.85 ||
                r.bottom<rect.top+rect.height*.32 || r.top>rect.bottom-rect.height*.25) continue;
            const css=getComputedStyle(panel);
            if (css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0) continue;
            const text=(panel.textContent||'').slice(0,3500);
            const semantic=panel.matches('aside,[id*="sidebar"],[class*="sidebar"],[class*="sidepanel"],[role="complementary"]');
            if (!semantic && !/Relazione\s*\d+|Etichette OpenStreetMap|Download route|Profilo altimetrico|Analizza relazione/i.test(text)) continue;
            if (r.left<=rect.left+85 && r.right>rect.left+170 && r.right<rect.right-90)
                left=Math.max(left,r.right-rect.left);
            if (r.right>=rect.right-85 && r.left>rect.left+90 && r.left<rect.right-170)
                right=Math.max(right,rect.right-r.left);
        }
        orderPanelCache={until:now+260,left:Math.ceil(Math.max(0,left)),right:Math.ceil(Math.max(0,right))};
        return orderPanelCache;
    }

    function renderOrderMapOverlay() {
        if ((!orderMapVisible && !orderMapArrowsVisible) || collapsed || isOsmEditing() || orderRelationId !== relationIdFromUrl()) {
            clearOrderMap(); return;
        }
        const view = orderView();
        let overlay = document.getElementById('osm2cai-order-overlay');
        if (!view) { overlay?.remove(); return; }
        // Il solo cambio di livello zoom OSM avvia la soppressione delle
        // frecce; uno spostamento del centro non deve essere trattato come zoom.
        const osmNow = !isWmt() ? performance.now() : 0;
        if (!isWmt()) {
            if (osmLastZoom!==null && view.zoom!==osmLastZoom) {
                if (!osmZoomGesture) osmZoomGesture={started:osmNow,lastInput:osmNow,
                    lastChange:osmNow,startZoom:osmLastZoom,viewUpdated:true};
                osmZoomGesture.viewUpdated=true;
                osmZoomGesture.lastChange=osmNow;
                startOrderAnimation(650);
            }
            osmLastZoom=view.zoom;
        }
        if (view.key !== orderLastView) {
            if (!isWmt() && osmZoomGesture && view.zoom!==osmZoomGesture.startZoom) {
                osmZoomGesture.viewUpdated=true;
                osmZoomGesture.lastChange=osmNow;
            }
            orderLastView = view.key;
            // Il sito ha pubblicato la nuova posizione: niente correzione
            // manuale da sommare alle coordinate geografiche aggiornate.
            orderDragOffset = {x:0,y:0};
            wmtCanvasBaseline=null; wmtCanvasBaselineKey=null;
            if (wmtZoomGesture) {
                // La pubblicazione della nuova vista è il segnale più affidabile
                // che lo zoom sia arrivato alla sua destinazione geometrica.
                wmtZoomGesture.viewUpdated=true;
                wmtZoomGesture.lastMotion=performance.now();
                startOrderAnimation(500);
            }
            if (orderDrag) {
                // Dopo l’aggiornamento la nuova origine è l’ultima posizione
                // nota del puntatore, per non sommare due volte il drag.
                orderDrag.x = orderDrag.lastX ?? orderDrag.x;
                orderDrag.y = orderDrag.lastY ?? orderDrag.y;
                orderDragBase = {x:0,y:0};
            }
        }
        // Il canvas può essere sostituito da OpenLayers (cambio layer o tile).
        // Se cambia elemento, riparti da un nuovo riferimento senza usare
        // trasformazioni misurate su un canvas non più presente.
        const frameForSignature = isWmt() ? wmtCanvasFrame(view.map) : null;
        const canvasChanged = isWmt() && frameForSignature?.canvas !== orderLastCanvasNode;
        if (canvasChanged) {
            wmtCanvasBaseline = null;
            wmtCanvasBaselineKey = null;
            orderRenderSignature = null;
        }
        orderLastCanvasNode = frameForSignature?.canvas || null;
        // Il canvas OL puo' cambiare transform a ogni frame. Non ricreiamo i
        // singoli marcatori: applichiamo la stessa trasformazione all'SVG.
        // La geometria si ridisegna soltanto quando cambia la vista URL, la
        // dimensione, il riferimento canvas o il contenuto dell'overlay.
        const baseSignature = [view.key,view.rect.left,view.rect.top,view.rect.width,
            view.rect.height,Boolean(frameForSignature),orderMapVisible,
            orderMapArrowsVisible,
            (frameForSignature || view.source==='tiles') ? '' : orderDragOffset.x,
            (frameForSignature || view.source==='tiles') ? '' : orderDragOffset.y].join('|');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'osm2cai-order-overlay';
            overlay.setAttribute('aria-label','Punti critici ordine membri OSM2CAI');
            overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:1100;overflow:hidden;';
            document.body.appendChild(overlay);
        }
        const {rect,zoom,lat,lon} = view;
        overlay.style.left=rect.left+'px';overlay.style.top=rect.top+'px';
        overlay.style.width=rect.width+'px';overlay.style.height=rect.height+'px';
        if (isWmt()) {
            const covered=orderWmtPanelInsets(rect,view.map);
            overlay.style.clipPath=(covered.left || covered.right)
                ? `inset(0 ${covered.right}px 0 ${covered.left}px)` : 'none';
            overlay.style.zIndex='2';
        } else {
            overlay.style.clipPath='none';
            overlay.style.zIndex='1100';
        }
        const ns='http://www.w3.org/2000/svg';
        const svg=document.createElementNS(ns,'svg');
        svg.setAttribute('width',String(rect.width));svg.setAttribute('height',String(rect.height));
        svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
        svg.style.pointerEvents='none';
        const scale=256*2**zoom;
        const mercY=a=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,a))*Math.PI/360));
        const centerY=mercY(lat);
        // Durante lo zoom OpenLayers puo' ridisegnare/trasformare il canvas
        // prima di aggiornare #map=. L'SVG usa la medesima matrice affine
        // rispetto a un frame di riferimento, mantenendo invariati i punti.
        const wmtFrame = frameForSignature;
        if (wmtFrame && (!wmtCanvasBaseline || wmtCanvasBaselineKey!==view.key ||
            !wmtCanvasBaseline.canvas.isConnected)) {
            wmtCanvasBaseline=wmtFrame;
            wmtCanvasBaselineKey=view.key;
        }
        let liveTransform=null;
        if (wmtFrame && wmtCanvasBaseline && wmtFrame.canvas===wmtCanvasBaseline.canvas) {
            try {
                liveTransform=wmtFrame.matrix.multiply(wmtCanvasBaseline.matrix.inverse());
            } catch (_) { liveTransform=null; }
        }
        // Se OpenLayers non trasla il canvas ma ne ridisegna i pixel,
        // utilizziamo il delta effettivo del puntatore durante il drag.
        // Non sommiamo due volte lo spostamento se è già nella matrice OL.
        let visualMatrix=liveTransform;
        // Fallback SOLO per gli zoom che OpenLayers non codifica nella
        // matrice del canvas. Non sostituisce ne' modifica la logica del pan.
        if (isWmt() && (orderDrag || orderDragOffset.x || orderDragOffset.y)) {
            const mx=liveTransform?.e||0, my=liveTransform?.f||0;
            const px=orderDragOffset.x, py=orderDragOffset.y;
            if (Math.hypot(mx,my)<3 && Math.hypot(px,py)>0.5) {
                visualMatrix=new DOMMatrix().translate(px,py).multiply(liveTransform||new DOMMatrix());
            }
        }
        // Misura il cambiamento della vista e della matrice realmente osservati.
        // Non confondere il movimento del puntatore con la conclusione dello zoom.
        const motionSignature = [view.key,view.rect.width,view.rect.height,
            wmtFrame?.canvas ? String(wmtFrame.canvas) : '',
            wmtFrame?.matrix ? [wmtFrame.matrix.a,wmtFrame.matrix.b,
                wmtFrame.matrix.c,wmtFrame.matrix.d,wmtFrame.matrix.e,wmtFrame.matrix.f]
                .map(v=>v.toFixed(5)).join(',') : ''].join('|');
        const motionNow=performance.now();
        if (motionSignature!==orderLastMotionSignature) {
            orderLastMotionSignature=motionSignature;
            orderMotionChangedAt=motionNow;
            if (wmtZoomGesture) wmtZoomGesture.lastMotion=motionNow;
            startOrderAnimation(480);
        }
        if (wmtZoomGesture) {
            const stableFor=motionNow-Math.max(wmtZoomGesture.lastMotion,wmtZoomGesture.lastInput);
            // Moveend + assestamento: ripristina le frecce quando la vista è stabile.
            // Fallback bounded per siti che non pubblicano l'URL dello zoom.
            if ((wmtZoomGesture.viewUpdated && stableFor>=WMT_ZOOM_STABLE_MS) ||
                (motionNow-wmtZoomGesture.started>WMT_ZOOM_MAX_MS && stableFor>=WMT_ZOOM_STABLE_MS)) {
                wmtZoomGesture=null;
            }
        }
        if (!isWmt() && osmZoomGesture) {
            const quietFor=osmNow-Math.max(osmZoomGesture.lastChange,osmZoomGesture.lastInput);
            // In presenza di un cambio zoom, aspetta che la vista si assesti.
            // Un gesto che non ha prodotto zoom non deve nascondere le frecce a lungo.
            if ((osmZoomGesture.viewUpdated && quietFor>=OSM_ZOOM_STABLE_MS) ||
                (osmNow-osmZoomGesture.started>=OSM_ZOOM_MAX_MS && quietFor>=OSM_ZOOM_STABLE_MS))
                osmZoomGesture=null;
        }
        const arrowsHidden=Boolean(isWmt() ? wmtZoomGesture : osmZoomGesture);
        const transformText = visualMatrix
            ? `matrix(${[visualMatrix.a,visualMatrix.b,visualMatrix.c,
                visualMatrix.d,visualMatrix.e,visualMatrix.f].join(',')})`
            : 'none';
        // Aggiornamento leggero a ogni frame: nessun DOM rebuild durante zoom.
        if (orderRenderSignature===baseSignature && overlay.firstElementChild) {
            const oldSvg=overlay.firstElementChild;
            oldSvg.style.transformOrigin='0 0';
            oldSvg.style.transform=transformText;
            const oldArrows=oldSvg.querySelector('#osm2cai-map-arrows');
            if (oldArrows) oldArrows.style.visibility=arrowsHidden?'hidden':'visible';
            const oldPins=oldSvg.querySelector('#osm2cai-map-problems');
            if (oldPins) oldPins.style.visibility=arrowsHidden?'hidden':'visible';
            return;
        }
        orderRenderSignature=baseSignature;
        const project = point => {
            let dx=point.lon-lon; dx=((dx+540)%360)-180;
            const originalX=rect.width/2+dx/360*scale;
            const originalY=rect.height/2-(mercY(point.lat)-centerY)/(2*Math.PI)*scale;
            return {x:originalX+(!wmtFrame && view.source!=='tiles' ? orderDragOffset.x : 0),
                    y:originalY+(!wmtFrame && view.source!=='tiles' ? orderDragOffset.y : 0)};
        };
        const arrowLayer=document.createElementNS(ns,'g');
        arrowLayer.id='osm2cai-map-arrows';
        arrowLayer.style.visibility=arrowsHidden?'hidden':'visible';
        svg.appendChild(arrowLayer);
        // OpenStreetMap non evidenzia di norma la geometria delle relazioni
        // figlie: disegniamo il percorso della super-relazione come anteprima
        // visiva non interattiva. Le singole way restano inalterate su OSM.
        // Il tracciato resta visibile anche quando lo zoom nasconde le frecce.
        if (!isWmt() && orderNestedGeometryVisible && orderMapArrows.length) {
            const pieces=[];
            const margin=48;
            let previous=null;
            for (const segment of orderMapArrows) {
                const a=project(segment.a), b=project(segment.b);
                if (![a.x,a.y,b.x,b.y].every(Number.isFinite)) continue;
                // Scarta solo i segmenti interamente fuori dalla stessa parte
                // del viewport, senza perdere quelli che lo attraversano.
                if ((a.x < -margin && b.x < -margin) ||
                    (a.x > rect.width+margin && b.x > rect.width+margin) ||
                    (a.y < -margin && b.y < -margin) ||
                    (a.y > rect.height+margin && b.y > rect.height+margin)) {
                    previous=null; continue;
                }
                if (!previous || Math.hypot(a.x-previous.x,a.y-previous.y)>0.2)
                    pieces.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}`);
                pieces.push(`L${b.x.toFixed(1)},${b.y.toFixed(1)}`);
                previous=b;
            }
            if (pieces.length) {
                const geometryLayer=document.createElementNS(ns,'g');
                geometryLayer.id='osm2cai-nested-geometry';
                geometryLayer.setAttribute('aria-label','Geometria delle sottorelazioni OSM');
                for (const [color,width,opacity] of [
                    ['#ffffff','7','0.85'],['#c026d3','4','0.92']]) {
                    const path=document.createElementNS(ns,'path');
                    path.setAttribute('d',pieces.join(' '));
                    path.setAttribute('fill','none');
                    path.setAttribute('stroke',color);
                    path.setAttribute('stroke-width',width);
                    path.setAttribute('stroke-linecap','round');
                    path.setAttribute('stroke-linejoin','round');
                    path.setAttribute('stroke-opacity',opacity);
                    geometryLayer.appendChild(path);
                }
                svg.insertBefore(geometryLayer,arrowLayer);
            }
        }
        if (orderMapArrowsVisible) {
            // Frecce distribuite per distanza sul tracciato proiettato, non per way.
            // Distanza adattiva in pixel, costante anche cambiando zoom.
            const spacing=100, edgePadding=35, minSeparation=48;
            let walked=0, next=spacing/2;
            const placed=[];
            for (const segment of orderMapArrows) {
                const a=project(segment.a), b=project(segment.b);
                const length=Math.hypot(b.x-a.x,b.y-a.y);
                if (!Number.isFinite(length) || length<0.01) continue;
                // Salta direttamente i campioni fuori da questo segmento.
                while (next<=walked+length) {
                    const t=(next-walked)/length;
                    const x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
                    next+=spacing;
                    if (x<edgePadding || x>rect.width-edgePadding ||
                        y<edgePadding || y>rect.height-edgePadding) continue;
                    // Evita marcatori sovrapposti dove il sentiero fa tornanti.
                    if (placed.some(p=>Math.hypot(p.x-x,p.y-y)<minSeparation)) continue;
                    placed.push({x,y});
                    const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
                    const group=document.createElementNS(ns,'g');
                    group.setAttribute('transform',`translate(${x} ${y}) rotate(${angle})`);
                    group.setAttribute('aria-label','Verso di percorrenza: way '+segment.id);
                    group.style.pointerEvents='none';
                    for (const [color,width] of [['#ffffff','8'],['#1675e8','5']]) {
                        const mark=document.createElementNS(ns,'path');
                        mark.setAttribute('d','M -7 -8 L 3 0 L -7 8');
                        mark.setAttribute('fill','none');
                        mark.setAttribute('stroke',color);
                        mark.setAttribute('stroke-width',width);
                        mark.setAttribute('stroke-linecap','round');
                        mark.setAttribute('stroke-linejoin','round');
                        group.appendChild(mark);
                    }
                    arrowLayer.appendChild(group);
                }
                walked+=length;
            }
        }
        const problemLayer=document.createElementNS(ns,'g');
        problemLayer.id='osm2cai-map-problems';
        problemLayer.style.visibility=arrowsHidden?'hidden':'visible';
        svg.appendChild(problemLayer);
        for (const issue of [...orderMapIssues].sort((a,b)=>Number(String(a.id)===String(selectedGuidepostId))-Number(String(b.id)===String(selectedGuidepostId)))) {
            const {x,y}=project(issue);
            if (x < -30 || x > rect.width+30 || y < -30 || y > rect.height+30) continue;
            const group=document.createElementNS(ns,'a');
            const link=issue.type==='guidepost' ? 'https://www.openstreetmap.org/node/'+encodeURIComponent(issue.id) : 'https://www.openstreetmap.org/edit?editor=id#map=18/'+issue.lat.toFixed(6)+'/'+issue.lon.toFixed(6);
            group.setAttribute('href',link);group.setAttribute('target','_blank');
            group.setAttribute('rel','noopener noreferrer');
            group.setAttribute('aria-label',(issue.type==='guidepost'?'Segnaletica: ':'Modifica in iD: ')+issue.detail);
            const title=document.createElementNS(ns,'title');title.textContent=issue.detail;group.appendChild(title);
            group.style.pointerEvents='auto';group.style.cursor='pointer';
            const selected=issue.type==='guidepost' && String(issue.id)===String(selectedGuidepostId);
            if(selected){
                const halo=document.createElementNS(ns,'circle');
                halo.setAttribute('cx',x);halo.setAttribute('cy',y);
                halo.setAttribute('r','22');halo.setAttribute('fill','none');
                halo.setAttribute('stroke','#facc15');halo.setAttribute('stroke-width','6');
                halo.setAttribute('aria-label','Nodo selezionato sulla mappa');
                group.appendChild(halo);
            }
            const circle=document.createElementNS(ns,'circle');
            circle.setAttribute('cx',x);circle.setAttribute('cy',y);
            circle.setAttribute('r',selected?'16':issue.type==='branch'?'13':issue.type==='overlap'?'14':'12');
            circle.setAttribute('fill',issue.type==='guidepost'?
                ({green:'#16845b',orange:'#d97706',red:'#dc2626'}[issue.status] || (issue.valid?'#16845b':'#d97706')):
                issue.type==='branch'?'#e9a419':issue.type==='overlap'?'#9333ea':'#e63434');
            circle.setAttribute('stroke','white');circle.setAttribute('stroke-width',selected?'4':'3');
            circle.setAttribute('opacity','.95');
            const label=document.createElementNS(ns,'text');
            label.setAttribute('x',x);label.setAttribute('y',y+4.2);
            label.setAttribute('text-anchor','middle');label.setAttribute('font-size','11');
            label.setAttribute('font-family','system-ui,sans-serif');label.setAttribute('font-weight','700');
            label.setAttribute('fill','#fff');label.style.pointerEvents='none';label.textContent=issue.label;
            group.append(circle,label);problemLayer.appendChild(group);
        }
        svg.style.transformOrigin='0 0';
        svg.style.transform=transformText;
        overlay.replaceChildren(svg);
        if (!isWmt()) {
            osmTraceBaseView={zoom:view.zoom,lat:view.lat,lon:view.lon,
                rectWidth:rect.width,rectHeight:rect.height};
            osmTraceTween=null;
        }
    }

    // Inquadra la geometria della relazione quando si apre un'analisi con
    // problemi. Nessuna modifica ai layer o ai dati OSM. La mappa viene
    // centrata una sola volta per apertura, non a ogni ridisegno degli SVG.
    function focusOrderGeometry(full, relationId, popupId = 'order-popover') {
        if (!full || String(relationId)!==String(relationIdFromUrl())) return false;
        if (isWmt()) {
            // WMT legge `map=` dal fragment solo quando crea la mappa, non
            // quando cambia l'hash della stessa relazione. Perciò aggiornare
            // location.hash non sposta la vista OpenLayers già inizializzata.
            // Usa il pulsante nativo "Zoom to" nel footer dei dettagli WMT:
            // chiama map_state.set_map_view(bbox), quindi inquadra la route
            // con il motore della mappa e mantiene i pin georeferenziati.
            let attempts=0;
            const focusNative = () => {
                if (String(relationId)!==String(relationIdFromUrl()) ||
                    !document.getElementById('osm2cai-'+popupId) ||
                    document.getElementById('osm2cai-'+popupId).hidden) return;
                const panel=[...document.querySelectorAll('.sidepanel')].find(el=>{
                    const rect=el.getBoundingClientRect();
                    return rect.width>150 && rect.height>150 &&
                        el.querySelector('.sidepanel-footer button') &&
                        // Il pulsante compare prima della risposta API WMT:
                        // attendi che i dettagli della relazione siano caricati.
                        el.querySelector('.sidepanel-content .properties');
                });
                const button=panel?.querySelector('.sidepanel-footer button');
                if (button && !button.disabled) {
                    button.click();
                    startOrderAnimation(1000);
                } else if (++attempts<20) {
                    setTimeout(focusNative,150);
                }
            };
            focusNative();
            return true;
        }
        // Anche durante il primo caricamento la mappa OSM potrebbe non avere
        // ancora tessere leggibili o un parametro #map. Per l'inquadratura
        // bastano comunque le dimensioni del contenitore e il full.json.
        const view=orderView();
        const mapRect=view?.rect || findOrderMapElement()?.getBoundingClientRect();
        if (!mapRect || mapRect.width<100 || mapRect.height<100) return false;
        const wayById=new Map((full.elements||[]).filter(e=>e.type==='way').map(e=>[String(e.id),e]));
        const nodeById=new Map((full.elements||[]).filter(e=>e.type==='node').map(e=>[String(e.id),e]));
        const geometry=relationGeometryMembers(full,relationId);
        let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity,count=0;
        const seenWays=new Set();
        for (const member of geometry.members) {
            const id=String(member.ref);
            if (seenWays.has(id)) continue;
            seenWays.add(id);
            const way=wayById.get(id);
            for (const nodeId of way?.nodes||[]) {
                const n=nodeById.get(String(nodeId));
                if (!Number.isFinite(n?.lat)||!Number.isFinite(n?.lon)) continue;
                minLat=Math.min(minLat,n.lat);maxLat=Math.max(maxLat,n.lat);
                minLon=Math.min(minLon,n.lon);maxLon=Math.max(maxLon,n.lon);
                count++;
            }
        }
        if (!count || maxLon-minLon>180) return false;
        const lat=(minLat+maxLat)/2,lon=(minLon+maxLon)/2;
        const mercY=value=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,value))*Math.PI/360));
        const dy=Math.abs(mercY(maxLat)-mercY(minLat))/(2*Math.PI);
        const dx=Math.max(0,(maxLon-minLon)/360);
        const padding=70;
        const usableWidth=Math.max(140,mapRect.width-2*padding);
        const usableHeight=Math.max(120,mapRect.height-2*padding);
        const zoom=Math.max(3,Math.min(18,Math.floor(Math.min(
            Math.log2(usableWidth/(256*Math.max(dx,1e-10))),
            Math.log2(usableHeight/(256*Math.max(dy,1e-10)))))));
        if (![lat,lon,zoom].every(Number.isFinite)) return false;
        // Il comando Analisi geometria deve eseguire lo stesso zoom esplicito
        // dell'azione nativa di WMT, anche se il tracciato risulta gia' visibile.
        // Non dipendere dalla posizione iniziale e non scartare parametri hash.
        const mapHash=`${zoom}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
        const other=location.hash.replace(/^#/, '').split('&')
            .filter(part=>part && !part.startsWith('map='));
        const targetHash='map='+mapHash+(other.length?'&'+other.join('&'):'');
        if (location.hash.slice(1)!==targetHash) location.hash=targetHash;
        startOrderAnimation(1000);
        return true;
    }

    // Restituisce solo veri file di Commons: wikimedia_commons può indicare
    // anche una categoria, dalla quale non è possibile ricavare una singola foto.
    function guidepostCommonsFile(value) {
        if (typeof value !== 'string') return null;
        let name=value.trim();
        if (!name || name.length>500) return null;
        const urlMatch=name.match(/^https:\/\/commons\.wikimedia\.org\/wiki\/(File|Image):(.+)$/i);
        if (urlMatch) {
            try { name='File:'+decodeURIComponent(urlMatch[2]).replace(/_/g,' '); }
            catch (_) { return null; }
        }
        if (!/^(?:File|Image):/i.test(name)) return null;
        name=name.replace(/^(?:File|Image):/i,'').trim();
        if (!name || /[\x00-\x1f\x7f#?]/.test(name) || name.includes('/') || name.includes('\\')) return null;
        return name;
    }

    function guidepostCommonsImageUrl(name, width) {
        // Endpoint Wikimedia per riutilizzare file: diversamente dall'URL thumbnail
        // costruito a mano, il redirect conosce il file effettivamente pubblicato.
        const params=new URLSearchParams({title:'Special:Redirect/file/'+name.replace(/ /g,'_')});
        if(width) params.set('width',String(width));
        return 'https://commons.wikimedia.org/w/index.php?'+params;
    }

    const commonsImageCache=new Map();
    function guidepostCommonsInfo(name) {
        if(commonsImageCache.has(name)) return commonsImageCache.get(name);
        // URL canonicali ricavati dalla MediaWiki Action API (imageinfo).
        const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',
            prop:'imageinfo',iiprop:'url|mime',iiurlwidth:'400',
            titles:'File:'+name,origin:'*'});
        const promise=new Promise(resolve=>{
            let settled=false;
            const finish=value=>{if(!settled){settled=true;resolve(value);}};
            try {
                GM_xmlhttpRequest({method:'GET',url:'https://commons.wikimedia.org/w/api.php?'+params,
                    timeout:12000,
                    onload:r=>{
                        try {
                            if(r.status<200||r.status>=300) return finish(null);
                            const data=JSON.parse(r.responseText);
                            const item=data?.query?.pages?.[0]?.imageinfo?.[0];
                            const valid=url=>{
                                try {const u=new URL(url);return u.protocol==='https:' &&
                                    (u.hostname==='upload.wikimedia.org'||u.hostname==='commons.wikimedia.org');}
                                catch(_){return false;}
                            };
                            finish(item&&valid(item.url)?{
                                thumbnail:valid(item.thumburl)?item.thumburl:item.url,
                                original:item.url
                            }:null);
                        } catch(_) {finish(null);}
                    },onerror:()=>finish(null),ontimeout:()=>finish(null)});
            } catch(_) {finish(null);}
        });
        commonsImageCache.set(name,promise);
        return promise;
    }

    // Fonti successive solo in caso di errore di caricamento.
    function guidepostSetImageSources(img, urls, onFail) {
        const sources=[...new Set(urls.filter(Boolean))];
        let index=0;
        img.onerror=()=>{
            if(index<sources.length) img.src=sources[index++];
            else {img.onerror=null;onFail?.();}
        };
        if(index<sources.length) img.src=sources[index++];
        else onFail?.();
    }

    let guidepostLightbox=null;
    function closeGuidepostLightbox() {
        if (!guidepostLightbox) return;
        const {overlay,onKey}=guidepostLightbox;
        document.removeEventListener('keydown',onKey,true);
        overlay.remove();
        guidepostLightbox=null;
    }
    function openGuidepostLightbox(name) {
        closeGuidepostLightbox();
        const overlay=document.createElement('div');
        overlay.id='osm2cai-guidepost-lightbox';
        overlay.setAttribute('role','dialog');
        overlay.setAttribute('aria-modal','true');
        overlay.setAttribute('aria-label','Fotografia Wikimedia Commons');
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:38px 16px;box-sizing:border-box;cursor:zoom-out;';
        const img=document.createElement('img');
        img.alt='Fotografia Wikimedia Commons: '+name;
        img.style.cssText='display:block;max-width:100%;max-height:100%;object-fit:contain;cursor:default;';
        img.addEventListener('click',event=>event.stopPropagation());
        const close=document.createElement('button');
        close.type='button';close.textContent='×';close.setAttribute('aria-label','Chiudi fotografia');
        close.style.cssText='position:absolute;top:9px;right:14px;border:0;background:transparent;color:white;font:32px system-ui;cursor:pointer;';
        close.addEventListener('click',closeGuidepostLightbox);
        overlay.addEventListener('pointerdown',event=>event.stopPropagation());
        overlay.addEventListener('click',event=>{event.stopPropagation();if(event.target===overlay)closeGuidepostLightbox();});
        const onKey=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeGuidepostLightbox();}};
        document.addEventListener('keydown',onKey,true);
        overlay.append(img,close);
        document.body.appendChild(overlay);
        guidepostCommonsInfo(name).then(info=>{
            if(!overlay.isConnected) return;
            guidepostSetImageSources(img,[info?.original,guidepostCommonsImageUrl(name)],()=>{
                img.alt='Impossibile caricare la fotografia Wikimedia Commons';
            });
        });
        guidepostLightbox={overlay,onKey};
        close.focus();
    }

    // Solo membri diretti: non attribuire alla radice i ruoli delle sottorelazioni.
    function guidepostAnalysis(full, relationId) {
        const elements=full?.elements||[];
        const relation=elements.find(e=>e.type==='relation' && String(e.id)===String(relationId));
        if (!relation) return null;
        const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[String(e.id),e]));
        const grouped=new Map();
        for (const member of relation.members||[]) {
            const node=member.type==='node'?nodes.get(String(member.ref)):null;
            // Individua i guidepost esclusivamente dai due tag del nodo,
            // indipendentemente dal ruolo assegnato al membro della relazione.
            if (member.type!=='node' || node?.tags?.information!=='guidepost' ||
                node.tags.tourism!=='information') continue;
            const key=member.type+'/'+member.ref;
            if (!grouped.has(key)) grouped.set(key,{id:member.ref,type:member.type,node,roles:[]});
            grouped.get(key).roles.push(member.role||'');
        }
        return [...grouped.values()].map(item=>{
            const checks=[['tourism','information'],['information','guidepost'],['hiking','yes']].map(([key,expected])=>({key,expected,value:item.node?.tags?.[key],ok:item.node?.tags?.[key]===expected}));
            const missing=item.type==='node' && !item.node;
            const valid=item.type==='node' && !missing && checks.every(c=>c.ok) && item.roles.every(role=>role==='guidepost') && item.roles.length===1;
            // Una mancanza correggibile e' arancione; un valore esplicitamente
            // errato o un membro duplicato e' rosso. La stessa classificazione
            // viene usata per i pin su WMT e su OpenStreetMap.
            const definiteError=item.roles.length!==1 || checks.some(c=>c.value!==undefined && !c.ok) ||
                item.roles.some(role=>role!=='' && role!=='guidepost');
            const status=valid?'green':definiteError?'red':'orange';
            return {...item,checks,missing,valid,status};
        });
    }

    function updateGuidepostIndicator(full, relationId) {
        const dot=$('guidepost-dot');
        if (!dot) return;
        const rows=guidepostAnalysis(full,relationId);
        // Priorità: rosso > arancione > verde; grigio quando non sono stati
        // individuati guidepost nella relazione (o i dati non sono disponibili).
        // Stessa funzione per OSM e Waymarked Trails.
        const state=!rows || rows.length===0 ? 'gray' :
            rows.some(r=>r.status==='red') ? 'red' :
            rows.some(r=>r.status==='orange') ? 'orange' : 'green';
        const colors={gray:'#94a3b8',green:'#22c55e',red:'#ef4444',orange:'#f59e0b'};
        // Un cerchio SVG reale evita che OSM nasconda gli span vuoti o
        // ne sovrascriva il colore di sfondo. Aggiorniamo l'attributo SVG,
        // non il background CSS di un elemento vuoto.
        const circle=dot.querySelector('circle');
        if (circle) {
            circle.setAttribute('fill',colors[state]);
            circle.style.setProperty('fill',colors[state],'important');
            circle.style.setProperty('display','block','important');
            circle.style.setProperty('visibility','visible','important');
            circle.style.setProperty('opacity','1','important');
        }
        dot.style.setProperty('display','block','important');
        dot.style.setProperty('visibility','visible','important');
        dot.style.setProperty('opacity','1','important');
        dot.title=!rows?'Analisi segnaletica non disponibile':
            rows.length===0?'Nessun nodo di segnaletica presente nella relazione':
            state==='green'?'Tutti i nodi della segnaletica sono conformi':
            state==='orange'?'Segnaletica da completare: tag hiking=yes o ruolo guidepost mancante':
            'Segnaletica con errori: valori non conformi, ruoli errati o membri duplicati';
        $('guidepost-button')?.setAttribute('aria-label','Analisi segnaletica — '+dot.title);
    }

    function closeGuidepostPopover() {
        closeGuidepostLightbox();
        const popup=$('guidepost-popover');
        if (popup) {
            popup.hidden=true;
            popup.style.setProperty('display','none','important');
        }
        $('guidepost-button')?.setAttribute('aria-expanded','false');
        if (orderMapIssues.some(issue=>issue.type==='guidepost')) clearOrderMap();
        selectedGuidepostId=null;
    }

    function renderGuidepostAnalysis() {
        const output=$('guidepost-results');
        if (!output) return;
        output.replaceChildren();
        // Ogni nuova apertura inizia senza alcun guidepost selezionato.
        selectedGuidepostId=null;
        const rows=guidepostAnalysis(orderFull,orderRelationId);
        if (!rows) {
            output.textContent='Dati OSM non disponibili. Attendi il caricamento; se non riesce, riapri la barra per riprovare.';
            return;
        }
        const add=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;};
        const correct=rows.filter(r=>r.valid).length;
        // Ogni nodo non conforme, inclusi i dati mancanti, è nel filtro da verificare.
        const summary=add(output,'div','');
        summary.style.cssText='display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:8px 0 12px;';
        let activeGuidepostFilter='all';
        const filters=[
            {key:'all',label:`${rows.length} totale`,color:'inherit'},
            {key:'valid',label:`✓ ${correct} ${correct===1?'conforme':'conformi'}`,color:'#16845b'},
            {key:'invalid',label:`⚠ ${rows.length-correct} da verificare`,color:'#b45c2b'}
        ];
        const filterButtons=new Map();
        let applyGuidepostFilter=()=>{};
        filters.forEach((filter,index)=>{
            if(index) add(summary,'span','|').style.cssText='opacity:.45;user-select:none;';
            const button=add(summary,'button',filter.label);
            button.type='button';button.style.cssText='background:transparent;border:0;border-radius:3px;padding:2px 1px;font:600 12px system-ui,sans-serif;cursor:pointer;color:'+filter.color+';';
            button.setAttribute('aria-label','Mostra '+(filter.key==='all'?'tutti i nodi':filter.key==='valid'?'solo i conformi':'solo i nodi da verificare'));
            filterButtons.set(filter.key,button);
            button.addEventListener('click',()=>{activeGuidepostFilter=filter.key;applyGuidepostFilter();});
        });
        if (!rows.length) {add(output,'p','Nessun nodo membro con tourism=information e information=guidepost.');styleGuidepostPopover();focusOrderGeometry(orderFull,orderRelationId,'guidepost-popover');return;}
        // Correzione massiva: aggiungi solo tag assenti e ruoli vuoti.
        // Non modificare tag discordanti, membri non-node o duplicati.
        const rel=orderFull.elements.find(e=>e.type==='relation' && String(e.id)===String(orderRelationId));
        const edits=[],roles=[];
        for(const row of rows){
            if(row.type!=='node' || !row.node || !Number.isSafeInteger(row.node.version) ||
                row.roles.length!==1 || !Number.isSafeInteger(Number(row.id))) continue;
            const addTags={};
            for(const check of row.checks) if(check.value===undefined) addTags[check.key]=check.expected;
            if(Object.keys(addTags).length) edits.push({id:String(row.id),version:row.node.version,add:addTags});
            if(row.roles[0]===''){
                const index=rel?.members?.findIndex(m=>m.type==='node' && String(m.ref)===String(row.id));
                if(index>=0) roles.push({id:String(row.id),index});
            }
        }
        // Ruolo mancante su nodo senza tag da inserire: includi il nodo nel preflight.
        for(const role of roles){
            if(!edits.some(e=>e.id===role.id)){
                const row=rows.find(r=>String(r.id)===role.id);
                edits.push({id:role.id,version:row.node.version,add:{}});
            }
        }
        const pins=rows.filter(r=>Number.isFinite(r.node?.lat)&&Number.isFinite(r.node?.lon)).map(r=>({
            type:'guidepost',id:r.id,lat:r.node.lat,lon:r.node.lon,valid:r.valid,status:r.status,label:String(rows.indexOf(r)+1),
            detail:`${r.node.tags?.name||r.node.tags?.ref||'Nodo '+r.id} — ${r.status==='green'?'conforme':r.status==='red'?'errore':'da completare'}`
        }));
        const list=add(output,'div','');
        list.style.cssText='max-height:min(240px,34vh);overflow:auto;overscroll-behavior:contain;position:relative;';
        const table=add(list,'table','');table.className='oc-guidepost-table';
        table.style.cssText='width:100%;min-width:0;border-collapse:separate;border-spacing:0;table-layout:fixed;font:12px/1.25 system-ui,sans-serif;color:inherit;';
        // Intestazione a due livelli: ID nodo | Tag (quattro sottocolonne) | Ruolo membro.
        // Il colgroup governa le larghezze senza attribuirle alla cella Tag con colspan.
        const widths=[23,13,18,12,18,16];
        const colgroup=add(table,'colgroup','');
        widths.forEach(width=>{
            const col=add(colgroup,'col','');
            col.style.width=width+'%';
        });
        const thead=add(table,'thead','');
        const groupRow=add(thead,'tr','');
        const osmHead=add(groupRow,'th','ID nodo');
        osmHead.scope='col';osmHead.rowSpan=2;
        const tagHead=add(groupRow,'th','Tag');
        tagHead.scope='colgroup';tagHead.colSpan=4;
        const roleHead=add(groupRow,'th','');
        roleHead.replaceChildren(document.createTextNode('Ruolo'),document.createElement('br'),document.createTextNode('membro'));
        roleHead.scope='col';roleHead.rowSpan=2;
        const tagsRow=add(thead,'tr','');
        ['tourism','information','hiking','wikimedia_commons'].forEach((label,index)=>{
            const cell=add(tagsRow,'th',index===3?'':label);cell.scope='col';
            if(index===3) cell.replaceChildren(document.createTextNode('wikimedia'),document.createElement('br'),document.createTextNode('commons'));
        });
        // Intestazione fissa, con due livelli distinti durante lo scorrimento.
        for(const cell of thead.querySelectorAll('th')){
            const secondLevel=cell.parentElement===tagsRow;
            cell.style.cssText='position:sticky;z-index:3;box-sizing:border-box;padding:2px 1px;'+
                'background:#eff3f3;color:inherit;border-bottom:1px solid #8797ac88;'+
                'text-align:center;vertical-align:middle;overflow-wrap:normal;'+
                'font:600 '+(cell.textContent==='wikimediacommons'?'10':'12')+'px/1.25 system-ui,sans-serif;'+
                'height:'+(secondLevel?'34':'24')+'px;top:'+(secondLevel?'24':'0')+'px;';
        }
        for(const cell of [osmHead,roleHead]) cell.style.height='58px';
        // Linee verticali sottili distinguono la colonna ID e il ruolo dai quattro tag.
        tagHead.style.borderLeft='1px solid #8797ac55';
        roleHead.style.borderLeft='1px solid #8797ac55';
        const body=add(table,'tbody','');
        // Anteprima esterna al contenitore con scroll: sempre sotto la tabella.
        const photoArea=add(output,'div','');
        photoArea.className='oc-guidepost-photo';
        photoArea.hidden=true;
        photoArea.style.cssText='margin:10px 0 2px;text-align:center;';
        let photoRequest=0;
        const showGuidepostPhoto=row=>{
            const request=++photoRequest;
            photoArea.replaceChildren();
            photoArea.hidden=true;
            const raw=row?.node?.tags?.wikimedia_commons;
            if(!raw) return;
            const file=guidepostCommonsFile(raw);
            if(!file){
                const info=add(photoArea,'div','');
                info.style.cssText='font:12px system-ui,sans-serif;opacity:.75;';
                info.textContent='Wikimedia Commons: '+String(raw)+' (nessuna immagine singola associata)';
                photoArea.hidden=false;
                return;
            }
            const thumbnail=add(photoArea,'button','');
            thumbnail.type='button';
            thumbnail.setAttribute('aria-label','Ingrandisci fotografia Wikimedia Commons');
            thumbnail.title='Clicca per vedere la fotografia a schermo intero';
            thumbnail.style.cssText='display:inline-block;max-width:100%;padding:0;border:0;background:transparent;cursor:zoom-in;';
            const img=document.createElement('img');
            img.alt='Fotografia Wikimedia Commons';
            img.loading='eager';
            img.style.cssText='display:block;max-width:100%;max-height:180px;width:auto;height:auto;margin:0 auto;border-radius:5px;';
            // Non inserire l'immagine nel DOM prima del caricamento: in caso di
            // errore il browser può mostrare il nome del file come testo alternativo.
            const loading=document.createElement('span');
            loading.textContent='Caricamento...';
            loading.style.cssText='display:inline-block;font:12px system-ui,sans-serif;opacity:.75;padding:12px 0;';
            thumbnail.appendChild(loading);
            img.onload=()=>{
                if(request!==photoRequest || !photoArea.isConnected) return;
                thumbnail.replaceChildren(img);
            };
            const fail=()=>{
                if(request!==photoRequest || !photoArea.isConnected) return;
                img.onload=null;
                thumbnail.replaceChildren(document.createTextNode('Impossibile caricare la miniatura Wikimedia Commons.'));
                thumbnail.disabled=true;
            };
            guidepostCommonsInfo(file).then(info=>{
                if(request!==photoRequest || !photoArea.isConnected) return;
                guidepostSetImageSources(img,[info?.thumbnail,
                    guidepostCommonsImageUrl(file,400),guidepostCommonsImageUrl(file)],fail);
            }).catch(fail);
            thumbnail.addEventListener('click',event=>{event.stopPropagation();openGuidepostLightbox(file);});
            photoArea.hidden=false;
        };
        const buttons=[];
        const select=row=>{
            selectedGuidepostId=String(row.id);
            showGuidepostPhoto(row);
            for(const entry of buttons){
                const selected=entry.row===row;
                entry.item.setAttribute('aria-selected',String(selected));
                entry.item.style.background=selected?'rgba(22,131,88,.16)':'transparent';
            }
            orderRenderSignature=null;
            renderOrderMapOverlay();
            startOrderAnimation(700);
        };
        rows.forEach(row=>{
            const item=add(body,'tr','');item.style.cssText='height:33px;border-bottom:1px solid #8797ac33;cursor:pointer;';
            const cell=add(item,'td','');
            const link=add(cell,'a',String(row.id));
            link.href='https://www.openstreetmap.org/node/'+encodeURIComponent(row.id);
            link.target='_blank';link.rel='noopener noreferrer';
            link.style.cssText='color:#2367b2;text-decoration:underline;text-underline-offset:2px;white-space:nowrap;font:inherit;';
            link.setAttribute('aria-label','Apri nodo OSM '+row.id+' in nuova scheda');
            buttons.push({row,item});
            item.addEventListener('click',()=>select(row));
            const checks=[...row.checks,{key:'wikimedia_commons',value:row.node?.tags?.wikimedia_commons,optional:true,ok:Boolean(row.node?.tags?.wikimedia_commons)},{key:'ruolo',expected:'guidepost',value:row.roles.map(r=>r||'(vuoto)').join(', '),ok:row.roles.every(r=>r==='guidepost')&&row.roles.length===1}];
            checks.forEach((check,index)=>{
                const unknown=(index<3||check.optional)&&(row.missing||row.type!=='node');
                const status=unknown?'non verificabile':check.optional?(check.ok?'presente: '+check.value:'facoltativo, assente'):check.ok?'conforme':`atteso ${check.expected}; attuale ${check.value??'assente'}`;
                const symbol=unknown?'?':check.optional?(check.ok?'✓':'—'):check.ok?'✓':'⚠';
                const cell=add(item,'td','');
                cell.style.cssText=`text-align:center;vertical-align:middle;height:33px;padding:2px;font-size:17px;line-height:1;color:${unknown||check.optional&&!check.ok?'#8797ac':check.ok?'#16845b':'#b45c2b'};`;
                const mark=add(cell,'span',symbol);
                mark.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;text-align:center;line-height:1;';
                if(index===0 || index===4) cell.style.borderLeft='1px solid #8797ac55';
                cell.title=`${check.key}: ${status}`;cell.setAttribute('aria-label',cell.title);
            });
        });
        const emptyFilter=add(list,'p','');
        emptyFilter.style.cssText='display:none;margin:12px 4px;opacity:.75;font:12px system-ui,sans-serif;';
        applyGuidepostFilter=()=>{
            let count=0;
            for(const entry of buttons){
                const visible=activeGuidepostFilter==='all' ||
                    (activeGuidepostFilter==='valid'?entry.row.valid:!entry.row.valid);
                entry.item.style.display=visible?'':'none';
                if(visible) count++;
                else if(String(selectedGuidepostId)===String(entry.row.id)){
                    selectedGuidepostId=null;
                    showGuidepostPhoto(null);
                    entry.item.setAttribute('aria-selected','false');
                    entry.item.style.background='transparent';
                    orderRenderSignature=null;
                    renderOrderMapOverlay();
                }
            }
            emptyFilter.textContent=activeGuidepostFilter==='valid'?'Nessun nodo conforme.':'Nessun nodo da verificare.';
            emptyFilter.style.display=count?'none':'block';
            table.style.display=count?'':'none';
            for(const [key,button] of filterButtons){
                const selected=key===activeGuidepostFilter;
                button.setAttribute('aria-pressed',String(selected));
                button.style.textDecoration=selected?'underline':'none';
                button.style.textUnderlineOffset='4px';
            }
        };
        applyGuidepostFilter();
        showOrderMap(pins);
        const batch=add(output,'div','');
        batch.style.cssText='display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:12px 0 0;';
        const editButton=add(batch,'button',`Aggiorna in iD editor (${edits.length} nodi)`);
        editButton.type='button';editButton.disabled=!edits.length;
        editButton.style.cssText='border:1px solid #16764c;border-radius:6px;padding:6px 11px;background:#168358;color:white;font:600 12px system-ui;cursor:pointer;';
        editButton.addEventListener('click',()=>{
            if(String(orderRelationId)!==String(relationIdFromUrl()) || !rel ||
                !Number.isSafeInteger(rel.version)) {alert('Relazione cambiata: ripeti l’analisi.');return;}
            if(edits.length>250){alert('Troppi nodi per un singolo intervento (massimo 250).');return;}
            const job={relationId:String(orderRelationId),relationVersion:rel.version,nodes:edits,roles};
            const hash='id=relation/'+encodeURIComponent(job.relationId)+
                '&osm2cai_guideposts='+encodeURIComponent(JSON.stringify(job));
            if(hash.length>90000){alert('Richiesta troppo grande per l’URL di iD.');return;}
            window.open('https://www.openstreetmap.org/id#'+hash,'_blank','noopener,noreferrer');
        });
        // La foto segue il comando di aggiornamento, non precede il pulsante.
        batch.after(photoArea);
        styleGuidepostPopover();
        // Entrambe le analisi inquadrano la geometria dell'intera relazione.
        // Su WMT resta attivo lo zoom nativo; su OSM lo stesso zoom di Analisi geometria.
        focusOrderGeometry(orderFull,orderRelationId,'guidepost-popover');
    }

    function showOrderMap(issues) {
        clearOrderMap();
        orderMapIssues=issues;
        orderMapVisible=true;
        orderLastView=null;
        orderDragOffset={x:0,y:0};
        orderRenderSignature = null;
        renderOrderMapOverlay();
        startOrderAnimation();
    }

    // Frecce distribuite lungo i segmenti della geometria, orientate secondo
    // la sequenza selezionata. Non cambiano i layer OSM/WMT né il grafo OSM.
    function orderArrowsForSequence(full, sequence) {
        const ways=new Map((full?.elements||[]).filter(e=>e.type==='way').map(e=>[String(e.id),e]));
        const nodes=new Map((full?.elements||[]).filter(e=>e.type==='node').map(e=>[String(e.id),e]));
        const segments=[];
        let cursor=null;
        for (let i=0;i<sequence.length;i++) {
            const way=ways.get(String(sequence[i].id));
            const ids=way?.nodes;
            if (!ids || ids.length<2) continue;
            const a=String(ids[0]), b=String(ids[ids.length-1]);
            if (i===0) {
                const next=ways.get(String(sequence[1]?.id));
                const na=String(next?.nodes?.[0]), nb=String(next?.nodes?.[next?.nodes?.length-1]);
                cursor=(a===na || a===nb) && !(b===na || b===nb) ? b : a;
            }
            const oriented=cursor===b ? [...ids].reverse() : ids;
            cursor=String(oriented[oriented.length-1]);
            for (let j=0;j<oriented.length-1;j++) {
                const n1=nodes.get(String(oriented[j]));
                const n2=nodes.get(String(oriented[j+1]));
                if ([n1?.lat,n1?.lon,n2?.lat,n2?.lon].every(Number.isFinite)) {
                    segments.push({id:String(sequence[i].id),
                        a:{lat:n1.lat,lon:n1.lon},b:{lat:n2.lat,lon:n2.lon}});
                }
            }
        }
        return segments;
    }

    function orderElevationHint(full, sequence) {
        // In OSM full.json la quota non è un attributo geometrico: può essere
        // presente soltanto nel tag ele dei nodi (e non va inventata).
        const ways=new Map((full?.elements||[]).filter(e=>e.type==='way').map(e=>[String(e.id),e]));
        const nodes=new Map((full?.elements||[]).filter(e=>e.type==='node').map(e=>[String(e.id),e]));
        if (!sequence?.length || sequence.length<2) return null;
        const first=ways.get(String(sequence[0].id));
        const second=ways.get(String(sequence[1].id));
        const last=ways.get(String(sequence[sequence.length-1].id));
        const beforeLast=ways.get(String(sequence[sequence.length-2].id));
        if (![first,second,last,beforeLast].every(w=>w?.nodes?.length>=2)) return null;
        const terminal=(way,neighbor)=>{
            const ends=[String(way.nodes[0]),String(way.nodes[way.nodes.length-1])];
            const adjacent=new Set([String(neighbor.nodes[0]),String(neighbor.nodes[neighbor.nodes.length-1])]);
            const unique=ends.filter(id=>!adjacent.has(id));
            return unique.length===1 ? unique[0] : null;
        };
        const startId=terminal(first,second),endId=terminal(last,beforeLast);
        if (!startId || !endId || startId===endId) return null;
        const ele=id=>{
            const raw=nodes.get(id)?.tags?.ele;
            if (typeof raw!=='string' || !/^[-+]?\d+(?:[.,]\d+)?(?:\s*m)?$/i.test(raw.trim())) return null;
            const value=Number(raw.trim().replace(/\s*m$/i,'').replace(',','.'));
            return Number.isFinite(value) && value>=-500 && value<=9000 ? value : null;
        };
        const start=ele(startId), end=ele(endId);
        return start===null || end===null ? null : {start,end};
    }

    function showOrderArrows(full, sequence) {
        // Mantiene anche le segnalazioni eventualmente già visualizzate.
        orderMapArrows=orderArrowsForSequence(full,sequence);
        // Le super-relazioni su OSM non hanno evidenziazione geometrica
        // nativa: traccia solo in questo caso le way già analizzate.
        orderNestedGeometryVisible=!isWmt() &&
            relationGeometryMembers(full,orderRelationId).nested>0;
        orderRenderSignature=null;
        orderMapArrowsVisible=orderMapArrows.length>0;
        orderRenderSignature = null;
        renderOrderMapOverlay();
        startOrderAnimation();
    }

    // Raccoglie le way anche nelle sottorelazioni, preservando le occorrenze.
    // Questa vista serve SOLO all'analisi: non autorizza alcun riordino in iD.
    function relationGeometryMembers(full, relationId) {
        const elements=full?.elements || [];
        const relations=new Map(elements.filter(e=>e.type==='relation').map(e=>[String(e.id),e]));
        const members=[], missing=new Set(), cycles=new Set();
        let nested=0;
        function visit(id, ancestors, depth) {
            const key=String(id);
            if (ancestors.has(key)) { cycles.add(key); return; }
            if (depth>12) { missing.add(key); return; }
            const rel=relations.get(key);
            if (!rel || !Array.isArray(rel.members)) { missing.add(key); return; }
            const next=new Set(ancestors); next.add(key);
            for (const member of rel.members) {
                if (member.type==='way') members.push(member);
                else if (member.type==='relation') { nested++; visit(member.ref,next,depth+1); }
            }
        }
        visit(relationId,new Set(),0);
        return {members,nested,missing:[...missing],cycles:[...cycles]};
    }

    // Grafo geometrico condiviso: ogni coppia di nodi consecutivi di una way
    // costituisce un segmento. Le occorrenze ripetute (anche invertite) non
    // aggiungono rami fittizi. Un incrocio senza nodo OSM condiviso non connette.
    function orderGeometryGraph(ways) {
        const neighbors = new Map();
        const segments = new Set();
        const segmentOwners = new Map();
        const ensure = id => {
            if (!neighbors.has(id)) neighbors.set(id, new Set());
        };
        for (const way of ways) {
            if (!Array.isArray(way?.nodes) || way.nodes.length < 2) continue;
            const ids = way.nodes.map(String);
            ids.forEach(ensure);
            for (let i = 1; i < ids.length; i++) {
                const a = ids[i-1], b = ids[i];
                if (a === b) continue; // Nodo consecutivo ripetuto: nessun ramo.
                const key = a < b ? a+'|'+b : b+'|'+a;
                if (!segmentOwners.has(key)) segmentOwners.set(key, new Set());
                segmentOwners.get(key).add(String(way.id));
                if (segments.has(key)) continue;
                segments.add(key);
                neighbors.get(a).add(b);
                neighbors.get(b).add(a);
            }
        }
        const components = [], visited = new Set();
        for (const root of neighbors.keys()) {
            if (visited.has(root)) continue;
            const group = [], stack = [root];
            while (stack.length) {
                const node = stack.pop();
                if (visited.has(node)) continue;
                visited.add(node); group.push(node);
                for (const next of neighbors.get(node)) if (!visited.has(next)) stack.push(next);
            }
            components.push(group);
        }
        const branchNodes = [...neighbors.keys()].filter(id => neighbors.get(id).size > 2);
        const ends = [...neighbors.keys()].filter(id => neighbors.get(id).size === 1);
        const overlappingSegments = [...segmentOwners.values()].filter(owners => owners.size > 1).length;
        return {neighbors, components, branchNodes, ends, overlappingSegments};
    }

    // Per componenti lineari seleziona le coppie di estremità più vicine.
    // L'albero minimo collega le componenti senza aggiungere coppie ridondanti:
    // sono indizi visivi, non una ricostruzione certa del percorso mancante.
    // Per strutture ramificate/chiuse mantiene la segnalazione generale.
    function orderDisconnectedPairs(graph, nodes) {
        if (graph.branchNodes.length || graph.components.length < 2) return null;
        const ends = graph.components.map(group => group.filter(id => graph.neighbors.get(id).size === 1));
        if (ends.some(group => group.length !== 2 || group.some(id => {
            const n = nodes.get(id);
            return !Number.isFinite(n?.lat) || !Number.isFinite(n?.lon);
        }))) return null;
        const distance = (a, b) => {
            const na = nodes.get(a), nb = nodes.get(b), radians = Math.PI/180;
            return Math.sin((na.lat-nb.lat)*radians/2)**2 +
                Math.cos(na.lat*radians)*Math.cos(nb.lat*radians)*Math.sin((na.lon-nb.lon)*radians/2)**2;
        };
        const visited = new Set([0]), best = new Map(), pairs = [];
        let current = 0;
        while (visited.size < ends.length) {
            for (let i=0; i<ends.length; i++) {
                if (visited.has(i)) continue;
                for (const a of ends[current]) for (const b of ends[i]) {
                    const score = distance(a,b);
                    if (!best.has(i) || score < best.get(i).score)
                        best.set(i,{a,b,from:current,to:i,score});
                }
            }
            let nearest = null;
            for (const pair of best.values())
                if (!nearest || pair.score < nearest.score) nearest = pair;
            if (!nearest) return null;
            pairs.push(nearest);
            current = nearest.to;
            visited.add(current);
            best.delete(current);
        }
        return pairs;
    }

    function orderProblemPoints(full, relationId) {
        const rel = full?.elements?.find(e => e.type === 'relation' && String(e.id) === String(relationId));
        if (!rel) return [];
        const ways = new Map(full.elements.filter(e=>e.type==='way').map(e=>[String(e.id),e]));
        const nodes = new Map(full.elements.filter(e=>e.type==='node').map(e=>[String(e.id),e]));
        const geometry = relationGeometryMembers(full, relationId);
        // Evita indicatori parziali su geometrie o sottorelazioni mancanti.
        if (geometry.missing.length || geometry.cycles.length) return [];
        const selected = [];
        for (const member of geometry.members) {
            const way = ways.get(String(member.ref));
            if (!way?.nodes || way.nodes.length < 2) return [];
            selected.push(way);
        }
        const graph = orderGeometryGraph(selected);
        const issues=[];
        const add=(nodeId,type,label,detail)=>{
            const node=nodes.get(nodeId);
            if (!Number.isFinite(node?.lat) || !Number.isFinite(node?.lon)) return;
            issues.push({lat:node.lat,lon:node.lon,nodeId,type,label,detail});
        };
        if (graph.components.length > 1) {
            const pairs = orderDisconnectedPairs(graph,nodes);
            if (pairs) {
                const marked = new Set();
                for (const pair of pairs) for (const [id,component] of [[pair.a,pair.from],[pair.b,pair.to]]) {
                    if (marked.has(id)) continue;
                    marked.add(id);
                    add(id,'disconnected',String(component+1),'Componente '+(component+1)+
                        ' · estremità vicina a un altro tratto: possibile discontinuità da verificare');
                }
            } else {
                graph.components.forEach((group,i)=>{
                    const ends=group.filter(n=>graph.neighbors.get(n).size===1);
                    // Componenti ramificate/chiuse: non dedurre un punto di distacco.
                    (ends.length ? ends : group.slice(0,1)).forEach(n=>add(n,'disconnected',String(i+1),'Componente '+(i+1)));
                });
            }
        }
        for (const n of graph.branchNodes)
            add(n,'branch','!','Biforcazione ('+graph.neighbors.get(n).size+' rami distinti)');

        // Pin viola: way ripetute come membri della relazione e segmenti
        // coincidenti tra way DISTINTE. Gli incroci e i soli nodi condivisi
        // non sono sovrapposizioni. Un pin per way ripetuta o coppia di way.
        const occurrences=new Map();
        for (const member of geometry.members) {
            const id=String(member.ref);
            occurrences.set(id,(occurrences.get(id)||0)+1);
        }
        const segmentOwners=new Map();
        for (const [wayId] of occurrences) {
            const ids=ways.get(wayId).nodes.map(String);
            for (let i=1;i<ids.length;i++) {
                const a=ids[i-1], b=ids[i];
                if (a===b) continue;
                const key=a<b ? a+'|'+b : b+'|'+a;
                if (!segmentOwners.has(key)) segmentOwners.set(key,new Set());
                segmentOwners.get(key).add(wayId);
            }
        }
        const segmentInfo=key=>{
            const [a,b]=key.split('|');
            const na=nodes.get(a),nb=nodes.get(b);
            if (![na?.lat,na?.lon,nb?.lat,nb?.lon].every(Number.isFinite)) return null;
            const latitude=(na.lat+nb.lat)/2;
            const longitude=(na.lon+nb.lon)/2;
            // Peso approssimativo in metri: serve solo a scegliere un segmento
            // rappresentativo, senza richiedere API aggiuntive.
            const dx=(na.lon-nb.lon)*Math.cos(latitude*Math.PI/180);
            const dy=na.lat-nb.lat;
            return {lat:latitude,lon:longitude,length:Math.hypot(dx,dy)};
        };
        const pinOverlap=(point,detail)=>{
            if (!point) return;
            issues.push({lat:point.lat,lon:point.lon,nodeId:null,
                type:'overlap',label:'2',detail});
        };
        for (const [wayId,count] of occurrences) {
            if (count<2) continue;
            const ids=ways.get(wayId).nodes.map(String);
            // Rappresenta la way circa a metà tracciato, non all'estremità.
            const parts=[];
            let total=0;
            for (let i=1;i<ids.length;i++) {
                const a=nodes.get(ids[i-1]),b=nodes.get(ids[i]);
                if (![a?.lat,a?.lon,b?.lat,b?.lon].every(Number.isFinite)) continue;
                const midLat=(a.lat+b.lat)/2;
                const weight=Math.hypot((a.lon-b.lon)*Math.cos(midLat*Math.PI/180),a.lat-b.lat);
                if (weight<=0) continue;
                parts.push({a,b,weight});total+=weight;
            }
            if (!total) continue;
            let walked=0, point=null;
            for (const part of parts) {
                if (walked+part.weight>=total/2) {
                    const t=(total/2-walked)/part.weight;
                    point={lat:part.a.lat+(part.b.lat-part.a.lat)*t,
                        lon:part.a.lon+(part.b.lon-part.a.lon)*t};
                    break;
                }
                walked+=part.weight;
            }
            pinOverlap(point,'Way '+wayId+' ripetuta '+count+' volte nella relazione');
        }
        const pairs=new Map();
        for (const [key,owners] of segmentOwners) {
            const ids=[...owners].sort();
            if (ids.length<2) continue;
            const point=segmentInfo(key);
            if (!point) continue;
            for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) {
                const pair=ids[i]+'|'+ids[j];
                if (!pairs.has(pair) || point.length>pairs.get(pair).length)
                    pairs.set(pair,{...point,a:ids[i],b:ids[j]});
            }
        }
        for (const p of pairs.values())
            pinOverlap(p,'Tratto sovrapposto tra way '+p.a+' e '+p.b);
        return issues;
    }

    function renderOrderMapControls(output, issues) {
        if (!issues.length) return;
        const controls=document.createElement('div'); controls.style.cssText='margin:10px 0;';
        const button=document.createElement('button'); button.type='button';
        button.textContent=orderMapVisible
            ? 'Nascondi indicatori dalla mappa'
            : 'Mostra problemi sulla mappa ('+issues.length+')';
        button.style.cssText='padding:7px 10px;border-radius:5px;border:1px solid #d25b3b;background:#b82d2d;color:#fff;cursor:pointer;';
        button.addEventListener('click',()=>{
            if (orderMapVisible) {
                orderMapVisible=false;
                orderMapIssues=[];
                orderRenderSignature=null;
                renderOrderMapOverlay();
                button.textContent='Mostra problemi sulla mappa ('+issues.length+')';
            } else {
                orderMapIssues=issues;
                orderMapVisible=true;
                orderRenderSignature=null;
                renderOrderMapOverlay();
                startOrderAnimation();
                button.textContent='Nascondi indicatori dalla mappa';
            }
        });
        controls.appendChild(button);
        const list=document.createElement('div');list.style.cssText='max-height:150px;overflow:auto;margin-top:8px;';
        for (const issue of issues.slice(0,80)) {
            const link=document.createElement('a');
            link.href='https://www.openstreetmap.org/edit?editor=id#map=18/'+issue.lat+'/'+issue.lon;
            link.target='_blank';link.rel='noopener noreferrer';
            link.textContent=issue.detail+(issue.nodeId?' · node '+issue.nodeId:'')+' · modifica in iD';
            link.style.cssText='display:block;padding:3px 0;color:#4697f5;';
            list.appendChild(link);
        }
        controls.appendChild(list); output.appendChild(controls);
    }

    // Analisi topologica per occorrenza di way. Un tratto ripetuto non è
    // necessariamente un errore OSM (es. andata/ritorno), ma rende ambiguo
    // un riordino automatico basato soltanto sulle estremità.
    function checkMemberOrder(full, relationId) {
        const rel = full?.elements?.find(e => e.type === 'relation' && String(e.id) === String(relationId));
        if (!rel || !Array.isArray(rel.members)) return {error:'Relazione non disponibile nel full.json.'};
        const geometry=relationGeometryMembers(full, relationId);
        const members = geometry.members;
        if (geometry.missing.length || geometry.cycles.length) return {
            error:'Analisi incompleta: sottorelazioni non disponibili o riferimento circolare ('+
                [...geometry.missing,...geometry.cycles].join(', ')+').', incomplete:true};
        if (!members.length) return {error:'La relazione e le sottorelazioni non contengono way.'};
        const wayMap = new Map((full.elements || []).filter(e => e.type === 'way').map(e => [String(e.id), e]));
        const edges = [];
        for (const [index, member] of members.entries()) {
            const way = wayMap.get(String(member.ref));
            if (!way || !Array.isArray(way.nodes) || way.nodes.length < 2)
                return {error:'Geometria della way ' + member.ref + ' non disponibile nei dati caricati. Analisi incompleta: riprova più tardi.', incomplete:true};
            const a = String(way.nodes[0]), b = String(way.nodes[way.nodes.length - 1]);
            edges.push({id:String(member.ref), a, b, index, role:member.role || ''});
        }
        // Topologia effettiva, inclusi i nodi intermedi delle way.
        const graph = orderGeometryGraph(edges.map(e => wayMap.get(e.id)));
        const branches = graph.branchNodes.length;
        const ends = graph.ends;
        const connected = graph.components.length === 1;
        const ring = connected && ends.length === 0 && branches === 0;
        const linear = connected && ends.length === 2 && branches === 0;
        const topology = !connected ? 'disconnected' : branches ? 'branching'
            : ring ? 'ring' : linear ? 'linear' : 'complex';
        const repeated = edges.length - new Set(edges.map(e => e.id)).size;
        const overlaps = graph.overlappingSegments;
        // Il riordino delle way rimane basato sulle loro ESTREMITÀ: il grafo
        // completo serve per l'analisi, non per spezzare/modificare le way.
        const adjacency = new Map();
        for (const [i,e] of edges.entries()) {
            for (const endpoint of [e.a,e.b]) {
                if (!adjacency.has(endpoint)) adjacency.set(endpoint, []);
                adjacency.get(endpoint).push(i);
            }
        }
        const nonWays = rel.members.filter(m => m.type !== 'way').length;
        const nestedRelations = geometry.nested;
        const roleSensitive = edges.some(e => e.role.trim() !== '');

        // Minimo numero di interruzioni nell'ordine ATTUALE, considerando
        // entrambi i versi di ogni way anche dopo una discontinuità.
        // Ogni stato conserva il costo minimo per una delle due estremità
        // di arrivo: evita scelte locali che gonfiano il conteggio.
        let states = [{end:edges[0].a, breaks:0}, {end:edges[0].b, breaks:0}];
        for (let i=1; i<edges.length; i++) {
            const e = edges[i];
            const cost = start => Math.min(...states.map(s => s.breaks + (s.end === start ? 0 : 1)));
            states = [{end:e.b, breaks:cost(e.a)}, {end:e.a, breaks:cost(e.b)}];
        }
        const breaks = Math.min(...states.map(s => s.breaks));
        const continuous = breaks === 0;

        // Riordino suggerito solo per catene/anelli semplici, con membri way
        // unici e ruoli vuoti. Le altre topologie richiedono verifica manuale.
        const safe = !repeated && !overlaps && !roleSensitive && !nestedRelations && (linear || ring);
        let proposal = null;
        if (safe) {
            const first = edges[0];
            const starts = linear
                ? [ends.includes(first.a) ? first.a : ends.includes(first.b) ? first.b : ends[0]]
                : [first.a,first.b];
            for (const start of [...new Set(starts)]) {
                const used = new Set(), result = [];
                let cursor = start;
                while (result.length < edges.length) {
                    const available = (adjacency.get(cursor) || []).filter(i => !used.has(i));
                    if (!available.length) break;
                    // Per un anello il primo passo può avere due alternative;
                    // dopo il primo ogni vertice ha un'unica uscita inutilizzata.
                    const idx = result.length === 0
                        ? (available.includes(first.index) ? first.index : available[0])
                        : available[0];
                    const e = edges[idx];
                    if (e.a !== cursor && e.b !== cursor) break;
                    used.add(idx); result.push(e);
                    cursor = e.a === cursor ? e.b : e.a;
                }
                if (result.length === edges.length && (!ring || cursor === start)) {
                    proposal = result;
                    break;
                }
            }
        }
        const changes = proposal ? proposal.filter((e,i) => e.index !== i).length : 0;
        return {total:edges.length, breaks, continuous, repeated, overlaps, branches, connected, components:graph.components.length,
            ends:ends.length, ring, topology, roleSensitive, nestedRelations,
            proposal, changes, nonWays};
    }

    function openOrderInID(job, feedback, success) {
        if (!validateMemberReorder(job.before, job.after)) {
            feedback.textContent='Riordino non valido: dati della relazione incoerenti.';
            return;
        }
        if (!/^[1-9]\d*$/.test(String(job.relationId)) || !Number.isSafeInteger(Number(job.relationId)) ||
            !Number.isSafeInteger(job.version) || job.version < 1) {
            feedback.textContent='Identificativo o versione della relazione non validi.';
            return;
        }
        const hash='id=relation/'+encodeURIComponent(job.relationId)+
            '&osm2cai_members='+encodeURIComponent(JSON.stringify(job));
        if (hash.length > 120000) {
            feedback.textContent='Relazione troppo grande per trasferire l’ordine via URL in modo affidabile.';
            return;
        }
        const opened=window.open('https://www.openstreetmap.org/id#'+hash,'_blank','noopener,noreferrer');
        // Con noopener alcuni browser restituiscono null anche se la scheda è aperta.
        feedback.textContent = opened === null
            ? 'Apertura di iD richiesta. Se la scheda non compare, consenti i popup e riprova.'
            : success;
    }

    // Indicatore della verifica membri: verde quando l'ordine è continuo e
    // la geometria non presenta anomalie, rosso se rileva un problema.
    // Grigio finché il full.json non è disponibile o non è verificabile.
    function setMemberOrderIndicator(kind) {
        const dot = $('order-dot');
        if (!dot) return;
        const colors = {ok:'#22bd3c', error:'#ed3043', gray:'#9ca3af'};
        dot.style.setProperty('background-color', colors[kind] || colors.gray, 'important');
        const button = $('order-button');
        if (button) {
            button.title = kind === 'ok' ? 'Ordine membri: nessun problema rilevato'
                : kind === 'error' ? 'Ordine membri: problemi rilevati; apri per i dettagli'
                : 'Ordine membri: verifica non ancora disponibile';
        }
    }

    function updateMemberOrderIndicator(full, relationId) {
        if (!full) { setMemberOrderIndicator('gray'); return; }
        const result = checkMemberOrder(full, relationId);
        if (result.error) { setMemberOrderIndicator(result.incomplete ? 'gray' : 'error'); return; }
        if (result.nestedRelations) {
            const valid = result.continuous && !result.repeated && !result.overlaps && !result.branches && result.connected;
            setMemberOrderIndicator(valid ? 'ok' : 'error');
            return;
        }
        const hasProblems = result.breaks > 0 || result.repeated > 0 || result.overlaps > 0 ||
            result.branches > 0 || !result.connected || !result.proposal;
        setMemberOrderIndicator(hasProblems ? 'error' : 'ok');
    }

    function renderOrderCheck() {
        const output=$('order-results');
        if (!output) return;
        output.replaceChildren();
        if (!orderFull || orderRelationId !== relationIdFromUrl()) {
            output.textContent='Dati OSM non ancora disponibili: apri la barra e attendi la risposta dell’API OSM.';
            return;
        }
        clearOrderMap();
        const result=checkMemberOrder(orderFull,orderRelationId);
        const line=(value,bold=false)=>{
            const node=document.createElement('div');
            node.textContent=value;
            node.style.cssText='margin:5px 0;overflow-wrap:anywhere;' + (bold?'font-weight:700;':'');
            output.appendChild(node);
        };
        if (result.error) { line(result.error,true); return; }
        const typeLabels = {linear:'Percorso lineare',ring:'Percorso ad anello',
            branching:'Percorso con diramazioni',disconnected:'Componenti scollegate',
            complex:'Topologia complessa'};
        line('Topologia: '+(typeLabels[result.topology] || 'Non determinata')+'.',true);
        line('Geometria: '+(result.connected ? 'connessa (1 componente)' : result.components+' componenti scollegate')+'.',true);
        line('Way: '+result.total+' · continuità sequenza attuale: '+
            (result.continuous ? 'sì' : 'no')+' · passaggi non continui nella sequenza: '+result.breaks+'.',true);
        if (result.breaks) line('Il conteggio della sequenza può includere way fuori ordine: non indica il numero di distacchi geometrici.');
        if (result.nonWays) line('Altri membri (node/relation): '+result.nonWays+'; esclusi dalla proposta.');
        if (result.repeated) line('Way ripetute: '+result.repeated);
        if (result.overlaps) line('Segmenti condivisi da way distinte: '+result.overlaps+'. Riordino automatico disabilitato.');
        if (result.branches) line('Biforcazioni: '+result.branches);
        if (result.roleSensitive) line('Sono presenti ruoli delle way: riordino automatico sospeso per non alterarne la semantica.');
        if (result.nestedRelations) line('Sottorelazioni: '+result.nestedRelations+'. Way incluse nell’analisi geometrica; riordino automatico disabilitato.');
        if (!result.connected && !result.branches) line('Per componenti lineari, i pin indicano le estremità più vicine da verificare, non collegamenti certi da creare. Per componenti chiuse sono mostrati punti rappresentativi.');
        const issues=orderProblemPoints(orderFull,orderRelationId);
        // L'inquadratura della geometria non dipende dalla presenza di anomalie:
        // deve funzionare anche per percorsi regolari, su OSM e su WMT.
        focusOrderGeometry(orderFull,orderRelationId);
        if (issues.length) showOrderMap(issues);
        renderOrderMapControls(output,issues);
        if (!result.proposal) {
            if (result.nestedRelations && result.continuous && !result.repeated && !result.overlaps && !result.branches && result.connected) {
                showOrderArrows(orderFull, relationGeometryMembers(orderFull,orderRelationId).members
                    .map(m=>({id:String(m.ref)})));
            }
            line('Ordinamento automatico non proposto: struttura annidata/complessa, ruoli particolari o geometria ambigua. Verifica manualmente.');
            return;
        }
        if (result.continuous && result.proposal) {
            line(result.ring ? 'Le way formano un anello continuo.' : 'Le way sono già in un ordine continuo.');
            // Anche con ordine corretto il verso deve essere leggibile sulla mappa.
            // Seguiamo la sequenza effettiva, non una proposta alternativa.
            const currentSequence = [...result.proposal].sort((a,b) => a.index-b.index);
            showOrderArrows(orderFull, currentSequence);
            const actions = document.createElement('div');
            actions.style.cssText = 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;';
            const force = document.createElement('button');
            force.type = 'button';
            force.textContent = 'Forza ordinamento inverso in iD';
            force.style.cssText = 'padding:7px 12px;border-radius:6px;border:1px solid #16764c;background:#168358;color:white;cursor:pointer;';
            const feedback = document.createElement('div');
            feedback.style.cssText = 'margin:7px 0;overflow-wrap:anywhere;';
            force.addEventListener('click', () => {
                // Ricontrolla che relazione e ordine non siano cambiati.
                if (orderRelationId !== relationIdFromUrl() || !orderFull) {
                    feedback.textContent = 'La relazione è cambiata: ripeti la verifica.';
                    return;
                }
                const current = checkMemberOrder(orderFull, orderRelationId);
                if (current.error || !current.proposal || current.breaks !== 0 ||
                    current.repeated || current.branches || !current.connected || current.roleSensitive || current.nestedRelations ||
                    [...current.proposal].sort((a,b) => a.index-b.index).map(e => e.id).join(',') !== currentSequence.map(e => e.id).join(',')) {
                    feedback.textContent = 'L’ordine attuale non è più quello verificato: ripeti il controllo.';
                    return;
                }
                const rel = orderFull.elements.find(e => e.type === 'relation' &&
                    String(e.id) === String(orderRelationId));
                if (!rel || !Number.isSafeInteger(rel.version)) {
                    feedback.textContent = 'Impossibile verificare la versione della relazione.';
                    return;
                }
                const normalize = m => ({type:m.type,ref:String(m.ref),role:m.role || ''});
                const ways = rel.members.filter(m => m.type === 'way');
                if (ways.length < 2) {
                    feedback.textContent = 'Occorrono almeno due way per invertire l’ordine.';
                    return;
                }
                const reversed = [...ways].reverse();
                let index = 0;
                // I membri node/relation restano al loro posto; way e ruoli viaggiano insieme.
                const after = rel.members.map(m => normalize(m.type === 'way' ? reversed[index++] : m));
                const before = rel.members.map(normalize);
                if (JSON.stringify(before) === JSON.stringify(after)) {
                    feedback.textContent = 'L’inversione non modifica la sequenza.';
                    return;
                }
                const job = {relationId:String(orderRelationId),version:rel.version,before,after};
                openOrderInID(job, feedback, 'iD aperto: controlla l’inversione e salva manualmente.');
            });
            actions.appendChild(force);
            output.append(actions, feedback);
            return;
        }
        // Direzione in salita soltanto se entrambi gli estremi hanno tag ele attendibili.
        const elevation=orderElevationHint(orderFull,result.proposal);
        let selectedDirection=elevation && elevation.start>elevation.end ? 'inverse' : 'proposed';
        const alternatives = {proposed:result.proposal, inverse:[...result.proposal].reverse()};
        const chosen = () => alternatives[selectedDirection];
        const changedCount = seq => seq.filter((e,i)=>e.index!==i).length;
        const choices=document.createElement('div');
        choices.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 8px;';
        const preview=document.createElement('div');
        const summary=document.createElement('div');
        summary.style.cssText='margin:5px 0 8px;font-weight:700;';
        const list=document.createElement('div');
        list.style.cssText='max-height:220px;overflow:auto;border:1px solid #8d9aa966;border-radius:6px;padding:5px 9px;margin-top:8px;';
        const firstLast=seq => 'Prima: way '+seq[0].id+' · Ultima: way '+seq[seq.length-1].id;
        const labelMap={proposed:'Ordine proposto',inverse:'Ordine inverso'};
        const radios=[];
        for (const key of ['proposed','inverse']) {
            const label=document.createElement('label');
            label.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid #8d9aa966;border-radius:6px;cursor:pointer;';
            const radio=document.createElement('input');
            radio.type='radio'; radio.name='osm2cai-direction-'+orderRelationId;
            radio.value=key; radio.checked=key===selectedDirection;
            const caption=document.createElement('span');
            caption.textContent=labelMap[key];
            label.append(radio,caption);
            choices.appendChild(label);
            radios.push({key,label,radio});
            radio.addEventListener('change',()=>{
                if (!radio.checked) return;
                selectedDirection=key;
                drawPreview();
            });
        }
        function drawPreview() {
            const seq=chosen();
            showOrderArrows(orderFull,seq);
            summary.textContent='Anteprima: '+changedCount(seq)+' posizioni diverse rispetto alla sequenza attuale.';
            list.replaceChildren();
            for (const [i,e] of seq.entries()) {
                const row=document.createElement('div');
                row.style.cssText='padding:3px 0;';
                const label=document.createTextNode((i+1)+'. ');
                const link=document.createElement('a');
                link.href='https://www.openstreetmap.org/way/'+encodeURIComponent(e.id);
                link.target='_blank';link.rel='noopener noreferrer';link.textContent='way '+e.id;
                link.style.cssText='color:#4697f5;text-decoration:underline;';
                row.append(label,link,document.createTextNode(e.index!==i?' (prima posizione '+(e.index+1)+')':''));
                list.appendChild(row);
            }
            for (const {key,label} of radios) {
                label.style.borderColor=key===selectedDirection?'#3478ed':'#8d9aa966';
                label.style.fontWeight=key===selectedDirection?'700':'400';
            }
        }
        if (elevation && elevation.start!==elevation.end) {
            const note=document.createElement('div');
            note.textContent='Preselezionato il verso da quota minore a quota maggiore usando i tag ele degli estremi OSM. Non rappresenta un profilo altimetrico: puoi invertire il verso.';
            note.style.cssText='margin:8px 0;color:inherit;';
            preview.appendChild(note);
        }
        preview.append(choices,summary,list);
        output.appendChild(preview);
        drawPreview();
        const actions=document.createElement('div');
        actions.style.cssText='margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;';
        const prepare=document.createElement('button'); prepare.type='button';
        prepare.textContent='Ordina membri in iD';
        prepare.style.cssText='padding:7px 12px;border-radius:6px;border:1px solid #16764c;background:#168358;color:white;cursor:pointer;';
        const feedback=document.createElement('div');
        feedback.style.cssText='margin:7px 0;overflow-wrap:anywhere;';
        prepare.addEventListener('click',()=>{
            if (orderRelationId !== relationIdFromUrl() || !orderFull) {
                feedback.textContent='La relazione è cambiata: ripeti la verifica.'; return;
            }
            const current=checkMemberOrder(orderFull,orderRelationId);
            if (!current.proposal ||
                current.proposal.map(e=>e.id).join(',')!==result.proposal.map(e=>e.id).join(',')) {
                feedback.textContent='La proposta non è più valida: ripeti la verifica.'; return;
            }
            const rel=orderFull.elements.find(e=>e.type==='relation' && String(e.id)===String(orderRelationId));
            if (!rel || !Number.isSafeInteger(rel.version)) {
                feedback.textContent='Impossibile verificare la versione della relazione.'; return;
            }
            const norm=m=>({type:m.type,ref:String(m.ref),role:m.role||''});
            const originalWays=rel.members.filter(m=>m.type==='way');
            const targetSequence=selectedDirection==='inverse' ? [...current.proposal].reverse() : current.proposal;
            if (!changedCount(targetSequence)) { feedback.textContent='La sequenza scelta coincide con quella attuale.'; return; }
            const orderedWays=targetSequence.map(e=>originalWays[e.index]);
            let index=0;
            const after=rel.members.map(m=>norm(m.type==='way'?orderedWays[index++]:m));
            const job={relationId:String(orderRelationId),version:rel.version,
                before:rel.members.map(norm),after};
            // Apriamo direttamente l'editor iD, perché /edit inoltra a /id
            // soltanto un insieme limitato di parametri e scarterebbe il job.
            openOrderInID(job, feedback, 'iD aperto in una nuova scheda: verifica e salva manualmente il riordino.');
        });
        actions.append(prepare); output.append(actions,feedback);
        line('Il riordino viene applicato nella sessione di iD; verifica e salva manualmente su OpenStreetMap.');
    }

    const CSS = `
      #osm2cai-bar, #osm2cai-bar * { box-sizing:border-box !important; }
      #osm2cai-bar { position:fixed !important; top:60px !important; left:355px !important;
        width:754px !important; max-width:calc(100vw - 16px) !important;
        z-index:2147483000 !important; font:13px/1.35 system-ui,sans-serif !important;
        color:#233344 !important; pointer-events:none !important; }
      #osm2cai-bar .oc-card { margin-left:34px; width:calc(100% - 34px); height:98px; pointer-events:auto; background:#fff; border:1px solid #d8dfe7;
        border-radius:0 7px 7px 0; box-shadow:0 2px 9px #0002; overflow:hidden; }
      #osm2cai-bar .oc-main { display:flex; align-items:center; height:60px; padding:6px 12px; gap:10px; border-bottom:1px solid #d8dfe7; }
      #osm2cai-bar .oc-metrics { display:flex; align-items:center; flex:1 1 auto; gap:8px;
        min-width:0; overflow-x:auto; }
      #osm2cai-bar .oc-metric { display:flex; align-items:center; min-width:0; overflow:hidden; }
      #osm2cai-bar .oc-metric:nth-child(1) { flex:0 0 90px; width:90px; }
      #osm2cai-bar .oc-metric:nth-child(2) { flex:0 0 55px; width:55px; }
      #osm2cai-bar .oc-metric:nth-child(3) { flex:0 0 220px; width:220px; }
      #osm2cai-bar .oc-metric:nth-child(4) { flex:0 0 135px; width:135px; }
      #osm2cai-bar .oc-metric:nth-child(5) { flex:0 0 145px; width:145px; }
      #osm2cai-bar .oc-label { font-size:12px; color:#5a6574; white-space:nowrap; }
      #osm2cai-bar .oc-value { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #osm2cai-bar .oc-dot { display:inline-block; width:12px; height:12px;
        border-radius:50%; background:#e7b743; vertical-align:-1px; margin-right:5px; }
      #osm2cai-bar .oc-dot.ok { background:#22bd3c; }
      #osm2cai-bar .oc-dot.error { background:#ed3043; }
      #osm2cai-bar .oc-dot.warning { background:#e7b743; }
      #osm2cai-bar .oc-dot.gray { background:#9ca3af; }
      #osm2cai-bar .oc-dot.orange { background:#f59e0b; }
      #osm2cai-bar .oc-dot.validation-orange { background:#f97316; }
      #osm2cai-bar .oc-actions { display:flex; align-items:center; justify-content:flex-end; height:100%; gap:8px; flex:0 0 auto; margin-left:auto; }
      #osm2cai-bar .oc-action { display:inline-flex; flex-direction:row !important; flex-wrap:nowrap !important; align-items:center; justify-content:center; gap:6px; height:29px; padding:0 10px;
        flex:0 0 auto; min-width:0; border:1px solid #6682aa; border-radius:6px; background:#fff; text-decoration:none; font-size:12px; font-weight:600; color:#356293; white-space:nowrap; }
      #osm2cai-bar a.oc-action:not([aria-disabled="true"]) { pointer-events:auto !important; cursor:pointer !important; }
      #osm2cai-bar .oc-action > span { display:inline-flex; align-items:center; justify-content:center; }
      #osm2cai-bar .oc-action-icon { display:inline-flex; align-items:center; justify-content:center; width:17px; height:17px; flex:0 0 17px;
        background:transparent; color:#356293; border-radius:0; box-shadow:none; }
      #osm2cai-bar .oc-action-icon svg { width:15px; height:15px; }
      #osm2cai-bar a[aria-disabled="true"] { pointer-events:none; opacity:.5; }
      #osm2cai-bar .oc-info-button { display:flex; align-items:center; justify-content:center; padding:0; line-height:1; flex:0 0 26px; border:1px solid #6682aa; border-radius:50%; width:26px; height:26px;
        background:white; color:#356293; font-weight:700; cursor:pointer; margin-left:4px; }
      #osm2cai-bar .oc-right-controls { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; width:28px; flex:0 0 28px; margin-left:3px; }
      #osm2cai-bar .oc-close-button { display:flex; align-items:center; justify-content:center; padding:0; line-height:1; }
      #osm2cai-bar .oc-close-button, #osm2cai-bar .oc-open-button { cursor:pointer; border:1px solid #6682aa; color:#356293; background:white; border-radius:50%; width:26px; height:26px; font-weight:700; }
      #osm2cai-bar .oc-closed { display:flex; align-items:center; justify-content:center; width:34px; height:98px; border-radius:7px 0 0 7px; border:1px solid #d8dee6; background:white; box-shadow:0 2px 9px #0002; pointer-events:auto; cursor:pointer; font-size:21px; color:#356293; }
      #osm2cai-bar .oc-close-rail { position:absolute; top:0; left:0; width:34px; height:100%; display:flex; align-items:center; justify-content:center; background:white; border:1px solid #d8dee6; border-right:0; border-radius:7px 0 0 7px; pointer-events:auto; }
      #osm2cai-bar .oc-help-wrap {display:flex; align-items:center; justify-content:center; width:32px; height:100%; flex:0 0 32px;}
      #osm2cai-bar .oc-member-row { display:flex; align-items:center; justify-content:flex-start; height:38px; padding:0 8px; gap:8px; background:rgba(52,120,237,.04); }
      #osm2cai-bar .oc-member-button { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:30px; padding:0 16px; border:1px solid #1650b0; border-radius:6px; background:linear-gradient(#3478ed,#1451aa); color:#fff; box-shadow:0 1px 3px #0002; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap; }
      /* Misure identiche su OSM e WMT, indipendenti dalle etichette dei link. */
      #osm2cai-bar .oc-member-row > #osm2cai-order-button { flex:0 0 170px; width:170px; min-width:170px; padding:0 8px; }
      #osm2cai-bar .oc-member-row > #osm2cai-guidepost-button { flex:0 0 220px; width:220px; min-width:220px; padding:0 7px; }
      #osm2cai-bar .oc-member-row > .oc-actions { margin-left:auto; gap:6px; min-width:0; }
      #osm2cai-bar .oc-actions > a.oc-action:nth-of-type(1) { flex:0 0 88px; width:88px; min-width:88px; padding:0 5px; }
      #osm2cai-bar .oc-actions > a.oc-action:nth-of-type(2) { flex:0 0 137px; width:137px; min-width:137px; padding:0 5px; }
      #osm2cai-bar .oc-actions .oc-help-wrap { flex:0 0 30px; width:30px; }
      #osm2cai-bar .oc-member-icon { display:inline-flex; align-items:center; justify-content:center; color:#356293; }
      #osm2cai-bar .oc-member-icon svg { width:18px; height:18px; }
      #osm2cai-bar .oc-member-dot { display:inline-block; flex:0 0 10px; width:10px; height:10px; border-radius:50%; background:#9ca3af; }
      #osm2cai-guidepost-dot { display:block !important; visibility:visible !important; opacity:1 !important; flex:0 0 12px !important; width:12px !important; height:12px !important; min-width:12px !important; overflow:visible !important; }
      #osm2cai-bar .oc-popover { position:absolute; left:34px; top:100%; margin-top:5px; width:calc(100% - 34px); max-width:calc(100vw - 24px); max-height:70vh; overflow:auto; background:white; border:1px solid #cbd5e1; border-radius:6px; box-shadow:0 3px 12px #0003; pointer-events:auto; }
      #osm2cai-bar .oc-order-popover { position:absolute; left:34px; top:100%; margin-top:5px; width:450px; max-width:calc(100vw - 24px); max-height:70vh; overflow:auto; background:white; border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 3px 12px #0003; pointer-events:auto; }
      #osm2cai-bar .oc-order-popover-content { padding:14px 16px; }
      #osm2cai-bar .oc-order-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      #osm2cai-bar .oc-order-title { font-size:15px; font-weight:700; }
      #osm2cai-bar .oc-order-close { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border:1px solid #6682aa; border-radius:999px; background:white; color:#356293; font-size:18px; font-weight:700; cursor:pointer; }
      #osm2cai-bar .oc-issues-trigger { cursor:pointer; border-radius:4px; outline-offset:3px; }
      #osm2cai-bar .oc-issues-trigger:focus-visible { outline:2px solid #3478ed; }
      #osm2cai-bar .oc-issues-popover { position:absolute; top:100%; left:34px; margin-top:5px; width:500px; max-width:calc(100vw - 24px); max-height:65vh; overflow:auto; background:#fff; color:#233344; border:1px solid #9ca9bb; border-radius:8px; box-shadow:0 7px 22px #0003; padding:12px 14px; pointer-events:auto; font:13px/1.45 system-ui,sans-serif; }
      #osm2cai-bar .oc-issues-table { width:100%; border-collapse:collapse; table-layout:fixed; }
      #osm2cai-bar .oc-issues-table th, #osm2cai-bar .oc-issues-table td { text-align:left; vertical-align:top; padding:10px 7px; border-bottom:1px solid #d8dfe7; overflow-wrap:anywhere; }
      #osm2cai-bar .oc-issues-table th { width:33%; font-weight:650; }
      #osm2cai-bar .oc-issues-description { white-space:pre-wrap; overflow-wrap:anywhere; }
      #osm2cai-bar .oc-issues-popover[hidden], #osm2cai-bar .oc-popover[hidden], #osm2cai-bar .oc-order-popover[hidden] { display:none !important; }
    `;

    function insertStyle() {
        if (document.getElementById('osm2cai-global-style')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'osm2cai-global-style';
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    // Misura la posizione visibile della sidebar, inclusi i ridimensionamenti
    // effettuati da Better OSM Org (che usa #sidebar e resize:horizontal).
    function getSidebarRight() {
        if (isWmt()) {
            // Waymarked Trails: le classi Svelte possono comparire anche su
            // contenitori larghi quanto tutta la pagina. Non usare il primo
            // match: scegli solo un elemento ancorato al bordo sinistro e
            // con dimensioni compatibili con una sidebar.
            const selectors = [
                'aside',
                '[class*="sidebar"]',
                '[class*="sidepanel"]',
                '[class*="svelte-q14p2h"]'
            ];
            const found = new Set();
            const candidates = [];
            for (const selector of selectors) {
                for (const element of document.querySelectorAll(selector)) {
                    if (found.has(element)) {
                        continue;
                    }
                    found.add(element);
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        continue;
                    }
                    // Evita wrapper, modali e pannelli interni non ancorati a sinistra.
                    if (rect.left < -10 || rect.left > 70 || rect.width < 220 ||
                        rect.width > Math.min(650, window.innerWidth * 0.60) ||
                        rect.height < 180 || rect.right > window.innerWidth * 0.65) {
                        continue;
                    }
                    candidates.push(rect.right);
                }
            }
            if (candidates.length > 0) {
                // L'estremità maggiore tra i candidati plausibili rappresenta
                // il bordo esterno della sidebar, non quello di un figlio.
                return Math.round(Math.max(...candidates));
            }
            // Fallback WMT: usa la distanza originaria, senza agganciarti
            // accidentalmente a un contenitore Svelte a tutta larghezza.
            return 350;
        }

        const sidebar = document.querySelector('#sidebar');
        if (sidebar) {
            const rect = sidebar.getBoundingClientRect();
            const style = getComputedStyle(sidebar);
            if (style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width >= 40 && rect.right > 0) {
                return Math.round(rect.right);
            }
        }
        return 350;
    }

    function adjustPosition() {
        const bar = document.getElementById('osm2cai-bar');
        if (!bar) {
            return;
        }
        // WMT: mantieni libero il comando zoom +/- (in alto a sinistra).
        // La barra inizia dopo la colonna dei controlli OpenLayers, non
        // dopo la sidebar che su WMT può variare notevolmente.
        const desiredLeft = isWmt() ? 35 : getSidebarRight() + 5;
        const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - RAIL_WIDTH - 8));
        const available = Math.max(RAIL_WIDTH, window.innerWidth - left - 8);
        bar.style.setProperty('position', 'fixed', 'important');
        bar.style.setProperty('left', left + 'px', 'important');
        bar.style.setProperty('top', '64px', 'important');
        bar.style.setProperty('right', 'auto', 'important');
        bar.style.setProperty('width', (collapsed ? Math.min(RAIL_WIDTH, available) : Math.min(BAR_WIDTH + RAIL_WIDTH, available)) + 'px', 'important');
        bar.style.setProperty('max-width', available + 'px', 'important');
    }

    // Fallback CSP: su openstreetmap.org i fogli <style> degli userscript
    // possono risultare presenti nel DOM ma non applicati. Gli stili
    // impostati via element.style.setProperty funzionano anche in quel caso.
    function applyInlineLayout() {
        const root = document.getElementById('osm2cai-bar');
        if (!root) {
            return;
        }
        function set(node, values) {
            if (!node) {
                return;
            }
            for (const [prop, value] of Object.entries(values)) {
                node.style.setProperty(prop, value, 'important');
            }
        }
        function all(selector, values) {
            root.querySelectorAll(selector).forEach(node => set(node, values));
        }
        set(root, {
            'box-sizing':'border-box', 'position':'fixed', 'top':'60px',
            'left':'355px', 'right':'auto', 'width':(BAR_WIDTH + RAIL_WIDTH)+'px',
            'z-index':'2147483000', 'display':'block', 'visibility':'visible',
            'opacity':'1', 'pointer-events':'none',
            'font':'13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif', 'color':'#233344'
        });
        set(root.querySelector('.oc-card'), {
            'box-sizing':'border-box','pointer-events':'auto','background':'white',
            'border':'1px solid #d8dfe7','border-radius':'0 7px 7px 0',
            'margin-left':RAIL_WIDTH+'px','width':'calc(100% - '+RAIL_WIDTH+'px)',
            'height':BAR_HEIGHT+'px',
            'box-shadow':'0 2px 9px rgba(0,0,0,.16)','overflow':'hidden'
        });
        set(root.querySelector('.oc-main'), {
            'box-sizing':'border-box','display':'flex','align-items':'center',
            'flex-wrap':'nowrap','height':MAIN_BAR_HEIGHT+'px','min-height':'0',
            'padding':'6px 12px','gap':'10px',
            'border-bottom':'1px solid #d8dfe7'
        });
        set(root.querySelector('.oc-metrics'), {
            'display':'flex','align-items':'center','min-width':'0',
            'flex':'1 1 auto','gap':'8px','overflow-x':'auto', 'scrollbar-width':'thin'
        });
        root.querySelectorAll('.oc-metric').forEach((node, index) => {
            const width = METRIC_WIDTHS[index] + 'px';
            set(node, {'display':'flex','align-items':'center','flex':'0 0 '+width,
                'width':width,'min-width':width,'max-width':width,'overflow':'hidden'});
            set(node.firstElementChild, {'width':'100%','min-width':'0'});
        });
        all('.oc-label',{'font-size':'12px','font-weight':'400','line-height':'1.25',
            'color':'#5a6574','white-space':'nowrap'});
        all('.oc-value',{'font-size':'13px','line-height':'1.3','font-weight':'600',
            'color':'#233344','white-space':'nowrap',
            'overflow':'hidden','text-overflow':'ellipsis'});
        all('.oc-dot',{'display':'inline-block','width':'12px','height':'12px',
            'border-radius':'50%','background':'#e7b743','vertical-align':'-1px','margin-right':'5px'});
        all('.oc-dot.ok', {'background':'#22bd3c'});
        all('.oc-dot.error', {'background':'#ed3043'});
        all('.oc-dot.warning', {'background':'#e7b743'});
        all('.oc-dot.gray', {'background':'#9ca3af'});
        all('.oc-dot.orange', {'background':'#f59e0b'});
        all('.oc-dot.validation-orange', {'background':'#f97316'});
        set(root.querySelector('.oc-actions'), {
            'display':'flex','align-items':'center','justify-content':'flex-end','gap':'8px',
            'flex':'0 0 auto','width':'auto','min-width':'0',
            'height':'100%','align-self':'center','margin-left':'auto'
        });
        all('.oc-action', {'display':'inline-flex','flex-direction':'row','flex-wrap':'nowrap','align-items':'center',
            'justify-content':'center','gap':'6px','flex':'0 0 auto','width':'auto',
            'min-width':'0','height':'29px','padding':'0 10px','border':'1px solid #6682aa',
            'border-radius':'6px','background':'white','font-size':'12px','font-weight':'600','white-space':'nowrap',
            'text-decoration':'none','color':'#356293',
            'pointer-events':'auto','cursor':'pointer'});
        all('.oc-action-icon', {'display':'inline-flex','align-items':'center','justify-content':'center',
            'width':'17px','height':'17px','flex':'0 0 17px','border-radius':'0',
            'background':'transparent','color':'#356293','box-shadow':'none'});
        all('.oc-action-icon svg', {'width':'15px','height':'15px'});
        // Pulsante informazioni centrato verticalmente nella barra.
        set(root.querySelector('.oc-help-wrap'), {
            'display':'flex','align-items':'center','justify-content':'center',
            'height':'100%','align-self':'stretch', 'width':'32px',
            'flex':'0 0 32px', 'margin':'0','padding':'0'
        });
        all('.oc-info-button', {
            'box-sizing':'border-box','appearance':'none','-webkit-appearance':'none',
            'display':'flex','align-items':'center','justify-content':'center',
            'width':'28px','height':'28px','min-width':'28px','min-height':'28px',
            'flex':'0 0 28px','margin':'0','padding':'0',
            'border':'1px solid #6682aa','border-radius':'50%',
            'background':'white','color':'#356293',
            'font':'700 16px/1 system-ui,sans-serif','cursor':'pointer'
        });
        // Identiche misure anche quando la CSP di OSM blocca il foglio CSS.
        all('.oc-card, .oc-main, .oc-metrics, .oc-metric, .oc-member-row, .oc-member-button, .oc-actions, .oc-action, .oc-help-wrap', {
            'box-sizing':'border-box'
        });
        set(root.querySelector('.oc-member-row'), {
            'display':'flex','align-items':'center','justify-content':'flex-start',
            'height':MEMBER_ROW_HEIGHT+'px','padding':'0 8px','gap':'8px',
            'background':'rgba(52,120,237,0.04)'
        });
        all('.oc-member-button', {
            'display':'inline-flex','align-items':'center','justify-content':'center','gap':'8px',
            'height':'30px','padding':'0 8px','border':'1px solid #1650b0','border-radius':'6px',
            'background':'linear-gradient(#3478ed,#1451aa)', 'box-shadow':'0 1px 3px #0002',
            'color':'white','font':'700 13px/1 system-ui,sans-serif','white-space':'nowrap','cursor':'pointer'
        });
        set($('order-button'), {'flex':'0 0 170px','width':'170px','min-width':'170px',
            'max-width':'170px','padding':'0 8px','margin':'0'});
        set($('guidepost-button'), {'flex':'0 0 220px','width':'220px','min-width':'220px',
            'max-width':'220px','padding':'0 7px','margin':'0',
            'background':'linear-gradient(#36836b,#225a48)'});
        set(root.querySelector('.oc-actions'), {'gap':'6px','margin-left':'auto'});
        const actionLinks = root.querySelectorAll('.oc-actions > a.oc-action');
        [88, 137].forEach((width, index) => {
            set(actionLinks[index], {'flex':'0 0 '+width+'px','width':width+'px',
                'min-width':width+'px','max-width':width+'px',
                'padding':'0 5px','margin':'0'});
        });
        set(root.querySelector('.oc-help-wrap'), {'flex':'0 0 30px','width':'30px',
            'min-width':'30px','max-width':'30px'});

        set(root.querySelector('.oc-member-icon'), {
            'display':'inline-flex','align-items':'center','justify-content':'center','color':'#356293'
        });
        all('.oc-member-icon svg', {'width':'18px','height':'18px'});
        // Il fallback su OSM deve includere ENTRAMBI i pallini, non soltanto
        // il primo (.querySelector selezionava solo Analisi geometria).
        all('.oc-member-dot', {'display':'inline-block','visibility':'visible','opacity':'1',
            'flex':'0 0 10px','flex-shrink':'0','width':'10px','height':'10px',
            'min-width':'10px','min-height':'10px','border-radius':'50%'});
        set($('guidepost-dot'), {'display':'block','visibility':'visible','opacity':'1',
            'flex':'0 0 12px','width':'12px','height':'12px','min-width':'12px','overflow':'visible'});
        // Linguetta di chiusura: sul bordo sinistro, nello stesso punto di apertura.
        set(root.querySelector('.oc-close-rail'), {
            'position':'absolute','top':'0','left':'0','right':'auto',
            'width':RAIL_WIDTH+'px','height':'100%','display':'flex',
            'align-items':'center','justify-content':'center',
            'background':'white','border':'1px solid #d8dee6',
            'border-right':'0','border-radius':'7px 0 0 7px',
            'pointer-events':'auto','box-shadow':'2px 2px 7px rgba(0,0,0,.07)'
        });
        set(root.querySelector('.oc-close-button'), {
            'display':'flex','align-items':'center','justify-content':'center',
            'width':'100%','height':'100%','margin':'0','padding':'0',
            'border':'0','background':'transparent','color':'#356293',
            'font':'700 20px/1 system-ui,sans-serif', 'cursor':'pointer'
        });
        // La linguetta di riapertura occupa la stessa posizione e ha altezza, larghezza,
        // bordo e sfondo di quella di chiusura.
        set(root.querySelector('.oc-closed'), {
            'box-sizing':'border-box','display':'flex','align-items':'center',
            'justify-content':'center','width':RAIL_WIDTH+'px',
            'height':BAR_HEIGHT+'px','margin':'0','padding':'0',
            'border':'1px solid #d8dee6','border-radius':'7px 0 0 7px',
            'background':'white','box-shadow':'2px 2px 7px rgba(0,0,0,.07)',
            'pointer-events':'auto','cursor':'pointer','color':'#356293',
            'font':'700 20px/1 system-ui,sans-serif'
        });
        set(root.querySelector('.oc-popover'), {'position':'absolute','left':RAIL_WIDTH+'px','top':'100%',
            'margin-top':'5px','width':'calc(100% - '+RAIL_WIDTH+'px)','max-width':'calc(100vw - 24px)',
            'max-height':'70vh','height':'auto','overflow':'auto','background':'white',
            'border':'1px solid #cbd5e1','border-radius':'8px',
            'box-shadow':'0 3px 12px rgba(0,0,0,.2)','pointer-events':'auto',
            'z-index':'3',
            'display':root.querySelector('.oc-popover')?.hidden ? 'none' : 'block'});
        // OSM può bloccare il foglio <style> dello userscript. Entrambi i popup
        // condividono .oc-order-popover: occorre applicare il fallback a CIASCUNO,
        // non solo al primo (quello geometrico), altrimenti la segnaletica perde
        // position/left/top e viene resa come un blocco largo dentro la barra.
        root.querySelectorAll('.oc-order-popover').forEach(popup => {
            const isGuidepost=popup.id==='osm2cai-guidepost-popover';
            set(popup, {'box-sizing':'border-box','position':'absolute',
                'left':RAIL_WIDTH+'px','top':'100%','right':'auto','bottom':'auto',
                'margin':'5px 0 0','padding':'0','width':'450px',
                'max-width':'calc(100vw - 24px)','max-height':'70vh',
                'height':'auto','overflow':'auto','background':'white','border':'1px solid #cbd5e1',
                'border-radius':isGuidepost?'12px':'8px',
                'box-shadow':'0 3px 12px rgba(0,0,0,.2)',
                'pointer-events':'auto','z-index':isGuidepost?'3':'2',
                'display':popup.hidden?'none':'block'});
        });
        // Lo stile iniettato può essere bloccato dalla CSP di OSM: il popup
        // percorribilità deve ricevere gli stessi stili inline degli altri popup.
        const issuesPopup = root.querySelector('.oc-issues-popover');
        set(issuesPopup, {
            'box-sizing':'border-box','position':'absolute',
            'top':'100%','left':RAIL_WIDTH+'px','margin-top':'5px',
            'width':'500px','max-width':'calc(100vw - 24px)',
            'max-height':'65vh','height':'auto','overflow':'auto',
            'background':'#ffffff','color':'#233344',
            'border':'1px solid #9ca9bb','border-radius':'8px',
            'box-shadow':'0 7px 22px rgba(0,0,0,.2)',
            'padding':'12px 14px','pointer-events':'auto',
            'font':'13px/1.45 system-ui,sans-serif','z-index':'4',
            'display':issuesPopup?.hidden ? 'none' : 'block'
        });
        // Stessa intestazione su OSM e WMT: il CSS di OSM può prevalere
        // sugli attributi style HTML e rendere la X un pulsante quadrato
        // vicino al titolo. Applichiamo !important direttamente agli elementi.
        set(root.querySelector('.oc-issues-heading'), {
            'box-sizing':'border-box','display':'flex','flex-direction':'row',
            'align-items':'center','justify-content':'space-between',
            'width':'100%','min-height':'30px','gap':'12px',
            'margin':'0 0 8px','padding':'0'
        });
        set(root.querySelector('.oc-issues-heading-title'), {
            'display':'block','flex':'1 1 auto','min-width':'0',
            'margin':'0','padding':'0','font':'700 15px/1.3 system-ui,-apple-system,Segoe UI,sans-serif'
        });
        set(root.querySelector('#osm2cai-issues-close'), {
            'box-sizing':'border-box','appearance':'none','-webkit-appearance':'none',
            'display':'inline-flex','align-items':'center','justify-content':'center',
            'position':'static','flex':'0 0 26px','width':'26px','height':'26px',
            'min-width':'26px','min-height':'26px','margin':'0','padding':'0',
            'border':'1px solid #8797ac','border-radius':'50%',
            'background':'#fff','color':'#356293',
            'font':'600 18px/1 system-ui,-apple-system,Segoe UI,sans-serif',
            'text-align':'center','cursor':'pointer','box-shadow':'none'
        });
        set(root.querySelector('.oc-issues-table'), {
            'box-sizing':'border-box','width':'100%','border-collapse':'collapse',
            'table-layout':'fixed','margin':'0','font':'inherit','color':'inherit'
        });
        all('.oc-issues-table th, .oc-issues-table td', {
            'box-sizing':'border-box','text-align':'left','vertical-align':'top',
            'padding':'10px 7px','border-bottom':'1px solid #d8dfe7',
            'overflow-wrap':'anywhere','font-size':'13px'
        });
        all('.oc-issues-table th', {'width':'33%','font-weight':'650'});
        set(root.querySelector('.oc-issues-description'), {'white-space':'pre-wrap','overflow-wrap':'anywhere'});
        set(root.querySelector('.oc-order-popover-content'), {'padding':'14px 16px'});
        set(root.querySelector('.oc-order-header'), {'display':'flex','align-items':'center','justify-content':'space-between','gap':'12px','margin-bottom':'10px'});
        set(root.querySelector('.oc-order-title'), {'font-size':'15px','font-weight':'700','line-height':'1.3'});
        set(root.querySelector('.oc-order-close'), {'display':'inline-flex','align-items':'center','justify-content':'center','width':'26px','height':'26px','border':'1px solid #6682aa','border-radius':'999px','background':'white','color':'#356293','font':'700 18px/1 system-ui,sans-serif','cursor':'pointer'});
        // La modalità compatta mostra soltanto il pulsante per riaprire.
        const card = root.querySelector('.oc-card');
        const opener = root.querySelector('.oc-closed');
        set(card, {'display':collapsed ? 'none' : 'block'});
        set(root.querySelector('.oc-close-rail'), {'display':collapsed ? 'none' : 'flex'});
        set(opener, {'display':collapsed ? 'flex' : 'none'});
        adjustPosition();
        applyTheme(true);
    }

    // Tema automatico. Prima rileva il tema del sito, poi la sidebar e infine il sistema.
    function darkThemeEnabled() {
        const html = document.documentElement;
        const body = document.body;
        const flags = [html, body].filter(Boolean);
        for (const el of flags) {
            const explicit = el.getAttribute('data-bs-theme') || el.getAttribute('data-theme');
            if (explicit === 'dark') { return true; }
            if (explicit === 'light') { return false; }
            if (el.classList.contains('dark') || el.classList.contains('dark-mode')) { return true; }
            if (el.classList.contains('light') || el.classList.contains('light-mode')) { return false; }
        }
        // Better OSM Org e OSM possono colorare il pannello separatamente dal body.
        const sidebar = document.querySelector(isWmt() ? '[class*="svelte-q14p2h"]' : '#sidebar_content, #sidebar');
        const candidates = [sidebar, body, html];
        for (const el of candidates) {
            if (!el) { continue; }
            const bg = getComputedStyle(el).backgroundColor;
            const match = bg.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s\/]+([\d.]+))?\)/);
            if (!match || (match[4] !== undefined && Number(match[4]) < 0.5)) { continue; }
            const [, r, g, b] = match.map(Number);
            const brightness = 0.2126*r + 0.7152*g + 0.0722*b;
            return brightness < 120;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    let lastDarkTheme = null;
    function applyTheme(force = false) {
        const root = document.getElementById('osm2cai-bar');
        if (!root) { return; }
        const dark = darkThemeEnabled();
        if (!force && lastDarkTheme === dark) { return; }
        lastDarkTheme = dark;
        const palette = dark ? {
            background:'#26282b', text:'#e4e8ed', muted:'#b0b9c5',
            line:'#565e68', action:'#dce6f4', button:'#343a42', shadow:'0 2px 9px rgba(0,0,0,.4)'
        } : {
            background:'#ffffff', text:'#233344', muted:'#5a6574',
            line:'#d8dfe7', action:'#334155', button:'#ffffff', shadow:'0 2px 9px rgba(0,0,0,.16)'
        };
        function style(selector, values) {
            root.querySelectorAll(selector).forEach(node => {
                for (const [key, value] of Object.entries(values)) {
                    node.style.setProperty(key, value, 'important');
                }
            });
        }
        style(':scope', {'color':palette.text, 'color-scheme':dark ? 'dark' : 'light'});
        style('.oc-card', {'background':palette.background, 'border-color':palette.line, 'box-shadow':palette.shadow});
        style('.oc-main', {'border-bottom':'1px solid '+palette.line});
        style('.oc-member-row', {'background':dark ? 'rgba(168,199,255,0.08)' : 'rgba(52,120,237,0.04)'});
        style('.oc-member-button', {'color':'#ffffff', 'border-color':dark ? '#86b2f1' : '#1650b0'});
        style('.oc-member-icon', {'color':dark ? '#a8c7ff' : '#356293'});
        style('.oc-label', {'color':palette.muted});
        style('.oc-value', {'color':palette.text});
        style('.oc-action', {'color':dark ? '#c5dafa' : '#356293', 'background':palette.button, 'border-color':dark ? '#8099b6' : '#6682aa'});
        style('.oc-action-icon', {'color':dark ? '#c5dafa' : '#356293'});
        style('.oc-close-rail, .oc-closed', {'background':palette.background, 'border-color':palette.line, 'color':dark ? '#a8c7ff' : '#356293'});
        style('.oc-close-button', {'color':dark ? '#a8c7ff' : '#356293'});
        style('.oc-info-button', {'background':palette.button, 'border-color':dark ? '#8099b6' : '#6682aa', 'color':dark ? '#c5dafa' : '#356293'});
        style('.oc-popover', {'background':palette.background, 'border-color':palette.line, 'color':palette.text});
        style('.oc-order-popover', {'background':palette.background, 'border-color':palette.line, 'color':palette.text});
        style('.oc-issues-popover', {'background':palette.background, 'border-color':palette.line, 'color':palette.text});
        style('.oc-issues-heading-title', {'color':palette.text});
        style('.oc-issues-table th, .oc-issues-table td', {'border-bottom':'1px solid '+palette.line,'color':palette.text});
        style('#osm2cai-issues-close', {'background':palette.button, 'border-color':palette.line, 'color':dark ? '#a8c7ff' : '#356293'});
        style('.oc-order-title', {'color':palette.text});
        style('.oc-order-close', {'background':palette.button, 'border-color':dark ? '#8099b6' : '#6682aa', 'color':dark ? '#c5dafa' : '#356293'});
        style('.oc-popover th', {'background':'transparent', 'color':palette.text, 'border':'0', 'border-bottom':'1px solid '+palette.line});
        style('.oc-popover td', {'background':'transparent', 'color':palette.muted, 'border':'0', 'border-bottom':'1px solid '+(dark ? '#363d44' : '#edf0f4'), 'padding':'8px 12px 8px 0', 'vertical-align':'top'});
        style('.oc-popover tbody td:first-child', {'color':palette.text, 'font-weight':'500', 'width':'32%'});
        style('.oc-popover tbody tr:last-child td', {'border-bottom':'0'});
        style('.oc-popover .oc-popup-title, .oc-popover .oc-popup-subtitle', {'color':palette.text});
        style('.oc-popover .oc-help-legend', {'color':palette.muted});
        style('.oc-popover .oc-help-table-heading', {'color':palette.text});
        style('.oc-popover .oc-help-more', {'color':palette.muted});
        styleHelpPopup(palette, dark);
        applyModifiedPopupTheme();
        styleGuidepostPopover();
        // I pallini API/percorribilità/allineamento restano semanticamente colorati.
    }

    // Layout indipendente dal sito (WMT / OSM) e dal tema del sito:
    // OSM può bloccare il foglio <style> via CSP e applicare regole globali
    // ai div, alle tabelle e ai pulsanti. Perciò le regole essenziali sono
    // impostate con !important sui singoli elementi, inclusi quelli creati
    // dinamicamente da renderGuidepostAnalysis().
    function styleGuidepostPopover() {
        const popup = $('guidepost-popover');
        if (!popup) return;
        // Lo stesso tema della barra OSM2CAI, anche su OSM in modalità scura.
        // Mantiene invariati dimensioni, filtri e disposizione della tabella.
        const dark = darkThemeEnabled();
        const surface = dark ? '#26282b' : '#ffffff';
        const foreground = dark ? '#e4e8ed' : '#233344';
        const heading = dark ? '#e4e8ed' : '#334155';
        const subtleBorder = dark ? '#565e68' : '#cbd5e1';
        const headerGroup = dark ? '#354740' : '#cde8dd';
        const headerDetail = dark ? '#303b39' : '#eff3f3';
        const linkColor = dark ? '#a8c7ff' : '#2367b2';
        const put = (node, rules) => {
            if (!node) return;
            for (const [key, value] of Object.entries(rules))
                node.style.setProperty(key, value, 'important');
        };
        const each = (selector, rules) => popup.querySelectorAll(selector).forEach(el => put(el, rules));
        put(popup, {
            'box-sizing':'border-box', 'position':'absolute',
            'left':RAIL_WIDTH+'px', 'top':'100%', 'right':'auto', 'bottom':'auto',
            'width':'450px', 'max-width':'calc(100vw - 24px)',
            'height':'auto', 'max-height':'70vh', 'margin':'5px 0 0', 'padding':'0',
            'overflow-x':'hidden', 'overflow-y':'auto',
            'background':surface, 'color':foreground, 'color-scheme':dark ? 'dark' : 'light',
            'border':'1px solid '+subtleBorder, 'border-radius':'12px',
            'box-shadow':'0 3px 12px rgba(0,0,0,.2)',
            'font':'13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif',
            'text-align':'left', 'pointer-events':'auto', 'z-index':'3',
            'display':popup.hidden ? 'none' : 'block'
        });
        put(popup.firstElementChild, {
            'box-sizing':'border-box', 'display':'block',
            'width':'100%', 'margin':'0', 'padding':'14px 16px',
            'background':'transparent', 'color':foreground,
            'font':'13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif'
        });
        const output=$('guidepost-results');
        put(output, {'display':'block', 'width':'100%', 'margin':'0', 'padding':'0',
            'background':'transparent', 'color':foreground});
        if (!output) return;
        // Contatori / filtri: nessun reset o larghezza forzata dai CSS di OSM.
        const summary=output.firstElementChild;
        if (summary && summary.querySelectorAll('button[aria-pressed]').length===3) {
            put(summary, {'display':'flex','align-items':'center','gap':'7px',
                'flex-wrap':'wrap','margin':'8px 0 12px','padding':'0','background':'transparent'});
            summary.querySelectorAll('button').forEach(button => put(button, {
                'appearance':'none','-webkit-appearance':'none','display':'inline-block',
                'width':'auto','min-width':'0','max-width':'none','height':'auto',
                'margin':'0','padding':'2px 1px','border':'0','border-radius':'3px',
                'background':'transparent', 'box-shadow':'none',
                'font':'600 12px/1.4 system-ui,sans-serif','cursor':'pointer'
            }));
            const filterButtons=summary.querySelectorAll('button[aria-pressed]');
            // Totale segue il tema; gli altri due contatori conservano colori semantici leggibili.
            if(filterButtons[0]) put(filterButtons[0], {'color':foreground});
            if(filterButtons[1]) put(filterButtons[1], {'color':dark ? '#65d6a4' : '#16845b'});
            if(filterButtons[2]) put(filterButtons[2], {'color':dark ? '#f4a776' : '#b45c2b'});
        }
        const list=popup.querySelector('.oc-guidepost-table')?.parentElement;
        put(list, {'box-sizing':'border-box','width':'100%', 'max-height':'min(240px,34vh)',
            'overflow-y':'auto','overflow-x':'hidden','position':'relative',
            'margin':'0','padding':'0','background':'transparent'});
        const table=popup.querySelector('.oc-guidepost-table');
        put(table, {'box-sizing':'border-box','display':'table','width':'100%',
            'min-width':'0','max-width':'100%','margin':'0','padding':'0',
            'border':'0','border-collapse':'separate','border-spacing':'0',
            'table-layout':'fixed','background':'transparent',
            'font':'12px/1.25 system-ui,sans-serif','color':foreground});
        each('.oc-guidepost-table thead', {'display':'table-header-group'});
        each('.oc-guidepost-table tbody', {'display':'table-row-group'});
        each('.oc-guidepost-table tr', {'display':'table-row','height':'33px',
            'border':'0','margin':'0','padding':'0'});
        popup.querySelectorAll('.oc-guidepost-table thead th').forEach(th => {
            const secondLevel=th.parentElement.rowIndex===1;
            const grouped=th.colSpan===4;
            const role=th.rowSpan===2 && th!==popup.querySelector('.oc-guidepost-table thead th:first-child');
            put(th, {
                'box-sizing':'border-box','display':'table-cell','position':'sticky',
                'top':secondLevel?'24px':'0','z-index':secondLevel?'4':'3',
                'height':th.rowSpan===2?'58px':secondLevel?'34px':'24px',
                'margin':'0','padding':'2px 1px',
                'border':'0','border-bottom':'1px solid '+subtleBorder,
                'border-left':(grouped||role)?'1px solid '+subtleBorder:'0',
                'background':grouped?headerGroup:headerDetail,'color':heading,
                'font':`600 ${th.textContent==='wikimediacommons'?'10':'12'}px/1.25 system-ui,sans-serif`,
                'text-align':'center','vertical-align':'middle',
                'overflow-wrap':'normal','white-space':'normal'
            });
        });
        each('.oc-guidepost-table tbody td', {
            'box-sizing':'border-box','display':'table-cell',
            'height':'33px','margin':'0','padding':'2px',
            'border':'0','background':'transparent','color':foreground,
            'text-align':'center','vertical-align':'middle','white-space':'normal'
        });
        each('.oc-guidepost-table tbody td:not(:first-child) > span', {
            'display':'inline-flex','align-items':'center','justify-content':'center',
            'box-sizing':'border-box','width':'100%','height':'100%',
            'margin':'0','padding':'0','text-align':'center','line-height':'1'
        });
        each('.oc-guidepost-table tbody td:nth-child(2),.oc-guidepost-table tbody td:last-child', {
            'border-left':'1px solid '+subtleBorder
        });
        each('.oc-guidepost-table tbody td:first-child', {
            'text-align':'left','font-size':'12px'
        });
        each('.oc-guidepost-table tbody a', {
            'color':linkColor,'text-decoration':'underline',
            'text-underline-offset':'2px','white-space':'nowrap',
            'font':'12px/1.25 system-ui,sans-serif'
        });
        const editButton=[...output.querySelectorAll('button')].find(b => b.textContent?.startsWith('Aggiorna in iD editor'));
        put(editButton, {
            'appearance':'none','-webkit-appearance':'none',
            'display':'inline-block','width':'auto','min-width':'0','max-width':'100%',
            'height':'auto','margin':'0','padding':'6px 11px',
            'border':'1px solid #16764c','border-radius':'6px',
            'background':'#168358','color':'#ffffff','box-shadow':'none',
            'font':'600 12px/1.4 system-ui,sans-serif','text-align':'center',
            'cursor':editButton?.disabled?'default':'pointer'
        });
        put(popup.querySelector('.oc-guidepost-photo'), {
            'box-sizing':'border-box','width':'100%',
            'margin':'10px 0 2px','padding':'0',
            'background':'transparent','color':foreground,'text-align':'center'
        });
    }

    // Aspetto del popup applicato elemento per elemento: OSM può bloccare
    // i fogli <style> iniettati, quindi non dipendiamo dal CSS esterno.
    function styleHelpPopup(palette, dark) {
        const root = document.getElementById('osm2cai-bar');
        const popup = root?.querySelector('.oc-popover');
        if (!popup) { return; }
        const set = (node, rules) => {
            if (!node) { return; }
            for (const [key, value] of Object.entries(rules)) {
                node.style.setProperty(key, value, 'important');
            }
        };
        const many = (selector, rules) => {
            popup.querySelectorAll(selector).forEach(node => set(node, rules));
        };
        const divider = dark ? '#394047' : '#e9edf2';
        set(popup, {
            'box-sizing':'border-box', 'width':'calc(100% - '+RAIL_WIDTH+'px)',
            'max-width':'calc(100vw - 24px)', 'max-height':'min(70vh, 570px)',
            'overflow-y':'auto','overflow-x':'hidden',
            'background-color':palette.background,'color':palette.text,
            'border':'1px solid '+palette.line,'border-radius':'10px',
            'box-shadow':dark ? '0 12px 32px rgba(0,0,0,.38)' : '0 12px 32px rgba(0,0,0,.18)',
            'font-family':'system-ui,-apple-system,Segoe UI,sans-serif',
            'line-height':'1.5', 'text-align':'left'
        });
        set(popup.querySelector('.oc-popup-content'), {
            'box-sizing':'border-box','padding':'14px 18px 16px',
            'font':'13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif',
            'color':palette.text
        });
        set(popup.querySelector('.oc-popup-title'), {
            'display':'block','font-size':'16px','font-weight':'700',
            'line-height':'1.3','margin':'0','padding':'0',
            'color':palette.text
        });
        const table = popup.querySelector('.oc-help-table');
        set(table, {
            'width':'100%','table-layout':'fixed','border-collapse':'collapse',
            'border-spacing':'0','margin':'0','padding':'0','background':'transparent',
            'font-size':'13px','line-height':'1.4','color':palette.text
        });
        many('thead tr, tbody tr', {'background':'transparent','border':'0'});
        many('th', {
            'box-sizing':'border-box','text-align':'left','vertical-align':'bottom',
            'padding':'0 10px 7px 0','font-weight':'650','font-size':'13px',
            'border':'0','border-bottom':'1px solid '+divider,
            'background':'transparent','color':palette.text
        });
        many('tbody td', {
            'box-sizing':'border-box','padding':'9px 10px 9px 0',
            'font-size':'13px','font-weight':'400','line-height':'1.4',
            'vertical-align':'top','text-align':'left','border':'0',
            'border-bottom':'1px solid '+divider,
            'background':'transparent','color':palette.muted,
            'overflow-wrap':'break-word','white-space':'normal'
        });
        many('thead th:first-child, tbody td:first-child', {
            'width':'30%','padding-right':'12px','color':palette.text
        });
        many('tbody td:first-child', {'font-weight':'550'});
        many('tbody tr:last-child td', {'border-bottom':'0'});
        set(popup.querySelector('.oc-popup-subtitle'), {
            'margin':'15px 0 9px','padding':'0','font-size':'15px',
            'font-weight':'700','line-height':'1.3','color':palette.text
        });
        set(popup.querySelector('.oc-popup-heading'), {
            'display':'flex','align-items':'flex-start','justify-content':'space-between',
            'flex-wrap':'nowrap','column-gap':'12px','margin-bottom':'12px'
        });
        set(popup.querySelector('.oc-popup-brand'), {
            'display':'flex','flex-direction':'column','min-width':'0','gap':'3px','flex':'1 1 auto'
        });
        set(popup.querySelector('.oc-popup-version'), {
            'font-size':'11px','line-height':'1.4','color':palette.muted
        });
        set(popup.querySelector('.oc-popup-close'), {
            'appearance':'none','-webkit-appearance':'none',
            'display':'inline-flex','align-items':'center','justify-content':'center',
            'box-sizing':'border-box','flex':'0 0 28px','width':'28px','height':'28px',
            'padding':'0','margin':'-2px 0 0','border':'1px solid '+palette.line,
            'border-radius':'50%','background':palette.button,
            'font':'600 20px/1 system-ui,sans-serif',
            'color':dark ? '#a8c7ff' : '#356293','cursor':'pointer'
        });
        set(popup.querySelector('.oc-popup-documentation'), {
            'display':'flex','flex-direction':'column','gap':'10px',
            'padding':'11px 0 12px','margin':'0 0 12px',
            'border-top':'1px solid '+divider,'border-bottom':'1px solid '+divider
        });
        many('.oc-popup-doc-section', {
            'display':'flex','flex-direction':'column','gap':'6px'
        });
        many('.oc-popup-doc-label', {
            'font-size':'12px','font-weight':'700','line-height':'1.35','color':palette.text
        });
        many('.oc-popup-links', {
            'display':'flex','flex-wrap':'wrap','align-items':'center',
            'column-gap':'8px','row-gap':'7px','margin':'0','padding':'0'
        });
        many('.oc-popup-links a', {
            'display':'inline-flex','align-items':'center','gap':'6px',
            'box-sizing':'border-box','max-width':'100%',
            'padding':'5px 9px','border':'1px solid '+palette.line,
            'border-radius':'6px','background':dark ? '#283241' : '#f5f8fc',
            'color':dark ? '#a8c7ff' : '#2563b6',
            'font-size':'12px','font-weight':'600','line-height':'1.4',
            'text-decoration':'none','white-space':'normal','overflow-wrap':'break-word',
            'cursor':'pointer'
        });
        many('.oc-popup-links a span', {
            'font-size':'11px','opacity':'0.75'
        });
        set(popup.querySelector('.oc-help-legend-heading'), {
            'font-size':'13px','font-weight':'700','margin':'0 0 6px','color':palette.text
        });
        set(popup.querySelector('.oc-help-legend'), {
            'display':'flex','flex-wrap':'wrap','align-items':'center',
            'column-gap':'14px','row-gap':'7px','font-size':'12px',
            'line-height':'1.4','color':palette.muted,
            'margin':'0 0 12px','padding':'0'
        });
        many('.oc-help-legend > span', {
            'display':'inline-flex','align-items':'center','gap':'5px',
            'white-space':'nowrap','margin':'0','padding':'0'
        });
        popup.querySelectorAll('.oc-help-legend > span > span').forEach((dot, i) => {
            set(dot, {
                'display':'inline-block','flex':'0 0 10px','width':'10px',
                'height':'10px','min-width':'10px','min-height':'10px',
                'border-radius':'50%','background-color':
                    ['#22bd3c','#ed3043','#f59e0b','#9ca3af'][i] || '#9ca3af',
                'margin':'0','padding':'0','vertical-align':'middle'
            });
        });
    }

    // Dati di dettaglio della percorribilità: usa solo campi API, senza HTML.
    function setIssuesDetails(properties) {
        const description = $('issues-description');
        const updated = $('issues-updated');
        if (description) description.textContent = typeof properties?.issues_description === 'string' &&
            properties.issues_description.trim() ? properties.issues_description : '—';
        if (updated) {
            const raw = properties?.issues_last_update;
            const parsed = typeof raw === 'string' && raw.trim() ? new Date(raw) : null;
            updated.textContent = parsed && Number.isFinite(parsed.getTime())
                ? new Intl.DateTimeFormat('it-IT', {timeZone:'Europe/Rome',dateStyle:'short',timeStyle:'short'}).format(parsed)
                : (typeof raw === 'string' && raw.trim() ? raw : '—');
            if (typeof raw === 'string') updated.title = raw;
        }
    }

    let issuesHoverTimer = null;
    function closeIssuesPopover() {
        clearTimeout(issuesHoverTimer);
        issuesHoverTimer = null;
        const panel = $('issues-popover');
        if (panel) {
            panel.hidden = true;
            panel.style.setProperty('display','none','important');
        }
        $('issues-trigger')?.setAttribute('aria-expanded','false');
    }

    function newPanel(relationId) {
        removePanel();
        insertStyle();
        const bar = document.createElement('div');
        bar.id = 'osm2cai-bar';
        // Impedisce che Turbo memorizzi il pannello nelle istantanee OSM.
        bar.setAttribute('data-turbo-temporary', '');
        bar.innerHTML = `
          <button type="button" class="oc-closed" id="osm2cai-open" title="Apri OSM2CAI" aria-label="Apri barra OSM2CAI">▶</button>
          <div class="oc-card">
            <div class="oc-main">
              <div class="oc-metrics">
                <div class="oc-metric"><div><div class="oc-label">OSM2CAI API</div><div class="oc-value" id="osm2cai-status">⏳ Verifica</div></div></div>
                <div class="oc-metric"><div><div class="oc-label">SDA</div><div class="oc-value" id="osm2cai-sda">—</div></div></div>
                <div class="oc-metric oc-issues-trigger" id="osm2cai-issues-trigger" role="button" tabindex="0" aria-label="Dettagli stato di percorribilità" aria-haspopup="dialog" aria-expanded="false" aria-controls="osm2cai-issues-popover"><div><div class="oc-label">Stato di percorribilità</div><div class="oc-value" id="osm2cai-issues">—</div></div></div>
                <div class="oc-metric"><div><div class="oc-label">Data validazione</div><div class="oc-value" id="osm2cai-date">—</div></div></div>
                <div class="oc-metric"><div><div class="oc-label">Allineamento</div><div class="oc-value" id="osm2cai-sync">—</div></div></div>
              </div>

            </div>
            <div class="oc-member-row">
              <button type="button" class="oc-member-button" id="osm2cai-order-button" aria-label="Analisi geometria" aria-controls="osm2cai-order-popover" aria-expanded="false">
                <span class="oc-member-dot" id="osm2cai-order-dot" aria-hidden="true"></span>
                <span>Analisi geometria</span>
              </button>
              <button type="button" class="oc-member-button" id="osm2cai-guidepost-button" aria-controls="osm2cai-guidepost-popover" aria-expanded="false"><svg id="osm2cai-guidepost-dot" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style="display:block!important;visibility:visible!important;opacity:1!important;width:12px!important;height:12px!important;min-width:12px!important;flex:0 0 12px!important;overflow:visible!important"><circle id="osm2cai-guidepost-dot-circle" cx="6" cy="6" r="5" fill="#94a3b8" stroke="none"></circle></svg><span>Analisi segnaletica verticale</span></button>
              <div class="oc-actions">
                <a class="oc-action" id="osm2cai-target" aria-disabled="true" target="_blank" rel="noopener noreferrer" aria-label="Apri su OSM2CAI" title="Apri su OSM2CAI"><span class="oc-action-icon">${ICON_LINK}</span><span>OSM2CAI</span></a>
                ${isWmt()
                    ? `<a class="oc-action" href="https://www.openstreetmap.org/relation/${encodeURIComponent(relationId)}" target="_blank" rel="noopener noreferrer" aria-label="Apri su OpenStreetMap" title="Apri su OpenStreetMap"><span class="oc-action-icon">${ICON_LINK}</span><span>OpenStreetMap</span></a>`
                    : `<a class="oc-action" href="https://hiking.waymarkedtrails.org/#route?id=${encodeURIComponent(relationId)}" target="_blank" rel="noopener noreferrer" aria-label="Apri su Waymarked Trails" title="Apri su Waymarked Trails"><span class="oc-action-icon">${ICON_LINK}</span><span>Waymarked Trails</span></a>`}
                <div class="oc-help-wrap">
                  <button type="button" class="oc-info-button" id="osm2cai-info-button" aria-label="Info OSM2CAI Tools" aria-controls="osm2cai-popover" aria-expanded="false">?</button>
                </div>
              </div>
            </div>
          </div>
          <div class="oc-close-rail">
            <button type="button" class="oc-close-button" id="osm2cai-close" title="Compatta OSM2CAI" aria-label="Compatta barra OSM2CAI">◀</button>
          </div>
          <div class="oc-popover" id="osm2cai-popover" role="dialog" aria-label="Info OSM2CAI Tools" hidden>
            <div class="oc-popup-content" style="padding:14px 18px 16px;font:13px/1.4 system-ui,-apple-system,sans-serif;">
              <div class="oc-popup-heading">
                <div class="oc-popup-brand">
                  <div class="oc-popup-title">OSM2CAI Tools</div>
                  <div class="oc-popup-version">Versione ${SCRIPT_VERSION} · Strumenti per OpenStreetMap e OSM2CAI</div>
                </div>
                <button type="button" class="oc-popup-close" id="osm2cai-popup-close" aria-label="Chiudi informazioni" title="Chiudi">×</button>
              </div>
              <div class="oc-popup-documentation">
                <div class="oc-popup-doc-section">
                  <div class="oc-popup-doc-label">Progetto e documentazione</div>
                  <nav class="oc-popup-links" aria-label="Progetto e documentazione">
                    <a href="https://github.com/andrea-del-sarto/OSM2CAI_Tools" target="_blank" rel="noopener noreferrer" title="Apri il progetto su GitHub">GitHub <span aria-hidden="true">↗</span></a>
                    <a href="https://github.com/andrea-del-sarto/OSM2CAI_Tools/blob/main/README.md" target="_blank" rel="noopener noreferrer" title="Presentazione e installazione">README.md <span aria-hidden="true">↗</span></a>
                    <a href="https://github.com/andrea-del-sarto/OSM2CAI_Tools/blob/main/FUNZIONALIT%C3%80.md" target="_blank" rel="noopener noreferrer" title="Guida alle funzionalità">Funzionalità <span aria-hidden="true">↗</span></a>
                  </nav>
                </div>
                <div class="oc-popup-doc-section">
                  <div class="oc-popup-doc-label">Risorse CAI / OSM</div>
                  <nav class="oc-popup-links" aria-label="Risorse CAI e OpenStreetMap">
                    <a href="https://catastorei.gitbook.io/documentazione-osm2cai" target="_blank" rel="noopener noreferrer">Documentazione OSM2CAI <span aria-hidden="true">↗</span></a>
                    <a href="https://wiki.openstreetmap.org/wiki/IT:CAI" target="_blank" rel="noopener noreferrer">Linee guida OSM/CAI <span aria-hidden="true">↗</span></a>
                  </nav>
                </div>
              </div>
              <div class="oc-help-legend-heading" style="font-size:13px;font-weight:700;margin:0 0 6px;">Legenda</div>
              <div class="oc-help-legend" style="display:flex;flex-wrap:wrap;align-items:center;gap:7px 14px;font-size:12px;margin-bottom:12px;">
                <span><span style="display:inline-block;width:12px;height:12px;background:#22bd3c;border-radius:50%;margin-right:6px;"></span>Positivo</span>
                <span><span style="display:inline-block;width:12px;height:12px;background:#ed3043;border-radius:50%;margin-right:6px;"></span>Problema</span>
                <span><span style="display:inline-block;width:12px;height:12px;background:#f59e0b;border-radius:50%;margin-right:6px;"></span>Stato intermedio</span>
                <span><span style="display:inline-block;width:12px;height:12px;background:#9ca3af;border-radius:50%;margin-right:6px;"></span>Sconosciuto</span>
              </div>
              <div class="oc-help-table-heading" style="font-size:14px;font-weight:700;margin:14px 0 8px;">Informazioni della barra</div>
              <table class="oc-help-table" style="width:100%;border-collapse:collapse;table-layout:fixed;text-align:left;font-size:13px;line-height:1.4;">
                <tbody>
                  <tr><td>OSM2CAI API</td><td>Disponibilità del servizio OSM2CAI.</td></tr>
                  <tr><td>SDA</td><td>Stato di accatastamento CAI.</td></tr>
                  <tr><td>Percorribilità</td><td>Stato del percorso e dettagli disponibili.</td></tr>
                  <tr><td>Data validazione</td><td>Età dell'ultima validazione OSM2CAI.</td></tr>
                  <tr><td>Allineamento</td><td>Confronto tra le date OSM e OSM2CAI.</td></tr>
                  <tr><td>Analisi geometria</td><td>Controllo della continuità e possibili problemi.</td></tr>
                </tbody>
              </table>
            </div></div>
          <div class="oc-order-popover" id="osm2cai-order-popover" role="dialog" aria-label="Analisi geometria" hidden>
            <div class="oc-order-popover-content">
              <div id="osm2cai-order-results" aria-live="polite" style="margin:0;"></div>
            </div>
          </div>
          <div class="oc-order-popover" id="osm2cai-guidepost-popover" role="dialog" aria-label="Analisi segnaletica verticale" hidden style="width:450px;max-width:calc(100vw - 24px);z-index:3;border-radius:12px;">
            <div style="padding:14px 16px;">
              <div id="osm2cai-guidepost-results" aria-live="polite"></div>
            </div>
          </div>
          <div id="osm2cai-issues-popover" class="oc-issues-popover" role="dialog" aria-label="Dettagli stato di percorribilità" hidden>
            <div class="oc-issues-heading" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
              <strong class="oc-issues-heading-title" style="font-size:15px;">Stato di percorribilità</strong>
              <button type="button" id="osm2cai-issues-close" aria-label="Chiudi dettagli percorribilità" style="cursor:pointer;border:1px solid #8797ac;border-radius:50%;width:26px;height:26px;background:white;color:#356293;">×</button>
            </div>
            <table class="oc-issues-table"><tbody>
              <tr><th scope="row">Descrizione</th><td class="oc-issues-description" id="osm2cai-issues-description">—</td></tr>
              <tr><th scope="row">Data aggiornamento</th><td id="osm2cai-issues-updated">—</td></tr>
            </tbody></table>
          </div>
          <div id="osm2cai-modified-popup" role="tooltip" hidden></div>`;
        // Fondament: direttamente su body, non dentro #map o sidebar (che OSM può rimpiazzare).
        document.body.appendChild(bar);
        // Firefox: il solo stopPropagation non era sufficiente per aprire
        // questi due collegamenti sulla pagina OSM/WMT. Per il normale clic
        // sinistro usiamo il gestore userscript, che apre una vera scheda.
        // Ctrl/Cmd/Shift/Alt+clic, clic centrale e menu contestuale conservano
        // il comportamento nativo dei link; nessun intervento su Analisi geometria.
        const isFirefoxBrowser = /Firefox\//.test(navigator.userAgent);
        bar.querySelectorAll('.oc-actions a.oc-action').forEach(link => {
            link.style.setProperty('pointer-events','auto','important');
            link.addEventListener('click', event => {
                if (link.getAttribute('aria-disabled') === 'true' || !link.getAttribute('href')) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (event.button !== 0 || event.ctrlKey || event.metaKey ||
                    event.shiftKey || event.altKey || !isFirefoxBrowser) return;
                // L'URL puo' essere aggiornato da WMT in fase di cattura
                // del click: leggerlo adesso, senza salvarne una copia vecchia.
                const url = new URL(link.href, location.href);
                if (url.protocol !== 'https:' || ![
                    'osm2cai.cai.it', 'www.openstreetmap.org',
                    'hiking.waymarkedtrails.org'
                ].includes(url.hostname)) return;
                if (typeof GM_openInTab !== 'function') return;
                try {
                    GM_openInTab(url.href, {active:true, insert:true});
                    event.preventDefault();
                    event.stopPropagation();
                } catch (error) {
                    // Il browser mantiene la navigazione HTML se l'API fallisce.
                    console.warn('[OSM2CAI Tools] Apertura gestita non riuscita:', error);
                }
            });
        });
        $('close')?.addEventListener('click', () => setCollapsed(true));
        $('open')?.addEventListener('click', () => setCollapsed(false));
        const syncMetric = $('sync')?.closest('.oc-metric');
        const modifiedPopup = $('modified-popup');
        syncMetric?.addEventListener('mouseenter', () => {
            clearTimeout(modifiedHoverTimer);
            renderModifiedPopup();
        });
        syncMetric?.addEventListener('mouseleave', scheduleHideModifiedPopup);
        modifiedPopup?.addEventListener('mouseenter', () => clearTimeout(modifiedHoverTimer));
        modifiedPopup?.addEventListener('mouseleave', scheduleHideModifiedPopup);
        const orderButton = $('order-button');
        const orderPopover = $('order-popover');
        const orderClose = $('order-close');
        const guidepostPopover=$('guidepost-popover');
        guidepostPopover?.addEventListener('click',event=>{
            if(event.target.closest('.oc-guidepost-table,.oc-guidepost-photo')) return;
            if(selectedGuidepostId===null) return;
            selectedGuidepostId=null;
            const photo=guidepostPopover.querySelector('.oc-guidepost-photo');
            if(photo){photo.replaceChildren();photo.hidden=true;}
            for(const row of guidepostPopover.querySelectorAll('.oc-guidepost-table tbody tr')){
                row.setAttribute('aria-selected','false');
                row.style.background='transparent';
            }
            orderRenderSignature=null;
            renderOrderMapOverlay();
            startOrderAnimation(700);
        });
        $('guidepost-button')?.addEventListener('click',()=>{
            const opening=guidepostPopover.hidden;
            closeGuidepostPopover();
            if (opening) {
                closeIssuesPopover();
                orderPopover.hidden=true;orderButton.setAttribute('aria-expanded','false');
                popover.hidden=true;button.setAttribute('aria-expanded','false');
                clearOrderMap();
                guidepostPopover.hidden=false;
                $('guidepost-button').setAttribute('aria-expanded','true');
                renderGuidepostAnalysis();
            }
            applyInlineLayout();
        });
        // WMT: il profilo e' considerato gestito solo quando risulta aperto.
        // Non effettuare mai un secondo click automatico dopo un click non
        // verificato: un toggle tardivo potrebbe richiudere il profilo.
        let wmtElevationHandledRelation = null;
        let wmtElevationAttempt = null;
        let wmtElevationUncertainClickRelation = null;
        function revealWmtElevationProfile() {
            if (!isWmt()) return;
            const rid=relationIdFromUrl();
            if (!rid || wmtElevationHandledRelation === rid ||
                (wmtElevationAttempt && wmtElevationAttempt.rid===rid && wmtElevationAttempt.pending)) return;
            const attempt={rid,pending:true,clicked:false,tries:0,verificationTries:0};
            wmtElevationAttempt=attempt;
            const current=()=>wmtElevationAttempt===attempt && rid===relationIdFromUrl();
            const finish=success=>{
                if (!current()) return;
                attempt.pending=false;
                if (success) wmtElevationHandledRelation=rid;
            };
            const locate=()=>{
                const panels=[...document.querySelectorAll('.sidepanel')].filter(p=>{
                    const r=p.getBoundingClientRect(), st=getComputedStyle(p);
                    return r.width>140 && r.height>120 && st.display!=='none' && st.visibility!=='hidden';
                });
                for(const panel of panels){
                    const walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);
                    let t;
                    while((t=walker.nextNode())){
                        const raw=(t.textContent||'').replace(/[\s▸▾▶▼►▴▵⌄⌃]+/g,' ').trim();
                        if(!/^(profilo altimetrico|elevation profile|height profile|höhenprofil|profil altimétrique)$/i.test(raw)) continue;
                        const el=t.parentElement;
                        if(!el || el.closest('#osm2cai-bar')) continue;
                        const details=el.closest('details');
                        if(details) return {panel,trigger:details.querySelector('summary')||el,details};
                        let trigger=el.closest('summary,button,[role="button"],[aria-expanded]');
                        if(!trigger){
                            for(let p=el,i=0;p&&p!==panel&&i<5;p=p.parentElement,i++){
                                const cls=String(p.className||'');
                                if(/header|heading|accordion|collapse|toggle|section-title|panel-title/i.test(cls) ||
                                    getComputedStyle(p).cursor==='pointer') {trigger=p;break;}
                            }
                        }
                        return {panel,trigger:trigger||el,details:null};
                    }
                }
                return null;
            };
            const state=found=>{
                if(found.details) return found.details.open?'open':'closed';
                const {trigger}=found;
                const expanded=trigger.getAttribute('aria-expanded');
                if(expanded==='true') return 'open';
                if(expanded==='false') return 'closed';
                if(trigger.classList.contains('expanded')||trigger.classList.contains('active')) return 'open';
                const label=(trigger.textContent||'').trim();
                // Gli indicatori native WMT sono utili anche se manca aria-expanded.
                if(/^[\s▼▾⌄]/.test(label) && /^[▼▾⌄]/.test(label.trim())) return 'open';
                if(/^[▸▶►▴]/.test(label.trim())) return 'closed';
                const section=trigger.parentElement;
                const chart=section?.querySelector('svg,canvas,.chart,.profile-chart');
                if(chart && chart.getBoundingClientRect().height>35 &&
                    getComputedStyle(chart).visibility!=='hidden') return 'open';
                return 'unknown';
            };
            const scrollIntoSidebar=found=>{
                const scroller=found.trigger.closest('.sidepanel-content')||found.panel;
                const h=found.trigger.getBoundingClientRect(),b=scroller.getBoundingClientRect();
                if(h.top<b.top||h.bottom>b.bottom) scroller.scrollTop+=h.top-b.top-8;
            };
            const verify=()=>{
                if(!current() || !attempt.pending) return;
                const found=locate();
                if(found && state(found)==='open') {wmtElevationUncertainClickRelation=null;finish(true);return;}
                if(++attempt.verificationTries<20) setTimeout(verify,200);
                else finish(false);
            };
            const reveal=()=>{
                if(!current() || !attempt.pending || $('order-popover')?.hidden) {
                    if(current()) finish(false);
                    return;
                }
                const found=locate();
                if(!found){
                    if(++attempt.tries<30) setTimeout(reveal,300);
                    else finish(false);
                    return;
                }
                const before=state(found);
                if(before==='open'){wmtElevationUncertainClickRelation=null;finish(true);scrollIntoSidebar(found);return;}
                // In caso di stato sconosciuto, un solo click per apertura
                // del popup; i successivi tentativi sono permessi solo se
                // il controllo indica esplicitamente che il profilo e' chiuso.
                if(before==='unknown' && wmtElevationUncertainClickRelation===rid) {
                    finish(false);return;
                }
                if(found.details){
                    found.details.open=true;
                }else{
                    attempt.clicked=true;
                    found.trigger.click();
                    if(before==='unknown') wmtElevationUncertainClickRelation=rid;
                }
                scrollIntoSidebar(found);
                verify();
            };
            reveal();
        }
        orderButton?.addEventListener('click', () => {
            if (!orderPopover) {
                return;
            }
            const opening = orderPopover.hidden;
            orderPopover.hidden = !opening;
            orderButton.setAttribute('aria-expanded', String(opening));
            if (opening) {
                closeGuidepostPopover();
                closeIssuesPopover();
                popover.hidden = true;
                button?.setAttribute('aria-expanded', 'false');
                renderOrderCheck();
                revealWmtElevationProfile();
            }
            applyInlineLayout();
        });
        orderClose?.addEventListener('click', () => {
            if (!orderPopover) {
                return;
            }
            orderPopover.hidden = true;
            orderButton?.setAttribute('aria-expanded', 'false');
            applyInlineLayout();
        });
        const button = $('info-button');
        const popover = $('popover');
        $('popup-close')?.addEventListener('click', () => {
            popover.hidden = true;
            button?.setAttribute('aria-expanded', 'false');
            applyInlineLayout();
        });
        button?.addEventListener('click', () => {
            closeGuidepostPopover();
            popover.hidden = !popover.hidden;
            button.setAttribute('aria-expanded', String(!popover.hidden));
            if (!popover.hidden) closeIssuesPopover();
            if (!popover.hidden && orderPopover) {
                orderPopover.hidden = true;
                orderButton?.setAttribute('aria-expanded', 'false');
            }
            applyInlineLayout();
        });
        const issuesTrigger = $('issues-trigger');
        const issuesPanel = $('issues-popover');
        const showIssues = () => {
            closeGuidepostPopover();
            clearTimeout(issuesHoverTimer);
            issuesHoverTimer = null;
            if (!issuesPanel || !issuesTrigger) return;
            issuesPanel.hidden = false;
            issuesPanel.style.setProperty('display','block','important');
            issuesTrigger.setAttribute('aria-expanded','true');
            popover.hidden = true;
            button?.setAttribute('aria-expanded','false');
            if (orderPopover) orderPopover.hidden = true;
            orderButton?.setAttribute('aria-expanded','false');
            // Allinea il popup alla metrica, anche con barra spostata.
            const barRect = bar.getBoundingClientRect();
            const metricRect = issuesTrigger.getBoundingClientRect();
            const width = Math.max(200, Math.min(500,window.innerWidth-24));
            const left = Math.max(8-barRect.left,
                Math.min(metricRect.left-barRect.left,window.innerWidth-width-12-barRect.left));
            issuesPanel.style.setProperty('width',width+'px','important');
            issuesPanel.style.setProperty('left',left+'px','important');
            issuesPanel.style.setProperty('top','100%','important');
            issuesPanel.style.setProperty('margin-top','5px','important');
        };
        const scheduleHideIssues = () => {
            clearTimeout(issuesHoverTimer);
            issuesHoverTimer = setTimeout(closeIssuesPopover,180);
        };
        issuesTrigger?.addEventListener('mouseenter',showIssues);
        issuesTrigger?.addEventListener('mouseleave',scheduleHideIssues);
        issuesPanel?.addEventListener('mouseenter', () => {
            clearTimeout(issuesHoverTimer);
            issuesHoverTimer = null;
        });
        issuesPanel?.addEventListener('mouseleave',scheduleHideIssues);
        // Accessibile anche da tastiera: focus apre, Escape chiude.
        issuesTrigger?.addEventListener('focus',showIssues);
        issuesTrigger?.addEventListener('blur',scheduleHideIssues);
        issuesTrigger?.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showIssues(); }
        });
        $('issues-close')?.addEventListener('click',closeIssuesPopover);
        // Chiude il popup cliccando all'esterno, senza bloccare gli eventi di OSM.
        document.addEventListener('pointerdown', function onOutsidePopup(event) {
            if (!bar.isConnected) {
                document.removeEventListener('pointerdown', onOutsidePopup);
                return;
            }
            if (guidepostPopover.contains(event.target) || $('guidepost-button')?.contains(event.target) || event.target.closest?.('#osm2cai-order-overlay')) return;
            closeGuidepostPopover();
            if (popover.hidden && (!orderPopover || orderPopover.hidden) && (!issuesPanel || issuesPanel.hidden)) {
                return;
            }
            const target = event.target;
            const orderBtn = $('order-button');
            const orderPanel = $('order-popover');
            const insideInfo = popover.contains(target) || button.contains(target);
            const insideOrder = !!(orderPanel && orderBtn && (orderPanel.contains(target) || orderBtn.contains(target)));
            const insideIssues = !!(issuesPanel && issuesTrigger &&
                (issuesPanel.contains(target) || issuesTrigger.contains(target)));
            if (insideInfo || insideOrder || insideIssues) {
                return;
            }
            popover.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            closeIssuesPopover();
            if (orderPanel) {
                orderPanel.hidden = true;
            }
            orderBtn?.setAttribute('aria-expanded', 'false');
            applyInlineLayout();
        });
        document.addEventListener('keydown', function onEscape(e) {
            if (!bar.isConnected) { document.removeEventListener('keydown', onEscape); return; }
            if (e.key === 'Escape') {
                if (!guidepostPopover.hidden) {closeGuidepostPopover();$('guidepost-button')?.focus();}
                closeIssuesPopover();
                const orderPopover = $('order-popover');
                let changed = false;
                if (!popover.hidden) {
                    popover.hidden = true;
                    button.setAttribute('aria-expanded', 'false');
                    changed = true;
                }
                if (orderPopover && !orderPopover.hidden) {
                    orderPopover.hidden = true;
                    $('order-button')?.setAttribute('aria-expanded', 'false');
                    changed = true;
                }
                if (changed) {
                    applyInlineLayout();
                }
            }
        });
        applyInlineLayout();
        adjustPosition();
    }

    // Annulla tutti i trasferimenti e risolve subito le Promise in attesa.
    // Incrementare sequence rende inoffensive anche eventuali risposte tardive.
    function cancelRequests() {
        ++sequence;
        if (relationLoad?.state === 'pending') relationLoad.state = 'cancelled';
        for (const request of [...inFlight]) {
            request.abort();
        }
        inFlight.clear();
    }

    function setCollapsed(value) {
        if (collapsed === value) {
            return;
        }
        if (isOsmEditing()) {
            cancelRequests();
            removePanel();
            return;
        }
        collapsed = value;
        localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
        if (value) {
            closeGuidepostPopover();
            resetModifiedElements();
            closeIssuesPopover();
            cancelRequests();
            const popover = $('popover');
            if (popover) {
                popover.hidden = true;
            }
            const orderPopover = $('order-popover');
            if (orderPopover) {
                orderPopover.hidden = true;
            }
            $('info-button')?.setAttribute('aria-expanded', 'false');
            $('order-button')?.setAttribute('aria-expanded', 'false');
        }
        applyInlineLayout();
        if (!value) {
            // Anche quando l'URL NON cambia, una relazione già selezionata
            // deve provocare immediatamente nuove richieste API alla riapertura.
            const id = relationIdFromUrl();
            if (id) {
                cancelRequests();
                closeIssuesPopover();
                setIssuesDetails(null);
                relationIdShown = id;
                const statusNode = $('status');
                if (statusNode) {
                    statusNode.textContent = '⏳ Verifica';
                }
                for (const key of ['sda', 'issues', 'date', 'sync']) {
                    const node = $(key);
                    if (node) {
                        node.textContent = '—';
                    }
                }
                const target = $('target');
                if (target) {
                    target.removeAttribute('href');
                    target.setAttribute('aria-disabled', 'true');
                }
                // Il pannello viene già mostrato: non va ricreato.
                load(id, false);
            } else {
                refresh(true);
            }
        }
    }

    function removePanel() {
        closeIssuesPopover();
        clearTimeout(modifiedHoverTimer);
        hideModifiedPopup();
        resetModifiedElements();
        relationLoad = null;
        document.getElementById('osm2cai-bar')?.remove();
    }

    // Aggiorna i dati senza distruggere/ricreare il pannello durante la
    // navigazione di OpenStreetMap (l'interazione con Turbo resta isolata).
    function resetPanelForRelation(relationId) {
        closeIssuesPopover();
        setIssuesDetails(null);
        resetModifiedElements();
        const statusNode = $('status');
        if (statusNode) {
            statusNode.textContent = '⏳ Verifica';
        }
        for (const key of ['sda', 'issues', 'date', 'sync']) {
            const node = $(key);
            if (node) {
                node.textContent = '—';
            }
        }
        const target = $('target');
        if (target) {
            target.removeAttribute('href');
            target.setAttribute('aria-disabled', 'true');
        }
        setWaymarkedLink(relationId, null);
        setOsmLinkOnWmt(relationId, null);
        applyInlineLayout();
    }

    // Hardening delle richieste privilegiate: accetta solo gli endpoint REST
    // effettivamente utilizzati dal progetto e mai URL estranei ai due servizi.
    const MAX_API_RESPONSE_BYTES = 32 * 1024 * 1024;
    function isAllowedApiUrl(rawUrl) {
        try {
            const u = new URL(rawUrl);
            if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return false;
            if (u.origin === 'https://api.openstreetmap.org') {
                return /^\/api\/0\.6\/(?:relation|way)\/[1-9]\d{0,15}\/full\.json$/.test(u.pathname);
            }
            if (u.origin === 'https://osm2cai.cai.it') {
                return /^\/api\/v2\/hiking-route-osm\/[1-9]\d{0,15}$/.test(u.pathname);
            }
            return false;
        } catch (_) { return false; }
    }

    function getJson(url) {
        if (!isAllowedApiUrl(url)) {
            console.warn('[OSM2CAI] Richiesta bloccata: endpoint non consentito');
            return Promise.resolve(null);
        }
        return new Promise(resolve => {
            let settled = false;
            let requestHandle = null;
            let timer = null;
            const request = {
                abort() {
                    if (settled) {
                        return;
                    }
                    // Chiudere la Promise prima di abortire evita callback duplicate.
                    finish(null);
                    try {
                        requestHandle?.abort();
                    } catch (_) {
                        // L'handle può essere già stato completato.
                    }
                }
            };
            function finish(value) {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                inFlight.delete(request);
                resolve(value);
            }
            inFlight.add(request);
            timer = setTimeout(() => request.abort(), TIMEOUT + 500);
            try {
                requestHandle = GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: TIMEOUT,
                    headers: {Accept: 'application/json'},
                    onload: response => {
                        // Non interpretare il risultato di eventuali redirect verso
                        // host terzi o pagine di login come dati attendibili.
                        if (response.status !== 200 ||
                            (response.finalUrl && !isAllowedApiUrl(response.finalUrl))) {
                            console.warn('[OSM2CAI] Risposta HTTP non valida', response.status);
                            finish(null);
                            return;
                        }
                        const body = response.responseText;
                        // Il limite è prudenziale: impedisce parsing di payload
                        // insolitamente grandi o di contenuto inatteso.
                        if (typeof body !== 'string' || body.length > MAX_API_RESPONSE_BYTES) {
                            console.warn('[OSM2CAI] Risposta API eccessiva o non testuale');
                            finish(null);
                            return;
                        }
                        try {
                            const data = JSON.parse(body);
                            finish(data && typeof data === 'object' && !Array.isArray(data) ? data : null);
                        } catch (error) {
                            console.warn('[OSM2CAI] JSON non valido', error);
                            finish(null);
                        }
                    },
                    onprogress: event => {
                        if (Number.isFinite(event.loaded) && event.loaded > MAX_API_RESPONSE_BYTES)
                            request.abort();
                    },
                    onerror: error => {
                        console.warn('[OSM2CAI] Errore rete', url, error);
                        finish(null);
                    },
                    ontimeout: () => finish(null),
                    onabort: () => finish(null)
                });
                if (settled) {
                    try {
                        requestHandle?.abort();
                    } catch (_) {
                        // Nessuna operazione necessaria.
                    }
                }
            } catch (error) {
                console.warn('[OSM2CAI] Richiesta non riuscita', error);
                finish(null);
            }
        });
    }

    // Costruisce una vista WMT che include l'intero itinerario.
    // Coordinate GeoJSON in ordine [longitudine, latitudine].
    function boundsFromGeojson(geometry) {
        if (!geometry) {
            return null;
        }
        const values = [];
        function visit(value) {
            if (!Array.isArray(value)) {
                return;
            }
            if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
                const lon = value[0], lat = value[1];
                if (Number.isFinite(lon) && Number.isFinite(lat) && lat >= -85 && lat <= 85) {
                    values.push([lat, lon]);
                }
                return;
            }
            for (const item of value) {
                visit(item);
            }
        }
        if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
            for (const part of geometry.geometries) {
                const bounds = boundsFromGeojson(part);
                if (bounds) {
                    values.push([bounds.minLat, bounds.minLon], [bounds.maxLat, bounds.maxLon]);
                }
            }
        } else {
            visit(geometry.coordinates);
        }
        return makeBounds(values);
    }

    function makeBounds(points) {
        if (!points.length) {
            return null;
        }
        const bounds = {minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity};
        for (const [lat, lon] of points) {
            bounds.minLat = Math.min(bounds.minLat, lat);
            bounds.maxLat = Math.max(bounds.maxLat, lat);
            bounds.minLon = Math.min(bounds.minLon, lon);
            bounds.maxLon = Math.max(bounds.maxLon, lon);
        }
        return bounds;
    }

    function boundsFromOsmFull(data, relationId) {
        if (!Array.isArray(data?.elements)) {
            return null;
        }
        const relation = data.elements.find(item => item.type === 'relation' && String(item.id) === String(relationId));
        if (!relation) {
            return null;
        }
        const ways = new Map(data.elements.filter(item => item.type === 'way').map(item => [item.id, item]));
        const nodes = new Map(data.elements.filter(item => item.type === 'node').map(item => [item.id, item]));
        const relations = new Map(data.elements.filter(item => item.type === 'relation').map(item => [item.id, item]));
        const visited = new Set();
        const points = [];
        function addNode(id) {
            const node = nodes.get(id);
            if (Number.isFinite(node?.lat) && Number.isFinite(node?.lon)) {
                points.push([node.lat, node.lon]);
            }
        }
        function walk(rel) {
            if (visited.has(rel.id)) {
                return;
            }
            visited.add(rel.id);
            for (const member of rel.members || []) {
                if (member.type === 'node') {
                    addNode(member.ref);
                } else if (member.type === 'way') {
                    for (const nodeId of ways.get(member.ref)?.nodes || []) {
                        addNode(nodeId);
                    }
                } else if (member.type === 'relation' && relations.has(member.ref)) {
                    walk(relations.get(member.ref));
                }
            }
        }
        walk(relation);
        return makeBounds(points);
    }

    function wmtUrlForBounds(relationId, bounds) {
        const base = 'https://hiking.waymarkedtrails.org/#route?id=' + encodeURIComponent(relationId);
        if (!bounds) {
            return base;
        }
        // Proiezione Web Mercator, con margine per includere tutto il tracciato.
        const mercatorY = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
        const minY = mercatorY(Math.min(85, bounds.maxLat));
        const maxY = mercatorY(Math.max(-85, bounds.minLat));
        const dx = Math.max(1e-9, (bounds.maxLon - bounds.minLon) / 360);
        const dy = Math.max(1e-9, maxY - minY);
        const viewportWidth = Math.max(300, Math.min(window.innerWidth - 350, 1100));
        const viewportHeight = Math.max(300, window.innerHeight - 180);
        const zoom = Math.max(1, Math.min(18, Math.log2(Math.min(viewportWidth / (256 * dx), viewportHeight / (256 * dy))) - 0.4));
        const centerY = (minY + maxY) / 2;
        const centerLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY))) * 180 / Math.PI;
        const centerLon = (bounds.minLon + bounds.maxLon) / 2;
        return base + '&map=' + zoom.toFixed(1) + '/' + centerLat.toFixed(5) + '/' + centerLon.toFixed(5);
    }

    // Su WMT il collegamento OSM presente nella sidebar può già includere
    // la bbox corretta. Preferiscilo sempre a una stima del nostro script.
    function sidebarOsmLinkWithBbox(relationId) {
        const expected = String(relationId);
        for (const anchor of document.querySelectorAll('a[href*="openstreetmap.org"]')) {
            if (anchor.closest('#osm2cai-bar')) continue;
            let url;
            try { url = new URL(anchor.href, location.href); } catch (_) { continue; }
            if (!['www.openstreetmap.org','openstreetmap.org'].includes(url.hostname)) continue;
            const pathId = url.pathname.match(/^\/relation\/(\d+)\/?$/)?.[1];
            const queryId = url.searchParams.get('relation');
            if (pathId !== expected && queryId !== expected) continue;
            const coords = (url.searchParams.get('bbox') || '').split(',').map(Number);
            if (coords.length !== 4 || !coords.every(Number.isFinite) ||
                coords[0] >= coords[2] || coords[1] >= coords[3] ||
                coords[1] < -90 || coords[3] > 90) continue;
            return url.href;
        }
        return null;
    }

    function osmUrlForBounds(relationId, bounds) {
        const base = 'https://www.openstreetmap.org/relation/' + encodeURIComponent(relationId);
        if (!bounds || ![bounds.minLon,bounds.minLat,bounds.maxLon,bounds.maxLat].every(Number.isFinite) ||
            bounds.minLon > bounds.maxLon || bounds.minLat > bounds.maxLat) return base;
        // Una bbox è utile anche per le super-relazioni, che OSM non inquadra
        // necessariamente in automatico. Mantieni un margine e dimensioni valide.
        const lonMargin = Math.max(.0005, (bounds.maxLon-bounds.minLon)*.07);
        const latMargin = Math.max(.0005, (bounds.maxLat-bounds.minLat)*.07);
        const coords = [Math.max(-180,bounds.minLon-lonMargin),Math.max(-85,bounds.minLat-latMargin),
            Math.min(180,bounds.maxLon+lonMargin),Math.min(85,bounds.maxLat+latMargin)];
        return base+'?bbox='+coords.map(n=>n.toFixed(6)).join('%2C');
    }

    // Fallback della bbox sulla vista corrente di WMT. Il link deve avere una
    // bbox anche prima che siano state caricate tutte le way (superroute grandi).
    // Proiezione EPSG:3857, coerente con l'inquadratura #map=zoom/lat/lon.
    function boundsFromWmtViewport() {
        if (!isWmt()) return null;
        const view = orderView();
        if (!view || !Number.isFinite(view.zoom)) return null;
        const {rect,zoom,lat,lon} = view;
        if (!(rect.width>0 && rect.height>0)) return null;
        const world=256*2**zoom;
        const centerX=(lon+180)/360*world;
        const clampedLat=Math.max(-85.05112878,Math.min(85.05112878,lat));
        const merc=a=>Math.log(Math.tan(Math.PI/4+a*Math.PI/360));
        const centerY=(1-merc(clampedLat)/Math.PI)/2*world;
        const toLon=x=>x/world*360-180;
        const toLat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/world)))*180/Math.PI;
        const minLon=Math.max(-180,toLon(centerX-rect.width/2));
        const maxLon=Math.min(180,toLon(centerX+rect.width/2));
        const maxLat=Math.min(85.05112878,toLat(centerY-rect.height/2));
        const minLat=Math.max(-85.05112878,toLat(centerY+rect.height/2));
        if (![minLon,minLat,maxLon,maxLat].every(Number.isFinite) ||
            minLon>=maxLon || minLat>=maxLat) return null;
        return {minLon,minLat,maxLon,maxLat};
    }

    // WMT -> OSM: apri la relazione mantenendo zoom e centro della vista,
    // come il link OSM #map=... della sidebar. Non convertire in ?bbox=.
    function wmtOsmMapFragment() {
        // Preferisci la vista pubblicata da WMT nell'hash URL.
        const match=location.hash.match(/(?:^|[&#])map=([0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)/);
        const stored=!match ? (localStorage.getItem('position')||'')
            .match(/^([0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)$/) : null;
        const values=match||stored;
        if (!values) return null;
        const zoom=Number(values[1]),lat=Number(values[2]),lon=Number(values[3]);
        if (![zoom,lat,lon].every(Number.isFinite) || zoom<0 || zoom>25 ||
            Math.abs(lat)>85.05112878 || Math.abs(lon)>180) return null;
        return '#map='+String(zoom)+'/'+lat.toFixed(5)+'/'+lon.toFixed(5);
    }

    function setOsmLinkOnWmt(relationId, bounds) {
        if (!isWmt() || !/^\d+$/.test(String(relationId))) return;
        const link=document.querySelector('#osm2cai-bar a[aria-label="Apri su OpenStreetMap"]');
        if (!link) return;
        const base='https://www.openstreetmap.org/relation/'+encodeURIComponent(relationId);
        // Se la vista non è ancora leggibile usa l'URL della sidebar quando
        // espone #map; come ultima opzione ricava zoom e centro dalla geometria.
        let fragment=wmtOsmMapFragment();
        if (!fragment) {
            for (const anchor of document.querySelectorAll('a[href*="openstreetmap.org"]')) {
                if (anchor.closest('#osm2cai-bar')) continue;
                try {
                    const url=new URL(anchor.href,location.href);
                    if (!['www.openstreetmap.org','openstreetmap.org'].includes(url.hostname) ||
                        url.pathname.replace(/\/$/,'')!=='/relation/'+relationId ||
                        !/^#map=[\d.]+\/-?[\d.]+\/-?[\d.]+$/.test(url.hash)) continue;
                    fragment=url.hash; break;
                } catch (_) { /* ignora link non validi */ }
            }
        }
        if (!fragment && bounds &&
            [bounds.minLat,bounds.maxLat,bounds.minLon,bounds.maxLon].every(Number.isFinite)) {
            // La funzione esistente calcola la vista senza usare la bbox nell'URL.
            const approx=wmtUrlForBounds(relationId,bounds).match(/(?:^|&)map=([\d.]+\/-?[\d.]+\/-?[\d.]+)/);
            if (approx) fragment='#map='+approx[1];
        }
        link.href=base+(fragment||'');
    }

    // Aggiorna la vista corrente nel momento del clic, senza ricreare pulsanti.
    document.addEventListener('click', event => {
        if (!isWmt() || !event.target?.closest) return;
        const link=event.target.closest('#osm2cai-bar a[aria-label="Apri su OpenStreetMap"]');
        if (link) setOsmLinkOnWmt(relationIdFromUrl(),boundsFromOsmFull(orderFull,relationIdFromUrl()));
    }, true);

    function setWaymarkedLink(relationId, bounds) {
        const link = document.querySelector('#osm2cai-bar a[aria-label="Apri su Waymarked Trails"]');
        if (link) {
            link.href = wmtUrlForBounds(relationId, bounds);
        }
    }

    function status(id, kind, label) {
        const node = $(id);
        if (!node) {
            return;
        }
        node.replaceChildren();
        const dot = document.createElement('span');
        dot.className = 'oc-dot ' + kind;
        node.append(dot, document.createTextNode(label));
        applyInlineLayout();
    }
    // Ultimo timestamp tra TUTTI gli elementi di /full.json (relazioni,
    // way e nodi). Se le date non sono complete, il confronto non è certo.
    function latestRelationWayTimestamp(full, relationId) {
        const elements = full?.elements;
        if (!Array.isArray(elements) || elements.length === 0 ||
            !elements.some(item => item.type === 'relation' && String(item.id) === String(relationId))) {
            return null;
        }
        // Una risposta parziale non deve produrre un falso "aggiornato".
        // Verifica tutti i riferimenti raggiungibili, inclusi nodi e sottorelazioni.
        const byKey = new Map(elements.map(item => [item.type+':'+item.id, item]));
        const pending = ['relation:'+relationId], visited = new Set();
        while (pending.length) {
            const key = pending.pop();
            if (visited.has(key)) continue;
            visited.add(key);
            const item = byKey.get(key);
            if (!item) return null;
            if (item.type === 'relation') {
                if (!Array.isArray(item.members)) return null;
                for (const member of item.members) {
                    if (!['relation', 'way', 'node'].includes(member.type)) return null;
                    pending.push(member.type+':'+member.ref);
                }
            } else if (item.type === 'way') {
                if (!Array.isArray(item.nodes) || item.nodes.length < 2) return null;
                for (const id of item.nodes) pending.push('node:'+id);
            }
        }
        let mostRecent = -Infinity;
        for (const item of elements) {
            const stamp = parseApiDate(item.timestamp);
            if (!Number.isFinite(stamp)) { return null; }
            mostRecent = Math.max(mostRecent, stamp);
        }
        return new Date(mostRecent).toISOString();
    }

    // Date.parse normalizza alcune date impossibili (es. 30 febbraio).
    // Controlla il giorno di calendario prima di accettare il timestamp.
    function parseApiDate(value) {
        if (typeof value !== 'string') return NaN;
        const stamp = value.trim();
        const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
        if (!match) return NaN;
        const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
        const date = new Date(0);
        date.setUTCFullYear(year, month - 1, day);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
        return Date.parse(stamp);
    }

    // Età della validazione in mesi di calendario, usando la data locale odierna.
    // Le date future e quelle malformate non sono classificabili.
    function validationDateKind(value) {
        if (!Number.isFinite(parseApiDate(value))) { return 'gray'; }
        const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
        if (!match) { return 'gray'; }
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return 'gray';
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (date > today) { return 'gray'; }
        const monthsAgo = count => {
            const threshold = new Date(today.getFullYear(), today.getMonth() - count, 1);
            // Se il mese di confronto è più corto, usare l'ultimo giorno di quel mese.
            const lastDay = new Date(threshold.getFullYear(), threshold.getMonth() + 1, 0).getDate();
            threshold.setDate(Math.min(today.getDate(), lastDay));
            return threshold;
        };
        if (date >= monthsAgo(12)) { return 'ok'; }
        if (date >= monthsAgo(24)) { return 'validation-orange'; }
        return 'error';
    }

    function fillData(data) {
        const p = data?.properties || {};
        status('status', 'ok', 'online');
        if ($('sda')) {
            $('sda').textContent = p.sda ?? '—';
        }
        setIssuesDetails(p);
        // Il colore dipende esclusivamente dal valore fornito dall'API.
        const rawIssues = String(p.issues_status ?? '').trim();
        const normalizedIssues = rawIssues.toLocaleLowerCase('it-IT').replace(/\s+/g, ' ');
        let issuesKind = 'gray';
        if (normalizedIssues === 'percorribile') {
            issuesKind = 'ok';
        }
        else if (normalizedIssues === 'non percorribile') { issuesKind = 'error'; }
        else if (normalizedIssues === 'parzialmente percorribile' || normalizedIssues === 'percorribile parzialmente') {
            issuesKind = 'orange';
        }
        const issuesText = issuesKind === 'orange' ? 'parzialmente percorribile' : (rawIssues || 'sconosciuto');
        status('issues', issuesKind, issuesText);
        const validationLabel = typeof p.validation_date === 'string' && p.validation_date.trim()
            ? p.validation_date.trim() : '—';
        status('date', validationDateKind(p.validation_date), validationLabel);
        const link = $('target');
        if (link && p.id !== undefined && p.id !== null && p.id !== '') {
            link.href = OSM2CAI + '/' + encodeURIComponent(p.id);
            link.removeAttribute('aria-disabled');
        }
    }

    // SDA 4: confronta OSM con validation_date; se OSM è più recente,
    // segnala "da verificare". SDA 1, 2, 3: confronta con updated_at;
    // se OSM è più recente, segnala "da aggiornare".
    // Nessun fallback tra i due campi: SDA 0 o date non confrontabili => grigio.
    function fillAlignment(data, osmDate) {
        const p = data?.properties || {};
        const sda = String(p.sda ?? '').trim();
        let kind = 'gray';
        let message = 'non verificabile';
        const osmMs = parseApiDate(osmDate);
        const source = sda === '4' ? p.validation_date :
            ['1', '2', '3'].includes(sda) ? p.updated_at : null;
        if (Number.isFinite(osmMs) && typeof osmDate === 'string' &&
            /^\d{4}-\d{2}-\d{2}T/.test(osmDate) && typeof source === 'string') {
            const stamp = source.trim();
            const sourceMs = parseApiDate(stamp);
            if (Number.isFinite(sourceMs)) {
                // Le date senza orario vengono confrontate a livello di giorno.
                const aligned = /^\d{4}-\d{2}-\d{2}$/.test(stamp)
                    ? stamp >= osmDate.slice(0, 10)
                    : sourceMs >= osmMs;
                kind = aligned ? 'ok' : 'error';
                message = aligned ? 'aggiornato' :
                    (sda === '4' ? 'da verificare' : 'da aggiornare');
            }
        }
        status('sync', kind, message);
    }
    function apiError() {
        status('status', 'error', 'errore');
        status('sync', 'gray', 'non verificabile');
    }

    // /relation/ID/full include la geometria dei membri diretti, NON quella
    // delle way delle sottorelazioni. Caricare ogni sottorelazione con /full,
    // poi recuperare eventuali singole way ancora prive di nodi.
    async function expandNestedRelationGeometry(full, relationId, isCurrent) {
        if (!Array.isArray(full?.elements)) return full;
        const byKey=new Map(full.elements.map(e=>[e.type+':'+e.id,e]));
        const fetchedRelations=new Set([String(relationId)]);
        const fetchedWays=new Set();
        const maxRelations=36, maxWays=80;
        const merge=result=>{
            for (const item of result?.elements || []) {
                const key=item.type+':'+item.id;
                const existing=byKey.get(key);
                // Non sostituire una way completa con una sua versione parziale.
                if (existing?.type==='way' && Array.isArray(existing.nodes) &&
                    existing.nodes.length>=2 && !Array.isArray(item.nodes)) continue;
                byKey.set(key,item);
            }
        };
        // Esplora soltanto i membri relation raggiungibili dalla radice.
        // Il Set impedisce loop e richieste duplicate in caso di cicli.
        for (let pass=0;pass<12 && isCurrent();pass++) {
            const graph=relationGeometryMembers({elements:[...byKey.values()]},relationId);
            const known=byKey.get('relation:'+relationId);
            if (!known) break;
            const nestedIds=new Set();
            const seen=new Set();
            function collect(id, depth) {
                if (depth>12 || seen.has(String(id))) return;
                seen.add(String(id));
                const rel=byKey.get('relation:'+id);
                for (const m of rel?.members || []) if (m.type==='relation') {
                    nestedIds.add(String(m.ref));collect(m.ref,depth+1);
                }
            }
            collect(relationId,0);
            const todo=[...nestedIds].filter(id=>/^[1-9]\d{0,15}$/.test(id) &&
                Number.isSafeInteger(Number(id)) && !fetchedRelations.has(id))
                .slice(0,Math.max(0,maxRelations-fetchedRelations.size));
            if (!todo.length) break;
            for (const id of todo) fetchedRelations.add(id);
            const results=await Promise.all(todo.map(id=>getJson(
                'https://api.openstreetmap.org/api/0.6/relation/'+encodeURIComponent(id)+'/full.json')));
            if (!isCurrent()) return full;
            for (const result of results) merge(result);
        }
        if (!isCurrent()) return full;
        const graph=relationGeometryMembers({elements:[...byKey.values()]},relationId);
        // Fallback per geometrie parziali o mancanti, senza considerare
        // l'assenza nel JSON come errore geometrico della way su OSM.
        const missingWayIds=[...new Set(graph.members.map(m=>String(m.ref)))].filter(id=>{
            if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) return false;
            const w=byKey.get('way:'+id);
            return !Array.isArray(w?.nodes) || w.nodes.length<2;
        }).slice(0,maxWays);
        for (let i=0;i<missingWayIds.length && isCurrent();i+=8) {
            const ids=missingWayIds.slice(i,i+8);
            for (const id of ids) fetchedWays.add(id);
            const results=await Promise.all(ids.map(id=>getJson(
                'https://api.openstreetmap.org/api/0.6/way/'+encodeURIComponent(id)+'/full.json')));
            if (!isCurrent()) return full;
            for (const result of results) merge(result);
        }
        return {...full,elements:[...byKey.values()]};
    }

    async function load(relationId, recreate = true, verifiedFull = null) {
        if (isOsmEditing()) {
            cancelRequests();
            removePanel();
            return;
        }
        if (recreate && !document.getElementById('osm2cai-bar')) { newPanel(relationId); }
        if (collapsed) { return; } // Nessuna richiesta API con barra chiusa.
        resetModifiedElements();
        closeIssuesPopover();
        setIssuesDetails(null);
        orderFull = null;
        orderRelationId = null;
        const orderOutput = $('order-results');
        closeGuidepostPopover();
        if (orderOutput) orderOutput.textContent = '';
        const ticket = ++sequence;
        const currentLoad = {id:relationId, ticket, state:'pending'};
        relationLoad = currentLoad;
        const isCurrent = () => !collapsed && !isOsmEditing() &&
            ticket === sequence && relationId === relationIdFromUrl();

        // Avvio simultaneo: nessuna delle due API deve bloccare l'altra.
        const osmRequest = verifiedFull ? Promise.resolve(verifiedFull) : getJson('https://api.openstreetmap.org/api/0.6/relation/' + relationId + '/full.json');
        const caiRequest = getJson(API + '/' + relationId);
        let full = null;
        let data = null;
        let osmFinished = false;
        let caiFinished = false;
        let unsupportedRoute = false;

        function finishAlignment() {
            if (!isCurrent() || unsupportedRoute || !osmFinished || !caiFinished) { return; }
            currentLoad.state = 'complete';
            if (data) {
                fillAlignment(data, latestRelationWayTimestamp(full, relationId));
                const p = data?.properties || {};
                modifiedAfterValidation = String(p.sda ?? '').trim() === '4' &&
                    $('sync')?.textContent === 'da verificare'
                    ? modifiedElementsSince(full, p.validation_date) : [];
                hideModifiedPopup();
            } else {
                status('sync', 'gray', 'non verificabile');
            }
        }

        // I dati OSM2CAI appaiono subito, anche se OSM è ancora in attesa.
        caiRequest.then(result => {
            if (!isCurrent() || unsupportedRoute) { return; }
            data = result;
            caiFinished = true;
            if (data) {
                fillData(data);
            } else {
                apiError();
            }
            finishAlignment();
            // Se OSM ha già risposto, il link Waymarked può essere completato.
            if (osmFinished && !isWmt()) {
                const bounds = boundsFromGeojson(data?.geometry || data?.features?.[0]?.geometry)
                    || boundsFromOsmFull(full, relationId);
                setWaymarkedLink(relationId, bounds);
            }
        });

        // OSM controlla la tipologia del percorso e fornisce date/geometria.
        osmRequest.then(async result => {
            if (!isCurrent()) { return; }
            full = result;
            // Escludi i percorsi non supportati prima di scaricarne i figli.
            // Solo route=hiking è ammesso, anche nelle super-relazioni.
            const osmRelation = full?.elements?.find(item =>
                item.type === 'relation' && String(item.id) === String(relationId));
            if (osmRelation?.tags?.route !== 'hiking') {
                unsupportedRoute = true;
                cancelRequests();
                removePanel();
                return;
            }
            if (full) {
                // Segnala temporaneamente l'analisi in corso mentre si scaricano
                // le geometrie delle sottorelazioni eventualmente assenti.
                setMemberOrderIndicator('gray');
                full = await expandNestedRelationGeometry(full, relationId, isCurrent);
                if (!isCurrent()) return;
                orderFull = full; orderRelationId = relationId;
            }
            updateMemberOrderIndicator(full, relationId);
            updateGuidepostIndicator(full, relationId);
            osmFinished = true;
            // Se l'utente ha aperto l'analisi durante la richiesta, sostituisci
            // il messaggio di attesa senza obbligarlo a riaprire il popup.
            const orderPopover = $('order-popover');
            if (orderPopover && !orderPopover.hidden) renderOrderCheck();
            if ($('guidepost-popover') && !$('guidepost-popover').hidden) renderGuidepostAnalysis();
            finishAlignment();
            const linkBounds = boundsFromGeojson(data?.geometry || data?.features?.[0]?.geometry)
                || boundsFromOsmFull(full, relationId);
            if (isWmt()) setOsmLinkOnWmt(relationId, linkBounds);
            else setWaymarkedLink(relationId, linkBounds);
        });
    }

    function refresh(force = false) {
        const incomingId = relationIdFromUrl();
        if (isOsmEditing() || incomingId !== relationIdShown) {
            cancelRequests();
        }
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            if (isOsmEditing()) {
                cancelRequests();
                relationIdShown = null;
                removePanel();
                return;
            }
            const id = relationIdFromUrl();
            if (!id) {
                cancelRequests();
                relationIdShown = null;
                removePanel();
                return;
            }
            const reusableLoad = relationLoad?.id === id &&
                (relationLoad.state === 'complete' ||
                 (relationLoad.state === 'pending' && relationLoad.ticket === sequence));
            if (!force && relationIdShown === id && document.getElementById('osm2cai-bar') &&
                (collapsed || reusableLoad)) {
                adjustPosition();
                return;
            }
            cancelRequests();
            relationIdShown = id;
            // Nessuna barra (nemmeno compressa) prima della verifica OSM.
            removePanel();
            const checkTicket = sequence;
            getJson('https://api.openstreetmap.org/api/0.6/relation/' + id + '/full.json')
                .then(full => {
                    if (checkTicket !== sequence || id !== relationIdFromUrl() || isOsmEditing()) return;
                    const relation = full?.elements?.find(item =>
                        item.type === 'relation' && String(item.id) === String(id));
                    // In caso di errore API, tag assente o altra route: resta nascosta.
                    if (relation?.tags?.route !== 'hiking') return;
                    newPanel(id);
                    if (!collapsed) {
                        resetPanelForRelation(id);
                        load(id, false, full);
                    }
                });
        }, 100);
    }

    let initialized = false;
    function init() {
        if (initialized) return;
        if (!document.body) { document.addEventListener('DOMContentLoaded', init, {once:true}); return; }
        initialized = true;
        insertStyle();
        refresh();
        let reloadAfterPageRestore = false;
        const suspend = () => {
            // beforeunload può precedere pagehide: conserva il fatto che
            // almeno una richiesta è stata interrotta da uno dei due eventi.
            reloadAfterPageRestore = reloadAfterPageRestore || inFlight.size > 0;
            clearOrderMap();
            clearTimeout(refreshTimer);
            clearTimeout(positionTimer);
            clearTimeout(modifiedHoverTimer);
            cancelRequests();
        };
        window.addEventListener('pagehide', suspend);
        window.addEventListener('beforeunload', suspend);
        window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            const reload = reloadAfterPageRestore;
            reloadAfterPageRestore = false;
            // refresh rispetta la barra chiusa e non interroga API in editor.
            // I dati completi non richiedono un nuovo download dello stesso ID.
            refresh(reload);
        });
        window.addEventListener('hashchange', () => refresh());
        window.addEventListener('popstate', () => refresh());
        // Non intervenire su turbo:before-cache: OSM gestisce internamente
        // la navigazione e l'evidenziazione delle relazioni. La rimozione
        // del pannello in questa fase può interferire con quel ciclo.
        // L'attributo data-turbo-temporary esclude già la barra dagli snapshot.
        // Al caricamento controlliamo semplicemente l'URL corrente, senza
        // forzare un nuovo caricamento della stessa relazione.
        document.addEventListener('turbo:load', () => refresh());
        window.addEventListener('resize', () => { clearTimeout(positionTimer); positionTimer = setTimeout(() => { applyInlineLayout(); adjustPosition(); }, 80); });
        // Non osservare il DOM di OpenStreetMap: le sue modifiche sono
        // gestite esclusivamente da OSM e non devono innescare interventi
        // dello userscript mentre le relazioni vengono selezionate.
        // Il solo cambio di URL è letto periodicamente, senza toccare la mappa.
        setInterval(() => {
            // In editor OSM la barra scompare anche durante transizioni SPA.
            if (isOsmEditing()) {
                if (document.getElementById('osm2cai-bar') || inFlight.size) {
                    cancelRequests();
                    relationIdShown = null;
                    removePanel();
                }
            } else {
                adjustPosition();
            }
            applyTheme();
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                refresh();
            }
        }, 500);
    }
    init();
})();
