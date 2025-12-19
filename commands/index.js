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

const SUPER_ADMIN_ID = '1198230780032323594';

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

        if (content.includes('\n') || content.length > 256 || content.includes('@everyone') || content.includes('@here') || content.includes('<@&')) {
            processingCommands.delete(commandKey);
            const errEmbed = new EmbedBuilder().setColor(0xFF0000).setDescription('❌ エラー: 改行不可/256文字以内/メンション不可');
            return interaction.reply({ embeds: [errEmbed], ephemeral: true });
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
            const successEmbed = new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ 送信しました (本日${usageData.count}回目)`);
            await interaction.reply({ embeds: [successEmbed], ephemeral: true }).catch(err => {
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
        if (now - last < BUMP_COOLDOWN_MS) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFA500).setDescription('⏳ クールダウン中')], ephemeral: true });
        bumpCooldowns.set(userId, now);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription('👊 Bumpしました')], ephemeral: true });
        return;
    }

    if (interaction.commandName === 'random_mention') {
        const userId = interaction.user.id;
        const now = Date.now();
        if (now - (randomMentionCooldowns.get(userId) || 0) < RANDOM_MENTION_COOLDOWN_MS) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFFA500).setDescription('⏳ Cooling down')], ephemeral: true });
        randomMentionCooldowns.set(userId, now);
        const members = await interaction.guild.members.fetch();
        const random = members.filter(m => !m.user.bot).random();
        if (random) interaction.reply({ content: `${random}`, embeds: [new EmbedBuilder().setColor(0x00FFFF).setDescription(`👋 Hello! You were randomly selected by ${interaction.user.username}!`)], allowedMentions: { users: [random.id] } });
        else interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('❌ No members')] });
        return;
    }



    if (interaction.commandName === 'duel') {
        const fs = require('fs');
        const path = require('path');
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const COOLDOWN_FILE = path.join(__dirname, '..', 'custom_cooldowns.json');

        let cooldowns = {};
        if (fs.existsSync(COOLDOWN_FILE)) { try { cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8')); } catch (e) { } }

        const userId = interaction.user.id;
        const now = Date.now();
        const lastUsed = cooldowns[`battle_${userId}`] || 0;
        const COOLDOWN_DURATION = 24 * 60 * 60 * 1000; // 1 Day (Shared)

        if (now - lastUsed < COOLDOWN_DURATION) {
            const remaining = COOLDOWN_DURATION - (now - lastUsed);
            const hours = Math.ceil(remaining / (60 * 60 * 1000));
            return interaction.reply({ content: `⛔ 戦闘（決闘/ロシアン）は1日1回までです。\n残り: ${hours}時間`, ephemeral: true });
        }

        const opponentUser = interaction.options.getUser('opponent');
        if (opponentUser.id === userId) return interaction.reply({ content: '自分自身と決闘することはできません（それはただの自害です）。', ephemeral: true });
        if (opponentUser.bot) return interaction.reply({ content: 'Botと決闘することはできません。', ephemeral: true });

        const member = interaction.member;
        const opponentMember = await interaction.guild.members.fetch(opponentUser.id).catch(() => null);

        if (!opponentMember) return interaction.reply({ content: '対戦相手の情報を取得できませんでした。', ephemeral: true });

        // Role Check logic
        const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
        const currentGenRoleId = require('../constants').CURRENT_GENERATION_ROLE_ID;

        const isChallengerEligible = member.roles.cache.some(r => romanRegex.test(r.name)) || member.roles.cache.has(currentGenRoleId);
        const isOpponentEligible = opponentMember.roles.cache.some(r => romanRegex.test(r.name)) || opponentMember.roles.cache.has(currentGenRoleId);

        if (!isChallengerEligible) return interaction.reply({ content: '⛔ あなたは決闘の資格（世代ロール）を持っていません。', ephemeral: true });
        if (!isOpponentEligible) return interaction.reply({ content: '⛔ 対戦相手は決闘の資格（世代ロール）を持っていません。', ephemeral: true });

        // Challenge UI
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('duel_accept').setLabel('受けて立つ').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
            new ButtonBuilder().setCustomId('duel_deny').setLabel('逃げる').setStyle(ButtonStyle.Secondary).setEmoji('🏳️')
        );

        const embed = new EmbedBuilder()
            .setTitle('⚔️ 決闘状')
            .setDescription(`${opponentUser}！\n${interaction.user} から決闘を申し込まれました。`)
            .addFields(
                { name: 'ルール', value: '1d100のダイス勝負', inline: true },
                { name: 'ハンデ', value: '仕掛け人は最大95 & 引き分け敗北', inline: true },
                { name: 'ペナルティ', value: '敗者はタイムアウト (Max 15分)', inline: false },
                { name: '注意', value: '受諾後のキャンセル不可', inline: false }
            )
            .setColor(0xFF0000)
            .setThumbnail(interaction.user.displayAvatarURL());

        await interaction.reply({
            content: `${opponentUser}`,
            embeds: [embed],
            components: [row]
        });

        const filter = i => i.user.id === opponentUser.id && (i.customId === 'duel_accept' || i.customId === 'duel_deny');
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

        collector.on('collect', async i => {
            if (i.customId === 'duel_deny') {
                await i.update({ content: `🏳️ ${opponentUser} は決闘を拒否しました。`, components: [] });
                return;
            }

            // Accepted
            const startEmbed = new EmbedBuilder()
                .setTitle('⚔️ 決闘開始')
                .setDescription(`${interaction.user} vs ${opponentUser}\n\nダイスロール中... 🎲`)
                .setColor(0xFFA500);

            await i.update({ content: null, embeds: [startEmbed], components: [] });

            // Cooldown Commit
            cooldowns[`battle_${userId}`] = Date.now();
            try {
                fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
                require('../features/persistence').save(client);
            } catch (e) { }

            await new Promise(r => setTimeout(r, 2000));

            const rollA = Math.floor(Math.random() * 95) + 1; // Handicap: Max 95
            const rollB = Math.floor(Math.random() * 100) + 1;

            let resultMsg = `🎲 **結果** 🎲\n${interaction.user}: **${rollA}** (Handicap)\n${opponentUser}: **${rollB}**\n\n`;
            let loser = null;
            let winner = null;
            let diff = 0;

            if (rollA > rollB) {
                diff = rollA - rollB;
                loser = opponentMember;
                winner = member;
                resultMsg += `🏆 **勝者: ${interaction.user}**\n💀 **敗者: ${opponentUser}**`;
            } else {
                diff = Math.abs(rollB - rollA);
                loser = member;
                winner = opponentMember;
                if (rollA === rollB) resultMsg += `⚖️ **引き分け (防御側の勝利)**\n💀 **敗者: ${interaction.user}**`;
                else resultMsg += `🏆 **勝者: ${opponentUser}**\n💀 **敗者: ${interaction.user}**`;
            }

            // Stats Tracking
            const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
            let duelData = {};
            if (fs.existsSync(DATA_FILE)) { try { duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { } }

            if (!duelData[winner.id]) duelData[winner.id] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
            if (!duelData[loser.id]) duelData[loser.id] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };

            duelData[winner.id].wins++;
            duelData[winner.id].streak++;
            if (duelData[winner.id].streak > duelData[winner.id].maxStreak) duelData[winner.id].maxStreak = duelData[winner.id].streak;

            duelData[loser.id].losses++;
            duelData[loser.id].streak = 0;

            try { fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2)); } catch (e) { }

            resultMsg += `\n📊 **Stats:** ${winner} (${duelData[winner.id].streak}連勝中) vs ${loser}`;

            if (duelData[winner.id].streak >= 3) {
                const { MAIN_CHANNEL_ID } = require('../constants');
                const mainCh = client.channels.cache.get(MAIN_CHANNEL_ID);
                if (mainCh) {
                    mainCh.send(`🔥 **NEWS:** ${winner} が決闘で **${duelData[winner.id].streak}連勝** を達成しました！`);
                }
                try {
                    if (loser.moderatable) {
                        const oldName = loser.nickname || loser.user.username;
                        await loser.setNickname(`敗北者 ${oldName.substring(0, 20)}`).catch(() => { });
                    }
                } catch (e) { }
            }

            let timeoutMinutes = Math.min(15, Math.ceil(diff / 4));
            let penaltyMsg = '';
            if (loser.id === userId) {
                timeoutMinutes += 2;
                penaltyMsg = ' (自爆 +2分)';
            }
            const timeoutMs = timeoutMinutes * 60 * 1000;

            const resultEmbed = new EmbedBuilder()
                .setTitle(winner.id === interaction.user.id || winner.id === opponentUser.id ? '🏆 決闘決着' : '⚖️ 引き分け')
                .setColor(winner.id === interaction.user.id || winner.id === opponentUser.id ? 0xFFD700 : 0x99AAB5)
                .setDescription(`**勝者:** ${winner}\n**敗者:** ${loser}`)
                .addFields(
                    { name: `${interaction.user.username} (攻)`, value: `🎲 **${rollA}**`, inline: true },
                    { name: `${opponentUser.username} (守)`, value: `🎲 **${rollB}**`, inline: true },
                    { name: '差分', value: `${diff}`, inline: true },
                    { name: '処罰', value: `🚨 ${timeoutMinutes}分 タイムアウト${penaltyMsg}`, inline: false },
                    { name: '戦績', value: `${winner}: ${duelData[winner.id].streak}連勝中`, inline: false }
                )
                .setThumbnail(winner.user.displayAvatarURL());

            await interaction.followUp({ embeds: [resultEmbed] });

            if (loser && loser.moderatable) {
                try {
                    await loser.timeout(timeoutMs, `Dueled with ${rollA === rollB ? 'Unknown' : (loser.id === userId ? opponentUser.tag : interaction.user.tag)}`).catch(e => { });
                    await interaction.channel.send(`⚰️ ${loser} は闇に葬られました...`);
                } catch (e) { }
            }

            if (winner) {
                const { ELITE_ROLE_ID, HIGHLIGHT_CHANNEL_ID } = require('../constants');
                try {
                    await winner.roles.add(ELITE_ROLE_ID);
                    setTimeout(async () => { await winner.roles.remove(ELITE_ROLE_ID).catch(() => { }); }, 24 * 60 * 60 * 1000);
                } catch (e) { }

                try {
                    const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
                    if (highlightChannel) {
                        const embed = new EmbedBuilder() // Requires EmbedBuilder in scope?
                            .setTitle('⚔️ 決闘勝者誕生 ⚔️')
                            .setDescription(`${winner} が ${loser} との死闘を制しました！`)
                            .setColor(0xFFD700)
                            .setThumbnail(winner.user.displayAvatarURL())
                            .setTimestamp();
                        await highlightChannel.send({ embeds: [embed] });
                    }
                } catch (e) { }
            }
        });

        // Timeout Handler
        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({ content: '⌛ 時間切れで決闘はキャンセルされました。', components: [] });
            }
        });
    }

    if (interaction.commandName === 'duel_russian') {
        const userId = interaction.user.id;
        const opponentUser = interaction.options.getUser('opponent');

        // Validation
        if (opponentUser.id === userId || opponentUser.bot) return interaction.reply({ content: '自分やBotとは対戦できません。', ephemeral: true });

        // Cooldown Check
        const fs = require('fs');
        const path = require('path');
        const COOLDOWN_FILE = path.join(__dirname, '..', 'custom_cooldowns.json');
        let cooldowns = {};
        if (fs.existsSync(COOLDOWN_FILE)) { try { cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8')); } catch (e) { } }

        const now = Date.now();
        const lastUsed = cooldowns[`battle_${userId}`] || 0;
        const CD_DURATION = 1 * 24 * 60 * 60 * 1000; // 1 Day Cooldown for Russian

        if (now - lastUsed < CD_DURATION) {
            const h = Math.ceil((CD_DURATION - (now - lastUsed)) / (60 * 60 * 1000));
            return interaction.reply({ content: `🔫 整備中です。あと ${h}時間 お待ちください。`, ephemeral: true });
        }

        // UI
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('russian_accept').setLabel('受けて立つ').setStyle(ButtonStyle.Danger).setEmoji('🔫'),
            new ButtonBuilder().setCustomId('russian_deny').setLabel('逃げる').setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setTitle('☠️ ロシアン・デスマッチ')
            .setDescription(`${opponentUser}！\n${interaction.user} から死のゲームへの招待状です。`)
            .addFields(
                { name: 'ルール', value: '1発の実弾が入ったリボルバーを交互に撃つ', inline: false },
                { name: '敗北時', value: '15分 Timeout + Wacchoi(IP)公開', inline: true },
                { name: '勝利時', value: '24時間「上級ロメダ民」', inline: true }
            )
            .setColor(0x000000)
            .setThumbnail('https://cdn.discordapp.com/emojis/1198240562545954936.webp'); // Assuming a skull emoji or similar exists, or remove if not

        await interaction.reply({
            content: `${opponentUser}`,
            embeds: [embed],
            components: [row]
        });

        const filter = i => i.user.id === opponentUser.id && (i.customId === 'russian_accept' || i.customId === 'russian_deny');
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

        collector.on('collect', async i => {
            if (i.customId === 'russian_deny') {
                await i.update({ content: '🏳️ デスマッチは回避されました。', components: [] });
                return;
            }

            // Start
            cooldowns[`battle_${userId}`] = Date.now();
            try { fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2)); require('../features/persistence').save(client); } catch (e) { }

            // Game State
            let cylinder = [0, 0, 0, 0, 0, 0];
            cylinder[Math.floor(Math.random() * 6)] = 1; // Load 1 bullet

            let state = {
                current: 0, // Cylinder Index
                turn: Math.random() < 0.5 ? userId : opponentUser.id
            };

            const triggerRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('trigger').setLabel('引金を引く').setStyle(ButtonStyle.Danger).setEmoji('💀')
            );

            const gameEmbed = new EmbedBuilder()
                .setTitle('🎲 ゲーム開始')
                .setDescription(`**現在のシリンダー:** ${state.current + 1}/6\n**ターン:** <@${state.turn}>`)
                .setColor(0x36393f); // Dark Grey

            await i.update({ content: null, embeds: [gameEmbed], components: [triggerRow] });

            const gameFilter = m => (m.user.id === userId || m.user.id === opponentUser.id) && m.customId === 'trigger';
            const gameCollector = interaction.channel.createMessageComponentCollector({ filter: gameFilter, time: 300000 });

            gameCollector.on('collect', async move => {
                if (move.user.id !== state.turn) return move.reply({ content: 'あなたの番ではありません。', ephemeral: true });

                const isHit = cylinder[state.current] === 1;

                if (isHit) {
                    const deathEmbed = new EmbedBuilder()
                        .setTitle('💥 BANG!!!')
                        .setDescription(`<@${move.user.id}> の頭部が吹き飛びました。\n\n🏆 **勝者:** ${move.user.id === userId ? opponentUser : interaction.user}`)
                        .setColor(0x880000)
                        .setImage('https://media1.tenor.com/m/X215c2D-i_0AAAAC/gun-gunshot.gif'); // Optional: Add visual flair

                    await move.update({ content: null, embeds: [deathEmbed], components: [] });
                    gameCollector.stop('death');

                    // Process Death
                    const loserId = move.user.id;
                    const winnerId = loserId === userId ? opponentUser.id : userId;
                    const loserMember = await interaction.guild.members.fetch(loserId).catch(() => null);
                    const winnerMember = await interaction.guild.members.fetch(winnerId).catch(() => null);

                    // Penalty: Timeout + Wacchoi
                    if (loserMember) {
                        const { generateWacchoi, getAnonymousName } = require('../utils');
                        const isElite = loserMember.roles.cache.has(require('../constants').ELITE_ROLE_ID);
                        const wacchoi = generateWacchoi(loserId);
                        const anonName = getAnonymousName(wacchoi.daily, isElite);

                        const deathReportEmbed = new EmbedBuilder()
                            .setTitle('⚰️ 死亡確認')
                            .setColor(0x000000)
                            .addFields(
                                { name: 'ID (Wacchoi)', value: `\`${wacchoi.full}\``, inline: true },
                                { name: '裏名', value: `**${anonName}**`, inline: true },
                                { name: '処罰', value: '15分間のタイムアウト', inline: false }
                            )
                            .setTimestamp();
                        interaction.channel.send({ embeds: [deathReportEmbed] });
                        if (loserMember.moderatable) {
                            loserMember.timeout(15 * 60 * 1000, 'Russian Deathpoints').catch(() => { });
                        }
                    }

                    // Reward
                    if (winnerMember) {
                        const { ELITE_ROLE_ID, HIGHLIGHT_CHANNEL_ID } = require('../constants');
                        try {
                            await winnerMember.roles.add(ELITE_ROLE_ID);
                            setTimeout(() => winnerMember.roles.remove(ELITE_ROLE_ID).catch(() => { }), 24 * 60 * 60 * 1000);

                            // Stats Update
                            const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');
                            let duelData = {};
                            if (fs.existsSync(DATA_FILE)) { try { duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { } }
                            if (!duelData[winnerId]) duelData[winnerId] = { wins: 0, losses: 0, streak: 0, maxStreak: 0 };
                            duelData[winnerId].wins++;
                            duelData[winnerId].streak++;
                            if (duelData[winnerId].streak > duelData[winnerId].maxStreak) duelData[winnerId].maxStreak = duelData[winnerId].streak;
                            try { fs.writeFileSync(DATA_FILE, JSON.stringify(duelData, null, 2)); } catch (e) { }

                            // Highlight
                            const highlightChannel = client.channels.cache.get(HIGHLIGHT_CHANNEL_ID);
                            if (highlightChannel) {
                                interaction.channel.send(`✨ **勝者** <@${winnerId}> は死地を潜り抜けました！ (現在 ${duelData[winnerId].streak}連勝)`);
                            }
                        } catch (e) { }
                    }

                    return;
                } else {
                    // Miss - Next Turn
                    state.current++;
                    state.turn = state.turn === userId ? opponentUser.id : userId;
                    const nextEmbed = new EmbedBuilder()
                        .setTitle('💨 Click...')
                        .setDescription('セーフです。')
                        .addFields(
                            { name: '次のターン', value: `<@${state.turn}>`, inline: true },
                            { name: 'シリンダー', value: `${state.current + 1}/6`, inline: true }
                        )
                        .setColor(0x57F287); // Green

                    await move.update({ content: null, embeds: [nextEmbed], components: [triggerRow] });
                }
            });

            gameCollector.on('end', (c, reason) => {
                if (reason !== 'death') {
                    interaction.channel.send('⌛ ゲームは時間切れで中断されました。');
                }
            });
        });
        return;
    }

    if (interaction.commandName === 'duel_ranking') {
        const fs = require('fs');
        const path = require('path');
        const DATA_FILE = path.join(__dirname, '..', 'duel_data.json');

        if (!fs.existsSync(DATA_FILE)) {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📊 ランキング').setDescription('データがまだありません。').setColor(0x2F3136)], ephemeral: true });
        }

        let duelData = {};
        try {
            duelData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (e) {
            console.error(e);
            return interaction.reply({ content: 'データ読み込みエラー', ephemeral: true });
        }

        // Convert object to array
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
            .setFooter({ text: '※ 通常決闘とロシアン・デスマッチの合算戦績です' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
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
                    const embed = new EmbedBuilder().setDescription(`🔒 ${channel} をロックしました。`).setColor(0xFF0000);
                    await interaction.editReply({ content: null, embeds: [embed] });
                } else if (subcommand === 'unlock') {
                    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
                    const embed = new EmbedBuilder().setDescription(`🔓 ${channel} のロックを解除しました。`).setColor(0x00FF00);
                    await interaction.editReply({ content: null, embeds: [embed] });
                } else if (subcommand === 'slowmode') {
                    const seconds = interaction.options.getInteger('seconds');
                    await channel.setRateLimitPerUser(seconds);
                    const embed = new EmbedBuilder().setDescription(`⏱️ ${channel} の低速モードを ${seconds}秒 に設定しました。`).setColor(0x0099FF);
                    await interaction.editReply({ content: null, embeds: [embed] });
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
                        const embed = new EmbedBuilder().setTitle('✅ Unban Success').setDescription(`${targetUser.tag} のBanを解除しました。`).setColor(0x00FF00);
                        await interaction.editReply({ content: null, embeds: [embed] });
                    } else {
                        if (!member) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('❌ User Not Found').setColor(0xFF0000).setDescription('ユーザーがサーバーに見つかりません。')] });

                        if (type === 'timeout') {
                            const duration = interaction.options.getInteger('duration') || 60;
                            await member.timeout(duration * 60 * 1000, reason);
                            const embed = new EmbedBuilder().setTitle('✅ Timeout Success').setDescription(`${targetUser.tag} を ${duration}分間タイムアウトしました。`).setColor(0xFFA500);
                            await interaction.editReply({ content: null, embeds: [embed] });
                        } else if (type === 'untimeout') {
                            await member.timeout(null, reason);
                            const embed = new EmbedBuilder().setTitle('✅ Untimeout Success').setDescription(`${targetUser.tag} のタイムアウトを解除しました。`).setColor(0x00FF00);
                            await interaction.editReply({ content: null, embeds: [embed] });
                        } else if (type === 'kick') {
                            if (!member.kickable) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('❌ このユーザーをKickできません。')] });
                            await member.kick(reason);
                            const embed = new EmbedBuilder().setTitle('✅ Kick Success').setDescription(`${targetUser.tag} をKickしました。`).setColor(0xFFA500);
                            await interaction.editReply({ content: null, embeds: [embed] });
                        } else if (type === 'ban') {
                            if (!member.bannable) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('❌ このユーザーをBanできません。')] });
                            await member.ban({ reason });
                            const embed = new EmbedBuilder().setTitle('✅ Ban Success').setDescription(`${targetUser.tag} をBanしました。`).setColor(0xFF0000);
                            await interaction.editReply({ content: null, embeds: [embed] });
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
                await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription('✅ アクティビティログのBackfill（過去ログ取得）を手動開始します...')], ephemeral: true });

                ActivityTracker.backfill(interaction.client).catch(e => {
                    console.error('Backfill Error:', e);
                });
            } else if (interaction.commandName === 'admin_logistics') {
                if (subcommand === 'move_all') {
                    const fromCh = interaction.options.getChannel('from');
                    const toCh = interaction.options.getChannel('to');
                    if (fromCh.type !== ChannelType.GuildVoice || toCh.type !== ChannelType.GuildVoice) {
                        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('❌ 音声チャンネルを指定してください。')] });
                    }
                    const members = fromCh.members;
                    let count = 0;
                    for (const [id, m] of members) {
                        await m.voice.setChannel(toCh);
                        count++;
                    }
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`🚚 ${count}人を ${fromCh.name} から ${toCh.name} に移動しました。`)] });
                } else if (subcommand === 'say') {
                    const channel = interaction.options.getChannel('channel');
                    if (!channel.isTextBased()) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('❌ テキストチャンネルを指定してください。')] });
                    await channel.send(interaction.options.getString('content'));
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ ${channel} に発言しました。`)] });
                } else if (subcommand === 'create') {
                    const name = interaction.options.getString('name');
                    const cType = interaction.options.getString('type') === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
                    const catId = interaction.options.getString('category');
                    const opts = { name, type: cType };
                    if (catId) opts.parent = catId;
                    const newCh = await interaction.guild.channels.create(opts);
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ チャンネル ${newCh} を作成しました。`)] });
                } else if (subcommand === 'delete') {
                    const ch = interaction.options.getChannel('channel');
                    await ch.delete();
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ チャンネル ${ch.name} を削除しました。`)] });
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
                    if (!toDelete || toDelete.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFFA500).setDescription('対象なし')] });

                    await channel.bulkDelete(toDelete, true);
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ ${toDelete.length}件削除しました。`)] });
                } else if (subcommand === 'role') {
                    const target = interaction.options.getUser('target');
                    const role = interaction.options.getRole('role');
                    const action = interaction.options.getString('action');
                    const member = await interaction.guild.members.fetch(target.id);
                    if (action === 'give') await member.roles.add(role);
                    else await member.roles.remove(role);
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(`✅ ${target.tag} に ${role.name} を ${action} しました。`)] });
                }
            }
        } catch (error) {
            console.error('Admin Command Error:', error);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(' Admin Error').setColor(0xFF0000).setDescription(`⚠ エラーが発生しました: ${error.message}`)] });
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
