const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

const POLL_DATA_FILE = path.join(__dirname, '../poll_data.json');

// --- Helper: Time Parser (24h -> ms) ---
function parseDuration(str) {
    if (!str) return 24 * 60 * 60 * 1000; // default 24h
    const match = str.match(/(\d+)(h|m|d)/);
    if (!match) return 24 * 60 * 60 * 1000;
    const val = parseInt(match[1]);
    const unit = match[2];
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
}

// --- Helper: Date Parser ---
function parseDate(str) {
    if (!str) return null;
    let date = new Date(str);
    if (!isNaN(date.getTime())) return date.getTime();
    return null;
}

class PollParser {
    static parse(text) {
        const lines = text.split(/\r?\n/);
        const config = {
            title: 'No Title',
            duration: 24 * 60 * 60 * 1000,
            startDate: null,
            mode: 'multi',
            maxVotes: 0,
            public: true,
            accountAgeLimit: 0,
            allowSelfVote: false,
            candidates: [],
            roles: []
        };

        let section = 'meta';

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;

            if (line === '[設定]' || line === '[Settings]') {
                section = 'settings';
                continue;
            }
            if (line === '[候補者]' || line === '[Candidates]') {
                section = 'candidates';
                continue;
            }

            if (section === 'meta') {
                const parts = line.split(':');
                if (parts.length < 2) continue;
                const key = parts[0].trim();
                const val = parts.slice(1).join(':').trim();

                if (key === 'タイトル' || key === 'Title') config.title = val;
                if (key === '終了' || key === 'End') config.duration = parseDuration(val);
                if (key === '開始' || key === 'Start') config.startDate = parseDate(val);

                if (key === '予選期間' || key === 'QualifierDuration') config.qualifierDuration = parseDuration(val);
                if (key === '決勝期間' || key === 'FinalDuration') config.finalDuration = parseDuration(val);
                if (key === '予選開始' || key === 'QualifierStart') config.qualifierStart = parseDate(val);
                if (key === '決勝開始' || key === '本番開始' || key === 'FinalStart') config.finalStart = parseDate(val);
            } else if (section === 'settings') {
                const parts = line.split(':');
                if (parts.length < 2) continue;
                const key = parts[0].trim();
                const val = parts[1].trim();

                if (key === '投票モード') {
                    if (val.includes('単一')) config.mode = 'single';
                    if (val.includes('選手権') || val.includes('Championship')) config.mode = 'championship';
                }
                if (key === '一人あたりの票数' || key === 'MaxVotes') {
                    const limit = parseInt(val);
                    if (!isNaN(limit)) config.maxVotes = limit;
                }
                if (key === '予選票数' || key === 'QualifierMaxVotes') {
                    const limit = parseInt(val);
                    if (!isNaN(limit)) config.qualifierMaxVotes = limit;
                }
                if (key === '決勝票数' || key === 'FinalMaxVotes') {
                    const limit = parseInt(val);
                    if (!isNaN(limit)) config.finalMaxVotes = limit;
                }

                // Allow Duration/Start in Settings section too
                if (key === '予選期間' || key === 'QualifierDuration') config.qualifierDuration = parseDuration(val);
                if (key === '決勝期間' || key === 'FinalDuration') config.finalDuration = parseDuration(val);
                if (key === '予選開始' || key === 'QualifierStart') config.qualifierStart = parseDate(val);
                if (key === '決勝開始' || key === '本番開始' || key === 'FinalStart') config.finalStart = parseDate(val);

                if (key === '公開設定' || key === 'Public') {
                    if (val.includes('ブラインド') || val.includes('非公開') || val.includes('完全非公開')) config.public = false;
                }
                if (key === 'アカウント制限') {
                    const days = parseInt(val);
                    if (!isNaN(days)) config.accountAgeLimit = days;
                }
                if (key === '自己投票') {
                    if (val.includes('許可')) config.allowSelfVote = true;
                }
                if (key === '参加資格') {
                    const ids = val.match(/\d{17,19}/g);
                    if (ids) {
                        config.roles.push(...ids);
                    }
                }
            } else if (section === 'candidates') {
                // CSV: Name, Emoji
                const parts = line.split(',');
                const name = parts[0].trim();
                const emoji = parts[1] ? parts[1].trim() : null;
                if (name) {
                    const mentionMatch = name.match(/<@!?(\d+)>/);
                    const userId = mentionMatch ? mentionMatch[1] : null;
                    config.candidates.push({ name, emoji, userId });
                }
            }
        }
        return config;
    }
}

class PollManager {
    constructor() {
        this.polls = new Map();
        this.load();
    }

    load() {
        if (fs.existsSync(POLL_DATA_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(POLL_DATA_FILE, 'utf8'));
                for (const [id, poll] of Object.entries(data)) {
                    this.polls.set(id, poll);
                }
            } catch (e) {
                console.error('Poll Load Error:', e);
            }
        }
    }

    save() {
        const obj = {};
        for (const [id, poll] of this.polls) {
            obj[id] = poll;
        }
        fs.writeFileSync(POLL_DATA_FILE, JSON.stringify(obj, null, 2));
    }

    async createPoll(interaction, textConfig) {
        const config = PollParser.parse(textConfig);

        // Check for Championship Mode
        if (config.mode === 'championship') {
            const TournamentManager = require('./tournament');
            return await TournamentManager.start(interaction, config);
        }

        if (config.candidates.length < 2) return interaction.editReply('エラー: 候補者は最低2人必要です。');

        const pollState = await this.createPollInternal(interaction.channel, config, interaction.user.id);

        let replyMsg = '✅ 投票を作成しました。';
        if (pollState.startsAt > Date.now()) {
            replyMsg += `\n開始日時: <t:${Math.floor(pollState.startsAt / 1000)}:f>`;
        }
        await interaction.editReply({ content: replyMsg });
    }

    async createPollInternal(channel, config, authorId) {
        const pollId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5); // Unique ID
        const defaultEmojis = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴', '🇵', '🇶', '🇷', '🇸', '🇹', '🇺', '🇻', '🇼', '🇽', '🇾', '🇿'];
        config.candidates.forEach((c, i) => {
            if (!c.emoji) c.emoji = defaultEmojis[i % defaultEmojis.length];
            c.id = `c${i}`;
        });

        // Set effective start date
        const now = Date.now();
        const effectiveStart = config.startDate && config.startDate > now ? config.startDate : now;

        const pollState = {
            id: pollId,
            config: config,
            votes: {},
            createdAt: now,
            startsAt: effectiveStart,
            authorId: authorId,
            channelId: channel.id,
            messageId: null,
            ended: false,
            processing: false // Lock flag
        };

        const embed = this.generateEmbed(pollState);
        const components = this.generateComponents(pollState);

        const msg = await channel.send({ embeds: [embed], components: components });
        pollState.messageId = msg.id;

        this.polls.set(pollId, pollState);
        this.save();

        return pollState;
    }

    generateEmbed(poll, forceReveal = false) {
        const { config, votes, ended, startsAt } = poll;
        const totalVotes = Object.keys(votes).length;
        const now = Date.now();
        const isStarted = now >= startsAt;

        const tally = {};
        config.candidates.forEach(c => tally[c.id] = 0);
        Object.values(votes).forEach(voteList => {
            voteList.forEach(candId => {
                if (tally[candId] !== undefined) tally[candId]++;
            });
        });

        const statusColor = ended ? 0x999999 : (isStarted ? 0x00BFFF : 0xFFA500);
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${config.title}`)
            .setColor(statusColor)
            .setTimestamp(poll.createdAt)
            .setFooter({ text: `Poll ID: ${poll.id} | Mode: ${config.mode}` });

        const showResults = forceReveal || (config.public && ended && isStarted);

        if (showResults) {
            let desc = '';
            const sortedCands = [...config.candidates];
            sortedCands.sort((a, b) => tally[b.id] - tally[a.id]);

            sortedCands.forEach((c, index) => {
                const count = tally[c.id];
                const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                const barLength = Math.round(percentage / 10);
                const bar = '▓'.repeat(barLength) + '░'.repeat(10 - barLength);

                let rank = '';
                if (index === 0) rank = '🥇 ';
                else if (index === 1) rank = '🥈 ';
                else if (index === 2) rank = '🥉 ';
                else rank = `${index + 1}. `;

                desc += `${rank} ${c.emoji} **${c.name}**: ${count}票 (${percentage.toFixed(1)}%)\n\`${bar}\`\n`;
            });
            embed.setDescription(desc);
        } else {
            let desc = '';
            if (!isStarted) {
                desc = `⏳ **開始待機中**\n開始まですこしお待ちください。\nTime: <t:${Math.floor(startsAt / 1000)}:R>\n\n`;
            } else if (ended) {
                desc = '投票は終了しました。結果発表をお待ちください。\n\n';
            } else {
                desc = '投票受付中... (結果は非公開です)\n\n';
            }

            config.candidates.forEach(c => {
                desc += `${c.emoji} **${c.name}**\n`;
            });
            embed.setDescription(desc);
        }

        embed.addFields({ name: 'Total Votes', value: totalVotes.toString(), inline: true });

        if (!isStarted) {
            embed.addFields({ name: 'Starts', value: `<t:${Math.floor(startsAt / 1000)}:F>`, inline: true });
        } else if (!ended) {
            const endsAt = startsAt + config.duration;
            embed.addFields({ name: 'Ends', value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true });
        }

        return embed;
    }

    generateComponents(poll) {
        if (poll.ended) return [];
        const { config, id, startsAt } = poll;
        const now = Date.now();
        const isStarted = now >= startsAt;
        const components = [];
        const disabled = !isStarted;

        if (config.candidates.length <= 20) {
            let row = new ActionRowBuilder();
            config.candidates.forEach((c, index) => {
                if (index > 0 && index % 5 === 0) {
                    components.push(row);
                    row = new ActionRowBuilder();
                }
                const btn = new ButtonBuilder()
                    .setCustomId(`poll_vote_${id}_${c.id}`)
                    .setLabel(c.name.substring(0, 80))
                    .setEmoji(c.emoji)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled);
                row.addComponents(btn);
            });
            components.push(row);
        } else {
            const chunkSize = 25;
            for (let i = 0; i < config.candidates.length; i += chunkSize) {
                const chunk = config.candidates.slice(i, i + chunkSize);
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`poll_select_${id}_${i}`)
                    .setPlaceholder(disabled ? '開始待機中...' : `候補者を選択 ${i + 1}〜${i + chunk.length}`)
                    .setMinValues(1)
                    .setMaxValues(config.mode === 'single' ? 1 : chunk.length)
                    .setDisabled(disabled)
                    .addOptions(chunk.map(c => ({
                        label: c.name.substring(0, 100),
                        value: c.id,
                        emoji: c.emoji
                    })));
                components.push(new ActionRowBuilder().addComponents(menu));
            }
        }
        return components;
    }

    async handleInteraction(client, interaction) {
        const parts = interaction.customId.split('_');
        const pollId = parts[2];
        const poll = this.polls.get(pollId);

        if (!poll) return interaction.reply({ content: 'この投票は終了しているか、存在しません。', ephemeral: true });
        if (Date.now() < poll.startsAt) {
            return interaction.reply({ content: `⏳ 投票はまだ開始されていません。\n開始時刻: <t:${Math.floor(poll.startsAt / 1000)}:R>`, ephemeral: true });
        }

        const member = interaction.member;

        if (poll.config.accountAgeLimit > 0) {
            const ageDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
            if (ageDays < poll.config.accountAgeLimit) {
                return interaction.reply({ content: `⛔ アカウント作成から${poll.config.accountAgeLimit}日経過していないため投票できません。`, ephemeral: true });
            }
        }

        if (poll.config.roles.length > 0) {
            const hasRole = member.roles.cache.some(r => poll.config.roles.includes(r.id));
            if (!hasRole) return interaction.reply({ content: '⛔ 投票権限がありません。', ephemeral: true });
        }

        if (!poll.config.allowSelfVote) {
            const targetIds = [];
            if (interaction.isButton()) targetIds.push(parts[3]);
            if (interaction.isStringSelectMenu()) targetIds.push(...interaction.values);

            const targetNames = targetIds.map(tid => poll.config.candidates.find(c => c.id === tid)?.name);
            const myName = member.displayName;
            const myUser = member.user.username;

            if (targetNames.some(n => n === myName || n === myUser)) {
                return interaction.reply({ content: '⛔ 自己投票は禁止されています。', ephemeral: true });
            }
        }

        let votedCands = [];
        if (interaction.isButton()) {
            const candId = parts[3];
            votedCands = [candId];
        } else if (interaction.isStringSelectMenu()) {
            votedCands = interaction.values;
        }

        let currentVotes = poll.votes[interaction.user.id] || [];
        if (poll.config.mode === 'single') {
            poll.votes[interaction.user.id] = votedCands;
        } else {
            if (interaction.isButton()) {
                const cid = votedCands[0];
                if (currentVotes.includes(cid)) {
                    poll.votes[interaction.user.id] = currentVotes.filter(id => id !== cid);
                } else {
                    if (poll.config.maxVotes > 0 && currentVotes.length >= poll.config.maxVotes) {
                        return interaction.reply({ content: `⛔ 一人あたり最大 ${poll.config.maxVotes}票 までです。`, ephemeral: true });
                    }
                    poll.votes[interaction.user.id] = [...currentVotes, cid];
                }
            } else {
                if (poll.config.maxVotes > 0 && votedCands.length > poll.config.maxVotes) {
                    return interaction.reply({ content: `⛔ 選択数が多すぎます。最大 ${poll.config.maxVotes}票 までです。`, ephemeral: true });
                }
                poll.votes[interaction.user.id] = votedCands;
            }
        }

        votedCands = poll.votes[interaction.user.id] || [];
        this.save();

        const votedNames = votedCands.map(cid => {
            const c = poll.config.candidates.find(cand => cand.id === cid);
            return c ? `${c.emoji} ${c.name}` : 'Unknown';
        }).join(', ');

        await interaction.reply({ content: `🗳️ 投票を確認しました:\n**${votedNames || '選択解除'}**`, ephemeral: true });

        const msg = await interaction.channel.messages.fetch(poll.messageId).catch(() => null);
        if (msg) {
            await msg.edit({ embeds: [this.generateEmbed(poll)], components: this.generateComponents(poll) });
        }
    }

    async showStatus(interaction, pollId) {
        const poll = this.polls.get(pollId);
        if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });

        const embed = this.generateEmbed(poll, true);
        embed.setTitle(`🕵️ [Admin Peek] ${poll.config.title}`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async publishResult(interaction, pollId) {
        const poll = this.polls.get(pollId);
        if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });

        if (poll.processing) return interaction.reply({ content: '⚠️ 現在集計処理中です。しばらくお待ちください。', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        await this._executePublish(poll, interaction.channel);
        await interaction.editReply({ content: '✅ 結果を公開しました。' });
    }

    async _executePublish(poll, channel) {
        if (poll.processing || poll.ended) return; // Dual check
        poll.processing = true;

        // Save immediately to prevent race conditions during long image gen
        this.save();

        console.log(`[PollManager] Publishing results for ${poll.id}...`);

        try {
            const embed = this.generateEmbed(poll, true);
            embed.setTitle(`🏆 結果発表: ${poll.config.title}`);
            embed.setImage('attachment://ranking.png');

            const PollVisualizer = require('./pollVisualizer');
            let files = [];
            try {
                const enrichedPoll = { ...poll };
                enrichedPoll.config = { ...poll.config };
                enrichedPoll.config.candidates = await Promise.all(poll.config.candidates.map(async c => {
                    const enriched = { ...c };
                    if (c.userId) {
                        try {
                            const member = await channel.guild.members.fetch(c.userId).catch(() => null);
                            if (member) {
                                enriched.avatarURL = member.displayAvatarURL({ extension: 'png', size: 256 });
                                // Gen Role Logic...
                                const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;
                                let genRole = member.roles.cache.find(r => romanRegex.test(r.name));
                                if (!genRole) genRole = member.roles.cache.get(require('../constants').CURRENT_GENERATION_ROLE_ID);
                                if (genRole) {
                                    enriched.generation = genRole.name.toUpperCase();
                                    enriched.generationColor = genRole.hexColor;
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                    return enriched;
                }));

                const imageBuffer = await PollVisualizer.generateRankingImage(enrichedPoll);
                files = [{ attachment: imageBuffer, name: 'ranking.png' }];
            } catch (e) {
                console.error('Failed to generate ranking image:', e);
                embed.setFooter({ text: '画像生成に失敗しました' });
            }

            await channel.send({ content: '## ⚡ 投票結果発表！', embeds: [embed], files: files });

            // Finalize
            poll.ended = true;
            poll.processing = false; // Release lock (though ended=true prevents recurrence)
            this.save();

            const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
            if (msg) await msg.edit({ components: [] });

            // Check for Tournament Progression
            if (poll.config.seriesId) {
                const TournamentManager = require('./tournament');
                TournamentManager.checkSeriesCompletion(poll.config.seriesId, channel.client).catch(console.error);
            }

        } catch (e) {
            console.error('Publish Execution Failed:', e);
            poll.processing = false; // Release lock on error to retry?
            this.save();
        }
    }

    startTicker(client) {
        if (this.ticker) clearInterval(this.ticker);
        console.log('Poll Scheduler Started.');
        this.ticker = setInterval(async () => {
            const now = Date.now();
            for (const poll of this.polls.values()) {
                if (!poll.ended && !poll.processing) {
                    const endsAt = poll.startsAt + poll.config.duration;
                    if (now >= endsAt) {
                        try {
                            const channel = await client.channels.fetch(poll.channelId).catch(() => null);
                            if (channel) {
                                console.log(`Auto-ending poll ${poll.id}`);
                                await this._executePublish(poll, channel);
                            } else {
                                console.warn(`Channel not found for poll ${poll.id}`);
                                poll.ended = true;
                                this.save();
                            }
                        } catch (e) {
                            console.error(`Error auto-ending poll ${poll.id}:`, e);
                        }
                    }
                }
            }
        }, 60 * 1000);
    }

    async previewPoll(interaction, count = 5) {
        await interaction.deferReply({ ephemeral: true });

        const emojis = ['🍎', '🍊', '🍇', '🍓', '🍌', '🍉', '🥝', '🍒', '🍑', '🍍', '🍈', '🍋', '🍐', '🥭'];
        const names = ['Sample Candidate A', 'Dr. Mario', 'Super Long Name User Who Has Too Many Titles', 'The Underrated', 'Newcomer', 'Legendary Hero', 'Villain'];

        const candidates = [];
        for (let i = 0; i < count; i++) {
            candidates.push({
                id: `mock${i}`,
                name: names[i % names.length] + (i > 6 ? ` ${i}` : ''),
                emoji: emojis[i % emojis.length],
                avatarURL: null,
                generation: Math.random() > 0.5 ? (Math.random() > 0.5 ? 'XVI' : 'VII') : null
            });
        }

        const config = {
            title: '【Preview】 人気投票選手権',
            mode: 'multi',
            candidates: candidates
        };

        const votes = {};
        const totalVotes = 100 + Math.floor(Math.random() * 500);

        for (let v = 0; v < totalVotes; v++) {
            let targetIndex = 0;
            const r = Math.random();
            if (r < 0.3) targetIndex = 0;
            else if (r < 0.5) targetIndex = 1;
            else if (r < 0.65) targetIndex = 2;
            else targetIndex = Math.floor(Math.random() * count);

            const uid = `voter_${v}`;
            votes[uid] = [candidates[targetIndex].id];
        }

        const mockPoll = {
            config: config,
            votes: votes
        };

        const PollVisualizer = require('./pollVisualizer');
        try {
            const imageBuffer = await PollVisualizer.generateRankingImage(mockPoll);
            await interaction.editReply({
                content: '✅ **Design Preview Generated**\n実際のデザインを確認してください。',
                files: [{ attachment: imageBuffer, name: 'preview.png' }]
            });
        } catch (e) {
            await interaction.editReply({ content: 'Preview Gen Failed: ' + e.message });
        }
    }
}

module.exports = new PollManager();
