# ヒサメbot API仕様書（部活投資システム用）

## 📋 概要

CROSSROIDの部活投資システムが、ヒサメbotから部活のアクティブポイントを取得するためのAPI仕様です。

---

## 🔌 必須API

### 1. 部活アクティブポイント取得API

**エンドポイント**: `GET /api/club/activity/:channelId`

**リクエスト例**:
```http
GET /api/club/activity/1234567890123456789
Headers:
  x-api-token: your_api_token_here
```

**パラメータ**:
- `channelId`: DiscordチャンネルID（部活チャンネルのID）

**レスポンス（成功時）**:
```json
{
  "channelId": "1234567890123456789",
  "activityPoint": 15000,
  "rank": 2,
  "lastUpdated": 1704067200000
}
```

**レスポンス（エラー時）**:
```json
{
  "error": "部活が見つかりません",
  "channelId": "1234567890123456789"
}
```

**フィールド説明**:
- `channelId`: リクエストしたチャンネルID
- `activityPoint`: 部活の現在のアクティブポイント（整数、0以上）
- `rank`: 部活ランキング順位（1位が最高、整数）
- `lastUpdated`: 最終更新日時（Unix timestamp、ミリ秒）

**HTTPステータスコード**:
- `200`: 成功
- `404`: 部活が見つからない
- `401`: 認証失敗
- `500`: サーバーエラー

---

## 🔄 更新頻度

### 推奨更新頻度
- **リアルタイム更新**: アクティブポイントが変動するたびに更新（理想）
- **定期更新**: 最低でも1時間ごとに更新
- **ランキング更新時**: 部活ランキングが更新されるタイミングで同時に更新

### 更新タイミングの推奨
1. 部活チャンネルでメッセージが送信された時
2. 部活ランキングが更新される時（週1回など）
3. 定期的なバッチ処理（1時間ごとなど）

---

## 📊 アクティブポイントの計算方法

現在のアクティブポイント分布（参考）:
- 1位: 20,000ポイント
- 2位: 13,000ポイント
- 3-4位: 5,000ポイント以上
- 5-7位: 1,000ポイント以上
- 8-13位: 100ポイント以上
- 14位以降: 100ポイント未満

**注意**: この分布は参考値です。実際の計算方法はヒサメbotの実装に依存します。

---

## 🔐 認証方法

### APIトークン認証

**ヘッダー名**: `x-api-token`

**設定方法**:
- CROSSROID側で環境変数 `API_TOKEN` を設定
- ヒサメbot側で同じトークンを使用してAPIを呼び出す

**例**:
```javascript
const response = await fetch(`http://crossroid-api/api/club/activity/${channelId}`, {
  headers: {
    'x-api-token': process.env.API_TOKEN
  }
});
```

---

## 🎯 使用例

### JavaScript (Node.js)

```javascript
const axios = require('axios');

async function getClubActivity(channelId) {
  try {
    const response = await axios.get(
      `http://crossroid-api/api/club/activity/${channelId}`,
      {
        headers: {
          'x-api-token': process.env.API_TOKEN
        }
      }
    );
    
    return {
      activityPoint: response.data.activityPoint,
      rank: response.data.rank,
      lastUpdated: response.data.lastUpdated
    };
  } catch (error) {
    if (error.response?.status === 404) {
      console.error('部活が見つかりません');
    } else {
      console.error('API呼び出しエラー:', error);
    }
    return null;
  }
}

// 使用例
const activity = await getClubActivity('1234567890123456789');
if (activity) {
  console.log(`アクティブポイント: ${activity.activityPoint}`);
  console.log(`ランキング: ${activity.rank}位`);
}
```

### Python

```python
import requests
import os

def get_club_activity(channel_id):
    url = f"http://crossroid-api/api/club/activity/{channel_id}"
    headers = {
        "x-api-token": os.getenv("API_TOKEN")
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return {
            "activity_point": data["activityPoint"],
            "rank": data["rank"],
            "last_updated": data["lastUpdated"]
        }
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            print("部活が見つかりません")
        else:
            print(f"API呼び出しエラー: {e}")
        return None

# 使用例
activity = get_club_activity("1234567890123456789")
if activity:
    print(f"アクティブポイント: {activity['activity_point']}")
    print(f"ランキング: {activity['rank']}位")
```

---

## ⚠️ エラーハンドリング

### 推奨エラー処理

1. **404エラー（部活が見つからない）**
   - 部活が存在しない、または削除された
   - 前回の値を保持するか、デフォルト値（0）を使用

2. **401エラー（認証失敗）**
   - APIトークンが間違っている
   - 環境変数を確認

3. **500エラー（サーバーエラー）**
   - CROSSROID側のエラー
   - リトライ処理を実装することを推奨

4. **タイムアウト**
   - ネットワークエラー
   - リトライ処理を実装することを推奨

---

## 🔄 リトライ処理の推奨

```javascript
async function getClubActivityWithRetry(channelId, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const activity = await getClubActivity(channelId);
      if (activity) {
        return activity;
      }
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      // 指数バックオフ: 1秒、2秒、4秒...
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
  return null;
}
```

---

## 📝 実装チェックリスト

- [ ] APIエンドポイント `GET /api/club/activity/:channelId` を実装
- [ ] APIトークン認証を実装
- [ ] アクティブポイントの計算ロジックを実装
- [ ] ランキング順位の計算ロジックを実装
- [ ] エラーハンドリングを実装
- [ ] レスポンス形式を確認
- [ ] 更新頻度を決定（リアルタイム or 定期更新）
- [ ] テスト環境での動作確認

---

## 🔗 関連ドキュメント

- `CLUB_INVESTMENT_SYSTEM.md`: 部活投資システムの詳細仕様
- `CLUB_SYSTEM_IMPLEMENTATION.md`: 部活システムの実装仕様

---

## 📞 連絡先

実装時の質問や問題があれば、CROSSROID開発者に連絡してください。

