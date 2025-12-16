const { createCanvas, registerFont, loadImage } = require('canvas');
const path = require('path');

// フォントの登録
try {
    registerFont(path.join(__dirname, '../resources/fonts/NotoSansJP-Bold.otf'), { family: 'NotoSansJP' });
} catch (e) {
    console.warn('Font registration failed, falling back to system fonts:', e.message);
}

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

            // Setup Layout
            const headerHeight = 120;
            const padding = 40;
            const width = 1200;

            // Grid Config
            const rightGridStartX = 420;
            const rightColWidth = 230;
            const cardHeight = 260; // Standard card height
            const gap = 20;
            const rightCols = 3;

            // Calculate Rows needed
            // Rank 1 takes left side (equivalent to 2 rows height)
            // Remaining (N-1) take grid spots.
            const gridItems = sortedCands.length - 1;
            const gridRows = Math.ceil(Math.max(0, gridItems) / rightCols);
            const totalRows = Math.max(2, gridRows); // At least 2 rows for Rank 1

            const contentHeight = totalRows * (cardHeight + gap);
            const height = headerHeight + padding + contentHeight + padding;

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
            ctx.textAlign = 'center';
            ctx.font = 'bold 36px "NotoSansJP", sans-serif';
            ctx.fillText(config.title || '投票結果発表', width / 2, 60);

            ctx.font = '24px "NotoSansJP", sans-serif';
            ctx.fillStyle = '#aaaaaa';
            ctx.fillText(`総投票数: ${totalVotes} 票(${config.mode === 'single' ? '単一' : '複数'}選択)`, width / 2, 100);

            // --- Draw Candidates ---
            const startY = headerHeight + padding;

            // Pre-load all avatars
            const avatars = {};
            await Promise.all(sortedCands.map(async c => {
                if (c.avatarURL) {
                    try {
                        avatars[c.id] = await loadImage(c.avatarURL);
                    } catch (e) {
                        console.warn('Failed to load avatar:', e.message);
                    }
                }
            }));

            for (let i = 0; i < sortedCands.length; i++) {
                const c = sortedCands[i];
                const count = tally[c.id];
                const percentage = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : '0.0';
                const rank = i + 1;

                let x, y, w, h;

                if (i === 0) {
                    // Rank 1 (Big Left)
                    x = 40;
                    y = startY;
                    w = 340;
                    h = (cardHeight * 2) + gap; // Span 2 rows
                } else {
                    // Grid (Right)
                    const gridIndex = i - 1;
                    const col = gridIndex % rightCols;
                    const row = Math.floor(gridIndex / rightCols);
                    x = rightGridStartX + col * (rightColWidth + gap);
                    y = startY + row * (cardHeight + gap);
                    w = rightColWidth;
                    h = cardHeight;
                }

                this.drawCard(ctx, x, y, w, h, c, rank, count, percentage, avatars[c.id]);
            }

            // Footer / Timestamp
            ctx.fillStyle = '#666666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(new Date().toLocaleString('ja-JP'), width - 20, height - 10);

            return canvas.toBuffer();

        } catch (error) {
            console.error('Error generating poll image (Canvas):', error);
            throw error;
        }
    }

    async generateGroupAssignmentImage(groups, title) {
        try {
            const width = 1200;
            const height = 900;
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            // Background
            ctx.fillStyle = '#16213e';
            ctx.fillRect(0, 0, width, height);

            // Title
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 40px "NotoSansJP", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(title || '選手権 予選グループ表', width / 2, 60);

            const houses = {
                'Griffindor': { color: '#740001', name: 'グリフィンドール', x: 0, y: 100 },
                'Hufflepuff': { color: '#ecb939', name: 'ハッフルパフ', x: 600, y: 100 },
                'Ravenclaw': { color: '#0e1a40', name: 'レイブンクロー', x: 0, y: 500 },
                'Slytherin': { color: '#1a472a', name: 'スリザリン', x: 600, y: 500 }
            };

            const quadrantW = 600;
            const quadrantH = 400;

            for (const [houseKey, candidates] of Object.entries(groups)) {
                const style = houses[houseKey];
                const qx = style.x;
                const qy = style.y;

                // Quadrant Background (faint)
                ctx.fillStyle = style.color;
                ctx.globalAlpha = 0.2;
                ctx.fillRect(qx, qy, quadrantW, quadrantH);
                ctx.globalAlpha = 1.0;

                // Border
                ctx.strokeStyle = style.color;
                ctx.lineWidth = 4;
                ctx.strokeRect(qx + 10, qy + 10, quadrantW - 20, quadrantH - 20);

                // Header
                ctx.fillStyle = style.color;
                ctx.fillRect(qx + 10, qy + 10, quadrantW - 20, 50);

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 28px "NotoSansJP", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(style.name, qx + quadrantW / 2, qy + 45);

                // List Names
                ctx.font = '18px "NotoSansJP", sans-serif';
                ctx.textAlign = 'left';
                let ny = qy + 90;
                let nx = qx + 40;

                // 2 Columns if needed
                candidates.forEach((c, i) => {
                    if (i === 10) { // Move to 2nd column after 10 names
                        nx = qx + quadrantW / 2 + 20;
                        ny = qy + 90;
                    }
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(`${i + 1}. ${c.name}`, nx, ny);
                    ny += 28;
                });
            }

            // Footer
            ctx.fillStyle = '#666666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(new Date().toLocaleString('ja-JP'), width - 20, height - 10);

            return canvas.toBuffer();
        } catch (e) {
            console.error('Group Image Gen Failed:', e);
            throw e;
        }
    }

    drawCard(ctx, x, y, w, h, candidate, rank, votes, percentage, avatarImage) {
        // Card Background
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';

        // Rank 1 Special Styling
        if (rank === 1) {
            ctx.fillStyle = 'rgba(255, 215, 0, 0.1)';
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
            ctx.lineWidth = 4;
        } else if (rank === 2) {
            ctx.strokeStyle = 'rgba(192, 192, 192, 0.5)';
            ctx.lineWidth = 2;
        } else if (rank === 3) {
            ctx.strokeStyle = 'rgba(205, 127, 50, 0.5)';
            ctx.lineWidth = 2;
        }

        this.roundRect(ctx, x, y, w, h, 15);
        ctx.fill();
        ctx.stroke();

        // Icon / Avatar
        const iconSize = rank === 1 ? w * 0.6 : w * 0.45;
        const iconX = x + (w - iconSize) / 2;
        const iconY = y + (rank === 1 ? 60 : 50);

        ctx.save();
        ctx.beginPath();
        ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (avatarImage) {
            ctx.drawImage(avatarImage, iconX, iconY, iconSize, iconSize);
        } else {
            // Fallback Emoji or Placeholder
            ctx.fillStyle = '#333';
            ctx.fillRect(iconX, iconY, iconSize, iconSize);
            ctx.fillStyle = '#fff';
            ctx.font = `${iconSize * 0.6}px sans - serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(candidate.emoji || '👤', iconX + iconSize / 2, iconY + iconSize / 2);
        }
        ctx.restore();

        // Initial Reset
        ctx.lineWidth = 1;
        ctx.textBaseline = 'alphabetic';

        // Rank Badge (Flag Style top-left)
        ctx.save();
        const badgeSize = rank === 1 ? 80 : 50;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + badgeSize, y);
        ctx.lineTo(x, y + badgeSize);
        ctx.closePath();
        ctx.fillStyle = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '#444444';
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${rank === 1 ? '32px' : '20px'} sans - serif`;
        ctx.textAlign = 'left';
        ctx.fillText(rank, x + 5, y + (rank === 1 ? 35 : 25));
        ctx.restore();

        // Name
        const nameY = iconY + iconSize + 30;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = `bold ${rank === 1 ? '32px' : '20px'} "NotoSansJP", sans - serif`;
        this.wrapText(ctx, candidate.name, x + w / 2, nameY, w - 20, rank === 1 ? 40 : 26);

        // Vote Count (Top Right)
        ctx.fillStyle = '#cccccc';
        ctx.font = `bold ${rank === 1 ? '24px' : '18px'} sans - serif`;
        ctx.textAlign = 'right';
        ctx.fillText(`${votes} 票`, x + w - 10, y + 30);

        // Generation Badge (Bottom Right)
        if (candidate.generation) {
            ctx.save();
            ctx.font = 'bold 24px serif'; // Serif for Roman numerals
            ctx.fillStyle = candidate.generationColor || '#00ff88'; // Use role color or default green
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;
            ctx.textAlign = 'right';
            ctx.fillText(candidate.generation, x + w - 10, y + h - 10);
            ctx.restore();
        }

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
