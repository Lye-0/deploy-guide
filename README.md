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
- 公開フォルダは Vite の `build.outDir`、Vercel の `outputDirectory`、Wrangler JSON/JSONC の `assets.directory` / `pages_build_output_dir`、TOML の `[assets] directory` / ルート `pages_build_output_dir` の文字列設定から検出します。コードは実行しません。Viteの動的設定・スプレッド・独自root等は自動判定せず、手動指定で補えます。
- 設定を検出できない場合は `dist/`、`out/`、`build/` の存在で推定し、`index.html` は必須にしません。設定先が欠けている場合、複数候補が競合する場合は別フォルダに自動で切り替えず未確認にします。
- 「公開フォルダ」で読み込んだアプリ内のフォルダ、またはアプリ全体を公開対象として指定できます。package.jsonがあるビルド不要のサイトにも対応します。指定範囲のソースや設定も集計に含まれるため、実際の公開範囲を選んでください。秘密ファイル・依存パッケージ等の除外は引き続き適用されます。アプリ切り替え・新しいフォルダの読み込み時は自動検出に戻ります。
- 複数package.jsonがある場合は対象を選択できます。子パッケージを親の解析に混ぜません。共有パッケージ内部は自動追跡しません。
- 用途・予算・配信量・優先事項・実行方式の回答で再評価します。未知の構成は自動で最適と断定しません。商用のGitHub Pagesは用途詳細を確認できないため保留とします（すべての商用サイトを規約禁止と判断するわけではありません）。

判定は `src/rules.ts`、検出は `src/analyze.ts`、出典は `SOURCES` に集約。仕様確認日：2026-09-22。各社の料金・規約・互換性は公式資料で更新してください。速度ランキングや確率スコアは表示しません。

## 検証

`npm test` は静的/動的判定、無料商用、容量・ファイル数の境界、モノレポ、秘密ファイル除外、未知構成等を検証します。`npm run check:size` は配布ファイル全体のgzip合計が150 KiB以下であることを確認します。

ビルド済み出力がない場合、package.jsonがあってもビルド関連の依存・設定・スクリプトがなく、HTMLと参照するJavaScriptの確認範囲で変換不要ならルートを自動集計します。TS/JSX等、未読・不足参照、動的な参照等は未確認にします。これは静的な推定であり実行検証ではありません。手動指定も引き続き可能です。

サーバー判定はテストディレクトリ・テスト用ファイル・開発補助コード（scripts/tools/docs/examples等）の手掛かりを除外します。これらも確認ファイル数には含まれ、除外した根拠を表示します。ただしpackage.jsonのstartが明示的に指すファイルは、本番候補として評価します。開発依存にあるサーバーライブラリだけではサーバー必須と判定しません。静的解析のため動的な起動経路は別途確認が必要です。
