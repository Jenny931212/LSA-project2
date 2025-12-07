// frontend/js/websocket_client.js
// ======================================================
// [修改說明]
// 1. 移除所有 Mockup 假資料邏輯，改為真實 WebSocket 連線。
// 2. ws.onopen 時，發送 join_lobby 封包。
// 3. [重要] join_lobby 的初始座標強制設為 100, 100 (對應 lobby_app.js 的 WORLD_WIDTH/2)，解決座標不同步問題。
// 4. [重要] join_lobby 正確帶入 display_name，解決暱稱顯示 PlayerX 的問題。
// ======================================================

const callbacks = {};
let ws = null;
let isConnected = false;

/**
 * 初始化 Web Socket 連線
 * @param {string} token 使用者 JWT Token
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
    // Nginx 轉發規則通常是 /serverA/ws/ 對應後端的 wsA
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; 
    const wsUrl = `${protocol}//${host}/server${serverId}/ws/`;

    console.log(`[WS] 正在連線至: ${wsUrl}`);

    // 3. 建立連線
    ws = new WebSocket(wsUrl);

    // --- 連線開啟 ---
    ws.onopen = () => {
        console.log(`%c[WS] 連線成功！Server: ${serverId}, User: ${userId}`, "color: green; font-weight: bold;");
        isConnected = true;

        // [修改] 連線後發送 join_lobby
        const joinMessage = {
            type: "join_lobby",
            server_id: serverId,
            user_id: parseInt(userId),
            payload: {
                // [修改] 確保抓取正確的暱稱，若無則 fallback 到 Player+ID
                display_name: localStorage.getItem('display_name') || `Player${userId}`,
                pet_id: 1, 
                pet_name: "MyPet",
                energy: parseInt(localStorage.getItem('my_spirit_value') || 100),
                status: "ACTIVE",
                
                // [修改] 強制設定為 100, 100 (lobby_app.js 的初始位置)
                // 解決「我看自己在中間，別人看我在隨機位置」的問題
                x: 100,
                y: 100
            }
        };
        sendRaw(joinMessage);
    };

    // --- 收到訊息 ---
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // console.log("[WS] 收到訊息:", data);

            // 根據 type 觸發對應的 callback (例如: other_pet_moved, lobby_state)
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
