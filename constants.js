// /anonymous のユーザーごとのクールダウン管理（30秒）
const ANONYMOUS_COOLDOWN_MS = 20 * 1000;

// 匿名投稿の累積ペナルティ設定 (1日ごとの発言回数に基づく)
const ANONYMOUS_COOLDOWN_TIERS = [
	{ limit: 3, time: 20 * 1000 }, // 1-3回目: 20秒
	{ limit: 10, time: 60 * 1000 }, // 4-10回目: 1分
	{ limit: 20, time: 5 * 60 * 1000 }, // 11-20回目: 5分
	{ limit: Infinity, time: 30 * 60 * 1000 }, // 21回目以降: 30分
];

// 名札用の単語リスト（ダサい名札と上級名札を統合）
const NAMING_PREFIXES = [
	'君と彼女と彼女と',
	'根本',
	'ろめ田',
	'短小包茎',
	'大宮別所的',
	'超高校級の',
	'You is',
	'大森',
	'ラスボスは',
	'童貞の',
	'大賀',
	'放課後',
	'女は',
	'黒須',
	'チノ学院みたいな',
	'アスペ',
	'エロそうな',
	'ガチゲイ',
	'無名',
	'柄澤',
	'努力と',
	'黒い',
	'イキそうな',
	'工藤',
	'覚醒',
	'障害者',
	'破壊',
	'裏',
	'10万円の',
	'ダウニー',
	'上級',
	'全裸',
];

const NAMING_SUFFIXES = [
	'UFO',
	'メンヘラ',
	'スプーン',
	'直輝',
	'シャーペン',
	'ニート',
	'亭',
	'チンポ',
	'韓国人',
	'蒼',
	'生活保護受給者',
	'未來',
	'根性',
	'弱者男性',
	'黒人',
	'アンダマン',
	'ユンボ',
	'グループホーム',
	'ピザ',
	'精子',
	'尿道',
	'金玉',
	'サボテン弁当',
	'やよい軒',
	'ロメダ民',
	'イグアナル',
	'王',
];

// 代行投稿のクールダウン(10秒)
const PROXY_COOLDOWN_MS = 10 * 1000;

// フィルタリング対象のワードリスト（ワイルドカード対応）
const FILTERED_WORDS = [
	'*5歳*',
	'*6歳*',
	'*7歳*',
	'*8歳*',
	'*9歳*',
	'*10歳*',
	'*11歳*',
	'*12歳*',
	'*13歳*',
	'*14歳*',
	'*15歳*',
	'*16歳*',
	'*17歳*',
	'*18歳未満*',
	'*JC*',
	'*JK*',
	'*JS*',
	'*じぽ*',
	'*ジポ*',
	'*ペド*',
	'*ぺど*',
	'*ロリ*',
	'*ろり*',
	'*園児*',
	'*高校生*',
	'*児ポ*',
	'*児童ポルノ*',
	'*女子高生*',
	'*女子小学生*',
	'*女子中学生*',
	'*小学生*',
	'*少女*',
	'*中学生*',
	'*低学年*',
	'*未成年*',
	'*幼児*',
	'*幼女*',
	'*幼稚園*',
	'*小学*',
	'*中学*',
	'*高校*',
	'*小1*',
	'*小2*',
	'*小3*',
	'*小4*',
	'*小5*',
	'*小6*',
	'*中1*',
	'*中2*',
	'*中3*',
	'*高1*',
	'*高2*',
	'*高3*',
	'*小１*',
	'*小２*',
	'*小３*',
	'*小４*',
	'*小５*',
	'*小６*',
	'*中１*',
	'*中２*',
	'*中３*',
	'*高１*',
	'*高２*',
	'*高３*',
	'*ショタ*',
	'*しょた*',
	'*低年齢*',
	'*ガキ*',
	'*子供*',
	'*まんこ*',
	'*マンコ*',
	'*レイプ*',
	'*セックス*',
	'*おっぱい*',
	'BAN',
	'エプスタイン',
	'*グルーミング*',
	'*買春*',
	'*売春*',
	'*パパ活*',
	'*ママ活*',
	'*P活*',
	'*JKビジネス*',
	'*家出*',
	'*泊めて*',
	'*神待ち*',
	'*裏垢*',
	'*オフパコ*',
	'*セフレ*',
	'*死*',
	'*殺*',
	'*〒*',
	'*市*',
	'*県*',
	'*都*',
	'*町*',
	'*台*',
	'*080*',
	'*090*',
	'*070*',
	'*大麻*',
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
	'1433777496767074386',
];

// 強制代行投稿ロールID（このロールを持っている人は代行投稿される）
const FORCE_PROXY_ROLE_ID = '1431905155913089133';

// 上級ロメダ民ロールID (ブーストロール)
const ELITE_ROLE_ID = '1433804919315628032';

// レベル10ロールID
const LEVEL_10_ROLE_ID = '1431905155871281206';

// 現在の世代ロールID
const CURRENT_GENERATION_ROLE_ID = '1433777496767074386';

// ショップロールID（ロメダの管理ログ・廃部ログ・過去ログ閲覧権限）
const SHOP_LOG_VIEWER_ROLE_ID = '1431905155913089132';
// ショップロールID（絵文字作成権限）
const SHOP_EMOJI_CREATOR_ROLE_ID = '1431905155913089131';
// ショップロールID（サーバータグ変更権限）
const SHOP_NICKNAME_CHANGE_ROLE_ID = '1431905155913089130'; // TODO: 実際のロールIDに置き換える必要があります

// メインチャンネルID (ロメダメイン雑談)
const MAIN_CHANNEL_ID = '1451866555750158460';

// 時報機能の設定
const TIME_REPORT_HOURS = [6, 9, 12, 15, 18, 21, 24, 3]; // 24時は0時として扱う
const TIME_REPORT_CHANNEL_ID = '1451866555750158460';

// 部活カテゴリID
const CLUB_CATEGORY_IDS = ['1431905157741805582', '1431905157926359160', '1431905160128626777'];

// VCカテゴリID
const VC_CATEGORY_ID = '1369659877735137342';

// ハイライトチャンネルID
const HIGHLIGHT_CHANNEL_ID = '1406942589738815633';

// 画像削除ログチャンネルID
const IMAGE_DELETE_LOG_CHANNEL_ID = '1431905160875212864';

// ロメコインログチャンネルID
const ROMECOIN_LOG_CHANNEL_ID = '1431905160875212867';

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
	NAMING_PREFIXES,
	NAMING_SUFFIXES,
	// 後方互換性のため、旧名もエクスポート
	ANONYMOUS_NAMING_PREFIXES: NAMING_PREFIXES,
	ANONYMOUS_NAMING_SUFFIXES: NAMING_SUFFIXES,
	ELITE_NAMING_PREFIXES: NAMING_PREFIXES,
	ELITE_NAMING_SUFFIXES: NAMING_SUFFIXES,
	PROXY_COOLDOWN_MS,
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
	ROMECOIN_LOG_CHANNEL_ID,
	BUMP_COOLDOWN_MS,
	VC_NOTIFY_COOLDOWN_MS,
	VC_NOTIFY_THRESHOLDS,
	RANDOM_MENTION_COOLDOWN_MS,
	EVENT_CATEGORY_ID: '1431905157657923645',
	EVENT_NOTIFY_CHANNEL_ID: '1449794400925519964',
	EVENT_ADMIN_ROLE_ID: '1449783668049576107',
	ADMIN_ROLE_ID: '1449783351459319839', // 治安監査局
	TECHTEAM_ROLE_ID: '1449783668225740942', // 技術開発局
	OWNER_ROLE_ID: '1431905156009693195',
	SECRET_SALT:
		process.env.SECRET_SALT ||
		'WiJr8dS5IHdtp1KiCKOLrmoE0gMK0Ib8X1NsplGcQfqcj1CUUdy3J3ok7h0Lu4CDPGbYnIxoq27N08OcLrf4IGK8v6aJ68VTnMh6Iymetm4NOvAio4WG7j17IWN7s8CO',
	ELITE_ROLE_ID,
	DATABASE_CHANNEL_ID: '1452275340335382629',
	ERRORLOG_CHANNEL_ID: '1452304385806700595',
	RADIATION_ROLE_ID: '1431905155913089124', // 被爆ロール
	SHOP_LOG_VIEWER_ROLE_ID,
	SHOP_EMOJI_CREATOR_ROLE_ID,
	SHOP_NICKNAME_CHANGE_ROLE_ID,
};
