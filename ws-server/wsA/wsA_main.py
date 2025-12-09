# ws-server/wsA/main.py

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Tuple, List, Set
from dataclasses import dataclass, field
import time
import json
import random

WORLD_WIDTH = 200
WORLD_HEIGHT = 200


# ---------------------------------------------------------
# Log 函式
# ---------------------------------------------------------
def log(prefix: str, message: str) -> None:
    print(f"[wsA][{prefix}] {message}")


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UserKey = Tuple[str, int]


@dataclass
class BattleRoom:
    battle_id: str
    server_id: str
    player1_id: int
    player2_id: int
    scores: Dict[int, int] = field(default_factory=dict)
    state: str = "waiting"
    ready: Dict[int, bool] = field(default_factory=dict)
    # ⭐ 新增：儲存每位玩家「遊戲結束時」送來的最終分數
    results: Dict[int, int] = field(default_factory=dict)


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Dict[UserKey, WebSocket] = {}
        self.lobby_users: Dict[str, Set[int]] = {}
        self.lobby_player_states: Dict[str, Dict[int, dict]] = {}
        self.battles: Dict[str, BattleRoom] = {}
        self.chat_approved_pairs: Set[Tuple[int, int]] = set()
        self.last_position_broadcast: Dict[UserKey, float] = {}

    def connect(self, server_id: str, user_id: int, websocket: WebSocket) -> None:
        key: UserKey = (server_id, user_id)
        self.active_connections[key] = websocket
        if server_id not in self.lobby_users:
            self.lobby_users[server_id] = set()
        self.lobby_users[server_id].add(user_id)
        log("CONNECT", f"server={server_id}, user_id={user_id} 加入連線與大廳")

    def disconnect(self, server_id: str, user_id: int) -> None:
        key: UserKey = (server_id, user_id)
        self.active_connections.pop(key, None)
        if server_id in self.lobby_users:
            self.lobby_users[server_id].discard(user_id)
        if server_id in self.lobby_player_states:
            self.lobby_player_states[server_id].pop(user_id, None)
        self.last_position_broadcast.pop(key, None)
        log("DISCONNECT", f"server={server_id}, user_id={user_id} 離線並退出大廳")

    def get_online_users(self, server_id: str) -> List[int]:
        return sorted(self.lobby_users.get(server_id, set()))

    def get_ws(self, server_id: str, user_id: int):
        return self.active_connections.get((server_id, user_id))

    async def send_json(self, server_id: str, to_user_id: int, msg: dict) -> None:
        ws = self.get_ws(server_id, to_user_id)
        if ws is not None:
            try:
                await ws.send_text(json.dumps(msg, ensure_ascii=False))
            except RuntimeError:
                log("SEND_ERROR", f"server={server_id}, user_id={to_user_id} 傳送失敗，略過")

    async def broadcast_in_server(
        self,
        server_id: str,
        msg: dict,
        exclude: int | None = None,
    ) -> None:
        for (sid, uid), ws in list(self.active_connections.items()):
            if sid != server_id:
                continue
            if exclude is not None and uid == exclude:
                continue
            try:
                await ws.send_text(json.dumps(msg, ensure_ascii=False))
            except RuntimeError:
                log("SEND_ERROR", f"server={sid}, user_id={uid} 傳送失敗，略過")
                continue

    def upsert_lobby_player(self, server_id: str, user_id: int, info: dict) -> None:
        if server_id not in self.lobby_player_states:
            self.lobby_player_states[server_id] = {}
        info["user_id"] = user_id
        self.lobby_player_states[server_id][user_id] = info

    def get_lobby_players(self, server_id: str) -> List[dict]:
        server_players = self.lobby_player_states.get(server_id, {})
        return [server_players[uid] for uid in sorted(server_players.keys())]

    def get_player_state(self, server_id: str, user_id: int) -> dict | None:
        return self.lobby_player_states.get(server_id, {}).get(user_id)

    def get_player_energy(self, server_id: str, user_id: int) -> int | None:
        state = self.get_player_state(server_id, user_id)
        if not state:
            return None
        return int(state.get("energy", 0))

    def approve_chat_pair(self, user1_id: int, user2_id: int) -> None:
        pair = tuple(sorted((user1_id, user2_id)))
        self.chat_approved_pairs.add(pair)
        log("CHAT_APPROVED", f"pair={pair} 已允許聊天")

    def is_chat_approved(self, from_user_id: int, to_user_id: int) -> bool:
        pair = tuple(sorted((from_user_id, to_user_id)))
        return pair in self.chat_approved_pairs

    def create_battle(self, server_id: str, player1_id: int, player2_id: int) -> BattleRoom:
        ts = int(time.time() * 1000)
        battle_id = f"{min(player1_id, player2_id)}_{max(player1_id, player2_id)}_{ts}"
        room = BattleRoom(
            battle_id=battle_id,
            server_id=server_id,
            player1_id=player1_id,
            player2_id=player2_id,
            scores={player1_id: 0, player2_id: 0},
            ready={player1_id: False, player2_id: False},
        )
        self.battles[battle_id] = room
        log(
            "BATTLE_CREATE",
            f"server={server_id}, battle_id={battle_id}, "
            f"player1={player1_id}, player2={player2_id}",
        )
        return room

    def get_battle(self, battle_id: str) -> BattleRoom | None:
        return self.battles.get(battle_id)

    def finish_battle(self, battle_id: str) -> None:
        self.battles.pop(battle_id, None)
        log("BATTLE_FINISH", f"battle_id={battle_id} 已移除")

    def find_battle_by_user(self, server_id: str, user_id: int) -> BattleRoom | None:
        for room in self.battles.values():
            if room.server_id != server_id:
                continue
            if user_id in (room.player1_id, room.player2_id):
                return room
        return None


manager = ConnectionManager()


async def handle_join_lobby(message: dict, websocket: WebSocket) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    manager.connect(server_id, user_id, websocket)

    display_name = payload.get("display_name") or f"Player{user_id}"
    pet_id = payload.get("pet_id") or 0
    pet_name = payload.get("pet_name") or "MyPet"
    energy = int(payload.get("energy", 100))
    status = payload.get("status") or "ACTIVE"
    # [修改] 這裡讀取前端送來的分數，存起來
    score = int(payload.get("score", 0))

    x = payload.get("x")
    y = payload.get("y")
    if x is None or y is None:
        x = random.randint(0, WORLD_WIDTH)
        y = random.randint(0, WORLD_HEIGHT)

    player_info = {
        "user_id": user_id,
        "display_name": display_name,
        "pet_id": int(pet_id),
        "pet_name": pet_name,
        "energy": energy,
        "status": status,
        "score": score,  # [修改] 儲存分數
        "x": float(x),
        "y": float(y),
    }
    manager.upsert_lobby_player(server_id, user_id, player_info)

    # ★ 新增：方便你看後端實際記錄的座標
    log(
        "JOIN_LOBBY_POS",
        f"server={server_id}, user_id={user_id}, x={player_info['x']}, y={player_info['y']}",
    )

    # ✅ 再從 manager 拿完整 state（確保和 server 內部一致）
    full_state = manager.get_player_state(server_id, user_id)

    players = manager.get_lobby_players(server_id)
    log(
        "JOIN_LOBBY",
        f"server={server_id}, user_id={user_id}, players_count={len(players)}",
    )

    lobby_state_msg = {
        "type": "lobby_state",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "players": players,
        },
    }
    await manager.send_json(server_id, user_id, lobby_state_msg)

    player_joined_msg = {
        "type": "player_joined",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "player": full_state,
        },
    }
    await manager.broadcast_in_server(server_id, player_joined_msg, exclude=user_id)


async def handle_pet_state_update(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    state = manager.get_player_state(server_id, user_id) or {}
    if "energy" in payload:
        state["energy"] = int(payload["energy"])
    if "status" in payload:
        state["status"] = str(payload["status"])
    if "score" in payload: # [修改] 允許更新分數
        state["score"] = int(payload["score"])
    if "x" in payload:
        state["x"] = float(payload["x"])
    if "y" in payload:
        state["y"] = float(payload["y"])

    manager.upsert_lobby_player(server_id, user_id, state)

    log(
        "PET_STATE_UPDATE",
        f"server={server_id}, user_id={user_id}, state={state}",
    )

    msg = {
        "type": "pet_state_update",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "player": state,
        },
    }
    await manager.broadcast_in_server(server_id, msg)


async def handle_update_position(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    x = payload.get("x")
    y = payload.get("y")

    if x is None or y is None:
        return

    now = time.time()
    key: UserKey = (server_id, user_id)
    last_ts = manager.last_position_broadcast.get(key, 0.0)
    if now - last_ts < 0.05:
        return
    manager.last_position_broadcast[key] = now

    state = manager.get_player_state(server_id, user_id) or {}
    state["x"] = float(x)
    state["y"] = float(y)
    manager.upsert_lobby_player(server_id, user_id, state)

    msg = {
        "type": "other_pet_moved",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "player": {
                "user_id": user_id,
                "x": state["x"],
                "y": state["y"],
            }
        },
    }
    await manager.broadcast_in_server(server_id, msg, exclude=user_id)


async def handle_chat_request(message: dict) -> None:
    server_id = message.get("server_id", "A")
    from_user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    to_user_id = payload.get("to_user_id")
    if to_user_id is None:
        log("CHAT_REQ_ERROR", "缺少 to_user_id，忽略 chat_request")
        return
    to_user_id = int(to_user_id)

    if manager.get_ws(server_id, to_user_id) is None:
        log(
            "CHAT_REQ_OFFLINE",
            f"server={server_id}, from={from_user_id}, to={to_user_id} 對方不在線，無法送出聊天請求",
        )
        error_msg = {
            "type": "chat_not_allowed",
            "server_id": server_id,
            "user_id": from_user_id,
            "payload": {
                "reason": "TARGET_OFFLINE",
                "message": "對方目前不在線上，無法發送聊天邀請。",
            },
        }
        await manager.send_json(server_id, from_user_id, error_msg)
        return

    log(
        "CHAT_REQUEST",
        f"server={server_id}, from={from_user_id}, to={to_user_id}",
    )

    msg = {
        "type": "chat_request",
        "server_id": server_id,
        "user_id": from_user_id,
        "payload": {
            "from_user_id": from_user_id,
            "to_user_id": to_user_id,
        },
    }
    await manager.send_json(server_id, to_user_id, msg)


async def handle_chat_request_accept(message: dict) -> None:
    server_id = message.get("server_id", "A")
    accept_user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    from_user_id = payload.get("from_user_id")

    if from_user_id is None:
        log("CHAT_ACCEPT_ERROR", "缺少 from_user_id，忽略 chat_request_accept")
        return
    from_user_id = int(from_user_id)

    manager.approve_chat_pair(accept_user_id, from_user_id)

    log(
        "CHAT_REQUEST_ACCEPT",
        f"server={server_id}, from={from_user_id}, accepted_by={accept_user_id}",
    )

    for uid in (accept_user_id, from_user_id):
        msg = {
            "type": "chat_approved",
            "server_id": server_id,
            "user_id": uid,
            "payload": {
                "user_id_1": from_user_id,
                "user_id_2": accept_user_id,
            },
        }
        await manager.send_json(server_id, uid, msg)


async def handle_chat_message(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    content = str(payload.get("content", ""))
    to_user_id = payload.get("to_user_id")

    if to_user_id is None:
        log("CHAT_ERROR", "缺少 to_user_id，忽略此訊息")
        return

    to_user_id = int(to_user_id)

    energy = manager.get_player_energy(server_id, user_id)
    if energy is not None and energy <= 30:
        log(
            "CHAT_BLOCKED_ENERGY",
            f"server={server_id}, from={user_id}, to={to_user_id}, energy={energy} (休眠，禁止聊天)",
        )
        error_msg = {
            "type": "chat_not_allowed",
            "server_id": server_id,
            "user_id": user_id,
            "payload": {
                "reason": "LOW_ENERGY",
                "message": "您的小寵物正在休眠狀態，無法聊天。",
            },
        }
        await manager.send_json(server_id, user_id, error_msg)
        return

    if not manager.is_chat_approved(user_id, to_user_id):
        log(
            "CHAT_BLOCKED",
            f"server={server_id}, from={user_id}, to={to_user_id} 尚未同意聊天，拒絕傳送",
        )
        error_msg = {
            "type": "chat_not_allowed",
            "server_id": server_id,
            "user_id": user_id,
            "payload": {
                "reason": "CHAT_NOT_APPROVED",
                "message": "對方尚未同意與你聊天。",
            },
        }
        await manager.send_json(server_id, user_id, error_msg)
        return

    if manager.get_ws(server_id, to_user_id) is None:
        log(
            "CHAT_TARGET_OFFLINE",
            f"server={server_id}, from={user_id}, to={to_user_id} 對方不在線",
        )
        error_msg = {
            "type": "chat_not_allowed",
            "server_id": server_id,
            "user_id": user_id,
            "payload": {
                "reason": "TARGET_OFFLINE",
                "message": "對方目前不在線上。",
            },
        }
        await manager.send_json(server_id, user_id, error_msg)
        return

    log(
        "CHAT",
        f"server={server_id}, from={user_id}, to={to_user_id}, content={content!r}",
    )

    chat_msg = {
        "type": "chat_message",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "from_user_id": user_id,
            "to_user_id": to_user_id,
            "content": content,
        },
    }

    await manager.send_json(server_id, user_id, chat_msg)
    await manager.send_json(server_id, to_user_id, chat_msg)


async def handle_battle_invite(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    to_user_id_raw = payload.get("to_user_id")
    if to_user_id_raw is None:
        log("BATTLE_INVITE_ERROR", "缺少 to_user_id，忽略 battle_invite")
        return
    to_user_id = int(to_user_id_raw)

    inviter_energy = manager.get_player_energy(server_id, user_id)
    if inviter_energy is not None and inviter_energy < 70:
        log(
            "BATTLE_INVITE_BLOCKED_ENERGY",
            f"server={server_id}, inviter={user_id}, energy={inviter_energy} (<70，不可對戰)",
        )
        msg = {
            "type": "battle_not_allowed",
            "server_id": server_id,
            "user_id": user_id,
            "payload": {
                "reason": "INVITER_LOW_ENERGY",
                "message": "您的小寵物疲累或休眠，無法發起對戰。",
            },
        }
        await manager.send_json(server_id, user_id, msg)
        return

    if manager.get_ws(server_id, to_user_id) is None:
        log(
            "BATTLE_INVITE_OFFLINE",
            f"server={server_id}, inviter={user_id}, to={to_user_id} 對方不在線，無法發出對戰邀請",
        )
        msg = {
            "type": "battle_not_allowed",
            "server_id": server_id,
            "user_id": user_id,
            "payload": {
                "reason": "TARGET_OFFLINE",
                "message": "對方目前不在線上，無法發起對戰。",
            },
        }
        await manager.send_json(server_id, user_id, msg)
        return

    log("BATTLE_INVITE", f"server={server_id}, from={user_id}, to={to_user_id}")

    invite_msg = {
        "type": "battle_invite",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "from_user_id": user_id,
            "to_user_id": to_user_id,
        },
    }
    await manager.send_json(server_id, to_user_id, invite_msg)


async def handle_battle_accept(message: dict) -> None:
    server_id = message.get("server_id", "A")
    accept_user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    from_user_id_raw = payload.get("from_user_id")
    if from_user_id_raw is None:
        log("BATTLE_ACCEPT_ERROR", "缺少 from_user_id，忽略 battle_accept")
        return
    from_user_id = int(from_user_id_raw)

    p1_energy = manager.get_player_energy(server_id, from_user_id)
    p2_energy = manager.get_player_energy(server_id, accept_user_id)

    if (p1_energy is not None and p1_energy < 70) or (p2_energy is not None and p2_energy < 70):
        log(
            "BATTLE_ACCEPT_BLOCKED_ENERGY",
            f"server={server_id}, A(user={from_user_id}, energy={p1_energy}), "
            f"B(user={accept_user_id}, energy={p2_energy}) 中有人 <70，不可對戰",
        )

        msg_a = {
            "type": "battle_not_allowed",
            "server_id": server_id,
            "user_id": from_user_id,
            "payload": {
                "reason": "LOW_ENERGY",
                "message": "雙方必須保持精神飽滿（體力 ≥ 70）才可以開始對戰。",
            },
        }
        msg_b = {
            "type": "battle_not_allowed",
            "server_id": server_id,
            "user_id": accept_user_id,
            "payload": {
                "reason": "LOW_ENERGY",
                "message": "雙方必須保持精神飽滿（體力 ≥ 70）才可以開始對戰。",
            },
        }
        await manager.send_json(server_id, from_user_id, msg_a)
        await manager.send_json(server_id, accept_user_id, msg_b)
        return

    room = manager.create_battle(server_id, from_user_id, accept_user_id)

    log(
        "BATTLE_ACCEPT",
        f"server={server_id}, from={from_user_id}, accepted_by={accept_user_id}, "
        f"battle_id={room.battle_id}",
    )

    battle_start_payload = {
        "battle_id": room.battle_id,
        "player1_id": room.player1_id,
        "player2_id": room.player2_id,
    }

    for pid in (room.player1_id, room.player2_id):
        msg = {
            "type": "battle_start",
            "server_id": server_id,
            "user_id": pid,
            "payload": battle_start_payload,
        }
        await manager.send_json(server_id, pid, msg)

async def handle_battle_ready(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    battle_id = payload.get("battle_id")

    if not battle_id:
        log("BATTLE_READY_ERROR", "缺少 battle_id")
        return

    room = manager.get_battle(battle_id)
    if not room:
        log("BATTLE_READY_ERROR", "battle_id 不存在")
        return

    # 標記該玩家已準備
    room.ready[user_id] = True
    log("BATTLE_READY", f"user {user_id} 已準備好 battle {battle_id}")

    # 檢查雙方是否都 ready
    if all(room.ready.values()):
        log("BATTLE_GO", f"battle {battle_id} 雙方都準備好了，發送 battle_go")

        msg = {
            "type": "battle_go",
            "server_id": server_id,
            "payload": {
                "battle_id": battle_id,
                "player1_id": room.player1_id,
                "player2_id": room.player2_id,
            }
        }

        await manager.send_json(server_id, room.player1_id, msg)
        await manager.send_json(server_id, room.player2_id, msg)


async def handle_battle_update(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    battle_id_raw = payload.get("battle_id")
    if battle_id_raw is None:
        log("BATTLE_UPDATE_ERROR", "缺少 battle_id，忽略 battle_update")
        return
    battle_id = str(battle_id_raw)
    score = int(payload.get("score", 0))
    state = str(payload.get("state", "running"))

    room = manager.get_battle(battle_id)
    if room is None:
        log("BATTLE_UPDATE", f"battle_id={battle_id} 不存在，略過")
        return

    room.scores[user_id] = score
    room.state = state

    log(
        "BATTLE_UPDATE",
        f"battle_id={battle_id}, user_id={user_id}, score={score}, state={state}",
    )

    update_msg = {
        "type": "battle_update",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "battle_id": battle_id,
            "scores": room.scores,
            "state": state,
        },
    }
    await manager.send_json(server_id, room.player1_id, update_msg)
    await manager.send_json(server_id, room.player2_id, update_msg)


async def handle_battle_result(message: dict) -> None:
    server_id = message.get("server_id", "A")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    battle_id_raw = payload.get("battle_id")
    if battle_id_raw is None:
        log("BATTLE_RESULT_ERROR", "缺少 battle_id，忽略 battle_result")
        return
    battle_id = str(battle_id_raw)

    # ⭐ 新版協議：只收這個玩家自己的最終分數
    score = int(payload.get("score", 0))

    room = manager.get_battle(battle_id)
    if room is None:
        log("BATTLE_RESULT", f"battle_id={battle_id} 不存在，略過")
        return

    # 1. 記錄這個玩家的結果
    room.results[user_id] = score
    room.scores[user_id] = score  # 順便更新 scores，之後要用也可以

    log(
        "BATTLE_RESULT_PARTIAL",
        f"battle_id={battle_id}, user_id={user_id}, score={score}, "
        f"current_results={room.results}",
    )

    # 2. 如果另一邊還沒結束 → 等他
    if len(room.results) < 2:
        return

    # 3. 兩邊都送來了 → 決定勝負
    player1_id = room.player1_id
    player2_id = room.player2_id
    player1_score = room.results.get(player1_id, 0)
    player2_score = room.results.get(player2_id, 0)

    if player1_score > player2_score:
        winner_user_id = player1_id
    elif player2_score > player1_score:
        winner_user_id = player2_id
    else:
        winner_user_id = 0  # 0 代表平手

    log(
        "BATTLE_RESULT_FINAL",
        f"battle_id={battle_id}, p1={player1_id} score={player1_score}, "
        f"p2={player2_id} score={player2_score}, winner={winner_user_id}",
    )

    # 4. 幫贏家加 1 積分（只有有贏家才加，平手不加）
    if winner_user_id > 0:
        winner_state = manager.get_player_state(server_id, winner_user_id)
        if winner_state:
            old_score = int(winner_state.get("score", 0))
            new_score = old_score + 1
            winner_state["score"] = new_score
            manager.upsert_lobby_player(server_id, winner_user_id, winner_state)

            # 廣播一次 pet_state_update，讓所有人在排行榜看到積分更新
            update_msg = {
                "type": "pet_state_update",
                "server_id": server_id,
                "user_id": winner_user_id,
                "payload": {
                    "player": winner_state,
                },
            }
            await manager.broadcast_in_server(server_id, update_msg)

    # 5. 把最終結果通知雙方（前端如果要用 ws 結果再顯示一次可以用）
    result_msg = {
        "type": "battle_result",
        "server_id": server_id,
        "user_id": user_id,  # 誰收到都沒差，payload 裡有全部
        "payload": {
            "battle_id": battle_id,
            "winner_user_id": winner_user_id,
            "player1_id": player1_id,
            "player2_id": player2_id,
            "player1_score": player1_score,
            "player2_score": player2_score,
        },
    }

    await manager.send_json(server_id, player1_id, result_msg)
    await manager.send_json(server_id, player2_id, result_msg)

    manager.finish_battle(battle_id)


async def handle_battle_disconnect(server_id: str, user_id: int) -> None:
    room = manager.find_battle_by_user(server_id, user_id)
    if room is None:
        return

    # ⭐ 1. 如果這場戰鬥還在 waiting（剛配對成功、大家正在跳轉 game.html）
    #    → 不要判輸贏，只是把房間清掉。
    if room.state == "waiting":
        log(
            "BATTLE_DISCONNECT_WAITING",
            f"server={server_id}, disconnect_user={user_id}, "
            f"battle_id={room.battle_id} (waiting 狀態，只結束房間不判勝負)",
        )
        manager.finish_battle(room.battle_id)
        return

    # ⭐ 2. 只有在「戰鬥已經實際在進行中」的狀態，才考慮把斷線方判定為落敗
    if room.state != "running":
        log(
            "BATTLE_DISCONNECT",
            f"server={server_id}, disconnect_user={user_id}, "
            f"battle_id={room.battle_id} (state={room.state}，不判輸贏，只結束房間)",
        )
        manager.finish_battle(room.battle_id)
        return

    # ⭐ 3. 真的在 running 中斷線 → 這裡才當作強制落敗
    if user_id == room.player1_id:
        winner_user_id = room.player2_id
    else:
        winner_user_id = room.player1_id

    player1_score = room.scores.get(room.player1_id, 0)
    player2_score = room.scores.get(room.player2_id, 0)

    log(
        "BATTLE_DISCONNECT",
        f"server={server_id}, disconnect_user={user_id}, "
        f"winner={winner_user_id}, battle_id={room.battle_id}",
    )

    result_msg = {
        "type": "battle_result",
        "server_id": server_id,
        "user_id": winner_user_id,
        "payload": {
            "battle_id": room.battle_id,
            "winner_user_id": winner_user_id,
            "player1_id": room.player1_id,
            "player2_id": room.player2_id,
            "player1_score": player1_score,
            "player2_score": player2_score,
        },
    }

    await manager.send_json(server_id, room.player1_id, result_msg)
    await manager.send_json(server_id, room.player2_id, result_msg)

    manager.finish_battle(room.battle_id)



@app.get("/")
async def health_check():
    log("HEALTH_CHECK", "收到 / 請求")
    return {"message": "wsA server running", "server_id": "A"}


@app.websocket("/ws/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    server_id = "A"
    user_id: int | None = None
    log("WS_ACCEPT", "有新的 WebSocket 連線進來")

    try:
        while True:
            raw = await websocket.receive_text()
            # log("WS_RECV_RAW", raw)

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                log("WS_ERROR", f"收到非 JSON：{raw!r}")
                continue

            msg_type = message.get("type")
            message["server_id"] = server_id

            msg_user_id_raw = message.get("user_id")
            msg_user_id: int | None = None
            if msg_user_id_raw is not None:
                try:
                    msg_user_id = int(msg_user_id_raw)
                except (TypeError, ValueError):
                    msg_user_id = None

            if msg_type == "join_lobby":
                if msg_user_id is None:
                    log("JOIN_LOBBY_ERROR", "join_lobby 缺少有效 user_id，忽略")
                    continue

                if user_id is None:
                    user_id = msg_user_id
                    log("WS_BIND_USER", f"這條連線綁定為 user_id={user_id}")
                else:
                    if msg_user_id != user_id:
                        log(
                            "JOIN_LOBBY_IMPERSONATE",
                            f"連線實際 user_id={user_id}，但 join_lobby 帶 user_id={msg_user_id}，忽略",
                        )
                        continue

                message["user_id"] = user_id
                await handle_join_lobby(message, websocket)
                continue

            if user_id is None:
                log("WS_NO_USER", f"尚未 join_lobby 的連線收到 {msg_type}，忽略")
                continue

            if msg_user_id is not None and msg_user_id != user_id:
                continue

            message["user_id"] = user_id

            if msg_type == "pet_state_update":
                await handle_pet_state_update(message)
            elif msg_type == "update_position":
                await handle_update_position(message)
            elif msg_type == "chat_request":
                await handle_chat_request(message)
            elif msg_type == "chat_request_accept":
                await handle_chat_request_accept(message)
            elif msg_type == "chat_message":
                await handle_chat_message(message)
            elif msg_type == "battle_invite":
                await handle_battle_invite(message)
            elif msg_type == "battle_accept":
                await handle_battle_accept(message)
            elif msg_type == "battle_update":
                await handle_battle_update(message)
            elif msg_type == "battle_ready":
                await handle_battle_ready(message)
            elif msg_type == "battle_result":
                await handle_battle_result(message)
            else:
                log("WS_UNKNOWN_TYPE", f"未知事件 type={msg_type!r}，略過")

    except WebSocketDisconnect:
        if user_id is not None:
            await handle_battle_disconnect(server_id, user_id)
            manager.disconnect(server_id, user_id)
            log("WS_DISCONNECT", f"server={server_id}, user_id={user_id} 斷線")

            player_left_msg = {
                "type": "player_left",
                "server_id": server_id,
                "user_id": user_id,
                "payload": {},
            }
            await manager.broadcast_in_server(server_id, player_left_msg, exclude=user_id)
