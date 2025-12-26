# データ構造詳細

## 📋 目次

1. [データファイル一覧](#データファイル一覧)
2. [ロメコインデータ](#ロメコインデータ)
3. [銀行データ](#銀行データ)
4. [借金データ](#借金データ)
5. [ショップデータ](#ショップデータ)
6. [ゲームデータ](#ゲームデータ)
7. [パリミュチュエルデータ](#パリミュチュエルデータ)
8. [部活投資データ](#部活投資データ)
9. [その他のデータ](#その他のデータ)

---

## データファイル一覧

### 主要データファイル
- `romecoin_data.json` - ロメコイン残高
- `bank_data.json` - 銀行預金データ
- `loan_data.json` - 借金データ
- `shop_data.json` - ショップ購入履歴
- `daily_data.json` - デイリーログインボーナスデータ
- `duel_data.json` - 決闘データ
- `janken_data.json` - じゃんけんデータ
- `mahjong_data.json` - 麻雀データ
- `parimutuel_data.json` - パリミュチュエルデータ
- `club_investment_data.json` - 部活投資データ
- `activity_data.json` - アクティビティデータ
- `custom_cooldowns.json` - カスタムクールダウンデータ

### バックアップファイル
- `romecoin_data.json.backup` - ロメコインデータのバックアップ

---

## ロメコインデータ

### ファイル名
`romecoin_data.json`

### データ構造
```json
{
  "userId": 残高（数値）,
  "notionName": 残高（数値）
}
```

### 例
```json
{
  "123456789012345678": 10000,
  "ユーザー名": 5000
}
```

### Notion連携
- Discord IDとNotion名の両方で管理可能
- データ移行時は`/data_migrate`コマンドを使用

### バックアップ
- 保存時に`romecoin_data.json.backup`を作成
- メインファイルが空または存在しない場合、バックアップから自動復元

---

## 銀行データ

### ファイル名
`bank_data.json`

### データ構造
```json
{
  "userId": {
    "deposit": 預金額（数値）,
    "lastInterestTime": 最後に利子計算した時刻（タイムスタンプ）
  }
}
```

### 例
```json
{
  "123456789012345678": {
    "deposit": 5000,
    "lastInterestTime": 1704067200000
  }
}
```

### Notion連携
- Discord IDとNotion名の両方で管理可能

---

## 借金データ

### ファイル名
`loan_data.json`

### データ構造
```json
{
  "lenderId_borrowerId": {
    "lenderId": "貸し手のID",
    "borrowerId": "借り手のID",
    "amount": 借金額（数値）,
    "interest": 利子（数値）,
    "createdAt": 作成時刻（タイムスタンプ）,
    "dueDate": 返済期限（タイムスタンプ）
  }
}
```

### 例
```json
{
  "123456789012345678_987654321098765432": {
    "lenderId": "123456789012345678",
    "borrowerId": "987654321098765432",
    "amount": 10000,
    "interest": 1500,
    "createdAt": 1704067200000,
    "dueDate": 1704672000000
  }
}
```

### Notion連携
- Discord IDとNotion名の両方で管理可能
- キーは`lenderId_borrowerId`形式

---

## ショップデータ

### ファイル名
`shop_data.json`

### 場所
`data/shop_data.json`

### データ構造
```json
{
  "userId": {
    "log_viewer_role": {
      "purchasedAt": 購入日時（タイムスタンプ）
    },
    "emoji_creator_role": {
      "purchasedAt": 購入日時（タイムスタンプ）
    }
  }
}
```

### 例
```json
{
  "123456789012345678": {
    "log_viewer_role": {
      "purchasedAt": 1704067200000
    },
    "emoji_creator_role": {
      "purchasedAt": 1704153600000
    }
  }
}
```

---

## ゲームデータ

### 決闘データ
**ファイル名**: `duel_data.json`

**データ構造**:
```json
{
  "userId": {
    "wins": 勝利数（数値）,
    "losses": 敗北数（数値）,
    "totalWinnings": 獲得ロメコイン（数値）
  }
}
```

### じゃんけんデータ
**ファイル名**: `janken_data.json`

**データ構造**:
```json
{
  "userId": {
    "wins": 勝利数（数値）,
    "losses": 敗北数（数値）,
    "draws": あいこ数（数値）,
    "totalWinnings": 獲得ロメコイン（数値）
  }
}
```

### 麻雀データ
**ファイル名**: `mahjong_data.json`

**データ構造**:
```json
{
  "stats": {
    "userId": {
      "totalWinnings": 獲得ロメコイン（数値）,
      "totalLosses": 損失ロメコイン（数値）,
      "gamesPlayed": 総試合数（数値）,
      "gamesWon": 勝利数（数値）
    }
  },
  "tableId": {
    "host": "部屋主のID",
    "players": ["プレイヤー1のID", "プレイヤー2のID", "..."],
    "rate": レート（数値）,
    "gameType": "sanma|yonma",
    "scores": [点数1, 点数2, "..."],
    "romecoinChanges": [ロメコイン変更1, ロメコイン変更2, "..."],
    "completedAt": 完了時刻（タイムスタンプ）
  }
}
```

---

## パリミュチュエルデータ

### ファイル名
`parimutuel_data.json`

### データ構造
```json
{
  "races": {
    "race_id": {
      "id": "race_id",
      "name": "レース名",
      "candidates": ["候補者1", "候補者2", "..."],
      "creatorId": "作成者ID",
      "status": "open|closed|finished",
      "createdAt": 作成時刻（タイムスタンプ）,
      "finishedAt": 終了時刻（タイムスタンプ）,
      "result": ["1着", "2着", "3着"]
    }
  },
  "bets": {
    "raceId": {
      "betType_selection1_selection2_selection3": {
        "betType": "tansho|fukusho|wide|sanrenpuku|sanrentan",
        "selections": ["選択1", "選択2", "選択3"],
        "totalAmount": 総賭け金（数値）,
        "bets": [
          {
            "betId": "bet_id",
            "userId": "ユーザーID",
            "amount": 賭け金（数値）,
            "placedAt": 賭け時刻（タイムスタンプ）
          }
        ]
      }
    }
  }
}
```

---

## 部活投資データ

### ファイル名
`club_investment_data.json`

### データ構造
```json
{
  "channelId": {
    "initialCapital": 初期資本（数値）,
    "totalInvestment": 総投資額（数値）,
    "totalShares": 総株式数（数値）,
    "baseActivityPoint": 基準アクティビティポイント（数値）,
    "investors": {
      "userId": {
        "shares": 保有株式数（数値）,
        "totalInvested": 総投資額（数値）
      }
    },
    "createdAt": 作成時刻（タイムスタンプ）,
    "lastUpdated": 最終更新時刻（タイムスタンプ）
  }
}
```

---

## その他のデータ

### デイリーログインボーナスデータ
**ファイル名**: `daily_data.json`

**データ構造**:
```json
{
  "userId": {
    "lastClaimed": 最後に受け取った日時（タイムスタンプ）,
    "streak": 連続日数（数値）
  }
}
```

### アクティビティデータ
**ファイル名**: `activity_data.json`

**データ構造**:
```json
{
  "userId": {
    "messageCount": メッセージ数（数値）,
    "lastActive": 最終アクティブ時刻（タイムスタンプ）
  }
}
```

### カスタムクールダウンデータ
**ファイル名**: `custom_cooldowns.json`

**データ構造**:
```json
{
  "commandName_userId": {
    "lastUsed": 最後に使用した時刻（タイムスタンプ）
  }
}
```

---

## データ永続化

### 自動保存
- データ変更時に自動保存
- 1分ごとに`persistence.js`がデータベースチャンネルにアップロード

### バックアップ
- `romecoin_data.json.backup`が自動生成
- メインファイルが空または存在しない場合、バックアップから自動復元

### データベースチャンネル
- 1分ごとにすべてのデータファイルをデータベースチャンネルにアップロード
- Discordの10ファイル制限を考慮して、複数のメッセージに分割

### 復元
- `/admin_restore_file`コマンドで手動復元可能
- データベースチャンネルから最新のファイルを取得

---

## 関連ドキュメント

- [COMMANDS_OVERVIEW.md](./COMMANDS_OVERVIEW.md) - コマンド一覧
- [ROMECOIN_SYSTEM.md](./ROMECOIN_SYSTEM.md) - ロメコインシステムの詳細
- [DATA_MIGRATION_SPEC.md](./DATA_MIGRATION_SPEC.md) - データ移行仕様

