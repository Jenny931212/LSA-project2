# cron/energy_decay.py

import os
import sys

# 取得 backend 的根目錄（這支檔案在 backend/cron/ 底下，所以往上一層）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 確認 backend 在 sys.path 裡，讓 Python 找得到 app 這個 package
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)


"""
每 20 分鐘執行一次：
- 所有寵物 energy -= 5（不能 < 0）
- 若這次「剛好變成 0」（原本 > 0，現在 = 0）→ score -= 1
- 更新 status = SLEEPING / TIRED / ACTIVE

請放在 backend 專案的 cron/ 資料夾底下：
backend/
  app/
    main.py
  cron/
    energy_decay.py
"""

from app.main import SessionLocal, Pet, energy_to_status


def run_energy_decay():
    db = SessionLocal()
    try:
        pets = db.query(Pet).all()
        print(f"[CRON] 找到 {len(pets)} 隻寵物，開始更新體力 ...")

        for pet in pets:
            old_energy = pet.energy
            new_energy = max(0, old_energy - 5)

            if new_energy != old_energy:
                pet.energy = new_energy
                pet.status = energy_to_status(new_energy)

                # 🔻 從 >0 掉到 0 → score -1
                if old_energy > 0 and new_energy == 0:
                    pet.score -= 1
                    print(
                        f"[CRON] pet_id={pet.pet_id} {old_energy}->{new_energy}, score-1 => {pet.score}"
                    )
                else:
                    print(
                        f"[CRON] pet_id={pet.pet_id} {old_energy}->{new_energy}, score={pet.score}"
                    )

        db.commit()
        print("[CRON] 體力更新完成，已寫入資料庫。")

    except Exception as exc:
        db.rollback()
        print("[CRON][ERROR] 體力更新失敗：", exc)
    finally:
        db.close()


if __name__ == "__main__":
    run_energy_decay()
