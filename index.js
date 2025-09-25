// 必要なモジュールをインポート
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
// 環境変数の読み込み（ローカル開発時のみ）
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config(); // .env ファイルから環境変数を読み込む
    console.log('✅ .envファイルから環境変数を読み込みました');
  } catch (error) {
    console.log('⚠️ .envファイルの読み込みに失敗しました:', error.message);
  }
} else {
  console.log('🚀 本番環境で実行中（.envファイルは読み込みません）');
}

// デバッグ用: 環境変数の確認
console.log('=== 環境変数の確認 ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? `設定済み (長さ: ${process.env.DISCORD_TOKEN.length})` : '未設定');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? `設定済み (長さ: ${process.env.GROQ_API_KEY.length})` : '未設定');
console.log('PORT:', process.env.PORT || '3000');

// Discordトークンの形式チェック
if (process.env.DISCORD_TOKEN) {
  const token = process.env.DISCORD_TOKEN;
  console.log('Discordトークンの形式チェック:');
  console.log('- 長さ:', token.length);
  console.log('- 先頭:', token.substring(0, 10) + '...');
  console.log('- 末尾:', '...' + token.substring(token.length - 10));
  
  // Botトークンの形式チェック
  if (token.length < 50) {
    console.error('❌ Discordトークンが短すぎます。正しいBotトークンを設定してください。');
  } else if (!token.includes('.')) {
    console.error('❌ Discordトークンの形式が正しくありません。Botトークンには"."が含まれている必要があります。');
  } else {
    console.log('✅ Discordトークンの形式は正しく見えます');
  }
} else {
  console.error('❌ DISCORD_TOKENが設定されていません');
}

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

// 特定ワード自動代行のユーザーごとのクールダウン管理（30秒）
const WORD_PROXY_COOLDOWN_MS = 30 * 1000;
const wordProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs

// フィルタリング対象のワードリスト（ワイルドカード対応）
const FILTERED_WORDS = [
  '*5歳*', '*6歳*', '*7歳*', '*8歳*', '*9歳*', '*10歳*', '*11歳*', '*12歳*', '*13歳*', '*14歳*', '*15歳*', '*16歳*', '*17歳*',
  '*JC*', '*JK*', '*JS*', '*じぽ*', '*ジポ*', '*ペド*', '*ぺど*', '*ロリ*', '*ろり*',
  '*園児*', '*高校生*', '*児ポ*', '*児童ポルノ*', '*女子高生*', '*女子小学生*', '*女子中学生*', '*小学生*', '*少女*', '*中学生*', '*低学年*', '*未成年*', '*幼女*', '*幼稚園*',
  '*児*', '*ショタ*'
];

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

// Groq API設定
// 注意: APIキーは環境変数から取得します。ハードコーディングは絶対に避けてください。
let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
  });
} else {
  console.warn('GROQ_API_KEYが設定されていません。時報機能は無効になります。');
}

// 時報機能の設定
const TIME_REPORT_HOURS = [6, 9, 12, 15, 18, 21, 24, 3]; // 24時は0時として扱う
const TIME_REPORT_CHANNEL_ID = '1415336647284883528';

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

// ハイライトチャンネルID
const HIGHLIGHT_CHANNEL_ID = '1406942589738815633';

// 画像削除ログチャンネルID
const IMAGE_DELETE_LOG_CHANNEL_ID = '1381140728528375869';

// 案内板メッセージIDを保存
let guideBoardMessageId = null;

// 今日世代を獲得した人を追跡
const todayGenerationWinners = new Set();

// 前回の部活データを保存（急上昇ランキング用）
let previousClubData = new Map();

// 日本の祝日データ（2024年）
const JAPANESE_HOLIDAYS_2024 = [
  '2024-01-01', // 元日
  '2024-01-08', // 成人の日
  '2024-02-11', // 建国記念の日
  '2024-02-12', // 建国記念の日 振替休日
  '2024-02-23', // 天皇誕生日
  '2024-03-20', // 春分の日
  '2024-04-29', // 昭和の日
  '2024-05-03', // 憲法記念日
  '2024-05-04', // みどりの日
  '2024-05-05', // こどもの日
  '2024-05-06', // こどもの日 振替休日
  '2024-07-15', // 海の日
  '2024-08-11', // 山の日
  '2024-08-12', // 山の日 振替休日
  '2024-09-16', // 敬老の日
  '2024-09-22', // 秋分の日
  '2024-09-23', // 秋分の日 振替休日
  '2024-10-14', // スポーツの日
  '2024-11-03', // 文化の日
  '2024-11-04', // 文化の日 振替休日
  '2024-11-23', // 勤労感謝の日
];

// 日本の祝日データ（2025年）
const JAPANESE_HOLIDAYS_2025 = [
  '2025-01-01', // 元日
  '2025-01-13', // 成人の日
  '2025-02-11', // 建国記念の日
  '2025-02-23', // 天皇誕生日
  '2025-03-20', // 春分の日
  '2025-04-29', // 昭和の日
  '2025-05-03', // 憲法記念日
  '2025-05-04', // みどりの日
  '2025-05-05', // こどもの日
  '2025-05-06', // こどもの日 振替休日
  '2025-07-21', // 海の日
  '2025-08-11', // 山の日
  '2025-09-15', // 敬老の日
  '2025-09-23', // 秋分の日
  '2025-10-13', // スポーツの日
  '2025-11-03', // 文化の日
  '2025-11-23', // 勤労感謝の日
  '2025-11-24', // 勤労感謝の日 振替休日
];

// 学校の長期休暇期間（日本の平均的な期間）
const SCHOOL_VACATIONS = {
  spring: { start: '2025-03-20', end: '2025-04-07' }, // 春休み
  summer: { start: '2025-07-20', end: '2025-08-31' }, // 夏休み
  winter: { start: '2024-12-23', end: '2025-01-07' }, // 冬休み
};


// bumpコマンドのクールダウン管理
let bumpCooldowns = new Map(); // userId -> lastBumpTime
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2時間


// 同時処理制限
const processingMessages = new Set();

// 処理中のコマンドを追跡（重複処理防止）
const processingCommands = new Set();

// メモリ最適化のための定期的なクリーンアップ
function performMemoryCleanup() {
  // 古いクールダウンデータをクリア（1時間以上前のデータ）
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  // 匿名機能のクールダウンクリア
  for (const [userId, lastUsed] of cronymousCooldowns.entries()) {
    if (lastUsed < oneHourAgo) {
      cronymousCooldowns.delete(userId);
    }
  }
  
  // 自動代行投稿のクールダウンクリア
  for (const [userId, lastUsed] of autoProxyCooldowns.entries()) {
    if (lastUsed < oneHourAgo) {
      autoProxyCooldowns.delete(userId);
    }
  }
  
  // 特定ワード自動代行のクールダウンクリア
  for (const [userId, lastUsed] of wordProxyCooldowns.entries()) {
    if (lastUsed < oneHourAgo) {
      wordProxyCooldowns.delete(userId);
    }
  }
  
  // bumpコマンドのクールダウンクリア
  for (const [userId, lastBump] of bumpCooldowns.entries()) {
    if (lastBump < oneHourAgo) {
      bumpCooldowns.delete(userId);
    }
  }
  
  // 処理中のメッセージIDをクリア（古いもの）
  const oldProcessingMessages = Array.from(processingMessages);
  for (const messageId of oldProcessingMessages) {
    // メッセージIDが古い場合は削除（1時間以上前）
    processingMessages.delete(messageId);
  }
  
  // 処理中のコマンドをクリア（古いもの）
  const oldProcessingCommands = Array.from(processingCommands);
  for (const commandKey of oldProcessingCommands) {
    // コマンドキーが古い場合は削除
    processingCommands.delete(commandKey);
  }
  
  console.log('メモリクリーンアップを実行しました');
}

// 30分ごとにメモリクリーンアップを実行
setInterval(performMemoryCleanup, 30 * 60 * 1000);

// 祝日判定関数
function isJapaneseHoliday(date) {
  const year = date.getFullYear();
  const dateString = date.toISOString().split('T')[0];
  
  if (year === 2024) {
    return JAPANESE_HOLIDAYS_2024.includes(dateString);
  } else if (year === 2025) {
    return JAPANESE_HOLIDAYS_2025.includes(dateString);
  }
  
  return false;
}

// 長期休暇判定関数
function getSchoolVacationType(date) {
  const dateString = date.toISOString().split('T')[0];
  
  // 春休み
  if (dateString >= SCHOOL_VACATIONS.spring.start && dateString <= SCHOOL_VACATIONS.spring.end) {
    return 'spring';
  }
  
  // 夏休み
  if (dateString >= SCHOOL_VACATIONS.summer.start && dateString <= SCHOOL_VACATIONS.summer.end) {
    return 'summer';
  }
  
  // 冬休み
  if (dateString >= SCHOOL_VACATIONS.winter.start && dateString <= SCHOOL_VACATIONS.winter.end) {
    return 'winter';
  }
  
  return null;
}

// 曜日判定関数
function getDayType(date) {
  const dayOfWeek = date.getDay(); // 0=日曜日, 1=月曜日, ..., 6=土曜日
  
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return 'weekend';
  } else {
    return 'weekday';
  }
}

// 祝日名取得関数
function getHolidayName(date) {
  const year = date.getFullYear();
  const dateString = date.toISOString().split('T')[0];
  
  const holidays = year === 2024 ? JAPANESE_HOLIDAYS_2024 : JAPANESE_HOLIDAYS_2025;
  const holidayNames = {
    '2024-01-01': '元日',
    '2024-01-08': '成人の日',
    '2024-02-11': '建国記念の日',
    '2024-02-12': '建国記念の日 振替休日',
    '2024-02-23': '天皇誕生日',
    '2024-03-20': '春分の日',
    '2024-04-29': '昭和の日',
    '2024-05-03': '憲法記念日',
    '2024-05-04': 'みどりの日',
    '2024-05-05': 'こどもの日',
    '2024-05-06': 'こどもの日 振替休日',
    '2024-07-15': '海の日',
    '2024-08-11': '山の日',
    '2024-08-12': '山の日 振替休日',
    '2024-09-16': '敬老の日',
    '2024-09-22': '秋分の日',
    '2024-09-23': '秋分の日 振替休日',
    '2024-10-14': 'スポーツの日',
    '2024-11-03': '文化の日',
    '2024-11-04': '文化の日 振替休日',
    '2024-11-23': '勤労感謝の日',
    '2025-01-01': '元日',
    '2025-01-13': '成人の日',
    '2025-02-11': '建国記念の日',
    '2025-02-23': '天皇誕生日',
    '2025-03-20': '春分の日',
    '2025-04-29': '昭和の日',
    '2025-05-03': '憲法記念日',
    '2025-05-04': 'みどりの日',
    '2025-05-05': 'こどもの日',
    '2025-05-06': 'こどもの日 振替休日',
    '2025-07-21': '海の日',
    '2025-08-11': '山の日',
    '2025-09-15': '敬老の日',
    '2025-09-23': '秋分の日',
    '2025-10-13': 'スポーツの日',
    '2025-11-03': '文化の日',
    '2025-11-23': '勤労感謝の日',
    '2025-11-24': '勤労感謝の日 振替休日'
  };
  
  return holidayNames[dateString] || null;
}

// Groq APIを使用した時報文章生成関数
async function generateTimeReportMessage(hour, date) {
  // デバッグ情報を追加
  console.log('generateTimeReportMessage 呼び出し:');
  console.log('- hour:', hour);
  console.log('- groq:', groq ? '初期化済み' : '未初期化');
  console.log('- GROQ_API_KEY:', process.env.GROQ_API_KEY ? '設定済み' : '未設定');
  
  // Groq APIが利用できない場合はフォールバックメッセージを返す
  if (!groq) {
    console.log('⚠️ Groq APIが利用できないため、フォールバックメッセージを返します');
    const timeGreeting = hour === 0 ? '深夜0時' : hour === 3 ? '深夜3時' : hour === 6 ? '朝6時' : 
                        hour === 9 ? '朝9時' : hour === 12 ? '昼12時' : hour === 15 ? '午後3時' : 
                        hour === 18 ? '夕方6時' : hour === 21 ? '夜9時' : `${hour}時`;
    return `${timeGreeting}だダラァ！今日も作業所で頑張るダラァ！`;
  }

  try {
    console.log('🤖 AI文章生成を開始します');
    const dayType = getDayType(date);
    const isHoliday = isJapaneseHoliday(date);
    const holidayName = isHoliday ? getHolidayName(date) : null;
    const vacationType = getSchoolVacationType(date);
    
    console.log('日付情報:', { dayType, isHoliday, holidayName, vacationType });
    
    // 日付情報を構築
    let dateInfo = '';
    if (vacationType) {
      const vacationNames = {
        spring: '春休み',
        summer: '夏休み',
        winter: '冬休み'
      };
      dateInfo = `${vacationNames[vacationType]}期間中`;
    } else if (isHoliday) {
      dateInfo = `${holidayName}`;
    } else if (dayType === 'weekend') {
      dateInfo = '休日';
    } else {
      dateInfo = '平日';
    }
    
    // 時間帯に応じた挨拶
    let timeGreeting = '';
    if (hour === 3) {
      timeGreeting = '深夜3時';
    } else if (hour === 6) {
      timeGreeting = '朝6時';
    } else if (hour === 9) {
      timeGreeting = '朝9時';
    } else if (hour === 12) {
      timeGreeting = '昼12時';
    } else if (hour === 15) {
      timeGreeting = '午後3時';
    } else if (hour === 18) {
      timeGreeting = '夕方6時';
    } else if (hour === 21) {
      timeGreeting = '夜9時';
    } else if (hour === 0) {
      timeGreeting = '深夜0時';
    }
    
    // より詳細な状況情報を追加
    const dayOfWeek = date.getDay();
    const dayNames = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
    const currentDay = dayNames[dayOfWeek];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // 季節の判定
    let season = '';
    if (month >= 3 && month <= 5) season = '春';
    else if (month >= 6 && month <= 8) season = '夏';
    else if (month >= 9 && month <= 11) season = '秋';
    else season = '冬';
    
    // 時間帯に応じた活動内容
    let activity = '';
    if (hour >= 6 && hour < 9) activity = '朝の準備や通勤';
    else if (hour >= 9 && hour < 12) activity = '作業所での午前の作業';
    else if (hour >= 12 && hour < 15) activity = '昼休みや午後の作業';
    else if (hour >= 15 && hour < 18) activity = '午後の作業';
    else if (hour >= 18 && hour < 21) activity = '夕方の作業や帰宅準備';
    else if (hour >= 21 || hour < 3) activity = '夜の時間や休憩';

    const prompt = `あなたは障害者で作業所で働いているヤンキー口調のキャラクターです。語尾に「ダラァ」をつけて話します。ミリタリーオタクで虚言癖があり、彼女がいると嘘をついたり、パソコンの部品についても詳しいです。

現在の状況：
- 時間: ${timeGreeting} (${hour}時)
- 日付: ${month}月${day}日 (${currentDay})
- 季節: ${season}
- 状況: ${dateInfo}
- 活動: ${activity}

この時間と状況に合わせた一行程度の時報メッセージを作成してください。キャラクターの特徴を活かして、その日の状況や時間帯に応じた内容にしてください。

キャラクター設定：
- 障害者で作業所勤務
- ヤンキー口調（語尾に「ダラァ」）
- ミリタリーオタク
- 虚言癖
- 彼女がいると嘘をつく
- パソコン部品に詳しい

時間と状況に応じて、適切な内容で一行程度のメッセージを作成してください。`;

    console.log('📝 Groq APIにリクエストを送信中...');
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.8,
      max_tokens: 100
    });

    const aiMessage = completion.choices[0]?.message?.content || `${timeGreeting}だダラァ！${dateInfo}だけど今日も頑張るダラァ！`;
    console.log('✅ AI文章生成完了:', aiMessage);
    return aiMessage;
  } catch (error) {
    console.error('Groq API エラー:', error);
    // フォールバックメッセージ
    const timeGreeting = hour === 0 ? '深夜0時' : hour === 3 ? '深夜3時' : hour === 6 ? '朝6時' : 
                        hour === 9 ? '朝9時' : hour === 12 ? '昼12時' : hour === 15 ? '午後3時' : 
                        hour === 18 ? '夕方6時' : hour === 21 ? '夜9時' : `${hour}時`;
    return `${timeGreeting}だダラァ！今日も作業所で頑張るダラァ！`;
  }
}

// 時報送信機能
async function sendTimeReport(hour, date) {
  try {
    const channel = client.channels.cache.get(TIME_REPORT_CHANNEL_ID);
    if (!channel) {
      console.error('時報チャンネルが見つかりません');
      return;
    }

    // Groq APIで時報メッセージを生成
    const message = await generateTimeReportMessage(hour, date);
    
    // 埋め込みメッセージを作成
    const embed = new EmbedBuilder()
      .setTitle('🕐 時報')
      .setDescription(message)
      .setColor(0x5865F2) // 青色
      .setTimestamp(date)
      .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

    await channel.send({ embeds: [embed] });
    console.log(`時報を送信しました: ${hour}時 - ${message}`);
  } catch (error) {
    console.error('時報送信でエラー:', error);
  }
}

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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartTime = todayStart.getTime();
    const oneDayAgo = now - (24 * 60 * 60 * 1000); // 24時間前

    // 部活カテゴリからアクティブなチャンネルを検出
    const clubChannels = [];
    const allClubChannels = []; // 新着部活検出用
    console.log(`今日の開始時刻: ${new Date(todayStartTime).toLocaleString('ja-JP')}`);
    
    for (const categoryId of CLUB_CATEGORY_IDS) {
      const category = guild.channels.cache.get(categoryId);
      if (!category || category.type !== 4) {
        console.log(`カテゴリ ${categoryId} が見つからないか、カテゴリではありません`);
        continue;
      }

      const channels = category.children.cache.filter(ch => 
        ch.type === 0 && // テキストチャンネル
        ch.permissionsFor(guild.members.me).has('ViewChannel')
      );

      console.log(`カテゴリ ${category.name}: ${channels.size}個のテキストチャンネル`);

      // 並列処理でAPI呼び出しを削減（最大5チャンネルずつ処理）
      const channelArray = Array.from(channels.values());
      const batchSize = 5;
      
      for (let i = 0; i < channelArray.length; i += batchSize) {
        const batch = channelArray.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (channel) => {
          allClubChannels.push(channel);
          try {
            const messages = await channel.messages.fetch({ limit: 30 }); // さらにAPI呼び出しを削減
            const recentMessage = messages.find(msg => 
              !msg.author.bot && 
              msg.createdTimestamp > todayStartTime
            );
            
            if (recentMessage) {
              const todayMessages = messages.filter(msg => 
                !msg.author.bot && 
                msg.createdTimestamp > todayStartTime
              );
              
              const messageCount = todayMessages.size;
              const uniqueSpeakers = new Set(todayMessages.map(msg => msg.author.id)).size;
              const activityScore = messageCount + (uniqueSpeakers * 3); // メッセージ数 + (話している人数 × 3)
              
              clubChannels.push({
                channel: channel,
                lastActivity: recentMessage.createdTimestamp,
                messageCount: messageCount,
                uniqueSpeakers: uniqueSpeakers,
                activityScore: activityScore
              });
            }
          } catch (error) {
            console.error(`チャンネル ${channel.name} の取得に失敗:`, error.message);
            // エラーが発生しても他のチャンネルの処理は続行
          }
        }));
        
        // バッチ間で少し待機してAPIレート制限を回避
        if (i + batchSize < channelArray.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
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
    
    console.log(`VCカテゴリ検索: ${VC_CATEGORY_ID}, 見つかった: ${vcCategory ? 'はい' : 'いいえ'}`);
    
    if (vcCategory && vcCategory.type === 4) {
      const voiceChannels = vcCategory.children.cache.filter(ch => 
        ch.type === 2 && // ボイスチャンネル
        ch.members && ch.members.size > 0
      );

      console.log(`VCカテゴリ内のボイスチャンネル数: ${vcCategory.children.cache.size}`);
      console.log(`アクティブなボイスチャンネル数: ${voiceChannels.size}`);

      for (const vc of voiceChannels.values()) {
        const memberList = Array.from(vc.members.values()).map(member => member.user.username);
        console.log(`VC ${vc.name}: ${vc.members.size}人 (${memberList.join(', ')})`);
        
        vcChannels.push({
          channel: vc,
          memberCount: vc.members.size,
          members: memberList
        });
      }
    } else {
      console.log('VCカテゴリが見つからないか、カテゴリではありません');
    }
    
    console.log(`最終的なVCチャンネル数: ${vcChannels.length}`);

    // ハイライト投稿を検出（リアクション数が多い投稿）- 上位5チャンネルのみ
    const highlights = [];
    const topChannels = clubChannels
      .sort((a, b) => b.activityScore - a.activityScore)
      .slice(0, 5); // 上位5チャンネルのみ処理
    
    for (const channelData of topChannels) {
      try {
        const messages = await channelData.channel.messages.fetch({ limit: 20 }); // さらにAPI呼び出しを削減
        const highlightMessages = messages.filter(msg => 
          !msg.author.bot && 
          msg.reactions.cache.size > 0 &&
          msg.createdTimestamp > todayStartTime
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
        console.error(`ハイライト検出でエラー (${channelData.channel.name}):`, error.message);
        // エラーが発生しても他のチャンネルの処理は続行
      }
    }

    // 直近50メッセージから発言者を検出（上位3名）- メインチャンネルのみから集計
    const userMessageCounts = new Map();
    
    try {
      const mainChannel = guild.channels.cache.get(MAIN_CHANNEL_ID);
      if (mainChannel) {
        const messages = await mainChannel.messages.fetch({ limit: 50 }); // API呼び出しを削減
        const recentMessages = messages.filter(msg => !msg.author.bot);

        for (const msg of recentMessages.values()) {
          const count = userMessageCounts.get(msg.author.id) || 0;
          userMessageCounts.set(msg.author.id, count + 1);
        }
      }
    } catch (error) {
      console.error(`メインチャンネルのメッセージ数カウントでエラー:`, error.message);
    }

    const topSpeakers = [];
    if (userMessageCounts.size > 0) {
      const sortedUsers = Array.from(userMessageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3); // 上位3名のみ
      
      for (const [userId, count] of sortedUsers) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          topSpeakers.push({ user, count });
        }
      }
    }


    // 急上昇ランキング用のデータを計算
    const trendingClubs = [];
    const dormantClubs = [];
    
    // 前回のデータと比較して急上昇を検出
    for (const clubData of clubChannels) {
      const channelId = clubData.channel.id;
      const previousScore = previousClubData.get(channelId) || 0;
      const currentScore = clubData.activityScore;
      const scoreIncrease = currentScore - previousScore;
      
      if (scoreIncrease > 0) {
        trendingClubs.push({
          ...clubData,
          scoreIncrease: scoreIncrease
        });
      }
    }
    
    // 急上昇ランキングをスコア増加量でソート
    trendingClubs.sort((a, b) => b.scoreIncrease - a.scoreIncrease);
    
    // 休止中の部活を検出（過去24時間で0件の部活）
    for (const channel of allClubChannels) {
      const isActive = clubChannels.some(active => active.channel.id === channel.id);
      if (!isActive) {
        dormantClubs.push(channel);
      }
    }
    
    // 今回のデータを次回用に保存
    const currentClubData = new Map();
    for (const clubData of clubChannels) {
      currentClubData.set(clubData.channel.id, clubData.activityScore);
    }
    previousClubData = currentClubData;

    return { 
      clubChannels, 
      vcChannels, 
      highlights, 
      topSpeakers, 
      newClubs,
      trendingClubs,
      dormantClubs
    };
  } catch (error) {
    console.error('アクティブチャンネル検出でエラー:', error);
    return { 
      clubChannels: [], 
      vcChannels: [], 
      highlights: [], 
      topSpeakers: [], 
      newClubs: [],
      trendingClubs: [],
      dormantClubs: []
    };
  }
}

// Botコメント風のエモいまとめを生成
function generateBotComment(clubChannels, vcChannels, topSpeakers, trendingClubs, dormantClubs) {
  const comments = [];
  const random = Math.random();
  
  // 静かな夜のコメント（低活動時）
  if (clubChannels.length === 0 || (clubChannels.length > 0 && clubChannels[0].activityScore < 10)) {
    if (dormantClubs.length > 0 && random < 0.3) {
      const randomDormant = dormantClubs[Math.floor(Math.random() * dormantClubs.length)];
      const dormantName = randomDormant.name.replace(/[｜|]/g, '').trim();
      comments.push(`「今日は静かな夜…穴場は${randomDormant}」`);
    } else {
      comments.push('「今日は静かな夜…🌙」');
    }
    return comments.join(' ');
  }
  
  // 部長ランキングのコメント
  if (clubChannels.length > 0 && random < 0.2) {
    const topClub = clubChannels[0];
    const clubName = topClub.channel.name.replace(/[｜|]/g, '').trim();
    comments.push(`「部長ランキングTOPは${clubName}」`);
  }
  
  // 復活予感のコメント
  if (dormantClubs.length > 0 && random < 0.15) {
    const randomDormant = dormantClubs[Math.floor(Math.random() * dormantClubs.length)];
    const dormantName = randomDormant.name.replace(/[｜|]/g, '').trim();
    comments.push(`「${randomDormant}がそろそろ復活しそう？」`);
  }
  
  // 部活の盛り上がり具合に基づくコメント
  if (clubChannels.length > 0) {
    const topClub = clubChannels[0];
    const clubName = topClub.channel.name.replace(/[｜|]/g, '').trim();
    if (topClub.activityScore > 50) {
      comments.push(`「${clubName}が今日も圧倒的！` + (topClub.activityScore > 100 ? '🔥」' : '」'));
    } else if (topClub.activityScore > 20) {
      comments.push(`「${clubName}も勢いアリ！` + (topClub.activityScore > 40 ? '✨」' : '」'));
    }
  }
  
  // 急上昇部活のコメント
  if (trendingClubs.length > 0) {
    const topTrending = trendingClubs[0];
    const trendingName = topTrending.channel.name.replace(/[｜|]/g, '').trim();
    comments.push(`「${trendingName}が急上昇中！📈」`);
  }
  
  // VCの盛り上がり具合
  if (vcChannels.length > 0) {
    const topVC = vcChannels[0];
    const vcName = topVC.channel.name.replace(/[｜|]/g, '').trim();
    if (topVC.memberCount > 5) {
      comments.push(`「${vcName}で大盛り上がり！🎤」`);
    } else if (topVC.memberCount > 2) {
      comments.push(`「${vcName}も賑やか！💬」`);
    }
  }
  
  // テキストスピーカーのコメント
  if (topSpeakers.length > 0) {
    const topSpeaker = topSpeakers[0];
    const speakerName = topSpeaker.user.username;
    if (topSpeaker.count > 20) {
      comments.push(`「${speakerName}さんが今日も大活躍！💪」`);
    } else if (topSpeaker.count > 10) {
      comments.push(`「${speakerName}さんも頑張ってる！👏」`);
    }
  }
  
  // 全体的なコメント
  if (comments.length === 0) {
    comments.push('「今日もみんなお疲れ様！🌙」');
  } else if (comments.length === 1) {
    // 1つだけの場合はそのまま
  } else {
    // 複数ある場合は最初の2つを組み合わせ
    comments.splice(2);
  }
  
  return comments.join(' ');
}

// 案内板を更新する機能
async function updateGuideBoard() {
  try {
    const { clubChannels, vcChannels, highlights, topSpeakers, newClubs, trendingClubs, dormantClubs } = await getActiveChannels();
    
    const guideChannel = client.channels.cache.get(GUIDE_BOARD_CHANNEL_ID);
    if (!guideChannel) {
      console.error('案内板チャンネルが見つかりません');
      return;
    }

    // 今日の世代獲得者を取得
    const generationWinnersList = [];
    for (const userId of todayGenerationWinners) {
      try {
        const user = await client.users.fetch(userId);
        generationWinnersList.push(user);
      } catch (error) {
        console.error(`世代獲得者の取得に失敗: ${userId}`, error);
      }
    }

    const now = new Date();
    const timeString = now.toLocaleString('ja-JP', { 
      timeZone: 'Asia/Tokyo',
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    // 一つの埋め込みに統合
    const mainEmbed = new EmbedBuilder()
      .setTitle(`📋 サーバー活動案内板 (${timeString}更新)`)
      .setDescription('**自動更新** - 15分ごと（朝3-12時は1時間ごと）')
      .setColor(0x5865F2) // 青色
      .setTimestamp(now)
      .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

    // 世代獲得者セクション（重要情報として上部に配置）
    if (generationWinnersList.length > 0) {
      const generationList = generationWinnersList
        .map(user => `🎉 ${user}`)
        .join(' ');
      
      mainEmbed.addFields({
        name: '🎉 今日の世代獲得者',
        value: generationList,
        inline: false
      });
    }

    // 部活ランキングセクション
    if (clubChannels.length > 0) {
      const rankEmojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const clubList = await Promise.all(
        clubChannels
          .sort((a, b) => b.activityScore - a.activityScore)
          .slice(0, 5) // 上位5位まで
          .map(async (data, index) => {
            // チャンネルの権限を持つ人（部長）を取得
            const channel = data.channel;
            let clubLeader = '';
            
            // チャンネルのオーバーライド権限を持つ人を探す（botを除く）
            const members = await channel.guild.members.fetch();
            for (const [memberId, member] of members) {
              if (member.user.bot) continue; // botを除外
              
              // チャンネル固有の権限オーバーライドをチェック
              const memberPermissions = channel.permissionsFor(member);
              if (memberPermissions && memberPermissions.has('ManageChannels')) {
                const channelOverwrites = channel.permissionOverwrites.cache.get(memberId);
                if (channelOverwrites && channelOverwrites.allow.has('ManageChannels')) {
                  clubLeader = member.toString();
                  break;
                }
              }
            }
            
            return `${rankEmojis[index]} ${data.channel} — ${data.activityScore}pt ${clubLeader ? `部長:${clubLeader}` : ''}`;
          })
      );
      
      mainEmbed.addFields({
        name: '🏫 アクティブ部活ランキング',
        value: clubList.join('\n') || 'アクティブなチャンネルはありません',
        inline: false
      });
    }

    // VCランキングセクション
    if (vcChannels.length > 0) {
      const rankEmojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const vcList = vcChannels
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 5) // 上位5位まで
        .map((data, index) => 
          `${rankEmojis[index]} 🔊 ${data.channel} — ${data.memberCount}人`
        ).join('\n');
      
      mainEmbed.addFields({
        name: '🎤 アクティブVCランキング',
        value: vcList,
        inline: false
      });
    }

    // テキストスピーカーセクション
    if (topSpeakers.length > 0) {
      const rankEmojis = ['🥇', '🥈', '🥉'];
      const topSpeakerList = topSpeakers
        .map((speaker, index) => 
          `${rankEmojis[index]} ${speaker.user} — ${speaker.count}件`
        ).join('\n');
      
      mainEmbed.addFields({
        name: '💬 直近50メッセージ発言者ランキング',
        value: topSpeakerList,
        inline: false
      });
    }

    // 急上昇・休止部活セクション
    if (trendingClubs.length > 0 || dormantClubs.length > 0) {
      let trendDescription = '';

      // 急上昇ランキング（上位3位まで）
      if (trendingClubs.length > 0) {
        const rankEmojis = ['🥇', '🥈', '🥉'];
        const trendingList = trendingClubs
          .slice(0, 3) // 上位3位まで
          .map((data, index) => 
            `${rankEmojis[index]} ${data.channel} — +${data.scoreIncrease}pt`
          ).join('\n');
        
        trendDescription += `**急上昇部活**\n${trendingList}\n\n`;
      }

      // 休止中の部活（ランダムに1つ、最終活動日時を表示）
      if (dormantClubs.length > 0) {
        const randomDormant = dormantClubs[Math.floor(Math.random() * dormantClubs.length)];
        
        // 最終活動日時を計算
        const lastActivity = new Date(randomDormant.lastMessageAt || randomDormant.createdTimestamp);
        const daysDiff = Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24));
        
        let activityText;
        if (daysDiff === 0) {
          activityText = '今日';
        } else if (daysDiff === 1) {
          activityText = '昨日';
        } else if (daysDiff < 7) {
          activityText = `${daysDiff}日前`;
        } else if (daysDiff < 30) {
          activityText = `${Math.floor(daysDiff / 7)}週間前`;
        } else {
          activityText = `${Math.floor(daysDiff / 30)}ヶ月前`;
        }
        
        trendDescription += `**休止中の部活**\n🛌 ${randomDormant} — 最終活動: ${activityText}`;
      }

      mainEmbed.addFields({
        name: '📈 部活トレンド情報',
        value: trendDescription,
        inline: false
      });
    }

    // ハイライトセクション
    if (highlights.length > 0) {
      const highlightList = highlights
        .sort((a, b) => b.reactionCount - a.reactionCount)
        .slice(0, 3) // 上位3件まで
        .map((data) => 
          `${data.channel} — 「${data.message.content.slice(0, 40)}${data.message.content.length > 40 ? '...' : ''}」 - ${data.message.author} ${data.reactionCount}👍`
        ).join('\n');
      
      mainEmbed.addFields({
        name: '✨ ハイライト',
        value: highlightList,
        inline: false
      });
    }

    // Botコメントセクション
    const botComments = generateBotComment(clubChannels, vcChannels, topSpeakers, trendingClubs, dormantClubs);
    if (botComments) {
      mainEmbed.addFields({
        name: '📝 本日の一言',
        value: botComments,
        inline: false
      });
    }

    const embeds = [mainEmbed];

    // 既存の案内板メッセージがある場合は編集、ない場合は新規作成
    console.log(`案内板更新: guideBoardMessageId = ${guideBoardMessageId}`);
    
    if (guideBoardMessageId) {
      try {
        console.log('既存の案内板メッセージを取得中...');
        const message = await guideChannel.messages.fetch(guideBoardMessageId);
        console.log(`メッセージ取得成功: ${message.id}`);
        await message.edit({ embeds: embeds });
        console.log('案内板を編集しました');
      } catch (error) {
        console.error('案内板の編集に失敗、新規作成します:', error);
        guideBoardMessageId = null;
      }
    }
    
    if (!guideBoardMessageId) {
      console.log('新規案内板メッセージを作成中...');
      const message = await guideChannel.send({ embeds: embeds });
      guideBoardMessageId = message.id;
      console.log(`案内板を新規作成しました: ${guideBoardMessageId}`);
    }
  } catch (error) {
    console.error('案内板更新でエラー:', error);
  }
}

// ボットが準備完了したときに一度だけ実行されるイベント
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`CROSSROID, ready for duty.`);
  
  // ボットの権限とインテントを確認
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

  // 案内板の定期更新（時間帯に応じて間隔を調整）
  function getUpdateInterval() {
    const now = new Date();
    const hour = now.getHours();
    
    // 朝3時から昼12時までは1時間間隔、それ以外は15分間隔
    if (hour >= 3 && hour < 12) {
      return 60 * 60 * 1000; // 1時間
    } else {
      return 15 * 60 * 1000; // 15分
    }
  }
  
  function scheduleNextUpdate() {
    const interval = getUpdateInterval();
    setTimeout(async () => {
      try {
        await updateGuideBoard();
      } catch (error) {
        console.error('定期案内板更新でエラー:', error);
      }
      // 次の更新をスケジュール
      scheduleNextUpdate();
    }, interval);
  }
  
  // 初回のスケジュール設定
  scheduleNextUpdate();

  // 時報スケジューラーの設定
  function scheduleTimeReports() {
    const now = new Date();
    const japanTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
    
    // 次の時報時間を計算
    function getNextTimeReport() {
      const currentHour = japanTime.getHours();
      
      // 現在の時間が時報対象時間の場合は、次の時間を探す
      for (let i = 0; i < TIME_REPORT_HOURS.length; i++) {
        const targetHour = TIME_REPORT_HOURS[i] === 24 ? 0 : TIME_REPORT_HOURS[i];
        if (targetHour > currentHour) {
          const nextTime = new Date(japanTime);
          nextTime.setHours(targetHour, 0, 0, 0);
          return nextTime;
        }
      }
      
      // 今日の時報が終わった場合は、明日の最初の時報を設定
      const tomorrow = new Date(japanTime);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(TIME_REPORT_HOURS[0] === 24 ? 0 : TIME_REPORT_HOURS[0], 0, 0, 0);
      return tomorrow;
    }
    
    const nextTimeReport = getNextTimeReport();
    const timeUntilNext = nextTimeReport.getTime() - japanTime.getTime();
    
    console.log(`次の時報予定: ${nextTimeReport.toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}`);
    
    setTimeout(async () => {
      const reportHour = nextTimeReport.getHours();
      const reportDate = new Date(nextTimeReport.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
      
      await sendTimeReport(reportHour, reportDate);
      
      // 次の時報をスケジュール
      scheduleTimeReports();
    }, timeUntilNext);
  }
  
  // 時報スケジューラーを開始（GROQ_API_KEYが設定されている場合のみ）
  if (process.env.GROQ_API_KEY) {
    scheduleTimeReports();
    console.log('時報スケジューラーを開始しました');
  } else {
    console.log('GROQ_API_KEYが設定されていないため、時報スケジューラーをスキップしました');
  }


  // 初回案内板更新（既存メッセージを検出）
  setTimeout(async () => {
    try {
      // 既存の案内板メッセージを検索
      const guideChannel = client.channels.cache.get(GUIDE_BOARD_CHANNEL_ID);
      if (guideChannel) {
        const messages = await guideChannel.messages.fetch({ limit: 20 });
        const existingGuideMessage = messages.find(msg => 
          msg.author.id === client.user.id && 
          msg.embeds.length > 0 && 
          msg.embeds[0].title && msg.embeds[0].title.includes('📋 サーバー活動案内板')
        );
        
        if (existingGuideMessage) {
          guideBoardMessageId = existingGuideMessage.id;
          console.log('既存の案内板メッセージを発見しました');
        }
      }
      
      await updateGuideBoard();
    } catch (error) {
      console.error('初回案内板更新でエラー:', error);
    }
  }, 10000); // 10秒後に初回実行

  // 日付が変わったときに世代獲得者リストをリセット（毎日0時に実行）
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();
  
  setTimeout(() => {
    todayGenerationWinners.clear();
    console.log('世代獲得者リストをリセットしました');
    
    // その後は24時間ごとにリセット
    setInterval(() => {
      todayGenerationWinners.clear();
      console.log('世代獲得者リストをリセットしました');
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
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

// ワイルドカード対応のワードマッチング関数
function matchesFilteredWord(text, pattern) {
  // パターンからワイルドカードを除去して実際のワードを取得
  const word = pattern.replace(/\*/g, '');
  
  // 大文字小文字を区別せずに検索
  return text.toLowerCase().includes(word.toLowerCase());
}

// フィルタリング対象のワードが含まれているかチェック
function containsFilteredWords(text) {
  if (!text) return false;
  
  for (const pattern of FILTERED_WORDS) {
    if (matchesFilteredWord(text, pattern)) {
      return true;
    }
  }
  return false;
}

// ハイライト機能：リアクションが5つ以上ついたメッセージをハイライトチャンネルに投稿
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // ボットのリアクションは無視
    if (user.bot) return;
    
    // メッセージを取得
    const message = reaction.message;
    
    // ボットのメッセージは無視
    if (message.author.bot) return;
    
    // リアクションの総数を計算
    const totalReactions = Array.from(message.reactions.cache.values())
      .reduce((sum, reaction) => sum + reaction.count, 0);
    
    // 5つ以上のリアクションがついた場合
    if (totalReactions >= 5) {
      // ハイライトチャンネルに投稿
      const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
      if (highlightChannel) {
        const embed = new EmbedBuilder()
          .setTitle('✨ ハイライト')
          .setDescription(`[メッセージにジャンプ](${message.url})`)
          .addFields(
            { name: 'チャンネル', value: message.channel.toString(), inline: true },
            { name: '投稿者', value: message.author.toString(), inline: true },
            { name: 'リアクション数', value: totalReactions.toString(), inline: true }
          )
          .setColor(0xFFB6C1) // ピンク色
          .setTimestamp(new Date())
          .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });
        
        // メッセージの内容を追加（長すぎる場合は省略）
        let content = message.content || '';
        if (content.length > 200) {
          content = content.slice(0, 197) + '...';
        }
        if (content) {
          embed.addFields({ name: '内容', value: content, inline: false });
        }
        
        // 添付ファイルがある場合は追加
        if (message.attachments.size > 0) {
          const attachment = message.attachments.first();
          if (attachment) {
            embed.setImage(attachment.url);
          }
        }
        
        await highlightChannel.send({ embeds: [embed] });
        console.log(`ハイライトを投稿しました: ${message.id} (${totalReactions}リアクション)`);
      }
    }
  } catch (error) {
    console.error('ハイライト機能でエラー:', error);
  }
});

// 画像削除ログ機能：画像メッセージが削除された際にログチャンネルに投稿
client.on('messageDelete', async message => {
  try {
    // ボットのメッセージは無視
    if (message.author.bot) return;
    
    // 画像・動画ファイルがあるかチェック
    const hasMedia = message.attachments && message.attachments.size > 0 && 
      Array.from(message.attachments.values()).some(attachment => isImageOrVideo(attachment));
    
    if (hasMedia) {
      // 削除されたメッセージの情報を取得
      const guild = message.guild;
      if (!guild) return;
      
      // 削除されたメッセージの詳細を取得（キャッシュから）
      const deletedMessage = message;
      
      // 管理者による削除かチェック（メッセージの作者以外が削除した場合）
      // 実際の削除者を特定するのは困難なため、メッセージの作成時刻と現在時刻の差で判断
      const messageAge = Date.now() - deletedMessage.createdTimestamp;
      const isRecentMessage = messageAge < 60000; // 1分以内のメッセージ
      
      // 最近のメッセージの場合は管理者による削除の可能性が高いためスキップ
      if (isRecentMessage) {
        console.log(`最近のメッセージのため管理者削除と判断し、ログをスキップ: ${message.id}`);
        return;
      }
      
      // 画像削除ログチャンネルにwebhookで投稿
      const logChannel = client.channels.cache.get(IMAGE_DELETE_LOG_CHANNEL_ID);
      if (logChannel) {
        // webhookを取得または作成
        let webhook;
        try {
          const webhooks = await logChannel.fetchWebhooks();
          webhook = webhooks.find(wh => wh.name === 'CROSSROID Image Log');
          
          if (!webhook) {
            webhook = await logChannel.createWebhook({
              name: 'CROSSROID Image Log',
              avatar: client.user.displayAvatarURL()
            });
          }
        } catch (webhookError) {
          console.error('webhookの取得/作成に失敗:', webhookError);
          return;
        }
        
        const embed = new EmbedBuilder()
          .setTitle('🗑️ 画像削除ログ')
          .addFields(
            { name: 'チャンネル', value: message.channel.toString(), inline: true },
            { name: '投稿者', value: message.author.toString(), inline: true },
            { name: '削除時刻', value: new Date().toLocaleString('ja-JP'), inline: true }
          )
          .setColor(0xFF6B6B) // 赤色
          .setTimestamp(new Date())
          .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });
        
        // メッセージの内容を追加（長すぎる場合は省略）
        let content = message.content || '';
        if (content.length > 200) {
          content = content.slice(0, 197) + '...';
        }
        if (content) {
          embed.addFields({ name: '内容', value: content, inline: false });
        }
        
        // 削除された画像を添付
        const files = [];
        for (const attachment of message.attachments.values()) {
          if (isImageOrVideo(attachment)) {
            files.push({
              attachment: attachment.url,
              name: attachment.name
            });
          }
        }
        
        await webhook.send({ 
          embeds: [embed],
          files: files,
          username: 'CROSSROID Image Log',
          avatarURL: client.user.displayAvatarURL()
        });
        console.log(`画像削除ログをwebhookで投稿しました: ${message.id}`);
      }
    }
  } catch (error) {
    console.error('画像削除ログ機能でエラー:', error);
  }
});

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
    console.log(`メッセージ ${message.id} は既に処理中です`);
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
    
    // 表示名を事前に取得（重複取得を防ぐ）
    const displayName = member?.nickname || originalAuthor.displayName;
    
    // チャンネルのwebhookを取得または作成
    let webhook;
    
    try {
      console.log('webhookを取得中...');
      const webhooks = await message.channel.fetchWebhooks();
      console.log(`既存のwebhook数: ${webhooks.size}`);
      
      webhook = webhooks.find(wh => wh.name === 'CROSSROID Proxy');
      
      if (!webhook) {
        console.log('CROSSROID Proxy webhookが見つからないため作成します');
        webhook = await message.channel.createWebhook({
          name: 'CROSSROID Proxy',
          avatar: originalAuthor.displayAvatarURL()
        });
        console.log('webhookを作成しました:', webhook.id);
      } else {
        console.log('既存のwebhookを使用します:', webhook.id);
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
    console.log(`送信内容: ${sanitizedContent}`);
    console.log(`添付ファイル数: ${files.length}`);
    console.log(`表示名: ${displayName}`);
    
    try {
      // メッセージがまだ存在するかチェック（重複防止）
      const messageExists = await message.fetch().catch(() => null);
      if (!messageExists) {
        console.log('メッセージが既に削除されているため、webhook送信をスキップします');
        return;
      }
      
      const webhookMessage = await webhook.send({
        content: sanitizedContent,
        username: displayName,
        avatarURL: originalAuthor.displayAvatarURL(),
        files: files,
        components: [actionRow],
        allowedMentions: { parse: [] } // すべてのメンションを無効化
      });
      
      console.log('代行投稿完了:', webhookMessage.id);
    } catch (webhookError) {
      console.error('webhook送信エラー:', webhookError);
      throw webhookError;
    }
    
    // クールダウン開始（自動代行投稿）
    autoProxyCooldowns.set(userId, Date.now());
    
    // 代行投稿が成功したら元のメッセージを削除
    try {
      console.log('元のメッセージの削除を試行中...');
      // メッセージがまだ存在するかチェック
      const messageExists = await message.fetch().catch(() => null);
      if (messageExists) {
        await message.delete();
        console.log('元のメッセージを削除しました');
      } else {
        console.log('元のメッセージは既に削除されています');
      }
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

// 特定ワード自動代行機能
client.on('messageCreate', async message => {
  // ボットのメッセージは無視
  if (message.author.bot) return;
  
  // メッセージ内容がない場合は無視
  if (!message.content || message.content.trim() === '') return;
  
  // フィルタリング対象のワードが含まれているかチェック
  if (!containsFilteredWords(message.content)) return;
  
  // ユーザー別クールダウン（特定ワード自動代行）
  const userId = message.author.id;
  const lastWordProxyAt = wordProxyCooldowns.get(userId) || 0;
  if (Date.now() - lastWordProxyAt < WORD_PROXY_COOLDOWN_MS) {
    return;
  }
  
  // 同時処理制限チェック
  if (processingMessages.has(message.id)) {
    console.log(`メッセージ ${message.id} は既に処理中です`);
    return;
  }
  
  // メンバー情報を取得
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  
  // 規制単語機能はすべてのユーザーに適用（ロールに関係なく）
  // 強制代行投稿ロールのチェックは不要（すべてのユーザーが対象）
  
  // ボットの権限をチェック
  if (!message.guild.members.me.permissions.has('ManageMessages')) {
    return;
  }
  
  // 処理中としてマーク
  processingMessages.add(message.id);
  
  try {
    // 元のメッセージの情報を保存
    const originalContent = message.content;
    const originalAuthor = message.author;
    
    // 表示名を事前に取得（重複取得を防ぐ）
    const displayName = member?.nickname || originalAuthor.displayName;
    
    // チャンネルのwebhookを取得または作成
    let webhook;
    
    try {
      console.log('特定ワード自動代行: webhookを取得中...');
      const webhooks = await message.channel.fetchWebhooks();
      console.log(`既存のwebhook数: ${webhooks.size}`);
      
      webhook = webhooks.find(wh => wh.name === 'CROSSROID Word Filter');
      
      if (!webhook) {
        console.log('CROSSROID Word Filter webhookが見つからないため作成します');
        webhook = await message.channel.createWebhook({
          name: 'CROSSROID Word Filter',
          avatar: originalAuthor.displayAvatarURL()
        });
        console.log('webhookを作成しました:', webhook.id);
      } else {
        console.log('既存のwebhookを使用します:', webhook.id);
      }
    } catch (webhookError) {
      console.error('webhookの取得/作成に失敗しました:', webhookError);
      throw webhookError;
    }
    
    // メンションを無効化
    const sanitizedContent = originalContent
      .replace(/@everyone/g, '@\u200beveryone')
      .replace(/@here/g, '@\u200bhere')
      .replace(/<@&(\d+)>/g, '<@\u200b&$1>');
    
    // webhookでメッセージを送信
    console.log('特定ワード自動代行: webhookでメッセージを送信中...');
    console.log(`送信内容: ${sanitizedContent}`);
    console.log(`表示名: ${displayName}`);
    
    try {
      // メッセージがまだ存在するかチェック（重複防止）
      const messageExists = await message.fetch().catch(() => null);
      if (!messageExists) {
        console.log('メッセージが既に削除されているため、webhook送信をスキップします');
        return;
      }
      
      const webhookMessage = await webhook.send({
        content: sanitizedContent,
        username: displayName,
        avatarURL: originalAuthor.displayAvatarURL(),
        allowedMentions: { parse: [] } // すべてのメンションを無効化
      });
      
      console.log('特定ワード自動代行完了:', webhookMessage.id);
    } catch (webhookError) {
      console.error('webhook送信エラー:', webhookError);
      throw webhookError;
    }
    
    // クールダウン開始（特定ワード自動代行）
    wordProxyCooldowns.set(userId, Date.now());
    
    // 代行投稿が成功したら元のメッセージを削除
    try {
      console.log('元のメッセージの削除を試行中...');
      // メッセージがまだ存在するかチェック
      const messageExists = await message.fetch().catch(() => null);
      if (messageExists) {
        await message.delete();
        console.log('元のメッセージを削除しました');
      } else {
        console.log('元のメッセージは既に削除されています');
      }
    } catch (deleteError) {
      console.error('元のメッセージの削除に失敗しました:', deleteError);
      // 削除に失敗しても処理は続行
    }
    
  } catch (error) {
    console.error('特定ワード自動代行でエラーが発生しました:', error.message);
  } finally {
    // 処理完了後にメッセージIDをクリーンアップ
    processingMessages.delete(message.id);
  }
});

// レベル10ロール取得時の世代ロール付与処理
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    console.log(`guildMemberUpdate イベント: ${newMember.user.tag} (${newMember.user.id})`);
    console.log(`レベル10ロールID: ${LEVEL_10_ROLE_ID}`);
    
    // レベル10ロールが新しく追加されたかチェック
    const hadLevel10Role = oldMember.roles.cache.has(LEVEL_10_ROLE_ID);
    const hasLevel10Role = newMember.roles.cache.has(LEVEL_10_ROLE_ID);
    
    console.log(`レベル10ロール状態: 以前=${hadLevel10Role}, 現在=${hasLevel10Role}`);
    console.log(`oldMember roles:`, oldMember.roles.cache.map(r => r.id));
    console.log(`newMember roles:`, newMember.roles.cache.map(r => r.id));
    
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
        
        // 今日の世代獲得者に追加
        todayGenerationWinners.add(newMember.user.id);
        
        // メインチャンネルに通知
        const mainChannel = client.channels.cache.get(MAIN_CHANNEL_ID);
        if (mainChannel) {
          const embed = new EmbedBuilder()
            .setTitle('🎉 第18世代おめでとうございます！')
            .setDescription(`${newMember.user} さんがレベル10に到達し、第18世代ロールを獲得しました！`)
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
            content: `🎊 ${newMember.user} さん、第18世代獲得おめでとうございます！🎊`,
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
      
      // 匿名表示名とアバターを設定
      const displayName = `名無しの障害者 ID: ${dailyId}`;
      const avatarURL = client.user.displayAvatarURL();
      
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
  
  if (interaction.commandName === 'bump') {
    try {
      // 部活チャンネルかチェック
      const channel = interaction.channel;
      const isClubChannel = CLUB_CATEGORY_IDS.some(categoryId => {
        const category = interaction.guild.channels.cache.get(categoryId);
        return category && category.children.cache.has(channel.id);
      });
      
      if (!isClubChannel) {
        return interaction.reply({ 
          content: 'このコマンドは部活チャンネルでのみ使用できます。', 
          ephemeral: true 
        });
      }
      
      // クールダウンチェック
      const userId = interaction.user.id;
      const lastBump = bumpCooldowns.get(userId);
      const now = Date.now();
      
      if (lastBump && (now - lastBump) < BUMP_COOLDOWN_MS) {
        const remainingTime = Math.ceil((BUMP_COOLDOWN_MS - (now - lastBump)) / (1000 * 60));
        return interaction.reply({ 
          content: `⏰ クールダウン中です。あと${remainingTime}分後に使用できます。`, 
          ephemeral: true 
        });
      }
      
      // クールダウンを設定
      bumpCooldowns.set(userId, now);
      
      // 通知チャンネルに埋め込みを送信
      const notifyChannel = interaction.guild.channels.cache.get('1415336647284883528');
      if (notifyChannel) {
        const bumpEmbed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('📢 部活宣伝')
          .setDescription(`${channel} - ${interaction.user}`)
          .setTimestamp();
        
        // チャンネルトピックがある場合は追加
        if (channel.topic) {
          bumpEmbed.addFields({
            name: '📝 説明',
            value: channel.topic.length > 200 ? channel.topic.slice(0, 197) + '...' : channel.topic,
            inline: false
          });
        }
        
        await notifyChannel.send({ embeds: [bumpEmbed] });
      }
      
      // 成功メッセージを返信
      await interaction.reply({ 
        content: '✅ 部活の宣伝が完了しました！', 
        ephemeral: true 
      });
      
    } catch (error) {
      console.error('bumpコマンドでエラー:', error);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: 'エラーが発生しました。' });
      }
      return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
    }
  }
  
  if (interaction.commandName === 'test_generation') {
    try {
      // 管理者限定チェック
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'このコマンドは運営専用です。', ephemeral: true });
      }

      const targetUser = interaction.options.getUser('ユーザー');
      const targetMember = await interaction.guild.members.fetch(targetUser.id);
      
      await interaction.deferReply({ ephemeral: true });
      
      // テスト用の世代獲得通知を送信
      const mainChannel = client.channels.cache.get(MAIN_CHANNEL_ID);
      if (mainChannel) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 第18世代おめでとうございます！（テスト）')
          .setDescription(`${targetUser} さんがレベル10に到達し、第18世代ロールを獲得しました！`)
          .setColor(0xFFD700) // 金色
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: '獲得したロール', value: `<@&${CURRENT_GENERATION_ROLE_ID}>`, inline: true },
            { name: '世代', value: '第18世代', inline: true },
            { name: 'レベル', value: '10', inline: true }
          )
          .setTimestamp(new Date())
          .setFooter({ text: 'CROSSROID (テスト)', iconURL: client.user.displayAvatarURL() });
        
        await mainChannel.send({ 
          content: `🎊 ${targetUser} さん、第18世代獲得おめでとうございます！🎊（テスト）`,
          embeds: [embed]
        });
        
        await interaction.editReply({ content: 'テスト通知を送信しました。' });
      } else {
        await interaction.editReply({ content: 'メインチャンネルが見つかりません。' });
      }
      
    } catch (error) {
      console.error('テストコマンドでエラー:', error);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: 'エラーが発生しました。' });
      }
      return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
    }
  }
  
  if (interaction.commandName === 'test_timereport') {
    try {
      // 管理者限定チェック
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'このコマンドは運営専用です。', ephemeral: true });
      }

      const testHour = interaction.options.getInteger('時間');
      
      if (testHour < 0 || testHour > 23) {
        return interaction.reply({ content: '時間は0-23の範囲で指定してください。', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      
      if (!process.env.GROQ_API_KEY) {
        await interaction.editReply({ content: 'GROQ_API_KEYが設定されていないため、AI文章生成はできません。フォールバックメッセージでテストします。' });
        
        // フォールバックメッセージでテスト
        const testDate = new Date();
        const channel = client.channels.cache.get(TIME_REPORT_CHANNEL_ID);
        if (channel) {
          const timeGreeting = testHour === 0 ? '深夜0時' : testHour === 3 ? '深夜3時' : testHour === 6 ? '朝6時' : 
                              testHour === 9 ? '朝9時' : testHour === 12 ? '昼12時' : testHour === 15 ? '午後3時' : 
                              testHour === 18 ? '夕方6時' : testHour === 21 ? '夜9時' : `${testHour}時`;
          const fallbackMessage = `${timeGreeting}だダラァ！今日も作業所で頑張るダラァ！`;
          
          const embed = new EmbedBuilder()
            .setTitle('🕐 時報テスト（フォールバック）')
            .setDescription(fallbackMessage)
            .setColor(0x5865F2)
            .setTimestamp(testDate)
            .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

          await channel.send({ embeds: [embed] });
          await interaction.editReply({ content: `時報テストを送信しました（${testHour}時、フォールバックメッセージ）。` });
        } else {
          await interaction.editReply({ content: '時報チャンネルが見つかりません。' });
        }
        return;
      }
      
      // AI文章生成でテスト用の時報を送信
      const testDate = new Date();
      
      // 直接AI文章生成を実行
      const aiMessage = await generateTimeReportMessage(testHour, testDate);
      
      // 埋め込みメッセージを作成
      const channel = client.channels.cache.get(TIME_REPORT_CHANNEL_ID);
      if (channel) {
        const embed = new EmbedBuilder()
          .setTitle('🕐 時報テスト（AI文章生成）')
          .setDescription(aiMessage)
          .setColor(0x5865F2)
          .setTimestamp(testDate)
          .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

        await channel.send({ embeds: [embed] });
        await interaction.editReply({ content: `時報テストを送信しました（${testHour}時、AI文章生成）。\n生成されたメッセージ: ${aiMessage}` });
      } else {
        await interaction.editReply({ content: '時報チャンネルが見つかりません。' });
      }
      
    } catch (error) {
      console.error('時報テストコマンドでエラー:', error);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: 'エラーが発生しました。' });
      }
      return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
    }
  }
});



// Discordボットとしてログイン
// セキュリティ: 環境変数の存在確認
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN環境変数が設定されていません');
  console.error('Koyebでの設定方法:');
  console.error('1. Koyebダッシュボードでアプリを選択');
  console.error('2. Settings > Environment Variables に移動');
  console.error('3. DISCORD_TOKEN = your_discord_bot_token を追加');
  console.error('4. アプリを再デプロイ');
  process.exit(1);
}

// GROQ_API_KEYは時報機能にのみ必要なので、設定されていなくてもボットは起動する
if (!process.env.GROQ_API_KEY) {
  console.warn('GROQ_API_KEY環境変数が設定されていません');
  console.warn('時報機能は無効になりますが、ボットは起動します');
}

// Discordボットのログイン（エラーハンドリング付き）
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('❌ Discordボットのログインに失敗しました:');
  console.error('エラー:', error.message);
  console.error('コード:', error.code);
  
  if (error.code === 'TokenInvalid') {
    console.error('');
    console.error('🔧 解決方法:');
    console.error('1. Discord Developer Portal (https://discord.com/developers/applications) にアクセス');
    console.error('2. アプリケーションを選択');
    console.error('3. Bot セクションでトークンを確認/再生成');
    console.error('4. Koyebで環境変数 DISCORD_TOKEN を更新');
    console.error('5. アプリを再デプロイ');
    console.error('');
    console.error('⚠️ 注意: トークンは以下の形式である必要があります:');
    console.error('   - 長さ: 約70文字');
    console.error('   - 形式: [数字].[文字列].[文字列]');
    console.error('   - 例: 123456789012345678.abcdefghijklmnop.ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  }
  
  process.exit(1);
});

// Webサーバーを起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}. Ready for Uptime Robot.`);
});