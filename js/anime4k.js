// js/anime4k.js
// Anime4K 风格的 WebGL2 实时画质增强（面向动画）。
// 原理：把 <video> 当前帧作为纹理，在 GPU 上运行「邻域钳制锐化 + 线条加深」着色器，
// 渲染到覆盖在视频上方的 canvas。
//   · 钳制(clamp 到邻域 min/max) 从根本上消除过冲 → 无白边/光晕（解决卷积锐化的通病）
//   · 线条加深只会变暗、不会变亮 → 不产生白边
// 全程容错：WebGL2 不可用 / 视频跨域污染 / 着色器编译失败 → 返回 false 由调用方回退。

(function (global) {
    // 强度档位。mode: 0 = Anime4K(动画线条增强)；1 = 双边降噪(实拍/老片去色块)；
    //          2 = CAS 输出分辨率锐化(实拍超清，提升清晰度，无白边)。
    // 注意：mode 1 下 sharp 语义为「降噪强度」；mode 2 下 sharp 为 CAS 锐度(0~1)。
    const PROFILES = {
        a4k:          { mode: 0, sharp: 0.85, line: 0.30 },
        a4k_strong:   { mode: 0, sharp: 1.45, line: 0.50 },
        sr:           { mode: 1, sharp: 0.50, line: 0.0 }, // 老片降噪（中等）
        sr_strong:    { mode: 1, sharp: 0.85, line: 0.0 }, // 降噪 强（老片噪点重时）
        clear:        { mode: 2, sharp: 0.45, line: 0.0 }, // 实拍超清（中等清晰）
        clear_strong: { mode: 2, sharp: 0.75, line: 0.0 }, // 超清 强
    };

    const VERT = `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main(){
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

    const FRAG = `#version 300 es
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uTexel;    // 1.0 / 源纹理尺寸（mode 0/1 邻域间距）
    uniform vec2 uTexelOut; // 1.0 / 输出尺寸（mode 2 在放大后的像素上锐化）
    uniform float uSharp;   // mode0:锐化  mode1:降噪  mode2:CAS锐度
    uniform float uLine;    // 线条加深强度
    uniform int uMode;      // 0=Anime4K, 1=双边降噪, 2=CAS输出锐化(实拍超清)
    in vec2 vUv;
    out vec4 frag;
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main(){
        vec3 c  = texture(uTex, vUv).rgb;

        if (uMode == 2) {
            // ===== 实拍超清：CAS 对比度自适应锐化，邻域取「输出像素间距」=====
            // 在 bilinear 放大后的边缘梯度上锐化 → 真正变清晰；钳制 min/max → 无白边。
            vec2 t = uTexelOut;
            vec3 cn = texture(uTex, vUv + vec2(0.0, -t.y)).rgb;
            vec3 cs = texture(uTex, vUv + vec2(0.0,  t.y)).rgb;
            vec3 ce = texture(uTex, vUv + vec2( t.x, 0.0)).rgb;
            vec3 cw = texture(uTex, vUv + vec2(-t.x, 0.0)).rgb;
            vec3 cne= texture(uTex, vUv + vec2( t.x, -t.y)).rgb;
            vec3 cnw= texture(uTex, vUv + vec2(-t.x, -t.y)).rgb;
            vec3 cse= texture(uTex, vUv + vec2( t.x,  t.y)).rgb;
            vec3 csw= texture(uTex, vUv + vec2(-t.x,  t.y)).rgb;
            vec3 mnc = min(min(min(cn, cs), min(ce, cw)), c);
            mnc = min(mnc, min(min(cne, cnw), min(cse, csw)));
            vec3 mxc = max(max(max(cn, cs), max(ce, cw)), c);
            mxc = max(mxc, max(max(cne, cnw), max(cse, csw)));
            vec3 amp = sqrt(clamp(min(mnc, 1.0 - mxc) / max(mxc, 1e-4), 0.0, 1.0));
            float peak = -1.0 / mix(8.0, 5.0, clamp(uSharp, 0.0, 1.0));
            vec3 wgt = amp * peak;
            vec3 outC = (c + (cn + cs + ce + cw) * wgt) / (1.0 + 4.0 * wgt);
            frag = vec4(clamp(outC, 0.0, 1.0), 1.0);
            return;
        }

        vec3 n  = texture(uTex, vUv + vec2(0.0, -uTexel.y)).rgb;
        vec3 s  = texture(uTex, vUv + vec2(0.0,  uTexel.y)).rgb;
        vec3 e  = texture(uTex, vUv + vec2( uTexel.x, 0.0)).rgb;
        vec3 w  = texture(uTex, vUv + vec2(-uTexel.x, 0.0)).rgb;
        vec3 ne = texture(uTex, vUv + vec2( uTexel.x, -uTexel.y)).rgb;
        vec3 nw = texture(uTex, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
        vec3 se = texture(uTex, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
        vec3 sw = texture(uTex, vUv + vec2(-uTexel.x,  uTexel.y)).rgb;

        if (uMode == 1) {
            // ===== 双边降噪：去压缩色块/噪点，边缘保持，不锐化（适合实拍/老片）=====
            // 邻居按颜色相似度加权平均：平坦区被抚平，颜色差大的边缘权重低→保留不糊。
            float sigma = max(0.03, uSharp * 0.22); // 颜色相似带宽，uSharp 越大去噪越强
            float k = 1.0 / (2.0 * sigma * sigma);
            vec3 nb[8];
            nb[0]=n; nb[1]=s; nb[2]=e; nb[3]=w; nb[4]=ne; nb[5]=nw; nb[6]=se; nb[7]=sw;
            vec3 sum = c;       // 中心权重 1
            float wsum = 1.0;
            for (int i = 0; i < 8; i++) {
                vec3 d = nb[i] - c;
                float wgt = exp(-dot(d, d) * k);
                sum += nb[i] * wgt;
                wsum += wgt;
            }
            frag = vec4(clamp(sum / wsum, 0.0, 1.0), 1.0);
            return;
        }

        // ===== Anime4K：钳制锐化 + 线条加深（适合动画）=====
        float lc = luma(c);
        float ln = luma(n),  ls = luma(s),  le = luma(e),  lw = luma(w);
        float lne= luma(ne), lnw= luma(nw), lse= luma(se), lsw= luma(sw);

        // 邻域 8 点的均值（模糊）与 min/max
        float blur = (ln+ls+le+lw+lne+lnw+lse+lsw) * 0.125;
        float mn = min(min(min(ln,ls),min(le,lw)), min(min(lne,lnw),min(lse,lsw)));
        float mx = max(max(max(ln,ls),max(le,lw)), max(max(lne,lnw),max(lse,lsw)));
        mn = min(mn, lc); mx = max(mx, lc);

        // 钳制式 USM 锐化：把结果限制在邻域 min/max 内 → 无过冲、无白边
        float detail = lc - blur;
        float sharp = clamp(lc + uSharp * detail, mn, mx);

        // 线条加深：在高对比边缘处把亮度往邻域最暗拉（只变暗）；混合系数钳到[0,1]防过冲
        float edge = clamp((mx - mn) * 2.0, 0.0, 1.0);
        float outL = mix(sharp, min(sharp, mn), clamp(uLine * edge, 0.0, 1.0));

        // 把亮度变化按比例施加到颜色上，保持色相
        float ratio = outL / max(lc, 1e-4);
        frag = vec4(clamp(c * ratio, 0.0, 1.0), 1.0);
    }`;

    let gl = null, canvas = null, program = null, vao = null, tex = null;
    let uTexel, uTexelOut, uSharp, uLine, uMode;
    let rafId = 0, rvfcHandle = 0, running = false;
    let videoEl = null, profile = PROFILES.a4k;
    let resizeObs = null;
    let strengthMult = 1.0; // 强度微调倍率（用户滑块）
    let outputHeight = 0, outputWidth = 0;
    let targetSetting = 'auto'; // 'auto'(<1440→1440) | 0(源) | 数字(目标高度)

    /** 设置输出分辨率目标：'auto' | 0(源画质) | 具体高度(如 1440/2160) */
    function setTarget(t) {
        if (t === 'auto') targetSetting = 'auto';
        else { const n = parseInt(t, 10) || 0; targetSetting = n > 0 ? Math.min(4320, n) : 0; }
    }

    /** 设置强度倍率（0.3~1.8），实时生效 */
    function setStrength(mult) {
        const m = Math.max(0.2, Math.min(2.0, Number(mult) || 1.0));
        strengthMult = m;
    }

    function compile(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            throw new Error('shader: ' + gl.getShaderInfoLog(sh));
        }
        return sh;
    }

    function initGL() {
        canvas = document.createElement('canvas');
        canvas.className = 'anime4k-canvas';
        canvas.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
            'pointer-events:none;z-index:11;';
        gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, antialias: false });
        if (!gl) throw new Error('WebGL2 不可用');

        // WebGL 上下文丢失(GPU 复位/长时间后台)时优雅降级：停渲染、清掉旧资源，
        // 下次 enable() 会重建上下文；视频本身始终在底层正常播放，不会卡死黑屏。
        canvas.addEventListener('webglcontextlost', function (e) {
            e.preventDefault();
            disable();
            try { if (resizeObs) resizeObs.disconnect(); } catch (_) {}
            try { if (canvas && canvas.parentElement) canvas.parentElement.removeChild(canvas); } catch (_) {}
            gl = null; canvas = null; program = null; vao = null; tex = null; resizeObs = null;
        }, false);

        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, FRAG);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.bindAttribLocation(program, 0, 'aPos');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('program: ' + gl.getProgramInfoLog(program));
        }
        gl.useProgram(program);
        uTexel = gl.getUniformLocation(program, 'uTexel');
        uTexelOut = gl.getUniformLocation(program, 'uTexelOut');
        uSharp = gl.getUniformLocation(program, 'uSharp');
        uLine = gl.getUniformLocation(program, 'uLine');
        uMode = gl.getUniformLocation(program, 'uMode');
        gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);

        // 全屏三角形
        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }

    // 设备实际可显示的像素高度上限（播放区高度 × devicePixelRatio）。
    // 超过这个就是白渲染——屏幕显示不出更多像素，只会徒增 GPU 负载。
    function deviceCapHeight() {
        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        let cssH = 0;
        if (canvas && canvas.clientHeight) cssH = canvas.clientHeight;
        if (!cssH && videoEl && videoEl.clientHeight) cssH = videoEl.clientHeight;
        if (!cssH) cssH = (window.screen && window.screen.height) || 1080;
        return Math.round(cssH * dpr);
    }

    // 高性能设备(iPhone/iPad 的 A 系列芯片等)：GPU 很强，不必为省电而限制分辨率，
    // 直接榨干性能做超采样(渲染到更高分辨率再缩放)，画面更锐。
    function isHighEndDevice() {
        try {
            const ua = navigator.userAgent || '';
            return /iPad|iPhone|iPod/.test(ua) ||
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 桌面 UA
        } catch (e) { return false; }
    }

    // 计算增强输出尺寸。
    //  · target='auto'：低于 1440p 的源上采样到 1440p。一般设备按可显示像素封顶省 GPU；
    //    高性能设备(iOS A 系列)跳过封顶、榨干性能做超采样，仅留 2160 安全上限。
    //  · target=0（源画质）：用源高度。
    //  · target=数字（用户显式选 1440P/4K）：尊重用户选择，渲染到该分辨率（超采样更锐，
    //    再由浏览器缩放到屏幕），不按屏幕封顶——否则手机上选 4K 会被悄悄降回 ~1080p，
    //    用户会觉得"增强到 2K/4K 没生效"。仅做 2160 的安全上限防止极端负载。
    function computeOutput(sw, sh) {
        if (!sw || !sh) return [0, 0];
        let th;
        if (targetSetting === 'auto') {
            th = sh < 1440 ? 1440 : sh;
            if (!isHighEndDevice()) {                          // 高性能设备(iOS)不省 GPU、跳过封顶
                const cap = deviceCapHeight();
                if (cap > 0) th = Math.min(th, Math.max(sh, cap));
            }
            th = Math.min(th, 2160);                           // 安全上限 4K
        } else if (targetSetting === 0) {
            th = sh;
        } else {
            th = Math.min(2160, Math.max(144, targetSetting)); // 显式目标：尊重选择，不按屏幕封顶
        }
        const scale = th / sh;
        return [Math.max(1, Math.round(sw * scale)), th];
    }

    function syncSize() {
        if (!videoEl) return;
        const sw = videoEl.videoWidth || 0;
        const sh = videoEl.videoHeight || 0;
        if (!sw || !sh) return;
        const [ow, oh] = computeOutput(sw, sh);
        if (canvas.width !== ow || canvas.height !== oh) {
            canvas.width = ow;
            canvas.height = oh;
            gl.viewport(0, 0, ow, oh);
            outputHeight = oh;
            outputWidth = ow;
            // uTexel 基于源尺寸（mode 0/1）；uTexelOut 基于输出尺寸（mode 2 在放大后锐化）
            gl.uniform2f(uTexel, 1.0 / sw, 1.0 / sh);
            gl.uniform2f(uTexelOut, 1.0 / ow, 1.0 / oh);
        }
    }

    /** 增强后的输出分辨率（未运行返回 0） */
    function getOutputHeight() { return running ? outputHeight : 0; }
    function getOutputWidth() { return running ? outputWidth : 0; }

    function renderFrame() {
        if (!running || !videoEl) return;
        try {
            if (videoEl.readyState >= 2 && videoEl.videoWidth) {
                syncSize();
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                // 可能抛 SecurityError（视频被跨域污染）→ 由外层 catch 关闭
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
                // mode 1(降噪)/2(CAS) 的 sharp 取值有限，用倍率时做钳制；mode 0 可超过 1
                gl.uniform1f(uSharp, profile.mode === 0
                    ? profile.sharp * strengthMult
                    : Math.min(profile.mode === 2 ? 0.98 : 1.2, profile.sharp * strengthMult));
                gl.uniform1f(uLine, profile.line * strengthMult);
                gl.uniform1i(uMode, profile.mode | 0);
                gl.bindVertexArray(vao);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
        } catch (e) {
            console.warn('[Anime4K] 渲染失败，已关闭:', e && e.message);
            disable();
            return;
        }
        scheduleNext();
    }

    function scheduleNext() {
        if (!running) return;
        if (videoEl.requestVideoFrameCallback) {
            rvfcHandle = videoEl.requestVideoFrameCallback(renderFrame);
        } else {
            rafId = requestAnimationFrame(renderFrame);
        }
    }

    /**
     * 启用 Anime4K。幂等：重复调用只更新强度。
     * @param {object} art ArtPlayer 实例
     * @param {string} profileKey 'a4k' | 'a4k_strong'
     * @returns {boolean} 是否成功启用
     */
    function enable(art, profileKey) {
        profile = PROFILES[profileKey] || PROFILES.a4k;
        if (!art || !art.video) return false;
        try {
            if (!gl) initGL();
            if (running && videoEl === art.video) return true; // 已在运行

            videoEl = art.video;
            const parent = videoEl.parentElement;
            if (parent && !canvas.parentElement) {
                if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
                parent.appendChild(canvas);
            }
            // 监听容器尺寸变化（全屏/旋屏）
            if (!resizeObs && global.ResizeObserver) {
                resizeObs = new ResizeObserver(() => syncSize());
                resizeObs.observe(parent || canvas);
            }
            running = true;
            canvas.style.display = 'block';
            scheduleNext();
            return true;
        } catch (e) {
            console.warn('[Anime4K] 初始化失败，回退普通播放:', e && e.message);
            disable();
            return false;
        }
    }

    /** 关闭 Anime4K，移除覆盖层（视频本身始终在底层正常播放）。 */
    function disable() {
        running = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        if (rvfcHandle && videoEl && videoEl.cancelVideoFrameCallback) {
            try { videoEl.cancelVideoFrameCallback(rvfcHandle); } catch (e) {}
        }
        rvfcHandle = 0;
        if (canvas) canvas.style.display = 'none';
    }

    function isRunning() { return running; }

    global.Anime4K = { enable, disable, isRunning, setStrength, setTarget, getOutputHeight, getOutputWidth };
})(window);
