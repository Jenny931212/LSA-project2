// frontend/js/api_client.js
// ===============================================
// 統一的 REST API 呼叫工具
// ===============================================

// 統一的基礎 URL，用於處理 Nginx 反向代理
const BASE_URL = window.location.origin;

/**
 * 統一處理所有 REST API 請求
 * @param {string} endpoint - 應用程式內部的 API 路徑 (例如: /api/login)
 * @param {string} method - HTTP 方法 (例如: 'POST', 'GET')
 * @param {object|null} data - 請求體 (Request Body)
 * @returns {Promise<object>} - 成功時回傳 data 區塊
 */
async function callApi(endpoint, method = 'GET', data = null) {
    const server_id = localStorage.getItem('selected_server_id');
    const token = localStorage.getItem('user_token');
    
    // 登入 / 註冊 以外的 API，都需要先選好伺服器
    if (!server_id && endpoint !== '/api/register' && endpoint !== '/api/login') {
        throw new Error("SERVER_NOT_SELECTED: 請先選擇伺服器。");
    }

    // 實體路徑範例: /serverA/api/login
    const prefix = server_id ? `/server${server_id}` : '';
    const url = `${BASE_URL}${prefix}${endpoint}`;

    const headers = {
        'Content-Type': 'application/json',
    };

    if (token) {
        // 授權 Header（Bearer Token）
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        method: method,
        headers: headers,
    };

    if (data) {
        config.body = JSON.stringify(data);
    }

    try {
        const response = await fetch(url, config);
        const json = await response.json();

        if (json.success === false) {
            console.error('API Error:', json.error?.code, json.error?.message);
            throw new Error(json.error?.message || '未知錯誤');
        }

        return json.data;
    } catch (error) {
        console.error('網路或解析錯誤:', error);
        throw new Error(`網路錯誤: ${error.message}`);
    }
}

// ===============================================
// 組員 A 負責的 API
// ===============================================

// 登入
export async function login(username, password) {
    // 呼叫 API 時不直接帶 server_id，後端會根據使用者再分配
    return callApi('/api/login', 'POST', {
        username,
        password,
    });
}

// 註冊
export async function register(username, password, display_name) {
    return callApi('/api/register', 'POST', {
        username,
        password,
        display_name,
    });
}

// 取得寵物狀態（大廳＆遊戲用）
// ⭐⭐ 這裡是重點修改處：會帶 user_id 當 query string ⭐⭐
export async function getPetStatus(userId = null) {
    // 預設從 localStorage 拿 user_id
    const uid = userId ?? localStorage.getItem('user_id');
    if (!uid) {
        throw new Error('USER_ID_NOT_FOUND: 請重新登入。');
    }

    const endpoint = `/api/pet/status?user_id=${encodeURIComponent(uid)}`;
    return callApi(endpoint, 'GET');
}
