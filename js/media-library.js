// js/media-library.js — 个人媒体库：上传视频到 R2、列表、播放、删除。仅登录态可用。
// 上传走「预签名直传 R2」：presign → 浏览器 PUT 直传（带进度）→ commit 登记。
(function (global) {
    function T(k) { return (typeof global.t === 'function') ? global.t(k) : k; }
    function toast(m, t) { if (typeof global.showToast === 'function') global.showToast(m, t); }
    function loggedIn() {
        try { return !!(global.Account && global.Account.isLoggedIn && global.Account.isLoggedIn()); } catch (e) { return false; }
    }
    function esc(s) { return String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function fmtSize(b) { b = Number(b) || 0; if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB'; if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'; return Math.max(1, Math.round(b / 1e3)) + ' KB'; }

    function loadMediaLibrary() {
        const list = document.getElementById('mediaList');
        if (!list) return;
        if (!loggedIn()) { list.innerHTML = '<div class="text-center text-gray-500 py-8">' + T('media.needLogin') + '</div>'; return; }
        list.innerHTML = '<div class="text-center text-gray-500 py-8">' + T('media.loading') + '</div>';
        fetch('/api/media/list', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                const items = (d && Array.isArray(d.media)) ? d.media : [];
                if (!items.length) { list.innerHTML = '<div class="text-center text-gray-500 py-8">' + T('media.empty') + '</div>'; return; }
                list.innerHTML = items.map(function (it) {
                    const id = encodeURIComponent(it.id);
                    const t = encodeURIComponent(it.title || '');
                    return '<div class="history-item relative group">'
                        + '<button onclick="event.stopPropagation(); deleteMedia(\'' + id + '\')" class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-gray-400 hover:text-red-400 p-1 rounded-full hover:bg-gray-800 z-10" title="' + T('media.delete') + '">'
                        + '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>'
                        + '<div class="history-info cursor-pointer" onclick="playMedia(\'' + id + '\',\'' + t + '\')">'
                        + '<div class="history-title">' + esc(it.title) + '</div>'
                        + '<div class="history-meta"><span>' + fmtSize(it.size) + '</span></div>'
                        + '</div></div>';
                }).join('');
            })
            .catch(function () { list.innerHTML = '<div class="text-center text-gray-500 py-8">' + T('media.loadFail') + '</div>'; });
    }

    function toggleMediaLibrary(e) {
        if (e) e.stopPropagation();
        if (!loggedIn()) { toast(T('media.needLogin'), 'warning'); if (typeof global.openAccountModal === 'function') global.openAccountModal(); return; }
        const panel = document.getElementById('mediaPanel');
        if (!panel) return;
        panel.classList.toggle('show');
        if (panel.classList.contains('show')) loadMediaLibrary();
        ['historyPanel', 'favoritesPanel', 'settingsPanel'].forEach(function (id) {
            const p = document.getElementById(id); if (p && p.classList.contains('show')) p.classList.remove('show');
        });
    }

    function pickMediaFile() {
        const input = document.getElementById('mediaFileInput');
        if (input) { input.value = ''; input.click(); }
    }
    function onMediaFileChosen(input) {
        const file = input && input.files && input.files[0];
        if (file) uploadFile(file);
    }

    function setProgress(pct, text) {
        const wrap = document.getElementById('mediaUploadProgress');
        const bar = document.getElementById('mediaUploadBar');
        const label = document.getElementById('mediaUploadLabel');
        if (wrap) wrap.classList.toggle('hidden', pct == null);
        if (bar && pct != null) bar.style.width = Math.round(pct) + '%';
        if (label && text != null) label.textContent = text;
    }

    function uploadFile(file) {
        setProgress(0, T('media.preparing'));
        fetch('/api/media/presign', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
        })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                if (!res.ok || !res.d || !res.d.url) { setProgress(null); toast((res.d && res.d.error) || T('media.uploadFail'), 'error'); return; }
                const url = res.d.url, id = res.d.id, key = res.d.key;
                const xhr = new XMLHttpRequest();
                xhr.open('PUT', url, true);
                if (file.type) xhr.setRequestHeader('Content-Type', file.type);
                xhr.upload.onprogress = function (ev) {
                    if (ev.lengthComputable) setProgress(ev.loaded / ev.total * 100, T('media.uploading') + ' ' + Math.round(ev.loaded / ev.total * 100) + '%');
                };
                xhr.onload = function () {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        fetch('/api/media/commit', {
                            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: id, key: key, title: file.name, filename: file.name, contentType: file.type, size: file.size }),
                        })
                            .then(function (r) { return r.json(); })
                            .then(function (c) { setProgress(null); if (c && c.ok) { toast(T('media.uploaded'), 'success'); loadMediaLibrary(); } else { toast((c && c.error) || T('media.commitFail'), 'error'); } })
                            .catch(function () { setProgress(null); toast(T('media.commitFail'), 'error'); });
                    } else { setProgress(null); toast(T('media.uploadFail') + ' (' + xhr.status + ')', 'error'); }
                };
                xhr.onerror = function () { setProgress(null); toast(T('media.uploadFail') + '（CORS?）', 'error'); };
                xhr.send(file);
            })
            .catch(function () { setProgress(null); toast(T('media.uploadFail'), 'error'); });
    }

    function playMedia(encId, encTitle) {
        const id = decodeURIComponent(encId), title = decodeURIComponent(encTitle || '');
        const url = '/api/media/' + encodeURIComponent(id);
        global.location.href = 'player.html?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title);
    }
    function deleteMedia(encId) {
        const id = decodeURIComponent(encId);
        fetch('/api/media/delete', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.ok) { toast(T('media.deleted'), 'info'); loadMediaLibrary(); } else { toast((d && d.error) || T('media.deleteFail'), 'error'); } })
            .catch(function () { toast(T('media.deleteFail'), 'error'); });
    }

    global.toggleMediaLibrary = toggleMediaLibrary;
    global.loadMediaLibrary = loadMediaLibrary;
    global.pickMediaFile = pickMediaFile;
    global.onMediaFileChosen = onMediaFileChosen;
    global.playMedia = playMedia;
    global.deleteMedia = deleteMedia;
})(window);
