// js/utils/security.js
// 前端 XSS 防护工具：对来自第三方采集 API 的字段做 HTML 转义后再注入 DOM。
// 用法：import 不可用（项目为传统 <script>），通过 window.LTSecurity 暴露。

(function (global) {
  const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
  };

  /**
   * 转义 HTML 特殊字符，防止反射/存储型 XSS。
   * @param {unknown} value
   * @returns {string}
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ENTITIES[ch]);
  }

  /**
   * 转义并去除可疑协议（javascript:, data: 等）的 URL，用于 href/src。
   * @param {unknown} value
   * @returns {string}
   */
  function sanitizeUrl(value) {
    const raw = String(value ?? '').trim();
    if (/^(javascript|data|vbscript):/i.test(raw)) return '';
    return escapeHtml(raw);
  }

  /**
   * 安全地设置元素文本（等价于 textContent，但允许传入 null/undefined）。
   * @param {Element} el
   * @param {unknown} value
   */
  function setText(el, value) {
    if (el) el.textContent = value === null || value === undefined ? '' : String(value);
  }

  global.LTSecurity = { escapeHtml, sanitizeUrl, setText };
})(window);
