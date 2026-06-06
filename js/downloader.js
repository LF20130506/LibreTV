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

    function currentTitle() {
        const t = (document.getElementById('videoTitle') || {}).textContent || '视频';
        let idx = 0;
        try { idx = (currentEpisodeIndex | 0) + 1; } catch (e) { idx = 1; }
        const name = `${t}_第${idx}集`.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
        return name;
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

    async function fetchText(absUrl, signal) {
        const res = await fetch(proxied(absUrl), { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    }
    async function fetchBuffer(absUrl, signal) {
        const res = await fetch(proxied(absUrl), { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
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

    let busy = false;
    async function start() {
        if (busy) return;
        const m3u8 = currentEpisodeUrl();
        if (!m3u8 || !/^https?:\/\//i.test(m3u8)) {
            global.showToast && global.showToast('未找到可下载的视频地址', 'error');
            return;
        }
        if (!global.confirm('下载会把整集分片合并为单个文件，可能消耗较多流量与内存。是否继续？')) return;

        busy = true;
        aborter = new AbortController();
        const signal = aborter.signal;
        showProgress();
        try {
            // 1) 取播放列表（可能是 master）
            let baseAbs = m3u8;
            let text = await fetchText(baseAbs, signal);
            if (text.includes('#EXT-X-STREAM-INF')) {
                // master：选最高带宽变体
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
                if (best) {
                    baseAbs = toOriginalAbs(best, baseAbs);
                    text = await fetchText(baseAbs, signal);
                }
            }

            // 2) 解析媒体列表
            const { segments, key, mapAbs, mediaSeq } = parseMedia(text, baseAbs);
            if (!segments.length) throw new Error('未解析到任何分片');
            if (key && key.method !== 'AES-128') {
                throw new Error(`暂不支持的加密方式：${key.method}`);
            }

            // 3) 准备解密
            let cryptoKey = null, explicitIv = null;
            if (key) {
                const keyBuf = await fetchBuffer(key.uri, signal);
                cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
                if (key.ivHex) explicitIv = hexToBytes(key.ivHex);
            }

            // 4) 逐分片下载（含 init 段）
            const parts = [];
            if (mapAbs) parts.push(new Uint8Array(await fetchBuffer(mapAbs, signal)));

            const total = segments.length;
            for (let i = 0; i < total; i++) {
                if (signal.aborted) throw new Error('已取消');
                let buf = await fetchBuffer(segments[i], signal);
                if (cryptoKey) {
                    const iv = explicitIv || seqToIv(mediaSeq + i);
                    buf = (await decryptSeg(buf, cryptoKey, iv)).buffer;
                }
                parts.push(new Uint8Array(buf));
                setProgress(i + 1, total);
            }

            // 5) 合并并触发下载
            if (ui) ui.title.textContent = '合并并保存…';
            const blob = new Blob(parts, { type: 'video/mp2t' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = currentTitle() + '.ts';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
            global.showToast && global.showToast('下载完成', 'success');
        } catch (e) {
            if (!signal.aborted) {
                console.warn('[Downloader]', e);
                global.showToast && global.showToast('下载失败：' + (e && e.message || '未知错误'), 'error');
            } else {
                global.showToast && global.showToast('已取消下载', 'info');
            }
        } finally {
            busy = false;
            aborter = null;
            closeProgress();
        }
    }

    // 在 ArtPlayer 控制栏添加下载按钮
    function setup(art) {
        if (!art || !art.controls || typeof art.controls.add !== 'function') return;
        try {
            art.controls.add({
                name: 'lt-download',
                position: 'right',
                tooltip: '下载本集',
                html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
                click: function () { start(); },
            });
        } catch (e) {
            console.warn('[Downloader] 添加控件失败:', e && e.message);
        }
    }

    global.LTDownloader = { setup, start };
})(window);
