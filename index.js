// 必要なモジュールをインポート
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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
    GatewayIntentBits.GuildMembers,
  ],
});

// Expressアプリのインスタンスを作成
const app = express();
const PORT = process.env.PORT || 3000; // Koyebが指定するポート、またはローカル用の3000番ポート

// /cronymous のユーザーごとのクールダウン管理（30秒）
const CRONYMOUS_COOLDOWN_MS = 30 * 1000;
const cronymousCooldowns = new Map(); // key: userId, value: lastUsedEpochMs

// 自動代行投稿（メディア）のユーザーごとのクールダウン管理（30秒）
const AUTO_PROXY_COOLDOWN_MS = 30 * 1000;
const autoProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs

// 特定のロールIDのリスト（代行投稿をスキップするロール）
const ALLOWED_ROLE_IDS = [
  '1401922708442320916',
  '1369627265528496198',
  '1369627266354516123',
  '1369627267487240275',
  '1369627268691005472',
  '1369627270205014169',
  '1369627271433945132',
  '1369627272469807195',
  '1369627273447215124',
  '1369627274067841087',
  '1369627282284613753',
  '1369627283563872399',
  '1369627284251873301',
  '1369627285367427134',
  '1369627286944354314',
  '1369627288211165204',
  '1369627288903225406',
  '1369627290597724181'
];

// 強制代行投稿ロールID（このロールを持っている人は代行投稿される）
const FORCE_PROXY_ROLE_ID = '1416291713009582172';

// レベル10ロールID
const LEVEL_10_ROLE_ID = '1369627346201481239';

// 現在の世代ロールID
const CURRENT_GENERATION_ROLE_ID = '1401922708442320916';

// メインチャンネルID
const MAIN_CHANNEL_ID = '1415336647284883528';

// 部活カテゴリID
const CLUB_CATEGORY_IDS = [
  '1417350444619010110',
  '1369627451801604106', 
  '1396724037048078470'
];

// VCカテゴリID
const VC_CATEGORY_ID = '1369659877735137342';

// 案内板チャンネルID
const GUIDE_BOARD_CHANNEL_ID = '1417353618910216192';

// 案内板メッセージIDを保存
let guideBoardMessageId = null;

// 同時処理制限
const processingMessages = new Set();

// 処理中のコマンドを追跡（重複処理防止）
const processingCommands = new Set();

// Uptime Robotがアクセスするためのルートパス
app.get('/', (req, res) => {
  res.send('CROSSROID is alive!');
});

// ユーザーごと日替わりの英数字IDを生成（UTC日基準、英小文字+数字）
function generateDailyUserIdForDate(userId, dateUtc) {
  const y = dateUtc.getUTCFullYear();
  const m = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateUtc.getUTCDate()).padStart(2, '0');
  const dayKey = `${y}${m}${d}`;
  const hash = crypto.createHash('sha256').update(`${userId}:${dayKey}`).digest('hex');
  const segment = hash.slice(0, 10);
  const num = parseInt(segment, 16);
  const id36 = num.toString(36).toLowerCase();
  return id36.slice(0, 8).padStart(6, '0');
}

function generateDailyUserId(userId) {
  return generateDailyUserIdForDate(userId, new Date());
}

// アクティブチャンネル検出機能
async function getActiveChannels() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return { 
      clubChannels: [], 
      vcChannels: [], 
      highlights: [], 
      topSpeakers: [], 
      vcTopSpeakers: [],
      newClubs: []
    };

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // 1時間前
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const oneDayAgo = now - (24 * 60 * 60 * 1000); // 24時間前

    // 部活カテゴリからアクティブなチャンネルを検出
    const clubChannels = [];
    const allClubChannels = []; // 新着部活検出用
    for (const categoryId of CLUB_CATEGORY_IDS) {
      const category = guild.channels.cache.get(categoryId);
      if (!category || category.type !== 4) continue; // カテゴリでない場合はスキップ

      const channels = category.children.cache.filter(ch => 
        ch.type === 0 && // テキストチャンネル
        ch.permissionsFor(guild.members.me).has('ViewChannel')
      );

      for (const channel of channels.values()) {
        allClubChannels.push(channel);
        try {
          const messages = await channel.messages.fetch({ limit: 10 });
          const recentMessage = messages.find(msg => 
            !msg.author.bot && 
            msg.createdTimestamp > oneHourAgo
          );
          
          if (recentMessage) {
            clubChannels.push({
              channel: channel,
              lastActivity: recentMessage.createdTimestamp,
              messageCount: messages.filter(msg => 
                !msg.author.bot && 
                msg.createdTimestamp > oneHourAgo
              ).size
            });
          }
        } catch (error) {
          console.error(`チャンネル ${channel.name} の取得に失敗:`, error);
        }
      }
    }

    // 新着部活を検出（24時間以内に作成されたチャンネル）
    const newClubs = allClubChannels.filter(channel => 
      channel.createdTimestamp > oneDayAgo
    );

    // VCカテゴリからアクティブなボイスチャンネルを検出
    const vcChannels = [];
    const vcCategory = guild.channels.cache.get(VC_CATEGORY_ID);
    if (vcCategory && vcCategory.type === 4) {
      const voiceChannels = vcCategory.children.cache.filter(ch => 
        ch.type === 2 && // ボイスチャンネル
        ch.members && ch.members.size > 0
      );

      for (const vc of voiceChannels.values()) {
        vcChannels.push({
          channel: vc,
          memberCount: vc.members.size,
          members: Array.from(vc.members.values()).map(member => member.user.username)
        });
      }
    }

    // ハイライト投稿を検出（リアクション数が多い投稿）
    const highlights = [];
    for (const channelData of clubChannels) {
      try {
        const messages = await channelData.channel.messages.fetch({ limit: 50 });
        const highlightMessages = messages.filter(msg => 
          !msg.author.bot && 
          msg.reactions.cache.size > 0 &&
          msg.createdTimestamp > oneHourAgo
        );

        for (const msg of highlightMessages.values()) {
          const totalReactions = Array.from(msg.reactions.cache.values())
            .reduce((sum, reaction) => sum + reaction.count, 0);
          
          if (totalReactions >= 3) { // 3つ以上のリアクション
            highlights.push({
              message: msg,
              channel: channelData.channel,
              reactionCount: totalReactions
            });
          }
        }
      } catch (error) {
        console.error(`ハイライト検出でエラー:`, error);
      }
    }

    // 今日一番発言した人を検出（上位3名）
    const userMessageCounts = new Map();
    for (const channelData of clubChannels) {
      try {
        const messages = await channelData.channel.messages.fetch({ limit: 100 });
        const todayMessages = messages.filter(msg => 
          !msg.author.bot && 
          msg.createdTimestamp > todayStart.getTime()
        );

        for (const msg of todayMessages.values()) {
          const count = userMessageCounts.get(msg.author.id) || 0;
          userMessageCounts.set(msg.author.id, count + 1);
        }
      } catch (error) {
        console.error(`メッセージ数カウントでエラー:`, error);
      }
    }

    const topSpeakers = [];
    if (userMessageCounts.size > 0) {
      const sortedUsers = Array.from(userMessageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3); // 上位3名
      
      for (const [userId, count] of sortedUsers) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          topSpeakers.push({ user, count });
        }
      }
    }

    // VCトップスピーカーを検出（ミュート外しのみ、1時間以内）
    const vcUserMessageCounts = new Map();
    for (const vcData of vcChannels) {
      try {
        const messages = await vcData.channel.messages.fetch({ limit: 50 });
        const vcMessages = messages.filter(msg => 
          !msg.author.bot && 
          msg.createdTimestamp > oneHourAgo &&
          !msg.author.bot
        );

        for (const msg of vcMessages.values()) {
          // ミュート状態をチェック（簡易版：メッセージが送信できているかで判定）
          const count = vcUserMessageCounts.get(msg.author.id) || 0;
          vcUserMessageCounts.set(msg.author.id, count + 1);
        }
      } catch (error) {
        console.error(`VCメッセージ数カウントでエラー:`, error);
      }
    }

    const vcTopSpeakers = [];
    if (vcUserMessageCounts.size > 0) {
      const sortedVcUsers = Array.from(vcUserMessageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3); // 上位3名
      
      for (const [userId, count] of sortedVcUsers) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          vcTopSpeakers.push({ user, count });
        }
      }
    }

    return { 
      clubChannels, 
      vcChannels, 
      highlights, 
      topSpeakers, 
      vcTopSpeakers,
      newClubs 
    };
  } catch (error) {
    console.error('アクティブチャンネル検出でエラー:', error);
    return { 
      clubChannels: [], 
      vcChannels: [], 
      highlights: [], 
      topSpeakers: [], 
      vcTopSpeakers: [],
      newClubs: []
    };
  }
}

// 案内板を更新する機能
async function updateGuideBoard() {
  try {
    const { clubChannels, vcChannels, highlights, topSpeakers, vcTopSpeakers, newClubs } = await getActiveChannels();
    
    const guideChannel = client.channels.cache.get(GUIDE_BOARD_CHANNEL_ID);
    if (!guideChannel) {
      console.error('案内板チャンネルが見つかりません');
      return;
    }

    // 新しい案内板を作成
    const embed = new EmbedBuilder()
      .setTitle('📋 アクティブチャンネル案内板')
      .setDescription('**集計期間**: 過去1時間（アクティブチャンネル・ハイライト・VCトップスピーカー）\n**集計期間**: 今日0時〜現在（テキストトップスピーカー）\n**集計期間**: 過去24時間（新着部活）')
      .setColor(0x5865F2)
      .setTimestamp(new Date())
      .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

    // 新着部活セクション
    if (newClubs.length > 0) {
      const newClubList = newClubs
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .map(channel => 
          `🆕 ${channel} (${new Date(channel.createdTimestamp).toLocaleString('ja-JP')})`
        ).join('\n');
      
      embed.addFields({
        name: '🆕 新着部活',
        value: newClubList,
        inline: false
      });
    }

    // 部活チャンネル情報（ランキング形式）
    if (clubChannels.length > 0) {
      const clubList = clubChannels
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 10) // 最大10個
        .map((data, index) => 
          `${index + 1}位. 💬 ${data.channel} (${data.messageCount}件)`
        ).join('\n');
      
      embed.addFields({
        name: '🏫 アクティブな部活チャンネルランキング',
        value: clubList || 'アクティブなチャンネルはありません',
        inline: false
      });
    }

    // VC情報（ランキング形式）
    if (vcChannels.length > 0) {
      const vcList = vcChannels
        .sort((a, b) => b.memberCount - a.memberCount)
        .map((data, index) => 
          `${index + 1}位. 🔊 ${data.channel} (${data.memberCount}人)`
        ).join('\n');
      
      embed.addFields({
        name: '🎤 アクティブなボイスチャンネルランキング',
        value: vcList,
        inline: false
      });
    }

    // ハイライト投稿（ランキング形式）
    if (highlights.length > 0) {
      const highlightList = highlights
        .sort((a, b) => b.reactionCount - a.reactionCount)
        .slice(0, 5) // 最大5個
        .map((data, index) => 
          `${index + 1}位. ⭐ ${data.channel}: ${data.message.content.slice(0, 40)}... (${data.reactionCount}リアクション) - ${data.message.author}`
        ).join('\n');
      
      embed.addFields({
        name: '✨ ハイライト投稿ランキング',
        value: highlightList,
        inline: false
      });
    }

    // テキストトップスピーカー（ランキング形式）
    if (topSpeakers.length > 0) {
      const topSpeakerList = topSpeakers
        .map((speaker, index) => 
          `${index + 1}位. ${speaker.user} (${speaker.count}件)`
        ).join('\n');
      
      embed.addFields({
        name: '🏆 テキストトップスピーカーランキング',
        value: topSpeakerList,
        inline: false
      });
    }

    // VCトップスピーカー（ランキング形式）
    if (vcTopSpeakers.length > 0) {
      const vcTopSpeakerList = vcTopSpeakers
        .map((speaker, index) => 
          `${index + 1}位. ${speaker.user} (${speaker.count}件)`
        ).join('\n');
      
      embed.addFields({
        name: '🎙️ VCトップスピーカーランキング',
        value: vcTopSpeakerList,
        inline: false
      });
    }

    // 既存の案内板メッセージがある場合は編集、ない場合は新規作成
    if (guideBoardMessageId) {
      try {
        const message = await guideChannel.messages.fetch(guideBoardMessageId);
        await message.edit({ embeds: [embed] });
        console.log('案内板を編集しました');
      } catch (error) {
        console.error('案内板の編集に失敗、新規作成します:', error);
        guideBoardMessageId = null;
      }
    }
    
    if (!guideBoardMessageId) {
      const message = await guideChannel.send({ embeds: [embed] });
      guideBoardMessageId = message.id;
      console.log('案内板を新規作成しました');
    }
  } catch (error) {
    console.error('案内板更新でエラー:', error);
  }
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
    },
    {
      name: 'cronymous_resolve',
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
      name: 'update_guide',
      description: '案内板を手動更新（運営専用）'
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
      // Git情報を取得（Authorは含めない）
      let commitSha = 'unknown';
      let commitDate = 'unknown';
      let commitMessage = 'N/A';
      try {
        commitSha = execSync('git rev-parse --short HEAD').toString().trim();
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

  // 案内板の定期更新（5分間隔）
  setInterval(async () => {
    try {
      await updateGuideBoard();
    } catch (error) {
      console.error('定期案内板更新でエラー:', error);
    }
  }, 5 * 60 * 1000); // 5分 = 300,000ms

  // 初回案内板更新
  setTimeout(async () => {
    try {
      await updateGuideBoard();
    } catch (error) {
      console.error('初回案内板更新でエラー:', error);
    }
  }, 10000); // 10秒後に初回実行
});

// ロールチェック機能
function hasAllowedRole(member) {
  if (!member) return false;
  return member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
}

// 強制代行投稿ロールチェック機能
function hasForceProxyRole(member) {
  if (!member) return false;
  return member.roles.cache.has(FORCE_PROXY_ROLE_ID);
}

// 画像・動画ファイルの拡張子をチェック
function isImageOrVideo(attachment) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'];
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];
  const extension = attachment.name.toLowerCase().substring(attachment.name.lastIndexOf('.'));
  return imageExtensions.includes(extension) || videoExtensions.includes(extension);
}

// メッセージイベントリスナー
client.on('messageCreate', async message => {
  // ボットのメッセージは無視
  if (message.author.bot) return;
  
  // 添付ファイルがない場合は無視
  if (!message.attachments || message.attachments.size === 0) return;
  
  // 画像・動画ファイルがあるかチェック
  const hasMedia = Array.from(message.attachments.values()).some(attachment => isImageOrVideo(attachment));
  if (!hasMedia) return;
  
  // ユーザー別クールダウン（自動代行投稿）
  const userId = message.author.id;
  const lastAutoProxyAt = autoProxyCooldowns.get(userId) || 0;
  if (Date.now() - lastAutoProxyAt < AUTO_PROXY_COOLDOWN_MS) {
    return;
  }
  
  // 同時処理制限チェック
  if (processingMessages.has(message.id)) {
    return;
  }
  
  // メンバー情報を取得
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  
  // 強制代行投稿ロールを持っている場合は代行投稿を実行
  if (hasForceProxyRole(member)) {
    // 強制代行投稿の場合は処理を続行
  } else if (hasAllowedRole(member)) {
    // 特定のロールを持っている場合は無視
    return;
  }
  
  // ボットの権限をチェック
  if (!message.guild.members.me.permissions.has('ManageMessages')) {
    return;
  }
  
  // 処理中としてマーク
  processingMessages.add(message.id);
  
  try {
    // 元のメッセージの情報を保存
    const originalContent = message.content || '';
    const originalAttachments = Array.from(message.attachments.values());
    const originalAuthor = message.author;
    
    // チャンネルのwebhookを取得または作成
    let webhook;
    
    try {
      const webhooks = await message.channel.fetchWebhooks();
      webhook = webhooks.find(wh => wh.name === 'CROSSROID Proxy');
      
      if (!webhook) {
        webhook = await message.channel.createWebhook({
          name: 'CROSSROID Proxy',
          avatar: originalAuthor.displayAvatarURL()
        });
      }
    } catch (webhookError) {
      console.error('webhookの取得/作成に失敗しました:', webhookError);
      throw webhookError;
    }
    
    // 添付ファイルを準備
    const files = originalAttachments.map(attachment => ({
      attachment: attachment.url,
      name: attachment.name
    }));
    
    // 削除ボタンを準備
    const deleteButton = {
      type: 2, // BUTTON
      style: 4, // DANGER (赤色)
      label: '削除',
      custom_id: `delete_${originalAuthor.id}_${Date.now()}`,
      emoji: '🗑️'
    };
    
    const actionRow = {
      type: 1, // ACTION_ROW
      components: [deleteButton]
    };
    
    // メンションを無効化
    const sanitizedContent = originalContent
      .replace(/@everyone/g, '@\u200beveryone')
      .replace(/@here/g, '@\u200bhere')
      .replace(/<@&(\d+)>/g, '<@\u200b&$1>');
    
    // webhookでメッセージを送信
    console.log('webhookでメッセージを送信中...');
    
    const webhookMessage = await webhook.send({
      content: sanitizedContent,
      username: originalAuthor.username,
      avatarURL: originalAuthor.displayAvatarURL(),
      files: files,
      components: [actionRow],
      allowedMentions: { parse: [] } // すべてのメンションを無効化
    });
    
    console.log('代行投稿完了');
    
    // クールダウン開始（自動代行投稿）
    autoProxyCooldowns.set(userId, Date.now());
    
    // 代行投稿が成功したら元のメッセージを削除
    try {
      await message.delete();
    } catch (deleteError) {
      console.error('元のメッセージの削除に失敗しました:', deleteError);
      // 削除に失敗しても処理は続行
    }
    
  } catch (error) {
    console.error('メディア代行投稿でエラーが発生しました:', error.message);
  } finally {
    // 処理完了後にメッセージIDをクリーンアップ
    processingMessages.delete(message.id);
  }
});

// レベル10ロール取得時の世代ロール付与処理
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    console.log(`guildMemberUpdate イベント: ${newMember.user.tag} (${newMember.user.id})`);
    
    // レベル10ロールが新しく追加されたかチェック
    const hadLevel10Role = oldMember.roles.cache.has(LEVEL_10_ROLE_ID);
    const hasLevel10Role = newMember.roles.cache.has(LEVEL_10_ROLE_ID);
    
    console.log(`レベル10ロール状態: 以前=${hadLevel10Role}, 現在=${hasLevel10Role}`);
    
    // レベル10ロールが新しく追加された場合
    if (!hadLevel10Role && hasLevel10Role) {
      console.log(`レベル10ロールが新しく追加されました: ${newMember.user.tag}`);
      
      // 既に世代ロールを持っているかチェック
      const hasGenerationRole = newMember.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
      console.log(`世代ロール保有状況: ${hasGenerationRole}`);
      
      // 世代ロールを持っていない場合のみ付与
      if (!hasGenerationRole) {
        console.log(`世代ロールを付与します: ${newMember.user.tag}`);
        
        // 現在の世代ロールを付与
        await newMember.roles.add(CURRENT_GENERATION_ROLE_ID);
        
        // メインチャンネルに通知
        const mainChannel = client.channels.cache.get(MAIN_CHANNEL_ID);
        if (mainChannel) {
          const embed = new EmbedBuilder()
            .setTitle('🎉 第18世代おめでとうございます！')
            .setDescription(`**${newMember.user.username}** さんがレベル10に到達し、第18世代ロールを獲得しました！`)
            .setColor(0xFFD700) // 金色
            .setThumbnail(newMember.user.displayAvatarURL())
            .addFields(
              { name: '獲得したロール', value: `<@&${CURRENT_GENERATION_ROLE_ID}>`, inline: true },
              { name: '世代', value: '第18世代', inline: true },
              { name: 'レベル', value: '10', inline: true }
            )
            .setTimestamp(new Date())
            .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });
          
          await mainChannel.send({ 
            content: `🎊 **${newMember.user.username}** さん、第18世代獲得おめでとうございます！🎊`,
            embeds: [embed]
          });
          
          console.log(`通知を送信しました: ${newMember.user.tag}`);
        } else {
          console.error('メインチャンネルが見つかりません');
        }
        
        console.log(`世代ロールを付与しました: ${newMember.user.tag} (${newMember.user.id})`);
      } else {
        console.log(`既に世代ロールを持っているためスキップ: ${newMember.user.tag}`);
      }
    }
  } catch (error) {
    console.error('世代ロール付与処理でエラーが発生しました:', error);
  }
});

// ボタンインタラクションの処理
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('delete_')) {
      const customIdParts = interaction.customId.replace('delete_', '').split('_');
      const authorId = customIdParts[0];
      
      // 投稿者本人のみが削除できるようにチェック
      if (interaction.user.id !== authorId) {
        await interaction.reply({ content: 'このメッセージは投稿者本人のみが削除できます。', ephemeral: true });
        return;
      }
      
      try {
        // メッセージを削除
        await interaction.message.delete();
        
        // 削除完了の応答
        await interaction.reply({ content: 'メッセージを削除しました。', ephemeral: true });
        
      } catch (error) {
        console.error('メッセージ削除でエラーが発生しました:', error);
        await interaction.reply({ content: 'メッセージの削除に失敗しました。', ephemeral: true });
      }
      return;
    }
  }
});

// スラッシュコマンドの処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'cronymous') {
    // 重複処理防止チェック
    const commandKey = `cronymous_${interaction.user.id}_${interaction.id}`;
    if (processingCommands.has(commandKey)) {
      return interaction.reply({ content: 'このコマンドは既に処理中です。', ephemeral: true });
    }
    
    // 処理中としてマーク
    processingCommands.add(commandKey);
    
    // ユーザーごとのクールダウンチェック
    const now = Date.now();
    const lastUsed = cronymousCooldowns.get(interaction.user.id) || 0;
    const elapsed = now - lastUsed;
    if (elapsed < CRONYMOUS_COOLDOWN_MS) {
      const remainSec = Math.ceil((CRONYMOUS_COOLDOWN_MS - elapsed) / 1000);
      processingCommands.delete(commandKey);
      return interaction.reply({ content: `エラー: クールダウン中です。${remainSec}秒後に再度お試しください。`, ephemeral: true });
    }

    const content = interaction.options.getString('内容');
    
    // メッセージの検証
    if (content.includes('\n')) {
      processingCommands.delete(commandKey);
      return interaction.reply({ content: 'エラー: 改行は使用できません。', ephemeral: true });
    }
    
    if (content.length > 144) {
      processingCommands.delete(commandKey);
      return interaction.reply({ content: 'エラー: メッセージは144文字以下である必要があります。', ephemeral: true });
    }
    
    // @everyoneや@hereなどのメンションをチェック
    if (content.includes('@everyone') || content.includes('@here') || content.includes('<@&')) {
      processingCommands.delete(commandKey);
      return interaction.reply({ content: 'エラー: @everyoneや@hereなどのメンションは使用できません。', ephemeral: true });
    }

    try {
      // 日替わりユーザー固有ID（英小文字+数字）
      const dailyId = generateDailyUserId(interaction.user.id);
      
      // 常に1%の確率で匿名剥がれ
      let isRevealed = false;
      let displayName, avatarURL;
      
      if (Math.random() < 0.01) { // 100回に1回の確率
        isRevealed = true;
        displayName = `🔓 ${interaction.user.username} (正体判明!)`;
        avatarURL = interaction.user.displayAvatarURL();
      } else {
        displayName = `名無しの障害者 ID: ${dailyId}`;
        avatarURL = client.user.displayAvatarURL();
      }
      
      // チャンネルのwebhookを取得または作成
      const webhooks = await interaction.channel.fetchWebhooks();
      let webhook = webhooks.find(wh => wh.name === 'CROSSROID Anonymous');
      
      if (!webhook) {
        webhook = await interaction.channel.createWebhook({
          name: 'CROSSROID Anonymous',
          avatar: client.user.displayAvatarURL()
        });
      }
      
      // メンションを無効化
      const sanitizedContent = content
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g, '@\u200bhere')
        .replace(/<@&(\d+)>/g, '<@\u200b&$1>');
      
      // webhookでメッセージを送信
      await webhook.send({
        content: sanitizedContent,
        username: displayName,
        avatarURL: avatarURL,
        allowedMentions: { parse: [] } // すべてのメンションを無効化
      });
      
      // 匿名機能のログ送信は無効化（要望により送信しない）
      
      // 成功: クールダウン開始
      cronymousCooldowns.set(interaction.user.id, Date.now());

      // ユーザーに成功メッセージを送信（一時的）
      await interaction.reply({ content: '匿名メッセージを送信しました。', ephemeral: true });
      
    } catch (error) {
      console.error('エラーが発生しました:', error);
      await interaction.reply({ content: 'エラーが発生しました。しばらくしてから再試行してください。', ephemeral: true });
    } finally {
      // 処理完了後にクリーンアップ
      processingCommands.delete(commandKey);
    }
  }
  
  if (interaction.commandName === 'cronymous_resolve') {
    try {
      // 管理者限定チェック（サーバー管理権限）
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'このコマンドは運営専用です。', ephemeral: true });
      }

      const idArg = interaction.options.getString('匿名id');
      const dateArg = interaction.options.getString('日付');
      let targetDate;
      if (dateArg) {
        const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateArg);
        if (!m) {
          return interaction.reply({ content: '日付は YYYY-MM-DD (UTC) 形式で指定してください。', ephemeral: true });
        }
        targetDate = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
      } else {
        targetDate = new Date();
      }

      // 全メンバーを走査して一致するIDを探索（ユーザー数が多い場合は負荷に注意）
      await interaction.deferReply({ ephemeral: true });
      const members = await interaction.guild.members.fetch();
      const matches = [];
      members.forEach(guildMember => {
        const uid = guildMember.user.id;
        const did = generateDailyUserIdForDate(uid, targetDate);
        if (did.toLowerCase() === idArg.toLowerCase()) {
          matches.push(guildMember);
        }
      });

      if (matches.length === 0) {
        return interaction.editReply({ content: '一致するユーザーは見つかりませんでした。' });
      }

      const list = matches.map(m => `${m.user.tag} (${m.user.id})`).join('\n');
      return interaction.editReply({ content: `一致ユーザー:\n${list}` });
    } catch (e) {
      console.error('cronymous_resolve エラー:', e);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: 'エラーが発生しました。' });
      }
      return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
    }
  }
  
  if (interaction.commandName === 'update_guide') {
    try {
      // 管理者限定チェック
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'このコマンドは運営専用です。', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      await updateGuideBoard();
      await interaction.editReply({ content: '案内板を更新しました。' });
    } catch (error) {
      console.error('手動案内板更新でエラー:', error);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: 'エラーが発生しました。' });
      }
      return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
    }
  }
});

// Discordボットとしてログイン
client.login(process.env.DISCORD_TOKEN);

// Webサーバーを起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}. Ready for Uptime Robot.`);
});