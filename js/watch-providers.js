// js/watch-providers.js
// 合法的「可观看平台」功能：通过 TMDB 官方 API 的 watch/providers 接口，
// 在影片详情中展示该片可在 Netflix / Disney+ 等正版平台观看，并提供官方跳转。
// 不抓取、不解密、不代理任何受版权保护的内容，仅做发现与导流。
//
// 数据来源：The Movie Database (TMDB) + JustWatch。需在设置中填入 TMDB API Key。
// 申请地址（免费）：https://www.themoviedb.org/settings/api

(function (global) {
    const TMDB_BASE = 'https://api.themoviedb.org/3';
    const TMDB_IMG = 'https://image.tmdb.org/t/p/w92';

    const LS_KEY = 'tmdbApiKey';
    const LS_REGION = 'tmdbRegion';
    const LS_LANG = 'tmdbLanguage';

    function esc(s) {
        return (global.LTSecurity && global.LTSecurity.escapeHtml)
            ? global.LTSecurity.escapeHtml(s)
            : String(s == null ? '' : s);
    }

    function getConfig() {
        // localStorage 优先；其次服务端注入的 __ENV__（若部署时配置）
        let key = '';
        try { key = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
        const envKey = global.__ENV__ && global.__ENV__.TMDB_API_KEY;
        if (!key && typeof envKey === 'string' && envKey && !/\{\{.*\}\}/.test(envKey)) {
            key = envKey;
        }
        let region = 'US';
        let language = 'zh-CN';
        try {
            region = (localStorage.getItem(LS_REGION) || 'US').toUpperCase();
            language = localStorage.getItem(LS_LANG) || 'zh-CN';
        } catch (e) {}
        return { key: key.trim(), region, language };
    }

    function isEnabled() {
        return !!getConfig().key;
    }

    async function tmdbGet(path, params, key, signal) {
        const usp = new URLSearchParams({ api_key: key, ...params });
        const res = await fetch(`${TMDB_BASE}${path}?${usp.toString()}`, { signal });
        if (!res.ok) throw new Error(`TMDB ${res.status}`);
        return res.json();
    }

    // 用片名(+年份)搜索，返回最匹配的 {mediaType, id, title}
    async function searchTitle(name, year, cfg, signal) {
        const data = await tmdbGet('/search/multi', {
            query: name,
            language: cfg.language,
            include_adult: 'false',
        }, cfg.key, signal);
        const results = (data.results || []).filter(
            (r) => r.media_type === 'movie' || r.media_type === 'tv'
        );
        if (!results.length) return null;

        let best = results[0];
        if (year) {
            const y = String(year);
            const matched = results.find((r) => {
                const d = r.release_date || r.first_air_date || '';
                return d.startsWith(y);
            });
            if (matched) best = matched;
        }
        return {
            mediaType: best.media_type,
            id: best.id,
            title: best.title || best.name || name,
        };
    }

    async function getProviders(mediaType, id, cfg, signal) {
        const data = await tmdbGet(`/${mediaType}/${id}/watch/providers`, {}, cfg.key, signal);
        const regionData = (data.results && data.results[cfg.region]) || null;
        return regionData; // { link, flatrate?, rent?, buy? }
    }

    // 去重合并 flatrate/rent/buy，flatrate(订阅)优先
    function collectProviders(regionData) {
        const seen = new Set();
        const out = [];
        for (const bucket of ['flatrate', 'free', 'ads', 'rent', 'buy']) {
            for (const p of (regionData[bucket] || [])) {
                if (seen.has(p.provider_id)) continue;
                seen.add(p.provider_id);
                out.push({ ...p, _bucket: bucket });
            }
        }
        return out;
    }

    const BUCKET_LABEL = {
        flatrate: '订阅', free: '免费', ads: '广告', rent: '租赁', buy: '购买',
    };

    function renderInto(container, regionData, title, cfg) {
        const providers = collectProviders(regionData);
        if (!providers.length) { container.innerHTML = ''; return; }

        const link = regionData.link || '';
        const chips = providers.map((p) => {
            const logo = p.logo_path ? `<img src="${esc(TMDB_IMG + p.logo_path)}" alt="${esc(p.provider_name)}" loading="lazy" style="width:28px;height:28px;border-radius:8px;">` : '';
            const label = BUCKET_LABEL[p._bucket] || '';
            return `<span class="wp-chip" title="${esc(p.provider_name)}（${esc(label)}）">${logo}<span class="wp-chip-name">${esc(p.provider_name)}</span></span>`;
        }).join('');

        container.innerHTML = `
            <div class="wp-box">
                <div class="wp-head">
                    <span class="wp-title">📺 可在以下平台观看（${esc(cfg.region)}）</span>
                    ${link ? `<a class="wp-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">前往观看 ↗</a>` : ''}
                </div>
                <div class="wp-chips">${chips}</div>
                <div class="wp-attr">数据来源 TMDB &amp; JustWatch · 跳转至正版平台观看</div>
            </div>`;
    }

    /**
     * 在指定容器渲染「可观看平台」。失败时静默清空，绝不影响详情弹窗。
     * @param {string} containerId
     * @param {string} name 片名
     * @param {string|number} [year]
     */
    async function render(containerId, name, year) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const cfg = getConfig();
        if (!cfg.key || !name) { container.innerHTML = ''; return; }

        // 超时保护
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        try {
            const hit = await searchTitle(name, year, cfg, controller.signal);
            if (!hit) { container.innerHTML = ''; return; }
            const regionData = await getProviders(hit.mediaType, hit.id, cfg, controller.signal);
            if (!regionData) { container.innerHTML = ''; return; }
            renderInto(container, regionData, hit.title, cfg);
        } catch (e) {
            // 网络/配额/无 Key 等一律静默
            container.innerHTML = '';
            if (cfg.key) console.warn('[WatchProviders] 获取失败:', e.message);
        } finally {
            clearTimeout(t);
        }
    }

    // 保存设置（供设置面板按钮调用），并回填输入框
    function saveSettings() {
        const keyEl = document.getElementById('tmdbApiKey');
        const regionEl = document.getElementById('tmdbRegion');
        try {
            if (keyEl) localStorage.setItem(LS_KEY, (keyEl.value || '').trim());
            if (regionEl) localStorage.setItem(LS_REGION, (regionEl.value || 'US').trim().toUpperCase());
        } catch (e) {}
        if (typeof global.showToast === 'function') {
            global.showToast('已保存可观看平台设置', 'success');
        }
    }

    function populateInputs() {
        const cfg = getConfig();
        const keyEl = document.getElementById('tmdbApiKey');
        const regionEl = document.getElementById('tmdbRegion');
        if (keyEl && cfg.key) keyEl.value = cfg.key;
        if (regionEl) regionEl.value = cfg.region;
    }

    document.addEventListener('DOMContentLoaded', populateInputs);
    global.saveTmdbSettings = saveSettings;

    global.WatchProviders = { render, isEnabled, getConfig };
})(window);
