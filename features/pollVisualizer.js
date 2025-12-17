const { createCanvas, registerFont, loadImage } = require('canvas');
const path = require('path');

// Font Configuration (Variations)
const FONTS = {
    TITLE: '"Dela Gothic One"',
    RANK: '"Dela Gothic One"',
    GEN: '"Zen Antique"',
    NAME: '"NotoSansJP"',
    META: '"Arial"'
};

// フォントの登録
try {
    registerFont(path.join(__dirname, '../resources/fonts/NotoSansJP-Bold.otf'), { family: 'NotoSansJP' });
    registerFont(path.join(__dirname, '../resources/fonts/DelaGothicOne-Regular.ttf'), { family: 'Dela Gothic One' });
    registerFont(path.join(__dirname, '../resources/fonts/ZenAntique-Regular.ttf'), { family: 'Zen Antique' });
} catch (e) {
    console.warn('Font registration failed, falling back to system fonts:', e.message);
}

class PollVisualizer {
    constructor() {
        this.colors = {
            bgTop: '#0f172a',
            bgBot: '#1e293b',
            cardBg: 'rgba(30, 41, 59, 0.7)',
            textMain: '#f8fafc',
            textSub: '#94a3b8',
            gold: '#fbbf24',
            silver: '#e2e8f0',
            bronze: '#b45309',
            pass: '#4ade80',
            fail: '#ef4444',
            accent: '#3b82f6',
            border: 'rgba(255,255,255,0.1)'
        };
        // Semaphore to prevent OOM
        this.lock = Promise.resolve();
    }

    async _runWithLock(fn) {
        const next = this.lock.then(fn);
        // Catch errors to prevent queue blockage
        this.lock = next.catch(e => console.error('Visualizer Lock Error:', e));
        return next;
    }

    // Helper: Round Rect
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

    async generateRankingImage(poll) {
        return this._runWithLock(() => this._generateRankingImageInternal(poll));
    }

    async _generateRankingImageInternal(poll) {
        try {
            const { config, votes } = poll;
            const totalVotes = Object.keys(votes).length;

            const tally = {};
            config.candidates.forEach(c => tally[c.id] = 0);
            Object.values(votes).forEach(voteList => {
                voteList.forEach(candId => {
                    if (tally[candId] !== undefined) tally[candId]++;
                });
            });

            const sortedCands = [...config.candidates];
            sortedCands.sort((a, b) => tally[b.id] - tally[a.id]);

            // Layout
            const padding = 60;
            const headerHeight = 150;
            const cardHeight = 100;
            const gap = 20;

            // Calc Height
            const contentHeight = sortedCands.length * (cardHeight + gap);
            const width = 1200;
            const height = Math.max(800, headerHeight + padding + contentHeight + padding);

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            // --- Background (Modern Dark) ---
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, this.colors.bgTop);
            grad.addColorStop(1, this.colors.bgBot);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            // subtle mesh pattern
            ctx.strokeStyle = 'rgba(255,255,255,0.03)';
            ctx.lineWidth = 1;
            for (let i = 0; i < width; i += 50) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke(); }
            for (let i = 0; i < height; i += 50) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke(); }

            // --- Header ---
            ctx.fillStyle = this.colors.textMain;
            ctx.textAlign = 'left';
            ctx.font = 'bold 48px "NotoSansJP"';
            ctx.fillText(config.title, padding, 80);

            ctx.font = '24px "NotoSansJP"';
            ctx.fillStyle = this.colors.textSub;
            ctx.fillText(`${config.mode.toUpperCase()} MODE / TOTAL VOTES: ${totalVotes}`, padding, 120);

            // --- List ---
            let y = headerHeight + padding;

            // Pre-load avatars
            const avatars = {};
            await Promise.all(sortedCands.map(async c => {
                if (c.avatarURL) {
                    try { avatars[c.id] = await loadImage(c.avatarURL); } catch (e) { }
                }
            }));

            for (let i = 0; i < sortedCands.length; i++) {
                const c = sortedCands[i];
                const count = tally[c.id];
                const percentage = totalVotes > 0 ? (count / totalVotes) : 0;
                const rank = i + 1;

                // Card BG
                ctx.fillStyle = this.colors.cardBg;
                this.roundRect(ctx, padding, y, width - padding * 2, cardHeight, 16);
                ctx.fill();

                // Border
                ctx.strokeStyle = this.colors.border;
                if (rank === 1) ctx.strokeStyle = this.colors.gold;
                ctx.lineWidth = 2;
                ctx.stroke();

                // 1. Rank
                ctx.fillStyle = rank === 1 ? this.colors.gold : (rank === 2 ? this.colors.silver : (rank === 3 ? this.colors.bronze : this.colors.textSub));
                ctx.font = 'bold 36px "NotoSansJP"';
                ctx.textAlign = 'center';
                ctx.fillText(`#${rank}`, padding + 50, y + 65);

                // 2. Avatar
                const avSize = 70;
                const avX = padding + 110;
                const avY = y + 15;
                ctx.save();
                ctx.beginPath();
                ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                if (avatars[c.id]) ctx.drawImage(avatars[c.id], avX, avY, avSize, avSize);
                else {
                    ctx.fillStyle = '#334155'; ctx.fillRect(avX, avY, avSize, avSize);
                    ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(c.emoji || '👤', avX + avSize / 2, avY + avSize / 2);
                }
                ctx.restore();

                // 3. Name
                ctx.fillStyle = this.colors.textMain;
                ctx.textAlign = 'left';
                ctx.font = 'bold 28px "NotoSansJP"';
                ctx.fillText(c.name, avX + avSize + 30, y + 45);

                // 4. Progress Bar
                const barX = avX + avSize + 30;
                const barY = y + 60;
                const barW = width - (padding * 2) - (barX - padding) - 150; // space for count
                const barH = 12;

                // Track
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                this.roundRect(ctx, barX, barY, barW, barH, 6);
                ctx.fill();

                // Fill
                const fillW = Math.max(0, percentage * barW);
                if (fillW > 0) {
                    const gradBar = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
                    gradBar.addColorStop(0, this.colors.accent);
                    gradBar.addColorStop(1, '#60a5fa');
                    if (rank === 1) { gradBar.addColorStop(0, '#f59e0b'); gradBar.addColorStop(1, '#fbbf24'); }
                    ctx.fillStyle = gradBar;
                    this.roundRect(ctx, barX, barY, fillW, barH, 6);
                    ctx.fill();
                }

                // 5. Count
                ctx.fillStyle = this.colors.textMain;
                ctx.textAlign = 'right';
                ctx.font = 'bold 32px "NotoSansJP"';
                ctx.fillText(count, width - padding - 20, y + 65);

                y += cardHeight + gap;
            }

            return canvas.toBuffer();
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    async generateGroupAssignmentImage(groups, title) {
        const width = 1200;
        const height = 900;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // BG
        ctx.fillStyle = this.colors.bgTop;
        ctx.fillRect(0, 0, width, height);

        // Title
        ctx.fillStyle = this.colors.textMain;
        ctx.textAlign = 'center';
        ctx.font = 'bold 42px "NotoSansJP"';
        ctx.fillText(title || 'TOURNAMENT GROUPS', width / 2, 60);

        const houses = {
            'Griffindor': { color: '#ef4444', x: 0, y: 100 },
            'Hufflepuff': { color: '#eab308', x: 600, y: 100 },
            'Ravenclaw': { color: '#3b82f6', x: 0, y: 500 },
            'Slytherin': { color: '#22c55e', x: 600, y: 500 }
        };

        const qW = 600;
        const qH = 400;

        for (const [houseKey, candidates] of Object.entries(groups)) {
            const hInfo = houses[houseKey];
            const qx = hInfo.x; const qy = hInfo.y;

            // Header Background
            ctx.fillStyle = hInfo.color;
            ctx.globalAlpha = 0.1;
            ctx.fillRect(qx, qy, qW, qH);
            ctx.globalAlpha = 1.0;

            // Header Strip
            ctx.fillStyle = hInfo.color;
            ctx.fillRect(qx, qy, qW, 60);

            // House Name
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 32px "NotoSansJP"';
            ctx.textAlign = 'center';
            ctx.fillText(houseKey.toUpperCase(), qx + qW / 2, qy + 40);

            // List
            ctx.textAlign = 'left';
            ctx.font = '18px "NotoSansJP"';

            let nx = qx + 40;
            let ny = qy + 100;
            candidates.forEach((c, i) => {
                if (i === 10) { nx = qx + qW / 2 + 20; ny = qy + 100; }
                ctx.fillStyle = this.colors.textMain;
                ctx.fillText(`${i + 1}. ${c.name}`, nx, ny);
                ny += 28;
            });

            // Border
            ctx.strokeStyle = hInfo.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(qx, qy, qW, qH);
        }

        return canvas.toBuffer();
    }

    async generateQualifierPasserImage(candidates, house, title) {
        return this._runWithLock(() => this._generateQualifierPasserImageInternal(candidates, house, title));
    }

    async _generateQualifierPasserImageInternal(candidates, house, title) {
        const width = 1920; // Widen to HD
        const height = 600;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // House Colors (Muted)
        const houses = {
            'Griffindor': ['#7f1d1d', '#991b1b'],
            'Hufflepuff': ['#713f12', '#a16207'],
            'Ravenclaw': ['#1e3a8a', '#1d4ed8'],
            'Slytherin': ['#14532d', '#15803d']
        };
        const colors = houses[house] || ['#333', '#444'];

        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, colors[0]);
        grad.addColorStop(1, colors[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // Header
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(0, 0, width, height); // dim overlay

        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = `bold 42px ${FONTS.TITLE}`; // Use Configured Font
        ctx.fillText(`QUALIFIER PASSED - ${house.toUpperCase()}`, width / 2, 80);
        ctx.shadowBlur = 0;

        // Dynamic Layout
        const cw = 300; // Slightly smaller to fit 5
        const ch = 380;
        const gap = 30;
        const totalW = candidates.length * cw + (candidates.length - 1) * gap;
        const startX = (width - totalW) / 2;
        const startY = 150;

        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            const x = startX + i * (cw + gap);

            // Card
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            this.roundRect(ctx, x, startY, cw, ch, 16);
            ctx.fill();

            // Rank Badge
            ctx.fillStyle = '#64748b'; // Default (4th+) Slate
            if (i === 0) ctx.fillStyle = this.colors.gold;
            if (i === 1) ctx.fillStyle = this.colors.silver;
            if (i === 2) ctx.fillStyle = this.colors.bronze;

            ctx.beginPath();
            ctx.moveTo(x + 20, startY); ctx.lineTo(x + 60, startY); ctx.lineTo(x + 60, startY + 50); ctx.lineTo(x + 40, startY + 40); ctx.lineTo(x + 20, startY + 50);
            ctx.fill();
            ctx.fillStyle = '#000'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(i + 1, x + 40, startY + 30);

            // Avatar
            const r = 80;
            const cx = x + cw / 2;
            const cy = startY + 110;
            ctx.save();
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
            try {
                if (c.avatarURL) {
                    const img = await loadImage(c.avatarURL);
                    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
                } else {
                    ctx.fillStyle = '#555'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
                }
            } catch (e) { }
            ctx.restore();
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();

            // Name
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.font = 'bold 24px "NotoSansJP"';
            this.wrapText(ctx, c.name, cx, cy + r + 40, cw - 20, 30);

            ctx.restore();
        }

        return canvas.toBuffer();
    }

    async generateVictoryImage(candidate, rank) {
        return this._runWithLock(() => this._generateVictoryImageInternal(candidate, rank));
    }

    async _generateVictoryImageInternal(candidate, rank) {
        const size = 1024;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // Theme
        const theme = {
            1: { bg: '#ca8a04', title: 'CHAMPION' },
            2: { bg: '#94a3b8', title: '2ND PLACE' },
            3: { bg: '#b45309', title: '3RD PLACE' }
        }[rank] || { bg: '#475569', title: 'WINNER' };

        // Bg
        const grad = ctx.createRadialGradient(size / 2, size / 2, 100, size / 2, size / 2, 800);
        grad.addColorStop(0, '#1e293b');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Burst
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.strokeStyle = theme.bg;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.3;
        for (let i = 0; i < 36; i++) {
            ctx.rotate(Math.PI / 18);
            ctx.beginPath(); ctx.moveTo(150, 0); ctx.lineTo(500, 0); ctx.stroke();
        }
        ctx.restore();

        // Circle
        const cx = size / 2;
        const cy = size / 2 - 80;
        const r = 240;

        // Glow
        ctx.shadowColor = theme.bg;
        ctx.shadowBlur = 80;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
        ctx.shadowBlur = 0;

        // Avatar
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
        try {
            if (candidate.avatarURL) {
                const img = await loadImage(candidate.avatarURL);
                ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
            } else {
                ctx.fillStyle = '#333'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            }
        } catch (e) { }
        ctx.restore();

        // Ring
        ctx.strokeStyle = theme.bg; ctx.lineWidth = 15;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

        // Title
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 110px "NotoSansJP"';
        ctx.shadowColor = theme.bg; ctx.shadowBlur = 20;
        ctx.fillText(theme.title, size / 2, 130);
        ctx.shadowBlur = 0;

        // Name
        ctx.font = 'bold 80px "NotoSansJP"';
        this.wrapText(ctx, candidate.name, size / 2, size - 180, size - 100, 90);

        ctx.font = '30px "NotoSansJP"';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('CROSSROID CHAMPIONSHIP', size / 2, size - 60);

        return canvas.toBuffer();
    }

    async generateFinalRankingImage(candidates, title) {
        return this._runWithLock(() => this._generateFinalRankingImageInternal(candidates, title));
    }

    async _generateFinalRankingImageInternal(candidates, title) {


        const width = 1920;
        const height = 1080;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // --- Helper: Draw Card ---
        const drawCard = async (c, x, y, w, h, rank) => {
            // Card Base
            const colors = ['#FFD700', '#C0C0C0', '#CD7F32', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#9ca3af', '#f87171'];
            const baseColor = rank <= 3 ? colors[rank - 1] : colors[(rank - 1) % colors.length];

            ctx.fillStyle = '#fff';
            ctx.fillRect(x, y, w, h);

            // Avatar
            try {
                if (c.avatarURL) {
                    const img = await loadImage(c.avatarURL);
                    // Aspect ratio crop
                    const avatarH = h - 80; // Reserve bottom for name
                    ctx.drawImage(img, x, y, w, avatarH);
                } else {
                    ctx.fillStyle = '#333';
                    ctx.fillRect(x, y, w, h - 80);
                }
            } catch (e) {
                ctx.fillStyle = '#333';
                ctx.fillRect(x, y, w, h - 80);
            }

            // Rank Badge (Top Left triangular ribbon style)
            ctx.fillStyle = baseColor;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 100, y);
            ctx.lineTo(x, y + 100);
            ctx.fill();

            ctx.fillStyle = '#000';
            ctx.font = rank === 1 ? `bold 60px ${FONTS.RANK}` : `bold 40px ${FONTS.RANK}`;
            ctx.textAlign = 'left';
            ctx.fillText(rank, x + 10, y + 45); // Adjust pos

            // Vote Badge (Top Right)
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.beginPath();
            ctx.moveTo(x + w, y);
            ctx.lineTo(x + w - 120, y);
            ctx.lineTo(x + w, y + 80);
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.textAlign = 'right';
            ctx.font = `bold 30px ${FONTS.RANK}`;
            ctx.fillText(`${c.votes}票`, x + w - 5, y + 35);

            // Generation Overlay (Bottom Right of Avatar area, Role Color with heavy stroke)
            if (c.generation) {
                const genY = y + h - 90;
                const genX = x + w - 10;

                ctx.save();
                ctx.font = `900 48px ${FONTS.GEN}`; // Extra Heavy
                ctx.textAlign = 'right';
                // Heavy Stroke
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 8;
                ctx.lineJoin = 'round';
                ctx.strokeText(c.generation, genX, genY);
                // Color Fill (Avoid black on black stroke)
                const fillColor = (c.generationColor && c.generationColor !== '#000000') ? c.generationColor : '#ffffff';
                ctx.fillStyle = fillColor;
                ctx.fillText(c.generation, genX, genY);
                ctx.restore();
            }

            // Name Bar (Bottom)
            ctx.fillStyle = '#fff';
            ctx.fillRect(x, y + h - 80, w, 80);

            // Name Text
            ctx.fillStyle = '#000';
            ctx.textAlign = 'center';
            ctx.font = `bold 40px ${FONTS.NAME}`;

            // Name Shadow for "Detail"
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            this.wrapText(ctx, c.name, x + w / 2, y + h - 45, w - 20, 40);
            ctx.restore();

            // Rank Color Strip at bottom
            ctx.fillStyle = baseColor;
            ctx.fillRect(x, y + h - 10, w, 10);
        };

        // --- Background (Diagonal Stripes) ---
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#1e293b');
        bgGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Stripes
        ctx.save();
        ctx.lineWidth = 40;
        for (let i = -1000; i < width + height; i += 80) {
            const color = Math.abs(i) % 160 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)';
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i - height, height);
            ctx.stroke();
        }
        ctx.restore();

        // --- Header ---
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, 120);

        ctx.fillStyle = '#fff';
        ctx.font = `bold 60px ${FONTS.TITLE}`;
        ctx.textAlign = 'left';
        ctx.fillText(title || 'CHAMPIONSHIP RESULT', 40, 80);

        ctx.textAlign = 'right';
        ctx.font = `bold 30px ${FONTS.META}`;
        ctx.fillStyle = '#f472b6'; // Pink
        const dateStr = new Date().toLocaleDateString();
        ctx.fillText(dateStr, width - 40, 80);
        ctx.fillStyle = '#fff';
        ctx.fillText(`${candidates.length} Participants`, width - 40, 40);

        // --- Layout Strategy ---
        // Rank 1: Left Giant
        const rank1 = candidates[0];
        if (rank1) {
            await drawCard(rank1, 50, 150, 500, 800, 1);
        }

        // Grid (Rank 2+)
        const others = candidates.slice(1);
        const gridStartX = 600;
        const gridStartY = 150;
        const gridW = width - gridStartX - 50;
        const cols = 4;
        const cardW = (gridW - (cols - 1) * 30) / cols;
        const cardH = 350;

        for (let i = 0; i < others.length; i++) {
            if (i >= 8) break; // Limit to 8 others (Top 9 total) to fit screen
            const c = others[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = gridStartX + col * (cardW + 30);
            const y = gridStartY + row * (cardH + 30);

            await drawCard(c, x, y, cardW, cardH, i + 2);
        }

        // Footer / Watermark
        ctx.fillStyle = '#fff';
        ctx.font = `bold 20px ${FONTS.META}`;
        ctx.textAlign = 'right';
        ctx.fillText('andROMEDA: OBLIVION', width - 20, height - 10);

        return canvas.toBuffer();
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
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                lines.push(line);
                line = words[n];
            } else {
                line = testLine;
            }
        }
        lines.push(line);
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
