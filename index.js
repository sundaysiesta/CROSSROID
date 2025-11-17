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
  '*5歳*', '*6歳*', '*7歳*', '*8歳*', '*9歳*', '*10歳*', '*11歳*', '*12歳*', '*13歳*', '*14歳*', '*15歳*', '*16歳*', '*17歳*', '*18歳未満*',
  '*JC*', '*JK*', '*JS*', '*じぽ*', '*ジポ*', '*ペド*', '*ぺど*', '*ロリ*', '*ろり*',
  '*園児*', '*高校生*', '*児ポ*', '*児童ポルノ*', '*女子高生*', '*女子小学生*', '*女子中学生*', '*小学生*', '*少女*', '*中学生*', '*低学年*', '*未成年*', '*幼児*','*幼女*', '*幼稚園*',
  '*小学*', '*中学*', '*高校*',
  '*小1*', '*小2*', '*小3*', '*小4*', '*小5*', '*小6*',
  '*中1*', '*中2*', '*中3*',
  '*高1*', '*高2*', '*高3*',
  '*小１*', '*小２*', '*小３*', '*小４*', '*小５*', '*小６*',
  '*中１*', '*中２*', '*中３*',
  '*高１*', '*高２*', '*高３*',
  '*ショタ*', '*しょた*',
  '*低年齢*', '*ガキ*', '*子供*', '*まんこ*', '*マンコ*', '*レイプ*', '*セックス*', '*おっぱい*',
];

// 特定のロールIDのリスト（代行投稿をスキップするロール）
const ALLOWED_ROLE_IDS = [
  '1431905155938258988',
  '1431905155938258989',
  '1431905155938258990',
  '1431905155938258991',
  '1431905155938258992',
  '1431905155938258993',
  '1431905155938258994',
  '1431905155955294290',
  '1431905155955294291',
  '1431905155955294292',
  '1431905155955294293',
  '1431905155955294294',
  '1431905155955294295',
  '1431905155955294296',
  '1431905155955294297',
  '1431905155955294298',
  '1431905155955294299',
  '1431905155984392303',
  '1433777496767074386'
];

// 強制代行投稿ロールID（このロールを持っている人は代行投稿される）
const FORCE_PROXY_ROLE_ID = '1416291713009582172';

// レベル10ロールID
const LEVEL_10_ROLE_ID = '1369627346201481239';

// 現在の世代ロールID
const CURRENT_GENERATION_ROLE_ID = '1433777496767074386';

// メインチャンネルID
const MAIN_CHANNEL_ID = '1431905157657923646';

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
const TIME_REPORT_CHANNEL_ID = '1431905157657923646';

// 部活カテゴリID
const CLUB_CATEGORY_IDS = [
  '1417350444619010110',
  '1369627451801604106', 
  '1396724037048078470'
];

// VCカテゴリID
const VC_CATEGORY_ID = '1369659877735137342';


// ハイライトチャンネルID
const HIGHLIGHT_CHANNEL_ID = '1406942589738815633';

// ハイライト済みメッセージを追跡（重複投稿防止）
const highlightedMessages = new Set();

// 画像削除ログチャンネルID
const IMAGE_DELETE_LOG_CHANNEL_ID = '1431905160875212864';

// 今日世代を獲得した人を追跡
const todayGenerationWinners = new Set();

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

// 削除されたメッセージの情報を保存（削除ボタン用）
const deletedMessageInfo = new Map(); // key: messageId, value: { content, author, attachments, channel }

// VC通知のクールダウン管理（30分）
const VC_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30分
const vcNotifyCooldowns = new Map(); // key: channelId_threshold, value: lastNotifyTime
const vcMemberCounts = new Map(); // key: channelId, value: { current: number, previous: number }

// VC通知対象人数
const VC_NOTIFY_THRESHOLDS = [10, 15, 20, 25];

// ランダムメンションコマンドのクールダウン管理（30秒）
const RANDOM_MENTION_COOLDOWN_MS = 30 * 1000; // 30秒
const randomMentionCooldowns = new Map(); // key: userId, value: lastUsedEpochMs

// メッセージカウント機能（削除済み）

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
  
  // 削除されたメッセージ情報をクリア（古いもの）
  for (const [messageId, info] of deletedMessageInfo.entries()) {
    // 1時間以上前の情報は削除
    if (Date.now() - (info.timestamp || 0) > oneHourAgo) {
      deletedMessageInfo.delete(messageId);
    }
  }
  
  // VC通知のクールダウンクリア
  for (const [cooldownKey, lastNotify] of vcNotifyCooldowns.entries()) {
    if (lastNotify < oneHourAgo) {
      vcNotifyCooldowns.delete(cooldownKey);
    }
  }
  
  // VC人数データのクリア（古いもの）
  for (const [channelId, data] of vcMemberCounts.entries()) {
    // 1時間以上前のデータは削除
    if (Date.now() - (data.timestamp || 0) > oneHourAgo) {
      vcMemberCounts.delete(channelId);
    }
  }
  
  // ランダムメンションのクールダウンクリア
  for (const [userId, lastUsed] of randomMentionCooldowns.entries()) {
    if (lastUsed < oneHourAgo) {
      randomMentionCooldowns.delete(userId);
    }
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

    const prompt = `あなたは障害者で作業所で働いているヤンキー口調のキャラクターです。語尾に「ダラァ」をつけて話します。

現在の状況：
- 時間: ${timeGreeting} (${hour}時)
- 日付: ${month}月${day}日 (${currentDay})
- 季節: ${season}
- 状況: ${dateInfo}

この時間と状況に合わせた短い時報メッセージを作成してください。40文字以内で、キャラクターの特徴を活かして簡潔に表現してください。

キャラクター設定：
- 障害者で作業所勤務
- ヤンキー口調（語尾に「ダラァ」）
- ミリタリーオタク
- 虚言癖
- 彼女がいると嘘をつく
- パソコン部品に詳しい

時間と状況に応じて、40文字以内の短いメッセージを作成してください。`;

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
    
    // 時間に応じたタイトルを生成
    let timeTitle = '';
    if (hour === 0) {
      timeTitle = '黒須直輝が午前0時ぐらいをおしらせします';
    } else if (hour === 3) {
      timeTitle = '黒須直輝が午前3時ぐらいをおしらせします';
    } else if (hour === 6) {
      timeTitle = '黒須直輝が午前6時ぐらいをおしらせします';
    } else if (hour === 9) {
      timeTitle = '黒須直輝が午前9時ぐらいをおしらせします';
    } else if (hour === 12) {
      timeTitle = '黒須直輝が午後0時ぐらいをおしらせします';
    } else if (hour === 15) {
      timeTitle = '黒須直輝が午後3時ぐらいをおしらせします';
    } else if (hour === 18) {
      timeTitle = '黒須直輝が午後6時ぐらいをおしらせします';
    } else if (hour === 21) {
      timeTitle = '黒須直輝が午後9時ぐらいをおしらせします';
    } else {
      timeTitle = `黒須直輝が${hour}時ぐらいをおしらせします`;
    }

    // 日本時間でタイムスタンプを設定
    const japanTime = new Date(date.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));

    // 埋め込みメッセージを作成
    const embed = new EmbedBuilder()
      .setTitle(timeTitle)
      .setDescription(message)
      .setColor(0x5865F2) // 青色
      .setTimestamp(japanTime)
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


  // VC通知の定期実行（5分ごと）
  setInterval(async () => {
    try {
      await checkAndNotifyVCThresholds();
    } catch (error) {
      console.error('定期VC通知チェックでエラー:', error);
    }
  }, 5 * 60 * 1000); // 5分ごと

  // VCチャンネル名の定期更新（削除済み）

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
      // 日本時間で現在時刻を取得
      const now = new Date();
      const japanTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
      const reportHour = japanTime.getHours();
      
      await sendTimeReport(reportHour, japanTime);
      
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

  // VCチャンネル名の初期化（削除済み）



  // 日付が変わったときに世代獲得者リストとメッセージ数をリセット（毎日0時に実行）
  const now = new Date();
  const japanTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  const tomorrow = new Date(japanTime);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const msUntilMidnight = tomorrow.getTime() - japanTime.getTime();
  
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
  
  // 全角数字を半角数字に変換してから検索
  const normalizedText = text
    .replace(/[０-９]/g, (match) => String.fromCharCode(match.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
  const normalizedWord = word
    .replace(/[０-９]/g, (match) => String.fromCharCode(match.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
  
  // 大文字小文字を区別せずに検索
  return normalizedText.includes(normalizedWord);
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

// VC通知機能
async function checkAndNotifyVCThresholds() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const vcCategory = guild.channels.cache.get(VC_CATEGORY_ID);
    if (!vcCategory || vcCategory.type !== 4) return;

    const voiceChannels = vcCategory.children.cache.filter(ch => 
      ch.type === 2 && // ボイスチャンネル
      ch.members && ch.members.size > 0
    );

    for (const vc of voiceChannels.values()) {
      const currentCount = vc.members.size;
      const channelId = vc.id;
      
      // 前回の人数を取得
      const previousData = vcMemberCounts.get(channelId) || { current: 0, previous: 0 };
      const previousCount = previousData.current;
      
      // 現在の人数を更新
      vcMemberCounts.set(channelId, { current: currentCount, previous: previousCount, timestamp: Date.now() });
      
      // 閾値を超えた場合のみチェック（人数の増減に関係なく）
      for (const threshold of VC_NOTIFY_THRESHOLDS) {
        // 閾値を超えたかチェック（前回は閾値以下、今回は閾値超過）
        if (previousCount < threshold && currentCount >= threshold) {
          const cooldownKey = `${channelId}_${threshold}`;
          const lastNotify = vcNotifyCooldowns.get(cooldownKey) || 0;
          
          // クールダウンチェック
          if (Date.now() - lastNotify < VC_NOTIFY_COOLDOWN_MS) {
            continue;
          }
          
          // 通知を送信
          await sendVCNotification(vc, currentCount, threshold);
          
          // クールダウンを設定
          vcNotifyCooldowns.set(cooldownKey, Date.now());
        }
      }
    }
  } catch (error) {
    console.error('VC通知チェックでエラー:', error);
  }
}

// VC通知を送信
async function sendVCNotification(vc, memberCount, threshold) {
  try {
    const notifyChannel = client.channels.cache.get('1415336647284883528');
    if (!notifyChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('🎤 VC人数通知')
      .setDescription(`**${vc.name}** の参加人数が **${threshold}人** を超えました！`)
      .addFields(
        { name: '現在の参加人数', value: `${memberCount}人`, inline: true },
        { name: 'VC', value: vc.toString(), inline: true },
        { name: '閾値', value: `${threshold}人`, inline: true }
      )
      .setColor(0x00FF00) // 緑色
      .setTimestamp(new Date())
      .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

    await notifyChannel.send({ embeds: [embed] });
    console.log(`VC通知を送信しました: ${vc.name} (${memberCount}人, 閾値: ${threshold}人)`);
  } catch (error) {
    console.error('VC通知送信でエラー:', error);
  }
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
    
    // 既にハイライト済みのメッセージは無視
    if (highlightedMessages.has(message.id)) return;
    
    // リアクションの総数を計算
    const totalReactions = Array.from(message.reactions.cache.values())
      .reduce((sum, reaction) => sum + reaction.count, 0);
    
    // 5つ以上のリアクションがついた場合
    if (totalReactions >= 5) {
      // ハイライト済みとしてマーク
      highlightedMessages.add(message.id);
      
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

// リアクション削除時の処理（ハイライト済みメッセージの追跡をリセット）
client.on('messageReactionRemove', async (reaction, user) => {
  try {
    // ボットのリアクションは無視
    if (user.bot) return;
    
    // メッセージを取得
    const message = reaction.message;
    
    // ボットのメッセージは無視
    if (message.author.bot) return;
    
    // リアクションの総数を再計算
    const totalReactions = Array.from(message.reactions.cache.values())
      .reduce((sum, reaction) => sum + reaction.count, 0);
    
    // 5つ未満になった場合はハイライト済みフラグをリセット
    if (totalReactions < 5 && highlightedMessages.has(message.id)) {
      highlightedMessages.delete(message.id);
      console.log(`ハイライト済みフラグをリセットしました: ${message.id} (${totalReactions}リアクション)`);
    }
  } catch (error) {
    console.error('ハイライト機能（リアクション削除）でエラー:', error);
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
          // webhookエラーでも処理は続行
        }
        
        // webhookが取得できた場合のみログを送信
        if (webhook) {
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
          
          try {
            await webhook.send({ 
              embeds: [embed],
              files: files,
              username: 'CROSSROID Image Log',
              avatarURL: client.user.displayAvatarURL()
            });
            console.log(`画像削除ログをwebhookで投稿しました: ${message.id}`);
          } catch (sendError) {
            console.error('webhook送信でエラー:', sendError);
          }
        }
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
      
      // 削除されたメッセージの情報を保存（削除ボタン用）
      deletedMessageInfo.set(webhookMessage.id, {
        content: originalContent,
        author: originalAuthor,
        attachments: originalAttachments,
        channel: message.channel,
        originalMessageId: message.id,
        timestamp: Date.now()
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
            .setTitle('🎉 第19世代おめでとうございます！')
            .setDescription(`${newMember.user} さんがレベル10に到達し、第19世代ロールを獲得しました！`)
            .setColor(0xFFD700) // 金色
            .setThumbnail(newMember.user.displayAvatarURL())
            .addFields(
              { name: '獲得したロール', value: `<@&${CURRENT_GENERATION_ROLE_ID}>`, inline: true },
              { name: '世代', value: '第19世代', inline: true },
              { name: 'レベル', value: '10', inline: true }
            )
            .setTimestamp(new Date())
            .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });
          
          await mainChannel.send({ 
            content: `🎊 ${newMember.user} さん、第19世代獲得おめでとうございます！🎊`,
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
        // 削除されるメッセージの情報を取得
        const messageInfo = deletedMessageInfo.get(interaction.message.id);
        
        // メッセージを削除
        await interaction.message.delete();
        
        // 削除されたメッセージの情報をクリーンアップ
        deletedMessageInfo.delete(interaction.message.id);
        
        // 画像・動画ファイルがある場合は削除ログに送信
        if (messageInfo && messageInfo.attachments && messageInfo.attachments.length > 0) {
          const hasMedia = messageInfo.attachments.some(attachment => isImageOrVideo(attachment));
          
          if (hasMedia) {
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
                // webhookエラーでも処理は続行
              }
              
              // webhookが取得できた場合のみログを送信
              if (webhook) {
                const embed = new EmbedBuilder()
                  .setTitle('🗑️ 画像削除ログ（ユーザー削除）')
                  .addFields(
                    { name: 'チャンネル', value: messageInfo.channel.toString(), inline: true },
                    { name: '投稿者', value: messageInfo.author.toString(), inline: true },
                    { name: '削除者', value: interaction.user.toString(), inline: true },
                    { name: '削除時刻', value: new Date().toLocaleString('ja-JP'), inline: true }
                  )
                  .setColor(0xFF6B6B) // 赤色
                  .setTimestamp(new Date())
                  .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });
                
                // メッセージの内容を追加（長すぎる場合は省略）
                let content = messageInfo.content || '';
                if (content.length > 200) {
                  content = content.slice(0, 197) + '...';
                }
                if (content) {
                  embed.addFields({ name: '内容', value: content, inline: false });
                }
                
                // 削除された画像を添付
                const files = [];
                for (const attachment of messageInfo.attachments) {
                  if (isImageOrVideo(attachment)) {
                    files.push({
                      attachment: attachment.url,
                      name: attachment.name
                    });
                  }
                }
                
                try {
                  await webhook.send({ 
                    embeds: [embed],
                    files: files,
                    username: 'CROSSROID Image Log',
                    avatarURL: client.user.displayAvatarURL()
                  });
                  console.log(`ユーザー削除による画像削除ログをwebhookで投稿しました: ${interaction.message.id}`);
                } catch (sendError) {
                  console.error('webhook送信でエラー:', sendError);
                }
              }
            }
          }
        }
        
        // 削除完了の応答
        try {
          await interaction.reply({ content: 'メッセージを削除しました。', ephemeral: true });
        } catch (replyError) {
          console.error('削除完了の応答でエラー:', replyError);
        }
        
      } catch (error) {
        console.error('メッセージ削除でエラーが発生しました:', error);
        try {
          await interaction.reply({ content: 'メッセージの削除に失敗しました。', ephemeral: true });
        } catch (replyError) {
          console.error('エラー応答でエラー:', replyError);
        }
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
      const notifyChannel = interaction.guild.channels.cache.get('1431905157657923646');
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
          .setTitle('🎉 第19世代おめでとうございます！（テスト）')
          .setDescription(`${targetUser} さんがレベル10に到達し、第19世代ロールを獲得しました！`)
          .setColor(0xFFD700) // 金色
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: '獲得したロール', value: `<@&${CURRENT_GENERATION_ROLE_ID}>`, inline: true },
            { name: '世代', value: '第19世代', inline: true },
            { name: 'レベル', value: '10', inline: true }
          )
          .setTimestamp(new Date())
          .setFooter({ text: 'CROSSROID (テスト)', iconURL: client.user.displayAvatarURL() });
        
        await mainChannel.send({ 
          content: `🎊 ${targetUser} さん、第19世代獲得おめでとうございます！🎊（テスト）`,
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
  
  if (interaction.commandName === 'random_mention') {
    try {
      // ユーザー別クールダウンチェック
      const userId = interaction.user.id;
      const lastUsed = randomMentionCooldowns.get(userId) || 0;
      const now = Date.now();
      
      if (now - lastUsed < RANDOM_MENTION_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((RANDOM_MENTION_COOLDOWN_MS - (now - lastUsed)) / 1000);
        return interaction.reply({ 
          content: `⏰ クールダウン中です。あと${remainingSeconds}秒後に使用できます。`, 
          ephemeral: true 
        });
      }

      // サーバーのメンバーを取得
      const guild = interaction.guild;
      if (!guild) {
        return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
      }

      // 即座に応答を送信（処理中であることを示す）
      await interaction.deferReply();

      // ボット以外のメンバーを取得（キャッシュから）
      const members = guild.members.cache;
      const humanMembers = members.filter(member => !member.user.bot);
      
      if (humanMembers.size === 0) {
        // キャッシュにメンバーがいない場合はfetchを試行
        try {
          const fetchedMembers = await guild.members.fetch();
          const fetchedHumanMembers = fetchedMembers.filter(member => !member.user.bot);
          if (fetchedHumanMembers.size === 0) {
            return interaction.editReply({ content: 'メンバーが見つかりません。' });
          }
          const memberArray = Array.from(fetchedHumanMembers.values());
          const randomMember = memberArray[Math.floor(Math.random() * memberArray.length)];
          
          // メンション+さんおはようございます！のメッセージを送信
          await interaction.editReply({ 
            content: `${randomMember}さんおはようございます！`,
            allowedMentions: { users: [randomMember.id] }
          });

          // クールダウンを設定
          randomMentionCooldowns.set(userId, now);

          console.log(`ランダムメンションを送信しました: ${randomMember.user.tag} (${randomMember.id})`);
          return;
        } catch (fetchError) {
          console.error('メンバー取得でエラー:', fetchError);
          return interaction.editReply({ content: 'メンバーの取得に失敗しました。' });
        }
      }

      // ランダムでメンバーを選択
      const memberArray = Array.from(humanMembers.values());
      const randomMember = memberArray[Math.floor(Math.random() * memberArray.length)];

      // メンション+さんおはようございます！のメッセージを送信
      await interaction.editReply({ 
        content: `${randomMember}さんおはようございます！`,
        allowedMentions: { users: [randomMember.id] }
      });

      // クールダウンを設定
      randomMentionCooldowns.set(userId, now);

      console.log(`ランダムメンションを送信しました: ${randomMember.user.tag} (${randomMember.id})`);
      
    } catch (error) {
      console.error('ランダムメンションコマンドでエラー:', error);
      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.editReply({ content: 'エラーが発生しました。' });
        } catch (editError) {
          console.error('editReplyでもエラーが発生:', editError);
        }
      } else {
        try {
          await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
        } catch (replyError) {
          console.error('replyでもエラーが発生:', replyError);
        }
      }
    }
  }
  
  // message_count コマンド（削除済み）
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