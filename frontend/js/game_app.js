// frontend/js/game_app.js (最終 Web Socket 準備版本)

// ======================================================
// 1. DOM 元素定義
// ======================================================
const dinoPanelTitleEl = document.getElementById('dino-panel-title'); // 遊戲區塊大標題
const petStatusScreenEl = document.getElementById('pet-status-screen'); // 預設的狗狗狀態畫面
const gameIframeScreenEl = document.getElementById('game-iframe-screen'); // 遊戲本體畫面
const startGameBtn = document.getElementById('start-game-btn'); // 開始遊戲辨識按鈕
const statusBarContainerEl = document.getElementById('status-bar-container'); // 狀態條容器

// 對戰模式專用 DOM (使用修正後的 ID)
const opponentStatusEl = document.getElementById('opponent-status');
const opponentAvatarEl = document.getElementById('opponent-pet-avatar'); 
const opponentNameEl = document.getElementById('opponent-pet-name-tag'); 
const opponentScoreEl = document.getElementById('opponent-score'); 

const backToLobbyBtn = document.getElementById('back-to-lobby-btn'); 


// ======================================================
// 2. 核心狀態判斷函數 (從 lobby_app.js 複製，確保獨立性)
// ======================================================
/**
 * 根據精神狀態數值 (1-100) 獲取狀態名稱和遊戲中圖片路徑
 */
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


// ======================================================
// 3. 初始化遊戲頁面
// ======================================================

function initializeGame() {
    const gameMode = localStorage.getItem('game_mode');
    const mySpirit = localStorage.getItem('my_spirit_value');
    
    // 獲取自己寵物狀態資訊 (用於 solo 模式和基本顯示)
    const { statusName, gameImg } = getSpiritInfo(parseInt(mySpirit));

    // 更新自己寵物的狀態畫面 (左半部)
    document.getElementById('game-pet-img').src = gameImg;
    document.getElementById('game-pet-message').textContent = `精神狀態: ${mySpirit} (${statusName})，點擊下方開始補充！`;
    
    // 顯示體力條
    if(statusBarContainerEl) statusBarContainerEl.style.display = 'block';

    if (gameMode === 'battle') {
        // --- 對戰模式邏輯 ---
        const opponentName = localStorage.getItem('opponent_name');
        const opponentSpirit = localStorage.getItem('opponent_spirit_value');
        
        // 取得對手寵物圖片 (使用對手的精神狀態決定)
        const { gameImg: opponentGameImg } = getSpiritInfo(parseInt(opponentSpirit));

        // 顯示對手資訊框 (使用 flex 讓內部分割線正常顯示)
        if(opponentStatusEl) opponentStatusEl.style.display = 'flex';

        // 更新對手資訊 (頭像, 名字, 分數)
        if(opponentNameEl) opponentNameEl.textContent = opponentName || '未知對手';
        if(opponentAvatarEl) opponentAvatarEl.src = opponentGameImg;
        if(opponentScoreEl) opponentScoreEl.textContent = '分數: 0'; 
        
        // 更新標題
        if(dinoPanelTitleEl) dinoPanelTitleEl.textContent = `⚔️ 對戰模式: VS ${opponentName}`;
        
    } else if (gameMode === 'solo') {
        // --- 單人模式邏輯 (solo) ---
        if(dinoPanelTitleEl) dinoPanelTitleEl.textContent = `🏃 體力補充區`;
        // 確保對手資訊隱藏
        if(opponentStatusEl) opponentStatusEl.style.display = 'none';
    } else {
        // 錯誤或直接訪問
        console.error('遊戲模式錯誤，返回大廳。');
    }

    // 綁定開始按鈕事件
    if(startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            // 隱藏寵物狀態畫面，顯示遊戲 iFrame
            if(petStatusScreenEl) petStatusScreenEl.style.display = 'none';
            if(gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex'; // 使用 flex 讓內容居中
            startGameBtn.style.display = 'none'; // 隱藏開始按鈕

            console.log(`遊戲啟動，模式: ${gameMode}`);
        });
    }

    // 處理返回大廳按鈕
    if(backToLobbyBtn) {
        backToLobbyBtn.addEventListener('click', () => {
            window.location.href = 'lobby.html';
        });
    }
}

// ======================================================
// 腳本入口點
// ======================================================
initializeGame();