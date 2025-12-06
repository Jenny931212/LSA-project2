# app/main.py

"""
運動型虛擬寵物系統 - 後端 A 組 (FastAPI + PostgreSQL 完整版)

負責範圍：
- REST API
- PostgreSQL 資料庫存取 (SQLAlchemy ORM)
- 不包含 WebSocket / 前端 / Pi 端程式（那些是別的檔案）

提供的主要 API：
- GET  /api/health              健康檢查
- POST /api/register            註冊
- POST /api/login               登入
- GET  /api/pet/status          查寵物狀態
- POST /api/pet/update          Pi 回報運動量，更新體力 + 紀錄 exercise_logs
- GET  /api/leaderboard         排行榜
- POST /api/battle/result       寫入對戰結果（給 WebSocket 組呼叫）
- GET  /api/battle/history      查某玩家的對戰紀錄
- GET  /api/chat/history        查聊天歷史（未來 WebSocket 可用）

注意：
- 多伺服器概念用欄位 server_id 表示： "A" / "B" / "C"
- 外部 nginx 會加 /serverA /serverB /serverC 前綴，這裡不需要處理
"""

from datetime import datetime
from typing import Any, List, Optional

from fastapi import Depends, FastAPI
from pydantic import BaseModel
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    func,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, relationship, sessionmaker
import hashlib


# ============================================================
# 資料庫連線設定
# ============================================================

# ⚠ 請務必改成你自己的 PostgreSQL 帳號、密碼、資料庫名稱
# 範例：postgresql+psycopg2://帳號:密碼@host:port/資料庫
DATABASE_URL = "postgresql+psycopg2://postgres:password@localhost:5432/pet_db"

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """
    FastAPI 相依注入：在每次 request 拿一個 DB session，用完關閉。
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ============================================================
# ORM 資料表模型 (對應上面的 SQL 建表)
# ============================================================

class User(Base):
    """
    users 資料表：
    - 使用者帳號、暱稱、密碼、server_id
    """
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    server_id = Column(String(1), nullable=False, default="A")  # "A" / "B" / "C"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    pet = relationship("Pet", back_populates="owner", uselist=False)


class Pet(Base):
    """
    pets 資料表：
    - 每個 user 一隻寵物
    - energy: 0~100
    - status: "SLEEPING" / "TIRED" / "ACTIVE"
    - score: 用來做排行榜
    """
    __tablename__ = "pets"

    pet_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    pet_name = Column(String(100), nullable=False)
    energy = Column(Integer, nullable=False, default=100)
    status = Column(String(16), nullable=False, default="ACTIVE")
    score = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", back_populates="pet")

    __table_args__ = (
        CheckConstraint("energy >= 0 AND energy <= 100", name="ck_pets_energy_range"),
    )


class ExerciseLog(Base):
    """
    exercise_logs 資料表：
    - 每次 Pi 上報運動結果紀錄一筆
    """
    __tablename__ = "exercise_logs"

    log_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    pet_id = Column(Integer, ForeignKey("pets.pet_id", ondelete="CASCADE"), nullable=False)
    server_id = Column(String(1), nullable=False)
    exercise_count = Column(Integer, nullable=False)
    source = Column(String(50), nullable=False, default="raspberry_pi")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Battle(Base):
    """
    battles 資料表：
    - 對戰紀錄
    """
    __tablename__ = "battles"

    battle_id = Column(Integer, primary_key=True, index=True)
    player1_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    player2_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    player1_score = Column(Integer, nullable=False)
    player2_score = Column(Integer, nullable=False)
    winner_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    server_id = Column(String(1), nullable=False)
    battle_status = Column(String(16), nullable=False, default="FINISHED")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    """
    messages 資料表：
    - 聊天訊息紀錄
    """
    __tablename__ = "messages"

    message_id = Column(Integer, primary_key=True, index=True)
    from_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    to_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True)  # NULL = 廣播
    server_id = Column(String(1), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ============================================================
# 工具函式：密碼雜湊 / energy -> status
# ============================================================

def hash_password(plain_password: str) -> str:
    """非常簡單的 sha256 雜湊（課程用，非真正安全實務）。"""
    return hashlib.sha256(plain_password.encode("utf-8")).hexdigest()


def verify_password(plain_password: str, password_hash: str) -> bool:
    return hash_password(plain_password) == password_hash


def energy_to_status(energy: int) -> str:
    """
    體力對應狀態：
    0–30: "SLEEPING"
    30–70: "TIRED"
    70–100: "ACTIVE"
    """
    if energy <= 30:
        return "SLEEPING"
    elif energy <= 70:
        return "TIRED"
    else:
        return "ACTIVE"


# ============================================================
# Pydantic 模型：API request / response
# ============================================================

class ErrorInfo(BaseModel):
    code: str
    message: str


class APIResponse(BaseModel):
    success: bool
    data: Optional[Any] = None
    error: Optional[ErrorInfo] = None


class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str
    # 若之後要由前端選伺服器，可以加 server_id


class LoginRequest(BaseModel):
    username: str
    password: str


class UserLoginResponse(BaseModel):
    user_id: int
    username: str
    display_name: str
    server_id: str
    token: str  # 簡單字串，未實作真正 JWT


class PetStatus(BaseModel):
    pet_id: int
    pet_name: str
    energy: int
    status: str
    score: int


class PetUpdateRequest(BaseModel):
    user_id: int
    pet_id: int
    server_id: str
    exercise_count: int
    source: Optional[str] = "raspberry_pi"


class LeaderboardItem(BaseModel):
    user_id: int
    display_name: str
    score: int
    rank: int


class BattleResultRequest(BaseModel):
    """
    一場對戰結束後，WebSocket 組可以用這個 API 回報結果。
    """
    player1_id: int
    player2_id: int
    player1_score: int
    player2_score: int
    server_id: str  # "A" / "B" / "C"


class BattleHistoryItem(BaseModel):
    battle_id: int
    player1_id: int
    player2_id: int
    player1_score: int
    player2_score: int
    winner_user_id: Optional[int]
    server_id: str
    battle_status: str
    created_at: datetime


class ChatMessageItem(BaseModel):
    message_id: int
    from_user_id: int
    to_user_id: Optional[int]
    server_id: str
    content: str
    created_at: datetime


# ============================================================
# 建立 FastAPI app
# ============================================================

app = FastAPI(title="Sport Pet Backend", version="1.0.0")


# ============================================================
# API: 健康檢查
# ============================================================

@app.get("/api/health", response_model=APIResponse)
def health_check():
    """
    整個服務的健康檢查：
    - 可以給前端 / Nginx / systemd 用來確認後端有沒有活著
    """
    return APIResponse(
        success=True,
        data={
            "status": "ok",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
        error=None,
    )


# ============================================================
# API: 註冊
# ============================================================

@app.post("/api/register", response_model=APIResponse)
def register(request: RegisterRequest, db: Session = Depends(get_db)):
    """
    註冊：
    - 檢查 username 是否重覆
    - 建立 user + 預設一隻 pet
    - 預設 server_id = "A"（之後可以改掉）
    """
    existing = db.query(User).filter(User.username == request.username).first()
    if existing:
        return APIResponse(
            success=False,
            data=None,
            error=ErrorInfo(
                code="USERNAME_TAKEN",
                message="Username already exists.",
            ),
        )

    server_id = "A"

    new_user = User(
        username=request.username,
        display_name=request.display_name,
        password_hash=hash_password(request.password),
        server_id=server_id,
    )
    db.add(new_user)
    db.flush()  # 拿到 user_id

    new_pet = Pet(
        user_id=new_user.user_id,
        pet_name=f"{request.display_name}'s Pet",
        energy=100,
        status="ACTIVE",
        score=0,
    )
    db.add(new_pet)

    db.commit()
    db.refresh(new_user)

    token = f"token-{new_user.user_id}-{int(datetime.utcnow().timestamp())}"

    user_data = UserLoginResponse(
        user_id=new_user.user_id,
        username=new_user.username,
        display_name=new_user.display_name,
        server_id=new_user.server_id,
        token=token,
    )

    return APIResponse(success=True, data=user_data, error=None)


# ============================================================
# API: 登入
# ============================================================

@app.post("/api/login", response_model=APIResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    """
    登入：
    - 以 username 找 user
    - 驗證密碼
    - 回傳 user 資料 + 假 token
    """
    user = db.query(User).filter(User.username == request.username).first()
    if not user or not verify_password(request.password, user.password_hash):
        return APIResponse(
            success=False,
            data=None,
            error=ErrorInfo(
                code="INVALID_CREDENTIALS",
                message="Username or password is incorrect.",
            ),
        )

    token = f"token-{user.user_id}-{int(datetime.utcnow().timestamp())}"

    user_data = UserLoginResponse(
        user_id=user.user_id,
        username=user.username,
        display_name=user.display_name,
        server_id=user.server_id,
        token=token,
    )
    return APIResponse(success=True, data=user_data, error=None)


# ============================================================
# API: 取得寵物狀態
# ============================================================

@app.get("/api/pet/status", response_model=APIResponse)
def get_pet_status(user_id: int, db: Session = Depends(get_db)):
    """
    取得寵物狀態：
    - 目前用 query string 帶 user_id（之後可改用 token）
    - 回傳 pet_id, pet_name, energy, status, score
    """
    pet = (
        db.query(Pet)
        .join(User, Pet.user_id == User.user_id)
        .filter(User.user_id == user_id)
        .first()
    )
    if not pet:
        return APIResponse(
            success=False,
            data=None,
            error=ErrorInfo(
                code="PET_NOT_FOUND",
                message="Pet not found for this user.",
            ),
        )

    # 確保 status 與 energy 同步
    pet.status = energy_to_status(pet.energy)
    db.commit()
    db.refresh(pet)

    pet_status = PetStatus(
        pet_id=pet.pet_id,
        pet_name=pet.pet_name,
        energy=pet.energy,
        status=pet.status,
        score=pet.score,
    )
    return APIResponse(success=True, data=pet_status, error=None)


# ============================================================
# API: 更新寵物體力（Pi 回報）
# ============================================================

@app.post("/api/pet/update", response_model=APIResponse)
def update_pet_energy(request: PetUpdateRequest, db: Session = Depends(get_db)):
    """
    Raspberry Pi 回報運動結果：
    - 檢查 user / pet / server_id 是否正確
    - 更新 energy + score
    - 同時寫一筆 exercise_logs 紀錄
    """
    user = db.query(User).filter(
        User.user_id == request.user_id,
        User.server_id == request.server_id,
    ).first()
    if not user:
        return APIResponse(
            success=False,
            data=None,
            error=ErrorInfo(
                code="USER_NOT_FOUND",
                message="User not found for given user_id and server_id.",
            ),
        )

    pet = db.query(Pet).filter(
        Pet.pet_id == request.pet_id,
        Pet.user_id == user.user_id,
    ).first()
    if not pet:
        return APIResponse(
            success=False,
            data=None,
            error=ErrorInfo(
                code="PET_NOT_FOUND",
                message="Pet not found for given pet_id and user_id.",
            ),
        )

    # 設定規則：每次 exercise_count +1 -> energy + 10, score + exercise_count
    energy_gain = request.exercise_count * 10
    new_energy = pet.energy + energy_gain
    if new_energy > 100:
        new_energy = 100

    pet.energy = new_energy
    pet.status = energy_to_status(pet.energy)
    pet.score += request.exercise_count

    # 寫入運動紀錄
    log = ExerciseLog(
        user_id=user.user_id,
        pet_id=pet.pet_id,
        server_id=user.server_id,
        exercise_count=request.exercise_count,
        source=request.source or "raspberry_pi",
    )
    db.add(log)

    db.commit()
    db.refresh(pet)

    updated_data = {
        "pet_id": pet.pet_id,
        "energy": pet.energy,
        "status": pet.status,
    }
    return APIResponse(success=True, data=updated_data, error=None)


# ============================================================
# API: 排行榜
# ============================================================

@app.get("/api/leaderboard", response_model=APIResponse)
def get_leaderboard(
    limit: int = 10,
    server_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    排行榜：
    - 根據 pets.score 由高到低排序
    - 若指定 server_id，只顯示該伺服器
    """
    query = (
        db.query(User.user_id, User.display_name, User.server_id, Pet.score)
        .join(Pet, Pet.user_id == User.user_id)
        .order_by(Pet.score.desc())
    )
    if server_id:
        query = query.filter(User.server_id == server_id)

    rows = query.limit(limit).all()

    leaderboard: List[LeaderboardItem] = []
    for idx, row in enumerate(rows, start=1):
        leaderboard.append(
            LeaderboardItem(
                user_id=row.user_id,
                display_name=row.display_name,
                score=row.score,
                rank=idx,
            )
        )

    return APIResponse(success=True, data=leaderboard, error=None)


# ============================================================
# API: 對戰結果上報
# ============================================================

@app.post("/api/battle/result", response_model=APIResponse)
def report_battle_result(request: BattleResultRequest, db: Session = Depends(get_db)):
    """
    一場對戰結束後，WebSocket 組可呼叫：
    - 會寫一筆 battles 紀錄
    - winner_user_id 自動判斷
    - 也可以在這裡順便加成績邏輯（例如勝者加 score）
    """
    # 找兩位玩家確認存在
    p1 = db.query(User).filter(
        User.user_id == request.player1_id,
        User.server_id == request.server_id,
    ).first()
    p2 = db.query(User).filter(
        User.user_id == request.player2_id,
        User.server_id == request.server_id,
    ).first()

    if not p1 or not p2:
        return APIResponse(
            success=False,
            data=None,
            error=ErrorInfo(
                code="PLAYER_NOT_FOUND",
                message="Player1 or Player2 not found for given server_id.",
            ),
        )

    # 判斷勝負
    winner_user_id: Optional[int] = None
    if request.player1_score > request.player2_score:
        winner_user_id = request.player1_id
    elif request.player2_score > request.player1_score:
        winner_user_id = request.player2_id
    else:
        winner_user_id = None  # 平手

    battle = Battle(
        player1_id=request.player1_id,
        player2_id=request.player2_id,
        player1_score=request.player1_score,
        player2_score=request.player2_score,
        winner_user_id=winner_user_id,
        server_id=request.server_id,
        battle_status="FINISHED",
    )
    db.add(battle)

    # 加分規則（可依需求調整）：勝者多加 score
    if winner_user_id is not None:
        winner_pet = (
            db.query(Pet)
            .join(User, Pet.user_id == User.user_id)
            .filter(User.user_id == winner_user_id)
            .first()
        )
        if winner_pet:
            winner_pet.score += 5

    db.commit()
    db.refresh(battle)

    data = {
        "battle_id": battle.battle_id,
        "winner_user_id": winner_user_id,
    }
    return APIResponse(success=True, data=data, error=None)


# ============================================================
# API: 對戰歷史查詢
# ============================================================

@app.get("/api/battle/history", response_model=APIResponse)
def get_battle_history(
    user_id: int,
    server_id: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """
    查某位玩家的對戰歷史：
    - 會找出他當 player1 或 player2 的戰鬥
    - 可選 server_id
    """
    query = db.query(Battle).filter(
        (Battle.player1_id == user_id) | (Battle.player2_id == user_id)
    )
    if server_id:
        query = query.filter(Battle.server_id == server_id)

    battles = query.order_by(Battle.created_at.desc()).limit(limit).all()

    items: List[BattleHistoryItem] = []
    for b in battles:
        items.append(
            BattleHistoryItem(
                battle_id=b.battle_id,
                player1_id=b.player1_id,
                player2_id=b.player2_id,
                player1_score=b.player1_score,
                player2_score=b.player2_score,
                winner_user_id=b.winner_user_id,
                server_id=b.server_id,
                battle_status=b.battle_status,
                created_at=b.created_at,
            )
        )

    return APIResponse(success=True, data=items, error=None)


# ============================================================
# API: 聊天歷史查詢（可當管理/debug 用）
# ============================================================

@app.get("/api/chat/history", response_model=APIResponse)
def get_chat_history(
    server_id: str,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """
    聊天歷史：
    - 目前只支援依 server_id 查最新的幾筆訊息
    - 未實作寫入，預期由 WebSocket 邏輯在訊息送出時 insert messages
    """
    msgs = (
        db.query(Message)
        .filter(Message.server_id == server_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )

    items: List[ChatMessageItem] = []
    for m in msgs:
        items.append(
            ChatMessageItem(
                message_id=m.message_id,
                from_user_id=m.from_user_id,
                to_user_id=m.to_user_id,
                server_id=m.server_id,
                content=m.content,
                created_at=m.created_at,
            )
        )

    return APIResponse(success=True, data=items, error=None)


# ============================================================
# （備註）啟動方式：
# ------------------------------------------------------------
# 1. 確認已安裝套件：
#    pip install fastapi "uvicorn[standard]" sqlalchemy psycopg2-binary
#
# 2. 在專案根目錄啟動：
#    uvicorn app.main:app --reload
#
# 3. 用瀏覽器開：
#    http://127.0.0.1:8000/docs   查看所有 API 與試玩
# ============================================================
