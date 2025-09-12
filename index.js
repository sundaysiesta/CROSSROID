// 必要なモジュールをインポート
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
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

// ボットが準備完了したときに一度だけ実行されるイベント
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`CROSSROID, ready for duty.`);
});

// メッセージが作成されたときに実行されるイベント
client.on('messageCreate', message => {
  // ボット自身のメッセージは無視
  if (message.author.bot) return;

  // 'ping'というメッセージに'pong'と返信する
  if (message.content === 'ping') {
    message.channel.send('pong');
  }
});

// Discordボットとしてログイン
client.login(process.env.DISCORD_TOKEN);

// Webサーバーを起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}. Ready for Uptime Robot.`);
});