// Webhookメッセージの重複画像を検出して削除する機能
// Discordのバグでwebhookで画像が複数回送信される問題に対応

// 画像URLとメッセージ情報を記録
// key: `${channelId}_${imageUrl}`, value: { messageId, timestamp }
const recentImagePosts = new Map();

// 重複検出の時間窓（ミリ秒）
const DUPLICATE_DETECTION_WINDOW_MS = 20 * 1000; // 20秒

// 古い記録を定期的にクリーンアップ（5分ごと）
function startCleanup() {
	setInterval(() => {
		const now = Date.now();
		for (const [key, value] of recentImagePosts.entries()) {
			// 時間窓を超えた古い記録を削除
			if (now - value.timestamp > DUPLICATE_DETECTION_WINDOW_MS * 2) {
				recentImagePosts.delete(key);
			}
		}
	}, 5 * 60 * 1000); // 5分ごと
}

function setup(client) {
	startCleanup();

	client.on('messageCreate', async (message) => {
		try {
			// webhookメッセージのみを処理
			if (!message.webhookId) return;
			
			// 画像が含まれているかチェック
			if (!message.attachments || message.attachments.size === 0) return;
			
			const images = Array.from(message.attachments.values()).filter(
				(attachment) => {
					const contentType = attachment.contentType || '';
					return contentType.startsWith('image/') || 
						   /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(attachment.name || '');
				}
			);
			
			if (images.length === 0) return;
			
			const channelId = message.channel.id;
			const now = Date.now();
			let hasDuplicate = false;
			
			// 各画像について重複チェック
			for (const image of images) {
				const imageUrl = image.url;
				const key = `${channelId}_${imageUrl}`;
				
				const existing = recentImagePosts.get(key);
				
				if (existing) {
					// 同じ画像が短時間内に投稿されている
					const timeDiff = now - existing.timestamp;
					if (timeDiff <= DUPLICATE_DETECTION_WINDOW_MS) {
						// 重複を検出 - このメッセージを削除
						hasDuplicate = true;
						console.log(
							`[WebhookDuplicateRemover] 重複画像を検出: ` +
							`Channel=${channelId}, ImageURL=${imageUrl}, ` +
							`TimeDiff=${timeDiff}ms, MessageID=${message.id}`
						);
						break; // 1つでも重複があれば削除
					} else {
						// 時間窓を超えているので、新しい記録で更新
						recentImagePosts.set(key, {
							messageId: message.id,
							timestamp: now,
						});
					}
				} else {
					// 初めて見る画像なので記録
					recentImagePosts.set(key, {
						messageId: message.id,
						timestamp: now,
					});
				}
			}
			
			// 重複が検出された場合、メッセージを削除
			if (hasDuplicate) {
				try {
					await message.delete();
					console.log(
						`[WebhookDuplicateRemover] 重複メッセージを削除: MessageID=${message.id}`
					);
				} catch (deleteError) {
					console.error(
						`[WebhookDuplicateRemover] メッセージ削除エラー: MessageID=${message.id}`,
						deleteError
					);
				}
			}
		} catch (error) {
			console.error('[WebhookDuplicateRemover] エラー:', error);
		}
	});
}

module.exports = { setup };

