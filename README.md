# Deploy Guide

ブラウザ内で選んだプロジェクトを読み取り、GitHub Pages / Vercel / Cloudflare Workers + Static Assetsの候補、理由、容量と制限を表示します。

![Deploy Guideのメイン画面](docs/image/main.png)

## DEPLOYMENT

https://lye-0.github.io/deploy-guide/

## 開発・検証

Node.js 24.22.1とnpm 11.21.1を使用します。miseでプロジェクト用の版を固定しています。

```powershell
mise trust
mise install
mise exec -- npm ci
mise exec -- npm test
mise exec -- npm run build
mise exec -- npm run check:size
mise exec -- npm audit
```

GitHub Actionsでも同じNode.js・npmを使用します。
