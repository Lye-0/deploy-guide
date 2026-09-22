# Deploy Guide

ローカルのプロジェクトフォルダから GitHub Pages / Vercel / Cloudflare Workers + Static Assets の候補、判断理由、注意点を表示する静的Webアプリです。

## 開発

Node.js 24以上を使用してください。

```sh
npm ci
npm run dev
npm test
npm run build
npm run check:size
```

開発URLはターミナルに表示される `/deploy-guide/` です。

## GitHub Pages

`deploy-guide` リポジトリの `main` に配置し、Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定します。同梱のワークフローがテスト・ビルド・サイズ検証後に公開します。公開URLは `https://<owner>.github.io/deploy-guide/`。別のリポジトリ名や独自ドメインの場合は `vite.config.ts` の `base` を変更してください。

## 解析の範囲

- File System Access API対応ブラウザはディレクトリを読み取り専用で走査。未対応環境はフォルダ入力を使用。
- Web Worker内でファイルを解析し、外部送信・永続保存・コード実行はしません。
- `.env`、秘密鍵、`.git`、`node_modules`等は対象外。読み取り上限は1ファイル512 KiB、合計8 MiB、一覧50,000件。キャンセルはWorkerを停止します。
- フレームワーク、設定、サーバー処理の手掛かりを静的に抽出します。依存先や動的設定の完全な解析ではありません。コメントやテキスト中の記述も手掛かりに含むため、最終的なビルド確認が必要です。
- `dist/index.html`、`out/index.html`、`build/index.html`を順に探して公開容量を集計。package.jsonのないHTMLルートは公開用フォルダと仮定します。ソース容量をビルド容量として扱いません。
- 複数package.jsonがある場合は対象を選択できます。子パッケージを親の解析に混ぜません。共有パッケージ内部は自動追跡しません。
- 用途・予算・配信量・優先事項・実行方式の回答で再評価します。未知の構成は自動で最適と断定しません。商用のGitHub Pagesは用途詳細を確認できないため保留とします（すべての商用サイトを規約禁止と判断するわけではありません）。

判定は `src/rules.ts`、検出は `src/analyze.ts`、出典は `SOURCES` に集約。仕様確認日：2026-09-22。各社の料金・規約・互換性は公式資料で更新してください。速度ランキングや確率スコアは表示しません。

## 検証

`npm test` は静的/動的判定、無料商用、容量・ファイル数の境界、モノレポ、秘密ファイル除外、未知構成等を検証します。`npm run check:size` は配布ファイル全体のgzip合計が150 KiB以下であることを確認します。
