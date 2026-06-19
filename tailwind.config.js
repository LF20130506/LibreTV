/** Tailwind 构建配置（替代运行时 CDN）。
 *  扫描所有 HTML 与 js/*.js 中出现的类名，仅生成用到的 CSS。
 *  package.json 为 ESM，故用 export default。
 */
export default {
  content: ['./*.html', './js/**/*.js'],
  // 兜底：JS 里动态拼出的类（toast 颜色、onerror 切换的 object-*）确保不被裁剪
  safelist: [
    'bg-red-500', 'bg-green-500', 'bg-blue-500', 'bg-yellow-500',
    'object-contain', 'object-cover',
  ],
  theme: { extend: {} },
};
