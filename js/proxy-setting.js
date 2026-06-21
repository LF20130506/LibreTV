// js/proxy-setting.js
// 自定义 HTTP 代理基址设置：把搜索/详情等 API 请求改走自建的 /proxy/ 服务
//（换区域/节点）。留空恢复默认同源 '/proxy/'。保存后刷新生效。
// 注意：只影响 API 请求，不重路由视频分片（分片由播放器直连）。
(function (global) {
    const KEY = 'customProxyUrl';

    function getCustomProxy() {
        try { return (localStorage.getItem(KEY) || '').trim(); } catch (e) { return ''; }
    }

    // 规范化并校验：必须 http(s):// 开头，自动补尾斜杠；空字符串表示清除
    function normalize(v) {
        v = (v || '').trim();
        if (!v) return '';
        if (!/^https?:\/\//i.test(v)) return null; // 非法
        return v.endsWith('/') ? v : v + '/';
    }

    function saveProxySetting() {
        const input = document.getElementById('customProxyInput');
        const toast = (typeof global.showToast === 'function') ? global.showToast : function () {};
        const T = (typeof global.t === 'function') ? global.t : function (k) { return k; };
        const raw = input ? input.value : '';
        if (raw.trim() === '') {
            try { localStorage.removeItem(KEY); } catch (e) {}
            toast(T('toast.proxyReset'), 'info');
            return;
        }
        const norm = normalize(raw);
        if (norm === null) {
            toast(T('toast.proxyInvalid'), 'warning');
            return;
        }
        try { localStorage.setItem(KEY, norm); } catch (e) {}
        if (input) input.value = norm;
        toast(T('toast.proxySaved'), 'success');
    }

    document.addEventListener('DOMContentLoaded', function () {
        const input = document.getElementById('customProxyInput');
        if (input) input.value = getCustomProxy();
    });

    global.saveProxySetting = saveProxySetting;
    global.getCustomProxy = getCustomProxy;
})(window);
