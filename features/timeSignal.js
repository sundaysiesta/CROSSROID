const { EmbedBuilder } = require('discord.js');
const Groq = require('groq-sdk');
const {
    TIME_REPORT_HOURS,
    TIME_REPORT_CHANNEL_ID
} = require('../constants');
const {
    getDayType,
    isJapaneseHoliday,
    getHolidayName,
    getSchoolVacationType
} = require('../utils');

// Groq API設定
let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({
        apiKey: process.env.GROQ_API_KEY
    });
}

// Groq APIを使用した時報文章生成関数
async function generateTimeReportMessage(hour, date) {
    // Groq APIが利用できない場合はフォールバックメッセージを返す
    if (!groq) {
        const timeGreeting = hour === 0 ? '深夜0時' : hour === 3 ? '深夜3時' : hour === 6 ? '朝6時' :
            hour === 9 ? '朝9時' : hour === 12 ? '昼12時' : hour === 15 ? '午後3時' :
                hour === 18 ? '夕方6時' : hour === 21 ? '夜9時' : `${hour}時`;
        return `${timeGreeting}だダラァ！今日も作業所で頑張るダラァ！`;
    }

    try {
        const dayType = getDayType(date);
        const isHoliday = isJapaneseHoliday(date);
        const holidayName = isHoliday ? getHolidayName(date) : null;
        const vacationType = getSchoolVacationType(date);

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
        if (hour === 3) timeGreeting = '深夜3時';
        else if (hour === 6) timeGreeting = '朝6時';
        else if (hour === 9) timeGreeting = '朝9時';
        else if (hour === 12) timeGreeting = '昼12時';
        else if (hour === 15) timeGreeting = '午後3時';
        else if (hour === 18) timeGreeting = '夕方6時';
        else if (hour === 21) timeGreeting = '夜9時';
        else if (hour === 0) timeGreeting = '深夜0時';

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
async function sendTimeReport(client, hour, date) {
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
        if (hour === 0) timeTitle = '黒須直輝が午前0時ぐらいをおしらせします';
        else if (hour === 3) timeTitle = '黒須直輝が午前3時ぐらいをおしらせします';
        else if (hour === 6) timeTitle = '黒須直輝が午前6時ぐらいをおしらせします';
        else if (hour === 9) timeTitle = '黒須直輝が午前9時ぐらいをおしらせします';
        else if (hour === 12) timeTitle = '黒須直輝が午後0時ぐらいをおしらせします';
        else if (hour === 15) timeTitle = '黒須直輝が午後3時ぐらいをおしらせします';
        else if (hour === 18) timeTitle = '黒須直輝が午後6時ぐらいをおしらせします';
        else if (hour === 21) timeTitle = '黒須直輝が午後9時ぐらいをおしらせします';
        else timeTitle = `黒須直輝が${hour}時ぐらいをおしらせします`;

        // 日本時間でタイムスタンプを設定
        const japanTime = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

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

// 時報スケジューラーの設定
function scheduleTimeReports(client) {
    const now = new Date();
    const japanTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

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

    console.log(`次の時報予定: ${nextTimeReport.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

    setTimeout(async () => {
        // 日本時間で現在時刻を取得
        const now = new Date();
        const japanTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
        const reportHour = japanTime.getHours();

        await sendTimeReport(client, reportHour, japanTime);

        // 次の時報をスケジュール
        scheduleTimeReports(client);
    }, timeUntilNext);
}

// モジュール初期化関数
function setup(client) {
    if (process.env.GROQ_API_KEY) {
        scheduleTimeReports(client);
        console.log('時報スケジューラーを開始しました');
    } else {
        console.warn('GROQ_API_KEYが設定されていないため、時報スケジューラーをスキップしました');
    }
}

module.exports = {
    setup,
    generateTimeReportMessage, // for commands/tests
    sendTimeReport // for commands/tests
};
