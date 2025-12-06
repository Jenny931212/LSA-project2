import time

import cv2
import numpy as np
import requests

from config import BASE_URL, SERVER_ID, USER_ID, PET_ID

SERVER_PREFIX_MAP = {"A": "/serverA", "B": "/serverB", "C": "/serverC"}


def build_server_url(path: str) -> str:
    prefix = SERVER_PREFIX_MAP.get(SERVER_ID, "/serverA")
    return BASE_URL.rstrip("/") + prefix + path


SERVER_URL = build_server_url("/api/pet/update")


def send_update():
    payload = {
        "user_id": USER_ID,
        "pet_id": PET_ID,
        "server_id": SERVER_ID,
        "exercise_count": 1,
        "source": "raspberry_pi",
    }

    try:
        r = requests.post(SERVER_URL, json=payload, timeout=3)
        try:
            resp = r.json()
            print("[UPDATE]", "status_code =", r.status_code, "success =", resp.get("success"))
        except Exception:
            print("[UPDATE] status_code =", r.status_code, "raw_response =", r.text)
    except Exception as e:
        print("[ERROR] 無法連線到伺服器或解析回應：", e)


def detect_jump():
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("[ERROR] 無法開啟攝影機")
        return

    print("正在初始化攝影機 ...")
    time.sleep(1)

    ret, prev_frame = cap.read()
    if not ret:
        print("[ERROR] 無法讀取攝影機畫面")
        cap.release()
        return

    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)

    frame_h, frame_w = prev_gray.shape[:2]
    prev_center_y = None
    jump_cooldown = 0      # >0 表示剛偵測過一次跳躍，暫時不再觸發

    # 可以調的參數
    MOTION_THRESHOLD = 2_000_000   # 總動作量門檻
    JUMP_PIXEL_DELTA = frame_h * 0.12  # 中心點往上移動多少像素算「起跳」
    COOLDOWN_FRAMES = 20          # 一次跳躍後冷卻幾幀

    print("開始跳躍偵測！（視窗中按 Q 結束）")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARN] 讀取畫面失敗，略過這一幀")
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(prev_gray, gray)
        motion_level = np.sum(diff)

        # 做簡單二值化，只留下差異大的地方
        _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        jump_detected = False
        current_center_y = None

        if contours:
            # 找最大那塊輪廓，假設是人
            largest = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(largest)
            current_center_y = y + h / 2

            # 畫出偵測到的區域（方便測試）
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            cv2.line(frame, (0, int(current_center_y)), (frame_w, int(current_center_y)), (255, 0, 0), 1)

            if prev_center_y is not None and jump_cooldown == 0:
                # 往上移動量（前一幀中心 y - 目前中心 y）
                delta_y = prev_center_y - current_center_y

                if motion_level > MOTION_THRESHOLD and delta_y > JUMP_PIXEL_DELTA:
                    jump_detected = True
                    jump_cooldown = COOLDOWN_FRAMES

        # 更新 cooldown
        if jump_cooldown > 0:
            jump_cooldown -= 1

        # 真的判定為跳躍
        if jump_detected:
            print(f"⚡ 偵測到『跳躍』！motion_level={motion_level:.0f}")
            send_update()

        prev_gray = gray
        if current_center_y is not None:
            prev_center_y = current_center_y

        # 顯示畫面
        cv2.imshow("Jump Detector (press Q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    print("[INFO] 使用者 ID:", USER_ID, "寵物 ID:", PET_ID, "伺服器:", SERVER_ID)
    print("[INFO] 將上報到：", SERVER_URL)
    detect_jump()
