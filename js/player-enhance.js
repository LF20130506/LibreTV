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
    // auto：按内容类型/分辨率自动路由（动画→Anime4K，低清实拍→降噪，高清实拍→原画）。
    // CSS 档（off/light/standard/strong）：SVG 柔性锐化，无 brightness 防过曝。
    // Anime4K 档（a4k/a4k_strong）：WebGL 实时增强，钳制锐化 + 线条加深，几乎无白边。
    // sr/sr_strong（老片降噪/降噪 强）：WebGL 双边降噪，老片去色块去噪，不锐化。
    // clear/clear_strong（实拍超清/超清 强）：WebGL CAS 输出锐化，高清实拍提升清晰度，无白边。
    const ENHANCE_PRESETS = [
        { value: 'auto',         html: '自动(推荐)',    filter: '' },
        { value: 'off',          html: '关闭',         filter: '' },
        { value: 'light',        html: '轻度',         filter: 'url(#ltSharpenLight) saturate(1.04)' },
        { value: 'standard',     html: '标准',         filter: 'url(#ltSharpen) contrast(1.03) saturate(1.07)' },
        { value: 'strong',       html: '强',           filter: 'url(#ltSharpenStrong) contrast(1.05) saturate(1.10)' },
        { value: 'a4k',          html: 'Anime4K(动画)', filter: '', anime4k: 'a4k' },
        { value: 'a4k_strong',   html: 'Anime4K 强',    filter: '', anime4k: 'a4k_strong' },
        { value: 'clear',        html: '实拍超清',       filter: '', anime4k: 'clear' },
        { value: 'clear_strong', html: '超清 强',        filter: '', anime4k: 'clear_strong' },
        { value: 'sr',           html: '老片降噪',       filter: '', anime4k: 'sr' },
        { value: 'sr_strong',    html: '降噪 强',        filter: '', anime4k: 'sr_strong' },
    ];

    // 动画类内容关键词（用片名/分类判定）
    const ANIME_RE = /动漫|动画片|动画|国漫|日漫|港漫|欧美动漫|港台动漫|アニメ|anime|cartoon|卡通|番剧|剧场版/i;
    function classifyContent() {
        const t = String(global.currentVideoType || '');
        let title = '';
        try { title = (document.getElementById('videoTitle') || {}).textContent || ''; } catch (e) {}
        return ANIME_RE.test(t + ' ' + title);
    }
    // 「自动」路由：动画→Anime4K；低清实拍(≤576p，如老剧/标清)→CAS 超清(放大+锐化)；
    // 高清实拍/未知→CSS 锐化。高清用 CSS 锐化（而非重型 WebGL）避免逐帧 WebGL 拖卡；
    // 其锐化档位跟随「增强强度」滑块：弱→轻度、默认→标准、强→强。
    function resolveAuto(art) {
        const sh = (art && art.video && art.video.videoHeight) || 0;
        if (classifyContent()) return 'a4k';
        // 老剧/标清实拍（如《康熙微服私访记》~480p）：以前只做双边降噪、不锐化也不放大，
        // 画面依旧发糊。改走 CAS 超清——双线性放大到目标分辨率 + 对比度自适应锐化
        // （钳制邻域 min/max，无白边/光晕），让老片真正变清晰。
        // 若某源噪点过重，可手动切「老片降噪」或调低「增强强度」。
        if (sh && sh <= 576) return 'clear_strong';
        const s = getStrength();
        return s >= 1.25 ? 'strong' : (s >= 0.85 ? 'standard' : 'light');
    }
    function updateEnhanceTooltip(art, text) {
        try { art.setting.update({ name: 'enhance', tooltip: text }); } catch (e) {}
    }

    function getSavedEnhance() {
        try { return localStorage.getItem(LS_ENHANCE) || 'auto'; } catch (e) { return 'auto'; }
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
        // 'auto' 先按内容/分辨率解析为实际档
        const isAuto = value === 'auto';
        const effective = isAuto ? resolveAuto(art) : value;
        const preset = presetByValue(effective);
        if (preset.anime4k) {
            // 切到 Anime4K/降噪：清掉 CSS 滤镜，启用 WebGL 覆盖层
            art.video.style.filter = '';
            let ok = false;
            if (global.Anime4K) ok = global.Anime4K.enable(art, preset.anime4k);
            if (!ok) {
                // WebGL 不可用时，绝不回退到会产生白边的 SVG 锐化——直接关闭增强
                art.video.style.filter = '';
                // 自动模式静默回退，不打扰；手动选择才提示
                if (!isAuto && typeof global.showToast === 'function') {
                    global.showToast('当前环境不支持 Anime4K(需 WebGL2)，已关闭增强', 'warning');
                }
            }
        } else {
            if (global.Anime4K) global.Anime4K.disable();
            art.video.style.filter = preset.filter;
        }
        art.video.dataset.enhance = value;
        // 自动档：tooltip 显示「自动 → 实际档」
        if (isAuto) updateEnhanceTooltip(art, '自动 → ' + preset.html);
        // 刷新画质角标（增强输出尺寸在首帧渲染后才确定，故延迟多刷几次）
        updateQualityBadge(art);
        [120, 400, 900].forEach((t) => setTimeout(() => updateQualityBadge(art), t));
    }

    // ===== 画质 = 输出分辨率目标（单码率源也始终可改）=====
    // 与「画质增强」算法解耦：'auto'/'源画质' 沿用增强设置；选更高分辨率(1440P/4K)时——
    // 动画→Anime4K 上采样；实拍(纪录片/电影)→「实拍超清」(CAS)上采样。
    // 注意：实拍用的是 CAS 锐化式上采样，不是 Anime4K 的线条加深——线条加深才会让实拍发糊，
    // CAS 是按对比度自适应锐化、放大到目标分辨率，正是实拍要的"锐化 + 增强到 2K/4K"。
    const LS_QTARGET = 'playerQualityTarget';
    const QTARGETS = [
        { html: '自动',   value: 'auto' },
        { html: '源画质', value: 'source' },
        { html: '1440P',  value: '1440' },
        { html: '4K',     value: '2160' },
    ];
    function getSavedTarget() {
        try {
            const v = localStorage.getItem(LS_QTARGET);
            return QTARGETS.some((o) => o.value === v) ? v : 'auto';
        } catch (e) { return 'auto'; }
    }
    function saveTarget(v) { try { localStorage.setItem(LS_QTARGET, v); } catch (e) {} }
    function targetLabel(v) { return (QTARGETS.find((o) => o.value === v) || QTARGETS[0]).html; }

    // 单一入口：综合当前「画质目标」+「画质增强」并应用到视频
    function applyCurrent(art) {
        if (!art || !art.video) return;
        const target = getSavedTarget();
        if (global.Anime4K && global.Anime4K.setTarget) {
            global.Anime4K.setTarget(target === 'source' ? 0 : target); // 'auto' | 0 | 高度
        }
        if (target === 'auto' || target === 'source') {
            applyEnhance(art, getSavedEnhance());                       // 沿用增强设置（含自动路由）
        } else {
            // 动画→Anime4K 上采样；实拍→实拍超清(CAS)上采样到 2K/4K（非 Anime4K 线条加深）
            applyEnhance(art, classifyContent() ? 'a4k' : 'clear');
        }
    }

    // 初始化「画质增强」设置项（只需调用一次）
    function initEnhance(art) {
        if (!art || enhanceInited) return;
        const saved = getSavedEnhance();
        if (global.Anime4K) global.Anime4K.setStrength(getStrength()); // 应用已保存的强度
        applyCurrent(art);
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
                    saveEnhance(item.value);
                    // 选增强算法时，分辨率目标回到「自动」，避免「画质」与「画质增强」互相覆盖
                    saveTarget('auto');
                    try { art.setting.update({ name: 'quality', tooltip: targetLabel('auto') }); } catch (e) {}
                    applyCurrent(art);
                    return item.html;
                },
            });
            enhanceInited = true;
        } catch (e) {
            console.warn('[PlayerEnhance] 增强设置项注册失败:', e && e.message);
        }

        // 切集/换源后视频元素的 filter 可能被重置，重新应用（综合画质目标 + 增强设置）
        art.on('video:loadedmetadata', () => applyCurrent(art));
        // 「自动」档实时重路由：真实分辨率确定/变化(resize)时，用当前分辨率重判增强档
        if (art.video) art.video.addEventListener('resize', () => applyCurrent(art));
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
            '<div class="lt-sp-hint">对增强生效（含自动锐化）</div>';
        parent.appendChild(strengthPanel);

        const range = strengthPanel.querySelector('.lt-sp-range');
        const val = strengthPanel.querySelector('.lt-sp-val');
        range.addEventListener('input', () => {
            const v = parseFloat(range.value);
            val.textContent = v.toFixed(2);
            saveStrength(v);
            if (global.Anime4K) global.Anime4K.setStrength(v); // WebGL 档实时生效
        });
        // 松手后重应用一次：让「自动」的 CSS 锐化档位(轻/标/强)随强度切换
        range.addEventListener('change', () => applyCurrent(art));
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

        // Anime4K/超分 正在运行：显示 ✨ 标记（即使分辨率未提升也表明增强生效）
        let h = sh, w = sw, enhanced = false, running = false;
        if (global.Anime4K && global.Anime4K.isRunning && global.Anime4K.isRunning()) {
            running = true;
            const oh = global.Anime4K.getOutputHeight ? global.Anime4K.getOutputHeight() : 0;
            const ow = global.Anime4K.getOutputWidth ? global.Anime4K.getOutputWidth() : 0;
            if (oh > sh) { h = oh; w = ow || sw; enhanced = true; }
        }

        badgeEl.textContent = (running ? '✨' : '') + qualityLabel(h);
        badgeEl.title = enhanced
            ? `增强生效：源 ${sw}×${sh} → 输出 ${w}×${h}`
            : running
                ? `增强生效(锐化)：${sw}×${sh}`
                : `源分辨率 ${sw}×${sh}`;
        badgeEl.style.display = 'block';
        badgeEl.classList.toggle('is-uhd', h >= 2160);
        badgeEl.classList.toggle('is-enhanced', running);
    }

    // 初始化/更新「画质」设置项（每次 MANIFEST_PARSED 调用）。
    // 只管「真实码率档」：源真有多档(hls.levels>1)才出现，自动(ABR) + 各档切换；
    // 单码率源不显示该项。不再混入"上采样目标"，也不再劫持「画质增强」。
    function updateQuality(art, hls) {
        if (!art || !art.setting) return;

        // 单码率（多数采集站）：没有真实码率档，但「画质」仍始终可改——
        // 改成「输出分辨率」选择，通过 WebGL 上采样把画面放大到目标分辨率。
        if (!hls || !Array.isArray(hls.levels) || hls.levels.length <= 1) {
            addResolutionQuality(art);
            return;
        }

        // 有真实多码率档：用真实档位，分辨率目标回到自动（交给 ABR/手选档）
        saveTarget('auto');
        const levels = hls.levels
            .map((lv, i) => ({ h: lv.height || 0, i }))
            .sort((a, b) => b.h - a.h);
        const selector = [
            { html: '自动', value: -1, default: true },
            ...levels.map((it) => ({
                html: it.h ? qualityLabel(it.h) : '档 ' + (it.i + 1),
                value: it.i,
            })),
        ];

        const setting = {
            name: 'quality',
            html: '画质',
            tooltip: '自动',
            selector,
            onSelect: function (item) {
                hls.currentLevel = parseInt(item.value, 10); // -1 = 自动 ABR
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
    // 单码率源的「画质」= 输出分辨率选择（自动/源画质/1440P/4K）
    function addResolutionQuality(art) {
        if (!art || !art.setting) return;
        const saved = getSavedTarget();
        const setting = {
            name: 'quality',
            html: '画质',
            tooltip: targetLabel(saved),
            selector: QTARGETS.map((o) => ({ html: o.html, value: o.value, default: o.value === saved })),
            onSelect: function (item) {
                saveTarget(item.value);
                applyCurrent(art);
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
            console.warn('[PlayerEnhance] 画质(分辨率)设置项注册失败:', e && e.message);
        }
        applyCurrent(art); // 应用已保存目标（换集后保持）
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
