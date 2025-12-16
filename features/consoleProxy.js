const { ERROR_WEBHOOK_URL } = require('../constants');
const util = require('util');

// Keep references to original functions to avoid infinite loops
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const BATCH_INTERVAL = 2000; // 2 seconds
const MAX_BATCH_USER = 10;
let logQueue = [];
let timer = null;

function formatArgs(args) {
    return args.map(arg => {
        if (typeof arg === 'string') return arg;
        return util.inspect(arg, { colors: false, depth: 3 });
    }).join(' ');
}

function queueMessage(level, args) {
    const text = formatArgs(args);
    // Add timestamp
    const time = new Date().toLocaleTimeString('ja-JP');
    logQueue.push(`[${time}] [${level}] ${text}`);

    // Auto-flush if queue gets too big
    if (logQueue.length >= 20) {
        flush();
    }
}

async function flush() {
    if (logQueue.length === 0) return;

    // reset timer
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }

    // Take snapshot
    const chunk = logQueue.slice(0, 15); // Send max 15 lines at a time to stay under char limit
    logQueue = logQueue.slice(15);

    // If still have items, schedule next flush soon
    if (logQueue.length > 0) {
        timer = setTimeout(flush, 1000);
    }

    const content = chunk.join('\n');
    if (!content.trim()) return;

    // Send to Webhook
    if (!ERROR_WEBHOOK_URL) return;

    try {
        // We use a simple message instead of Embed for dense logs, or Embed for neatness?
        // Code block is best.
        // Truncate if needed (2000 limit)
        const payload = `\`\`\`log\n${content.substring(0, 1900)}\n\`\`\``;

        await fetch(ERROR_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: payload })
        });
    } catch (e) {
        // USE ORIGINAL ERROR to avoid loop
        originalError('Failed to send log to webhook:', e);
    }
}

function setup() {
    console.log = (...args) => {
        originalLog.apply(console, args); // Print to stdout
        queueMessage('INFO', args);
        if (!timer) timer = setTimeout(flush, BATCH_INTERVAL);
    };

    console.warn = (...args) => {
        originalWarn.apply(console, args);
        queueMessage('WARN', args);
        if (!timer) timer = setTimeout(flush, BATCH_INTERVAL);
    };

    console.error = (...args) => {
        originalError.apply(console, args);
        queueMessage('ERROR', args);
        if (!timer) timer = setTimeout(flush, BATCH_INTERVAL);
    };

    // System Log
    queueMessage('SYSTEM', ['Console Proxy Initialized. All output redirected to webhook.']);
}

module.exports = { setup };
