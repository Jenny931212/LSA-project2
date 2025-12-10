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
    print(f"[wsC][{prefix}] {message}")


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
    # 遊戲中即時更新用
    scores: Dict[int, int] = field(default_factory=dict)
    # waiting / running
    state: str = "waiting"
    # 雙方 ready 狀態
    ready: Dict[int, bool] = field(default_factory=dict)
    # ⭐ 新增：雙方送上來的「最終分數」
    results: Dict[int, int] = field(default_factory=dict)


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Dict[UserKey, WebSocket] = {}
        self.lobby_users: Dict[str, Set[int]] = {}
        self.lobby_player_states: Dict[str, Dict[int, dict]] = {}
        self.chat_pairs: Set[tuple[int, int]] = set()
        self.battles: Dict[str, BattleRoom] = {}

    # ------------------ WebSocket 管理 ------------------
    def connect(self, server_id: str, user_id: int, websocket: WebSocket) -> None:
        key = (server_id, user_id)
        self.active_connections[key] = websocket
        if server_id not in self.lobby_users:
            self.lobby_users[server_id] = set()
        self.lobby_users[server_id].add(user_id)
        log("CONNECT", f"server={server_id}, user_id={user_id} 已連線")

    def disconnect(self, server_id: str, user_id: int) -> None:
        key = (server_id, user_id)
        ws = self.active_connections.pop(key, None)
        if ws:
            log("DISCONNECT", f"server={server_id}, user_id={user_id} 連線移除")

        if server_id in self.lobby_users:
            self.lobby_users[server_id].discard(user_id)

        if server_id in self.lobby_player_states:
            self.lobby_player_states[server_id].pop(user_id, None)

        if server_id in self.lobby_users:
            leave_msg = {
                "type": "player_left",
                "server_id": server_id,
                "user_id": user_id,
            }
            for uid in self.lobby_users[server_id]:
                self.send_json_noawait(server_id, uid, leave_msg)

    def get_ws(self, server_id: str, user_id: int) -> WebSocket | None:
        return self.active_connections.get((server_id, user_id))

    async def send_json(self, server_id: str, user_id: int, message: dict) -> None:
        ws = self.get_ws(server_id, user_id)
        if ws is None:
            log(
                "SEND_JSON",
                f"server={server_id}, user_id={user_id} 不在線上，無法傳送：{message}",
            )
            return
        try:
            await ws.send_text(json.dumps(message, ensure_ascii=False))
        except Exception as e:
            log(
                "SEND_JSON_ERROR",
                f"server={server_id}, user_id={user_id} 傳送失敗：{e!r}",
            )

    def send_json_noawait(self, server_id: str, user_id: int, message: dict) -> None:
        import asyncio

        asyncio.create_task(self.send_json(server_id, user_id, message))

    async def broadcast_in_server(
        self,
        server_id: str,
        message: dict,
        exclude: int | None = None,
    ) -> None:
        if server_id not in self.lobby_users:
            return
        for uid in list(self.lobby_users[server_id]):
            if exclude is not None and uid == exclude:
                continue
            await self.send_json(server_id, uid, message)

    # ------------------ 大廳玩家狀態 ------------------
    def upsert_lobby_player(self, server_id: str, user_id: int, state: dict) -> None:
        if server_id not in self.lobby_player_states:
            self.lobby_player_states[server_id] = {}
        self.lobby_player_states[server_id][user_id] = state

    def get_lobby_players(self, server_id: str) -> List[dict]:
        server_states = self.lobby_player_states.get(server_id, {})
        players = []
        for uid, st in server_states.items():
            player_data = dict(st)
            player_data["user_id"] = uid
            players.append(player_data)
        return players

    def get_player_state(self, server_id: str, user_id: int) -> dict | None:
        return self.lobby_player_states.get(server_id, {}).get(user_id)

    def get_player_energy(self, server_id: str, user_id: int) -> int | None:
        st = self.get_player_state(server_id, user_id)
        if not st:
            return None
        return int(st.get("energy", 0))

    # ------------------ 私聊配對 ------------------
    def approve_chat_pair(self, user_id_1: int, user_id_2: int) -> None:
        pair = tuple(sorted((user_id_1, user_id_2)))
        self.chat_pairs.add(pair)

    def is_chat_approved(self, user_id_1: int, user_id_2: int) -> bool:
        pair = tuple(sorted((user_id_1, user_id_2)))
        return pair in self.chat_pairs

    # ------------------ 對戰房間 ------------------
    def create_battle(
        self,
        server_id: str,
        player1_id: int,
        player2_id: int,
    ) -> BattleRoom:
        battle_id = f"{int(time.time()*1000)}-{player1_id}-{player2_id}"
        room = BattleRoom(
            battle_id=battle_id,
            server_id=server_id,
            player1_id=player1_id,
            player2_id=player2_id,
        )
        self.battles[battle_id] = room
        log(
            "BATTLE_CREATE",
            f"server={server_id}, battle_id={battle_id}, p1={player1_id}, p2={player2_id}",
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
    server_id = message.get("server_id", "C")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    manager.connect(server_id, user_id, websocket)
    display_name = payload.get("display_name") or f"Player{user_id}"
    pet_id = payload.get("pet_id") or 0
    pet_name = payload.get("pet_name") or "MyPet"
    energy = int(payload.get("energy", 100))
    status = payload.get("status") or "ACTIVE"
    # ⭐ 大廳裡也有紀錄積分
    score = int(payload.get("score", 0))
    x = payload.get("x")
    y = payload.get("y")
    if x is None or y is None:
        x = random.randint(0, WORLD_WIDTH)
        y = random.randint(0, WORLD_HEIGHT)
    x = float(x)
    y = float(y)

    player_info = {
        "display_name": display_name,
        "pet_id": int(pet_id),
        "pet_name": pet_name,
        "energy": energy,
        "status": status,
        "score": score,
        "x": x,
        "y": y,
    }
    manager.upsert_lobby_player(server_id, user_id, player_info)
    players = manager.get_lobby_players(server_id)
    log(
        "JOIN_LOBBY",
        f"server={server_id}, user_id={user_id}, players={players}",
    )
    full_state = dict(player_info)
    full_state["user_id"] = user_id
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
    server_id = message.get("server_id", "C")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    state = manager.get_player_state(server_id, user_id) or {}
    display_name = payload.get("display_name") or state.get("display_name") or f"Player{user_id}"
    pet_id = payload.get("pet_id") or state.get("pet_id") or 0
    pet_name = payload.get("pet_name") or state.get("pet_name") or "MyPet"
    energy = int(payload.get("energy", state.get("energy", 100)))
    status = payload.get("status") or state.get("status") or "ACTIVE"
    score = int(payload.get("score", state.get("score", 0)))
    x = payload.get("x", state.get("x"))
    y = payload.get("y", state.get("y"))
    if x is None or y is None:
        x = random.randint(0, WORLD_WIDTH)
        y = random.randint(0, WORLD_HEIGHT)
    x = float(x)
    y = float(y)

    new_state = {
        "display_name": display_name,
        "pet_id": int(pet_id),
        "pet_name": pet_name,
        "energy": energy,
        "status": status,
        "score": score,
        "x": x,
        "y": y,
    }
    manager.upsert_lobby_player(server_id, user_id, new_state)
    players = manager.get_lobby_players(server_id)
    log(
        "PET_STATE_UPDATE",
        f"server={server_id}, user_id={user_id}, new_state={new_state}, players={players}",
    )
    state_msg = {
        "type": "lobby_state",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "players": players,
        },
    }
    await manager.broadcast_in_server(server_id, state_msg)


async def handle_update_position(message: dict) -> None:
    server_id = message.get("server_id", "C")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    x = payload.get("x")
    y = payload.get("y")
    if x is None or y is None:
        log("UPDATE_POS_ERROR", "缺少 x 或 y，忽略 update_position")
        return
    x = float(x)
    y = float(y)
    state = manager.get_player_state(server_id, user_id)
    if not state:
        log(
            "UPDATE_POS_ERROR",
            f"server={server_id}, user_id={user_id} 尚未在大廳有狀態，忽略",
        )
        return
    state["x"] = x
    state["y"] = y
    manager.upsert_lobby_player(server_id, user_id, state)
    log(
        "UPDATE_POSITION",
        f"server={server_id}, user_id={user_id}, x={x}, y={y}",
    )
    msg = {
        "type": "player_moved",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "user_id": user_id,
            "x": x,
            "y": y,
        },
    }
    await manager.broadcast_in_server(server_id, msg, exclude=user_id)


# ==================== 聊天 ====================

async def handle_chat_request(message: dict) -> None:
    server_id = message.get("server_id", "C")
    from_user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    to_user_id_raw = payload.get("to_user_id")
    if to_user_id_raw is None:
        log("CHAT_REQUEST_ERROR", "缺少 to_user_id，忽略 chat_request")
        return
    to_user_id = int(to_user_id_raw)

    energy = manager.get_player_energy(server_id, from_user_id)
    if energy is not None and energy <= 30:
        log(
            "CHAT_REQUEST_BLOCKED_ENERGY",
            f"server={server_id}, from={from_user_id}, to={to_user_id}, energy={energy} (休眠，禁止發起聊天)",
        )
        error_msg = {
            "type": "chat_not_allowed",
            "server_id": server_id,
            "user_id": from_user_id,
            "payload": {
                "reason": "LOW_ENERGY",
                "message": "您的小寵物正在休眠狀態，無法發起聊天。",
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
    server_id = message.get("server_id", "C")
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
    server_id = message.get("server_id", "C")
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

    log(
        "CHAT_MESSAGE",
        f"server={server_id}, from={user_id}, to={to_user_id}, content={content}",
    )

    forward_msg = {
        "type": "chat_message",
        "server_id": server_id,
        "user_id": user_id,
        "payload": {
            "from_user_id": user_id,
            "to_user_id": to_user_id,
            "content": content,
        },
    }
    await manager.send_json(server_id, to_user_id, forward_msg)


# ==================== 對戰 ====================

async def handle_battle_invite(message: dict) -> None:
    server_id = message.get("server_id", "C")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    to_user_id_raw = payload.get("to_user_id")
    if to_user_id_raw is None:
        log("BATTLE_INVITE_ERROR", "缺少 to_user_id，忽略 battle_invite")
        return
    to_user_id = int(to_user_id_raw)

    energy = manager.get_player_energy(server_id, user_id)
    if energy is not None and energy < 70:
        log(
            "BATTLE_INVITE_BLOCKED_ENERGY",
            f"server={server_id}, inviter={user_id}, energy={energy} < 70，禁止發出對戰邀請",
        )
        msg = {
            "type": "battle_not_allowed",
            "server_id": server_id,
            "user_id": user_id,
            "payload": {
                "reason": "LOW_ENERGY",
                "message": "體力值必須 ≥ 70 才可以發出對戰邀請。",
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
    server_id = message.get("server_id", "C")
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
    server_id = message.get("server_id", "C")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}
    battle_id_raw = payload.get("battle_id")
    if battle_id_raw is None:
        log("BATTLE_READY_ERROR", "缺少 battle_id，忽略 battle_ready")
        return
    battle_id = str(battle_id_raw)

    room = manager.get_battle(battle_id)
    if room is None:
        log("BATTLE_READY", f"battle_id={battle_id} 不存在，略過")
        return

    room.ready[user_id] = True
    log(
        "BATTLE_READY",
        f"battle_id={battle_id}, user_id={user_id} 已 ready, ready={room.ready}",
    )

    if room.ready.get(room.player1_id) and room.ready.get(room.player2_id):
        room.state = "running"
        log(
            "BATTLE_START_RUNNING",
            f"battle_id={battle_id} 兩邊都 ready, state=running",
        )
        msg = {
            "type": "battle_all_ready",
            "server_id": server_id,
            "user_id": 0,
            "payload": {
                "battle_id": room.battle_id,
                "player1_id": room.player1_id,
                "player2_id": room.player2_id,
            },
        }
        await manager.send_json(server_id, room.player1_id, msg)
        await manager.send_json(server_id, room.player2_id, msg)


async def handle_battle_update(message: dict) -> None:
    server_id = message.get("server_id", "C")
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
    """
    新版：每個玩家結束遊戲時，送上自己的最終分數。
    等到 room.results 裡有 2 個人，就一起決定勝負、加積分、廣播結果。
    """
    server_id = message.get("server_id", "C")
    user_id = int(message.get("user_id"))
    payload = message.get("payload") or {}

    battle_id_raw = payload.get("battle_id")
    if battle_id_raw is None:
        log("BATTLE_RESULT_ERROR", "缺少 battle_id，忽略 battle_result")
        return
    battle_id = str(battle_id_raw)

    score = int(payload.get("score", 0))

    room = manager.get_battle(battle_id)
    if room is None:
        log("BATTLE_RESULT", f"battle_id={battle_id} 不存在，略過")
        return

    room.results[user_id] = score
    room.scores[user_id] = score

    log(
        "BATTLE_RESULT_PARTIAL",
        f"battle_id={battle_id}, user_id={user_id}, score={score}, "
        f"current_results={room.results}",
    )

    if len(room.results) < 2:
        other_id = room.player2_id if user_id == room.player1_id else room.player1_id
        if other_id not in room.results:
            other_score = room.scores.get(other_id, 0)
            room.results[other_id] = other_score

    player1_id = room.player1_id
    player2_id = room.player2_id

    player1_score = room.results.get(player1_id, 0)
    player2_score = room.results.get(player2_id, 0)

    if player1_score > player2_score:
        winner_user_id = player1_id
    elif player2_score > player1_score:
        winner_user_id = player2_id
    else:
        winner_user_id = 0

    log(
        "BATTLE_RESULT_FINAL",
        f"battle_id={battle_id}, p1={player1_id} score={player1_score}, "
        f"p2={player2_id} score={player2_score}, winner={winner_user_id}",
    )

    if winner_user_id > 0:
        winner_state = manager.get_player_state(server_id, winner_user_id)
        if winner_state:
            old_score = int(winner_state.get("score", 0))
            new_score = old_score + 1
            winner_state["score"] = new_score
            manager.upsert_lobby_player(server_id, winner_user_id, winner_state)

    result_msg = {
        "type": "battle_result",
        "server_id": server_id,
        "user_id": winner_user_id,
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
    """
    某一邊在對戰中突然斷線時的處理：
    - waiting：只是大家剛跳轉、還沒正式開始 → 直接收房間，不判輸贏。
    - running：才會把斷線方判定為落敗，加積分給另外一方。
    """
    room = manager.find_battle_by_user(server_id, user_id)
    if room is None:
        return

    if room.state == "waiting":
        log(
            "BATTLE_DISCONNECT_WAITING",
            f"server={server_id}, disconnect_user={user_id}, "
            f"battle_id={room.battle_id} (waiting 狀態，只結束房間不判勝負)",
        )
        manager.finish_battle(room.battle_id)
        return

    if room.state != "running":
        log(
            "BATTLE_DISCONNECT",
            f"server={server_id}, disconnect_user={user_id}, "
            f"battle_id={room.battle_id} (state={room.state}，不判輸贏，只結束房間)",
        )
        manager.finish_battle(room.battle_id)
        return

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


# =========================================================
# FastAPI 路由：health_check + WebSocket 主入口
# =========================================================

@app.get("/")
async def health_check():
    log("HEALTH_CHECK", "收到 / 請求")
    return {"message": "wsC server running", "server_id": "C"}


@app.websocket("/ws/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    server_id = "C"
    user_id: int | None = None
    log("WS_ACCEPT", "有新的 WebSocket 連線進來")

    try:
        while True:
            raw = await websocket.receive_text()

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

            if msg_user_id is None:
                log("WS_NO_USER", f"尚未 join_lobby 就送 {msg_type}，忽略")
                continue

            if user_id is None:
                user_id = msg_user_id
            elif msg_user_id != user_id:
                log(
                    "WS_USER_MISMATCH",
                    f"連線綁定 user_id={user_id}，但訊息帶 user_id={msg_user_id}，忽略",
                )
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
            elif msg_type == "battle_ready":
                await handle_battle_ready(message)
            elif msg_type == "battle_update":
                await handle_battle_update(message)
            elif msg_type == "battle_result":
                await handle_battle_result(message)
            else:
                log("WS_UNKNOWN_TYPE", f"收到未知 type={msg_type}，略過")

    except WebSocketDisconnect:
        if user_id is not None:
            log("WS_DISCONNECT", f"user_id={user_id} 斷線")
            await handle_battle_disconnect(server_id, user_id)
            manager.disconnect(server_id, user_id)
    except Exception as e:
        log("WS_EXCEPTION", f"WebSocket 例外：{e!r}")
        if user_id is not None:
            await handle_battle_disconnect(server_id, user_id)
            manager.disconnect(server_id, user_id)
