// frontend/js/login_app.js (最終正確版)

import { login, register } from './api_client.js';

const form = document.getElementById('auth-form');
const loginBtn = document.getElementById('login-btn');
const registerGroup = document.getElementById('display-name-group');
let isRegisterMode = false;

// 1. 處理登入/註冊模式切換
document.getElementById('switch-to-register-btn').addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
        loginBtn.textContent = '註冊';
        registerGroup.style.display = 'block';
        document.getElementById('switch-to-register-btn').textContent = '切換至登入';
    } else {
        loginBtn.textContent = '登入';
        registerGroup.style.display = 'none';
        document.getElementById('switch-to-register-btn').textContent = '切換至註冊';
    }
});

// 2. 處理表單提交 (登入/註冊 - 串接 API)
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const messageArea = document.getElementById('message-area');
    messageArea.textContent = '處理中...';

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const displayName = document.getElementById('display-name').value;

    try {
        let responseData;

        if (isRegisterMode) {
            // 呼叫註冊 API
            responseData = await register(username, password, displayName);
            messageArea.textContent = '✅ 註冊成功！正在導向伺服器選擇...';
        } else {
            // 呼叫登入 API
            responseData = await login(username, password);
            messageArea.textContent = '✅ 登入成功！正在導向伺服器選擇...';
        }

        // 預期組員 A 的後端回傳格式：
        // {
        //   user_id: 1,
        //   username: "...",
        //   display_name: "...",
        //   server_id: "A" | "B" | "C" | null,
        //   token: "..."
        // }

        // 把重要資訊存進 localStorage
        localStorage.setItem('user_token', responseData.token);
        localStorage.setItem('user_id', responseData.user_id);
        localStorage.setItem('display_name', responseData.display_name || username);

        // 伺服器還沒選過 → 讓使用者去 server-select.html 選
        // （之後在那邊才會設定 selected_server_id）
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.location.href = 'server-select.html';
    } catch (error) {
        console.error(error);
        messageArea.textContent = `❌ 失敗：${error.message}`;
    }
});
