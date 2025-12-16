const { EmbedBuilder } = require('discord.js');
const crypto = require('crypto');

class TournamentManager {
    async start(interaction, config) {
        await interaction.editReply({ content: '🏆 選手権モードの準備中... 参加者を収集中です。' });

        const guild = interaction.guild;
        // Fetch all members
        const members = await guild.members.fetch();

        // Filter by Roman Numeral Role (Generation Role)
        // Regex from PollManager: /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i
        const romanRegex = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/i;

        const participants = [];
        members.forEach(m => {
            const hasGenRole = m.roles.cache.some(r => romanRegex.test(r.name));
            // Also check for fallback ID if needed, but User requested "Generation Role Members".
            // We'll stick to regex + specific ID.
            const { CURRENT_GENERATION_ROLE_ID } = require('../constants');
            const hasCurrentGen = m.roles.cache.has(CURRENT_GENERATION_ROLE_ID);

            if (hasGenRole || hasCurrentGen) {
                // Determine display name and emoji (default)
                participants.push({
                    name: m.displayName,
                    userId: m.id,
                    emoji: null // Avatar will be used
                });
            }
        });

        if (participants.length < 4) {
            return interaction.followUp({ content: '❌ 参加者が足りません（最低4名）。世代ロールを確認してください。', ephemeral: true });
        }

        // Shuffle
        participants.sort(() => 0.5 - Math.random());

        // Split into 4 Houses
        const houses = ['Griffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin'];
        const groups = {
            'Griffindor': [],
            'Hufflepuff': [],
            'Ravenclaw': [],
            'Slytherin': []
        };

        participants.forEach((p, i) => {
            const house = houses[i % 4];
            groups[house].push(p);
        });

        // Generate Series ID
        const seriesId = crypto.randomUUID();
        const PollManager = require('./poll');

        // Generate Group Image
        const PollVisualizer = require('./pollVisualizer');
        try {
            const groupImage = await PollVisualizer.generateGroupAssignmentImage(groups, config.title);
            await interaction.followUp({ content: '## 📋 予選グループ分け発表', files: [{ attachment: groupImage, name: 'groups.png' }] });
        } catch (e) {
            console.error('Group Image failed:', e);
        }

        // Create Qualifiers
        for (const house of houses) {
            const groupCandidates = groups[house];
            if (groupCandidates.length === 0) continue;

            const pollConfig = {
                ...config,
                title: `${config.title} - 予選ブロック: ${house}`,
                candidates: groupCandidates,
                mode: 'multi', // Qualifiers usually multi? Or single? Let's default to Multi as per generic settings, or override to Single if user specified.
                // Inherit mode from parent config
                seriesId: seriesId,
                stage: 'qualifier',
                house: house,
                maxVotes: config.maxVotes || 2 // Allow 2 votes in qualifiers? Or inherit.
            };

            // We need to send this as a "New Poll".
            // Note: PollManager.createPoll usually takes interaction.
            // We should use a lower level method `createPollFromConfig`.
            // But `createPoll` does interaction reply.
            // We want to post multiple messages.

            // We will add `createPollInternal(channel, config)` to PollManager.
            await PollManager.createPollInternal(interaction.channel, pollConfig);
        }

        await interaction.followUp({ content: '✅ 予選ブロックを作成しました！' });
    }

    async checkSeriesCompletion(seriesId, client) {
        const PollManager = require('./poll');
        const seriesPolls = Array.from(PollManager.polls.values()).filter(p => p.config.seriesId === seriesId && p.config.stage === 'qualifier');

        if (seriesPolls.length === 0) return;

        const allEnded = seriesPolls.every(p => p.ended);
        if (allEnded) {
            // Check if finals already created
            const existingFinal = Array.from(PollManager.polls.values()).find(p => p.config.seriesId === seriesId && p.config.stage === 'final');
            if (existingFinal) return; // Already done

            // Aggregate Winners
            const winners = [];
            for (const poll of seriesPolls) {
                // Calculate winner
                const tally = {};
                poll.config.candidates.forEach(c => tally[c.id] = 0);
                Object.values(poll.votes).forEach(voteList => {
                    voteList.forEach(candId => tally[candId]++);
                });

                // Sort
                const sorted = [...poll.config.candidates].sort((a, b) => tally[b.id] - tally[a.id]);
                if (sorted.length > 0) {
                    const winner = sorted[0];
                    winner.name = `👑 ${winner.name} (${poll.config.house}代表)`;
                    winners.push(winner);
                }
            }

            if (winners.length > 0) {
                // Create Finals
                const finalConfig = {
                    title: `${seriesPolls[0].config.title.split('-')[0].trim()} - 決勝戦`,
                    candidates: winners,
                    mode: 'single', // Finals usually single
                    duration: 24 * 60 * 60 * 1000, // 24h for final
                    seriesId: seriesId,
                    stage: 'final'
                };

                // Post to same channel as first qualifier
                const channel = await client.channels.fetch(seriesPolls[0].channelId).catch(() => null);
                if (channel) {
                    await channel.send('# 🏆 予選終了！ 決勝戦開始！');
                    await PollManager.createPollInternal(channel, finalConfig);
                }
            }
        }
    }
}

module.exports = new TournamentManager();
