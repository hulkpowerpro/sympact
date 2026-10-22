# SYMPACT · 合约风险工作台（PWA）

这是一个**不需要付费平台或后端服务器**的静态渐进式 Web App 项目。它将已有 SYMPACT 工具打包为可安装应用：桌面端可以安装到应用菜单/桌面，Android 可以添加到主屏幕，iPhone/iPad 可从 Safari 添加到主屏幕。

## 功能与隐私

- 主要计算逻辑在浏览器本地运行。
- 仅请求网页中配置的公开行情接口；不连接交易账户，不下单。
- AiCoin 凭证（如果你主动填写）只保存在当前页面内存中；请勿输入交易/提现 API Key。
- Service Worker 只缓存 App 外壳、HTML 和图标；**不会缓存外部行情接口或 API 响应**。
- 离线时，应用外壳和计算表单在至少成功加载一次后仍可打开；实时价格与 ATR 自动更新需要网络。行情不可用时应使用页面提供的手动参考价格功能。

## 最容易的使用方式

### A. 在电脑上预览

- 将 ZIP 解压。
- Mac 可以双击 `在电脑上预览_SYMPACT.command`；Windows 可以在该文件夹打开终端运行 `python -m http.server 4173`，然后访问 `http://localhost:4173`。
- 也可直接双击 `index.html` 进行普通计算预览。但使用 `file://` 直接打开时，浏览器会禁止 PWA 安装与 Service Worker 离线缓存；这是浏览器安全规则，不是工具故障。

### B. 在电脑上安装

完整 PWA 安装需要从 `https://` 网站或电脑上的 `http://localhost` 打开。用最新版 Chrome 或 Edge 打开后，点击页面中的“安装到设备”，或从浏览器地址栏/菜单选择安装应用。

### C. 在手机上安装

手机要从一个可访问的 **HTTPS 网站地址** 打开；不能仅靠电脑本地的 HTML 文件直接安装到手机。发布后：

- Android：Chrome 打开网址，选择“安装应用”或“添加到主屏幕”。
- iPhone/iPad：Safari 打开网址 → 分享 → 添加到主屏幕 → 添加。

免费 HTTPS 托管可以使用 GitHub Pages。项目已包含 `.github/workflows/pages.yml` 自动部署流程，但需要你自己的 GitHub 账号和仓库。仓库推送到 `main` 后，GitHub Actions 会部署静态网站。发布后从仓库的 Settings → Pages/Actions 检查状态并取得 HTTPS 地址。

## 用 Codex 继续处理

在 Codex 中选择 **Open folder / 打开文件夹**，打开解压后的 `sympact-pwa-project` 目录。项目不需要 npm 安装或构建步骤。然后可以让 Codex：

1. 检查 `index.html`、`manifest.webmanifest` 与 `service-worker.js`，不要改动风险定仓公式或回调率推荐逻辑，除非我明确要求。
2. 检查 PWA 安装、离线外壳和移动端布局。
3. 协助我把项目发布到我自己的 GitHub Pages，并告诉我准确的公开 HTTPS 地址。
4. 不要添加交易权限、自动下单或要求输入币安交易 API Key。

更详细的提示词见 `CODEX_START_HERE.md`。

## 文件说明

- `index.html`：应用主体，包含计算器和行情功能。
- `manifest.webmanifest`：App 名称、图标、显示模式。
- `service-worker.js`：本地 App 外壳的离线缓存。
- `icons/`：应用图标、掩模图标与 Apple 主屏幕图标。
- `.github/workflows/pages.yml`：GitHub Pages 自动部署流程。
- `在电脑上预览_SYMPACT.command`：Mac 本地 HTTPS-less localhost 预览脚本。

## 重要边界

“安装成 App”不会让被网络阻断的行情源自动恢复连接；它只是让页面可安装、启动更像独立应用，并支持缓存应用外壳。市场行情、ATR 与公开交易所数据仍依赖设备当时可以访问的接口。
