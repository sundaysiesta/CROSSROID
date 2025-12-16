// /anonymous のユーザーごとのクールダウン管理（30秒）
const ANONYMOUS_COOLDOWN_MS = 20 * 1000;

// 匿名投稿の累積ペナルティ設定 (1日ごとの発言回数に基づく)
const ANONYMOUS_COOLDOWN_TIERS = [
    { limit: 3, time: 20 * 1000 },       // 1-3回目: 20秒
    { limit: 10, time: 60 * 1000 },      // 4-10回目: 1分
    { limit: 20, time: 5 * 60 * 1000 },  // 11-20回目: 5分
    { limit: Infinity, time: 30 * 60 * 1000 } // 21回目以降: 30分
];

// 「ダサい名札」用の単語リスト
const ANONYMOUS_NAMING_PREFIXES = [
    '弱そうな', '陰湿な', '間の抜けた', '騒がしい', '哀れな', '勘違いした', '空気の読めない',
    '不幸な', '無能な', '幼稚な', '自意識過剰な', '暇を持て余した', '必死な', '痛々しい', "チノ学院みたいな", "アスペっぽい", "オナニーずっとしてそうな"
];

const ANONYMOUS_NAMING_SUFFIXES = [
    'スライム', 'ゴブリン', '囚人', 'ピエロ', '量産型', 'ニート',
    'オタク', 'こどおじ', 'ネット弁慶', 'かまってちゃん', '被害妄想', '見習い', 'モブ', "弱者男性"
];

const ELITE_NAMING_PREFIXES = [
    '高貴な', '選ばれし', '優雅な', '天才的な', '神に愛された', '伝説の', '覚醒した',
    '至高の', '黄金の', 'SSR', '課金した', '徳を積んだ', '上級', 'エリート'
];

const ELITE_NAMING_SUFFIXES = [
    '貴族', '騎士', '英雄', '覇者', '大富豪', '将軍', '賢者',
    'マスター', 'キング', 'プレジデント', 'オーナー', '株主', 'VIP'
];

// 自動代行投稿（メディア）のユーザーごとのクールダウン管理（20秒）
const AUTO_PROXY_COOLDOWN_MS = 15 * 1000;

// 特定ワード自動代行のユーザーごとのクールダウン管理（30秒）
const WORD_PROXY_COOLDOWN_MS = 15 * 1000;

// フィルタリング対象のワードリスト（ワイルドカード対応）
const FILTERED_WORDS = [
    '*5歳*', '*6歳*', '*7歳*', '*8歳*', '*9歳*', '*10歳*', '*11歳*', '*12歳*', '*13歳*', '*14歳*', '*15歳*', '*16歳*', '*17歳*', '*18歳未満*',
    '*JC*', '*JK*', '*JS*', '*じぽ*', '*ジポ*', '*ペド*', '*ぺど*', '*ロリ*', '*ろり*',
    '*園児*', '*高校生*', '*児ポ*', '*児童ポルノ*', '*女子高生*', '*女子小学生*', '*女子中学生*', '*小学生*', '*少女*', '*中学生*', '*低学年*', '*未成年*', '*幼児*', '*幼女*', '*幼稚園*',
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
const FORCE_PROXY_ROLE_ID = '1431905155913089133';

// 上級ロメダ民ロールID (ブーストロール)
const ELITE_ROLE_ID = '1433804919315628032';

// レベル10ロールID
const LEVEL_10_ROLE_ID = '1369627346201481239';

// 現在の世代ロールID
const CURRENT_GENERATION_ROLE_ID = '1433777496767074386';

// メインチャンネルID
const MAIN_CHANNEL_ID = '1431905157657923646';

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

// 画像削除ログチャンネルID
const IMAGE_DELETE_LOG_CHANNEL_ID = '1431905160875212864';

// bumpコマンドのクールダウン管理
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2時間

// VC通知のクールダウン管理（30分）
const VC_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30分

// VC通知対象人数
const VC_NOTIFY_THRESHOLDS = [10, 15, 20, 25];

// ランダムメンションコマンドのクールダウン管理（30秒）
const RANDOM_MENTION_COOLDOWN_MS = 30 * 1000; // 30秒

module.exports = {
    ANONYMOUS_COOLDOWN_MS,
    ANONYMOUS_COOLDOWN_TIERS,
    ANONYMOUS_NAMING_PREFIXES,
    ANONYMOUS_NAMING_SUFFIXES,
    ELITE_NAMING_PREFIXES,
    ELITE_NAMING_SUFFIXES,
    AUTO_PROXY_COOLDOWN_MS,
    WORD_PROXY_COOLDOWN_MS,
    FILTERED_WORDS,
    ALLOWED_ROLE_IDS,
    FORCE_PROXY_ROLE_ID,
    LEVEL_10_ROLE_ID,
    CURRENT_GENERATION_ROLE_ID,
    MAIN_CHANNEL_ID,
    TIME_REPORT_HOURS,
    TIME_REPORT_CHANNEL_ID,
    CLUB_CATEGORY_IDS,
    VC_CATEGORY_ID,
    HIGHLIGHT_CHANNEL_ID,
    IMAGE_DELETE_LOG_CHANNEL_ID,
    BUMP_COOLDOWN_MS,
    VC_NOTIFY_COOLDOWN_MS,
    VC_NOTIFY_THRESHOLDS,
    RANDOM_MENTION_COOLDOWN_MS,
    EVENT_CATEGORY_ID: '1431905157657923645',
    EVENT_NOTIFY_CHANNEL_ID: '1433779821363728505',
    EVENT_ADMIN_ROLE_ID: '1449783668049576107',
    ADMIN_ROLE_ID: '1449783351459319839',
    SECRET_SALT: process.env.SECRET_SALT || 'WiJr8dS5IHdtp1KiCKOLrmoE0gMK0Ib8X1NsplGcQfqcj1CUUdy3J3ok7h0Lu4CDPGbYnIxoq27N08OcLrf4IGK8v6aJ68VTnMh6Iymetm4NOvAio4WG7j17IWN7s8CO',
    ELITE_NAMING_PREFIXES,
    ELITE_NAMING_SUFFIXES,
    ELITE_ROLE_ID
};
