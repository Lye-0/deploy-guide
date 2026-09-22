# Deploy Guide

ブラウザ内で選んだプロジェクトを読み取り、GitHub Pages / Vercel / Cloudflare Workers + Static Assetsの候補、理由、容量と制限を表示します。ソースは外部送信せず、コード・ビルドスクリプトを実行しません。

## 開発・公開

Node.js 24以上。`npm ci` → `npm run dev`。`npm test` / `npm run build` / `npm run check:size` で確認します。

GitHubの`deploy-guide`リポジトリに配置し、Settings → Pages → SourceをGitHub Actionsに設定します。mainへのpushで同梱ワークフローが公開します。パスは`/deploy-guide/`。独自ドメインや別名では`vite.config.ts`のbaseを変更します。

## 判定の契約

- **起点**：HTMLエントリーポイント、package.jsonの起動コマンド（npm等のスクリプト参照も追跡）、確認できたフレームワークの公開ルート、Workersのmain。
- **ブラウザ側**：HTML → JS/TS/JSX/TSXのimport → CSS/画像/Workerの参照を追跡。コメントや文字列内のサーバーコードは根拠にしません。外部APIと同じ公開先の未確認APIを区別します。
- **起動サーバー**：Acornによる構文解析で、HTTPの成功応答がファイル読取・ファイルストリームに由来するかを検証。GET/HEAD、エラー応答、ホストの変数やLAN設定は本番バックエンドの証拠にしません。レスポンス生成・変換があればサーバー処理、認証・外部依存・解決できない参照等は要確認。
- **ビルド**：buildスクリプトがあるだけでは実行方式を決めません。生成済みファイル、Viteのソースエントリーポイント、公開先設定を別に評価します。ビルド未実行のソース容量を成果物容量として表示しません。
- **テスト・開発補助**：ディレクトリ全体の語句検索で本番要件を決めません。明示的な起動経路から参照された場合は、testsやscripts内でも解析します。
- **容量**：ディレクトリ一覧・ファイルサイズと、コードを読めた範囲は独立。テキスト未読だけを理由に確認済みファイルの容量を捨てません。一覧自体が不完全なら残り・使用率は非表示。ルートを公開候補とした場合はフォルダ全体の集計であり、最小配布セットではありません。
- **提案**：実行環境の適合性→利用条件→明示的な優先事項で比較します。未知の構成を既定点でCloudflareに送りません。Nodeの常駐サーバーはVercel Functions/Workersへの変換確認を要するため、そのまま公開できるとは扱いません。

## 対応範囲と限界

JavaScript/TypeScriptの対応構文、ローカル参照、Next.jsの基本モード、Viteのブラウザ入口、Workersの明示的main等を対象とする静的解析です。任意のプログラムの全実行経路を証明するものではありません。動的import、外部パッケージ内部、複雑な設定・エイリアス、未対応フレームワーク/言語、読み取り上限等では確認待ちにします。未対応構成の推測を「適合」と表示しません。

設定検出：Vite build.outDir、Vercel outputDirectory、Wrangler assets.directory / pages_build_output_dir。設定競合や未生成フォルダは手動指定で補えます。.env・秘密鍵・node_modules・.git・.kilo等は除外。

スキャンは設定・入口を優先し、1ファイル4 MiB、テキスト合計32 MiB、一覧50,000件で制限します。スキャンと構文解析はWorkerで実行し、キャンセル/再選択で古い結果を破棄します。

## 検証と更新

`tests/`は静的配信、API、認証、SSR、未対応構文、参照不足、容量境界、設定競合などを検証します。プロジェクト名での特例はありません。`scripts/check-size.mjs`は配布ファイル全体のgzip合計150 KiB以下を確認します。

料金・制限の出典は`src/rules.ts`のSOURCES、共通上限は`src/capacity.ts`のLIMITS。基準確認日2026-09-22。各社の変更は公式資料で再確認してください。
