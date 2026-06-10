// js/theme.js
// 主题切换：在「白色海景房(seaside)」与「高对比度(contrast)」之间切换并持久化。
// 主题以 <html data-theme="..."> 表达，由 css/glass-theme.css 提供对应配色。

(function (global) {
    const KEY = 'ltTheme';
    const THEMES = ['seaside', 'contrast'];
    const LABEL = { seaside: '海景', contrast: '高对比' };

    function getTheme() {
        let t = 'seaside';
        try { t = localStorage.getItem(KEY) || 'seaside'; } catch (e) {}
        return THEMES.includes(t) ? t : 'seaside';
    }

    function applyTheme(t) {
        document.documentElement.setAttribute('data-theme', t);
        const btn = document.getElementById('themeToggleBtn');
        if (btn) btn.title = `当前：${LABEL[t]}（点击切换）`;
    }

    function setTheme(t) {
        if (!THEMES.includes(t)) t = 'seaside';
        try { localStorage.setItem(KEY, t); } catch (e) {}
        applyTheme(t);
        if (typeof global.showToast === 'function') {
            global.showToast(`已切换到「${LABEL[t]}」主题`, 'success');
        }
    }

    function toggleTheme() {
        const cur = getTheme();
        setTheme(cur === 'seaside' ? 'contrast' : 'seaside');
    }

    // 立即应用（脚本可能在 body 末尾加载；早期内联脚本已先设过属性以防闪烁）
    applyTheme(getTheme());
    document.addEventListener('DOMContentLoaded', () => applyTheme(getTheme()));

    global.toggleTheme = toggleTheme;
    global.setTheme = setTheme;
    global.getTheme = getTheme;
})(window);
