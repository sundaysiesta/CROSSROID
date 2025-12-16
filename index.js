// 必要なモジュールをインポート
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const { execSync } = require('child_process');

// 環境変数の読み込み（ローカル開発時のみ、他のモジュール読み込み前に実行）
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
    console.log('✅ .envファイルから環境変数を読み込みました');
  } catch (error) {
    console.log('⚠️ .envファイルの読み込みに失敗しました:', error.message);
  }
} else {
  console.log('🚀 本番環境で実行中（.envファイルは読み込みません）');
}

// Config & Constants
const { LEVEL_10_ROLE_ID, CURRENT_GENERATION_ROLE_ID, MAIN_CHANNEL_ID } = require('./constants');

// Features
const timeSignal = require('./features/timeSignal');
const vcNotify = require('./features/vcNotify');
const proxy = require('./features/proxy');
const highlight = require('./features/highlight');
const imageLog = require('./features/imageLog');
const roleAward = require('./features/roleAward');
const legacyMigration = require('./features/legacyMigration');

// Command Handler
const { handleCommands } = require('./commands');



// デバッグ用: 環境変数の確認
console.log('=== 環境変数の確認 ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? `設定済み (長さ: ${process.env.DISCORD_TOKEN.length})` : '未設定');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? `設定済み (長さ: ${process.env.GROQ_API_KEY.length})` : '未設定');
console.log('PORT:', process.env.PORT || '3000');

// Discordトークンチェック
if (process.env.DISCORD_TOKEN) {
  const token = process.env.DISCORD_TOKEN;
  if (token.length < 50 || !token.includes('.')) {
    console.error('❌ Discordトークンの形式が正しくありません。');
  } else {
    console.log('✅ Discordトークンの形式は正しく見えます');
  }
} else {
  console.error('❌ DISCORD_TOKENが設定されていません');
  // エラー終了させずにログを出す（プロセス管理に任せる場合もあるため）
}

// Discordクライアントのインスタンスを作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// Expressアプリのインスタンスを作成 (Uptime Robot用)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send({ 'status': 'alive', 'uptime': `${client.uptime}ms`, 'ping': `${client.ws.ping}ms` });
});

// ボットが準備完了したときに一度だけ実行されるイベント
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`CROSSROID, ready for duty.`);

  const guild = client.guilds.cache.first();
  if (guild) {
    const botMember = guild.members.me;
    console.log(`ボットの権限:`, botMember.permissions.toArray());
    console.log(`レベル10ロールID: ${LEVEL_10_ROLE_ID}`);
    console.log(`現在の世代ロールID: ${CURRENT_GENERATION_ROLE_ID}`);
    console.log(`メインチャンネルID: ${MAIN_CHANNEL_ID}`);
  }

  // スラッシュコマンドを登録
  const commands = [
    {
      name: 'anonymous',
      description: '匿名でメッセージを送信します',
      options: [
        {
          name: '内容',
          description: '送信するメッセージ（256文字以下、改行禁止）',
          type: 3, // STRING
          required: true
        }
      ]
    },
    {
      name: 'anonymous_resolve',
      description: '匿名IDから送信者を特定（運営専用）',
      options: [
        {
          name: '匿名id',
          description: '表示名に含まれる匿名ID（例: a1b2c3）',
          type: 3,
          required: true
        },
        {
          name: '日付',
          description: 'UTC日付 YYYY-MM-DD（省略時は当日）',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'bump',
      description: '部活チャンネルを宣伝します（2時間に1回まで）'
    },
    {
      name: 'test_generation',
      description: '世代獲得通知のテスト（運営専用）',
      options: [
        {
          name: 'ユーザー',
          description: 'テスト対象のユーザー',
          type: 6, // USER
          required: true
        }
      ]
    },
    {
      name: 'test_timereport',
      description: '時報機能のテスト（運営専用）',
      options: [
        {
          name: '時間',
          description: 'テストする時間（0-23）',
          type: 4, // INTEGER
          required: true
        }
      ]
    },
    {
      name: 'random_mention',
      description: 'サーバーメンバーをランダムでメンションします'
    },
    {
      name: 'event_create',
      description: 'イベント用チャンネルを作成し、告知を行います',
      options: [
        {
          name: 'イベント名',
          description: 'イベントのタイトル（チャンネル名になります）',
          type: 3, // STRING
          required: true
        },
        {
          name: '内容',
          description: 'イベントの詳細内容',
          type: 3, // STRING
          required: true
        },
        {
          name: '日時',
          description: '開催日時（任意）',
          type: 3, // STRING
          required: false
        },
        {
          name: '場所',
          description: '開催場所（任意）',
          type: 3, // STRING
          required: false
        }
      ]
    },
    
    // === Admin Suite ===
    {
      name: 'admin_control',
      description: 'チャンネル管理（ロック/解除/低速/Wipe）',
      options: [
        {
          name: 'lock',
          description: 'チャンネルをロックします',
          type: 1, // SUB_COMMAND
          options: [{ name: 'channel', description: '対象チャンネル', type: 7, required: false }]
        },
        {
          name: 'unlock',
          description: 'チャンネルのロックを解除します',
          type: 1,
          options: [{ name: 'channel', description: '対象チャンネル', type: 7, required: false }]
        },
        {
          name: 'slowmode',
          description: '低速モードを設定します',
          type: 1,
          options: [
            { name: 'seconds', description: '秒数(0解除)', type: 4, required: true },
            { name: 'channel', description: '対象チャンネル', type: 7, required: false }
          ]
        },
        {
          name: 'wipe',
          description: '【危険】チャンネルを再生成してログを消去します',
          type: 1,
          options: [{ name: 'channel', description: '対象チャンネル', type: 7, required: true }]
        }
      ]
    },
    {
      name: 'admin_user_mgmt',
      description: 'ユーザー管理（処罰/解除/情報/操作）',
      options: [
        {
          name: 'action',
          description: '処罰または解除を行います',
          type: 1,
          options: [
            { name: 'target', description: '対象ユーザー', type: 6, required: true },
            {
              name: 'type',
              description: '操作タイプ',
              type: 3,
              required: true,
              choices: [
                { name: 'Timeout', value: 'timeout' },
                { name: 'Untimeout', value: 'untimeout' },
                { name: 'Kick', value: 'kick' },
                { name: 'Ban', value: 'ban' },
                { name: 'Unban', value: 'unban' }
              ]
            },
            { name: 'reason', description: '理由', type: 3, required: false },
            { name: 'duration', description: 'Timeout期間(分)', type: 4, required: false }
          ]
        },
        {
          name: 'nick',
          description: 'ニックネームを変更します',
          type: 1,
          options: [
            { name: 'target', description: '対象ユーザー', type: 6, required: true },
            { name: 'name', description: '新しい名前(空欄でリセット)', type: 3, required: false } // Discord allows empty to reset? Usually commands need content. Optional 'name'
          ]
        },
        {
          name: 'dm',
          description: 'BotからDMを送信します',
          type: 1,
          options: [
            { name: 'target', description: '送信先ユーザー', type: 6, required: true },
            { name: 'content', description: '内容', type: 3, required: true },
            { name: 'anonymous', description: '匿名(Bot名義)にするか', type: 5, required: false }
          ]
        },
        {
          name: 'whois',
          description: 'ユーザーの詳細情報を表示します',
          type: 1,
          options: [{ name: 'target', description: '対象ユーザー', type: 6, required: true }]
        }
      ]
    },
    {
      name: 'admin_logistics',
      description: 'ロジスティクス（移動/作成/削除/発言）',
      options: [
        {
          name: 'move_all',
          description: 'VC参加者を全員移動させます',
          type: 1,
          options: [
            { name: 'from', description: '移動元VC', type: 7, required: true }, // ChannelType check in logic
            { name: 'to', description: '移動先VC', type: 7, required: true }
          ]
        },
        {
          name: 'say',
          description: 'Botとして発言します',
          type: 1,
          options: [
            { name: 'channel', description: '送信先', type: 7, required: true },
            { name: 'content', description: '内容', type: 3, required: true }
          ]
        },
        {
          name: 'create',
          description: 'チャンネル作成',
          type: 1,
          options: [
            { name: 'name', description: '名前', type: 3, required: true },
            { name: 'type', description: 'タイプ(text/voice)', type: 3, required: false, choices: [{ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' }] },
            { name: 'category', description: 'カテゴリID', type: 3, required: false }
          ]
        },
        {
          name: 'delete',
          description: 'チャンネル削除',
          type: 1,
          options: [
            { name: 'channel', description: '対象', type: 7, required: true },
            { name: 'reason', description: '理由', type: 3, required: false }
          ]
        },
        {
          name: 'purge',
          description: 'メッセージ一括削除',
          type: 1,
          options: [
            { name: 'amount', description: '件数', type: 4, required: true, minValue: 1, maxValue: 100 },
            { name: 'user', description: '対象ユーザー', type: 6, required: false },
            { name: 'keyword', description: 'キーワード', type: 3, required: false },
            { name: 'channel', description: 'チャンネル', type: 7, required: false }
          ]
        },
        {
          name: 'role',
          description: 'ロール操作',
          type: 1,
          options: [
            { name: 'target', description: 'ユーザー', type: 6, required: true },
            { name: 'role', description: 'ロール', type: 8, required: true },
            { name: 'action', description: '操作', type: 3, required: true, choices: [{ name: 'give', value: 'give' }, { name: 'take', value: 'take' }] }
          ]
        }
      ]
    }
  ];

  try {
    console.log('スラッシュコマンドを登録中...');
    await client.application.commands.set(commands);
    console.log('スラッシュコマンドの登録が完了しました！');
  } catch (error) {
    console.error('スラッシュコマンドの登録に失敗しました:', error);
  }

  // 再起動通知を送信
  try {
    const notifyChannelId = '1431905157657923646';
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (channel) {
      let commitSha = 'unknown';
      let commitDate = 'unknown';
      let commitMessage = 'N/A';
      try {
        commitSha = execSync('git rev-parse --short HEAD').toString().trim();
        commitDate = execSync('git log -1 --pretty=%ad --date=iso').toString().trim();
        commitMessage = execSync('git log -1 --pretty=%B').toString().trim();
      } catch (_) { }

      const commitMessageShort = commitMessage.length > 1000
        ? commitMessage.slice(0, 997) + '...'
        : commitMessage;

      const embed = new EmbedBuilder()
        .setTitle('🥸再起動しました。確認してください。')
        .setColor(0x5865F2)
        .setDescription(commitMessageShort || 'コミットメッセージはありません。')
        .addFields(
          { name: 'Commit', value: '`' + commitSha + '`', inline: true },
          { name: 'Date', value: commitDate, inline: true },
        )
        .setTimestamp(new Date())
        .setFooter({ text: client.user.tag, iconURL: client.user.displayAvatarURL() });

      await channel.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error('再起動通知の送信に失敗しました:', e);
  }

  // 各機能のセットアップ
  timeSignal.setup(client);
  vcNotify.setup(client);
  proxy.setup(client);
  highlight.setup(client);
  imageLog.setup(client);
  roleAward.setup(client);
  legacyMigration.setup(client);
});

// コマンド処理
client.on('interactionCreate', async interaction => {
  await handleCommands(interaction, client);
});

// エラーハンドリング（未捕捉の例外）
process.on('uncaughtException', (error) => {
  console.error('【CRASH PREVENTION】Uncaught Exception:', error);
  // プロセスを終了させない
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('【CRASH PREVENTION】Unhandled Rejection:', reason);
  // プロセスを終了させない
});

// ログイン
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKENがありません。終了します。');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('❌ ログイン失敗:', error);
  process.exit(1);
});

// Webサーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}. Ready for Uptime Robot.`);
});
