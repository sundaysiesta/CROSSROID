const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');
const fs = require('fs');
const path = require('path');

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

class PollParser {
    static parse(text) {
        const lines = text.split(/\r?\n/);
        const config = {
            title: 'No Title',
            duration: 24 * 60 * 60 * 1000,
            mode: 'multi', // single, multi
            public: true, // true=public, false=blind
            accountAgeLimit: 0, // days
            allowSelfVote: false,
            candidates: [],
            roles: []
        };

        let section = 'meta'; // meta, settings, candidates

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
            } else if (section === 'settings') {
                const parts = line.split(':');
                if (parts.length < 2) continue;
                const key = parts[0].trim();
                const val = parts[1].trim();

                if (key === '投票モード') {
                    if (val.includes('単一')) config.mode = 'single';
                }
                if (key === '公開設定') {
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
                    if (ids) config.roles = ids;
                }
            } else if (section === 'candidates') {
                // CSV: Name, Emoji
                const parts = line.split(',');
                const name = parts[0].trim();
                const emoji = parts[1] ? parts[1].trim() : null;
                if (name) {
                    config.candidates.push({ name, emoji });
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
        if (config.candidates.length < 2) return interaction.editReply('エラー: 候補者は最低2人必要です。');

        const pollId = Date.now().toString(36);
        const defaultEmojis = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯', '🇰', '🇱', '🇲', '🇳', '🇴', '🇵', '🇶', '🇷', '🇸', '🇹', '🇺', '🇻', '🇼', '🇽', '🇾', '🇿'];
        config.candidates.forEach((c, i) => {
            if (!c.emoji) c.emoji = defaultEmojis[i % defaultEmojis.length];
            c.id = `cand_${i}`;
        });

        const pollState = {
            id: pollId,
            config: config,
            votes: {},
            createdAt: Date.now(),
            authorId: interaction.user.id,
            channelId: interaction.channel.id,
            messageId: null,
            ended: false
        };

        const embed = this.generateEmbed(pollState);
        const components = this.generateComponents(pollState);

        const msg = await interaction.channel.send({ embeds: [embed], components: components });
        pollState.messageId = msg.id;

        this.polls.set(pollId, pollState);
        this.save();

        await interaction.editReply({ content: '✅ 投票を作成しました。' });
    }

    generateEmbed(poll, forceReveal = false) {
        const { config, votes, ended } = poll;
        const totalVotes = Object.keys(votes).length;

        const tally = {};
        config.candidates.forEach(c => tally[c.id] = 0);
        Object.values(votes).forEach(voteList => {
            voteList.forEach(candId => {
                if (tally[candId] !== undefined) tally[candId]++;
            });
        });

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${config.title}`)
            .setColor(ended ? 0x999999 : 0x00BFFF)
            .setTimestamp(poll.createdAt)
            .setFooter({ text: `Poll ID: ${poll.id} | Mode: ${config.mode}` });

        const showResults = forceReveal || (config.public && ended);

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
            let desc = ended ? '投票は終了しました。結果発表をお待ちください。\n\n' : '投票受付中... (結果は非公開です)\n\n';
            config.candidates.forEach(c => {
                desc += `${c.emoji} **${c.name}**\n`;
            });
            embed.setDescription(desc);
        }

        embed.addFields({ name: 'Total Votes', value: totalVotes.toString(), inline: true });
        if (!ended) {
            const endsAt = poll.createdAt + config.duration;
            embed.addFields({ name: 'Ends', value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true });
        }
        return embed;
    }

    generateComponents(poll) {
        if (poll.ended) return [];
        const { config, id } = poll;
        const components = [];

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
                    .setStyle(ButtonStyle.Primary);
                row.addComponents(btn);
            });
            components.push(row);
        } else {
            const chunkSize = 25;
            for (let i = 0; i < config.candidates.length; i += chunkSize) {
                const chunk = config.candidates.slice(i, i + chunkSize);
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`poll_select_${id}_${i}`)
                    .setPlaceholder(`候補者を選択 ${i + 1}〜${i + chunk.length}`)
                    .setMinValues(1)
                    .setMaxValues(config.mode === 'single' ? 1 : chunk.length)
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

        // Improved Logic:
        // Multi Mode with Button -> Toggle
        // Multi Mode with Select -> Replace (Discord UI limitation implies replacement)
        if (poll.config.mode === 'single') {
            poll.votes[interaction.user.id] = votedCands;
        } else {
            if (interaction.isButton()) {
                const current = poll.votes[interaction.user.id] || [];
                const cid = votedCands[0];
                if (current.includes(cid)) {
                    poll.votes[interaction.user.id] = current.filter(id => id !== cid);
                } else {
                    poll.votes[interaction.user.id] = [...current, cid];
                }
                votedCands = poll.votes[interaction.user.id];
            } else {
                poll.votes[interaction.user.id] = votedCands;
            }
        }

        this.save();

        const votedNames = votedCands.map(cid => {
            const c = poll.config.candidates.find(cand => cand.id === cid);
            return c ? `${c.emoji} ${c.name}` : 'Unknown';
        }).join(', ');

        await interaction.reply({ content: `🗳️ 投票を確認しました:\n**${votedNames || '選択解除'}**`, ephemeral: true });

        const msg = await interaction.channel.messages.fetch(poll.messageId).catch(() => null);
        if (msg) {
            await msg.edit({ embeds: [this.generateEmbed(poll)] });
        }
    }

    // New Method: Show Status (Admin Only)
    async showStatus(interaction, pollId) {
        const poll = this.polls.get(pollId);
        if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });
        if (poll.config.public && poll.ended) return interaction.reply({ content: 'この投票は既に結果が公開されています。', ephemeral: true });

        // Show embed with forceReveal=true
        const embed = this.generateEmbed(poll, true);
        embed.setTitle(`🕵️ [Admin Peek] ${poll.config.title}`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // New Method: Publish Result (Admin Only)
    async publishResult(interaction, pollId) {
        const poll = this.polls.get(pollId);
        if (!poll) return interaction.reply({ content: '❌ 指定された投票IDが見つかりません。', ephemeral: true });

        // Send a NEW message with the results
        const embed = this.generateEmbed(poll, true);
        embed.setTitle(`🏆 結果発表: ${poll.config.title}`);

        await interaction.channel.send({ content: '## ⚡ 投票結果発表！', embeds: [embed] });
        await interaction.reply({ content: '✅ 結果を公開しました。', ephemeral: true });

        // Optionally update the original message to closed state (if not already)
        if (!poll.ended) {
            poll.ended = true;
            this.save();
            const msg = await interaction.channel.messages.fetch(poll.messageId).catch(() => null);
            if (msg) await msg.edit({ components: [] }); // Remove buttons
        }
    }
}

module.exports = new PollManager();
