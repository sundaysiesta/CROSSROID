const nodeHtmlToImage = require('node-html-to-image');
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '../resources/poll/template.html');
const STYLE_PATH = path.join(__dirname, '../resources/poll/style.css');

class PollVisualizer {
    async generateRankingImage(poll) {
        try {
            const { config, votes } = poll;
            const totalVotes = Object.keys(votes).length;

            // Tally
            const tally = {};
            config.candidates.forEach(c => tally[c.id] = 0);
            Object.values(votes).forEach(voteList => {
                voteList.forEach(candId => {
                    if (tally[candId] !== undefined) tally[candId]++;
                });
            });

            // Sort
            const sortedCands = [...config.candidates];
            sortedCands.sort((a, b) => tally[b.id] - tally[a.id]);

            // Prepare Data for Handlebars
            const candidatesData = sortedCands.map((c, index) => {
                const count = tally[c.id];
                const percentage = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : '0.0';

                let rankDisplay = (index + 1).toString();
                let rankNum = (index + 1);

                if (index === 0) rankDisplay = '🥇';
                if (index === 1) rankDisplay = '🥈';
                if (index === 2) rankDisplay = '🥉';

                return {
                    name: c.name,
                    emoji: c.emoji,
                    votes: count,
                    percentage: percentage,
                    rankDisplay: rankDisplay,
                    rankNum: rankNum
                };
            });

            const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
            const css = fs.readFileSync(STYLE_PATH, 'utf8');

            // Inject CSS into template (Handlebars variable)
            // Note: node-html-to-image uses Handlebars internally

            const imageBuffer = await nodeHtmlToImage({
                html: html,
                content: {
                    styles: css,
                    title: config.title,
                    totalVotes: totalVotes,
                    mode: config.mode,
                    candidates: candidatesData
                },
                puppeteerArgs: {
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                },
                transparent: true
            });

            return imageBuffer;

        } catch (error) {
            console.error('Error generating poll image:', error);
            throw error;
        }
    }
}

module.exports = new PollVisualizer();
