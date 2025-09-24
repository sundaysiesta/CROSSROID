# CROSSROID Discord Bot

Discordサーバー用の多機能ボットです。時報機能、匿名投稿、案内板更新、世代ロール管理などの機能を提供します。

## 🚀 機能

- **時報機能**: 日本時間で6時、9時、12時、15時、18時、21時、24時、3時に自動時報送信
- **匿名投稿**: ユーザーが匿名でメッセージを送信可能
- **案内板**: サーバー活動の自動更新
- **世代ロール管理**: レベル10到達時の自動ロール付与
- **部活宣伝**: 部活チャンネルの宣伝機能
- **ハイライト**: 高評価メッセージの自動収集
- **画像削除ログ**: 削除された画像のログ記録

## 📋 必要な環境

- Node.js 16.0.0以上
- Discord Bot Token
- Groq API Key（時報機能用）

## 🛠️ セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-username/crossroid.git
cd crossroid
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.example`をコピーして`.env`ファイルを作成し、必要な値を設定してください：

```bash
cp .env.example .env
```

`.env`ファイルの内容：

```env
# Discord Bot設定
DISCORD_TOKEN=your_discord_bot_token_here

# Groq API設定
GROQ_API_KEY=your_groq_api_key_here

# サーバー設定（オプション）
PORT=3000
```

### 4. Discord Botの作成と設定

1. **アプリケーションの作成**
   - [Discord Developer Portal](https://discord.com/developers/applications)にアクセス
   - 「New Application」をクリック
   - アプリケーション名を入力（例: CROSSROID）

2. **Botの作成**
   - 左メニューの「Bot」をクリック
   - 「Add Bot」をクリック
   - Bot名を確認（必要に応じて変更）

3. **トークンの取得**
   - 「Token」セクションで「Copy」をクリック
   - ⚠️ **重要**: トークンは絶対に他人に教えないでください
   - トークンの形式: `[数字].[文字列].[文字列]`（約70文字）

4. **必要な権限の設定**
   - 「Privileged Gateway Intents」で以下を有効化：
     - Presence Intent
     - Server Members Intent
     - Message Content Intent
   - 「OAuth2」→「URL Generator」で以下を選択：
     - Scopes: `bot`, `applications.commands`
     - Bot Permissions:
       - Send Messages
       - Manage Messages
       - Use Slash Commands
       - Manage Webhooks
       - View Channels
       - Read Message History
       - Add Reactions
       - Embed Links
       - Attach Files
       - Manage Roles
       - Administrator（推奨）

5. **サーバーへの招待**
   - 生成されたURLでボットをサーバーに招待

### 5. Groq API Keyの取得

1. [Groq Console](https://console.groq.com/)でアカウントを作成
2. API Keyを生成
3. `.env`ファイルに設定

### 6. ボットの起動

```bash
npm start
```

## 🚀 デプロイ

### 環境変数の設定

デプロイ時は以下の環境変数を設定してください：

- `DISCORD_TOKEN`: Discord Bot Token（必須）
- `GROQ_API_KEY`: Groq API Key（時報機能用、オプション）
- `PORT`: サーバーポート（デフォルト: 3000）

### Docker デプロイ

```bash
# イメージをビルド
docker build -t crossroid .

# 環境変数を設定して実行
docker run -e DISCORD_TOKEN=your_token -e GROQ_API_KEY=your_key -p 3000:3000 crossroid
```

### Koyeb デプロイ

1. **リポジトリの接続**
   - Koyebダッシュボードで「Create Service」をクリック
   - GitHubリポジトリを選択
   - ブランチを指定（通常は`main`）

2. **環境変数の設定**
   - 「Environment Variables」セクションに移動
   - 以下の環境変数を追加：
     ```
     DISCORD_TOKEN=your_discord_bot_token
     GROQ_API_KEY=your_groq_api_key
     NODE_ENV=production
     PORT=3000
     ```
   - ⚠️ **重要**: DISCORD_TOKENは以下の形式である必要があります：
     - 長さ: 約70文字
     - 形式: `[数字].[文字列].[文字列]`
     - 例: `123456789012345678.abcdefghijklmnop.ABCDEFGHIJKLMNOPQRSTUVWXYZ`
   - トークンに余分なスペースや改行が含まれていないか確認してください

3. **デプロイ設定**
   - Build Command: `npm install`
   - Run Command: `npm start`
   - Port: `3000`

4. **デプロイ実行**
   - 「Deploy」をクリック
   - ログで環境変数が正しく読み込まれているか確認

### 注意事項

- `GROQ_API_KEY`が設定されていない場合、時報機能は無効になりますが、ボットは正常に動作します
- デプロイ環境では`.env`ファイルは使用されません。環境変数を直接設定してください
- Koyebでは環境変数の設定後、アプリの再デプロイが必要です

## 🔧 設定

### チャンネルIDの設定

`index.js`内の以下の定数をあなたのサーバーに合わせて変更してください：

```javascript
const MAIN_CHANNEL_ID = 'your_main_channel_id';
const GUIDE_BOARD_CHANNEL_ID = 'your_guide_board_channel_id';
const HIGHLIGHT_CHANNEL_ID = 'your_highlight_channel_id';
const IMAGE_DELETE_LOG_CHANNEL_ID = 'your_image_delete_log_channel_id';
```

### ロールIDの設定

```javascript
const LEVEL_10_ROLE_ID = 'your_level_10_role_id';
const CURRENT_GENERATION_ROLE_ID = 'your_current_generation_role_id';
const ALLOWED_ROLE_IDS = ['role_id_1', 'role_id_2', ...];
```

## 📝 コマンド

### 一般ユーザー向け

- `/cronymous <内容>` - 匿名でメッセージを送信
- `/bump` - 部活チャンネルを宣伝（2時間に1回まで）

### 運営向け

- `/cronymous_resolve <匿名id> [日付]` - 匿名IDから送信者を特定
- `/update_guide` - 案内板を手動更新
- `/test_generation <ユーザー>` - 世代獲得通知のテスト
- `/test_timereport <時間>` - 時報機能のテスト

## 🔒 セキュリティ

- すべてのAPIキーとトークンは環境変数で管理
- `.env`ファイルはGitにコミットされません
- 機密情報は`.gitignore`で除外されています

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 🤝 貢献

プルリクエストやイシューの報告を歓迎します。

## ⚠️ 注意事項

- このボットは特定のDiscordサーバー用に設計されています
- 他のサーバーで使用する場合は、チャンネルIDやロールIDの設定が必要です
- Groq APIの使用量に注意してください
