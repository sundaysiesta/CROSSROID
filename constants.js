
// /cronymous のユーザーごとのクールダウン管理（30秒）
const CRONYMOUS_COOLDOWN_MS = 30 * 1000;

// 自動代行投稿（メディア）のユーザーごとのクールダウン管理（20秒）
const AUTO_PROXY_COOLDOWN_MS = 20 * 1000;

// 特定ワード自動代行のユーザーごとのクールダウン管理（30秒）
const WORD_PROXY_COOLDOWN_MS = 30 * 1000;

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
    CRONYMOUS_COOLDOWN_MS,
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
    SECRET_SALT: 'crossroid_v2_secure_salt_2025_xyz' // 外部から推測不可能な文字列
};
