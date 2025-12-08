// frontend/js/websocket_client.js

const callbacks = {};
let ws = null;
let isConnected = false;

/**
 * 初始化 Web Socket 連線
 * @param {string} token 使用者 JWT Token
 * @param {string} userId 使用者 ID
 * @param {object} initialData 包含玩家初始資訊 (pet_id, score, x, y 等)
 */
export function initWebSocket(token, userId, initialData = {}) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.warn("[WS] WebSocket 已經連線或正在連線中。");
        return;
    }

    const serverId = localStorage.getItem('selected_server_id');
    if (!serverId) {
        console.error("[WS] 尚未選擇伺服器，無法連線！");
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; 
    const wsUrl = `${protocol}//${host}/server${serverId}/ws/`;

    console.log(`[WS] 正在連線至: ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    // --- 連線開啟 ---
    ws.onopen = () => {
        console.log(`%c[WS] 連線成功！Server: ${serverId}, User: ${userId}`, "color: green; font-weight: bold;");
        isConnected = true;

        // ★★ 關鍵：優先使用 lobby_app 傳進來的 initialData.x / initialData.y
        const initialX =
            typeof initialData.x === "number"
                ? initialData.x
                : 100; // 如果沒給就先用 100 當預設
        const initialY =
            typeof initialData.y === "number"
                ? initialData.y
                : 100;

        const joinMessage = {
            type: "join_lobby",
            server_id: serverId,
            user_id: parseInt(userId),
            payload: {
                display_name:
                    initialData.display_name ||
                    localStorage.getItem("display_name") ||
                    `Player${userId}`,
                pet_id: initialData.pet_id || 1,
                pet_name: initialData.pet_name || "MyPet",
                energy:
                    typeof initialData.energy === "number"
                        ? initialData.energy
                        : 100,
                status: initialData.status || "ACTIVE",
                score:
                    typeof initialData.score === "number"
                        ? initialData.score
                        : 0,
                // ❌ 不再自己決定 x, y
                // x: 100,
                // y: 100,
            },
        };


        sendRaw(joinMessage);
    };

    // --- 收到訊息 ---
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // console.log("[WS] 收到訊息:", data);

            if (data.type && callbacks[data.type]) {
                callbacks[data.type](data);
            }
        } catch (e) {
            console.error("[WS] 解析訊息失敗:", event.data, e);
        }
    };

    // --- 連線關閉 ---
    ws.onclose = (event) => {
        console.warn("[WS] 連線已斷開", event);
        isConnected = false;
        ws = null;
    };

    // --- 連線錯誤 ---
    ws.onerror = (error) => {
        console.error("[WS] 連線發生錯誤", error);
    };
}

/**
 * 註冊回呼函數
 */
export function registerCallback(type, callback) {
    callbacks[type] = callback;
}

/**
 * 發送訊息給伺服器
 */
export function sendMessage(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error("[WS] 未連線，無法傳送訊息");
        return;
    }

    const serverId = localStorage.getItem('selected_server_id') || 'A';
    const userId = localStorage.getItem('user_id');

    const msg = {
        type: type,
        server_id: serverId,
        user_id: parseInt(userId),
        payload: payload
    };

    sendRaw(msg);
}

/**
 * 內部 helper: 直接發送物件
 */
function sendRaw(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}
