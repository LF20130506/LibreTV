// js/favorites.js
// 收藏功能：把喜欢的剧集存到 localStorage('favorites')，在收藏面板查看/打开/取消。
// 面板复用观看历史的样式类（.history-panel/.history-item…），无需新增 CSS。
// 打开收藏 = 调用首页的 showDetails() 重新拉取详情让用户选集（复用现有逻辑）。
(function (global) {
    const KEY = 'favorites';
    const MAX = 200;

    function _favT(k) { return (typeof global.t === 'function') ? global.t(k) : k; }
    function _toast(msg, type) { if (typeof global.showToast === 'function') global.showToast(msg, type); }

    function getFavorites() {
        try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }
    function saveFavorites(arr) {
        try { localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX))); } catch (e) {}
        pushFav(); // 登录态下防抖同步到 KV
    }

    // ===== 云同步（仅登录态；未登录纯本地，行为不变）=====
    const API = '/api/favorites';
    function syncEnabled() {
        try { return !!(global.Account && global.Account.isLoggedIn && global.Account.isLoggedIn()); } catch (e) { return false; }
    }
    let pushTimer = null;
    function doPushFav() {
        return fetch(API, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorites: getFavorites() }), keepalive: true,
        }).catch(function () {});
    }
    function pushFav(immediate) {
        if (!syncEnabled()) return;
        if (immediate) { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } doPushFav(); return; }
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(doPushFav, 1500);
    }
    function pullFav() {
        if (!syncEnabled()) return Promise.resolve(null);
        return fetch(API, { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { return (d && Array.isArray(d.favorites)) ? d.favorites : null; })
            .catch(function () { return null; });
    }
    function mergeFav(a, b) {
        const map = new Map();
        [].concat(a || [], b || []).forEach(function (it) {
            if (!it) return;
            const k = favKey(it);
            const prev = map.get(k);
            if (!prev || (it.timestamp || 0) >= (prev.timestamp || 0)) map.set(k, it);
        });
        return Array.from(map.values()).sort(function (x, y) { return (y.timestamp || 0) - (x.timestamp || 0); }).slice(0, MAX);
    }
    function syncFavorites() {
        if (!syncEnabled()) return Promise.resolve(false);
        return pullFav().then(function (remote) {
            if (remote == null) return false;
            const merged = mergeFav(remote, getFavorites());
            try { localStorage.setItem(KEY, JSON.stringify(merged.slice(0, MAX))); } catch (e) {}
            pushFav(true);
            loadFavorites();
            return true;
        });
    }

    // 唯一键：源 + vod_id（回退到标题）
    function favKey(it) {
        if (!it) return '';
        if (it.sourceCode && it.vod_id) return it.sourceCode + '_' + it.vod_id;
        return 't_' + (it.title || '');
    }
    function isFavorited(item) {
        const k = favKey(item);
        return getFavorites().some((f) => favKey(f) === k);
    }
    function addFavorite(item) {
        if (!item) return;
        const favs = getFavorites();
        const k = favKey(item);
        if (favs.some((f) => favKey(f) === k)) return;
        favs.unshift({
            title: item.title || '未知视频',
            sourceCode: item.sourceCode || '',
            sourceName: item.sourceName || '',
            vod_id: item.vod_id || '',
            poster: item.poster || '',
            year: item.year || '',
            type: item.type || '',
            episodeCount: (item.episodes && item.episodes.length) || item.episodeCount || 0,
            timestamp: Date.now(),
        });
        saveFavorites(favs);
    }
    function removeFavorite(key) {
        saveFavorites(getFavorites().filter((f) => favKey(f) !== key));
    }
    // 切换收藏，返回新状态（true=已收藏）
    function toggleFavorite(item) {
        if (isFavorited(item)) { removeFavorite(favKey(item)); return false; }
        addFavorite(item); return true;
    }

    function fmtTime(ts) {
        return (typeof global.formatTimestamp === 'function') ? global.formatTimestamp(ts) : '';
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 渲染收藏面板（复用 .history-item 等样式）
    function loadFavorites() {
        const list = document.getElementById('favoritesList');
        if (!list) return;
        const favs = getFavorites();
        if (favs.length === 0) {
            list.innerHTML = '<div class="text-center text-gray-500 py-8">' + _favT('fav.empty') + '</div>';
            return;
        }
        list.innerHTML = favs.map((item) => {
            const safeTitle = esc(item.title);
            const safeSource = item.sourceName ? esc(item.sourceName) : '';
            const k = encodeURIComponent(favKey(item));
            const epText = item.episodeCount ? (_favT('fav.episodes1') + item.episodeCount + _favT('fav.episodes2')) : '';
            return ''
                + '<div class="history-item cursor-pointer relative group" onclick="openFavorite(\'' + k + '\')">'
                + '  <button onclick="event.stopPropagation(); removeFavoriteByKey(\'' + k + '\')"'
                + '          class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-gray-400 hover:text-red-400 p-1 rounded-full hover:bg-gray-800 z-10" title="' + _favT('fav.remove') + '">'
                + '    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>'
                + '  </button>'
                + '  <div class="history-info">'
                + '    <div class="history-title">' + safeTitle + '</div>'
                + '    <div class="history-meta">'
                + (safeSource ? '<span class="history-source">' + safeSource + '</span>' : '')
                + (safeSource && epText ? '<span class="history-separator mx-1">·</span>' : '')
                + (epText ? '<span>' + epText + '</span>' : '')
                + '    </div>'
                + '    <div class="history-time">' + fmtTime(item.timestamp) + '</div>'
                + '  </div>'
                + '</div>';
        }).join('');
    }

    // 打开/收起收藏面板（同时关闭历史/设置面板）
    function toggleFavorites(e) {
        if (e) e.stopPropagation();
        const panel = document.getElementById('favoritesPanel');
        if (!panel) return;
        panel.classList.toggle('show');
        if (panel.classList.contains('show')) loadFavorites();
        ['historyPanel', 'settingsPanel'].forEach((id) => {
            const p = document.getElementById(id);
            if (p && p.classList.contains('show')) p.classList.remove('show');
        });
    }

    function clearFavorites() {
        try { localStorage.removeItem(KEY); } catch (e) {}
        loadFavorites();
        _toast(_favT('toast.favCleared'), 'success');
    }

    function openFavorite(encKey) {
        const key = decodeURIComponent(encKey);
        const fav = getFavorites().find((f) => favKey(f) === key);
        if (!fav) return;
        toggleFavorites(); // 关闭面板
        if (typeof global.showDetails === 'function' && fav.vod_id && fav.sourceCode) {
            global.showDetails(fav.vod_id, fav.title, fav.sourceCode);
        } else {
            _toast(_favT('fav.openFail'), 'error');
        }
    }

    function removeFavoriteByKey(encKey) {
        removeFavorite(decodeURIComponent(encKey));
        loadFavorites();
        _toast(_favT('toast.favRemoved'), 'info');
    }

    // 设置某个收藏按钮（图标 + 文案）的已收藏/未收藏外观
    function setBtnState(iconEl, textEl, on) {
        if (iconEl) {
            iconEl.setAttribute('fill', on ? '#ef4444' : 'none');
            iconEl.style.stroke = on ? '#ef4444' : 'currentColor';
        }
        if (textEl) textEl.textContent = on ? _favT('fav.saved') : _favT('fav.save');
    }
    // 绑定一个收藏切换按钮（详情弹窗用）：根据 item 初始化状态并接管点击
    function bindButton(btnId, iconId, textId, item) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const icon = document.getElementById(iconId);
        const text = document.getElementById(textId);
        setBtnState(icon, text, isFavorited(item));
        btn.onclick = function (e) {
            if (e) e.stopPropagation();
            const on = toggleFavorite(item);
            setBtnState(icon, text, on);
            _toast(on ? _favT('toast.favAdded') : _favT('toast.favRemoved'), on ? 'success' : 'info');
        };
    }

    // 登录/登出后同步该账号收藏；切后台/刷新时冲刷一次
    document.addEventListener('lt-auth-changed', function () { syncFavorites(); });
    global.addEventListener('pagehide', function () { pushFav(true); });

    // 暴露到全局（onclick 与其它脚本调用）
    global.toggleFavorites = toggleFavorites;
    global.loadFavorites = loadFavorites;
    global.clearFavorites = clearFavorites;
    global.openFavorite = openFavorite;
    global.removeFavoriteByKey = removeFavoriteByKey;
    global.Favorites = {
        getFavorites, isFavorited, addFavorite, removeFavorite, toggleFavorite,
        favKey, bindButton, setBtnState, loadFavorites,
    };
})(window);
