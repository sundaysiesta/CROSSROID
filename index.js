// 必要なモジュールをインポート
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
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
});

// スラッシュコマンドの処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'cronymous') {
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