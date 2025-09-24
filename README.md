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

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーションを作成
2. Botセクションでトークンを取得
3. 必要な権限を設定：
   - Send Messages
   - Manage Messages
   - Use Slash Commands
   - Manage Webhooks
   - View Channels
   - Read Message History
   - Add Reactions
   - Embed Links
   - Attach Files

### 5. Groq API Keyの取得

1. [Groq Console](https://console.groq.com/)でアカウントを作成
2. API Keyを生成
3. `.env`ファイルに設定

### 6. ボットの起動

```bash
npm start
```

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
