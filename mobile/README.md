# LibreTV iOS 壳（Capacitor）

把已部署的 LibreTV 网站包成一个 iOS App（WKWebView 全屏加载你的站点）。
**为什么加载远程站点而不是本地打包？** LibreTV 依赖服务端的 `/proxy/`（视频/接口代理）和
`/api/`（历史云同步、密码注入）。把静态资源本地打进 App 会让这些服务端能力失效，
所以正确做法是壳里用 WebView 加载你部署好的站点。

---

## 先决条件
- macOS + Xcode（已安装命令行工具）
- 一个可访问的 LibreTV 部署地址（Cloudflare Pages / 自建 Node 等）
- Apple 开发者账号（真机调试/TestFlight 需要；模拟器不需要）
- Node.js（用来跑 Capacitor CLI）

## 步骤

```bash
cd mobile

# 1) 安装依赖（如版本过旧可换 @latest）
npm install
# 或： npm install @capacitor/core@latest @capacitor/ios@latest -S && npm install @capacitor/cli@latest -D

# 2) 改配置：把 capacitor.config.json 里的 server.url 改成你的站点
#    例如 "url": "https://tv.your-domain.com"
#    （可选）改 appId 为你自己的 Bundle ID，例如 com.yourname.libretv

# 3) 生成 iOS 工程并同步
npm run add:ios      # = npx cap add ios（首次）
npm run sync         # = npx cap sync ios（每次改配置/前端后）

# 4) 用 Xcode 打开
npm run open         # = npx cap open ios
```

在 Xcode 里：
1. 选中 **App** target → **Signing & Capabilities** → 选你的开发者 Team，设唯一 Bundle ID。
2. 选一台真机或模拟器 → **Run (⌘R)**。
3. 分发：**Product → Archive** → 上传 TestFlight，或导出 Ad-hoc 安装包。

## 改了什么会需要重新 `npm run sync`？
- 改 `capacitor.config.json`（尤其 `server.url`）
- 升级/新增 Capacitor 插件

> 由于壳是加载远程站点，**前端代码改动直接重新部署网站即可生效**，通常无需重打包 App。

## 图标 / 启动屏
- 用 [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)：把 `icon.png`(1024²) 和
  `splash.png`(2732²) 放到 `mobile/assets/`，运行 `npx @capacitor/assets generate --ios`，再 `npm run sync`。

## 关于 App Store 公开上架（务必知悉）
- **自用 / 真机 / TestFlight / Ad-hoc**：用你自己的开发者账号随便装、随便内测分发，没问题。
- **公开上架 App Store**：聚合第三方影视源的 App，审核大概率按 App Review Guidelines
  **5.2（知识产权）/ 1.x** 被拒。这是策略层面的现实，套壳并不能改变它。
  请把它当作**自用/内测**工具，不要指望公开上架。
