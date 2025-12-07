// frontend/js/websocket_client.js (修正版：真實連線)

const callbacks = {};
let ws = null;
let isConnected = false;

/**
 * 初始化 Web Socket 連線
 * @param {string} token 使用者 JWT Token (目前後端尚未強制驗證，但預留欄位)
 * @param {string} userId 使用者 ID
 */
export function initWebSocket(token, userId) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.warn("[WS] WebSocket 已經連線或正在連線中。");
        return;
    }

    // 1. 取得目前選擇的伺服器 ID (A, B, or C)
    const serverId = localStorage.getItem('selected_server_id');
    if (!serverId) {
        console.error("[WS] 尚未選擇伺服器，無法連線！");
        return;
    }

    // 2. 組合 WebSocket URL
    // 假設你的 Nginx 設定是 /serverA/ws/ -> 對應後端的 wsA
    // protocol: http -> ws, https -> wss
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; // 包含 domain 和 port
    const wsUrl = `${protocol}//${host}/server${serverId}/ws/`;

    console.log(`[WS] 正在連線至: ${wsUrl}`);

    // 3. 建立連線
    ws = new WebSocket(wsUrl);

    // --- 連線開啟 ---
    ws.onopen = () => {
        console.log(`%c[WS] 連線成功！Server: ${serverId}, User: ${userId}`, "color: green; font-weight: bold;");
        isConnected = true;

        // 4. 連線後必須立刻發送 'join_lobby'，後端才會把你加入名單
        const joinMessage = {
            type: "join_lobby",
            server_id: serverId,
            user_id: parseInt(userId),
            payload: {
                display_name: localStorage.getItem('display_name') || `Player${userId}`,
                pet_id: 1, // 預設或從 API 取得
                pet_name: "MyPet",
                // 這裡可以讀取最新的體力狀態
                energy: parseInt(localStorage.getItem('my_spirit_value') || 100),
                status: "ACTIVE",
                // 隨機或讀取上次位置
                x: Math.floor(Math.random() * 200),
                y: Math.floor(Math.random() * 200)
            }
        };
        sendRaw(joinMessage);
    };

    // --- 收到訊息 ---
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log("[WS] 收到訊息:", data);

            // 根據 type 觸發對應的 callback (例如: other_pet_moved, lobby_state)
            if (data.type && callbacks[data.type]) {
                callbacks[data.type](data);
            } else {
                // 有些訊息可能沒有 type，或是尚未註冊處理函式
                // console.debug("[WS] 未處理的訊息類型:", data.type);
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
 * 註冊回呼函數 (與原本介面保持一致)
 */
export function registerCallback(type, callback) {
    callbacks[type] = callback;
    // console.log(`[WS] 已註冊監聽事件: ${type}`);
}

/**
 * 發送訊息給伺服器 (封裝標準格式)
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
