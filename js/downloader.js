// js/downloader.js
// 「下载本集」：把当前 HLS(m3u8) 分片经 /proxy 抓取、（必要时 AES-128 解密）后
// 合并为单个 .ts 文件下载。兼容三端部署（统一通过 PROXY_URL 取流）。
//
// 限制：整集分片会在内存中合并，长视频占用较大；加密仅支持 AES-128(CBC)，
// 不支持 SAMPLE-AES / DRM。失败会给出明确提示，不影响播放。

(function (global) {
    const PROXY = (typeof PROXY_URL === 'string' && PROXY_URL) ? PROXY_URL : '/proxy/';

    // 取当前集的原始 m3u8 地址
    function currentEpisodeUrl() {
        try {
            if (Array.isArray(currentEpisodes) && typeof currentEpisodeIndex === 'number') {
                return currentEpisodes[currentEpisodeIndex] || '';
            }
        } catch (e) {}
        return '';
    }

    function baseTitle() {
        const t = (document.getElementById('videoTitle') || {}).textContent || '视频';
        return t.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    }
    function episodeFilename(idx0) {
        return `${baseTitle()}_第${(idx0 | 0) + 1}集`;
    }
    function currentTitle() {
        let idx = 0;
        try { idx = currentEpisodeIndex | 0; } catch (e) { idx = 0; }
        return episodeFilename(idx);
    }

    // uri -> 原始绝对地址（处理已被代理重写的 /proxy/、绝对、相对三种情况）
    function toOriginalAbs(uri, baseAbs) {
        if (!uri) return '';
        if (uri.startsWith(PROXY)) return decodeURIComponent(uri.slice(PROXY.length));
        if (/^https?:\/\//i.test(uri)) return uri;
        try { return new URL(uri, baseAbs).href; } catch (e) { return uri; }
    }
    // 原始绝对地址 -> 经代理的可取地址
    function proxied(absUrl) {
        return PROXY + encodeURIComponent(absUrl);
    }

    // 直连优先：与播放器一致直接取源站（CORS 由源站提供，能播即能下）；
    // 失败再回退代理。注意：边缘代理可能按文本处理而损坏二进制，故二进制必须直连优先。
    async function fetchText(absUrl, signal) {
        try {
            const r = await fetch(absUrl, { signal, mode: 'cors' });
            if (r.ok) return await r.text();
        } catch (e) { /* 回退代理 */ }
        const r2 = await fetch(proxied(absUrl), { signal });
        if (!r2.ok) throw new Error(`播放列表获取失败(HTTP ${r2.status})`);
        return r2.text();
    }
    async function fetchBuffer(absUrl, signal) {
        try {
            const r = await fetch(absUrl, { signal, mode: 'cors' });
            if (r.ok) return await r.arrayBuffer();
        } catch (e) { /* 回退代理 */ }
        const r2 = await fetch(proxied(absUrl), { signal });
        if (!r2.ok) throw new Error(`分片获取失败(HTTP ${r2.status})`);
        return r2.arrayBuffer();
    }

    // 解析媒体播放列表，返回 { segments:[abs], key, mapAbs, mediaSeq }
    function parseMedia(text, baseAbs) {
        const lines = text.split('\n').map((l) => l.trim());
        const segments = [];
        let key = null, mapAbs = '', mediaSeq = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                mediaSeq = parseInt(line.split(':')[1], 10) || 0;
            } else if (line.startsWith('#EXT-X-KEY:')) {
                const attr = line.slice('#EXT-X-KEY:'.length);
                const method = (attr.match(/METHOD=([^,]+)/) || [])[1] || 'NONE';
                const uri = (attr.match(/URI="([^"]+)"/) || [])[1] || '';
                const ivHex = (attr.match(/IV=0x([0-9A-Fa-f]+)/) || [])[1] || '';
                key = method === 'NONE' ? null : { method, uri: toOriginalAbs(uri, baseAbs), ivHex };
            } else if (line.startsWith('#EXT-X-MAP:')) {
                const uri = (line.match(/URI="([^"]+)"/) || [])[1] || '';
                if (uri) mapAbs = toOriginalAbs(uri, baseAbs);
            } else if (!line.startsWith('#')) {
                segments.push(toOriginalAbs(line, baseAbs));
            }
        }
        return { segments, key, mapAbs, mediaSeq };
    }

    function hexToBytes(hex) {
        const a = new Uint8Array(hex.length / 2);
        for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
        return a;
    }
    function seqToIv(seq) {
        const iv = new Uint8Array(16);
        const dv = new DataView(iv.buffer);
        dv.setUint32(12, seq >>> 0); // 大端，低 32 位
        return iv;
    }

    async function decryptSeg(buf, cryptoKey, iv) {
        const dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, buf);
        return new Uint8Array(dec);
    }

    // 按需加载 mux.js（TS→MP4 无损转封装库），只在第一次下载时加载
    let muxLoading = null;
    function loadMux() {
        if (global.muxjs) return Promise.resolve(global.muxjs);
        if (muxLoading) return muxLoading;
        muxLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'libs/mux.min.js';
            s.onload = () => global.muxjs ? resolve(global.muxjs) : reject(new Error('mux.js 未就绪'));
            s.onerror = () => reject(new Error('转封装库加载失败'));
            document.head.appendChild(s);
        });
        return muxLoading;
    }

    // 保存 Blob 为文件
    function saveBlob(parts, mime, filename) {
        const blob = new Blob(parts, { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    }

    // ===== 进度 UI =====
    let ui = null, aborter = null;
    function showProgress() {
        if (ui) return ui;
        const el = document.createElement('div');
        el.className = 'lt-dl-progress';
        el.innerHTML =
            '<div class="lt-dl-card">' +
            '<div class="lt-dl-title">正在下载本集…</div>' +
            '<div class="lt-dl-bar"><div class="lt-dl-fill"></div></div>' +
            '<div class="lt-dl-text">准备中…</div>' +
            '<button class="lt-dl-cancel">取消</button>' +
            '</div>';
        document.body.appendChild(el);
        el.querySelector('.lt-dl-cancel').onclick = () => { if (aborter) aborter.abort(); };
        ui = {
            el,
            fill: el.querySelector('.lt-dl-fill'),
            text: el.querySelector('.lt-dl-text'),
            title: el.querySelector('.lt-dl-title'),
        };
        return ui;
    }
    function setProgress(done, total, extra) {
        if (!ui) return;
        const pct = total ? Math.floor((done / total) * 100) : 0;
        ui.fill.style.width = pct + '%';
        ui.text.textContent = `${done}/${total} 分片 (${pct}%)${extra ? ' · ' + extra : ''}`;
    }
    function closeProgress() {
        if (ui && ui.el && ui.el.parentElement) ui.el.parentElement.removeChild(ui.el);
        ui = null;
    }

    // 下载单集并保存为 filename.ts；进度通过 setProgress 显示
    async function downloadOne(m3u8, filename, signal) {
        // 1) 取播放列表（可能是 master）
        let baseAbs = m3u8;
        let text = await fetchText(baseAbs, signal);
        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split('\n').map((l) => l.trim());
            let best = '', bw = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    const b = parseInt((lines[i].match(/BANDWIDTH=(\d+)/) || [])[1] || '0', 10);
                    for (let j = i + 1; j < lines.length; j++) {
                        if (lines[j] && !lines[j].startsWith('#')) {
                            if (b >= bw) { bw = b; best = lines[j]; }
                            break;
                        }
                    }
                }
            }
            if (best) { baseAbs = toOriginalAbs(best, baseAbs); text = await fetchText(baseAbs, signal); }
        }

        // 2) 解析媒体列表
        const { segments, key, mapAbs, mediaSeq } = parseMedia(text, baseAbs);
        if (!segments.length) throw new Error('未解析到任何分片');
        if (key && key.method !== 'AES-128') throw new Error(`暂不支持的加密方式：${key.method}`);

        // 3) 准备解密
        let cryptoKey = null, explicitIv = null;
        if (key) {
            if (!(global.crypto && global.crypto.subtle)) {
                throw new Error('当前环境不支持解密(需 HTTPS)，无法下载加密流');
            }
            const keyBuf = await fetchBuffer(key.uri, signal);
            if (keyBuf.byteLength !== 16) {
                throw new Error(`密钥长度异常(${keyBuf.byteLength}字节)，疑似被代理损坏`);
            }
            try {
                cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
            } catch (e) {
                throw new Error('密钥导入失败：' + (e && e.message || e));
            }
            if (key.ivHex) explicitIv = hexToBytes(key.ivHex);
        }

        const total = segments.length;

        // —— 情况 A：源已是 fMP4 分片（含 EXT-X-MAP）→ 直接拼接为 .mp4 ——
        if (mapAbs) {
            const parts = [new Uint8Array(await fetchBuffer(mapAbs, signal))];
            for (let i = 0; i < total; i++) {
                if (signal.aborted) throw new Error('已取消');
                let buf = await fetchBuffer(segments[i], signal);
                if (cryptoKey) buf = (await decryptSeg(buf, cryptoKey, explicitIv || seqToIv(mediaSeq + i))).buffer;
                parts.push(new Uint8Array(buf));
                setProgress(i + 1, total);
            }
            saveBlob(parts, 'video/mp4', filename + '.mp4');
            return;
        }

        // —— 情况 B：TS 分片 → 用 mux.js 无损转封装为 MP4（不重新编码）——
        let muxjs = null;
        try { muxjs = await loadMux(); } catch (e) { muxjs = null; }

        if (muxjs && muxjs.mp4 && muxjs.mp4.Transmuxer) {
            const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: true });
            let initSeg = null;
            const dataParts = [];
            transmuxer.on('data', (seg) => {
                if (!initSeg && seg.initSegment) initSeg = new Uint8Array(seg.initSegment);
                if (seg.data) dataParts.push(new Uint8Array(seg.data));
            });

            for (let i = 0; i < total; i++) {
                if (signal.aborted) throw new Error('已取消');
                let buf = await fetchBuffer(segments[i], signal);
                if (cryptoKey) buf = (await decryptSeg(buf, cryptoKey, explicitIv || seqToIv(mediaSeq + i))).buffer;
                // 逐片喂入并 flush，输出 fMP4 片段（内存与逐片下载相当）
                transmuxer.push(new Uint8Array(buf));
                transmuxer.flush();
                setProgress(i + 1, total);
            }

            if (initSeg && dataParts.length) {
                saveBlob([initSeg, ...dataParts], 'video/mp4', filename + '.mp4');
                return;
            }
            // 转封装无输出（少见，可能不是标准 H.264/AAC）→ 回退 TS
        }

        // —— 回退：转封装库不可用或无输出 → 仍保存为 TS ——
        const parts = [];
        for (let i = 0; i < total; i++) {
            if (signal.aborted) throw new Error('已取消');
            let buf = await fetchBuffer(segments[i], signal);
            if (cryptoKey) buf = (await decryptSeg(buf, cryptoKey, explicitIv || seqToIv(mediaSeq + i))).buffer;
            parts.push(new Uint8Array(buf));
            setProgress(i + 1, total);
        }
        saveBlob(parts, 'video/mp2t', filename + '.ts');
        if (global.showToast) global.showToast('已保存为 TS（无法转 MP4，可用 VLC 播放）', 'warning');
    }

    let busy = false;
    async function start() {
        if (busy) return;
        const m3u8 = currentEpisodeUrl();
        if (!m3u8 || !/^https?:\/\//i.test(m3u8)) {
            global.showToast && global.showToast('未找到可下载的视频地址', 'error');
            return;
        }
        if (!global.confirm('将把整集分片下载并无损封装为 MP4（不重新编码），可能消耗较多流量与内存。是否继续？')) return;

        busy = true;
        aborter = new AbortController();
        const signal = aborter.signal;
        showProgress();
        try {
            await downloadOne(m3u8, currentTitle(), signal);
            global.showToast && global.showToast('下载完成（MP4）', 'success');
        } catch (e) {
            if (!signal.aborted) {
                console.warn('[Downloader]', e);
                global.showToast && global.showToast('下载失败：' + (e && e.message || '未知错误'), 'error');
            } else {
                global.showToast && global.showToast('已取消下载', 'info');
            }
        } finally {
            busy = false; aborter = null; closeProgress();
        }
    }

    // 整季：逐集顺序下载，每集一个 .ts 文件
    async function startSeason() {
        if (busy) return;
        let list = [];
        try { list = Array.isArray(currentEpisodes) ? currentEpisodes.slice() : []; } catch (e) {}
        list = list.filter((u) => /^https?:\/\//i.test(u));
        if (!list.length) {
            global.showToast && global.showToast('未找到可下载的剧集列表', 'error');
            return;
        }
        if (!global.confirm(`将顺序下载整季共 ${list.length} 集，每集封装为一个 MP4。浏览器可能弹出多文件下载许可，且耗时较长。是否继续？`)) return;

        busy = true;
        aborter = new AbortController();
        const signal = aborter.signal;
        showProgress();
        let ok = 0, fail = 0;
        try {
            for (let i = 0; i < list.length; i++) {
                if (signal.aborted) break;
                if (ui) ui.title.textContent = `下载整季 第 ${i + 1}/${list.length} 集`;
                try {
                    await downloadOne(list[i], episodeFilename(i), signal);
                    ok++;
                } catch (e) {
                    if (signal.aborted) break;
                    console.warn('[Downloader] 第' + (i + 1) + '集失败:', e);
                    fail++;
                }
            }
            global.showToast && global.showToast(`整季下载结束：成功 ${ok} 集，失败 ${fail} 集`, fail ? 'warning' : 'success');
        } finally {
            busy = false; aborter = null; closeProgress();
        }
    }

    // 在 ArtPlayer 控制栏添加下载按钮（下拉：本集 / 整季）
    function setup(art) {
        if (!art || !art.controls || typeof art.controls.add !== 'function') return;
        const icon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        try {
            art.controls.add({
                name: 'lt-download',
                position: 'right',
                html: icon,
                tooltip: '下载',
                selector: [
                    { html: '下载本集', value: 'one' },
                    { html: '下载整季', value: 'season' },
                ],
                onSelect: function (item) {
                    if (item.value === 'season') startSeason(); else start();
                    return icon; // 控件保持图标
                },
            });
        } catch (e) {
            // 退化为单击下载本集
            try {
                art.controls.add({
                    name: 'lt-download', position: 'right', tooltip: '下载本集',
                    html: icon, click: function () { start(); },
                });
            } catch (e2) { console.warn('[Downloader] 添加控件失败:', e2 && e2.message); }
        }
    }

    global.LTDownloader = { setup, start, startSeason };
})(window);
