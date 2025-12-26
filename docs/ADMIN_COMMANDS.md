# 管理者コマンド詳細

## 📋 目次

1. [ロメコイン管理](#ロメコイン管理)
2. [データ復元](#データ復元)
3. [ランキング報酬](#ランキング報酬)
4. [レース管理](#レース管理)
5. [その他の管理者機能](#その他の管理者機能)

---

## ロメコイン管理

### `/admin_romecoin_add`
**説明**: 指定ユーザーのロメコインを増額します

**オプション**:
- `user` (必須): ロメコインを増額するユーザー
- `amount` (必須): 増額するロメコインの量

**権限**: 管理者ロール必須

**使用例**:
```
/admin_romecoin_add user:@ユーザー amount:10000
```

**注意**:
- 増額理由はログに記録されます
- ロメコイン変更ログチャンネルに送信されます

---

### `/admin_romecoin_deduct`
**説明**: 指定ユーザーのロメコインを減額します

**オプション**:
- `user` (必須): ロメコインを減額するユーザー
- `amount` (必須): 減額するロメコインの量

**権限**: 管理者ロール必須

**使用例**:
```
/admin_romecoin_deduct user:@ユーザー amount:5000
```

**注意**:
- 減額理由はログに記録されます
- ロメコイン変更ログチャンネルに送信されます
- 残高が不足している場合でも減額されます（マイナス残高になる可能性あり）

---

## データ復元

### `/admin_restore_file`
**説明**: データベースからJSONファイルを復元します

**オプション**:
- `file_name` (必須): 復元するファイル名
- `message_id` (任意): 特定のメッセージIDから復元（未指定時は最新のファイルを復元）

**権限**: 管理者ロール必須

**復元可能なファイル**:
- `romecoin_data.json`
- `bank_data.json`
- `daily_data.json`
- `duel_data.json`
- `janken_data.json`
- `shop_data.json`
- `mahjong_data.json`
- `loan_data.json`
- `activity_data.json`
- `club_investment_data.json`
- `parimutuel_data.json`
- `custom_cooldowns.json`

**使用例**:
```
/admin_restore_file file_name:romecoin_data.json
/admin_restore_file file_name:romecoin_data.json message_id:1234567890123456789
```

**処理フロー**:
1. データベースチャンネルから最新のファイルを検索（または指定されたメッセージIDから取得）
2. ファイルをダウンロード
3. ローカルファイルに保存
4. 復元完了メッセージを送信

**注意**:
- 復元すると現在のローカルデータが上書きされます
- 復元前にバックアップを取ることを推奨します

---

## ランキング報酬

### `/monthly_ranking_rewards`
**説明**: 月間ランキングの上位10人に賞金を一括付与します

**オプション**:
- `rank1` 〜 `rank10` (任意): 各順位のユーザー

**権限**: 管理者ロール必須

**使用例**:
```
/monthly_ranking_rewards rank1:@ユーザー1 rank2:@ユーザー2 rank3:@ユーザー3
```

**賞金額**:
- 1位: 15,000コイン
- 2位: 12,000コイン
- 3位: 10,000コイン
- 4位: 8,000コイン
- 5位: 6,000コイン
- 6位: 5,000コイン
- 7位: 4,000コイン
- 8位: 3,000コイン
- 9位: 2,500コイン
- 10位: 2,000コイン

**詳細**: [MONTHLY_RANKING_REWARDS.md](./MONTHLY_RANKING_REWARDS.md) を参照

---

### `/popularity_championship_rewards`
**説明**: 人気者選手権の上位10人に賞金を一括付与します

**オプション**:
- `rank1` 〜 `rank10` (任意): 各順位のユーザー

**権限**: 管理者ロール必須

**使用例**:
```
/popularity_championship_rewards rank1:@ユーザー1 rank2:@ユーザー2 rank3:@ユーザー3
```

**賞金額**:
- 1位: 50,000コイン
- 2位: 40,000コイン
- 3位: 30,000コイン
- 4位: 25,000コイン
- 5位: 20,000コイン
- 6-10位: 15,000コイン
- 参加賞: 3,000-5,000コイン

---

## レース管理

### `/race create`
**説明**: レースを作成します

**オプション**:
- `race_id` (必須): レースID（一意の識別子）
- `name` (必須): レース名
- `candidates` (必須): 候補者名（カンマ区切り）

**権限**: 管理者ロール必須

**使用例**:
```
/race create race_id:race_001 name:"第1回大会" candidates:"候補者A,候補者B,候補者C"
```

**制限**:
- レースIDは重複不可
- 候補者は2名以上20名まで
- 候補者名に重複は不可

**詳細**: [PARIMUTUEL_SYSTEM.md](./PARIMUTUEL_SYSTEM.md) を参照

---

### `/race close`
**説明**: レースの受付を締め切ります

**オプション**:
- `race_id` (必須): レースID

**権限**: 管理者ロール必須

**使用例**:
```
/race close race_id:race_001
```

**処理**:
- レースの受付を締め切る
- ステータスが`closed`に変更される
- これ以降、新しい賭けは受け付けられない

---

### `/race result`
**説明**: レースの結果を確定します

**オプション**:
- `race_id` (必須): レースID
- `result` (必須): 結果（カンマ区切り、順番通り、例: 1着,2着,3着）

**権限**: 管理者ロール必須

**使用例**:
```
/race result race_id:race_001 result:"候補者A,候補者B,候補者C"
```

**処理**:
1. 結果を確定
2. 各賭けタイプの配当を計算
3. 勝者に配当を支払う
4. ステータスが`finished`に変更される

**詳細**: [PARIMUTUEL_SYSTEM.md](./PARIMUTUEL_SYSTEM.md) を参照

---

## その他の管理者機能

### `/database_export`
**説明**: データベースをエクスポートします

**権限**: 管理者ロール必須

**処理**:
- すべてのデータファイルをエクスポート
- データベースチャンネルにアップロード

---

### `/data_migrate`
**説明**: Discord IDベースのデータをNotion名ベースに引き継ぎます

**オプション**:
- `user` (必須): 引き継ぎ対象のユーザー

**権限**: 管理者ロール必須

**使用例**:
```
/data_migrate user:@ユーザー
```

**処理**:
1. ユーザーのDiscord IDベースのデータを検索
2. Notion名を取得
3. Notion名ベースのデータに移行
4. 移行完了メッセージを送信

**詳細**: [DATA_MIGRATION_SPEC.md](./DATA_MIGRATION_SPEC.md) を参照

---

### `/test_generation`
**説明**: 世代獲得通知のテスト

**オプション**:
- `ユーザー` (必須): テスト対象のユーザー

**権限**: 管理者ロール必須

**使用例**:
```
/test_generation ユーザー:@ユーザー
```

---

### `/test_timereport`
**説明**: 時報機能のテスト

**オプション**:
- `時間` (必須): テストする時間（0-23）

**権限**: 管理者ロール必須

**使用例**:
```
/test_timereport 時間:12
```

---

### `匿名開示 (運営専用)` (コンテキストメニュー)
**説明**: 匿名メッセージの送信者を特定します

**使用方法**: 匿名メッセージを右クリック → 「匿名開示 (運営専用)」を選択

**権限**: 運営ロール必須

**処理**:
1. 匿名メッセージのIDを解析
2. 送信者を特定
3. 管理者に送信者情報を送信（エフェメラルメッセージ）

**詳細**: [ANONYMOUS_FEATURE.md](./ANONYMOUS_FEATURE.md) を参照

---

## 関連ドキュメント

- [COMMANDS_OVERVIEW.md](./COMMANDS_OVERVIEW.md) - コマンド一覧
- [ROMECOIN_SYSTEM.md](./ROMECOIN_SYSTEM.md) - ロメコインシステムの詳細
- [PARIMUTUEL_SYSTEM.md](./PARIMUTUEL_SYSTEM.md) - パリミュチュエル機能の詳細
- [DATA_MIGRATION_SPEC.md](./DATA_MIGRATION_SPEC.md) - データ移行仕様

