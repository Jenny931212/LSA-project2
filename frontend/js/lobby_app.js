// frontend/js/lobby_app.js

import { getPetStatus } from './api_client.js';
import { initWebSocket, sendMessage, registerCallback } from './websocket_client.js';

// 世界地圖虛擬大小
const WORLD_WIDTH = 200;
const WORLD_HEIGHT = 200;

// DOM 元素
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
const chatInputEl = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatStatusMessageEl = document.getElementById('chat-status-message');
const chatMessagesEl = document.getElementById('chat-messages'); // 新增聊天訊息區域
const globalModalOverlay = document.getElementById('global-modal-overlay');
const inviteModalBox = document.getElementById('invite-modal-box');
const modalHeader = document.getElementById('modal-header');
const modalStatusText = document.getElementById('modal-status-text');
const modalActionsArea = document.getElementById('modal-actions-area');
const commRequestBadge = document.getElementById('communication-request-badge');
const requestCountEl = document.getElementById('request-count');
const modalCloseBtn = document.getElementById('modal-close-btn');
const playerScoreEl = document.getElementById('player-score'); // 新增積分顯示

// 全域變數
let targetUserId = null;
let targetPetName = null;
let currentMyUserId = null;

// [修正] 儲存所有玩家資料以供排行榜使用
let allPlayers = {}; 

const PET_SPRITES = {
    idle: './assets/pet-lobby.png',
    up: './assets/pet-up.png',
    down: './assets/pet-down.png',
    left: './assets/pet-left.png',
    right: './assets/pet-right.png',
};

// 記錄其他玩家 DOM 與座標
const otherPets = {};

const SERVER_THEMES = { A: "🌳 汪洋草原", B: "❄️ 凍原腳印", C: "🌵 沙塵迷蹤" };

let myWorldX = WORLD_WIDTH / 2;
let myWorldY = WORLD_HEIGHT / 2;
let cameraOffsetX = 0;
let cameraOffsetY = 0;

const keysPressed = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
let moveIdleTimer = null;
let pendingChatRequests = [];

function setPetSprite(direction) {
    if (!PET_SPRITES[direction]) return;
    myPetImgEl.src = PET_SPRITES[direction];
}

function applyMapByServer(serverId) {
    const mapSrc = { A: "./assets/lobby-backgroundA.png", B: "./assets/lobby-backgroundB.png", C: "./assets/lobby-backgroundC.png" };
    if (mapSrc[serverId]) worldLayerEl.style.backgroundImage = `url('${mapSrc[serverId]}')`;
}

// [修正重點] 更新鏡頭時，必須強制更新所有其他玩家的螢幕位置
function updateCamera(worldX, worldY) {
    const lobbyRect = lobbyAreaEl.getBoundingClientRect();
    // ⭕ 確保不會是 0，至少用大廳的大小當 fallback
    const worldWidth =
        worldLayerEl.scrollWidth ||
        worldLayerEl.offsetWidth ||
        lobbyRect.width ||
        1;
    const worldHeight =
        worldLayerEl.scrollHeight ||
        worldLayerEl.offsetHeight ||
        lobbyRect.height ||
        1;

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

    // 鏡頭動了，必須迴圈更新每一個人的 DOM 位置
    Object.keys(otherPets).forEach(uid => {
        const pet = otherPets[uid];
        updateOtherPetScreenPosition(pet.el, pet.x, pet.y);
    });
}

function updateMyPetScreenPosition(worldX, worldY) {
    const lobbyRect = lobbyAreaEl.getBoundingClientRect();
    const worldWidth =
        worldLayerEl.scrollWidth ||
        worldLayerEl.offsetWidth ||
        lobbyRect.width ||
        1;
    const worldHeight =
        worldLayerEl.scrollHeight ||
        worldLayerEl.offsetHeight ||
        lobbyRect.height ||
        1;
    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;
    const screenX = worldPX - cameraOffsetX;
    const screenY = worldPY - cameraOffsetY;
    const petWidth = myPetEl.offsetWidth || 96;
    const petHeight = myPetEl.offsetHeight || 110;
    myPetEl.style.left = `${screenX - petWidth / 2}px`;
    myPetEl.style.top = `${screenY - petHeight}px`;
}

function updateOtherPetScreenPosition(petEl, worldX, worldY) {
    const lobbyRect = lobbyAreaEl.getBoundingClientRect();
    const worldWidth =
        worldLayerEl.scrollWidth ||
        worldLayerEl.offsetWidth ||
        lobbyRect.width ||
        1;
    const worldHeight =
        worldLayerEl.scrollHeight ||
        worldLayerEl.offsetHeight ||
        lobbyRect.height ||
        1;
    const worldPX = (worldX / WORLD_WIDTH) * worldWidth;
    const worldPY = (worldY / WORLD_HEIGHT) * worldHeight;
    // 使用當前的 cameraOffsetX, cameraOffsetY
    const screenX = worldPX - cameraOffsetX;
    const screenY = worldPY - cameraOffsetY;
    const petWidth = petEl.offsetWidth || 96;
    const petHeight = petEl.offsetHeight || 110;
    petEl.style.left = `${screenX - petWidth / 2}px`;
    petEl.style.top = `${screenY - petHeight}px`;
}

function getSpiritInfo(spirit) {
    if (spirit >= 71) return { statusName: '飽滿', gameImg: './assets/pet-active.png' };
    if (spirit >= 31) return { statusName: '休息中', gameImg: './assets/pet-resting.png' };
    return { statusName: '疲憊', gameImg: './assets/pet-tired.png' };
}

function updateSpiritBadge(spirit) {
    petLevelEl.classList.remove('spirit-full', 'spirit-medium', 'spirit-low');
    if (spirit >= 71) petLevelEl.classList.add('spirit-full');
    else if (spirit >= 31) petLevelEl.classList.add('spirit-medium');
    else petLevelEl.classList.add('spirit-low');
}

// UI 輔助函式
function closeChatBox() { chatBox.style.display = 'none'; commRequestBadge.style.bottom = '20px'; commRequestBadge.style.left = '20px'; }
function closeGlobalModal() { globalModalOverlay.style.display = 'none'; actionBattleBtn.disabled = false; actionChatBtn.disabled = false; modalStatusText.style.fontSize = '24px'; modalActionsArea.style.justifyContent = 'space-around'; modalCloseBtn.onclick = null; modalCloseBtn.style.display = 'none'; }
function showCustomAlert(title, message, callback = () => {}) { modalHeader.textContent = title; modalStatusText.textContent = message; modalStatusText.style.fontSize = '16px'; modalActionsArea.innerHTML = `<button id="alert-ok-btn" class="pixel-button" style="width: 150px; background-color: var(--pixel-blue);">確認</button>`; modalActionsArea.style.justifyContent = 'center'; globalModalOverlay.style.display = 'flex'; document.getElementById('alert-ok-btn').onclick = () => { closeGlobalModal(); callback(); }; }
function showCustomConfirm(title, message, onConfirm, onCancel = () => {}) { modalHeader.textContent = title; modalStatusText.textContent = message; modalStatusText.style.fontSize = '16px'; modalActionsArea.innerHTML = `<button id="confirm-ok-btn" class="pixel-button" style="width: 150px; background-color: var(--pixel-green);">確定</button><button id="confirm-cancel-btn" class="pixel-button" style="width: 150px; background-color: var(--pixel-red);">取消</button>`; modalActionsArea.style.justifyContent = 'space-around'; globalModalOverlay.style.display = 'flex'; document.getElementById('confirm-ok-btn').onclick = () => { closeGlobalModal(); onConfirm(); }; document.getElementById('confirm-cancel-btn').onclick = () => { closeGlobalModal(); onCancel(); }; }

function showBattleCountdown(opponentName, onTimeout) { 
    modalHeader.textContent = `⚔️ 正在等待 ${opponentName} 接受對戰...`;
    modalStatusText.textContent = '5';
    modalStatusText.style.fontSize = '24px';
    modalActionsArea.innerHTML = `<button id="cancel-invite-btn" class="pixel-button" style="width: 150px; background-color: var(--pixel-red);">取消對戰要求</button>`;
    modalActionsArea.style.justifyContent = 'center';
    globalModalOverlay.style.display = 'flex';
    let count = 5;
    const timer = setInterval(() => {
        if (count > 0) { modalStatusText.textContent = `${count}`; count--; }
        else { clearInterval(timer); onTimeout(); }
    }, 1000);
    document.getElementById('cancel-invite-btn').onclick = () => {
        showCustomConfirm('❌ 取消確認', `您確定要取消對 ${opponentName} 的對戰邀請嗎？`, () => {
            clearInterval(timer); closeGlobalModal(); showCustomAlert('訊息', '對戰要求已取消。');
            // 注意：這裡應該發送取消邀請的訊息，但後端 wsA_main.py 沒有實作這個 type，
            // 由於這是 UI 取消，我們暫時只在前端處理，避免後端報錯。
            // sendMessage('battle_invite_cancel', { to_user_id: targetUserId }); 
        });
    };
    return timer;
}

function showAcceptInvite(senderName, inviteType, senderId) {
    // 檢查目標是否仍在線上
    if (!allPlayers[senderId]) {
        showCustomAlert('訊息', `來自 ${senderName} 的邀請已過期，對方已離線。`);
        return;
    }

    modalHeader.textContent = inviteType === 'battle' ? `⚔️ 收到 ${senderName} 的對戰邀請！` : `💬 收到 ${senderName} 的通訊邀請！`;
    modalStatusText.textContent = '是否接受邀請？'; modalStatusText.style.fontSize = '16px';
    modalActionsArea.innerHTML = `<button id="accept-invite-btn" class="pixel-button" style="width: 150px; background-color: var(--pixel-green);">接受</button><button id="reject-invite-btn" class="pixel-button" style="width: 150px; background-color: var(--pixel-red);">拒絕</button>`;
    modalActionsArea.style.justifyContent = 'space-around'; globalModalOverlay.style.display = 'flex';
    modalCloseBtn.style.display = 'block'; 
    modalCloseBtn.onclick = () => { closeGlobalModal(); sendMessage(`${inviteType}_reject`, { from_user_id: senderId }); }; // 發送拒絕

    document.getElementById('accept-invite-btn').onclick = () => {
        closeGlobalModal(); 
        if (inviteType === 'battle') {
            sendMessage('battle_accept', { from_user_id: senderId });
            // 等待 battle_start 訊息，不直接跳轉
            showCustomAlert('訊息', '已接受對戰邀請，等待伺服器準備戰局...');
        } else {
            sendMessage('chat_request_accept', { from_user_id: senderId });
            // 立即開啟聊天室，狀態為已同意
            const displayName = allPlayers[senderId] ? allPlayers[senderId].display_name : senderName;
            openChatWindow(displayName, senderId, true); 
        }
    };

    document.getElementById('reject-invite-btn').onclick = () => { 
        closeGlobalModal(); 
        sendMessage(`${inviteType}_reject`, { from_user_id: senderId }); // 發送拒絕
    };
}

function openChatWindow(name, id, isAccepted) {
    targetUserId = id; 
    chatHeader.innerHTML = `💬 與 ${name} 通訊中 <button id="close-chat-btn" style="float: right;">X</button>`; 
    chatBox.style.display = 'flex';
    chatMessagesEl.innerHTML = ''; // 清空聊天記錄
    
    document.querySelector('#chat-box #close-chat-btn').onclick = closeChatBox; 
    commRequestBadge.style.bottom = '230px'; 
    commRequestBadge.style.left = '20px';
    
    if (isAccepted) { 
        chatInputEl.disabled = false; 
        chatInputEl.placeholder = '輸入訊息...'; 
        chatSendBtn.disabled = false; 
        chatStatusMessageEl.style.display = 'none'; 
        chatSendBtn.onclick = () => { 
            const content = chatInputEl.value; 
            if (content.trim()) { 
                // 發送 chat_message，注意後端參數是 to_user_id
                sendMessage('chat_message', { to_user_id: id, content: content }); 
                chatInputEl.value = ''; 
            } 
        }; 
    } else { 
        chatInputEl.disabled = true; 
        chatInputEl.placeholder = '等待對方同意中...'; 
        chatSendBtn.disabled = true; 
        chatStatusMessageEl.style.display = 'block'; 
        chatStatusMessageEl.textContent = '📞 正在等待對方同意通訊...'; 
        chatSendBtn.onclick = null;
    }
}

function addChatMessage(fromId, toId, content) {
    const isMine = fromId === currentMyUserId;
    const fromPlayer = allPlayers[fromId];
    const fromName = fromPlayer ? fromPlayer.display_name : (isMine ? '我' : '對方');

    const messageEl = document.createElement('div');
    messageEl.classList.add('chat-message', isMine ? 'mine' : 'other');
    messageEl.innerHTML = `
        <span class="chat-name">${fromName}:</span>
        <span class="chat-content">${content}</span>
    `;
    chatMessagesEl.appendChild(messageEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}


function updateCommBadge() { requestCountEl.textContent = pendingChatRequests.length; commRequestBadge.style.display = pendingChatRequests.length > 0 ? 'flex' : 'none'; }
commRequestBadge.addEventListener('click', () => { 
    if (pendingChatRequests.length > 0) { 
        const request = pendingChatRequests.shift();
        const senderName = allPlayers[request.sender_id] ? allPlayers[request.sender_id].display_name : `玩家 ${request.sender_id}`;
        showAcceptInvite(senderName, 'chat', request.sender_id); 
        updateCommBadge(); 
    } 
});

function getOrCreateOtherPet(userId, displayName, initialX, initialY) {
    if (otherPets[userId]) {
        otherPets[userId].display_name = displayName;
        otherPets[userId].el.querySelector('.pet-name-tag').textContent = displayName;
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
    otherPets[userId] = { el: wrapper, x: initialX, y: initialY, display_name: displayName };
    return wrapper;
}

function handlePetClick(e) {
    const petAvatar = e.target.closest('.pet-avatar');

    // 先收掉各種浮動 UI
    petInfoCard.style.display = 'none';
    closeChatBox();
    closeGlobalModal();

    // 取消其他已選取的寵物高亮
    document.querySelectorAll('.pet-avatar.selected')
        .forEach((el) => el.classList.remove('selected'));

    if (!petAvatar) return;

    petAvatar.classList.add('selected');

    // 計算資訊卡位置（只在點別人時會真的顯示）
    const rect = petAvatar.getBoundingClientRect();
    const CARD_WIDTH = 180;
    petInfoCard.style.left = `${rect.left + window.scrollX + rect.width / 2 - CARD_WIDTH / 2}px`;
    petInfoCard.style.top = `${rect.top + window.scrollY - petInfoCard.offsetHeight - 10}px`;

    // 透過 data-user-id 判斷這隻狗屬於誰，沒有的話視為自己
    const clickedUserIdAttr = petAvatar.getAttribute('data-user-id');
    const clickedUserId = clickedUserIdAttr
        ? Number(clickedUserIdAttr)
        : currentMyUserId;

    const playerState = allPlayers[clickedUserId] || {};

    // 判斷是不是自己（兩種條件都支援，避免 HTML / JS 任一邊改動）
    const isSelf =
        clickedUserId === currentMyUserId ||
        petAvatar.id === 'my-pet';

    if (isSelf) {
        // ✅ 點擊自己：進入單人遊戲補體力
        console.log('點擊自己，進入體力補充。');

        // 優先用伺服器同步下來的 energy，沒有就用 localStorage 或預設 85
        const myEnergy = typeof playerState.energy === 'number'
            ? playerState.energy
            : Number(localStorage.getItem('my_spirit_value') || 85);

        localStorage.setItem('game_mode', 'solo');
        localStorage.setItem('my_spirit_value', String(myEnergy));

        window.location.href = 'game.html';
        return;
    }

    // ===== 點擊其他玩家 =====
    targetUserId = clickedUserId;
    targetPetName = playerState.display_name || `玩家 ${targetUserId}`;

    const spiritValue = playerState.energy || 50;
    const scoreValue = playerState.score || 0;
    const { statusName } = getSpiritInfo(spiritValue);

    targetPetNameTag.textContent = targetPetName;
    targetPetStatus.innerHTML =
        `精神狀態: ${spiritValue} (${statusName})<br>積分: ${scoreValue} Pts`;
    targetPetAvatar.src = PET_SPRITES.idle; // 之後可依 pet_id 換圖

    // 檢查自己體力是否能聊天 / 對戰
    const myEnergy = Number(localStorage.getItem('my_spirit_value') || 50);
    actionBattleBtn.disabled = myEnergy < 70;
    actionChatBtn.disabled = myEnergy <= 30;

    petInfoCard.style.display = 'block';
}

actionChatBtn.addEventListener('click', () => { 
    petInfoCard.style.display = 'none'; 
    openChatWindow(targetPetName, targetUserId, false); 
    // 發送 chat_request，注意後端參數是 to_user_id
    sendMessage('chat_request', { to_user_id: targetUserId }); 
});

actionBattleBtn.addEventListener('click', () => { 
    petInfoCard.style.display = 'none'; 
    // 發送 battle_invite，注意後端參數是 to_user_id
    sendMessage('battle_invite', { to_user_id: targetUserId }); 
    window.currentBattleTimer = showBattleCountdown(targetPetName, () => { 
        closeGlobalModal(); 
        showCustomAlert('❌ 對戰失敗', `${targetPetName} 未確認您的對戰邀約。`); 
    }); 
});

const MOVE_SPEED = 1;
document.addEventListener('keydown', (e) => { 
    if (globalModalOverlay.style.display === 'flex' || chatBox.style.display === 'flex') return; 
    if (e.key in keysPressed) { keysPressed[e.key] = true; e.preventDefault(); } 
});
document.addEventListener('keyup', (e) => { 
    if (e.key in keysPressed) { keysPressed[e.key] = false; e.preventDefault(); } 
});

function updateMovement() {
    let moved = false; let newDirection = 'idle';
    if (keysPressed.ArrowUp) { myWorldY -= MOVE_SPEED; newDirection = 'up'; moved = true; }
    if (keysPressed.ArrowDown) { myWorldY += MOVE_SPEED; newDirection = 'down'; moved = true; }
    if (keysPressed.ArrowLeft) { myWorldX -= MOVE_SPEED; newDirection = 'left'; moved = true; }
    if (keysPressed.ArrowRight) { myWorldX += MOVE_SPEED; newDirection = 'right'; moved = true; }
    
    if (!moved) { 
        if (!moveIdleTimer) moveIdleTimer = setTimeout(() => { setPetSprite('idle'); moveIdleTimer = null; }, 150); 
        return; 
    }
    
    if (moveIdleTimer) { clearTimeout(moveIdleTimer); moveIdleTimer = null; }
    
    myWorldX = Math.max(0, Math.min(WORLD_WIDTH, myWorldX)); 
    myWorldY = Math.max(0, Math.min(WORLD_HEIGHT, myWorldY));
    
    setPetSprite(newDirection);
    myPetEl.dataset.worldX = myWorldX; 
    myPetEl.dataset.worldY = myWorldY;
    
    updateCamera(myWorldX, myWorldY);
    updateMyPetScreenPosition(myWorldX, myWorldY);
    
    // [修正] 傳送座標訊息
    sendMessage('update_position', { x: myWorldX, y: myWorldY });
}
function gameLoop() { updateMovement(); requestAnimationFrame(gameLoop); }

// [修正] 恢復排行榜邏輯
function updateLeaderboard() {
    if (!leaderboardListEl) return;
    leaderboardListEl.innerHTML = '';
    
    // 轉成 Array 並排序，依據 score 降序
    const sortedPlayers = Object.values(allPlayers)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5); // 取前5名

    if (sortedPlayers.length === 0) {
        leaderboardListEl.innerHTML = '<li>尚無資料</li>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    sortedPlayers.forEach((p, idx) => {
        const li = document.createElement('li');
        if (idx < 3) li.classList.add(`rank-${idx + 1}`);
        li.innerHTML = `
            <span>${medals[idx] || (idx + 1 + '.')} ${p.display_name}</span>
            <span>${p.score || 0} Pts</span>
        `;
        leaderboardListEl.appendChild(li);
    });
}

function handleLobbyState(msg) {
    const myId = currentMyUserId;
    const players = msg.payload.players || [];

    // 1. 更新 allPlayers & 自己的狀態 / 積分
    allPlayers = {};
        players.forEach((p) => {
        allPlayers[p.user_id] = p;

        if (p.user_id === myId) {
            // 先拿伺服器的 energy
            const backendEnergy = (typeof p.energy === 'number') ? p.energy : 50;

            // 再看 localStorage 是否有比較新的 my_spirit_value
            const localSpiritRaw = localStorage.getItem('my_spirit_value');
            let localSpirit = Number(localSpiritRaw);
            if (Number.isNaN(localSpirit)) {
                localSpirit = null;
            }

            // 如果 local 有值而且比後端大 → 視為剛剛 solo 遊戲補到的體力
            const energy =
                (localSpirit !== null && localSpirit > backendEnergy)
                    ? localSpirit
                    : backendEnergy;

            const { statusName } = getSpiritInfo(energy);

            // 同步到 localStorage & UI
            localStorage.setItem('my_spirit_value', String(energy));
            petLevelEl.textContent = `狀態：${energy} (${statusName})`;
            updateSpiritBadge(energy);

            if (playerScoreEl) {
                playerScoreEl.textContent = `積分：${p.score || 0} Pts`;
            }

            // 也更新 allPlayers 裡自己的 energy，避免後面再被舊值覆蓋
            allPlayers[myId].energy = energy;
        }
    });

    updateLeaderboard();

    // 2. 用「伺服器的座標」決定「我自己的世界座標 & 鏡頭」
    const me = players.find(p => p.user_id === myId);
    if (me) {
        myWorldX = Number(me.x ?? WORLD_WIDTH / 2);
        myWorldY = Number(me.y ?? WORLD_HEIGHT / 2);

        myPetEl.dataset.worldX = myWorldX;
        myPetEl.dataset.worldY = myWorldY;

        updateCamera(myWorldX, myWorldY);
        updateMyPetScreenPosition(myWorldX, myWorldY);
    }

    // 3. 清掉已下線的寵物
    const onlineUserIds = new Set(players.map(p => p.user_id));
    Object.keys(otherPets).forEach((uid) => {
        if (!onlineUserIds.has(Number(uid))) {
            otherPets[uid].el.remove();
            delete otherPets[uid];
        }
    });

    // 4. 依伺服器給的座標，畫出「其他玩家」的位置
    players.forEach((p) => {
        const uid = Number(p.user_id);
        if (!uid || uid === myId) return;

        const worldX = Number(p.x ?? WORLD_WIDTH / 2);
        const worldY = Number(p.y ?? WORLD_HEIGHT / 2);

        const petEl = getOrCreateOtherPet(uid, p.display_name, worldX, worldY);
        otherPets[uid].x = worldX;
        otherPets[uid].y = worldY;

        updateOtherPetScreenPosition(petEl, worldX, worldY);
    });

    // 🚫 不要再用舊的這段「dataset.worldX/worldY 再校正一次」
    //    因為我們已經在上面用伺服器座標做過了
    // if (myPetEl.dataset.worldX && myPetEl.dataset.worldY) {
    //     updateCamera(Number(myPetEl.dataset.worldX), Number(myPetEl.dataset.worldY));
    //     updateMyPetScreenPosition(Number(myPetEl.dataset.worldX), Number(myPetEl.dataset.worldY));
    // }
}

function handlePlayerJoined(msg) {
    const myId = currentMyUserId;
    const player = msg.payload.player;
    const uid = Number(player.user_id);
    
    allPlayers[uid] = player;
    updateLeaderboard();

    if (!uid || uid === myId) return;

    const px = (typeof player.x === 'number' && !Number.isNaN(player.x))
        ? player.x
        : WORLD_WIDTH / 2;
    const py = (typeof player.y === 'number' && !Number.isNaN(player.y))
        ? player.y
        : WORLD_HEIGHT / 2;

    const petEl = getOrCreateOtherPet(uid, player.display_name, px, py);
    otherPets[uid].x = px;
    otherPets[uid].y = py;
    updateOtherPetScreenPosition(petEl, px, py);
}

function handlePlayerLeft(msg) {
    const uid = Number(msg.user_id);
    if (uid === currentMyUserId) return;
    
    // 從 allPlayers 和 otherPets 移除
    delete allPlayers[uid];
    if (otherPets[uid]) {
        otherPets[uid].el.remove();
        delete otherPets[uid];
    }
    updateLeaderboard();
    if (targetUserId === uid) {
        petInfoCard.style.display = 'none';
        closeChatBox();
    }
}

function handlePetStateUpdate(msg) {
    const player = msg.payload.player;
    const uid = Number(player.user_id);

    // 更新 allPlayers
    allPlayers[uid] = { ...allPlayers[uid], ...player };
    updateLeaderboard();

    if (uid === currentMyUserId) {
        // 更新自己的狀態
        localStorage.setItem('my_spirit_value', String(player.energy || 50));
        const { statusName } = getSpiritInfo(player.energy || 50);
        petLevelEl.textContent = `狀態：${player.energy || 50} (${statusName})`;
        updateSpiritBadge(player.energy || 50);
        if (playerScoreEl) playerScoreEl.textContent = `積分：${player.score || 0} Pts`;

    } else {
        // 更新目標玩家狀態卡片（如果正在顯示）
        if (targetUserId === uid && petInfoCard.style.display === 'block') {
            const { statusName } = getSpiritInfo(player.energy || 50);
            targetPetStatus.innerHTML = `精神狀態: ${player.energy || 50} (${statusName})<br>積分: ${player.score || 0} Pts`;
        }
    }
}

function handleOtherPetMoved(msg) {
    const player = msg.payload.player;
    const uid = Number(player.user_id);
    if (uid === currentMyUserId) return;

    const px = (typeof player.x === 'number' && !Number.isNaN(player.x))
        ? player.x
        : (allPlayers[uid]?.x ?? WORLD_WIDTH / 2);
    const py = (typeof player.y === 'number' && !Number.isNaN(player.y))
        ? player.y
        : (allPlayers[uid]?.y ?? WORLD_HEIGHT / 2);

    if (allPlayers[uid]) {
        allPlayers[uid].x = px;
        allPlayers[uid].y = py;
    }

    const name = allPlayers[uid] ? allPlayers[uid].display_name : `Player${uid}`;
    const petEl = getOrCreateOtherPet(uid, name, px, py);
    otherPets[uid].x = px;
    otherPets[uid].y = py;
    updateOtherPetScreenPosition(petEl, px, py);
}

// 聊天與對戰回呼

function handleChatRequest(msg) { 
    const senderId = msg.user_id;
    const senderName = allPlayers[senderId] ? allPlayers[senderId].display_name : `玩家 ${senderId}`;

    // 這裡我們不檢查 has_history，一律用 pending 處理
    pendingChatRequests.push({ sender_id: senderId, sender_name: senderName }); 
    updateCommBadge(); 
    
    // 如果聊天視窗是開著的，但目標不是我，則跳出提醒
    if (chatBox.style.display === 'flex' && targetUserId !== senderId) {
        showCustomAlert('通訊提醒', `${senderName} 想要跟你通訊！`);
    }
}

function handleChatApproved(msg) {
    const user1 = Number(msg.payload.user_id_1);
    const user2 = Number(msg.payload.user_id_2);
    const approvedId = user1 === currentMyUserId ? user2 : user1;
    const approvedName = allPlayers[approvedId] ? allPlayers[approvedId].display_name : `玩家 ${approvedId}`;

    if (targetUserId === approvedId) {
        // 如果是目標，開啟或更新聊天室為已同意狀態
        openChatWindow(approvedName, approvedId, true);
        showCustomAlert('通訊成功', `您現在可以與 ${approvedName} 聊天了！`);
    } else if (approvedId !== currentMyUserId) {
        // 提醒其他情況下的同意
        showCustomAlert('通訊成功', `${approvedName} 已同意您的通訊邀請！`);
    }
}

function handleChatMessage(msg) {
    const fromId = msg.payload.from_user_id;
    const toId = msg.payload.to_user_id;
    
    // 判斷是否是我正在聊天的對象
    if (fromId === targetUserId || toId === targetUserId) {
        addChatMessage(fromId, toId, msg.payload.content);
        // 如果聊天視窗是關閉的，開啟它
        if (chatBox.style.display !== 'flex') {
            const chatName = allPlayers[fromId] ? allPlayers[fromId].display_name : `玩家 ${fromId}`;
            openChatWindow(chatName, fromId, true);
        }
    }
}

function handleChatNotAllowed(msg) {
    closeChatBox();
    showCustomAlert('通訊失敗', msg.payload.message);
}

function handleBattleInvite(msg) {
    const senderId = msg.user_id;
    const senderName = allPlayers[senderId] ? allPlayers[senderId].display_name : `玩家 ${senderId}`;
    showAcceptInvite(senderName, 'battle', senderId);
}

function handleBattleNotAllowed(msg) {
    clearInterval(window.currentBattleTimer);
    closeGlobalModal();
    showCustomAlert('對戰失敗', msg.payload.message);
}

function handleBattleStart(msg) {
    clearInterval(window.currentBattleTimer);
    closeGlobalModal();

    const { battle_id, player1_id, player2_id } = msg.payload;
    const opponentId = player1_id === currentMyUserId ? player2_id : player1_id;
    const opponentName = allPlayers[opponentId]
        ? allPlayers[opponentId].display_name
        : `玩家 ${opponentId}`;

    showCustomAlert(
        '🎉 對戰開始',
        `與 ${opponentName} 的對戰準備中！\n請點擊「確認」開始準備。`,
        () => {
            // ✅ 不要直接跳 game.html，只告訴伺服器「我準備好了」
            sendMessage('battle_ready', { battle_id });
            console.log('[WS] 已送出 battle_ready', battle_id);
        }
    );
}

function handleBattleGo(msg) {
    const { battle_id, player1_id, player2_id } = msg.payload;
    const opponentId = player1_id === currentMyUserId ? player2_id : player1_id;
    const opponentName = allPlayers[opponentId]
        ? allPlayers[opponentId].display_name
        : `玩家 ${opponentId}`;

    console.log('[WS] 收到 battle_go，雙方都準備好了，開始跳轉遊戲畫面');

    // ✅ 這裡才真正設定模式 & 跳轉
    localStorage.setItem('game_mode', 'battle');
    localStorage.setItem('current_battle_id', battle_id);
    localStorage.setItem('opponent_id', opponentId);
    localStorage.setItem('opponent_name', opponentName);

    window.location.href = 'game.html';
}


function handleBattleResult(msg) {
    // 戰鬥結果的處理通常在 game.html，但在 lobby 收到可能是對方斷線
    // 這裡只做提示
    const { winner_user_id, player1_score, player2_score, player1_id, player2_id } = msg.payload;
    const opponentId = player1_id === currentMyUserId ? player2_id : player1_id;
    const opponentName = allPlayers[opponentId] ? allPlayers[opponentId].display_name : `玩家 ${opponentId}`;
    
    closeGlobalModal(); // 關閉所有可能的對戰邀請/等待中 Modal

    if (winner_user_id === currentMyUserId) {
        showCustomAlert('恭喜！', `您贏了與 ${opponentName} 的對戰！`);
    } else if (winner_user_id === opponentId) {
        showCustomAlert('可惜！', `您輸了與 ${opponentName} 的對戰！`);
    } else {
        // 可能是平手或無結果
        showCustomAlert('對戰結束', `與 ${opponentName} 的對戰已結束。`);
    }

    // 重新載入寵物狀態，以取得更新後的積分
    setTimeout(initializeLobby, 1000); 
}



// 初始化邏輯
async function initializeLobby() {
    const token = localStorage.getItem('user_token');
    const selected_server_id = localStorage.getItem('selected_server_id');
    const myUserIdRaw = localStorage.getItem('user_id');

    if (!token || !selected_server_id || !myUserIdRaw) {
        showCustomAlert('❌ 錯誤', '請重新登入！', () => { window.location.href = 'login.html'; });
        return;
    }
    currentMyUserId = Number(myUserIdRaw);
    serverIdEl.textContent = `伺服器：${selected_server_id}`;
    lobbyTitleEl.textContent = `${SERVER_THEMES[selected_server_id]} - 大廳`;
    myPetImgEl.src = PET_SPRITES.idle;
    applyMapByServer(selected_server_id);

    let myPetData = {};
    try {
        // 從 API 取得初始資料 (含 score)
        myPetData = await getPetStatus(currentMyUserId);

        // 1️⃣ 後端回來的體力（當作「基準值」）
        const backendSpirit = (typeof myPetData.energy === 'number') ? myPetData.energy : 50;
        const scoreValue = myPetData.score || 0;

        // 2️⃣ 看 localStorage 有沒有「更新的 my_spirit_value」
        const localSpiritRaw = localStorage.getItem('my_spirit_value');
        let localSpirit = Number(localSpiritRaw);
        if (Number.isNaN(localSpirit)) {
            localSpirit = null;
        }

        // 3️⃣ 決定真正要顯示的精神值：
        //    - 如果 local 有值 & 比後端大，代表剛剛在 game.html 有補到體力，就用 local
        //    - 否則用後端的數值（例如剛打完對戰，後端已經更新 DB）
        const spiritValue =
            (localSpirit !== null && localSpirit > backendSpirit)
                ? localSpirit
                : backendSpirit;

        const { statusName } = getSpiritInfo(spiritValue);
        
        petNameEl.textContent = `寵物：${myPetData.pet_name}`;
        petLevelEl.textContent = `狀態：${spiritValue} (${statusName})`;
        updateSpiritBadge(spiritValue);
        myPetNameTagEl.textContent = localStorage.getItem('display_name') || '我';
        
        // 顯示自己的分數
        if (playerScoreEl) {
            playerScoreEl.textContent = `積分：${scoreValue} Pts`;
        }

        // 4️⃣ 把最後決定的 spiritValue 寫回 localStorage
        localStorage.setItem('my_spirit_value', String(spiritValue));

        // 5️⃣ 讓要傳給 WebSocket 的初始資料也帶這個最新的體力值
        myPetData.energy = spiritValue;
        myPetData.score = scoreValue; 
        myPetData.display_name = localStorage.getItem('display_name');

    } catch (error) {
        console.error('API Error', error);
        myPetData = {
            display_name: localStorage.getItem('display_name') || `Player${currentMyUserId}`,
            pet_name: "MyPet",
            energy: 100,
            score: 0
        };
    }

    // 初始化位置
    myWorldX = WORLD_WIDTH / 2;
    myWorldY = WORLD_HEIGHT / 2;
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

    // ★★ 關鍵：把初始座標塞進 myPetData，等一下要送給 WebSocket
    myPetData.x = myWorldX;
    myPetData.y = myWorldY;

    // 註冊 WebSocket 回呼
    registerCallback('lobby_state', handleLobbyState);
    registerCallback('player_joined', handlePlayerJoined);
    registerCallback('player_left', handlePlayerLeft);
    registerCallback('pet_state_update', handlePetStateUpdate);
    registerCallback('other_pet_moved', handleOtherPetMoved);
    registerCallback('chat_request', handleChatRequest);
    registerCallback('chat_approved', handleChatApproved);
    registerCallback('chat_message', handleChatMessage);
    registerCallback('chat_not_allowed', handleChatNotAllowed);
    registerCallback('battle_invite', handleBattleInvite);
    registerCallback('battle_not_allowed', handleBattleNotAllowed);
    registerCallback('battle_start', handleBattleStart);
    registerCallback('battle_go', handleBattleGo); 
    registerCallback('battle_result', handleBattleResult);
    

    // [修正] 將包含 score 的完整 petData 傳給 init
    initWebSocket(token, currentMyUserId, myPetData);

    // 啟動遊戲迴圈
    modalCloseBtn.style.display = 'none';
    commRequestBadge.style.bottom = '20px';
    commRequestBadge.style.left = '20px';
    requestAnimationFrame(gameLoop);
}

initializeLobby();
