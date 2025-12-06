import requests

from config import BASE_URL, SERVER_ID, USER_ID, PET_ID

SERVER_PREFIX_MAP = {
    "A": "/serverA",
    "B": "/serverB",
    "C": "/serverC",
}


def build_server_url(path: str) -> str:
    prefix = SERVER_PREFIX_MAP.get(SERVER_ID, "/serverA")
    return BASE_URL.rstrip("/") + prefix + path


SERVER_URL = build_server_url("/api/pet/update")


def send_exercise_once():
    """
    單次上報運動事件：
    - 不依賴攝影機，用來測試 API 是否連得通
    """
    payload = {
        "user_id": USER_ID,
        "pet_id": PET_ID,
        "server_id": SERVER_ID,
        "exercise_count": 1,
        "source": "raspberry_pi",
    }

    try:
        r = requests.post(SERVER_URL, json=payload, timeout=3)
        print("[SENDER] status_code:", r.status_code)
        try:
            print("[SENDER] response JSON:", r.json())
        except Exception:
            print("[SENDER] raw response:", r.text)
    except Exception as e:
        print("[ERROR] 無法連線到伺服器：", e)


if __name__ == "__main__":
    print("[INFO] 將上報到：", SERVER_URL)
    send_exercise_once()
