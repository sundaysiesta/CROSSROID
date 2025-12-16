const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { generateWacchoi, generateDailyUserId, generateDailyUserIdForDate, getHolidayName, getAnonymousName } = require('../utils');
const {
    ANONYMOUS_COOLDOWN_MS,
    ANONYMOUS_COOLDOWN_TIERS,
    BUMP_COOLDOWN_MS,
    RANDOM_MENTION_COOLDOWN_MS,
    CLUB_CATEGORY_IDS,
    MAIN_CHANNEL_ID,
    CURRENT_GENERATION_ROLE_ID,
    TIME_REPORT_CHANNEL_ID,
    EVENT_CATEGORY_ID,
    EVENT_NOTIFY_CHANNEL_ID,
    EVENT_ADMIN_ROLE_ID,

} = require('../constants');
const { generateTimeReportMessage } = require('../features/timeSignal');

// コマンドごとのクールダウン管理
const anonymousCooldowns = new Map(); // lastUsed time
const anonymousUsageCounts = new Map(); // { count: number, date: string(YYYYMMDD) }
const bumpCooldowns = new Map();
const randomMentionCooldowns = new Map();
const processingCommands = new Set();

async function handleCommands(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    // anonymous コマンド
    if (interaction.commandName === 'anonymous') {
        const commandKey = `anonymous_${interaction.user.id}_${interaction.id}`;
        if (processingCommands.has(commandKey)) {
            return interaction.reply({ content: 'このコマンドは既に処理中です。', ephemeral: true });
        }

        processingCommands.add(commandKey);

        const now = Date.now();
        const dateObj = new Date();
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        const todayKey = `${y}${m}${d}`;

        // 1. 回数カウントの取得とリセット
        let usageData = anonymousUsageCounts.get(interaction.user.id) || { count: 0, date: todayKey };
        if (usageData.date !== todayKey) {
            usageData = { count: 0, date: todayKey };
        }

        // 2. 現在の回数に基づくクールダウン時間の決定
        // usageData.count は「これからの発言が何回目か」 (0なら1回目)
        const currentCount = usageData.count + 1;
        let cooldownTime = ANONYMOUS_COOLDOWN_TIERS[0].time; // デフォルト

        for (const tier of ANONYMOUS_COOLDOWN_TIERS) {
            if (currentCount <= tier.limit) {
                cooldownTime = tier.time;
                break;
            }
        }

        const lastUsed = anonymousCooldowns.get(interaction.user.id) || 0;
        const elapsed = now - lastUsed;

        if (elapsed < cooldownTime) {
            const remainSec = Math.ceil((cooldownTime - elapsed) / 1000);
            processingCommands.delete(commandKey);

            // クールダウン理由の説明
            let reason = '';
            if (currentCount >= 21) reason = ' (21回目以降: 30分制限)';
            else if (currentCount >= 11) reason = ' (11回目以降: 5分制限)';
            else if (currentCount >= 4) reason = ' (4回目以降: 1分制限)';

            return interaction.reply({ content: `エラー: 連投制限中です${reason}。あと${remainSec}秒お待ちください。`, ephemeral: true });
        }

        const content = interaction.options.getString('内容');

        if (content.includes('\n')) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: 改行は使用できません。', ephemeral: true });
        }

        if (content.length > 256) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: メッセージは256文字以下である必要があります。', ephemeral: true });
        }

        if (content.includes('@everyone') || content.includes('@here') || content.includes('<@&')) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: @everyoneや@hereなどのメンションは使用できません。', ephemeral: true });
        }

        try {
            const wacchoi = generateWacchoi(interaction.user.id);
            const dailyId = generateDailyUserId(interaction.user.id);

            // ダサい名前の決定
            const uglyName = getAnonymousName(wacchoi.daily);
            const displayName = `${uglyName} ID:${dailyId} (ﾜｯﾁｮｲ ${wacchoi.full})`;
            const avatarURL = client.user.displayAvatarURL();

            const webhooks = await interaction.channel.fetchWebhooks();
            let webhook = webhooks.find(wh => wh.name === 'CROSSROID Anonymous');

            if (!webhook) {
                webhook = await interaction.channel.createWebhook({
                    name: 'CROSSROID Anonymous',
                    avatar: client.user.displayAvatarURL()
                });
            }

            const sanitizedContent = content
                .replace(/@everyone/g, '@\u200beveryone')
                .replace(/@here/g, '@\u200bhere')
                .replace(/<@&(\d+)>/g, '<@\u200b&$1>');

            await webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: avatarURL,
                allowedMentions: { parse: [] }
            });

            anonymousCooldowns.set(interaction.user.id, Date.now());
            // 回数カウントアップ
            usageData.count++;
            anonymousUsageCounts.set(interaction.user.id, usageData);

            await interaction.reply({ content: `匿名メッセージを送信しました。(本日${usageData.count}回目)`, ephemeral: true });

        } catch (error) {
            console.error('エラーが発生しました:', error);
            await interaction.reply({ content: 'エラーが発生しました。しばらくしてから再試行してください。', ephemeral: true });
        } finally {
            processingCommands.delete(commandKey);
        }
        return;
    }

    // anonymous_resolve コマンド
    if (interaction.commandName === 'anonymous_resolve') {
        try {
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

            await interaction.deferReply({ ephemeral: true });
            const members = await interaction.guild.members.fetch();
            const matches = [];
            members.forEach(guildMember => {
                const uid = guildMember.user.id;
                const wacchoi = generateWacchoi(uid, targetDate);
                const did = generateDailyUserIdForDate(uid, targetDate);

                // 完全一致 (WWWW-DDDD) または 部分一致 (WWWW) または 旧ID一致
                if (wacchoi.full.toLowerCase().includes(idArg.toLowerCase()) || did.toLowerCase() === idArg.toLowerCase()) {
                    matches.push(guildMember);
                }
            });

            if (matches.length === 0) {
                return interaction.editReply({ content: '一致するユーザーは見つかりませんでした。' });
            }

            const list = matches.map(m => `${m.user.tag} (${m.user.id})`).join('\n');
            return interaction.editReply({ content: `一致ユーザー:\n${list}` });
        } catch (e) {
            console.error('anonymous_resolve エラー:', e);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: 'エラーが発生しました。' });
            }
            return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
        }
        return;
    }

    // bump コマンド
    if (interaction.commandName === 'bump') {
        try {
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

            bumpCooldowns.set(userId, now);

            const notifyChannel = interaction.guild.channels.cache.get('1431905157657923646');
            if (notifyChannel) {
                const bumpEmbed = new EmbedBuilder()
                    .setColor(0xff6b6b)
                    .setTitle('📢 部活宣伝')
                    .setDescription(`${channel} - ${interaction.user}`)
                    .setTimestamp();

                if (channel.topic) {
                    bumpEmbed.addFields({
                        name: '📝 説明',
                        value: channel.topic.length > 200 ? channel.topic.slice(0, 197) + '...' : channel.topic,
                        inline: false
                    });
                }

                await notifyChannel.send({ embeds: [bumpEmbed] });
            }

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
        return;
    }

    // test_generation コマンド
    if (interaction.commandName === 'test_generation') {
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'このコマンドは運営専用です。', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('ユーザー');

            await interaction.deferReply({ ephemeral: true });

            const mainChannel = client.channels.cache.get(MAIN_CHANNEL_ID);
            if (mainChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('🎉 第19世代おめでとうございます！（テスト）')
                    .setDescription(`${targetUser} さんがレベル10に到達し、第19世代ロールを獲得しました！`)
                    .setColor(0xFFD700)
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
        return;
    }

    // test_timereport コマンド
    if (interaction.commandName === 'test_timereport') {
        try {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'このコマンドは運営専用です。', ephemeral: true });
            }

            const testHour = interaction.options.getInteger('時間');

            if (testHour < 0 || testHour > 23) {
                return interaction.reply({ content: '時間は0-23の範囲で指定してください。', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const testDate = new Date();
            const aiMessage = await generateTimeReportMessage(testHour, testDate);

            const channel = client.channels.cache.get(TIME_REPORT_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('🕐 時報テスト')
                    .setDescription(aiMessage)
                    .setColor(0x5865F2)
                    .setTimestamp(testDate)
                    .setFooter({ text: 'CROSSROID', iconURL: client.user.displayAvatarURL() });

                await channel.send({ embeds: [embed] });
                await interaction.editReply({ content: `時報テストを送信しました（${testHour}時）。\n生成されたメッセージ: ${aiMessage}` });
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
        return;
    }

    // random_mention コマンド
    if (interaction.commandName === 'random_mention') {
        try {
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

            const guild = interaction.guild;
            if (!guild) {
                return interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
            }

            await interaction.deferReply();

            const members = guild.members.cache;
            const humanMembers = members.filter(member => !member.user.bot);
            let memberArray = Array.from(humanMembers.values());

            if (humanMembers.size === 0) {
                try {
                    const fetchedMembers = await guild.members.fetch();
                    const fetchedHumanMembers = fetchedMembers.filter(member => !member.user.bot);
                    if (fetchedHumanMembers.size === 0) {
                        return interaction.editReply({ content: 'メンバーが見つかりません。' });
                    }
                    memberArray = Array.from(fetchedHumanMembers.values());
                } catch (fetchError) {
                    console.error('メンバー取得でエラー:', fetchError);
                    return interaction.editReply({ content: 'メンバーの取得に失敗しました。' });
                }
            }

            const randomMember = memberArray[Math.floor(Math.random() * memberArray.length)];

            await interaction.editReply({
                content: `${randomMember}さんおはようございます！`,
                allowedMentions: { users: [randomMember.id] }
            });

            randomMentionCooldowns.set(userId, now);
            console.log(`ランダムメンションを送信しました: ${randomMember.user.tag} (${randomMember.id})`);

        } catch (error) {
            console.error('ランダムメンションコマンドでエラー:', error);
            if (interaction.deferred || interaction.replied) {
                try { await interaction.editReply({ content: 'エラーが発生しました。' }); } catch (e) { }
            } else {
                try { await interaction.reply({ content: 'エラーが発生しました。', ephemeral: true }); } catch (e) { }
            }
        }
    }

    // event_create コマンド
    if (interaction.commandName === 'event_create') {
        try {
            // 権限チェック (管理者 または 特定ロール)
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const hasRole = member && member.roles.cache.has(EVENT_ADMIN_ROLE_ID);
            const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
            const isDev = interaction.user.id === '1122179390403510335';

            console.log(`[EventCreate] User: ${interaction.user.id}, Role: ${hasRole}, Admin: ${isAdmin}, Dev: ${isDev}`);

            if (!hasRole && !isAdmin && !isDev) {
                return interaction.reply({ content: 'このコマンドを実行する権限がありません。', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const eventName = interaction.options.getString('イベント名');
            const eventContent = interaction.options.getString('内容');
            const eventDate = interaction.options.getString('日時') || '未定';
            const eventPlace = interaction.options.getString('場所') || '未定';

            const guild = interaction.guild;
            if (!guild) return interaction.editReply('サーバー内でのみ使用可能です。');

            // 1. チャンネル作成
            const newChannel = await guild.channels.create({
                name: eventName,
                type: 0, // GUILD_TEXT
                parent: EVENT_CATEGORY_ID,
                topic: `イベント: ${eventName} | 作成者: ${interaction.user.username}`
            });

            // 2. イベント詳細Embed (新チャンネル用)
            const detailEmbed = new EmbedBuilder()
                .setTitle(`📅 イベント: ${eventName}`)
                .setDescription(eventContent)
                .addFields(
                    { name: '⏰ 日時', value: eventDate, inline: true },
                    { name: '📍 場所', value: eventPlace, inline: true },
                    { name: '主催者', value: interaction.user.toString(), inline: true }
                )
                .setColor(0x00FF00) // Green
                .setTimestamp()
                .setFooter({ text: 'CROSSROID Event System', iconURL: client.user.displayAvatarURL() });

            await newChannel.send({
                content: '@everyone 新しいイベントが作成されました！',
                embeds: [detailEmbed]
            });

            // 3. 告知Embed (告知チャンネル用)
            const notifyChannel = guild.channels.cache.get(EVENT_NOTIFY_CHANNEL_ID);
            if (notifyChannel) {
                const notifyEmbed = new EmbedBuilder()
                    .setTitle('📢 新規イベント開催のお知らせ')
                    .setDescription(`新しいイベント **[${eventName}](${newChannel.url})** が作成されました！\n詳細はリンク先のチャンネルを確認してください。`)
                    .addFields(
                        { name: 'イベント内容', value: eventContent.length > 100 ? eventContent.slice(0, 97) + '...' : eventContent, inline: false },
                        { name: '日時', value: eventDate, inline: true },
                        { name: 'チャンネル', value: newChannel.toString(), inline: true }
                    )
                    .setColor(0xFFA500) // Orange
                    .setThumbnail(interaction.user.displayAvatarURL())
                    .setTimestamp();

                await notifyChannel.send({ embeds: [notifyEmbed] });
            }

            await interaction.editReply({
                content: `✅ イベントチャンネルを作成しました: ${newChannel}\n告知メッセージを送信しました。`
            });

        } catch (error) {
            console.error('イベント作成エラー:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('イベント作成中にエラーが発生しました。');
            }
            return interaction.reply({ content: 'イベント作成中にエラーが発生しました。', ephemeral: true });
        }
        return;
    }

    // admin_say コマンド
    if (interaction.commandName === 'admin_say') {
        const ALLOWED_USER_ID = '1122179390403510335';

        if (interaction.user.id !== ALLOWED_USER_ID) {
            return interaction.reply({ content: 'このコマンドを実行する権限がありません。', ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel('送信先');
        const content = interaction.options.getString('内容');

        try {
            // テキストチャンネルであることを確認（ある程度）
            if (!targetChannel.isTextBased()) {
                return interaction.reply({ content: '指定されたチャンネルはテキストチャンネルではありません。', ephemeral: true });
            }

            await targetChannel.send(content);
            await interaction.reply({ content: `✅ ${targetChannel} にメッセージを送信しました。`, ephemeral: true });

        } catch (error) {
            console.error('admin_say エラー:', error);
            await interaction.reply({ content: `送信エラー: ${error.message}`, ephemeral: true });
        }
        return;
    }
}

// 30分ごとのクリーンアップ
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const [userId, lastUsed] of anonymousCooldowns.entries()) {
        if (lastUsed < oneHourAgo) anonymousCooldowns.delete(userId);
    }
    for (const [userId, lastBump] of bumpCooldowns.entries()) {
        if (lastBump < oneHourAgo) bumpCooldowns.delete(userId);
    }
    for (const [userId, lastUsed] of randomMentionCooldowns.entries()) {
        if (lastUsed < oneHourAgo) randomMentionCooldowns.delete(userId);
    }

    const oldProcessingCommands = Array.from(processingCommands);
    for (const commandKey of oldProcessingCommands) {
        processingCommands.delete(commandKey);
    }
}, 30 * 60 * 1000);

module.exports = { handleCommands };
