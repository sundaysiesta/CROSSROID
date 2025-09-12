// 必要なモジュールをインポート
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const { execSync } = require('child_process');
require('dotenv').config(); // .env ファイルから環境変数を読み込む

// Discordクライアントのインスタンスを作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Expressアプリのインスタンスを作成
const app = express();
const PORT = process.env.PORT || 3000; // Koyebが指定するポート、またはローカル用の3000番ポート

// /cronymous のユーザーごとのクールダウン管理（30秒）
const CRONYMOUS_COOLDOWN_MS = 30 * 1000;
const cronymousCooldowns = new Map(); // key: userId, value: lastUsedEpochMs

// Uptime Robotがアクセスするためのルートパス
app.get('/', (req, res) => {
  res.send('CROSSROID is alive!');
});

// ユーザーごと日替わりの英数字IDを生成（UTC日基準、英小文字+数字）
function generateDailyUserId(userId) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const dayKey = `${y}${m}${d}`;
  const hash = crypto.createHash('sha256').update(`${userId}:${dayKey}`).digest('hex');
  // 先頭の一部を使用して衝突率を抑えつつ短縮（16進→10進→36進）
  const segment = hash.slice(0, 10); // 40bit ≒ 1兆通り
  const num = parseInt(segment, 16);
  const id36 = num.toString(36).toLowerCase();
  // 最低6桁、最大8桁程度に整形
  return id36.slice(0, 8).padStart(6, '0');
}

// ボットが準備完了したときに一度だけ実行されるイベント
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`CROSSROID, ready for duty.`);
  
  // スラッシュコマンドを登録
  const commands = [
    {
      name: 'cronymous',
      description: '匿名でメッセージを送信します',
      options: [
        {
          name: '内容',
          description: '送信するメッセージ（144文字以下、改行禁止）',
          type: 3, // STRING
          required: true
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
    const notifyChannelId = '1415336647284883528';
    const channel = await client.channels.fetch(notifyChannelId).catch(() => null);
    if (channel) {
      // Git情報を取得
      let commitSha = 'unknown';
      let commitAuthor = 'unknown';
      let commitDate = 'unknown';
      let commitMessage = 'N/A';
      try {
        commitSha = execSync('git rev-parse --short HEAD').toString().trim();
        commitAuthor = execSync('git log -1 --pretty=%an').toString().trim();
        commitDate = execSync('git log -1 --pretty=%ad --date=iso').toString().trim();
        commitMessage = execSync('git log -1 --pretty=%B').toString().trim();
      } catch (_) {}

      // 文字数制限対策でコミットメッセージを短縮
      const commitMessageShort = commitMessage.length > 1000
        ? commitMessage.slice(0, 997) + '...'
        : commitMessage;

      const embed = new EmbedBuilder()
        .setTitle('🥸再起動しました。確認してください。')
        .setColor(0x5865F2)
        .setDescription(commitMessageShort || 'コミットメッセージはありません。')
        .addFields(
          { name: 'Commit', value: '`' + commitSha + '`', inline: true },
          { name: 'Author', value: commitAuthor, inline: true },
          { name: 'Date', value: commitDate, inline: true },
        )
        .setTimestamp(new Date())
        .setFooter({ text: client.user.tag, iconURL: client.user.displayAvatarURL() });

      await channel.send({ embeds: [embed] });
    } else {
      console.warn('再起動通知先チャンネルの取得に失敗しました。');
    }
  } catch (e) {
    console.error('再起動通知の送信に失敗しました:', e);
  }
});

// スラッシュコマンドの処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'cronymous') {
    // ユーザーごとのクールダウンチェック
    const now = Date.now();
    const lastUsed = cronymousCooldowns.get(interaction.user.id) || 0;
    const elapsed = now - lastUsed;
    if (elapsed < CRONYMOUS_COOLDOWN_MS) {
      const remainSec = Math.ceil((CRONYMOUS_COOLDOWN_MS - elapsed) / 1000);
      return interaction.reply({ content: `エラー: クールダウン中です。${remainSec}秒後に再度お試しください。`, ephemeral: true });
    }

    const content = interaction.options.getString('内容');
    
    // メッセージの検証
    if (content.includes('\n')) {
      return interaction.reply({ content: 'エラー: 改行は使用できません。', ephemeral: true });
    }
    
    if (content.length > 144) {
      return interaction.reply({ content: 'エラー: メッセージは144文字以下である必要があります。', ephemeral: true });
    }
    
    // @everyoneや@hereなどのメンションをチェック
    if (content.includes('@everyone') || content.includes('@here') || content.includes('<@&')) {
      return interaction.reply({ content: 'エラー: @everyoneや@hereなどのメンションは使用できません。', ephemeral: true });
    }

    try {
      // 日替わりユーザー固有ID（英小文字+数字）
      const dailyId = generateDailyUserId(interaction.user.id);
      const displayName = `名無しの障害者 ID: ${dailyId}`;
      
      // チャンネルのwebhookを取得または作成
      const webhooks = await interaction.channel.fetchWebhooks();
      let webhook = webhooks.find(wh => wh.name === 'CROSSROID Anonymous');
      
      if (!webhook) {
        webhook = await interaction.channel.createWebhook({
          name: 'CROSSROID Anonymous',
          avatar: client.user.displayAvatarURL()
        });
      }
      
      // webhookでメッセージを送信
      await webhook.send({
        content: content,
        username: displayName,
        avatarURL: client.user.displayAvatarURL()
      });
      
      // ログチャンネルに送信
      const logChannelId = '1369643068118274211';
      const logChannel = client.channels.cache.get(logChannelId);
      
      if (logChannel) {
        await logChannel.send({
          content: `**匿名メッセージ送信ログ**\n**送信者:** ${interaction.user.tag} (${interaction.user.id})\n**チャンネル:** ${interaction.channel.name} (${interaction.channel.id})\n**内容:** ${content}\n**表示名:** ${displayName}`
        });
      }
      
      // 成功: クールダウン開始
      cronymousCooldowns.set(interaction.user.id, Date.now());

      // ユーザーに成功メッセージを送信（一時的）
      await interaction.reply({ content: '匿名メッセージを送信しました。', ephemeral: true });
      
    } catch (error) {
      console.error('エラーが発生しました:', error);
      await interaction.reply({ content: 'エラーが発生しました。しばらくしてから再試行してください。', ephemeral: true });
    }
  }
});

// Discordボットとしてログイン
client.login(process.env.DISCORD_TOKEN);

// Webサーバーを起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}. Ready for Uptime Robot.`);
});