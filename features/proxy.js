const {
    AUTO_PROXY_COOLDOWN_MS,
    WORD_PROXY_COOLDOWN_MS,
    ELITE_ROLE_ID
} = require('../constants');
const {
    isImageOrVideo,
    containsFilteredWords,
    hasForceProxyRole
} = require('../utils');

// 状態管理
const autoProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const wordProxyCooldowns = new Map(); // key: userId, value: lastUsedEpochMs
const processingMessages = new Set();
const deletedMessageInfo = new Map(); // key: messageId, value: { content, author, attachments, channel }
const sentWebhookMessages = new Set(); // 送信済みの元メッセージIDを追跡（重複防止）
const sendingWebhooks = new Set(); // webhook.send()実行中のメッセージIDを追跡（送信中のロック）

// 重複処理防止用のキャッシュ（メモリ上にメッセージIDを一時保存）
// これにより、短期間に同じメッセージIDに対して処理が走るのを防ぎます
const processedMessages = new Set();

// Webhook画像重複検出用のキャッシュ
// key: channelId_imageUrl, value: { messageId, timestamp }
const webhookImageCache = new Map();
const DUPLICATE_CHECK_WINDOW_MS = 30000; // 30秒以内の重複を検出

// イベントリスナーの重複登録を防ぐフラグ
let isSetupComplete = false;
let imageProxyHandler = null;
let wordProxyHandler = null;

// ログ用ヘルパー関数
function logWebhookAction(action, messageId, details = {}) {
    const timestamp = new Date().toISOString();
    const detailStr = Object.keys(details).length > 0 
        ? ` | ${JSON.stringify(details)}` 
        : '';
    console.log(`[WEBHOOK-${action}] ${timestamp} | MessageID: ${messageId}${detailStr}`);
}

function setup(client) {
    // 既にセットアップ済みの場合はスキップ（重複登録を防ぐ）
    if (isSetupComplete) {
        console.warn('[PROXY] setup()が既に呼ばれています。重複登録をスキップします。');
        return;
    }
    
    isSetupComplete = true;
    console.log('[PROXY] イベントリスナーを登録します。');

    // 画像自動代行投稿機能のハンドラー
    imageProxyHandler = async message => {
        // BotやWebhookのメッセージは除外
        if (message.author.bot || message.webhookId || message.system) return;
        // 自身のWebhookによる投稿を念のため除外
        if (message.author.username === 'CROSSROID Proxy') return;
        // 添付ファイルがない場合はスキップ
        if (!message.attachments || message.attachments.size === 0) return;

        // 画像・動画ファイルがあるかチェック
        const hasMedia = Array.from(message.attachments.values()).some(attachment => isImageOrVideo(attachment));
        if (!hasMedia) return;

        try {
            // 権限チェック
            if (!message.guild.members.me.permissions.has('ManageMessages')) {
                return;
            }

            // 元のメッセージ情報を保存
            const originalContent = message.content || '';
            const originalAttachments = Array.from(message.attachments.values());
            const originalAuthor = message.author;
            const displayName = message.member?.nickname || originalAuthor.displayName;

            // Webhookを取得または作成
            let webhook;
            try {
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.name === 'CROSSROID Proxy');

                if (!webhook) {
                    webhook = await message.channel.createWebhook({
                        name: 'CROSSROID Proxy',
                        avatar: originalAuthor.displayAvatarURL()
                    });
                }
            } catch (webhookError) {
                console.error(`[画像代行] Webhook取得/作成エラー:`, webhookError);
                return;
            }

            // ファイルを準備
            const files = originalAttachments.map(attachment => ({
                attachment: attachment.url,
                name: attachment.name
            }));

            // 削除ボタン
            const deleteButton = {
                type: 2, // BUTTON
                style: 4, // DANGER
                label: '削除',
                custom_id: `delete_${originalAuthor.id}_${Date.now()}`,
                emoji: '🗑️'
            };

            const actionRow = {
                type: 1, // ACTION_ROW
                components: [deleteButton]
            };

            // コンテンツをサニタイズ
            const sanitizedContent = originalContent
                .replace(/@everyone/g, '@\u200beveryone')
                .replace(/@here/g, '@\u200bhere')
                .replace(/<@&(\d+)>/g, '<@\u200b&$1>');

            // 重複チェック: 同じ画像が30秒以内に送信されていないか確認
            const messageId = message.id;
            const channelId = message.channel.id;
            let isDuplicate = false;
            
            for (const attachment of originalAttachments) {
                if (!isImageOrVideo(attachment)) continue;
                
                const imageUrl = attachment.url;
                const cacheKey = `${channelId}_${imageUrl}`;
                const existing = webhookImageCache.get(cacheKey);
                const now = Date.now();
                
                if (existing && (now - existing.timestamp < DUPLICATE_CHECK_WINDOW_MS)) {
                    // 重複を検出
                    console.log(`[画像代行] 重複画像を検出: MessageID=${messageId}, 既存MessageID=${existing.messageId}, ImageURL=${imageUrl}`);
                    isDuplicate = true;
                    break; // 1つでも重複があればスキップ
                }
            }
            
            // 重複が検出された場合、元のメッセージを削除して終了
            if (isDuplicate) {
                try {
                    await message.delete();
                    console.log(`[画像代行] 重複のため元のメッセージを削除: MessageID=${messageId}`);
                } catch (deleteError) {
                    if (deleteError.code !== 10008) {
                        console.error(`[画像代行] 元のメッセージ削除エラー:`, deleteError);
                    }
                }
                return; // webhook送信をスキップ
            }
            
            // Webhook送信を非同期で開始（完了を待たない）
            console.log(`[画像代行] Webhook送信開始: MessageID=${messageId}, Author=${originalAuthor.id}, Channel=${channelId}, FileCount=${files.length}`);
            const webhookSendPromise = webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                files: files,
                components: [actionRow],
                allowedMentions: { parse: [] }
            }).then((webhookMessage) => {
                console.log(`[画像代行] Webhook送信成功: MessageID=${messageId}, WebhookMessageID=${webhookMessage.id}`);
                
                // 画像URLをキャッシュに追加（重複検知用）
                const now = Date.now();
                for (const attachment of originalAttachments) {
                    if (!isImageOrVideo(attachment)) continue;
                    const imageUrl = attachment.url;
                    const cacheKey = `${channelId}_${imageUrl}`;
                    webhookImageCache.set(cacheKey, {
                        messageId: webhookMessage.id,
                        timestamp: now
                    });
                }
                
                // 削除情報を保存
                deletedMessageInfo.set(webhookMessage.id, {
                    content: originalContent,
                    author: originalAuthor,
                    attachments: originalAttachments,
                    channel: message.channel,
                    originalMessageId: message.id,
                    timestamp: Date.now()
                });
                
                return webhookMessage;
            }).catch((sendError) => {
                // エラーはログに出力するだけ（削除は既に完了しているため）
                console.error(`[画像代行] Webhook送信エラー: MessageID=${messageId}`, sendError);
                throw sendError;
            });

            // 元のメッセージを削除（優先処理：webhook送信の完了を待たない）
            try {
                await message.delete();
            } catch (deleteError) {
                // Unknown Message (10008) は無視
                if (deleteError.code !== 10008) {
                    console.error(`[画像代行] 元のメッセージ削除エラー:`, deleteError);
                }
            }

            // Webhook送信の完了を待つ（バックグラウンド処理）
            // エラーが発生しても処理は続行（既に削除は完了しているため）
            webhookSendPromise.catch(() => {
                // エラーは既にログ出力済み
            });

        } catch (error) {
            console.error(`[画像代行] エラー:`, error);
        }
    };
    
    // 画像自動代行投稿機能のイベントリスナーを登録
    client.on('messageCreate', imageProxyHandler);

    // 特定ワード自動代行機能のハンドラー
    wordProxyHandler = async message => {
        if (message.author.bot || message.webhookId || message.system) return;
        if (message.author.username === 'CROSSROID Word Filter') return;
        if (!message.content || message.content.trim() === '') return;

        if (!containsFilteredWords(message.content)) return;

        const messageId = message.id;
        const userId = message.author.id;
        const lastWordProxyAt = wordProxyCooldowns.get(userId) || 0;
        if (Date.now() - lastWordProxyAt < WORD_PROXY_COOLDOWN_MS) return;

        // ロック機構: 既に処理中の場合は即座にreturn
        if (processingMessages.has(messageId)) {
            logWebhookAction('SKIP-DUPLICATE', messageId, { 
                type: 'word-filter',
                reason: 'Already processing' 
            });
            return;
        }

        // ロックを取得
        processingMessages.add(messageId);
        logWebhookAction('START', messageId, { 
            type: 'word-filter',
            author: userId,
            channel: message.channel.id 
        });

        let shouldProcess = true;
        try {
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!message.guild.members.me.permissions.has('ManageMessages')) {
                logWebhookAction('SKIP', messageId, { 
                    type: 'word-filter',
                    reason: 'Missing ManageMessages permission' 
                });
                shouldProcess = false;
                return;
            }

            const originalContent = message.content;
            const originalAuthor = message.author;
            const displayName = member?.nickname || originalAuthor.displayName;

            // Webhookを取得または作成
            let webhook;
            try {
                logWebhookAction('FETCH-WEBHOOK', messageId, { 
                    type: 'word-filter',
                    channel: message.channel.id 
                });
                const webhooks = await message.channel.fetchWebhooks();
                webhook = webhooks.find(wh => wh.name === 'CROSSROID Word Filter');

                if (!webhook) {
                    logWebhookAction('CREATE-WEBHOOK', messageId, { 
                        type: 'word-filter',
                        channel: message.channel.id 
                    });
                    webhook = await message.channel.createWebhook({
                        name: 'CROSSROID Word Filter',
                        avatar: originalAuthor.displayAvatarURL()
                    });
                    logWebhookAction('WEBHOOK-CREATED', messageId, { 
                        type: 'word-filter',
                        webhookId: webhook.id 
                    });
                } else {
                    logWebhookAction('WEBHOOK-FOUND', messageId, { 
                        type: 'word-filter',
                        webhookId: webhook.id 
                    });
                }
            } catch (webhookError) {
                logWebhookAction('ERROR', messageId, { 
                    type: 'word-filter',
                    stage: 'webhook-fetch-create',
                    error: webhookError.message 
                });
                throw webhookError;
            }

            const sanitizedContent = originalContent
                .replace(/@everyone/g, '@\u200beveryone')
                .replace(/@here/g, '@\u200bhere')
                .replace(/<@&(\d+)>/g, '<@\u200b&$1>');

            logWebhookAction('SEND-START', messageId, { 
                type: 'word-filter',
                webhookId: webhook.id,
                contentLength: sanitizedContent.length 
            });

            // Webhook送信を非同期で開始（完了を待たない）
            console.log(`[ワードフィルター] Webhook送信開始: MessageID=${messageId}, Author=${userId}, Channel=${message.channel.id}`);
            const webhookSendPromise = webhook.send({
                content: sanitizedContent,
                username: displayName,
                avatarURL: originalAuthor.displayAvatarURL(),
                allowedMentions: { parse: [] }
            }).then((webhookMessage) => {
                console.log(`[ワードフィルター] Webhook送信成功: MessageID=${messageId}, WebhookMessageID=${webhookMessage.id}`);
                logWebhookAction('SEND-SUCCESS', messageId, { 
                    type: 'word-filter',
                    webhookId: webhook.id 
                });
                return webhookMessage;
            }).catch((sendError) => {
                logWebhookAction('SEND-ERROR', messageId, { 
                    type: 'word-filter',
                    error: sendError.message,
                    code: sendError.code 
                });
                console.error(`[ワードフィルター] Webhook送信エラー: MessageID=${messageId}`, sendError);
                throw sendError;
            });

            // 元のメッセージを削除（優先処理：webhook送信の完了を待たない）
            let deleteSuccess = false;
            try {
                await message.delete();
                deleteSuccess = true;
                logWebhookAction('DELETE-ORIGINAL', messageId, { 
                    type: 'word-filter',
                    success: true 
                });
            } catch (deleteError) {
                if (deleteError.code !== 10008) {
                    logWebhookAction('DELETE-ERROR', messageId, { 
                        type: 'word-filter',
                        error: deleteError.message,
                        code: deleteError.code 
                    });
                    console.error('元のメッセージの削除に失敗しました:', deleteError);
                } else {
                    logWebhookAction('DELETE-SKIP', messageId, { 
                        type: 'word-filter',
                        reason: 'Message already deleted (10008)' 
                    });
                    deleteSuccess = true; // 既に削除済みなので成功とみなす
                }
            }

            // クールダウンを更新（削除成功時のみ）
            if (deleteSuccess) {
                wordProxyCooldowns.set(userId, Date.now());
            }

            // 削除完了時点でCOMPLETEログを出力（webhook送信の完了を待たない）
            logWebhookAction('COMPLETE', messageId, { 
                type: 'word-filter',
                deleteSuccess: deleteSuccess,
                note: 'Webhook send may still be in progress'
            });

            // Webhook送信の完了を待つ（バックグラウンド処理）
            // エラーが発生しても処理は続行（既に削除は完了しているため）
            webhookSendPromise.catch(() => {
                // エラーは既にログ出力済み
            });

            logWebhookAction('COMPLETE', messageId, { type: 'word-filter' });

        } catch (error) {
            logWebhookAction('ERROR', messageId, { 
                type: 'word-filter',
                error: error.message,
                stack: error.stack?.split('\n')[0] 
            });
            console.error('特定ワード自動代行でエラーが発生しました:', error.message);
        } finally {
            // 確実にロックを解除（早期リターン時も含む）
            if (processingMessages.has(messageId)) {
                processingMessages.delete(messageId);
                logWebhookAction('UNLOCK', messageId, { 
                    type: 'word-filter',
                    processed: shouldProcess !== false 
                });
            }
        }
    };
    
    // 特定ワード自動代行機能のイベントリスナーを登録
    client.on('messageCreate', wordProxyHandler);

    // Webhook画像重複検出・削除機能
    client.on('messageCreate', async message => {
        // Webhookからのメッセージのみを処理
        if (!message.webhookId) return;
        
        // 画像がない場合はスキップ
        if (!message.attachments || message.attachments.size === 0) return;
        
        // 画像・動画ファイルがあるかチェック
        const imageAttachments = Array.from(message.attachments.values()).filter(attachment => isImageOrVideo(attachment));
        if (imageAttachments.length === 0) return;
        
        // 権限チェック
        if (!message.guild.members.me.permissions.has('ManageMessages')) return;

        try {
            const channelId = message.channel.id;
            
            // 各画像URLをチェック
            for (const attachment of imageAttachments) {
                const imageUrl = attachment.url;
                const cacheKey = `${channelId}_${imageUrl}`;
                
                const existing = webhookImageCache.get(cacheKey);
                const now = Date.now();
                
                if (existing) {
                    // 重複を検出（30秒以内）
                    if (now - existing.timestamp < DUPLICATE_CHECK_WINDOW_MS) {
                        console.log(`[画像重複検出] 重複画像を検出: MessageID=${message.id}, 既存MessageID=${existing.messageId}, ImageURL=${imageUrl}`);
                        
                        // 新しいメッセージを削除
                        try {
                            await message.delete();
                            console.log(`[画像重複検出] 新しいメッセージを削除: MessageID=${message.id}`);
                        } catch (deleteError) {
                            if (deleteError.code !== 10008) { // Unknown Messageは無視
                                console.error(`[画像重複検出] 新しいメッセージ削除エラー:`, deleteError);
                            }
                        }
                        
                        // キャッシュは既存のメッセージのまま維持（古い方を残す）
                        // キャッシュは更新しない
                    } else {
                        // 時間が経過しているので、新しいメッセージで更新
                        webhookImageCache.set(cacheKey, {
                            messageId: message.id,
                            timestamp: now
                        });
                    }
                } else {
                    // 初回の画像なのでキャッシュに追加
                    webhookImageCache.set(cacheKey, {
                        messageId: message.id,
                        timestamp: now
                    });
                }
            }
        } catch (error) {
            console.error(`[画像重複検出] エラー:`, error);
        }
    });

    // 定期的なクリーンアップ
    setInterval(() => {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

        for (const [userId, lastUsed] of autoProxyCooldowns.entries()) {
            if (lastUsed < oneHourAgo) autoProxyCooldowns.delete(userId);
        }
        for (const [userId, lastUsed] of wordProxyCooldowns.entries()) {
            if (lastUsed < oneHourAgo) wordProxyCooldowns.delete(userId);
        }
        for (const [messageId, info] of deletedMessageInfo.entries()) {
            if (Date.now() - (info.timestamp || 0) > oneHourAgo) {
                deletedMessageInfo.delete(messageId);
                // 削除情報が消える時、送信済みマークも削除
                sentWebhookMessages.delete(messageId);
            }
        }
        
        // Webhook画像キャッシュのクリーンアップ（5分以上経過したものを削除）
        for (const [cacheKey, data] of webhookImageCache.entries()) {
            if (Date.now() - data.timestamp > fiveMinutesAgo) {
                webhookImageCache.delete(cacheKey);
            }
        }

        // 古い処理中フラグのクリーンアップはSetなので難しいが、通常はfinallyで消える
        // 送信済みマークも1時間以上経過したものは削除
        // 注: messageIdは数値なので、タイムスタンプから推測できないため、
        // deletedMessageInfoと連動して削除する
    }, 30 * 60 * 1000);
}

module.exports = {
    setup,
    deletedMessageInfo // for imageLog to access
};

