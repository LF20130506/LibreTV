// js/anime4k.js
// Anime4K 风格的 WebGL2 实时画质增强（面向动画）。
// 原理：把 <video> 当前帧作为纹理，在 GPU 上运行「邻域钳制锐化 + 线条加深」着色器，
// 渲染到覆盖在视频上方的 canvas。
//   · 钳制(clamp 到邻域 min/max) 从根本上消除过冲 → 无白边/光晕（解决卷积锐化的通病）
//   · 线条加深只会变暗、不会变亮 → 不产生白边
// 全程容错：WebGL2 不可用 / 视频跨域污染 / 着色器编译失败 → 返回 false 由调用方回退。

(function (global) {
    // 强度档位。mode: 0 = Anime4K(动画线条增强)，1 = CAS(实拍自适应锐化/超分)
    const PROFILES = {
        a4k:        { mode: 0, sharp: 0.85, line: 0.30 },
        a4k_strong: { mode: 0, sharp: 1.45, line: 0.50 },
        sr:         { mode: 1, sharp: 0.62, line: 0.0 },
        sr_strong:  { mode: 1, sharp: 0.88, line: 0.0 },
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
    uniform vec2 uTexel;   // 1.0 / 纹理尺寸
    uniform float uSharp;  // 锐化强度
    uniform float uLine;   // 线条加深强度
    uniform int uMode;     // 0=Anime4K, 1=CAS(实拍超分)
    in vec2 vUv;
    out vec4 frag;
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main(){
        vec3 c  = texture(uTex, vUv).rgb;
        vec3 n  = texture(uTex, vUv + vec2(0.0, -uTexel.y)).rgb;
        vec3 s  = texture(uTex, vUv + vec2(0.0,  uTexel.y)).rgb;
        vec3 e  = texture(uTex, vUv + vec2( uTexel.x, 0.0)).rgb;
        vec3 w  = texture(uTex, vUv + vec2(-uTexel.x, 0.0)).rgb;
        vec3 ne = texture(uTex, vUv + vec2( uTexel.x, -uTexel.y)).rgb;
        vec3 nw = texture(uTex, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
        vec3 se = texture(uTex, vUv + vec2( uTexel.x,  uTexel.y)).rgb;
        vec3 sw = texture(uTex, vUv + vec2(-uTexel.x,  uTexel.y)).rgb;

        if (uMode == 1) {
            // ===== CAS：对比度自适应锐化（适合实拍/纪录片，无线条加深、无白边）=====
            vec3 mnc = min(min(min(n, s), min(e, w)), c);
            mnc = min(mnc, min(min(ne, nw), min(se, sw)));
            vec3 mxc = max(max(max(n, s), max(e, w)), c);
            mxc = max(mxc, max(max(ne, nw), max(se, sw)));
            // 自适应权重：亮部/暗部裕度小则少锐化，避免过冲
            vec3 amp = sqrt(clamp(min(mnc, 1.0 - mxc) / max(mxc, 1e-4), 0.0, 1.0));
            float peak = -1.0 / mix(8.0, 5.0, clamp(uSharp, 0.0, 1.0));
            vec3 wgt = amp * peak;
            vec3 outC = (c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
            frag = vec4(clamp(outC, 0.0, 1.0), 1.0);
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

        // 线条加深：在高对比边缘处把亮度往邻域最暗拉（只变暗）
        float edge = clamp((mx - mn) * 2.0, 0.0, 1.0);
        float outL = mix(sharp, min(sharp, mn), uLine * edge);

        // 把亮度变化按比例施加到颜色上，保持色相
        float ratio = outL / max(lc, 1e-4);
        frag = vec4(clamp(c * ratio, 0.0, 1.0), 1.0);
    }`;

    let gl = null, canvas = null, program = null, vao = null, tex = null;
    let uTexel, uSharp, uLine, uMode;
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

    // 计算增强输出尺寸。target='auto' 时低于 1440p 的源上采样到 1440p；
    // target=0 用源画质；target=数字 用指定高度（可上/降采样，由用户在「画质」中选择）。
    function computeOutput(sw, sh) {
        if (!sw || !sh) return [0, 0];
        let th;
        if (targetSetting === 'auto') th = sh < 1440 ? 1440 : sh;
        else if (targetSetting === 0) th = sh;
        else th = Math.max(144, targetSetting);
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
            // uTexel 基于源尺寸 → 锐化作用于真实源细节；纹理按源分辨率上传
            gl.uniform2f(uTexel, 1.0 / sw, 1.0 / sh);
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
                // CAS 的 sharp 取值范围有限(0~1)，用倍率时做钳制
                gl.uniform1f(uSharp, profile.mode === 1
                    ? Math.min(0.98, profile.sharp * strengthMult)
                    : profile.sharp * strengthMult);
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
