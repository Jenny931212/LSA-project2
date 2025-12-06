# config.py
"""
Raspberry Pi 動作偵測子系統設定檔

請依照實際環境修改以下參數：
- BASE_URL  ：後端主機的對外 HTTP 位址（含 port，若需要）
- USER_ID   ：此 Pi 所屬玩家的 user_id
- PET_ID    ：此玩家的 pet_id
"""

# 範例：
# 若後端 A 架在 http://140.113.1.23，且有 Nginx 做反向代理：
#   BASE_URL = "http://140.113.1.23"
# 若沒有 Nginx，直接用 uvicorn 跑在 8000：
#   BASE_URL = "http://140.113.1.23:8000"

BASE_URL = "http://YOUR_SERVER_HOST"   # TODO: 修改成實際伺服器位址

# 測試 / Demo 用：請改成實際存在於資料庫中的 user_id / pet_id
USER_ID = 1
PET_ID = 1


