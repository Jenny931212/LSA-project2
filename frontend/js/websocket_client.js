// frontend/js/websocket_client.js
/**
 * 這是 Web Socket 模組的模擬版本 (Mockup)，用於前端功能開發。
 * 實際串接時，組員 D 需要在此實作真正的 Web Socket 連線、發送和接收邏輯。
 */

// 儲存所有註冊的回呼函數
const callbacks = {};

// 模擬 Web Socket 連線狀態
let isConnected = false;

/**
 * 初始化 Web Socket 連線
 * @param {string} token 使用者 JWT Token
 * @param {string} userId 使用者 ID
 */
export function initWebSocket(token, userId) {
    if (isConnected) {
        console.warn("[WS Mock] WebSocket 已經連線。");
        return;
    }
    
    // 模擬連線成功
    console.log(`[WS Mock] 正在嘗試連線到伺服器...`);
    
    setTimeout(() => {
        isConnected = true;
        console.log(`%c[WS Mock] 連線成功！User ID: ${userId}`, "color: green; font-weight: bold;");
        
        // --- 模擬伺服器推送的初始化數據 ---
        setTimeout(() => {
            // 1. 模擬推送第一次大廳寵物列表 (觸發排行榜和寵物位置更新)
            simulateServerMessage('update_pet_list', [
                { user_id: '1', display_name: '玩家甲', score: 1200 },
                { user_id: '999', display_name: '通訊測試寵', score: 850 },
                { user_id: '20', display_name: '神之腳', score: 1500 },
                { user_id: '30', display_name: '路人乙', score: 500 }, 
            ]);
            
            // 2. 模擬收到一個新的通訊請求 (沒有歷史紀錄)
            simulateServerMessage('chat_request', {
                sender_id: '999',
                sender_name: '通訊測試寵',
                has_history: false // 首次通訊
            });

        }, 1000); // 連線後 1 秒模擬接收數據
        
    }, 500); // 模擬 0.5 秒連線時間
}

/**
 * 註冊一個處理特定訊息類型的回呼函數
 * @param {string} type 訊息類型 (e.g., 'update_pet_list', 'chat_request')
 * @param {function} callback 處理函數
 */
export function registerCallback(type, callback) {
    callbacks[type] = callback;
    console.log(`[WS Mock] 已註冊回呼函數: ${type}`);
}

/**
 * 向伺服器發送訊息
 * @param {string} type 訊息類型
 * @param {object} payload 訊息內容
 */
export function sendMessage(type, payload) {
    if (!isConnected) {
        console.error("[WS Mock] Web Socket 未連線，無法發送訊息。");
        return;
    }
    console.log(`[WS Mock] 發送訊息: ${type}`, payload);
}

/**
 * 內部函數：模擬伺服器向客戶端推送訊息
 * @param {string} type 訊息類型
 * @param {object} data 訊息內容
 */
function simulateServerMessage(type, data) {
    if (callbacks[type]) {
        console.log(`[WS Mock] 接收到模擬訊息: ${type}`, data);
        callbacks[type](data);
    } else {
        console.warn(`[WS Mock] 接收到未知訊息類型: ${type}`);
    }
}