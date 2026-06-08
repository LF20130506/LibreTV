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
        { value: 'a4k',        html: 'Anime4K(动画)', filter: '', anime4k: 'a4k' },
        { value: 'a4k_strong', html: 'Anime4K 强',    filter: '', anime4k: 'a4k_strong' },
        { value: 'sr',         html: '超分(实拍)',     filter: '', anime4k: 'sr' },
        { value: 'sr_strong',  html: '超分 强',        filter: '', anime4k: 'sr_strong' },
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
        // 刷新画质角标（增强输出尺寸在首帧渲染后才确定，故延迟多刷几次）
        updateQualityBadge(art);
        [120, 400, 900].forEach((t) => setTimeout(() => updateQualityBadge(art), t));
    }

    // 初始化「画质增强」设置项（只需调用一次）
    function initEnhance(art) {
        if (!art || enhanceInited) return;
        const saved = getSavedEnhance();
        if (global.Anime4K) global.Anime4K.setStrength(getStrength()); // 应用已保存的强度
        applyEnhance(art, saved);
        initQualityBadge(art); // 自动检测并显示分辨率画质角标
        initStrengthControl(art); // 增强强度滑块
        if (global.LTDownloader) global.LTDownloader.setup(art); // 下载（本集/整季）

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

    // ===== 增强强度滑块（对 Anime4K / 超分 生效）=====
    const LS_STRENGTH = 'enhanceStrength';
    function getStrength() {
        let v = 1.0;
        try { v = parseFloat(localStorage.getItem(LS_STRENGTH)); } catch (e) {}
        if (!isFinite(v) || v <= 0) v = 1.0;
        return Math.max(0.3, Math.min(1.8, v));
    }
    function saveStrength(v) {
        try { localStorage.setItem(LS_STRENGTH, String(v)); } catch (e) {}
    }

    let strengthPanel = null;
    function initStrengthControl(art) {
        if (strengthPanel || !art || !art.video) return;
        const parent =
            (art.template && (art.template.$player || art.template.$container)) ||
            art.video.parentElement;
        if (!parent) return;

        const cur = getStrength();
        strengthPanel = document.createElement('div');
        strengthPanel.className = 'lt-strength-panel';
        strengthPanel.style.display = 'none';
        strengthPanel.innerHTML =
            '<div class="lt-sp-label">增强强度 <span class="lt-sp-val">' + cur.toFixed(2) + '</span></div>' +
            '<input class="lt-sp-range" type="range" min="0.3" max="1.8" step="0.05" value="' + cur + '">' +
            '<div class="lt-sp-hint">对 Anime4K / 超分 生效</div>';
        parent.appendChild(strengthPanel);

        const range = strengthPanel.querySelector('.lt-sp-range');
        const val = strengthPanel.querySelector('.lt-sp-val');
        range.addEventListener('input', () => {
            const v = parseFloat(range.value);
            val.textContent = v.toFixed(2);
            saveStrength(v);
            if (global.Anime4K) global.Anime4K.setStrength(v);
        });
        // 防止滑块上的手势冒泡到播放器（快进/暂停）
        ['click', 'mousedown', 'touchstart', 'dblclick'].forEach((ev) =>
            strengthPanel.addEventListener(ev, (e) => e.stopPropagation()));

        // 控制栏按钮：切换面板显隐
        if (art.controls && typeof art.controls.add === 'function') {
            try {
                art.controls.add({
                    name: 'lt-strength',
                    position: 'right',
                    tooltip: '增强强度',
                    html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
                    click: function () {
                        strengthPanel.style.display = strengthPanel.style.display === 'none' ? 'block' : 'none';
                    },
                });
            } catch (e) { /* 控件不可用则仅保留面板 API */ }
        }
    }

    // 由 hls.levels 构造画质档位标签
    function levelLabel(level, index) {
        if (level.height) return qualityLabel(level.height);
        if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
        return `档位 ${index + 1}`;
    }

    // ===== 自动检测分辨率并显示画质角标 =====

    // 按高度映射为通俗画质名（取就近的标准档）
    function qualityLabel(h) {
        if (!h) return '';
        if (h >= 4320) return '8K';
        if (h >= 2160) return '4K';
        if (h >= 1440) return '1440P';
        if (h >= 1080) return '1080P';
        if (h >= 720)  return '720P';
        if (h >= 480)  return '480P';
        if (h >= 360)  return '360P';
        return `${h}P`;
    }

    let badgeEl = null;
    function initQualityBadge(art) {
        if (badgeEl || !art || !art.video) return;
        const parent =
            (art.template && (art.template.$player || art.template.$container)) ||
            art.video.parentElement;
        if (!parent) return;
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

        badgeEl = document.createElement('div');
        badgeEl.className = 'lt-quality-badge';
        badgeEl.style.display = 'none';
        parent.appendChild(badgeEl);

        const update = () => updateQualityBadge(art);
        art.video.addEventListener('loadedmetadata', update);
        art.video.addEventListener('resize', update); // 分辨率变化（换源/ABR 切换）时触发
        art.on('video:loadedmetadata', update);
        update();
    }

    function updateQualityBadge(art) {
        if (!badgeEl || !art || !art.video) return;
        const sw = art.video.videoWidth || 0;
        const sh = art.video.videoHeight || 0;
        if (!sh) { badgeEl.style.display = 'none'; return; }

        // 若 Anime4K/超分 正在运行且实际提升了输出分辨率，则显示增强后画质
        let h = sh, w = sw, enhanced = false;
        if (global.Anime4K && global.Anime4K.isRunning && global.Anime4K.isRunning()) {
            const oh = global.Anime4K.getOutputHeight ? global.Anime4K.getOutputHeight() : 0;
            const ow = global.Anime4K.getOutputWidth ? global.Anime4K.getOutputWidth() : 0;
            if (oh > sh) { h = oh; w = ow || sw; enhanced = true; }
        }

        badgeEl.textContent = (enhanced ? '✨' : '') + qualityLabel(h);
        badgeEl.title = enhanced
            ? `AI 增强：源 ${sw}×${sh} → 输出 ${w}×${h}`
            : `源分辨率 ${sw}×${sh}`;
        badgeEl.style.display = 'block';
        badgeEl.classList.toggle('is-uhd', h >= 2160);
        badgeEl.classList.toggle('is-enhanced', enhanced);
    }

    // 选高分辨率时确保 WebGL 增强在运行（否则上采样无意义）；默认切到「超分(实拍)」
    function ensureWebGL(art) {
        const cur = getSavedEnhance();
        if (presetByValue(cur).anime4k) return; // 已是 WebGL 模式
        applyEnhance(art, 'sr');
        saveEnhance('sr');
        try {
            art.setting.update({
                name: 'enhance',
                tooltip: presetByValue('sr').html,
                selector: ENHANCE_PRESETS.map((p) => ({ html: p.html, value: p.value, default: p.value === 'sr' })),
            });
        } catch (e) {}
    }

    // 初始化/更新「画质」设置项（每次 MANIFEST_PARSED 调用）。
    // 始终存在：以「输出分辨率」为主（自动/源/1440P/2160P，驱动上采样），
    // 当存在真实多码率档时再附上码率档供切换。
    function updateQuality(art, hls) {
        if (!art || !art.setting) return;
        const sh = (art.video && art.video.videoHeight) || 0;
        const srcLabel = sh ? qualityLabel(sh) : '';

        const selector = [
            { html: '自动(增强到1440P)', value: 'auto', default: true },
            { html: '源画质' + (srcLabel ? ` (${srcLabel})` : ''), value: 'src' },
            { html: '1440P 增强', value: 'h:1440' },
            { html: '2160P 增强', value: 'h:2160' },
        ];

        // 真实码率档（如有）
        if (hls && Array.isArray(hls.levels) && hls.levels.length > 1) {
            hls.levels
                .map((lv, i) => ({ h: lv.height || 0, i }))
                .sort((a, b) => b.h - a.h)
                .forEach((it) => selector.push({
                    html: '码率 ' + (it.h ? qualityLabel(it.h) : '档' + (it.i + 1)),
                    value: 'lvl:' + it.i,
                }));
        }

        const setting = {
            name: 'quality',
            html: '画质',
            tooltip: '自动',
            selector,
            onSelect: function (item) {
                const v = String(item.value);
                if (v === 'auto') {
                    ensureWebGL(art);
                    global.Anime4K && global.Anime4K.setTarget && global.Anime4K.setTarget('auto');
                } else if (v === 'src') {
                    global.Anime4K && global.Anime4K.setTarget && global.Anime4K.setTarget(0);
                } else if (v.startsWith('h:')) {
                    ensureWebGL(art);
                    global.Anime4K && global.Anime4K.setTarget && global.Anime4K.setTarget(parseInt(v.slice(2), 10));
                } else if (v.startsWith('lvl:') && hls) {
                    hls.currentLevel = parseInt(v.slice(4), 10);
                }
                [120, 400, 900].forEach((t) => setTimeout(() => updateQualityBadge(art), t));
                return item.html;
            },
        };

        try {
            if (qualityAdded) {
                if (typeof art.setting.update === 'function') art.setting.update(setting);
                else { try { art.setting.remove && art.setting.remove('quality'); } catch (e) {} art.setting.add(setting); }
            } else {
                art.setting.add(setting);
                qualityAdded = true;
            }
        } catch (e) {
            console.warn('[PlayerEnhance] 画质设置项注册失败:', e && e.message);
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
