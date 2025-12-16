const { createCanvas, registerFont } = require('canvas');
const path = require('path');

// フォントの登録（必要に応じて）
// registerFont(path.join(__dirname, '../resources/fonts/Roboto-Regular.ttf'), { family: 'Roboto' });

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

            // Setup Canvas
            const cardWidth = 220;
            const cardHeight = 300;
            const gap = 20;
            const cols = 5;
            const rows = Math.ceil(sortedCands.length / cols);
            const headerHeight = 100;
            const padding = 40;

            const width = 1200; // Fixed width for championship style
            const height = headerHeight + (rows * (cardHeight + gap)) + padding * 2;

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            // --- Background ---
            const bgGradient = ctx.createLinearGradient(0, 0, width, height);
            bgGradient.addColorStop(0, '#1a1a2e');
            bgGradient.addColorStop(1, '#16213e');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, width, height);

            // --- Header ---
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(config.title || '投票結果発表', width / 2, 60);

            ctx.font = '24px sans-serif';
            ctx.fillStyle = '#aaaaaa';
            ctx.fillText(`総投票数: ${totalVotes}票 (${config.mode === 'single' ? '単一' : '複数'}選択)`, width / 2, 95);

            // --- Grid ---
            const startX = (width - (cols * cardWidth + (cols - 1) * gap)) / 2;
            const startY = headerHeight + padding;

            sortedCands.forEach((c, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                const x = startX + col * (cardWidth + gap);
                const y = startY + row * (cardHeight + gap);

                const count = tally[c.id];
                const percentage = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : '0.0';

                this.drawCard(ctx, x, y, cardWidth, cardHeight, c, index + 1, count, percentage);
            });

            return canvas.toBuffer();

        } catch (error) {
            console.error('Error generating poll image (Canvas):', error);
            throw error;
        }
    }

    drawCard(ctx, x, y, w, h, candidate, rank, votes, percentage) {
        // Card Background (Glassmorphismish)
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';

        // Rank 1 Special Styling
        if (rank === 1) {
            ctx.fillStyle = 'rgba(255, 215, 0, 0.1)';
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
            ctx.lineWidth = 3;
        }

        this.roundRect(ctx, x, y, w, h, 15);
        ctx.fill();
        ctx.stroke();

        if (rank === 1) ctx.lineWidth = 1;

        // Rank Badge
        const badgeColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '#444444';
        ctx.fillStyle = badgeColor;
        this.roundRect(ctx, x + 10, y + 10, 40, 40, 10);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(rank, x + 30, y + 38);

        // Emoji (Large)
        ctx.font = '80px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(candidate.emoji || '❓', x + w / 2, y + 110);

        // Name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px sans-serif';
        this.wrapText(ctx, candidate.name, x + w / 2, y + 160, w - 20, 24);

        // Progress Bar Background
        const barW = w - 40;
        const barH = 10;
        const barX = x + 20;
        const barY = y + h - 50;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        this.roundRect(ctx, barX, barY, barW, barH, 5);
        ctx.fill();

        // Progress Bar Fill
        const fillW = Math.max(0, (parseFloat(percentage) / 100) * barW);
        ctx.fillStyle = rank === 1 ? '#FFD700' : '#4CAF50';
        this.roundRect(ctx, barX, barY, fillW, barH, 5);
        ctx.fill();

        // Stats Text
        ctx.fillStyle = '#cccccc';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${votes}票 (${percentage}%)`, x + w / 2, y + h - 20);

        ctx.restore();
    }

    roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split('');
        let line = '';
        let lines = [];

        // Character based wrapping for Japanese
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n];
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                lines.push(line);
                line = words[n];
            } else {
                line = testLine;
            }
        }
        lines.push(line);

        // Limit to 2 lines
        if (lines.length > 2) {
            lines = lines.slice(0, 2);
            lines[1] = lines[1].slice(0, -1) + '...';
        }

        for (let k = 0; k < lines.length; k++) {
            ctx.fillText(lines[k], x, y + (k * lineHeight));
        }
    }
}

module.exports = new PollVisualizer();
