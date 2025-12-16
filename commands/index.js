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
                topic: `イベント: ${eventName} | 作成者: ${interaction.user.username}`,
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: interaction.user.id, // Host
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: ADMIN_ROLE_ID, // Admin Role
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }
                ]
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
                } else if (subcommand === 'whois') {
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

            // --- Admin Logistics ---
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
