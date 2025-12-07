// frontend/js/lobby_app.js
// ======================================================
// [修改說明]
// 1. 新增全域變數 currentMyUserId 來鎖定身分，解決同瀏覽器多開導致的身分錯亂問題。
// 2. 所有 WebSocket 回呼函式改用 currentMyUserId 進行判斷。
// ======================================================

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

// [修改] 新增這個變數，用來鎖定目前登入的 User ID
let currentMyUserId = null;

const PET_SPRITES = {
    idle: './assets/pet-lobby.png',
    up: './assets/pet-up.png',
    down: './assets/pet-down.png',
    left: './assets/pet-left.png',
    right: './assets/pet-right.png',
};

// 記錄其他玩家的寵物 DOM： { userId: { el, state } }
const otherPets = {};

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
 */
function updateCamera(worldX, worldY) {
    const lobbyRect = lobbyAreaEl.getBoundingClientRect();

    const worldWidth = worldLayerEl.scrollWidth || worldLayerEl.offsetWidth;
    const worldHeight = worldLayerEl.scrollHeight || worldLayerEl.offsetHeight;

    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;

    let idealOffsetX = worldPX - lobbyRect.width / 2;
    let idealOffsetY = worldPY - lobbyRect.height / 2;

    const maxOffsetX = Math.max(0, worldWidth - lobbyRect.width);
    const maxOffsetY = Math.max(0, worldHeight - lobbyRect.height);

    const finalOffsetX = Math.min(Math.max(0, idealOffsetX), maxOffsetX);
    const finalOffsetY = Math.min(Math.max(0, idealOffsetY), maxOffsetY);

    cameraOffsetX = finalOffsetX;
    cameraOffsetY = finalOffsetY;

    worldLayerEl.style.transform = `translate(${-finalOffsetX}px, ${-finalOffsetY}px)`;
}

/**
 * 根據世界座標 + 鏡頭偏移，計算我方寵物在畫面上的位置
 */
function updateMyPetScreenPosition(worldX, worldY) {
    const worldWidth = worldLayerEl.scrollWidth || worldLayerEl.offsetWidth;
    const worldHeight = worldLayerEl.scrollHeight || worldLayerEl.offsetHeight;

    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;

    const screenX = worldPX - cameraOffsetX;
    const screenY = worldPY - cameraOffsetY;

    const petWidth = myPetEl.offsetWidth || 96;
    const petHeight = myPetEl.offsetHeight || 110;

    myPetEl.style.left = `${screenX - petWidth / 2}px`;
    myPetEl.style.top = `${screenY - petHeight}px`;
}

// ⭐ 其他玩家的寵物：根據世界座標 + 鏡頭偏移，計算畫面位置
function updateOtherPetScreenPosition(petEl, worldX, worldY) {
    const worldWidth = worldLayerEl.scrollWidth || worldLayerEl.offsetWidth;
    const worldHeight = worldLayerEl.scrollHeight || worldLayerEl.offsetHeight;

    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;

    const screenX = worldPX - cameraOffsetX;
    const screenY = worldPY - cameraOffsetY;

    const petWidth = petEl.offsetWidth || 96;
    const petHeight = petEl.offsetHeight || 110;

    petEl.style.left = `${screenX - petWidth / 2}px`;
    petEl.style.top = `${screenY - petHeight}px`;
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

// ⭐ 取得或建立「其他玩家的寵物」DOM
function getOrCreateOtherPet(userId, displayName) {
    if (otherPets[userId]) {
        return otherPets[userId].el;
    }

    const wrapper = document.createElement('div');
    wrapper.classList.add('pet-avatar', 'other-pet');
    wrapper.dataset.userId = String(userId);

    const img = document.createElement('img');
    img.src = PET_SPRITES.idle;
    img.classList.add('pet-img');

    const nameTag = document.createElement('div');
    nameTag.classList.add('pet-name-tag');
    nameTag.textContent = displayName || `玩家 ${userId}`;

    wrapper.appendChild(img);
    wrapper.appendChild(nameTag);

    wrapper.addEventListener('click', handlePetClick);

    worldLayerEl.appendChild(wrapper);

    otherPets[userId] = {
        el: wrapper,
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT / 2,
        display_name: displayName || `玩家 ${userId}`,
    };

    return wrapper;
}

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
        showCustomAlert('❌ 對戰失敗', `${opponentName} 未確認您的對戰邀約。`);
    });

    window.currentBattleTimer = timerId;
});

// ======================================================
// 6. 鍵盤移動寵物邏輯（連續移動版本）
// ======================================================

const MOVE_SPEED = 1;

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

function updateMovement() {
    let moved = false;
    let newDirection = 'idle';

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
        if (!moveIdleTimer) {
            moveIdleTimer = setTimeout(() => {
                setPetSprite('idle');
                moveIdleTimer = null;
            }, 150);
        }
        return;
    }

    if (moveIdleTimer) {
        clearTimeout(moveIdleTimer);
        moveIdleTimer = null;
    }

    myWorldX = Math.max(0, Math.min(WORLD_WIDTH, myWorldX));
    myWorldY = Math.max(0, Math.min(WORLD_HEIGHT, myWorldY));

    setPetSprite(newDirection);

    myPetEl.dataset.worldX = myWorldX;
    myPetEl.dataset.worldY = myWorldY;

    updateCamera(myWorldX, myWorldY);
    updateMyPetScreenPosition(myWorldX, myWorldY);

    sendMessage('update_position', { x: myWorldX, y: myWorldY });
}

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

// [修改] 收到「整個大廳狀態」，使用 currentMyUserId 過濾
function handleLobbyState(messageOrPayload) {
    const myId = currentMyUserId; // 使用鎖定的 ID

    const payload = messageOrPayload.payload || messageOrPayload;
    const players = payload.players || [];

    players.forEach((p) => {
        const uid = Number(p.user_id);
        if (!uid || uid === myId) return;

        const petEl = getOrCreateOtherPet(uid, p.display_name);
        otherPets[uid].x = Number(p.x || WORLD_WIDTH / 2);
        otherPets[uid].y = Number(p.y || WORLD_HEIGHT / 2);

        updateOtherPetScreenPosition(petEl, otherPets[uid].x, otherPets[uid].y);
    });
}

// [修改] 有新玩家加入，使用 currentMyUserId 過濾
function handlePlayerJoined(messageOrPayload) {
    const myId = currentMyUserId; // 使用鎖定的 ID
    const payload = messageOrPayload.payload || messageOrPayload;
    const player = payload.player || payload;

    const uid = Number(player.user_id);
    if (!uid || uid === myId) return;

    const petEl = getOrCreateOtherPet(uid, player.display_name);
    otherPets[uid].x = Number(player.x || WORLD_WIDTH / 2);
    otherPets[uid].y = Number(player.y || WORLD_HEIGHT / 2);

    updateOtherPetScreenPosition(petEl, otherPets[uid].x, otherPets[uid].y);
}

// [修改] 收到其他玩家移動，使用 currentMyUserId 過濾
function handleOtherPetMoved(messageOrPayload) {
    const payload = messageOrPayload.payload || messageOrPayload;
    const player = payload.player || payload;

    const myId = currentMyUserId; // 使用鎖定的 ID
    const uid = Number(player.user_id);

    if (!uid || uid === myId) {
        return;
    }

    const x = Number(player.x);
    const y = Number(player.y);
    if (Number.isNaN(x) || Number.isNaN(y)) {
        return;
    }

    const petEl = getOrCreateOtherPet(uid, player.display_name);
    otherPets[uid].x = x;
    otherPets[uid].y = y;

    updateOtherPetScreenPosition(petEl, x, y);
}

// ======================================================
// 8. 初始化大廳
// ======================================================

async function initializeLobby() {
    const token = localStorage.getItem('user_token');
    const selected_server_id = localStorage.getItem('selected_server_id');
    const myUserIdRaw = localStorage.getItem('user_id');

    if (!token || !selected_server_id || !myUserIdRaw) {
        showCustomAlert('❌ 錯誤', '登入資訊或伺服器未選擇，請重新登入！', () => {
            window.location.href = 'login.html';
        });
        return;
    }

    // [修改] 鎖定當前 User ID，避免 localStorage 後續被汙染
    currentMyUserId = Number(myUserIdRaw);

    const themeName = SERVER_THEMES[selected_server_id] || selected_server_id;

    serverIdEl.textContent = `伺服器：${themeName}`;
    lobbyTitleEl.textContent = `${themeName} - 大廳`;
    myPetImgEl.src = PET_SPRITES.idle;

    applyMapByServer(selected_server_id);

    try {
        const petData = await getPetStatus(currentMyUserId); // 傳入 ID

        const spiritValue = typeof petData.energy === 'number'
            ? petData.energy
            : 50;

        const { statusName } = getSpiritInfo(spiritValue);

        petNameEl.textContent = `寵物名稱：${petData.pet_name || '未命名寵物'}`;
        petLevelEl.textContent = `精神狀態：${spiritValue} (${statusName})`;
        updateSpiritBadge(spiritValue);

        const myDisplayName = localStorage.getItem('display_name') || '玩家';
        myPetNameTagEl.textContent = myDisplayName;

        localStorage.setItem('my_spirit_value', String(spiritValue));
        localStorage.setItem('my_display_name', myDisplayName);

    } catch (error) {
        console.error('無法載入寵物狀態，使用模擬資料。', error);
        
        // 即使失敗也要顯示預設
        myPetNameTagEl.textContent = localStorage.getItem('display_name') || '玩家';
    }

    // 初始化我的位置 (與 WebSocket 傳送的值保持一致)
    myWorldX = WORLD_WIDTH / 2; // 100
    myWorldY = WORLD_HEIGHT / 2; // 100
    myPetEl.dataset.worldX = myWorldX;
    myPetEl.dataset.worldY = myWorldY;

    updateCamera(myWorldX, myWorldY);
    updateMyPetScreenPosition(myWorldX, myWorldY);

    logoutBtn.addEventListener('click', () => {
        showCustomConfirm('登出確認', '您確定要登出並返回登入頁面嗎？', () => {
            localStorage.clear();
            showCustomAlert('訊息', '已登出。', () => {
                window.location.href = 'login.html';
            });
        });
    });

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

    function handleUpdatePetList(pets) {
        // ... (排行榜邏輯暫略，保持原樣即可)
    }

    // ===== WebSocket 事件註冊 =====
    registerCallback('chat_request', handleChatRequest);
    registerCallback('battle_accepted', handleBattleAccepted);

    registerCallback('lobby_state', handleLobbyState);
    registerCallback('player_joined', handlePlayerJoined);
    registerCallback('other_pet_moved', handleOtherPetMoved);

    // [修改] 啟動 WebSocket，傳入已鎖定的 ID
    initWebSocket(token, currentMyUserId);

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
