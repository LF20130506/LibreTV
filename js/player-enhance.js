// js/player-enhance.js
// 播放器「画质选择」与「画质增强」功能。
// - 画质选择：基于 HLS.js 的多码率档位 (hls.levels)，在 ArtPlayer 设置面板中选择，
//   选定后设置 hls.currentLevel（-1 为自动 ABR）。
// - 画质增强：对 <video> 应用 CSS 滤镜 + SVG 卷积锐化（player.html 中的 #ltSharpen），
//   提供 关闭/轻度/标准/强 预设，设置持久化到 localStorage。
//
// 依赖运行时全局：ArtPlayer 实例、Hls 实例（由 player.js 在事件回调中传入）。

(function (global) {
    const LS_ENHANCE = 'playerEnhanceLevel';

    // 画质增强预设。
    // CSS 档（off/light/standard/strong）：SVG 柔性锐化，无 brightness 防过曝。
    // Anime4K 档（a4k/a4k_strong）：WebGL 实时增强，钳制锐化 + 线条加深，几乎无白边。
    const ENHANCE_PRESETS = [
        { value: 'off',        html: '关闭',         filter: '' },
        { value: 'light',      html: '轻度',         filter: 'url(#ltSharpenLight) saturate(1.04)' },
        { value: 'standard',   html: '标准',         filter: 'url(#ltSharpen) contrast(1.03) saturate(1.07)' },
        { value: 'strong',     html: '强',           filter: 'url(#ltSharpenStrong) contrast(1.05) saturate(1.10)' },
        { value: 'a4k',        html: 'Anime4K',      filter: '', anime4k: 'a4k' },
        { value: 'a4k_strong', html: 'Anime4K 强',   filter: '', anime4k: 'a4k_strong' },
    ];

    function getSavedEnhance() {
        try { return localStorage.getItem(LS_ENHANCE) || 'off'; } catch (e) { return 'off'; }
    }
    function saveEnhance(value) {
        try { localStorage.setItem(LS_ENHANCE, value); } catch (e) {}
    }
    function presetByValue(value) {
        return ENHANCE_PRESETS.find((p) => p.value === value) || ENHANCE_PRESETS[0];
    }

    // 把增强应用到视频元素：CSS 滤镜档与 Anime4K(WebGL)档互斥
    function applyEnhance(art, value) {
        if (!art || !art.video) return;
        const preset = presetByValue(value);
        if (preset.anime4k) {
            // 切到 Anime4K：清掉 CSS 滤镜，启用 WebGL 覆盖层
            art.video.style.filter = '';
            let ok = false;
            if (global.Anime4K) ok = global.Anime4K.enable(art, preset.anime4k);
            // WebGL 启用失败则回退到 CSS「标准」档，保证仍有增强效果
            if (!ok) {
                art.video.style.filter = presetByValue('standard').filter;
                if (typeof global.showToast === 'function') {
                    global.showToast('当前环境不支持 Anime4K，已回退为普通增强', 'warning');
                }
            }
        } else {
            if (global.Anime4K) global.Anime4K.disable();
            art.video.style.filter = preset.filter;
        }
        art.video.dataset.enhance = preset.value;
    }

    // 初始化「画质增强」设置项（只需调用一次）
    function initEnhance(art) {
        if (!art || enhanceInited) return;
        const saved = getSavedEnhance();
        applyEnhance(art, saved);

        try {
            art.setting.add({
                name: 'enhance',
                html: '画质增强',
                tooltip: presetByValue(saved).html,
                selector: ENHANCE_PRESETS.map((p) => ({
                    html: p.html,
                    value: p.value,
                    default: p.value === saved,
                })),
                onSelect: function (item) {
                    applyEnhance(art, item.value);
                    saveEnhance(item.value);
                    return item.html;
                },
            });
            enhanceInited = true;
        } catch (e) {
            console.warn('[PlayerEnhance] 增强设置项注册失败:', e && e.message);
        }

        // 切集/换源后视频元素的 filter 可能被重置，重新应用
        art.on('video:loadedmetadata', () => applyEnhance(art, getSavedEnhance()));
        // 播放器销毁时关闭 Anime4K 渲染循环
        try { art.on('destroy', () => global.Anime4K && global.Anime4K.disable()); } catch (e) {}
    }
    let enhanceInited = false;

    // 由 hls.levels 构造画质档位标签
    function levelLabel(level, index) {
        if (level.height) return `${level.height}P`;
        if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
        return `档位 ${index + 1}`;
    }

    // 初始化/更新「画质」设置项（每次 MANIFEST_PARSED 调用）
    function updateQuality(art, hls) {
        if (!art || !hls || !Array.isArray(hls.levels)) return;
        const levels = hls.levels;
        // 单档位无需选择
        if (levels.length <= 1) return;

        // 自动 + 各档位（按分辨率从高到低）
        const items = levels
            .map((lv, i) => ({ html: levelLabel(lv, i), value: i, _h: lv.height || 0 }))
            .sort((a, b) => b._h - a._h);
        const selector = [
            { html: '自动', value: -1, default: hls.currentLevel === -1 },
            ...items.map((it) => ({ html: it.html, value: it.value, default: false })),
        ];

        const setting = {
            name: 'quality',
            html: '画质',
            tooltip: hls.currentLevel === -1 ? '自动' : levelLabel(levels[hls.currentLevel] || {}, hls.currentLevel),
            selector,
            onSelect: function (item) {
                hls.currentLevel = item.value; // -1 = 自动 ABR
                return item.html;
            },
        };

        try {
            if (qualityAdded) {
                if (typeof art.setting.update === 'function') {
                    art.setting.update(setting);
                } else {
                    // 兼容无 update 的构建：先移除再添加
                    try { art.setting.remove && art.setting.remove('quality'); } catch (e) {}
                    art.setting.add(setting);
                }
            } else {
                art.setting.add(setting);
                qualityAdded = true;
            }
        } catch (e) {
            console.warn('[PlayerEnhance] 画质设置项注册失败:', e && e.message);
        }

        // 自动模式下，实际切换档位时更新 tooltip 显示当前分辨率
        if (!levelSwitchBound && global.Hls && hls.on) {
            hls.on(global.Hls.Events.LEVEL_SWITCHED, function (_e, data) {
                const lv = levels[data.level];
                if (!lv) return;
                const label = hls.autoLevelEnabled ? `自动 (${levelLabel(lv, data.level)})` : levelLabel(lv, data.level);
                try { art.setting.update({ name: 'quality', tooltip: label }); } catch (e) {}
            });
            levelSwitchBound = true;
        }
    }
    let qualityAdded = false;
    let levelSwitchBound = false;

    // 换源时需要重置画质绑定状态（新的 hls 实例）
    function resetQuality() {
        qualityAdded = false;
        levelSwitchBound = false;
    }

    global.PlayerEnhance = { initEnhance, updateQuality, applyEnhance, resetQuality };
})(window);
