const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { generateWacchoi, generateDailyUserId, generateDailyUserIdForDate, getHolidayName } = require('../utils');
const {
    CRONYMOUS_COOLDOWN_MS,
    BUMP_COOLDOWN_MS,
    RANDOM_MENTION_COOLDOWN_MS,
    CLUB_CATEGORY_IDS,
    MAIN_CHANNEL_ID,
    CURRENT_GENERATION_ROLE_ID,
    TIME_REPORT_CHANNEL_ID,
    EVENT_CATEGORY_ID,
    EVENT_NOTIFY_CHANNEL_ID,
    EVENT_ADMIN_ROLE_ID,
    HIGHLIGHT_CHANNEL_ID,
} = require('../constants');
const { generateTimeReportMessage } = require('../features/timeSignal');
const fs = require('fs');
const path = require('path');

// コマンドごとのクールダウン管理
const cronymousCooldowns = new Map();
const bumpCooldowns = new Map();
const randomMentionCooldowns = new Map();
const processingCommands = new Set();

async function handleCommands(interaction, client) {
    // ボタンインタラクションの処理
    if (interaction.isButton()) {
        // 決闘ボタンの処理は既にcollector内で処理されるため、ここでは不要
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // cronymous コマンド
    if (interaction.commandName === 'cronymous') {
        const commandKey = `cronymous_${interaction.user.id}_${interaction.id}`;
        if (processingCommands.has(commandKey)) {
            return interaction.reply({ content: 'このコマンドは既に処理中です。', ephemeral: true });
        }

        processingCommands.add(commandKey);

        const now = Date.now();
        const lastUsed = cronymousCooldowns.get(interaction.user.id) || 0;
        const elapsed = now - lastUsed;
        if (elapsed < CRONYMOUS_COOLDOWN_MS) {
            const remainSec = Math.ceil((CRONYMOUS_COOLDOWN_MS - elapsed) / 1000);
            processingCommands.delete(commandKey);
            return interaction.reply({ content: `エラー: クールダウン中です。${remainSec}秒後に再度お試しください。`, ephemeral: true });
        }

        const content = interaction.options.getString('内容');

        if (content.includes('\n')) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: 改行は使用できません。', ephemeral: true });
        }

        if (content.length > 144) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: メッセージは144文字以下である必要があります。', ephemeral: true });
        }

        if (content.includes('@everyone') || content.includes('@here') || content.includes('<@&')) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: @everyoneや@hereなどのメンションは使用できません。', ephemeral: true });
        }

        try {
            const wacchoi = generateWacchoi(interaction.user.id);
            const dailyId = generateDailyUserId(interaction.user.id);
            const displayName = `名無しの障害者 ID: ${dailyId} (ﾜｯﾁｮｲ ${wacchoi.full})`;
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

            cronymousCooldowns.set(interaction.user.id, Date.now());
            await interaction.reply({ content: '匿名メッセージを送信しました。', ephemeral: true });

        } catch (error) {
            console.error('エラーが発生しました:', error);
            await interaction.reply({ content: 'エラーが発生しました。しばらくしてから再試行してください。', ephemeral: true });
        } finally {
            processingCommands.delete(commandKey);
        }
        return;
    }

    // cronymous_resolve コマンド
    if (interaction.commandName === 'cronymous_resolve') {
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
            console.error('cronymous_resolve エラー:', e);
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

    // duel コマンド
    if (interaction.commandName === 'duel') {
        try {
            const userId = interaction.user.id;
            const opponentUser = interaction.options.getUser('opponent');

            // バリデーション
            if (opponentUser.id === userId) {
                return interaction.reply({ content: '自分自身と決闘することはできません。', ephemeral: true });
            }
            if (opponentUser.bot) {
                return interaction.reply({ content: 'Botと決闘することはできません。', ephemeral: true });
            }

            const member = interaction.member;
            const opponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);

            if (!opponentMember) {
                return interaction.reply({ content: '対戦相手のメンバー情報を取得できませんでした。', ephemeral: true });
            }

            // ロールチェック（世代ロール必須）
            const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
            const isChallengerEligible = member.roles.cache.some(r => romanRegex.test(r.name)) || member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);
            const isOpponentEligible = opponentMember.roles.cache.some(r => romanRegex.test(r.name)) || opponentMember.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

            if (!isChallengerEligible) {
                return interaction.reply({ content: 'あなたは決闘に参加するための世代ロールを持っていません。', ephemeral: true });
            }
            if (!isOpponentEligible) {
                return interaction.reply({ content: '対戦相手は決闘に参加するための世代ロールを持っていません。', ephemeral: true });
            }

            // 決闘状UI
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`duel_accept_${userId}_${opponentUser.id}`).setLabel('受けて立つ').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
                new ButtonBuilder().setCustomId(`duel_deny_${userId}_${opponentUser.id}`).setLabel('拒否').setStyle(ButtonStyle.Secondary).setEmoji('🏳️')
            );

            const embed = new EmbedBuilder()
                .setTitle('⚔️ 決闘状')
                .setDescription(`${opponentUser}\n${interaction.user} から決闘を申し込まれました。`)
                .addFields(
                    { name: 'ルール', value: '1d100のダイス勝負', inline: true },
                    { name: 'ハンデ', value: '仕掛け人は最大95 & 引き分けは敗北', inline: true },
                    { name: 'ペナルティ', value: '敗者はタイムアウト（最大10分）', inline: false },
                    { name: '注意', value: '受諾後、キャンセル不可', inline: false }
                )
                .setColor(0xFF0000)
                .setThumbnail(interaction.user.displayAvatarURL());

            await interaction.reply({
                content: `${opponentUser}`,
                embeds: [embed],
                components: [row]
            });

            const filter = i => i.user.id === opponentUser.id && (i.customId.startsWith('duel_accept_') || i.customId.startsWith('duel_deny_'));
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

            collector.on('collect', async i => {
                if (i.customId.startsWith('duel_deny_')) {
                    await i.update({ content: `🏳️ ${opponentUser} は決闘を拒否しました。`, components: [], embeds: [] });
                    return;
                }

                // 受諾
                const startEmbed = new EmbedBuilder()
                    .setTitle('⚔️ 決闘開始')
                    .setDescription(`${interaction.user} vs ${opponentUser}\n\nダイスロール中... 🎲`)
                    .setColor(0xFFA500);

                await i.update({ content: null, embeds: [startEmbed], components: [] });

                await new Promise(r => setTimeout(r, 2000));

                const rollA = Math.floor(Math.random() * 95) + 1; // ハンデ: 最大95
                const rollB = Math.floor(Math.random() * 100) + 1;

                let resultMsg = `🎲 **結果** 🎲\n${interaction.user}: **${rollA}** (Handicap)\n${opponentUser}: **${rollB}**\n\n`;
                let loser = null;
                let winner = null;
                let diff = 0;

                if (rollA > rollB) {
                    diff = rollA - rollB;
                    loser = opponentMember;
                    winner = member;
                    resultMsg += `🏆 **勝利者: ${interaction.user}**\n💀 **敗者: ${opponentUser}**`;
                } else {
                    diff = Math.abs(rollB - rollA);
                    loser = member;
                    winner = opponentMember;
                    if (rollA === rollB) {
                        resultMsg += `⚖️ **引き分け (防御側の勝利)**\n💀 **敗者: ${interaction.user}**`;
                    } else {
                        resultMsg += `🏆 **勝利者: ${opponentUser}**\n💀 **敗者: ${interaction.user}**`;
                    }
                }

                // 戦績記録
                const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
                let duelData = {};
                if (fs.existsSync(DATA_FILE)) {
                    try {
                        duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                    } catch (e) {
                        console.error('決闘データ読み込みエラー:', e);
                    }
                }

                if (!duelData[winner.user.id]) {
                    duelData[winner.user.id] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
                }
                if (!duelData[loser.user.id]) {
                    duelData[loser.user.id] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
                }

                duelData[winner.user.id].wins++;
                duelData[winner.user.id].streak++;
                if (duelData[winner.user.id].streak > duelData[winner.user.id].maxStreak) {
                    duelData[winner.user.id].maxStreak = duelData[winner.user.id].streak;
                }

                duelData[loser.user.id].losses++;
                duelData[loser.user.id].streak = 0;

                try {
                    fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2));
                } catch (e) {
                    console.error('決闘データ書き込みエラー:', e);
                }

                resultMsg += `\n📊 **Stats:** ${winner} (${duelData[winner.user.id].streak}連勝中) vs ${loser}`;

                // 3連勝以上で通知
                if (duelData[winner.user.id].streak >= 3) {
                    const mainCh = client.channels.cache.get(MAIN_CHANNEL_ID);
                    if (mainCh) {
                        mainCh.send(`🔥 **NEWS:** ${winner} が決闘で **${duelData[winner.user.id].streak}連勝** を達成しました！`);
                    }
                    try {
                        if (loser.moderatable) {
                            const oldName = loser.nickname || loser.user.username;
                            await loser.setNickname(`敗北者${oldName.substring(0, 20)}`).catch(() => { });
                        }
                    } catch (e) { }
                }

                // タイムアウト計算（最大10分）
                let timeoutMinutes = Math.min(10, Math.ceil(diff / 4));
                let penaltyMsg = '';
                if (loser.user.id === userId) {
                    timeoutMinutes = Math.min(10, timeoutMinutes + 2);
                    penaltyMsg = ' (自害+2分)';
                }
                const timeoutMs = timeoutMinutes * 60 * 1000;

                const resultEmbed = new EmbedBuilder()
                    .setTitle(rollA === rollB ? '⚖️ 引き分け' : '🏆 決闘決着')
                    .setColor(rollA === rollB ? 0x99AAB5 : 0xFFD700)
                    .setDescription(`**勝利者** ${winner}\n**敗者** ${loser}`)
                    .addFields(
                        { name: `${interaction.user.username} (攻)`, value: `🎲 **${rollA}**`, inline: true },
                        { name: `${opponentUser.username} (守)`, value: `🎲 **${rollB}**`, inline: true },
                        { name: '差', value: `${diff}`, inline: true },
                        { name: '処罰', value: `🚨 ${timeoutMinutes}分のタイムアウト${penaltyMsg}`, inline: false },
                        { name: '戦績', value: `${winner}: ${duelData[winner.user.id].streak}連勝中`, inline: false }
                    )
                    .setThumbnail(winner.user.displayAvatarURL());

                await interaction.followUp({ embeds: [resultEmbed] });

                // タイムアウト適用
                if (loser && loser.moderatable) {
                    try {
                        await loser.timeout(timeoutMs, `Dueled with ${rollA === rollB ? 'Unknown' : (loser.user.id === userId ? opponentUser.tag : interaction.user.tag)}`).catch(() => { });
                        await interaction.channel.send(`⚰️ ${loser} は埋葬されました...`);
                    } catch (e) {
                        console.error('タイムアウト適用エラー:', e);
                    }
                }

                // ハイライトチャンネルに投稿
                try {
                    const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
                    if (highlightChannel) {
                        const highlightEmbed = new EmbedBuilder()
                            .setTitle('⚔️ 決闘勝利者誕生 ⚔️')
                            .setDescription(`${winner} が ${loser} との死闘を制しました！`)
                            .setColor(0xFFD700)
                            .setThumbnail(winner.user.displayAvatarURL())
                            .setTimestamp();
                        await highlightChannel.send({ embeds: [highlightEmbed] });
                    }
                } catch (e) {
                    console.error('ハイライト投稿エラー:', e);
                }
            });

            // タイムアウトハンドラー
            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({ content: '⏰ 時間切れで決闘がキャンセルされました。', components: [], embeds: [] });
                }
            });

        } catch (error) {
            console.error('決闘コマンドエラー:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: 'エラーが発生しました。' });
            }
            return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
        }
        return;
    }

    // duel_russian コマンド
    if (interaction.commandName === 'duel_russian') {
        try {
            const userId = interaction.user.id;
            const opponentUser = interaction.options.getUser('opponent');

            // バリデーション
            if (opponentUser.id === userId || opponentUser.bot) {
                return interaction.reply({ content: '自分自身やBotとは対戦できません。', ephemeral: true });
            }

            // UI
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`russian_accept_${userId}_${opponentUser.id}`).setLabel('受けて立つ').setStyle(ButtonStyle.Danger).setEmoji('🔫'),
                new ButtonBuilder().setCustomId(`russian_deny_${userId}_${opponentUser.id}`).setLabel('拒否').setStyle(ButtonStyle.Secondary)
            );

            const embed = new EmbedBuilder()
                .setTitle('☠️ ロシアン・ルーレット')
                .setDescription(`${opponentUser}\n${interaction.user} から死のゲームへの招待です。`)
                .addFields(
                    { name: 'ルール', value: '1発の実弾が入ったリボルバーを交互に引き金を引く', inline: false },
                    { name: '敗北時', value: '10分Timeout + Wacchoi(IP)公開', inline: true },
                    { name: '勝利時', value: 'ハイライトチャンネルに投稿', inline: true }
                )
                .setColor(0x000000)
                .setThumbnail('https://cdn.discordapp.com/emojis/1198240562545954936.webp');

            await interaction.reply({
                content: `${opponentUser}`,
                embeds: [embed],
                components: [row]
            });

            const filter = i => i.user.id === opponentUser.id && (i.customId.startsWith('russian_accept_') || i.customId.startsWith('russian_deny_'));
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

            collector.on('collect', async i => {
                if (i.customId.startsWith('russian_deny_')) {
                    await i.update({ content: `🏳️ ${opponentUser} はロシアンルーレットを拒否しました。`, components: [], embeds: [] });
                    return;
                }

                // ゲーム開始
                const cylinder = [0, 0, 0, 0, 0, 0];
                const bulletPos = Math.floor(Math.random() * 6);
                cylinder[bulletPos] = 1;

                const state = {
                    current: 0,
                    turn: userId
                };

                const triggerRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`russian_trigger_${userId}_${opponentUser.id}`).setLabel('引き金を引く').setStyle(ButtonStyle.Danger).setEmoji('🔫')
                );

                const startEmbed = new EmbedBuilder()
                    .setTitle('🔫 ロシアンルーレット開始')
                    .setDescription(`${interaction.user} vs ${opponentUser}\n\n最初のターン: <@${state.turn}>`)
                    .setColor(0xFF0000);

                await i.update({ content: null, embeds: [startEmbed], components: [triggerRow] });

                const gameFilter = m => m.user.id === state.turn && m.customId === `russian_trigger_${userId}_${opponentUser.id}`;
                const gameCollector = interaction.channel.createMessageComponentCollector({ filter: gameFilter, time: 300000 });

                gameCollector.on('collect', async move => {
                    if (move.user.id !== state.turn) {
                        return move.reply({ content: 'あなたの番ではありません。', ephemeral: true });
                    }

                    const isHit = cylinder[state.current] === 1;

                    if (isHit) {
                        const deathEmbed = new EmbedBuilder()
                            .setTitle('💥 BANG!!!')
                            .setDescription(`<@${move.user.id}> の頭部が吹き飛びました。\n\n🏆 **勝利者** ${move.user.id === userId ? opponentUser : interaction.user}`)
                            .setColor(0x880000)
                            .setImage('https://media1.tenor.com/m/X215c2D-i_0AAAAC/gun-gunshot.gif');

                        await move.update({ content: null, embeds: [deathEmbed], components: [] });
                        gameCollector.stop('death');

                        // 死亡処理
                        const loserId = move.user.id;
                        const winnerId = loserId === userId ? opponentUser.id : userId;
                        const loserMember = await interaction.guild.members.fetch(loserId).catch(() => null);
                        const winnerMember = await interaction.guild.members.fetch(winnerId).catch(() => null);

                        // ペナルティ: タイムアウト + Wacchoi公開
                        if (loserMember) {
                            const wacchoi = generateWacchoi(loserId);
                            const deathReportEmbed = new EmbedBuilder()
                                .setTitle('⚰️ 死亡確認')
                                .setColor(0x000000)
                                .addFields(
                                    { name: 'ID (Wacchoi)', value: `\`${wacchoi.full}\``, inline: true },
                                    { name: '処罰', value: '10分のタイムアウト', inline: false }
                                )
                                .setTimestamp();
                            interaction.channel.send({ embeds: [deathReportEmbed] });
                            if (loserMember.moderatable) {
                                const timeoutMs = 10 * 60 * 1000; // 10分
                                loserMember.timeout(timeoutMs, 'Russian Roulette Death').catch(() => { });
                            }
                        }

                        // 報酬: ハイライトチャンネルに投稿
                        if (winnerMember) {
                            // 戦績記録
                            const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
                            let duelData = {};
                            if (fs.existsSync(DATA_FILE)) {
                                try {
                                    duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                                } catch (e) {
                                    console.error('決闘データ読み込みエラー:', e);
                                }
                            }

                            if (!duelData[winnerId]) {
                                duelData[winnerId] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
                            }
                            duelData[winnerId].wins++;
                            duelData[winnerId].streak++;
                            if (duelData[winnerId].streak > duelData[winnerId].maxStreak) {
                                duelData[winnerId].maxStreak = duelData[winnerId].streak;
                            }

                            try {
                                fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2));
                            } catch (e) {
                                console.error('決闘データ書き込みエラー:', e);
                            }

                            // ハイライト
                            const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
                            if (highlightChannel) {
                                interaction.channel.send(`✨ **勝利者** <@${winnerId}> は死地を潜り抜けました！ (現在 ${duelData[winnerId].streak}連勝)`);
                            }
                        }

                        return;
                    } else {
                        // ミス - 次のターン
                        state.current++;
                        state.turn = state.turn === userId ? opponentUser.id : userId;
                        const nextEmbed = new EmbedBuilder()
                            .setTitle('💨 Click...')
                            .setDescription('セーフです。')
                            .addFields(
                                { name: '次のターン', value: `<@${state.turn}>`, inline: true },
                                { name: 'シリンダー', value: `${state.current + 1}/6`, inline: true }
                            )
                            .setColor(0x57F287);

                        await move.update({ content: null, embeds: [nextEmbed], components: [triggerRow] });
                    }
                });

                gameCollector.on('end', (c, reason) => {
                    if (reason !== 'death') {
                        interaction.channel.send('⏰ ゲームは時間切れで中断されました。');
                    }
                });
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.editReply({ content: '⏰ 時間切れでロシアンルーレットがキャンセルされました。', components: [], embeds: [] });
                }
            });

        } catch (error) {
            console.error('ロシアンルーレットコマンドエラー:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: 'エラーが発生しました。' });
            }
            return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
        }
        return;
    }

    // duel_ranking コマンド
    if (interaction.commandName === 'duel_ranking') {
        try {
            const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');

            if (!fs.existsSync(DATA_FILE)) {
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('📊 ランキング')
                        .setDescription('データがまだありません。')
                        .setColor(0x2F3136)],
                    ephemeral: true
                });
            }

            let duelData = {};
            try {
                duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            } catch (e) {
                console.error('ランキングデータ読み込みエラー:', e);
                return interaction.reply({ content: 'データ読み込みエラー', ephemeral: true });
            }

            // オブジェクトを配列に変換
            const players = Object.entries(duelData).map(([id, data]) => ({ id, ...data }));

            // Top Wins
            const topWins = [...players].sort((a, b) => b.wins - a.wins).slice(0, 5);
            // Top Streaks (Current)
            const topStreaks = [...players].sort((a, b) => b.streak - a.streak).slice(0, 5);

            const buildLeaderboard = (list, type) => {
                if (list.length === 0) return 'なし';
                return list.map((p, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                    const val = type === 'wins' ? `${p.wins}勝` : `${p.streak}連勝`;
                    return `${medal} <@${p.id}> (**${val}**)`;
                }).join('\n');
            };

            const embed = new EmbedBuilder()
                .setTitle('🏆 決闘ランキング')
                .setColor(0xFFD700)
                .addFields(
                    { name: '🔥 勝利数 Top 5', value: buildLeaderboard(topWins, 'wins'), inline: true },
                    { name: '⚡ 現在の連勝記録 Top 5', value: buildLeaderboard(topStreaks, 'streak'), inline: true }
                )
                .setFooter({ text: '※ 通常決闘とロシアンルーレットの合算戦績です' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('ランキングコマンドエラー:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: 'エラーが発生しました。' });
            }
            return interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
        }
        return;
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
}

// 30分ごとのクリーンアップ
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const [userId, lastUsed] of cronymousCooldowns.entries()) {
        if (lastUsed < oneHourAgo) cronymousCooldowns.delete(userId);
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
