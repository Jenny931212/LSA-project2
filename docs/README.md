# 統一格式（問 AI 之前可以先貼）
---

````markdown
# 🧩 專案統一規格說明（給 AI 看的前置說明，請嚴格遵守）

本專案名稱：**運動型虛擬寵物系統（Linux 期末專題，多伺服器版）**  
請你在產生任何程式碼 / API 設計 / WebSocket 設計時，**務必遵守以下統一規格**，避免命名不一致造成整合困難。

---

## 0. 基本設計概念（請 AI 先建立印象）

- 有「多伺服器」概念：Server A / Server B / Server C  
- 前端對外呼叫路徑：
  - API：`/serverA/api/...`、`/serverB/api/...`、`/serverC/api/...`
  - WebSocket：`/serverA/ws`、`/serverB/ws`、`/serverC/ws`
- 後端實際的 API 路徑（在 application 內）**一律寫成**：
  - `/api/login`、`/api/register`、`/api/pet/status`、`/api/pet/update`、`/api/leaderboard` 等
  - 也就是說：**多伺服器是由 Nginx 加前綴 `/serverA`，應用程式內部不需要知道這個前綴**
- 所有與伺服器相關的邏輯，請使用欄位或變數 `server_id`，值為 `"A"`、`"B"` 或 `"C"`。

---

## 1. 命名規則（非常重要，請 AI 一律遵守）

### 1.1 語言與命名風格

- 變數 / 函式 / 欄位名稱：**一律英文**，使用 **snake_case**（例如：`user_id`, `pet_name`, `energy_level`）
- 類別名稱：使用 **PascalCase**（例如：`User`, `Pet`, `BattleRoom`）
- 常數：**全大寫 + 底線**（例如：`ENERGY_MIN`, `ENERGY_MAX`, `STATE_SLEEPING`）
- 資料表名稱：**複數英文小寫**（例如：`users`, `pets`, `battles`, `messages`, `leaderboard`）
- JSON Key：**snake_case**（例如：`user_id`, `server_id`, `energy`, `status`）

### 1.2 通用欄位命名

請你在設計 DB 或 JSON 時，優先使用以下欄位名稱：

- 使用者相關：
  - `user_id`（整數或 UUID）
  - `username`（登入帳號）
  - `display_name`（顯示名稱，暱稱）
  - `password_hash`（密碼哈希）
  - `server_id`（"A" / "B" / "C"）

- 寵物相關：
  - `pet_id`
  - `pet_name`
  - `energy`（0–100）
  - `status`（"SLEEPING" / "TIRED" / "ACTIVE"）

- 對戰相關：
  - `battle_id`
  - `player1_id`
  - `player2_id`
  - `player1_score`
  - `player2_score`
  - `winner_user_id`
  - `battle_status`（"PENDING" / "ONGOING" / "FINISHED"）

- 聊天 / 訊息相關：
  - `message_id`
  - `from_user_id`
  - `to_user_id`
  - `content`
  - `created_at`

- 排行相關：
  - `score`
  - `rank`

- 時間欄位一律使用：
  - `created_at`
  - `updated_at`
  - 型別可用 ISO 字串或 timestamp，但命名不要亂換。

---

## 2. REST API 統一規格

### 2.1 API 基本路徑

- 應用程式內部的 API 路徑一律以 `/api` 開頭，例如：
  - `POST /api/register`
  - `POST /api/login`
  - `GET  /api/pet/status`
  - `POST /api/pet/update`
  - `GET  /api/leaderboard`
  - `POST /api/battle/invite`
  - `POST /api/battle/accept`
  - `GET  /api/battle/history`

- Nginx 會在外面加上 `/serverA`、`/serverB`、`/serverC`，  
  所以前端實際呼叫為：
  - `/serverA/api/login`
  - `/serverB/api/pet/status`
  - `/serverC/api/leaderboard`  
  **請 AI 在設計後端程式碼時，不要硬寫 `/serverA`，只寫 `/api/...`。**

### 2.2 統一回應格式

請所有 API 回傳以下格式（除非特別說明）：

```json
{
  "success": true,
  "data": { },
  "error": null
}
````

錯誤時：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "SOME_ERROR_CODE",
    "message": "人類可讀錯誤訊息"
  }
}
```

* `error.code` 統一使用 **全大寫 + 底線**，例如：

  * `"INVALID_CREDENTIALS"`
  * `"NOT_ENOUGH_ENERGY"`
  * `"BATTLE_NOT_FOUND"`

---

## 3. 主要 API 名稱與欄位（請 AI 依照這些命名）

### 3.1 登入 / 註冊

**POST `/api/register`**

```json
{
  "username": "test_user",
  "password": "plain_password",
  "display_name": "玩家暱稱"
}
```

**POST `/api/login`**

```json
{
  "username": "test_user",
  "password": "plain_password"
}
```

回應（示意）：

```json
{
  "success": true,
  "data": {
    "user_id": 1,
    "username": "test_user",
    "display_name": "玩家暱稱",
    "server_id": "A",
    "token": "jwt_or_session_token"
  },
  "error": null
}
```

---

### 3.2 寵物狀態

**GET `/api/pet/status`**

回應 JSON：

```json
{
  "success": true,
  "data": {
    "pet_id": 1,
    "pet_name": "MyDog",
    "energy": 75,
    "status": "ACTIVE", 
    "score": 10
  },
  "error": null
}
```

* `status` 僅允許三種：

  * `"SLEEPING"`（0–30）
  * `"TIRED"`（30–70）
  * `"ACTIVE"`（70–100）

---

### 3.3 寵物體力更新（Pi 運動恢復）

**POST `/api/pet/update`**

由 Raspberry Pi 呼叫：

```json
{
  "user_id": 1,
  "pet_id": 1,
  "server_id": "A",
  "exercise_count": 1
}
```

回應：

```json
{
  "success": true,
  "data": {
    "pet_id": 1,
    "energy": 100,
    "status": "ACTIVE"
  },
  "error": null
}
```

---

### 3.4 排行榜

**GET `/api/leaderboard`**

可接受參數（如有）：

* `limit`（預設 10）
* `server_id`（可選，預設顯示當前伺服器）

回應：

```json
{
  "success": true,
  "data": [
    {
      "user_id": 1,
      "display_name": "玩家A",
      "score": 30,
      "rank": 1
    },
    {
      "user_id": 2,
      "display_name": "玩家B",
      "score": 25,
      "rank": 2
    }
  ],
  "error": null
}
```

---

## 4. WebSocket 訊息格式（大廳 / 對戰 / 聊天）

### 4.1 通用封包格式

所有 WebSocket 訊息一律長這樣：

```json
{
  "type": "event_name",
  "server_id": "A",
  "user_id": 1,
  "payload": {
    "...": "..."
  }
}
```

* `type`：事件名稱（例如：`"join_lobby"`, `"chat_message"`, `"battle_update"`）
* `server_id`：`"A" / "B" / "C"`
* `payload`：不同事件自己的資料

### 4.2 常用事件名稱（請 AI 優先使用這些）

* 大廳相關：

  * `join_lobby`
  * `lobby_state`
  * `player_joined`
  * `player_left`
* 聊天相關：

  * `chat_message`
  * `chat_history`
* 對戰相關：

  * `battle_invite`
  * `battle_accept`
  * `battle_start`
  * `battle_update`
  * `battle_result`

**請 AI 不要自己亂發明別的 event name，如果需要新事件，至少保持 snake_case 並附上 `type` 字串。**

---

## 5. Raspberry Pi 上報格式（給 AI 的固定規格）

Raspberry Pi 呼叫 API 或 socket 上報運動結果時，一律使用：

```json
{
  "user_id": 1,
  "pet_id": 1,
  "server_id": "A",
  "exercise_count": 1,
  "source": "raspberry_pi"
}
```

* `exercise_count`：這次偵測到的運動次數（例如一次跳躍就算 1）
* `source`：固定字串 `"raspberry_pi"`，方便後端 log

---

## 6. 體力與狀態規則（不要改）

* 體力範圍：0–100（整數）
* 自然下降：每 20 分鐘 -5 點（由 Cron Job 負責）
* 狀態分段：

  * 0–30：`"SLEEPING"`
  * 30–70：`"TIRED"`
  * 70–100：`"ACTIVE"`
* 體力 = 0：自動 `score -= 1`

---

## 7. AI 回覆要求（統一要求）

當我在此專案下詢問任何問題時，請你：

1. **遵守以上命名與格式，不要自創風格**
2. API 路徑一律使用 `/api/...`（不要手動加 `/serverA`）
3. JSON 欄位一律使用 snake_case，並盡量使用上面列出的欄位名稱
4. 若有新增欄位 / event type，請：

   * 使用英文
   * 使用 snake_case
   * 同時簡短說明用途

---

# （下面這一段，才是我這次真正的問題）

````

> ✅ 用法示範：  
> 你們之後每個人問 AI 時，可以這樣開頭：

```markdown
# 🧩 專案統一規格（請先閱讀並遵守）

[貼上上面那整坨規格]

---

# 我這次要做的事情：

我是組員 B，要實作 WebSocket Server A 的基礎架構，請幫我用 Python 寫一個簡單版的 ws server：
- 支援事件 type：join_lobby、chat_message
- 使用上面定義的 JSON 格式
- 幫我示範玩家加入大廳與發送聊天訊息的流程
````


