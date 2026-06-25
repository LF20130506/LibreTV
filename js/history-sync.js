// js/history-sync.js
// 用户名绑定的观看历史「云同步」：把 localStorage('viewingHistory') 经 /api/history
// 同步到 Cloudflare KV。设置面板里填了用户名即启用；留空则仅本地。
// 鉴权复用站点密码（携带 window.__ENV__.PASSWORD 哈希作为 X-Auth-Hash）。
(function (global) {
    const USER_KEY = 'ltUsername';
    const HISTORY_KEY = 'viewingHistory';
    const MAX = 50;            // 与 ui.js 的本地上限一致
    const API = '/api/history';
    const PUSH_DEBOUNCE = 1500;

    // 登录态优先用账号 userId；否则用设置里自填的 ltUsername（向后兼容）
    function getUsername() {
        try {
            if (global.Account && global.Account.isLoggedIn && global.Account.isLoggedIn()) {
                return global.Account.currentUser() || '';
            }
            return (localStorage.getItem(USER_KEY) || '').trim();
        } catch (e) { return ''; }
    }
    function setUsername(name) {
        name = (name || '').trim();
        try { name ? localStorage.setItem(USER_KEY, name) : localStorage.removeItem(USER_KEY); } catch (e) {}
    }
    function enabled() { return !!getUsername(); }

    function authHeaders() {
        const h = { 'Content-Type': 'application/json' };
        try {
            const hash = global.__ENV__ && global.__ENV__.PASSWORD;
            // 注入的占位符未替换（{{PASSWORD}}）或为空则不带
            if (hash && hash.indexOf('{{') === -1) h['X-Auth-Hash'] = hash;
        } catch (e) {}
        return h;
    }

    function readLocal() {
        try { const a = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }
    function writeLocal(arr) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, MAX))); } catch (e) {}
    }

    function itemKey(it) {
        return (it && (it.showIdentifier || it.url || (it.title + '_' + (it.episodeIndex || 0)))) || Math.random().toString();
    }
    // 合并两份历史：同一条目取 timestamp 较新者，按时间倒序，截断到 MAX
    function merge(a, b) {
        const map = new Map();
        [].concat(a || [], b || []).forEach(function (it) {
            if (!it) return;
            const k = itemKey(it);
            const prev = map.get(k);
            if (!prev || (it.timestamp || 0) >= (prev.timestamp || 0)) map.set(k, it);
        });
        return Array.from(map.values())
            .sort(function (x, y) { return (y.timestamp || 0) - (x.timestamp || 0); })
            .slice(0, MAX);
    }

    function qs(user) { return API + '?user=' + encodeURIComponent(user); }

    let pushTimer = null;
    function doPush() {
        const user = getUsername();
        if (!user) return Promise.resolve();
        return fetch(qs(user), {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'include',
            body: JSON.stringify({ history: readLocal() }),
            keepalive: true,
        }).catch(function () {});
    }
    // 推送本地历史到服务端（默认防抖；immediate=true 立即冲刷）
    function push(immediate) {
        if (!enabled()) return Promise.resolve();
        if (immediate) {
            if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
            return doPush();
        }
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(doPush, PUSH_DEBOUNCE);
        return Promise.resolve();
    }
    // 从服务端拉取历史数组；失败/不可用返回 null
    function pull() {
        if (!enabled()) return Promise.resolve(null);
        return fetch(qs(getUsername()), { headers: authHeaders(), credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { return (d && Array.isArray(d.history)) ? d.history : null; })
            .catch(function () { return null; });
    }

    // 拉取并与本地合并，回写本地 + 回推服务端（使服务端为并集），刷新历史面板
    function syncNow() {
        if (!enabled()) return Promise.resolve(false);
        return pull().then(function (remote) {
            if (remote == null) return false;
            const merged = merge(remote, readLocal());
            writeLocal(merged);
            push(true);
            if (typeof global.loadViewingHistory === 'function') {
                try { global.loadViewingHistory(); } catch (e) {}
            }
            return true;
        });
    }

    // 设置面板：保存用户名并立即测试连通 + 同步
    function saveUsernameSetting() {
        const input = document.getElementById('usernameInput');
        const name = input ? input.value.trim() : '';
        const toast = (typeof global.showToast === 'function') ? global.showToast : function () {};
        const T = (typeof global.t === 'function') ? global.t : function (k) { return k; };
        setUsername(name);
        if (!name) { toast(T('toast.userCleared'), 'info'); return; }
        pull().then(function (remote) {
            if (remote == null) { toast(T('toast.syncFail'), 'warning'); return; }
            const merged = merge(remote, readLocal());
            writeLocal(merged);
            push(true);
            if (typeof global.loadViewingHistory === 'function') {
                try { global.loadViewingHistory(); } catch (e) {}
            }
            toast(T('toast.userSaved'), 'success');
        });
    }

    // 刷新/切后台时立即冲刷一次，捕获播放进度的本地写入
    function flush() { if (enabled()) push(true); }
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
    });
    global.addEventListener('pagehide', flush);

    document.addEventListener('DOMContentLoaded', function () {
        const input = document.getElementById('usernameInput');
        if (input && !(global.Account && global.Account.isLoggedIn && global.Account.isLoggedIn())) input.value = getUsername();
        syncNow();
    });
    // 登录/登出后立即同步该账号的云端历史
    document.addEventListener('lt-auth-changed', function () { syncNow(); });

    global.HistorySync = {
        getUsername: getUsername, setUsername: setUsername, enabled: enabled,
        push: push, pull: pull, syncNow: syncNow, saveUsernameSetting: saveUsernameSetting,
    };
    // 供设置面板按钮 onclick 直接调用
    global.saveUsernameSetting = saveUsernameSetting;
})(window);
