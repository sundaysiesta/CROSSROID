# ヒサメbotへのロメコイン部活投資機能実装指示書

## 📋 概要

CROSSROIDの部活投資システムが正常に動作するため、ヒサメbotに以下のAPIを実装していただく必要があります。

部活投資システムでは、部活のアクティブポイントに基づいて株価が変動します。そのため、ヒサメbotからリアルタイムでアクティブポイントを取得できるAPIが必要です。

---

## 🔌 必須実装API

### 1. 部活アクティブポイント取得API

**エンドポイント**: `GET /api/club/activity/:channelId`

**リクエスト形式**:
```http
GET /api/club/activity/{channelId}
Headers:
  x-api-token: {API_TOKEN}
```

**パラメータ**:
- `channelId`: DiscordチャンネルID（部活チャンネルのID、文字列）

**成功時のレスポンス** (HTTP 200):
```json
{
  "channelId": "1234567890123456789",
  "activityPoint": 15000,
  "rank": 2,
  "lastUpdated": 1704067200000
}
```

**エラー時のレスポンス** (HTTP 404):
```json
{
  "error": "部活が見つかりません",
  "channelId": "1234567890123456789"
}
```

**レスポンスフィールド説明**:
- `channelId` (string, 必須): リクエストしたチャンネルID
- `activityPoint` (integer, 必須): 部活の現在のアクティブポイント（0以上の整数）
- `rank` (integer, 必須): 部活ランキング順位（1位が最高、1以上の整数）
- `lastUpdated` (integer, 必須): 最終更新日時（Unix timestamp、ミリ秒）

**HTTPステータスコード**:
- `200 OK`: 成功
- `404 Not Found`: 部活が見つからない
- `401 Unauthorized`: 認証失敗（APIトークンが無効）
- `500 Internal Server Error`: サーバーエラー

---

## 🔐 認証方法

### APIトークン認証

**ヘッダー名**: `x-api-token`

**設定**:
- CROSSROID側で環境変数 `API_TOKEN` を設定済み
- ヒサメbot側でも同じトークンを使用してAPIを呼び出す必要があります
- トークンはCROSSROID開発者から提供されます

**実装例**:
```javascript
const response = await fetch(`http://crossroid-api/api/club/activity/${channelId}`, {
  headers: {
    'x-api-token': process.env.API_TOKEN
  }
});
```

---

## 📊 アクティブポイントについて

### 現在のアクティブポイント分布（参考）

| 順位 | アクティブポイント | 用途 |
|:---|:---|:---|
| 1位 | 20,000 | 基準点の2倍相当 |
| 2位 | 13,000 | - |
| 3-4位 | 5,000以上 | - |
| 5-7位 | 1,000以上 | - |
| 8-13位 | 100以上 | - |
| 14位以降 | 100未満 | - |

**基準アクティブポイント**: 10,000ポイント（1位の50%）

**注意**: この分布は参考値です。実際の計算方法はヒサメbotの実装に依存しますが、**0以上の整数値**を返す必要があります。

---

## 🔄 更新頻度の推奨

### 推奨更新タイミング

1. **リアルタイム更新（最優先）**
   - 部活チャンネルでメッセージが送信された時
   - アクティブポイントが変動した時
   - 部活ランキングが更新された時

2. **定期更新（最低限）**
   - 1時間ごとに更新
   - または部活ランキング更新時に同時に更新

3. **更新タイミングの優先順位**
   - 最優先: 部活チャンネルでのメッセージ送信時
   - 高: 部活ランキング更新時（週1回など）
   - 中: 定期的なバッチ処理（1時間ごとなど）

### 更新の重要性

部活投資システムでは、アクティブポイントの変動に応じて株価が変動します。そのため、**できるだけ最新のアクティブポイントを提供することが重要**です。

- リアルタイム更新が理想ですが、技術的な制約がある場合は1時間ごとの更新でも動作します
- ただし、投資・売却時には必ず最新のアクティブポイントを使用する必要があります

---

## 💡 実装時の注意点

### 1. アクティブポイントの計算

- **0以上の整数値**を返す必要があります
- 負の値や小数は返さないでください
- 部活が存在しない場合は404エラーを返してください

### 2. ランキング順位の計算

- **1位が最高**です（1位 = 最もアクティブポイントが高い）
- 同じアクティブポイントの部活がある場合は、適切な順位付けを行ってください
- 1以上の整数値を返す必要があります

### 3. エラーハンドリング

- 部活が存在しない場合: `404 Not Found` を返す
- APIトークンが無効な場合: `401 Unauthorized` を返す
- サーバーエラーの場合: `500 Internal Server Error` を返す

### 4. パフォーマンス

- APIの応答時間はできるだけ短くしてください（推奨: 1秒以内）
- キャッシュを使用する場合は、適切なタイミングで更新してください

---

## 🎯 使用例

### JavaScript (Node.js) 実装例

```javascript
const axios = require('axios');

async function getClubActivity(channelId) {
  try {
    const response = await axios.get(
      `http://crossroid-api/api/club/activity/${channelId}`,
      {
        headers: {
          'x-api-token': process.env.API_TOKEN
        },
        timeout: 5000 // 5秒タイムアウト
      }
    );
    
    return {
      activityPoint: response.data.activityPoint,
      rank: response.data.rank,
      lastUpdated: response.data.lastUpdated
    };
  } catch (error) {
    if (error.response?.status === 404) {
      console.error('部活が見つかりません:', channelId);
    } else if (error.response?.status === 401) {
      console.error('認証に失敗しました');
    } else {
      console.error('API呼び出しエラー:', error.message);
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

### Python 実装例

```python
import requests
import os

def get_club_activity(channel_id):
    url = f"http://crossroid-api/api/club/activity/{channel_id}"
    headers = {
        "x-api-token": os.getenv("API_TOKEN")
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        response.raise_for_status()
        data = response.json()
        return {
            "activity_point": data["activityPoint"],
            "rank": data["rank"],
            "last_updated": data["lastUpdated"]
        }
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            print(f"部活が見つかりません: {channel_id}")
        elif e.response.status_code == 401:
            print("認証に失敗しました")
        else:
            print(f"API呼び出しエラー: {e}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"ネットワークエラー: {e}")
        return None

# 使用例
activity = get_club_activity("1234567890123456789")
if activity:
    print(f"アクティブポイント: {activity['activity_point']}")
    print(f"ランキング: {activity['rank']}位")
```

---

## 🔄 リトライ処理の推奨

CROSSROID側でリトライ処理を実装しますが、ヒサメbot側でも以下のようなエラーハンドリングを推奨します：

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

実装時に以下の項目を確認してください：

- [ ] APIエンドポイント `GET /api/club/activity/:channelId` を実装
- [ ] APIトークン認証（`x-api-token` ヘッダー）を実装
- [ ] アクティブポイントの計算ロジックを実装（0以上の整数）
- [ ] ランキング順位の計算ロジックを実装（1位が最高）
- [ ] エラーハンドリングを実装（404, 401, 500）
- [ ] レスポンス形式を確認（JSON形式、必須フィールドを含む）
- [ ] 更新頻度を決定（リアルタイム or 定期更新）
- [ ] タイムアウト設定（推奨: 5秒以内）
- [ ] テスト環境での動作確認
- [ ] 本番環境での動作確認

---

## 🎯 株価計算への影響

### 株価計算式

```
現在の株価 = (出資金 + 投資総額) × (現在のアクティブポイント / 基準アクティブポイント) / 発行済み株式数
```

**基準アクティブポイント**: 10,000ポイント

### アクティブポイントの変動による株価変動例

- **アクティブポイント = 20,000**（1位）: 株価 = 2.0倍
- **アクティブポイント = 10,000**（基準）: 株価 = 1.0倍
- **アクティブポイント = 5,000**（3-4位）: 株価 = 0.5倍
- **アクティブポイント = 1,000**（5-7位）: 株価 = 0.1倍
- **アクティブポイント = 100**（8-13位）: 株価 = 0.01倍

**重要**: アクティブポイントが正確でないと、株価計算が正しく行われません。そのため、**できるだけ最新のアクティブポイントを提供することが重要**です。

---

## ⚠️ 注意事項

### 1. データの整合性

- アクティブポイントとランキング順位は整合性が取れている必要があります
- 同じアクティブポイントの部活がある場合、適切な順位付けを行ってください

### 2. 更新のタイミング

- 投資・売却時には必ず最新のアクティブポイントを使用する必要があります
- 古いデータを使用すると、株価計算が正しく行われません

### 3. エラー時の処理

- 404エラー（部活が見つからない）の場合、CROSSROID側では前回の値を保持します
- ただし、初回アクセス時は0を使用します

### 4. パフォーマンス

- APIの応答時間が長いと、投資・売却処理が遅くなります
- できるだけ高速に応答できるように実装してください

---

## 🔗 関連ドキュメント

- `CLUB_INVESTMENT_SYSTEM.md`: 部活投資システムの詳細仕様
- `HISAME_BOT_API_SPEC.md`: API仕様書（詳細版）

---

## 📞 連絡先・質問

実装時の質問や問題があれば、CROSSROID開発者に連絡してください。

**重要**: このAPIは部活投資システムの核心部分です。実装が完了するまで、部活投資システムは正常に動作しません。優先的に実装をお願いします。

---

## 🚀 実装優先度

**最優先**: このAPIの実装は、部活投資システムの動作に必須です。できるだけ早く実装をお願いします。

**実装順序**:
1. APIエンドポイントの実装
2. 認証機能の実装
3. アクティブポイント取得ロジックの実装
4. ランキング順位計算ロジックの実装
5. エラーハンドリングの実装
6. テスト・動作確認

---

## 📋 まとめ

### 必須実装項目

1. **APIエンドポイント**: `GET /api/club/activity/:channelId`
2. **認証**: `x-api-token` ヘッダーによる認証
3. **レスポンス形式**: JSON形式、必須フィールドを含む
4. **更新頻度**: リアルタイム更新（理想）または1時間ごと（最低限）

### レスポンス必須フィールド

- `channelId`: チャンネルID（文字列）
- `activityPoint`: アクティブポイント（0以上の整数）
- `rank`: ランキング順位（1以上の整数、1位が最高）
- `lastUpdated`: 最終更新日時（Unix timestamp、ミリ秒）

### エラーハンドリング

- `404`: 部活が見つからない
- `401`: 認証失敗
- `500`: サーバーエラー

以上、よろしくお願いします。

