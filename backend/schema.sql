-- 假設你已經在 psql 裡，並且連線到 pet_db：
-- \c pet_db

-- 1. 使用者表：users ----------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id       SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    server_id     CHAR(1) NOT NULL DEFAULT 'A',  -- 'A' / 'B' / 'C'
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username   ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_server_id  ON users (server_id);


-- 2. 寵物表：pets -------------------------------------------
CREATE TABLE IF NOT EXISTS pets (
    pet_id     SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    pet_name   VARCHAR(100) NOT NULL,
    energy     INTEGER NOT NULL DEFAULT 100,
    status     VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    score      INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT ck_pets_energy_range CHECK (energy >= 0 AND energy <= 100)
);

CREATE INDEX IF NOT EXISTS idx_pets_user_id ON pets (user_id);
CREATE INDEX IF NOT EXISTS idx_pets_score   ON pets (score DESC);


-- 3. 運動紀錄表：exercise_logs ------------------------------
-- 每次 Raspberry Pi 上報運動結果，就記一筆，方便統計與報告使用
CREATE TABLE IF NOT EXISTS exercise_logs (
    log_id         SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    pet_id         INTEGER NOT NULL REFERENCES pets(pet_id) ON DELETE CASCADE,
    server_id      CHAR(1) NOT NULL,
    exercise_count INTEGER NOT NULL,
    source         VARCHAR(50) NOT NULL DEFAULT 'raspberry_pi',
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_id ON exercise_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_pet_id  ON exercise_logs (pet_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_server  ON exercise_logs (server_id);


-- 4. 對戰紀錄表：battles -----------------------------------
-- 一場對戰結束後，WebSocket組可以呼叫 /api/battle/result 寫入這裡
CREATE TABLE IF NOT EXISTS battles (
    battle_id      SERIAL PRIMARY KEY,
    player1_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    player2_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    player1_score  INTEGER NOT NULL,
    player2_score  INTEGER NOT NULL,
    winner_user_id INTEGER     REFERENCES users(user_id),
    server_id      CHAR(1) NOT NULL,
    battle_status  VARCHAR(16) NOT NULL DEFAULT 'FINISHED', -- PENDING / ONGOING / FINISHED
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_battles_server_id ON battles (server_id);
CREATE INDEX IF NOT EXISTS idx_battles_players   ON battles (player1_id, player2_id);
CREATE INDEX IF NOT EXISTS idx_battles_winner    ON battles (winner_user_id);


-- 5. 聊天訊息表：messages -----------------------------------
-- 如果 WebSocket 有聊天功能，可以把訊息寫到這裡
CREATE TABLE IF NOT EXISTS messages (
    message_id    SERIAL PRIMARY KEY,
    from_user_id  INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    to_user_id    INTEGER     REFERENCES users(user_id), -- NULL = 公開頻道
    server_id     CHAR(1) NOT NULL,
    content       TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_server     ON messages (server_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_user  ON messages (from_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_to_user    ON messages (to_user_id);
