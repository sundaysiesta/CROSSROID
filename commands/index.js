const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
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
    ELITE_ROLE_ID,
    ADMIN_ROLE_ID
} = require('../constants');
const { generateTimeReportMessage } = require('../features/timeSignal');

// コマンドごとのクールダウン管理
const anonymousCooldowns = new Map();
const anonymousUsageCounts = new Map();
const bumpCooldowns = new Map();
const randomMentionCooldowns = new Map();
const processingCommands = new Set();

const SUPER_ADMIN_ID = '1122179390403510335';

// 権限チェックヘルパー
async function checkAdmin(interaction) {
    if (interaction.user.id === SUPER_ADMIN_ID) return true;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (member && member.roles.cache.has(ADMIN_ROLE_ID)) return true;
    return false;
}

async function handleCommands(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    // === EXISTING COMMANDS ===

    if (interaction.commandName === 'anonymous') {
        // ... (Existing Anonymous Logic)
        const commandKey = `anonymous_${interaction.user.id}_${interaction.id}`;
        if (processingCommands.has(commandKey)) return interaction.reply({ content: '処理中です。', ephemeral: true });
        processingCommands.add(commandKey);

        const now = Date.now();
        const dateObj = new Date();
        const todayKey = `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, '0')}${String(dateObj.getDate()).padStart(2, '0')}`;

        let usageData = anonymousUsageCounts.get(interaction.user.id) || { count: 0, date: todayKey };
        if (usageData.date !== todayKey) usageData = { count: 0, date: todayKey };

        const currentCount = usageData.count + 1;
        let cooldownTime = ANONYMOUS_COOLDOWN_TIERS[0].time;
        for (const tier of ANONYMOUS_COOLDOWN_TIERS) {
            if (currentCount <= tier.limit) {
                cooldownTime = tier.time;
                break;
            }
        }

        if (interaction.member && interaction.member.roles.cache.has(ELITE_ROLE_ID)) {
            cooldownTime = Math.floor(cooldownTime / 2);
        }

        const lastUsed = anonymousCooldowns.get(interaction.user.id) || 0;
        const elapsed = now - lastUsed;

        if (elapsed < cooldownTime) {
            processingCommands.delete(commandKey);
            const remainSec = Math.ceil((cooldownTime - elapsed) / 1000);
            return interaction.reply({ content: `連投制限中です（残り${remainSec}秒）`, ephemeral: true });
        }

        const content = interaction.options.getString('内容');
        if (content.includes('\n') || content.length > 256 || content.includes('@everyone') || content.includes('@here') || content.includes('<@&')) {
            processingCommands.delete(commandKey);
            return interaction.reply({ content: 'エラー: 改行不可/256文字以内/メンション不可', ephemeral: true });
        }

        try {
            const wacchoi = generateWacchoi(interaction.user.id);
            const dailyId = generateDailyUserId(interaction.user.id);

            const isElite = interaction.member && interaction.member.roles.cache.has(ELITE_ROLE_ID);
            const uglyName = getAnonymousName(wacchoi.daily, isElite);
            const displayName = `${uglyName} ID:${dailyId} (ﾜｯﾁｮｲ ${wacchoi.full})`;
            const avatarURL = client.user.displayAvatarURL();

            const webhooks = await interaction.channel.fetchWebhooks();
            let webhook = webhooks.find(wh => wh.name === 'CROSSROID Anonymous');
            if (!webhook) webhook = await interaction.channel.createWebhook({ name: 'CROSSROID Anonymous', avatar: avatarURL });

            await webhook.send({
                content: content.replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere').replace(/<@&(\d+)>/g, '<@\u200b&$1>'),
                username: displayName,
                avatarURL: avatarURL,
                allowedMentions: { parse: [] }
            });

            anonymousCooldowns.set(interaction.user.id, Date.now());
            usageData.count++;
            anonymousUsageCounts.set(interaction.user.id, usageData);
            await interaction.reply({ content: `送信しました (本日${usageData.count}回目)`, ephemeral: true }).catch(err => {
                if (err.code !== 10062) console.error('Silent Error:', err);
            });

        } catch (e) {
            console.error(e);
            if (!interaction.replied) await interaction.reply({ content: 'エラー', ephemeral: true });
        } finally {
            processingCommands.delete(commandKey);
        }
        return;
    }

    // Keep other non-admin commands (anonymous_resolve, bump, etc) briefly...
    if (interaction.commandName === 'bump') {
        const userId = interaction.user.id;
        const now = Date.now();
        const last = bumpCooldowns.get(userId) || 0;
        if (now - last < BUMP_COOLDOWN_MS) return interaction.reply({ content: 'クールダウン中', ephemeral: true });
        bumpCooldowns.set(userId, now);
        await interaction.reply({ content: 'Bumpしました', ephemeral: true });
        return;
    }

    if (interaction.commandName === 'random_mention') {
        const userId = interaction.user.id;
        const now = Date.now();
        if (now - (randomMentionCooldowns.get(userId) || 0) < RANDOM_MENTION_COOLDOWN_MS) return interaction.reply({ content: 'CoolIng down', ephemeral: true });
        randomMentionCooldowns.set(userId, now);
        const members = await interaction.guild.members.fetch();
        const random = members.filter(m => !m.user.bot).random();
        if (random) interaction.reply({ content: `${random} Hello!`, allowedMentions: { users: [random.id] } });
        else interaction.reply('No members');
        return;
    }

    if (interaction.commandName === 'roulette') {
        const fs = require('fs');
        const path = require('path');
        const COOLDOWN_FILE = path.join(__dirname, '..', 'custom_cooldowns.json');

        // Load Cooldowns
        let cooldowns = {};
        if (fs.existsSync(COOLDOWN_FILE)) {
            try {
                cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
            } catch (e) {
                console.error('Cooldown load error:', e);
            }
        }

        const userId = interaction.user.id;
        const now = Date.now();
        const lastUsed = cooldowns[`roulette_${userId}`] || 0;
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

        if (now - lastUsed < SEVEN_DAYS) {
            const remaining = SEVEN_DAYS - (now - lastUsed);
            const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
            const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
            return interaction.reply({ content: `⛔ このコマンドは7日に1回のみ実行できます。\n残り: ${days}日 ${hours}時間`, ephemeral: true });
        }

        const member = interaction.member;
        if (!member) return interaction.reply({ content: 'エラー: メンバー情報の取得に失敗しました。', ephemeral: true });

        // Generation Check
        const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
        const hasGenRole = member.roles.cache.some(r => romanRegex.test(r.name));
        const hasCurrentGen = member.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

        if (!hasGenRole && !hasCurrentGen) {
            return interaction.reply({ content: '⛔ このコマンドは世代ロール（I, II, III... または最新世代）を持つメンバー限定です。', ephemeral: true });
        }

        await interaction.deferReply();

        // Fetch targets
        await interaction.guild.members.fetch();
        const targets = interaction.guild.members.cache.filter(m => !m.user.bot && (m.roles.cache.some(r => romanRegex.test(r.name)) || m.roles.cache.has(CURRENT_GENERATION_ROLE_ID)));

        if (targets.size === 0) return interaction.editReply('❌ No targets found.');

        // Logic: 1/6 chance
        const isHit = Math.random() < (1 / 6);

        // Visuals
        await interaction.editReply(`🔫 **Russian Roulette**\n${interaction.user} がシリンダーを回しました...\nターゲット候補: ${targets.size}人`);
        await new Promise(r => setTimeout(r, 3000)); // Suspense

        if (isHit) {
            cooldowns[`roulette_${userId}`] = now;
            try {
                fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
                require('../features/persistence').save(client);
            } catch (e) { console.error('Cooldown save error:', e); }

            // Select Victim
            const victim = targets.random();
            const victimName = victim.displayName;

            // Generate Wacchoi for Exposure
            const wacchoi = generateWacchoi(victim.id);
            const wacchoiText = `\`${wacchoi.full}\``;

            await interaction.editReply(`💥 **BANG!!!**\n${interaction.user} の放った弾丸が **${victim}** に命中しました！\n🚑 (10分間のタイムアウト)\n🔍 **Identity Exposed:** 本日のWacchoiは ${wacchoiText} です。`);

            try {
                if (victim.moderatable) {
                    await victim.timeout(10 * 60 * 1000, `Russian Roulette: Shot by ${interaction.user.tag}`).catch(e => console.error('Timeout API Failed:', e));
                    await interaction.channel.send(`💀 ${victimName} は10分間の暗闇に葬られました... (Wacchoi: ${wacchoiText})`);
                    // DM
                    await victim.send(`🔫 あなたは **${interaction.user.tag}** のロシアンルーレットの流れ弾に当たりました。\n10分間サーバーにアクセスできません。\nなお、本日のあなたの匿名ID(Wacchoi)は ${wacchoiText} として公開されました。`).catch(() => { });
                } else {
                    await interaction.followUp(`⚠️ **${victimName}** に命中しましたが、防弾ベスト(権限)により無効化されました。\nしかし、匿名IDは公開されます: ${wacchoiText}`);
                }
            } catch (e) {
                console.error('Timeout execution failed:', e);
                await interaction.followUp('⚠️ タイムアウトの適用中にエラーが発生しました。命拾いしましたね。');
            }

        } else {
            cooldowns[`roulette_${userId}`] = now;
            try {
                fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
                require('../features/persistence').save(client);
            } catch (e) { console.error('Cooldown save error:', e); }

            await interaction.editReply(`💨 **Click...**\n不発でした。今日の死者はいないようです...`);
        }
        return;
    }

    if (interaction.commandName === 'event_create') {
        try {
            // Robust Defer: Catch 10062 (Unknown Interaction) immediately
            try {
                await interaction.deferReply({ flags: 64 }); // 64 = MessageFlags.Ephemeral
            } catch (deferErr) {
                if (deferErr.code === 10062 || deferErr.code === 40060) {
                    console.warn('[EventCreate] Interaction expired before defer (10062/40060). Aborting.');
                    return;
                }
                throw deferErr; // Re-throw other errors
            }

            // 権限チェック (管理者 または 特定ロール)
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const hasRole = member && member.roles.cache.has(EVENT_ADMIN_ROLE_ID);
            const isAdmin = member && member.permissions.has(PermissionFlagsBits.Administrator);
            const isDev = interaction.user.id === '1122179390403510335';

            console.log(`[EventCreate] User: ${interaction.user.id}, Role: ${hasRole}, Admin: ${isAdmin}, Dev: ${isDev}`);

            if (!hasRole && !isAdmin && !isDev) {
                return interaction.editReply({ content: '⛔ 権限がありません。' });
            }
            // Defer was already called at start
            // await interaction.deferReply({ ephemeral: true }); // Removed redundant call

            const eventName = interaction.options.getString('イベント名');
            const eventContent = interaction.options.getString('内容');
            const eventDate = interaction.options.getString('日時') || '未定';
            const eventPlace = interaction.options.getString('場所') || '未定';

            const guild = interaction.guild;
            if (!guild) return interaction.editReply('サーバー内でのみ使用可能です。');

            // 1. チャンネル作成
            // 1. チャンネル作成
            let newChannel;
            try {
                newChannel = await guild.channels.create({
                    name: eventName,
                    type: 0, // GUILD_TEXT
                    parent: EVENT_CATEGORY_ID,
                    topic: `イベント: ${eventName} | 作成者: ${interaction.user.username}`,
                    permissionOverwrites: [
                        {
                            id: guild.id, // @everyone
                            allow: [PermissionFlagsBits.ViewChannel],
                            deny: [
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.AttachFiles,
                                PermissionFlagsBits.CreatePrivateThreads,
                                PermissionFlagsBits.CreatePublicThreads,
                                PermissionFlagsBits.SendPolls,
                                PermissionFlagsBits.SendMessagesInThreads
                            ]
                        },
                        {
                            id: interaction.user.id, // Host
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                        },
                        {
                            id: ADMIN_ROLE_ID, // Admin Role
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                        },
                        {
                            id: client.user.id, // Bot itself
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.EmbedLinks,
                                PermissionFlagsBits.AttachFiles,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.ManageChannels,


                            ]
                        }
                    ]
                });
            } catch (err) {
                console.error('Channel creation error:', err);
                if (err.code == 50013) {
                    // Fallback: Create without category
                    console.warn('Category permission missing, creating in root.');
                    try {
                        newChannel = await guild.channels.create({
                            name: eventName,
                            type: 0,
                            // No parent
                            topic: `イベント: ${eventName} | 作成者: ${interaction.user.username} (カテゴリ権限エラーによりルートに作成)`,
                            permissionOverwrites: [
                                {
                                    id: guild.id,
                                    allow: [PermissionFlagsBits.ViewChannel],
                                    deny: [PermissionFlagsBits.SendMessages]
                                },
                                {
                                    id: client.user.id,
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Administrator]
                                }
                            ]
                        });
                        await interaction.followUp({ content: '⚠️ イベントカテゴリへのアクセス権限がありませんでした。チャンネルをカテゴリ外に作成しました。', ephemeral: true }).catch(e => console.error('FollowUp failed:', e));
                    } catch (fallbackErr) {
                        console.error('Fallback creation failed:', fallbackErr);
                        throw fallbackErr;
                    }
                } else {
                    throw err;
                }
            }

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
                content: '新しいイベントが作成されました！',
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

                try {
                    await notifyChannel.send({ embeds: [notifyEmbed] });
                } catch (e) {
                    console.error('Failed to send notification:', e);
                    // Continue even if notification fails
                    await interaction.followUp({ content: '⚠️ 告知チャンネルへの通知に失敗しました (権限不足)。イベントチャンネルは作成されました。', ephemeral: true }).catch(() => { });
                }
            }

            await interaction.editReply({
                content: `✅ イベントチャンネルを作成しました: ${newChannel}\n告知メッセージを送信しました。`
            });

            // 4. 自動投票イベントの開始
            // 4. 自動投票イベントの開始
            const isPoll = interaction.options.getBoolean('poll_mode');
            if (isPoll) {
                const PollManager = require('../features/poll');
                let pollManifesto = interaction.options.getString('poll_manifesto');
                const pollFile = interaction.options.getAttachment('poll_manifesto_file');

                if (pollFile) {
                    try {
                        const response = await fetch(pollFile.url);
                        if (response.ok) {
                            pollManifesto = await response.text();
                        } else {
                            await interaction.followUp({ content: '⚠️ 添付ファイルの読み込みに失敗しました。', ephemeral: true });
                        }
                    } catch (e) {
                        console.error('File fetch error:', e);
                        await interaction.followUp({ content: '⚠️ 添付ファイルの取得エラーが発生しました。', ephemeral: true });
                    }
                }

                pollManifesto = pollManifesto || eventContent;

                // Proxy Interaction object to redirect Poll to new channel
                // Proxy Interaction object to redirect Poll to new channel
                const proxyInteraction = {
                    user: interaction.user,
                    channel: newChannel,
                    guild: interaction.guild,
                    reply: async (payload) => { /* No-op for safety */ },
                    editReply: async (payload) => {
                        // Append success message to the original interaction
                        const currentContent = (await interaction.fetchReply()).content;
                        await interaction.editReply({ content: currentContent + '\n' + payload.content });
                    },
                    followUp: async (payload) => {
                        // If ephemeral, use original interaction followUp
                        if (payload.ephemeral) {
                            return await interaction.followUp(payload);
                        } else {
                            // If public, send to the new channel
                            return await newChannel.send(payload);
                        }
                    }
                };

                await PollManager.createPoll(proxyInteraction, pollManifesto);
            }

        } catch (error) {
            console.error('イベント作成エラー:', error);
            const { logError } = require('../utils');
            await logError(error, 'Event Creation (/event_create)');

            // Safe Reply/Edit attempt
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply('イベント作成中にエラーが発生しました。');
                } else {
                    await interaction.reply({ content: 'イベント作成中にエラーが発生しました。', ephemeral: true });
                }
            } catch (replyErr) {
                // If interaction is dead (10062), ignore.
                if (replyErr.code !== 10062 && replyErr.code !== 40060) {
                    console.error('Failed to report error to user:', replyErr);
                }
            }
        }
        return;
    }

    // === POLL COMMAND ===
    if (interaction.commandName === 'poll') {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            // Check Admin/Elite? Let's restrict to Admin/Elite for now to prevent spam
            if (!(await checkAdmin(interaction)) && !interaction.member.roles.cache.has(ELITE_ROLE_ID)) {
                return interaction.reply({ content: '⛔ 投票を作成する権限がありません。', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            let configText = interaction.options.getString('config');
            const file = interaction.options.getAttachment('file');

            if (file) {
                // Fetch file content
                try {
                    const response = await fetch(file.url);
                    if (!response.ok) throw new Error('Failed to fetch file');
                    configText = await response.text();
                } catch (e) {
                    return interaction.editReply('❌ 設定ファイルの読み込みに失敗しました。');
                }
            }

            if (!configText) return interaction.editReply('❌ 設定テキストまたはファイルを指定してください。');

            const PollManager = require('../features/poll');
            await PollManager.createPoll(interaction, configText);
        } else if (subcommand === 'end') {
            if (!(await checkAdmin(interaction))) {
                return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
            }
            const pollId = interaction.options.getString('id');
            const PollManager = require('../features/poll');
            const poll = PollManager.polls.get(pollId);

            if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });

            poll.ended = true;
            PollManager.save();

            // Update Message
            const channel = await client.channels.fetch(poll.channelId).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
                if (msg) {
                    await msg.edit({ embeds: [PollManager.generateEmbed(poll)], components: [] });
                    await msg.reply('🛑 投票は終了しました。');
                }
            }
            await interaction.reply({ content: `✅ 投票(ID: ${pollId})を終了しました。`, ephemeral: true });
        } else if (subcommand === 'status') {
            if (!(await checkAdmin(interaction))) {
                return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
            }
            const pollId = interaction.options.getString('id');
            const PollManager = require('../features/poll');
            await PollManager.showStatus(interaction, pollId);
        } else if (subcommand === 'result') {
            if (!(await checkAdmin(interaction))) {
                return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
            }
            const pollId = interaction.options.getString('id');
            const PollManager = require('../features/poll');
            await PollManager.publishResult(interaction, pollId);
        } else if (subcommand === 'preview') {
            const count = interaction.options.getInteger('count') || 5;
            const PollManager = require('../features/poll');
            await PollManager.previewPoll(interaction, count);
        }
        return;
    }

    // === ADMIN SUITE ===
    const ADMIN_COMMANDS = ['admin_control', 'admin_user_mgmt', 'admin_logistics'];
    if (ADMIN_COMMANDS.includes(interaction.commandName)) {
        if (!(await checkAdmin(interaction))) {
            return interaction.reply({ content: '⛔ 権限がありません。', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });

        try {
            // --- Admin Control ---
            if (interaction.commandName === 'admin_control') {
                const channel = interaction.options.getChannel('channel') || interaction.channel;

                if (subcommand === 'lock') {
                    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
                    await interaction.editReply(`🔒 ${channel} をロック（書き込み禁止）しました。`);
                } else if (subcommand === 'unlock') {
                    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
                    await interaction.editReply(`🔓 ${channel} のロックを解除しました。`);
                } else if (subcommand === 'slowmode') {
                    const seconds = interaction.options.getInteger('seconds');
                    await channel.setRateLimitPerUser(seconds);
                    await interaction.editReply(`⏱️ ${channel} の低速モードを ${seconds}秒 に設定しました。`);
                } else if (subcommand === 'wipe') {
                    if (channel.id === MAIN_CHANNEL_ID) return interaction.editReply('❌ メインチャンネルはWipeできません。');

                    await interaction.editReply('⚠️ Wipeを実行します...');
                    const position = channel.position;
                    const newChannel = await channel.clone();
                    await channel.delete();
                    await newChannel.setPosition(position);
                    await newChannel.send('🧹 このチャンネルは管理者によってWipe（再生成）されました。');
                    // We can't edit reply because channel is gone, but operation is done.
                }
            }

            // --- Admin User Management ---
            else if (interaction.commandName === 'admin_user_mgmt') {
                const targetUser = interaction.options.getUser('target');
                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

                if (!member && subcommand !== 'whois') { // DM might work without member, but actions need member usually
                    // Except ban/unban can work with ID, but here we fetched member.
                }

                if (subcommand === 'action') {
                    const type = interaction.options.getString('type');
                    const reason = interaction.options.getString('reason') || '管理者操作';

                    if (type === 'unban') {
                        await interaction.guild.members.unban(targetUser.id, reason);
                        await interaction.editReply(`✅ ${targetUser.tag} のBanを解除しました。`);
                    } else {
                        if (!member) return interaction.editReply('❌ ユーザーがサーバーに見つかりません。');

                        if (type === 'timeout') {
                            const duration = interaction.options.getInteger('duration') || 60;
                            await member.timeout(duration * 60 * 1000, reason);
                            await interaction.editReply(`✅ ${targetUser.tag} を ${duration}分間タイムアウトしました。`);
                        } else if (type === 'untimeout') {
                            await member.timeout(null, reason);
                            await interaction.editReply(`✅ ${targetUser.tag} のタイムアウトを解除しました。`);
                        } else if (type === 'kick') {
                            if (!member.kickable) return interaction.editReply('❌ このユーザーをKickできません。');
                            await member.kick(reason);
                            await interaction.editReply(`✅ ${targetUser.tag} をKickしました。`);
                        } else if (type === 'ban') {
                            if (!member.bannable) return interaction.editReply('❌ このユーザーをBanできません。');
                            await member.ban({ reason });
                            await interaction.editReply(`✅ ${targetUser.tag} をBanしました。`);
                        }
                    }
                } else if (subcommand === 'nick') {
                    if (!member) return interaction.editReply('❌ ユーザーが見つかりません。');
                    const name = interaction.options.getString('name') || null; // null to reset
                    await member.setNickname(name);
                    await interaction.editReply(name ? `✅ ${targetUser.tag} の名前を "${name}" に変更しました。` : `✅ ${targetUser.tag} の名前をリセットしました。`);
                } else if (subcommand === 'dm') {
                    const content = interaction.options.getString('content');
                    const isAnonymous = interaction.options.getBoolean('anonymous');

                    const dmChannel = await targetUser.createDM();
                    if (isAnonymous) {
                        await dmChannel.send(`【管理者より】\n${content}`);
                    } else {
                        const embed = new EmbedBuilder()
                            .setTitle('管理者からのメッセージ')
                            .setDescription(content)
                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                            .setColor(0xFF0000);
                        await dmChannel.send({ embeds: [embed] });
                    }
                    await interaction.editReply(`✅ ${targetUser.tag} にDMを送信しました。`);
                    if (subcommand === 'whois') {
                        const embed = new EmbedBuilder()
                            .setTitle(`About ${targetUser.tag}`)
                            .setThumbnail(targetUser.displayAvatarURL())
                            .addFields(
                                { name: 'User ID', value: targetUser.id, inline: true },
                                { name: 'Account Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
                                { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Not in server', inline: true },
                                { name: 'Roles', value: member ? member.roles.cache.map(r => r.toString()).join(' ') : 'N/A' }
                            )
                            .setColor(0x00BFFF);
                        await interaction.editReply({ embeds: [embed] });
                    }
                }
            }

            else if (interaction.commandName === 'poll') {
                const PollManager = require('../features/poll');
                await PollManager.handlePollCommand(interaction);
            }

            else if (interaction.commandName === 'activity_backfill') {
                if (!await checkAdmin(interaction)) {
                    return interaction.reply({ content: '❌ 権限がありません。', ephemeral: true });
                }
                const ActivityTracker = require('../features/activityTracker');
                await interaction.reply({ content: '✅ アクティビティログのBackfill（過去ログ取得）を手動開始します...', ephemeral: true });

                ActivityTracker.backfill(interaction.client).catch(e => {
                    console.error('Backfill Error:', e);
                });
            }

            else if (interaction.commandName === 'admin_logistics') {
                if (subcommand === 'move_all') {
                    const fromCh = interaction.options.getChannel('from');
                    const toCh = interaction.options.getChannel('to');
                    if (fromCh.type !== ChannelType.GuildVoice || toCh.type !== ChannelType.GuildVoice) {
                        return interaction.editReply('❌ 音声チャンネルを指定してください。');
                    }
                    const members = fromCh.members;
                    let count = 0;
                    for (const [id, m] of members) {
                        await m.voice.setChannel(toCh);
                        count++;
                    }
                    await interaction.editReply(`🚚 ${count}人を ${fromCh.name} から ${toCh.name} に移動しました。`);
                } else if (subcommand === 'say') {
                    const channel = interaction.options.getChannel('channel');
                    if (!channel.isTextBased()) return interaction.editReply('❌ テキストチャンネルを指定してください。');
                    await channel.send(interaction.options.getString('content'));
                    await interaction.editReply(`✅ ${channel} に発言しました。`);
                } else if (subcommand === 'create') {
                    // ... create logic is fine usually, assuming simpler block
                    const name = interaction.options.getString('name');
                    const cType = interaction.options.getString('type') === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
                    const catId = interaction.options.getString('category');
                    const opts = { name, type: cType };
                    if (catId) opts.parent = catId;
                    const newCh = await interaction.guild.channels.create(opts);
                    await interaction.editReply(`✅ チャンネル ${newCh} を作成しました。`);
                } else if (subcommand === 'delete') {
                    const ch = interaction.options.getChannel('channel');
                    await ch.delete();
                    await interaction.editReply(`✅ チャンネル ${ch.name} を削除しました。`);
                } else if (subcommand === 'purge') {
                    const channel = interaction.options.getChannel('channel') || interaction.channel;
                    const amount = interaction.options.getInteger('amount');
                    const user = interaction.options.getUser('user');
                    const keyword = interaction.options.getString('keyword');

                    const msgs = await channel.messages.fetch({ limit: 100 });
                    let filtered = msgs;
                    if (user) filtered = filtered.filter(m => m.author.id === user.id);
                    if (keyword) filtered = filtered.filter(m => m.content.includes(keyword));

                    const toDelete = filtered.first(amount);
                    if (!toDelete || toDelete.length === 0) return interaction.editReply('対象なし');

                    await channel.bulkDelete(toDelete, true);
                    await interaction.editReply(`✅ ${toDelete.length}件削除しました。`);
                } else if (subcommand === 'role') {
                    const target = interaction.options.getUser('target');
                    const role = interaction.options.getRole('role');
                    const action = interaction.options.getString('action');
                    const member = await interaction.guild.members.fetch(target.id);
                    if (action === 'give') await member.roles.add(role);
                    else await member.roles.remove(role);
                    await interaction.editReply(`✅ ${target.tag} に ${role.name} を ${action} しました。`);
                }
            }
        } catch (error) {
            console.error('Admin Command Error:', error);
            await interaction.editReply(`⚠ エラーが発生しました: ${error.message}`);
        }
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
    for (const [id] of processingCommands) {
        processingCommands.delete(id);
    }
}, 30 * 60 * 1000);

module.exports = { handleCommands };
