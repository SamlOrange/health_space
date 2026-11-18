# 免费静态托管与每日自动更新

站点由 GitHub Pages 提供静态访问；GitHub Actions 每天抓取 GDELT 最新全球医疗健康报道、生成 `public/videos.json`、构建并重新发布。工作流按上海时区每天 08:07 触发（避开整点拥堵），不是严格准点保证。GitHub 文档说明 scheduled workflow 在高负载时可能延迟或被丢弃。

## 上线步骤

1. 在 GitHub 创建仓库并将本项目推送到默认分支 `main`。若使用 GitHub Free + GitHub Pages，仓库需公开；源代码也会公开。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. Actions 页面运行 `Update news and publish site`（push 通常自动运行；也可以手动 Run workflow）。
4. 成功后在 Settings → Pages 查看公开链接，通常为 `https://<用户名>.github.io/<仓库名>/`。

GitHub Pages 支持 Free 公开仓库；每天的静态构建通过 Actions 完成。无需 Render、服务器常驻、Cloudflare API token 或数据库。若不想公开源代码，可以改为 Cloudflare Pages + GitHub Actions secrets 部署，但需 Cloudflare 账号和 API token。

## 内容与定时说明

GDELT 查询全球媒体过去 24 小时的医疗健康报道，按 HybridRel 趋势/相关度顺序展示最多 10 条。它不是跨媒体统一阅读量排名。新闻链接指向原媒体，页面会标记快照更新时间。每天 08:07（Asia/Shanghai）触发一次抓取和发布；GitHub schedule 属尽力调度，遇高负载可能晚到。
