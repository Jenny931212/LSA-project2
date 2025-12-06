// frontend/js/lobby_app.js (最終確認版本 - 連續移動＋正確鏡頭邏輯)

import { getPetStatus } from './api_client.js';
import { initWebSocket, sendMessage, registerCallback } from './websocket_client.js';

// 世界地圖虛擬大小 (邏輯座標)
const WORLD_WIDTH = 200;
const WORLD_HEIGHT = 200;

// ======================================================
// 1. DOM 元素定義
// ======================================================
const petNameEl = document.getElementById('pet-name');
const petLevelEl = document.getElementById('pet-level');
const serverIdEl = document.getElementById('server-id');
const lobbyTitleEl = document.getElementById('lobby-title');
const myPetImgEl = document.getElementById('my-pet-img');
const myPetEl = document.getElementById('my-pet');
const myPetNameTagEl = document.querySelector('#my-pet .pet-name-tag');
const leaderboardListEl = document.getElementById('leaderboard-list');

const lobbyAreaEl = document.getElementById('lobby-area');
const worldLayerEl = document.getElementById('world-layer');

const chatBox = document.getElementById('chat-box');
const chatHeader = document.getElementById('chat-header');
const closeChatBtn = document.getElementById('close-chat-btn');
const logoutBtn = document.getElementById('logout-btn');

const petInfoCard = document.getElementById('pet-info-card');
const targetPetAvatar = document.getElementById('target-pet-avatar');
const targetPetNameTag = document.getElementById('target-pet-name-tag');
const targetPetStatus = document.getElementById('target-pet-status');
const actionChatBtn = document.getElementById('action-chat-btn');
const actionBattleBtn = document.getElementById('action-battle-btn');

// 通訊狀態相關 DOM
const chatInputEl = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatStatusMessageEl = document.getElementById('chat-status-message');

// 浮動 UI DOM
const globalModalOverlay = document.getElementById('global-modal-overlay');
const inviteModalBox = document.getElementById('invite-modal-box');
const modalHeader = document.getElementById('modal-header');
const modalStatusText = document.getElementById('modal-status-text');
const modalActionsArea = document.getElementById('modal-actions-area');
const commRequestBadge = document.getElementById('communication-request-badge');
const requestCountEl = document.getElementById('request-count');
const modalCloseBtn = document.getElementById('modal-close-btn');

// ======================================================
// 2. 全域狀態變數
// ======================================================
let targetUserId = null;
let targetPetName = null;

const PET_SPRITES = {
    idle: './assets/pet-lobby.png',
    up: './assets/pet-up.png',
    down: './assets/pet-down.png',
    left: './assets/pet-left.png',
    right: './assets/pet-right.png',
};

const SERVER_THEMES = {
    A: "🌳 汪洋草原",
    B: "❄️ 凍原腳印",
    C: "🌵 沙塵迷蹤",
};

// 我方寵物邏輯座標（世界座標）
let myWorldX = WORLD_WIDTH / 2;
let myWorldY = WORLD_HEIGHT / 2;

// 鏡頭目前的偏移量 (世界層 translate)
let cameraOffsetX = 0;
let cameraOffsetY = 0;

// 連續移動：記錄目前有被按住的按鍵
const keysPressed = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
};

// 停止移動後恢復待機圖的計時器
let moveIdleTimer = null;

let pendingChatRequests = []; // 儲存待處理的通訊請求
let lastLeaderboardState = {}; // 記住上一輪排行榜 { key: { score, rank } }

// ======================================================
// 3. 工具函式：鏡頭 / 精神值
// ======================================================

function setPetSprite(direction) {
    if (!PET_SPRITES[direction]) return;
    myPetImgEl.src = PET_SPRITES[direction];
}

// 根據伺服器切換地圖背景
function applyMapByServer(serverId) {
    const mapSrc = {
        A: "./assets/lobby-backgroundA.png",
        B: "./assets/lobby-backgroundB.png",
        C: "./assets/lobby-backgroundC.png"
    };

    if (mapSrc[serverId]) {
        worldLayerEl.style.backgroundImage = `url('${mapSrc[serverId]}')`;
    }
}


/**
 * 更新鏡頭位置：根據寵物世界座標，移動世界層（world-layer）
 * worldX: 0~WORLD_WIDTH
 * worldY: 0~WORLD_HEIGHT
 *
 * 鏡頭最多移動到地圖邊界，不會露出 body 空白
 */
function updateCamera(worldX, worldY) {
    const lobbyRect = lobbyAreaEl.getBoundingClientRect();

    // 使用 scrollWidth / scrollHeight 取得世界實際像素大小（不受 transform 影響）
    const worldWidth = worldLayerEl.scrollWidth || worldLayerEl.offsetWidth;
    const worldHeight = worldLayerEl.scrollHeight || worldLayerEl.offsetHeight;

    // 世界座標 → 世界像素位置
    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;

    // 1. 理想鏡頭：讓寵物位於畫面中央
    let idealOffsetX = worldPX - lobbyRect.width / 2;
    let idealOffsetY = worldPY - lobbyRect.height / 2;

    // 2. 鏡頭偏移極限（不能讓地圖露出空白）
    const maxOffsetX = Math.max(0, worldWidth - lobbyRect.width);
    const maxOffsetY = Math.max(0, worldHeight - lobbyRect.height);

    // 3. 限制在 0 ~ maxOffset 範圍內
    const finalOffsetX = Math.min(Math.max(0, idealOffsetX), maxOffsetX);
    const finalOffsetY = Math.min(Math.max(0, idealOffsetY), maxOffsetY);

    cameraOffsetX = finalOffsetX;
    cameraOffsetY = finalOffsetY;

    // 4. 套用 transform
    worldLayerEl.style.transform = `translate(${-finalOffsetX}px, ${-finalOffsetY}px)`;
}

/**
 * 根據世界座標 + 鏡頭偏移，計算寵物在畫面上的位置
 * → 讓狗在鏡頭內自由移動，可走到螢幕邊界
 */
function updateMyPetScreenPosition(worldX, worldY) {
    const lobbyRect = lobbyAreaEl.getBoundingClientRect();
    const worldWidth = worldLayerEl.scrollWidth || worldLayerEl.offsetWidth;
    const worldHeight = worldLayerEl.scrollHeight || worldLayerEl.offsetHeight;

    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;

    // 寵物相對於螢幕的位置 = 世界像素 - 鏡頭偏移
    const screenX = worldPX - cameraOffsetX;
    const screenY = worldPY - cameraOffsetY;

    // 讓狗的腳踩在 Y 座標上、X 以中心對齊
    const petWidth = myPetEl.offsetWidth || 96;
    const petHeight = myPetEl.offsetHeight || 110;

    myPetEl.style.left = `${screenX - petWidth / 2}px`;
    myPetEl.style.top = `${screenY - petHeight}px`;
}

function getSpiritInfo(spirit) {
    let statusName = '';
    let statusImg = '';

    if (spirit >= 71) {
        statusName = '飽滿';
        statusImg = './assets/pet-active.png';
    } else if (spirit >= 31) {
        statusName = '休息中';
        statusImg = './assets/pet-resting.png';
    } else {
        statusName = '疲憊';
        statusImg = './assets/pet-tired.png';
    }
    return { statusName, gameImg: statusImg };
}

/** 根據精神值切換膠囊顏色 */
function updateSpiritBadge(spirit) {
    petLevelEl.classList.remove('spirit-full', 'spirit-medium', 'spirit-low');

    if (spirit >= 71) {
        petLevelEl.classList.add('spirit-full');
    } else if (spirit >= 31) {
        petLevelEl.classList.add('spirit-medium');
    } else {
        petLevelEl.classList.add('spirit-low');
    }
}

// ======================================================
// 4. 聊天框 / Modal 相關
// ======================================================

function closeChatBox() {
    chatBox.style.display = 'none';
    // 徽章回到原位
    commRequestBadge.style.bottom = '20px';
    commRequestBadge.style.left = '20px';
}

function closeGlobalModal() {
    globalModalOverlay.style.display = 'none';
    actionBattleBtn.disabled = false;
    actionChatBtn.disabled = false;
    modalStatusText.style.fontSize = '24px';
    modalActionsArea.style.justifyContent = 'space-around';
    modalCloseBtn.onclick = null;
    modalCloseBtn.style.display = 'none';
}

function showCustomAlert(title, message, callback = () => {}) {
    modalHeader.textContent = title;
    modalStatusText.textContent = message;
    modalStatusText.style.fontSize = '16px';
    modalActionsArea.innerHTML = `
        <button id="alert-ok-btn" class="pixel-button"
            style="width: 150px; background-color: var(--pixel-blue);">
            確認
        </button>`;
    modalActionsArea.style.justifyContent = 'center';

    globalModalOverlay.style.display = 'flex';

    document.getElementById('alert-ok-btn').onclick = () => {
        closeGlobalModal();
        callback();
    };
}

function showCustomConfirm(title, message, onConfirm, onCancel = () => {}) {
    modalHeader.textContent = title;
    modalStatusText.textContent = message;
    modalStatusText.style.fontSize = '16px';
    modalActionsArea.innerHTML = `
        <button id="confirm-ok-btn" class="pixel-button"
            style="width: 150px; background-color: var(--pixel-green);">
            確定
        </button>
        <button id="confirm-cancel-btn" class="pixel-button"
            style="width: 150px; background-color: var(--pixel-red);">
            取消
        </button>
    `;
    modalActionsArea.style.justifyContent = 'space-around';

    globalModalOverlay.style.display = 'flex';

    document.getElementById('confirm-ok-btn').onclick = () => {
        closeGlobalModal();
        onConfirm();
    };

    document.getElementById('confirm-cancel-btn').onclick = () => {
        closeGlobalModal();
        onCancel();
    };
}

/** 對戰倒數（發送邀請者） */
function showBattleCountdown(opponentName, onTimeout) {
    modalHeader.textContent = `⚔️ 正在等待 ${opponentName} 接受對戰...`;
    modalStatusText.textContent = '5';
    modalStatusText.style.fontSize = '24px';

    modalActionsArea.innerHTML = `
        <button id="cancel-invite-btn" class="pixel-button"
            style="width: 150px; background-color: var(--pixel-red);">
            取消對戰要求
        </button>
    `;
    modalActionsArea.style.justifyContent = 'center';

    globalModalOverlay.style.display = 'flex';

    const countdownDuration = 5;
    let count = countdownDuration;
    let timer;

    document.getElementById('cancel-invite-btn').onclick = () => {
        showCustomConfirm(
            '❌ 取消確認',
            `您確定要取消對 ${opponentName} 的對戰邀請嗎？`,
            () => {
                clearInterval(timer);
                closeGlobalModal();
                showCustomAlert('訊息', '對戰要求已取消。');
                sendMessage('cancel_battle_invite', { receiver_id: targetUserId });
            }
        );
    };

    const runCountdown = () => {
        if (count > 0) {
            modalStatusText.textContent = `${count}`;
            count--;
        } else {
            clearInterval(timer);
            onTimeout();
        }
    };

    runCountdown();
    timer = setInterval(runCountdown, 1000);
    return timer;
}

/** 接受 / 拒絕邀請 Modal */
function showAcceptInvite(senderName, inviteType, senderId) {
    const headerText =
        inviteType === 'battle'
            ? `⚔️ 收到 ${senderName} 的對戰邀請！`
            : `💬 收到 ${senderName} 的通訊邀請！`;

    modalHeader.textContent = headerText;
    modalStatusText.textContent = '是否接受邀請？';
    modalStatusText.style.fontSize = '16px';

    modalActionsArea.innerHTML = `
        <button id="accept-invite-btn" class="pixel-button"
            style="width: 150px; background-color: var(--pixel-green);">
            接受
        </button>
        <button id="reject-invite-btn" class="pixel-button"
            style="width: 150px; background-color: var(--pixel-red);">
            拒絕
        </button>
    `;
    modalActionsArea.style.justifyContent = 'space-around';

    globalModalOverlay.style.display = 'flex';

    const handleRejectInvite = (name, type, id) => {
        closeGlobalModal();
        showCustomAlert('通知', `已拒絕 ${name} 的邀請。`);
        sendMessage('reject_invite', { type, sender_id: id });
    };

    modalCloseBtn.style.display = 'block';
    modalCloseBtn.onclick = () => handleRejectInvite(senderName, inviteType, senderId);

    document.getElementById('accept-invite-btn').onclick = () => {
        closeGlobalModal();
        sendMessage('accept_invite', { type: inviteType, sender_id: senderId });

        if (inviteType === 'battle') {
            localStorage.setItem('opponent_spirit_value', Math.floor(Math.random() * 100) + 1);
            localStorage.setItem('opponent_name', senderName);
            localStorage.setItem('game_mode', 'battle');
            window.location.href = 'game.html';
        } else {
            openChatWindow(senderName, senderId, true);
        }
    };

    document.getElementById('reject-invite-btn').onclick = () => {
        handleRejectInvite(senderName, inviteType, senderId);
    };
}

function openChatWindow(name, id, isAccepted) {
    targetUserId = id;
    chatHeader.innerHTML = `💬 與 ${name} 通訊中 <button id="close-chat-btn" style="float: right;">X</button>`;
    chatBox.style.display = 'flex';
    document.querySelector('#chat-box #close-chat-btn').onclick = closeChatBox;

    // 聊天框開啟時，徽章移動到聊天框上方
    commRequestBadge.style.bottom = '230px';
    commRequestBadge.style.left = '20px';

    if (isAccepted) {
        chatInputEl.disabled = false;
        chatInputEl.placeholder = '輸入訊息...';
        chatSendBtn.disabled = false;
        chatStatusMessageEl.style.display = 'none';

        chatSendBtn.onclick = () => {
            const message = chatInputEl.value;
            if (message.trim()) {
                sendMessage('chat_message', { receiver_id: id, message });
                chatInputEl.value = '';
            }
        };
    } else {
        chatInputEl.disabled = true;
        chatInputEl.placeholder = '等待對方同意中...';
        chatSendBtn.disabled = true;
        chatStatusMessageEl.style.display = 'block';
        chatStatusMessageEl.textContent = '📞 正在等待對方同意通訊...';
    }
}

function updateCommBadge() {
    requestCountEl.textContent = pendingChatRequests.length;
    commRequestBadge.style.display = pendingChatRequests.length > 0 ? 'flex' : 'none';
}

commRequestBadge.addEventListener('click', () => {
    if (pendingChatRequests.length > 0) {
        const { sender_id, sender_name } = pendingChatRequests[0];
        showAcceptInvite(sender_name, 'chat', sender_id);
        pendingChatRequests.shift();
        updateCommBadge();
    }
});

// ======================================================
// 5. 點擊寵物：彈出選項菜單
// ======================================================

function handlePetClick(e) {
    const petAvatar = e.target.closest('.pet-avatar');

    petInfoCard.style.display = 'none';
    closeChatBox();
    closeGlobalModal();

    document
        .querySelectorAll('.pet-avatar.selected')
        .forEach((el) => el.classList.remove('selected'));

    if (!petAvatar) return;

    petAvatar.classList.add('selected');

    const rect = petAvatar.getBoundingClientRect();
    const CARD_WIDTH = 180;
    petInfoCard.style.left = `${rect.left + window.scrollX + rect.width / 2 - CARD_WIDTH / 2}px`;
    petInfoCard.style.top = `${rect.top + window.scrollY - petInfoCard.offsetHeight - 10}px`;

    if (petAvatar.id === 'my-pet') {
        console.log('點擊自己，進入體力補充。');
        localStorage.setItem('game_mode', 'solo');
        localStorage.setItem('my_spirit_value', localStorage.getItem('my_spirit_value') || 85);
        window.location.href = 'game.html';
    } else {
        targetUserId = petAvatar.getAttribute('data-user-id');
        targetPetName = petAvatar.querySelector('.pet-name-tag').textContent;

        const mockSpirit = Math.floor(Math.random() * 100) + 1;
        const { statusName } = getSpiritInfo(mockSpirit);

        targetPetNameTag.textContent = targetPetName;
        targetPetStatus.textContent = `精神狀態: ${mockSpirit} (${statusName})`;
        targetPetAvatar.src = './assets/pet-lobby.png';

        localStorage.setItem('opponent_spirit_value', mockSpirit);

        petInfoCard.style.display = 'block';
    }
}

// 通訊按鈕
actionChatBtn.addEventListener('click', () => {
    petInfoCard.style.display = 'none';
    openChatWindow(targetPetName, targetUserId, false);
    sendMessage('chat_invite', { receiver_id: targetUserId });
    console.log(`向用戶 ${targetPetName} 發出通訊邀請...`);
});

// 對戰按鈕
actionBattleBtn.addEventListener('click', () => {
    petInfoCard.style.display = 'none';
    const opponentId = targetUserId;
    const opponentName = targetPetName;

    actionBattleBtn.disabled = true;
    actionChatBtn.disabled = true;

    sendMessage('battle_invite', {
        receiver_id: opponentId,
        pet_spirit: localStorage.getItem('my_spirit_value'),
    });

    const timerId = showBattleCountdown(opponentName, () => {
        closeGlobalModal();
        console.log(`用戶 ${opponentName} 未回覆對戰邀約。`);
        showCustomAlert('❌ 對戰失敗', `${opponentName} 未確認您的對戰邀約。`);
    });

    window.currentBattleTimer = timerId;

    // 測試用假資料：user_id 999 自動接受
    if (opponentId === '999') {
        setTimeout(() => {
            clearInterval(window.currentBattleTimer);
            closeGlobalModal();
            showCustomAlert('🎉 對戰成功', `與 ${opponentName} 的對戰即將開始！`, () => {
                localStorage.setItem('game_mode', 'battle');
                localStorage.setItem('opponent_id', opponentId);
                localStorage.setItem('opponent_name', opponentName);
                window.location.href = 'game.html';
            });
        }, 2000);
    }
});

// ======================================================
// 6. 鍵盤移動寵物邏輯（連續移動版本）
// ======================================================

const MOVE_SPEED = 1; // 每一幀移動量（可再調）

document.addEventListener('keydown', (e) => {
    if (globalModalOverlay.style.display === 'flex' || chatBox.style.display === 'flex') {
        return;
    }

    if (e.key in keysPressed) {
        keysPressed[e.key] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key in keysPressed) {
        keysPressed[e.key] = false;
        e.preventDefault();
    }
});

/**
 * 每一幀更新移動（按住鍵可以持續移動）
 */
function updateMovement() {
    let moved = false;
    let newDirection = 'idle';

    // 上下左右，以最後判斷的方向為主（你也可以之後做多方向合成）
    if (keysPressed.ArrowUp) {
        myWorldY -= MOVE_SPEED;
        newDirection = 'up';
        moved = true;
    }
    if (keysPressed.ArrowDown) {
        myWorldY += MOVE_SPEED;
        newDirection = 'down';
        moved = true;
    }
    if (keysPressed.ArrowLeft) {
        myWorldX -= MOVE_SPEED;
        newDirection = 'left';
        moved = true;
    }
    if (keysPressed.ArrowRight) {
        myWorldX += MOVE_SPEED;
        newDirection = 'right';
        moved = true;
    }

    if (!moved) {
        // 如果沒在動，就開計時器切回 idle 圖
        if (!moveIdleTimer) {
            moveIdleTimer = setTimeout(() => {
                setPetSprite('idle');
                moveIdleTimer = null;
            }, 150);
        }
        return;
    }

    // 有移動就清除 idle 計時器
    if (moveIdleTimer) {
        clearTimeout(moveIdleTimer);
        moveIdleTimer = null;
    }

    // 限制在世界邊界內
    myWorldX = Math.max(0, Math.min(WORLD_WIDTH, myWorldX));
    myWorldY = Math.max(0, Math.min(WORLD_HEIGHT, myWorldY));

    // 更新外觀
    setPetSprite(newDirection);

    // 同步 dataset 給其他邏輯用
    myPetEl.dataset.worldX = myWorldX;
    myPetEl.dataset.worldY = myWorldY;

    // 推動鏡頭（鏡頭最多只能到地圖邊界）
    updateCamera(myWorldX, myWorldY);

    // 更新狗在螢幕上的位置（狗可以走到螢幕邊界）
    updateMyPetScreenPosition(myWorldX, myWorldY);

    // 通知 WebSocket 位置更新
    sendMessage('update_position', { x: myWorldX, y: myWorldY });
}

/** 遊戲主迴圈：讓 updateMovement 每一幀都被呼叫 */
function gameLoop() {
    updateMovement();
    requestAnimationFrame(gameLoop);
}

// ======================================================
// 7. WebSocket 回呼
// ======================================================

function handleChatRequest(data) {
    const { sender_id, sender_name, has_history } = data;

    if (has_history) {
        showAcceptInvite(sender_name, 'chat', sender_id);
    } else {
        pendingChatRequests.push({ sender_id, sender_name });
        updateCommBadge();
        console.log(`收到來自 ${sender_name} 的通訊請求，已放入左下角徽章。`);
    }
}

function handleBattleAccepted(data) {
    if (data.sender_id === targetUserId) {
        clearInterval(window.currentBattleTimer);
        closeGlobalModal();

        showCustomAlert('🎉 對戰成功', `與 ${data.sender_name} 的對戰即將開始！`, () => {
            localStorage.setItem('game_mode', 'battle');
            localStorage.setItem('opponent_id', data.sender_id);
            localStorage.setItem('opponent_name', data.sender_name);
            window.location.href = 'game.html';
        });
    }
}

// ======================================================
// 8. 初始化大廳
// ======================================================

async function initializeLobby() {
    const token = localStorage.getItem('user_token');
    const selected_server_id = localStorage.getItem('selected_server_id');
    const myUserId = localStorage.getItem('user_id');

    if (!token || !selected_server_id || !myUserId) {
        showCustomAlert('❌ 錯誤', '登入資訊或伺服器未選擇，請重新登入！', () => {
            window.location.href = 'login.html';
        });
        return;
    }

    // 伺服器 ID -> 主題名稱
    const themeName = SERVER_THEMES[selected_server_id] || selected_server_id;

    serverIdEl.textContent = `伺服器：${themeName}`;
    lobbyTitleEl.textContent = `${themeName} - 大廳`;
    myPetImgEl.src = PET_SPRITES.idle;

    // ⭐ 用伺服器 ID 來切換對應地圖 ⭐
    applyMapByServer(selected_server_id);

    // 取得寵物狀態（從後端 API）
    try {
        // 這裡會打到 /api/pet/status?user_id=xxx
        const petData = await getPetStatus();

        // 後端回傳：
        // {
        //   pet_id,
        //   pet_name,
        //   energy,   // 0-100
        //   status,   // "SLEEPING" / "TIRED" / "ACTIVE"
        //   score
        // }

        const spiritValue = typeof petData.energy === 'number'
            ? petData.energy
            : 50; // fallback 避免 undefined

        const { statusName } = getSpiritInfo(spiritValue);

        // 顯示到畫面上
        petNameEl.textContent = `寵物名稱：${petData.pet_name || '未命名寵物'}`;
        petLevelEl.textContent = `精神狀態：${spiritValue} (${statusName})`;
        updateSpiritBadge(spiritValue);

        // 名牌顯示玩家名稱（從登入時保存的 display_name）
        const myDisplayName = localStorage.getItem('display_name') || '玩家';
        myPetNameTagEl.textContent = myDisplayName;

        // 存到 localStorage，給 game.html 使用
        localStorage.setItem('my_spirit_value', String(spiritValue));
        localStorage.setItem('my_display_name', myDisplayName);

    } catch (error) {
        console.error('無法載入寵物狀態，使用模擬資料。', error);

        const mockSpirit = 50;
        const { statusName } = getSpiritInfo(mockSpirit);

        petNameEl.textContent = `寵物名稱：Test Pet`;
        petLevelEl.textContent = `精神狀態：${mockSpirit} (${statusName})`;
        updateSpiritBadge(mockSpirit);

        myPetNameTagEl.textContent = localStorage.getItem('display_name') || '玩家';

        localStorage.setItem('my_spirit_value', String(mockSpirit));
        localStorage.setItem('my_display_name', localStorage.getItem('display_name') || '玩家');
    }

    // 初始寵物世界座標（世界中心）
    myWorldX = WORLD_WIDTH / 2;
    myWorldY = WORLD_HEIGHT / 2;
    myPetEl.dataset.worldX = myWorldX;
    myPetEl.dataset.worldY = myWorldY;

    // 先把鏡頭對準世界中心，再根據鏡頭位置擺好狗
    updateCamera(myWorldX, myWorldY);
    updateMyPetScreenPosition(myWorldX, myWorldY);

    // 綁定基本事件
    logoutBtn.addEventListener('click', () => {
        showCustomConfirm('登出確認', '您確定要登出並返回登入頁面嗎？', () => {
            localStorage.clear();
            showCustomAlert('訊息', '已登出。', () => {
                window.location.href = 'login.html';
            });
        }); 
    });

    // 返回伺服器選單
    const backServerBtn = document.getElementById('back-server-btn');
    backServerBtn.addEventListener('click', () => {
        showCustomConfirm(
            '返回伺服器選單',
            '確定要回到伺服器選擇畫面嗎？',
            () => {
                localStorage.removeItem('selected_server_id');
                window.location.href = 'server-select.html';
            }
        );
    });


    lobbyAreaEl.addEventListener('click', handlePetClick);
    closeChatBtn.onclick = closeChatBox;

    // 排行榜更新
    function handleUpdatePetList(pets) {
        if (!leaderboardListEl) return;

        leaderboardListEl.innerHTML = '';

        if (!Array.isArray(pets) || pets.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.innerHTML = `<span>目前沒有玩家資料</span><span>0 Pts</span>`;
            leaderboardListEl.appendChild(emptyItem);
            lastLeaderboardState = {};
            return;
        }

        const sortedPets = pets
            .slice()
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 3);

        const medals = ['🥇', '🥈', '🥉'];
        const newState = {};

        sortedPets.forEach((pet, index) => {
            const listItem = document.createElement('li');
            listItem.classList.add(`rank-${index + 1}`);

            const name = pet.display_name || pet.name || `玩家 ${index + 1}`;
            const score = pet.score || 0;

            const key = pet.user_id || pet.id || name;
            const prev = lastLeaderboardState[key];
            const newRank = index + 1;

            listItem.innerHTML = `
                <span>${medals[index]} ${name}</span>
                <span>${score} Pts</span>
            `;

            if (!prev) {
                listItem.classList.add('rank-new');
            } else {
                if (score > prev.score) {
                    listItem.classList.add('score-up');
                }
                if (newRank < prev.rank) {
                    listItem.classList.add('rank-up');
                } else if (newRank > prev.rank) {
                    listItem.classList.add('rank-down');
                }
            }

            listItem.addEventListener('animationend', () => {
                listItem.classList.remove('rank-new', 'score-up', 'rank-up', 'rank-down');
            });

            leaderboardListEl.appendChild(listItem);
            newState[key] = { score, rank: newRank };
        });

        lastLeaderboardState = newState;
    }

    registerCallback('update_pet_list', handleUpdatePetList);
    registerCallback('chat_request', handleChatRequest);
    registerCallback('battle_accepted', handleBattleAccepted);

    initWebSocket(token, myUserId);

    // 測試用假排行榜
    setTimeout(() => {
        handleUpdatePetList([
            { user_id: 1, display_name: '玩家甲', score: 500 },
            { user_id: 2, display_name: '玩家乙', score: 300 },
            { user_id: 3, display_name: '玩家丙', score: 100 },
        ]);
    }, 500);

    setTimeout(() => {
        handleUpdatePetList([
            { user_id: 2, display_name: '玩家乙', score: 800 },
            { user_id: 1, display_name: '玩家甲', score: 600 },
            { user_id: 3, display_name: '玩家丙', score: 150 },
        ]);
    }, 2500);

    setTimeout(() => {
        handleUpdatePetList([
            { user_id: 4, display_name: '新玩家', score: 1200 },
            { user_id: 2, display_name: '玩家乙', score: 900 },
            { user_id: 1, display_name: '玩家甲', score: 650 },
        ]);
    }, 5000);

    // 初始狀態
    modalCloseBtn.style.display = 'none';
    commRequestBadge.style.bottom = '20px';
    commRequestBadge.style.left = '20px';

    // 啟動主迴圈（連續移動）
    requestAnimationFrame(gameLoop);
}

// ======================================================
// 入口
// ======================================================
initializeLobby();
