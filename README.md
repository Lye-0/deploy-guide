# Deploy Guide

ブラウザ内で選んだプロジェクトを読み取り、GitHub Pages / Vercel / Cloudflare Workers + Static Assetsの候補、理由、容量と制限を表示します。ソースは外部送信せず、コード・ビルドスクリプトを実行しません。

## 開発・公開

Node.js 24以上。`npm ci` → `npm run dev`。`npm test` / `npm run build` / `npm run check:size` で確認します。

GitHubの`deploy-guide`リポジトリに配置し、Settings → Pages → SourceをGitHub Actionsに設定します。mainへのpushで同梱ワークフローが公開します。パスは`/deploy-guide/`。独自ドメインや別名では`vite.config.ts`のbaseを変更します。

### このリポジトリのGitHub Pages公開

- リポジトリ：`https://github.com/Lye-0/deploy-guide`
- 公開URL：`https://lye-0.github.io/deploy-guide/`
- ワークフロー：`.github/workflows/pages.yml`
- 公開対象：`dist/`のみ。ソースや解析対象のローカルファイルは公開対象に含めません。

初回設定はSettings → Pages → Build and deployment → Sourceで「GitHub Actions」を選択します。このリポジトリでは2026-09-23の準備時に設定済みであることをAPIで確認しました。

公開するときは検証済みの変更をmainへpushします。`npm ci` → テスト → ビルド → gzipサイズ確認が成功した場合だけ、Pages用の成果物をアップロードして公開します。PRでは同じ検証までを実行し、公開しません。main上ではActionsの「Deploy GitHub Pages」→「Run workflow」から再公開もできます。

公開後はActionsのdeployジョブが成功したことを確認し、上記URLでフォルダ選択と解析結果の表示を確認してください。リポジトリ名・独自ドメインを変更する場合はViteのbaseも合わせて変更します。ブラウザのフォルダ選択やWorkerは静的配信で動作し、バックエンドやAPIキーの登録は不要です。

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

変数経由のfetchは、有限の値の伝播として参照元を追跡します。ローカルのJSON import、オブジェクト属性、関数引数・戻り値、配列操作、Mapのキュー、ReactのContextなどの対応パターンと、BASE_URLを含むURL変換を対象とします。得られた全候補がGET/HEADで取得する実ファイルに対応するときだけ静的アセットとして扱います。公開出力が存在する場合は出力側と照合します。無関係なマニフェストの存在だけでは判定を通しません。未知の入力・未対応の変換・書き込み通信・欠損・必要な参照の解析上限到達は確認待ちを維持します。対象コードは実行せず、最大25,000値・50,000参照・32巡で収束を確認します。

## モノレポの全体判定

pnpm-workspace.yamlまたはpackage.jsonのworkspaces宣言がある場合、ルートのdeploy:production / deploy / prodから、pnpm等のパッケージ指定・スクリプト参照を追います。単一のWorker公開先が特定でき、その環境のmain、実行ハンドラー、Static Assetsの参照先、フロントエンドの関係を確認できたときは、リポジトリ全体としてWorkers + Webを提案します。環境名やアプリ名の固定特例はありません。

現在はWrangler JSON/JSONCが対象です。環境別のD1設定は対象環境から読み取り、DBのID・秘密情報は結果へ出しません。構成は選択したファイルの範囲内だけで解決し、../による兄弟アプリの参照は許可、リポジトリ外への参照は拒否します。公開成果物が未生成でもWorkerの構成判定は残し、容量のみ未確認とします。環境の競合、動的な指定、独立した複数アプリ、未対応設定、一覧不完全は全体判定を保留します。個別アプリ選択時は従来どおりそのアプリを解析します。

Viteの明示的な`?url`アセットimportは、変更・同名の再宣言がないモジュールのimport/const/exportを最大64段で追跡します。ローカルファイルは存在確認し、パッケージ参照はpackage.jsonの依存宣言を確認します。依存パッケージ内部とビルド後のURLは未検証であり、ビルド時に解決する根拠として表示します。CSSの宣言済みパッケージimportもビルド依存として扱います。GET/HEAD以外や未知のURLはこの経路で適合判定しません。未読の未参照成果物はソースからの実行方式判定を妨げません。

Wrangler JSON/JSONCの静的assets設定が検出出力と一致し、deployコマンドがない、またはdefault環境の明示的なdeployコマンドと整合する場合は、既存構成を保てるCloudflareを加点します。サーバー処理ありとは分類しません。到達したコードでReact RouterのBrowserRouter/createBrowserRouterを使用していれば、GitHub Pagesは途中URLへの直接アクセス・公開パスの対応確認を必要とする候補にします。

## ビルドの選択と閲覧条件

出力先は設定ファイル内の語句検索から、Viteのexport defaultを起点にした限定的なAST解析へ変更しました。package.jsonのVite buildコマンド、npm/pnpm/yarnのスクリプト参照、--mode/-m/--outDirの文字列指定を追い、mode/command・定数・条件式から各ビルドの出力候補を作ります。プロジェクトの設定やプラグインは実行しません。[Viteの条件付き設定](https://vite.dev/config/#conditional-config)と[CLI](https://vite.dev/guide/cli)を参照しています。

配信設定と候補が一致する場合はそのフォルダを集計し、別モードの出力も残します。設定競合、候補が複数で配信先が未指定、未生成、環境変数、関数呼び出し、未対応のラッパーやCLIオプション、root変更は未確認とします。ファイルがあるだけではビルドの成功や鮮度、公開範囲は証明できません。プラグインによる設定の書換えは実行検証しません。

「閲覧できる人」は利用者が指定します。package.jsonのprivate、リポジトリの公開範囲、public/privateというフォルダ名・モード名からは推測しません。未定なら暫定比較と注意点を表示し、閲覧制限ありなら全サービスをアクセス制御の確認が必要な候補として扱います。READMEの自然文からアクセス制御が有効と断定しません。
