// 必要なモジュールをインポート
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const express = require('express');
const { execSync } = require('child_process');

// 環境変数の読み込み（ローカル開発時のみ、他のモジュール読み込み前に実行）
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
    console.log('✅ .envファイルから環境変数を読み込みました');
  } catch (error) {
    console.error('⚠️ .envファイルの読み込みに失敗しました:', error.message);
  }
} else {
  console.log('🚀 本番環境で実行中（.envファイルは読み込みません）');
}

// Config & Constants
const { LEVEL_10_ROLE_ID, CURRENT_GENERATION_ROLE_ID, MAIN_CHANNEL_ID } = require('./constants');

// --- CONSOLE PROXY SETUP (Redirect all logs to Webhook) ---
require('./features/consoleProxy').setup();

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
const { clientReady, interactionCreate, messageCreate, messageReactionAdd } = require('./features/romecoin');

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
    GatewayIntentBits.GuildPresences,
  ],
});

// Expressアプリのインスタンスを作成 (Uptime Robot用)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send({ 'status': 'alive', 'uptime': `${client.uptime}ms`, 'ping': `${client.ws.ping}ms` });
});

// ボットが準備完了したときに一度だけ実行されるイベント
client.once('clientReady', async (client) => {
  const _guild = await client.guilds.fetch('1431905155766419638');
  await _guild.channels.create({name: 'errorlog', parent: '1449790496322097183', reason: 'CROSSROIDのエラーログを流すチャンネルを作成'});

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
      new SlashCommandBuilder().setName('anonymous').setDescription('匿名でメッセージを送信します')
          .addStringOption(option =>
              option.setName('内容')
                  .setDescription('送信するメッセージ（256文字以下、改行禁止）')
                  .setRequired(true)
          ),
      new SlashCommandBuilder().setName('bump').setDescription('部活チャンネルを宣伝します（2時間に1回まで）'),
      new SlashCommandBuilder().setName('test_generation').setDescription('世代獲得通知のテスト（運営専用）')
          .addUserOption(option =>
              option.setName('ユーザー')
              .setDescription('テスト対象のユーザー')
              .setRequired(true)
          ),
      new SlashCommandBuilder().setName('test_timereport').setDescription('時報機能のテスト（運営専用）')
          .addIntegerOption(option =>
              option.setName('時間')
              .setDescription('テストする時間（0-23）')
              .setRequired(true)
          ),
      new SlashCommandBuilder().setName('random_mention').setDescription('サーバーメンバーをランダムでメンションします'),
      new SlashCommandBuilder().setName('duel').setDescription('他のユーザーと決闘します')
          .addUserOption(option =>
              option.setName('opponent')
              .setDescription('対戦相手')
              .setRequired(true)
          ),
      new SlashCommandBuilder().setName('duel_russian').setDescription('ロシアンルーレットで対戦します')
          .addUserOption(option =>
              option.setName('opponent')
              .setDescription('対戦相手')
              .setRequired(true)
          ),
      new SlashCommandBuilder().setName('duel_ranking').setDescription('決闘のランキングを表示します'),
      new SlashCommandBuilder().setName('event_create').setDescription('イベント用チャンネルを作成し、告知を行います')
          .addStringOption(option =>
              option.setName('イベント名')
              .setDescription('イベントのタイトル（チャンネル名になります）')
              .setRequired(true)
          )
          .addStringOption(option =>
              option.setName('内容')
              .setDescription('イベントの詳細内容')
              .setRequired(true)
          )
          .addStringOption(option =>
              option.setName('日時')
              .setDescription('開催日時（任意）')
          )
          .addStringOption(option =>
              option.setName('場所')
              .setDescription('開催場所')
          ),
      new SlashCommandBuilder().setName('romecoin').setDescription('ロメコインの所持数を確認します')
          .addUserOption(option =>
              option.setName('user')
              .setDescription('確認したいユーザー')
          ),
      new SlashCommandBuilder().setName('database_export').setDescription('データベースをエクスポートします(運営専用)'),
      new ContextMenuCommandBuilder().setName('匿名開示 (運営専用)').setType(ApplicationCommandType.Message)
  ].map(command => command.toJSON());

  try {
    console.log('スラッシュコマンドを登録中...');
    await client.application.commands.set(commands);
    console.log('スラッシュコマンドの登録が完了しました！');
    require('./utils').logSystem('✅ Slash commands registered successfully.', 'Command Registry');
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

  // --- CLOUD PERSISTENCE RESTORE ---
  const persistence = require('./features/persistence');
  await persistence.restore(client);
  persistence.startSync(client);

  // --- Feature Setup (Load data after restore) ---
  const activityTracker = require('./features/activityTracker');
  activityTracker.start(client);


  // Note: dataBackup is deprecated/removed in favor of persistence
  // const dataBackup = require('./features/dataBackup'); 
  // dataBackup.setup(client);
  await clientReady(client);
});

// コマンド処理
client.on('interactionCreate', async interaction => {
  await handleCommands(interaction, client);
  await interactionCreate(interaction);
});

// ABUSE PROTOCOL MONITOR
client.on('messageCreate', async message => {
  require('./features/abuseProtocol').handleMessage(message);
  await messageCreate(message);
});

client.on('messageReactionAdd', async (reaction, user) => {
  await messageReactionAdd(reaction, user);
});

/*const errorlog_channel = await client.channels.fetch(ERRORLOG_CHANNEL_ID);
client.on('error', async (error) => {
  await errorlog_channel.send({ content: error.message });
});*/

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
