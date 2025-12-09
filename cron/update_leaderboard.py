# cron/update_leaderboard.py

import os
import sys

# 取得 backend 的根目錄（這支檔案在 backend/cron/ 底下，所以往上一層）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 確認 backend 在 sys.path 裡，讓 Python 找得到 app 這個 package
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

"""
每 10～30 分鐘執行一次：

- 依照 pets.score 幫每個 server_id 算出排行榜
- 寫入 leaderboard 資料表（覆蓋原本該 server 的資料）

對應分工表：
- 排行榜積分來源：
  - 勝利：+X（由 /api/battle/result 更新 Pet.score）
  - 失敗：+Y（同上）
  - 體力降至 0：-1（在 energy_decay.py 裡做）
- Cron 整合 DB 排行並寫回 leaderboard table
"""

from app.main import SessionLocal, User, Pet, Leaderboard


SERVER_IDS = ["A", "B", "C"]


def update_leaderboard_for_server(db, server_id: str):
    print(f"[CRON] 更新伺服器 {server_id} 的排行榜 ...")

    # 1. 找出該 server 的所有玩家 + score
    rows = (
        db.query(User.user_id, User.display_name, Pet.score)
        .join(Pet, Pet.user_id == User.user_id)
        .filter(User.server_id == server_id)
        .order_by(Pet.score.desc())
        .all()
    )

    # 2. 清空該 server 原本的 leaderboard
    db.query(Leaderboard).filter(Leaderboard.server_id == server_id).delete()

    # 3. 重新寫入排行資料
    for idx, row in enumerate(rows, start=1):
        lb = Leaderboard(
            user_id=row.user_id,
            server_id=server_id,
            score=row.score,
            rank=idx,
        )
        db.add(lb)
        print(
            f"[CRON] server={server_id} rank={idx} user_id={row.user_id} score={row.score}"
        )


def run_update_leaderboard():
    db = SessionLocal()
    try:
        for sid in SERVER_IDS:
            update_leaderboard_for_server(db, sid)
        db.commit()
        print("[CRON] 所有伺服器排行榜更新完成。")
    except Exception as exc:
        db.rollback()
        print("[CRON][ERROR] 更新排行榜失敗：", exc)
    finally:
        db.close()


if __name__ == "__main__":
    run_update_leaderboard()
