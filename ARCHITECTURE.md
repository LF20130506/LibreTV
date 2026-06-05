# LibreTV 架构设计文档（重构方案）

> 本文给出 LibreTV 的**目标架构**与**分层设计**，并标注每个模块的现状、问题与改造方向。
> 第一阶段（安全代理核心）已落地实现，见「七、已实现部分」。

## 一、总体架构

LibreTV 是「**纯静态前端 + 边缘/Node 反向代理**」的影视聚合应用，无数据库、无用户系统，
所有用户数据存于浏览器 `localStorage`。

```
┌──────────────────────────────────────────────────────────────┐
│                          浏览器（Client）                       │
│  index.html / player.html                                      │
│  ├─ js/config.js      全局配置 / 数据源清单                       │
│  ├─ js/password.js    客户端密码校验（+ 服务端会话登录）           │
│  ├─ js/api.js         fetch 拦截器：/api/search /api/detail      │
│  ├─ js/app.js         搜索流程 / 结果渲染 / 设置                  │
│  ├─ js/player.js      ArtPlayer + HLS.js 播放、连播、广告过滤      │
│  ├─ js/douban.js      豆瓣热门榜单                               │
│  └─ js/utils/*.js     工具层（XSS 转义等）★新增                   │
└───────────────┬──────────────────────────────────────────────┘
                │  /api/* （前端内拦截，不出网）
                │  /proxy/<url>  ← 视频流 / 详情页 HTML 经此出网
                ▼
┌──────────────────────────────────────────────────────────────┐
│                    服务端 / 边缘（三选一部署）                    │
│  A. Node:   server.mjs        ── lib/proxy-core.mjs（共享核心）  │
│  B. CF:     functions/proxy   ── Pages Functions（Workers 运行时）│
│  C. Vercel: api/proxy         ── Serverless/Edge Functions       │
│  D. Netlify:netlify/functions ── + edge-functions/inject-env     │
│                                                                │
│  共享安全层 lib/：security(SSRF) · auth(会话) · rate-limit · proxy-core │
└───────────────┬──────────────────────────────────────────────┘
                │ 出站（已做 SSRF 校验 + 禁止重定向）
                ▼
        第三方 CMS V10 采集站 API / m3u8 源站
```

## 二、分层与目录设计

| 层 | 目录/文件 | 职责 | 现状 → 目标 |
|---|---|---|---|
| 配置层 | `js/config.js` | 数据源、播放器、安全常量 | 硬编码 → 拆 `sources.js` + 运行时健康检查 |
| 视图层 | `*.html` + `css/` | 页面结构与样式 | Tailwind CDN 运行时 → 构建期 PurgeCSS |
| 交互层 | `js/app.js`/`ui.js` | 搜索、渲染、设置 | 巨型文件 → 按域拆 ES 模块 |
| 播放层 | `js/player.js` | 播放/连播/广告过滤 | 保留，抽离广告过滤为独立模块 |
| 数据访问层 | `js/api.js` | 拼装并请求采集站 | 保留，统一错误模型 |
| **安全/代理核心** | `lib/` | SSRF、会话、限流、代理 | ★本次新增，三端共享 |
| 服务入口 | `server.mjs` / `functions/` / `api/` | 平台适配 | 去重，薄封装共享核心 |
| 测试 | `test/` | 纯逻辑单测（node:test） | ★本次新增 |

## 三、关键数据流

### 3.1 搜索
`app.js` → `fetch('/api/search?wd=..&source=..')` → **被 `api.js` 拦截器接管**
→ 拼出采集站 URL → `fetch('/proxy/'+encodeURIComponent(apiUrl))` → 服务端代理出网
→ 归一化为 `{code,list[]}` → `app.js` 渲染（**经 `LTSecurity.escapeHtml` 转义**）。

### 3.2 播放
`player.js` 用 HLS.js 加载 m3u8；每个分片 URL 重写为 `/proxy/<segment>`，
服务端代理回源；广告过滤在 m3u8 文本层移除可疑分片。

### 3.3 鉴权（重构后）
1. 前端登录框提交密码 → `POST /api/login`；
2. 服务端比对 `sha256(密码)` 与注入的哈希，成功则签发 **HttpOnly 会话 Cookie**（HMAC 签名 + 过期戳）；
3. 之后所有 `/proxy/*`（含 HLS 分片，浏览器自动带 Cookie）在服务端校验会话；
4. 开关 `PROXY_AUTH=true` 控制，默认关闭以保证向后兼容。

> 这解决了原设计「密码仅前端校验、`/proxy` 完全开放」导致的**开放代理滥用**问题。

## 四、安全设计（核心改造）

| 风险 | 原实现 | 新设计 |
|---|---|---|
| SSRF | 仅按 `192.168./10./172.` 前缀字符串匹配，可被 DNS/302 绕过；且误杀公网 172.x | `lib/security.mjs`：**DNS 解析后用 `net.BlockList` 按 CIDR 判定**，覆盖 v4/v6 私有·回环·链路本地·CGNAT·云元数据；axios `maxRedirects:0` 拦截重定向升级 |
| 开放代理 | `/proxy` 无鉴权 | `lib/auth.mjs` HMAC 会话 + `PROXY_AUTH` 开关 |
| 刷流量 | 无限流 | `lib/rate-limit.mjs` 内存滑动窗口（单实例）/ 平台原生限流（Serverless） |
| XSS | 第三方字段直插 `innerHTML` | `js/utils/security.js` 的 `escapeHtml/sanitizeUrl/setText` |
| 敏感头透传 | 散落字符串 | `filterResponseHeaders` 统一 + 默认清单 |
| CORS | 恒 `*` | 可配 `CORS_ORIGIN`，带凭证时不用 `*` |

## 五、性能设计（后续阶段）

1. **Tailwind 构建化**：`tailwind.config.js` + PostCSS，`content` 扫描 → 产出精简 CSS，移除 407KB 运行时 CDN。
2. **静态资源指纹 + 长缓存**；HTML 不缓存（含动态注入哈希）。
3. **代理短 TTL 缓存**：搜索类响应在内存/KV 缓存数十秒，降源站压力。
4. **聚合搜索熔断**：`maxResults` 收敛至 ~200，单源失败快速降级。
5. **大文件拆分**：`app.js` 按 search/render/settings 拆 ES 模块，按需加载。

## 六、工程化设计（后续阶段）

- **代码共享**：Node 端三入口统一走 `lib/proxy-core.mjs`；Edge 端因运行时差异，
  共享纯逻辑 `lib/security.mjs` 的 `validateUrlSyntax`（不依赖 `node:dns` 的部分）。
- **质量门禁**：ESLint + Prettier + Husky pre-commit；GitHub Actions 跑 `npm test`。
- **测试**：`node:test` 零依赖，先覆盖安全逻辑，再逐步覆盖解析/去重。
- **版本统一**：以 `package.json` 为单一来源，构建注入，废除 `config.js` 手填版本。

## 七、已实现部分（第一阶段：安全代理核心）

```
lib/
├── security.mjs     SSRF 校验（DNS+CIDR）、响应头过滤   ← 11 项单测覆盖
├── auth.mjs         HMAC 会话令牌签发/校验、Cookie 读写
├── rate-limit.mjs   零依赖内存滑动窗口限流中间件
└── proxy-core.mjs   Express 代理核心（整合 SSRF + 重定向防护 + 头过滤）
js/utils/security.js XSS 转义工具（window.LTSecurity）
test/security.test.mjs  node:test 单测（npm test）
server.mjs           重构：复用 lib/*，新增 /api/login、PROXY_AUTH、限流（均向后兼容）
```

**新增环境变量**（见 `.env.example`）：`PROXY_AUTH`、`SESSION_TTL_MS`、`SESSION_SECRET`、`RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW_MS`。

**验证**：`npm test` 全绿（11/11）；本地对 SSRF（云元数据/localhost/私有段/file://）、
登录签发 Cookie、`PROXY_AUTH` 门禁均已 curl 冒烟通过。

## 八、向后兼容与迁移

- 所有新行为默认**关闭**（`PROXY_AUTH=false`、`RATE_LIMIT_MAX=0`），现有部署零改动即可运行。
- SSRF 校验默认生效（这是修复而非破坏：原本也会拒绝内网，只是更严谨）。
- 前端启用服务端鉴权时，仅需在登录成功回调中 `POST /api/login`（一行），HLS 分片自动携带 Cookie。

## 九、路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 安全代理核心（SSRF/会话/限流/XSS 工具/测试） | ✅ 已实现 |
| P1 | 三端代理去重、版本统一、ESLint/CI | ⬜ |
| P2 | Tailwind 构建化、大文件拆分、代理缓存 | ⬜ |
| P3 | 数据源健康检查、收藏/历史、字幕/PiP | ⬜ |
| P4 | PWA 完善、i18n、主题切换、文档 | ⬜ |
