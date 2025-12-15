const crypto = require('crypto');
const {
    JAPANESE_HOLIDAYS_2024,
    JAPANESE_HOLIDAYS_2025,
    SCHOOL_VACATIONS
} = require('./holidays');
const {
    FILTERED_WORDS,
    ALLOWED_ROLE_IDS,
    FORCE_PROXY_ROLE_ID,
    SECRET_SALT
} = require('./constants');

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

// 祝日名取得関数
function getHolidayName(date) {
    const year = date.getFullYear();
    const dateString = date.toISOString().split('T')[0];

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

// ユーザーごと日替わりの英数字IDを生成（旧方式: UTC日基準、英小文字+数字）
function generateDailyUserIdForDate(userId, dateUtc) {
    const y = dateUtc.getUTCFullYear();
    const m = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateUtc.getUTCDate()).padStart(2, '0');
    const dayKey = `${y}${m}${d}`;
    const hash = crypto.createHash('sha256').update(`${userId}:${SECRET_SALT}:${dayKey}`).digest('hex');
    const segment = hash.slice(0, 10);
    const num = parseInt(segment, 16);
    const id36 = num.toString(36).toLowerCase();
    return id36.slice(0, 8).padStart(6, '0');
}

function generateDailyUserId(userId) {
    return generateDailyUserIdForDate(userId, new Date());
}

// ユーザーごと日替わりの英数字IDを生成（ワッチョイ形式）
// 形式: WWWW-DDDD (例: 8f3a-x92z)
// WWWW: 木曜日切替の週次ID
// DDDD: 毎日切替の日次ID

function generateWacchoi(userId, date = new Date()) {
    const dateUtc = new Date(date);

    // --- Weekly ID (Thursday Reset) ---
    // 1970-01-01 is Thursday.
    // We can just take Unix Time / (7 days).
    // However, to ensure it aligns with JST "Thursday 00:00" might be complex,
    // but strictly speaking 5ch uses a specific logic.
    // Here we assume UTC Thursday 00:00 reset for simplicity and consistency.
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    const weekIndex = Math.floor(dateUtc.getTime() / oneWeekMs);

    const weeklyHash = crypto.createHash('sha256').update(`${userId}:${SECRET_SALT}:week:${weekIndex}`).digest('hex');
    // Use first 4 chars, base36 conversion to make it look "ID-like" (alphanumeric)
    // Parsing hex to int then to base36 ensures valid alphanumeric
    const weeklySegment = weeklyHash.slice(0, 10);
    const weeklyNum = parseInt(weeklySegment, 16);
    const weeklyId = weeklyNum.toString(36).toLowerCase().slice(0, 4).padStart(4, '0');

    // --- Daily ID (Daily Reset) ---
    const y = dateUtc.getUTCFullYear();
    const m = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateUtc.getUTCDate()).padStart(2, '0');
    const dayKey = `${y}${m}${d}`;

    const dailyHash = crypto.createHash('sha256').update(`${userId}:${SECRET_SALT}:day:${dayKey}`).digest('hex');
    const dailySegment = dailyHash.slice(0, 10);
    const dailyNum = parseInt(dailySegment, 16);
    const dailyId = dailyNum.toString(36).toLowerCase().slice(0, 4).padStart(4, '0');

    return {
        full: `${weeklyId}-${dailyId}`,
        weekly: weeklyId,
        daily: dailyId
    };
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

module.exports = {
    isJapaneseHoliday,
    getHolidayName,
    getSchoolVacationType,
    getDayType,
    generateDailyUserId,
    generateDailyUserIdForDate,
    generateWacchoi,
    isImageOrVideo,
    containsFilteredWords,
    hasAllowedRole,
    hasForceProxyRole
};
