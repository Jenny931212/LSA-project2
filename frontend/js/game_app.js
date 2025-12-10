// frontend/js/game_app.js (最終 Web Socket 準備版本 - 點擊遊戲邏輯)

import { getPetStatus } from './api_client.js';
import { sendMessage } from './websocket_client.js';
import { 
    handleKeyboardInput, 
    startDinoGame, 
    stopDinoGame,
    jumpByExternalInput,
    duckByExternalInput,
    setBirdsEnabled,
    setGameSpeedScale
} from './dino_game.js';

import { 
    initPoseDetector, 
    startPoseLoop, 
    stopPoseLoop 
} from './webcam_pose.js';

// ======================================================
// 1. DOM 元素定義
// ======================================================
const dinoPanelTitleEl = document.getElementById('dino-panel-title'); // 遊戲區塊大標題
const petStatusScreenEl = document.getElementById('pet-status-screen'); // 預設的狗狗狀態畫面
const gameIframeScreenEl = document.getElementById('game-iframe-screen'); // 遊戲本體畫面容器
const startGameBtn = document.getElementById('start-game-btn'); // 開始遊戲辨識按鈕
const startButtonWrapperEl = document.getElementById('start-button-wrapper'); // 開始按鈕的容器 (用於隱藏/顯示)
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');
const gameTitleEl = document.getElementById('game-title');


// 左邊鏡頭 / 狗狗預覽區
const rpiCamBoxEl = document.getElementById('rpi-cam-box');
const rpiCamLabelEl = document.getElementById('rpi-cam-label');
const dogPreviewImgEl = document.getElementById('dog-preview');
const rpiVideoEl = document.getElementById('webcam-video');  // ⭐ 新增：鏡頭 video

// 鍵盤模式下，是否開啟預覽狗狗
let keyboardPreviewActive = false;


// 新增的模式選擇相關 DOM
const modeSelectScreenEl = document.getElementById('mode-select-screen'); // 模式選擇畫面
const rpiModeBtn = document.getElementById('rpi-mode-btn'); // 樹莓派模式按鈕
const keyboardModeBtn = document.getElementById('keyboard-mode-btn'); // 鍵盤模式按鈕

// ⭐ PK 倒數圈圈
const battleCountdownEl = document.getElementById('battle-mode-countdown');
const battleCountdownTextEl = document.getElementById('battle-mode-countdown-text');

// 新增狀態變數
let inputMode = ''; // 'rpi' 或 'keyboard'
let isGameActive = false; // 追蹤遊戲是否在運行 (避免重複綁定/解綁)
let webcamStream = null;   // 儲存 getUserMedia 拿到的 stream


// ⭐ PK 模式：選擇操作方式倒數用
let battleModeSelectTimer = null;
let battleModeCountdownInterval = null;
const BATTLE_MODE_SELECT_SECONDS = 5;

// ⭐ FIX 1: 更改為正確的狀態顯示元素 ID
const playerStatusEl = document.getElementById('player-status');

// 我的狀態 
const mySpiritValueEl = document.getElementById('my-spirit-value'); 
const myScoreValueEl = document.getElementById('my-score-value');
const gamePetImgEl = document.getElementById('game-pet-img'); // 狀態畫面的寵物圖
const gamePetMessageEl = document.getElementById('game-pet-message'); // 狀態畫面的訊息

// 對戰模式專用 DOM 
const opponentStatusEl = document.getElementById('opponent-status');
const opponentNameEl = document.getElementById('opponent-pet-name-tag');
const opponentScoreEl = document.getElementById('opponent-score'); 
const opponentAvatarEl = document.getElementById('opponent-pet-avatar'); 

// 新增的遊戲 Canvas 元素
const canvas = document.getElementById('game-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const gamePromptEl = document.getElementById('game-prompt');

// ======================================================
// 2. 遊戲狀態變數
// ======================================================
let gameMode = ''; 
let mySpirit = 0;
let initialSpirit = 0;
let myGameScore = 0;
let opponentScore = 0;

// ✅ 改成累積時間（秒），從 0 開始往上加
let elapsedTime = 0;

let gameRunning = false;
let gameInterval = null;

function handlePreviewKeyDown(event) {
    if (!keyboardPreviewActive || !dogPreviewImgEl) return;

    if (event.key === ' ' || event.key === 'ArrowUp') {
        // 跳躍
        dogPreviewImgEl.src = './assets/pet-jump.png';
    } else if (event.key === 'ArrowDown') {
        // 蹲下
        dogPreviewImgEl.src = './assets/pet-duck.png';
    }
}

function handlePreviewKeyUp(event) {
    if (!keyboardPreviewActive || !dogPreviewImgEl) return;

    // 放開 上 / 空白 / 下 的時候，回到跑步姿勢
    if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        dogPreviewImgEl.src = './assets/pet-run.png';
    }
}


// ======================================================
// 3. 核心狀態判斷函數 (FIX 6: 調整分數區間)
// ======================================================

/**
 * 根據精神狀態數值 (1-100) 獲取狀態名稱和遊戲中圖片路徑
 * 0-30: pet-tired, 31-70: pet-resting, 71-100: pet-active
 */
function getSpiritInfo(spirit) {
    let statusName = '';
    let statusImg = '';
    let statusClass = '';

    if (spirit >= 71) { // 71-100
        statusName = '飽滿 💪';
        statusImg = './assets/pet-active.png'; 
        statusClass = 'spirit-full';
    } else if (spirit >= 31) { // 31-70
        statusName = '普通 😐';
        statusImg = './assets/pet-resting.png';
        statusClass = 'spirit-medium';
    } else { // 0-30
        statusName = '低落 😞';
        statusImg = './assets/pet-tired.png';
        statusClass = 'spirit-low';
    }
    return { statusName, statusImg, statusClass };
}

// ======================================================
// 4. 遊戲核心邏輯
// ======================================================

/** 繪製遊戲畫面 (Canvas) */
function drawGame() {
    if (!ctx) return;

    ctx.save();

    // 左上角：時間
    ctx.fillStyle = 'white';
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`時間: ${elapsedTime}s`, 10, 25);

    // 左上角第二行：自己的分數（特別是 PK 模式要清楚看到）
    ctx.fillStyle = 'yellow';
    ctx.fillText(`我的分數: ${myGameScore}`, 10, 50);

    ctx.restore();

    // 提示文字（下面那一行）
    if (gamePromptEl) {
        if (gameMode === 'battle') {
            gamePromptEl.textContent =
                `PK 模式｜躲避障礙物與鳥，活越久、得分越高！目前時間: ${elapsedTime}s`;
        } else {
            gamePromptEl.textContent =
                `躲避障礙物與鳥，活越久越難！目前時間: ${elapsedTime}s`;
        }
    }

    // 對方的分數繼續交給右側對戰資訊框顯示
    if (gameMode === 'battle') {
        if (opponentScoreEl) {
            opponentScoreEl.textContent = `分數: ${opponentScore}`;
        }
    }
}


/** 遊戲計時器迴圈 (無變動) */
function gameTimerLoop() {
    if (!gameRunning) return;
    elapsedTime++;    // 存活時間 +1 秒
    drawGame();       // 更新畫面上的時間顯示（不會結束遊戲）
}

/** 開始遊戲 (無變動) */
function startGame() {
    if (petStatusScreenEl) petStatusScreenEl.style.display = 'none';
    if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex'; 
    if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';

    myGameScore = 0;
    elapsedTime = 0;          // ⭐ 從 0 秒開始計算存活時間
    gameRunning = true;
    
    drawGame();
    gameInterval = setInterval(gameTimerLoop, 1000);  // 每秒更新一次時間
}

/** 遊戲結束邏輯 (FIX 3, 4, 5, 7) */
function endGame() {
    gameRunning = false;
    
    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }

    let finalMessage = '點數結算中...';
    let newSpirit = initialSpirit; 
    
    const SCORE_COLOR = '#cc0066'; 
    const SPIRIT_COLOR = '#006400'; 
    const WIN_COLOR = '#006400'; 
    const LOSE_COLOR = '#8b0000'; 
    
    let finalPetImg = getSpiritInfo(initialSpirit).statusImg;

    stopDinoGame();

    // 處理 SOLO 模式的體力結算
    if (gameMode === 'solo') {
        const spiritGained = Math.floor(myGameScore / 100);
        newSpirit = Math.min(100, initialSpirit + spiritGained);
        
        // FIX 3: 確保結算文字置中
        finalMessage = `
            <div style="font-size: 1.2em; line-height: 1.8; text-align: center;">
                🎉 訓練完成！<br>
                您獲得 <span id="animated-score-value" style="font-weight: bold; color: ${SCORE_COLOR}; font-size: 1.8em;">0</span> 分，換算成體力值為 ${spiritGained} 點。<br>
                <hr style="border-top: 2px solid var(--pixel-black); width: 80%; margin: 15px auto;">
                您現在的體力值為: 
                <span id="animated-spirit-value" style="font-weight: bold; color: ${SPIRIT_COLOR}; font-size: 1.8em;">
                    ${Math.floor(initialSpirit)}/100 
                </span>
            </div>
        `; 
        
        // FIX 6: 根據新體力值更新圖片
        finalPetImg = getSpiritInfo(newSpirit).statusImg;
        
    } 
    
    // 處理 BATTLE 模式的結果顯示
    else if (gameMode === 'battle') {
        // ⭐ 1. 先自己本地算一次結果（讓你看畫面）
        let resultText;
        if (myGameScore > opponentScore) {
            resultText = `<span style="color: ${WIN_COLOR};">🏆 獲勝！</span>`;
            finalPetImg = './assets/pet-win.png'; 
        } else if (myGameScore < opponentScore) {
            resultText = `<span style="color: ${LOSE_COLOR};">😭 敗北！</span>`;
            finalPetImg = './assets/pet-lose.png'; 
        } else {
            resultText = '🤝 平手。';
            finalPetImg = './assets/pet-resting.png'; 
        }

        finalMessage = `
            <div style="font-size: 1.2em; line-height: 1.8; text-align: center;">
                ⚔️ 對戰結束！<br>
                您的得分：<span id="animated-score-value" style="font-weight: bold; color: ${SCORE_COLOR}; font-size: 1.8em;">0</span><br>
                對手得分：${opponentScore}<br>
                <hr style="border-top: 2px solid var(--pixel-black); width: 80%; margin: 15px auto;">
                最終結果：${resultText}
            </div>
        `;

        // ⭐ 2. 正式把這場戰鬥的結果送給 wsA
        const battleId = localStorage.getItem('current_battle_id');
        if (battleId) {
            sendMessage('battle_result', {
                battle_id: battleId,
                score: myGameScore   // 把自己的最終分數送出去
            });
        }

        if (opponentStatusEl) {
             opponentStatusEl.style.display = 'none';
        }
    }


    // 顯示遊戲狀態畫面和結算訊息 (變為字卡)
    if(petStatusScreenEl) {
        petStatusScreenEl.classList.add('pixel-border-box');
        petStatusScreenEl.style.backgroundColor = '#fff9c4'; 
        petStatusScreenEl.style.boxShadow = '8px 8px 0 var(--pixel-dark-blue)'; 
        petStatusScreenEl.style.color = 'var(--pixel-black)'; 
        petStatusScreenEl.style.padding = '25px'; 
        
        // ⭐ FIX 4: 讓字卡充滿空間並垂直置中
        petStatusScreenEl.style.flexGrow = '1';
        petStatusScreenEl.style.width = '100%';
        petStatusScreenEl.style.display = 'flex';
        petStatusScreenEl.style.flexDirection = 'column';
        petStatusScreenEl.style.justifyContent = 'center';
        petStatusScreenEl.style.alignItems = 'center'; // 水平置中 (新增)

        if(gamePetMessageEl) {
             gamePetMessageEl.style.color = 'var(--pixel-black)'; 
             gamePetMessageEl.style.textAlign = 'center'; // FIX 3: 確保訊息容器本身也置中
             gamePetMessageEl.innerHTML = finalMessage;
        }
    }
    if(petStatusScreenEl) petStatusScreenEl.style.display = 'flex'; // 使用 flex 佈局
    if(gameIframeScreenEl) gameIframeScreenEl.style.display = 'none';
    
    // 更新寵物圖片
    if(gamePetImgEl) {
        gamePetImgEl.src = finalPetImg; 
        gamePetImgEl.style.marginBottom = '5px';
    }
    
    // 動畫啟動 (分數)
    const animatedScoreEl = document.getElementById('animated-score-value');
    if (animatedScoreEl) {
        animateCounter(0, myGameScore, animatedScoreEl, null, null, false);
    }
    
    if (gameMode === 'solo') {
        const animatedSpiritEl = document.getElementById('animated-spirit-value');
        if (animatedSpiritEl) {
            animateCounter(initialSpirit, newSpirit, animatedSpiritEl, playerStatusEl, newSpirit, true);
        } else {
            localStorage.setItem('my_spirit_value', newSpirit);
            if(playerStatusEl) playerStatusEl.textContent = `精神狀態: ${Math.floor(newSpirit)}/100`;
        }
    }

    // 確保結束時移除鍵盤監聽
    if (isGameActive && inputMode === 'keyboard') {
        document.removeEventListener('keydown', handleKeyboardInput);
        document.removeEventListener('keyup', handleKeyboardInput); 
        isGameActive = false;
    }

    // ⭐ 鍵盤模式時，也要關閉狗狗預覽的鍵盤監聽
    if (keyboardPreviewActive) {
        document.removeEventListener('keydown', handlePreviewKeyDown);
        document.removeEventListener('keyup', handlePreviewKeyUp);
        keyboardPreviewActive = false;
    }

    // ⭐ 鏡頭模式：結束時要關閉姿態偵測與攝影機
    if (inputMode === 'rpi') {
        stopPoseLoop();
        if (webcamStream) {
            webcamStream.getTracks().forEach(t => t.stop());
            webcamStream = null;
        }
    }

    // 按鈕邏輯 (FIX 5: 將按鈕移動到字卡內)
    if(startGameBtn) {
        startGameBtn.style.display = 'block'; 
        startGameBtn.textContent = '返回大廳'; 
        
        // 確保按鈕本身沒有監聽 startGame
        startGameBtn.removeEventListener('click', startGame);
        startGameBtn.addEventListener('click', () => window.location.href = 'lobby.html');
        
        // 創建一個新的置中容器，將按鈕放入並附加到字卡中
        const buttonWrapper = document.createElement('div');
        buttonWrapper.style.textAlign = 'center';
        buttonWrapper.style.marginTop = '20px';
        buttonWrapper.appendChild(startGameBtn);
        
        if (petStatusScreenEl) {
            // 確保按鈕在訊息下方
            petStatusScreenEl.appendChild(buttonWrapper); 
        }
    }
}

/** 體力值動畫更新 (FIX 6: 根據精神狀態更新圖片) */
function animateCounter(startValue, endValue, targetEl, headerEl = null, finalValue = null, isSpirit = false) {
    // ... (rest of function logic) ...
    const duration = 1500; // 1.5 秒動畫
    const stepTime = 16; 
    const steps = duration / stepTime;
    const increment = (endValue - startValue) / steps;
    let currentValue = startValue;
    let stepCount = 0;
    
    const petImgEl = document.getElementById('game-pet-img'); 
    let lastSpiritStatus = -1; // 用於避免重複更換圖片

    const interval = setInterval(() => {
        stepCount++;
        
        if (stepCount >= steps) {
            clearInterval(interval);
            currentValue = endValue; // 確保數值精確
        } else {
            currentValue += increment;
        }
        
        const displayValue = Math.floor(currentValue);

        if (isSpirit) {
            // SOLO 模式: 體力值顯示 (X/100 格式)
            targetEl.textContent = `${displayValue}/100`;
            if(headerEl) headerEl.textContent = `精神狀態: ${displayValue}/100`; // FIX 1: 右上角同步更新

            // ⭐ FIX 6: 根據 'displayValue' (體力值) 獲取狀態並更新圖片
            const currentStatus = getSpiritInfo(displayValue).statusClass;
            if (currentStatus !== lastSpiritStatus) {
                const { statusImg } = getSpiritInfo(displayValue); 
                if(petImgEl) petImgEl.src = statusImg;
                lastSpiritStatus = currentStatus;
            }

            if (stepCount >= steps) {
                 if (finalValue !== null) {
                     localStorage.setItem('my_spirit_value', finalValue);
                 }
            }
        } else {
            // BATTLE/SOLO 模式: 分數顯示 (單純數值)
            targetEl.textContent = displayValue;
        }

    }, stepTime);
}

/** 倒數計時並啟動遊戲 (FIX 8) */
function startBattleCountdown() {
    let count = 5;
    
    // 隱藏寵物狀態畫面和按鈕，顯示遊戲畫面
    if(petStatusScreenEl) petStatusScreenEl.style.display = 'none';
    if(gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex'; 
    if(startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';
    
    // 顯示倒數提示
    if(gamePromptEl) {
         gamePromptEl.style.display = 'block';
         gamePromptEl.style.fontSize = '3em';
    }
    
    const countdownInterval = setInterval(() => {
        if (count > 0) {
            if(gamePromptEl) gamePromptEl.textContent = `戰鬥將於 ${count} 秒後開始...`;
            count--;
        } else {
            clearInterval(countdownInterval);
            if(gamePromptEl) gamePromptEl.style.display = 'none'; 
            startGame(); // 啟動遊戲核心邏輯
        }
    }, 1000);
}

/** 顯示模式選擇畫面 (Solo 模式專用) */
function showModeSelection() {
    if(petStatusScreenEl) petStatusScreenEl.style.display = 'none';
    if(startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';
    
    // 顯示模式選擇畫面
    if(modeSelectScreenEl) modeSelectScreenEl.style.display = 'flex'; 
}

function clearBattleModeCountdown() {
    if (battleModeSelectTimer) {
        clearTimeout(battleModeSelectTimer);
        battleModeSelectTimer = null;
    }
    if (battleModeCountdownInterval) {
        clearInterval(battleModeCountdownInterval);
        battleModeCountdownInterval = null;
    }
    if (battleCountdownEl) {
        battleCountdownEl.style.display = 'none';
    }
}


/** 啟動 Solo 模式遊戲 (根據選擇的輸入方式) */
async function startSoloGame(mode) {
    inputMode = mode;

    if (mode === 'rpi') {
        // RPi 模式：沒有鳥，速度用原本 1.0（但因為姿態偵測影響，其實會體感更慢）
        setBirdsEnabled(false);
        setGameSpeedScale(1.0);
    } else {
        // 鍵盤模式：開鳥，但整體速度放慢，例如 0.7（你覺得還太快可以改 0.6、0.5）
        setBirdsEnabled(true);
        setGameSpeedScale(0.7);
    }
    
    // 隱藏模式選擇畫面
    if (modeSelectScreenEl) modeSelectScreenEl.style.display = 'none';

    // 先關掉「鍵盤預覽狗狗」監聽
    keyboardPreviewActive = false;
    document.removeEventListener('keydown', handlePreviewKeyDown);
    document.removeEventListener('keyup', handlePreviewKeyUp);

    if (mode === 'rpi') {
        // ⭐ 鏡頭模式：左邊顯示鏡頭，隱藏狗狗 preview
        if (rpiCamBoxEl) rpiCamBoxEl.classList.remove('keyboard-preview-bg');
        if (rpiCamLabelEl) rpiCamLabelEl.style.display = 'block';
        if (dogPreviewImgEl) dogPreviewImgEl.style.display = 'none';

        // 右邊先顯示「準備中」畫面，不要馬上開始遊戲
        if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex';
        if (canvas) canvas.style.display = 'block';
        if (gamePromptEl) {
            gamePromptEl.style.display = 'block';
            gamePromptEl.style.fontSize = '1.1em';
            gamePromptEl.textContent = '鏡頭與偵測模型初始化中，請稍候…';
        }

        // ⭐⭐ 關鍵：先等鏡頭 + MoveNet 準備好
        const ok = await startWebcamControl();
        if (!ok) {
            // 初始化失敗，顯示錯誤並退回
            if (gamePromptEl) {
                gamePromptEl.textContent = '鏡頭初始化失敗，請檢查權限或重新整理頁面。';
            }
            return;
        }

        // ✅ 到這裡代表鏡頭與姿態偵測都 ready 才開始遊戲
        if (gamePromptEl) {
            gamePromptEl.style.display = 'none';
        }

        // 啟動計時 + Dino 遊戲
        startGame();
        startDinoGame();

        if (dinoPanelTitleEl) {
            dinoPanelTitleEl.textContent = '🏃 鏡頭模式：運動控制小恐龍';
        }

    } else if (mode === 'keyboard') {
        // ⭐ 鍵盤模式：左邊顯示狗狗預覽，隱藏鏡頭文字
        if (rpiCamLabelEl) rpiCamLabelEl.style.display = 'none';
        if (rpiCamBoxEl)  rpiCamBoxEl.classList.add('keyboard-preview-bg');

        // ⭐ 關閉鏡頭 video，不要那個黑框
        if (rpiVideoEl) {
            rpiVideoEl.style.display = 'none';
        }
        
        if (dogPreviewImgEl) {
            dogPreviewImgEl.style.display = 'block';
            dogPreviewImgEl.src = './assets/pet-run.png';
        }

        if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex';
        if (canvas) canvas.style.display = 'block';
        if (gamePromptEl) gamePromptEl.style.display = 'none';

        // 1. 開始計時
        startGame();

        // 2. 綁 Dino 遊戲鍵盤
        if (!isGameActive) {
            document.addEventListener('keydown', handleKeyboardInput);
            document.addEventListener('keyup', handleKeyboardInput);
            isGameActive = true;
        }

        // 3. 啟動 Dino 遊戲
        startDinoGame();

        // 4. 左邊狗狗預覽綁鍵盤
        keyboardPreviewActive = true;
        document.addEventListener('keydown', handlePreviewKeyDown);
        document.addEventListener('keyup', handlePreviewKeyUp);

        if (dinoPanelTitleEl) {
            dinoPanelTitleEl.textContent = '🎮 鍵盤模式: 挑戰小恐龍';
        }
    }
}



async function startWebcamControl() {
    const videoEl = document.getElementById('webcam-video');
    const labelEl = document.getElementById('rpi-cam-label');

    if (!videoEl) {
        console.error("找不到 #webcam-video");
        return false;
    }

    try {
        // 1. 取得攝影機畫面
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcamStream = stream;
        videoEl.srcObject = stream;
        await videoEl.play();

        if (labelEl) {
            labelEl.textContent = '鏡頭運作中：跳 = Dino 跳，蹲 = Dino 蹲';
        }

        // 2. 初始化 MoveNet
        await initPoseDetector(videoEl);

        // 3. 開始持續偵測，偵測到動作就控制小恐龍
        startPoseLoop(
            () => jumpByExternalInput(),
            () => duckByExternalInput()
        );

        console.log("✅ 鏡頭 + 姿態偵測準備完成");
        return true;

    } catch (err) {
        console.error("啟動攝影機或姿態偵測失敗：", err);
        if (labelEl) {
            labelEl.textContent = '❌ 無法開啟攝影機，請檢查權限或裝置。';
        }
        return false;
    }
}



/** 
 * PK 模式：依據選擇的操作方式啟動遊戲
 * - mode: 'rpi' 或 'keyboard'
 * - 沒選的情況會在外面傳進來 'keyboard' 當預設
 */
function startBattleWithMode(mode) {
    // 先把倒數相關的東西收掉
    clearBattleModeCountdown();

    // 記住玩家選了什麼模式
    inputMode = mode;

    // 對戰模式下共用 solo 的啟動邏輯（裡面會呼叫 startGame / startDinoGame）
    startSoloGame(mode);

    // 針對 PK 模式微調標題
    if (gameMode === 'battle') {
        if (mode === 'keyboard' && dinoPanelTitleEl) {
            dinoPanelTitleEl.textContent = '⚔️ 對戰模式：小恐龍對決（鍵盤）';
        }
        if (mode === 'rpi' && dinoPanelTitleEl) {
            dinoPanelTitleEl.textContent = '⚔️ 對戰模式：樹莓派運動偵測';
        }
    }
}

// ======================================================
// 5. 初始化與事件綁定
// ======================================================

// 讓其他模組可以訪問分數和繪圖
window.game_state = {
    getScore: () => myGameScore,
    addScore: (points) => {
        myGameScore += points;
    },
    drawGame: drawGame, // 暴露繪圖函數
    isRunning: () => gameRunning, // 暴露遊戲運行狀態
    getGameMode: () => gameMode, // 暴露遊戲模式
    sendBattleUpdate: (score) => {
        if (gameMode === 'battle') {
            const battleId = localStorage.getItem('current_battle_id');
            if (!battleId) return;

            // ⭐ 告訴 wsA：這場對戰正在進行中，並同步我的當前分數
            sendMessage('battle_update', {
                battle_id: battleId,
                score: score,
                state: 'running'
            });
        }
    },

    // ⭐ 新增 forceEnd 函數，用於碰撞時強制結束
    forceEnd: () => {
        if (gameRunning) {
            clearInterval(gameInterval); // 停止計時器
            endGame(); // 呼叫結算邏輯
        }
    }
};

function initGameSetup() {
    // startSoloGame
    gameMode = localStorage.getItem('game_mode');
    mySpirit = Number(localStorage.getItem('my_spirit_value')) || 50;
    initialSpirit = mySpirit;
    const myDisplayName = localStorage.getItem('my_display_name') || '我';
    
    // 1. 更新右上角狀態欄 (FIX 1)
    if(playerStatusEl) playerStatusEl.textContent = `精神狀態: ${Math.floor(mySpirit)}/100`;

    // 2. 更新寵物初始圖片 (FIX 6)
    const { statusImg } = getSpiritInfo(mySpirit);
    if(gamePetImgEl) gamePetImgEl.src = statusImg;

    // 確保在遊戲開始前，字卡樣式被移除，並設定為深色背景下的白色文字
    if(petStatusScreenEl) {
        petStatusScreenEl.classList.remove('pixel-border-box');
        petStatusScreenEl.style.backgroundColor = 'transparent';
        petStatusScreenEl.style.boxShadow = 'none';
        petStatusScreenEl.style.color = 'white'; 
        petStatusScreenEl.style.padding = '20px'; 
        // 重設 FIX 3/4 的樣式
        petStatusScreenEl.style.flexGrow = '0'; 
        petStatusScreenEl.style.display = 'block'; // 恢復默認
    }
    if(gamePetMessageEl) {
        gamePetMessageEl.style.color = 'white'; 
    }

    if (gameMode === 'battle') {
        // --- 對戰模式邏輯 (battle) ---
        const opponentName = localStorage.getItem('opponent_name') || '對手';
        const opponentSpirit = Number(localStorage.getItem('opponent_spirit_value')) || 50;
        const { statusImg: opponentStatusImg } = getSpiritInfo(opponentSpirit);

        if (dinoPanelTitleEl) dinoPanelTitleEl.textContent = `⚔️ 對戰模式: VS ${opponentName}`;
        if (opponentStatusEl) opponentStatusEl.style.display = 'flex';

        if (opponentNameEl) opponentNameEl.textContent = opponentName;
        if (opponentScoreEl) opponentScoreEl.textContent = '分數: 0';
        if (opponentAvatarEl) opponentAvatarEl.src = opponentStatusImg;

        if (gamePetMessageEl) {
            gamePetMessageEl.textContent = '請在 5 秒內選擇遊玩模式，未選擇將預設為鍵盤模式。';
        }

        // 隱藏原本的開始按鈕，改用模式選擇
        if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';
        if (petStatusScreenEl) petStatusScreenEl.style.display = 'none';

        // 顯示模式選擇畫面
        if (modeSelectScreenEl) modeSelectScreenEl.style.display = 'flex';

        // 顯示圓形倒數標籤，從 5 開始
        if (battleCountdownEl && battleCountdownTextEl) {
            let remain = BATTLE_MODE_SELECT_SECONDS;
            battleCountdownTextEl.textContent = remain.toString();
            battleCountdownEl.style.display = 'flex';

            battleModeCountdownInterval = setInterval(() => {
                remain -= 1;
                if (remain >= 0 && battleCountdownTextEl) {
                    battleCountdownTextEl.textContent = remain.toString();
                }
                if (remain <= 0) {
                    clearInterval(battleModeCountdownInterval);
                    battleModeCountdownInterval = null;
                }
            }, 1000);
        }

        // 綁定兩個模式按鈕（PK 版）
        if (rpiModeBtn) {
            rpiModeBtn.onclick = () => startBattleWithMode('rpi');
        }
        if (keyboardModeBtn) {
            keyboardModeBtn.onclick = () => startBattleWithMode('keyboard');
        }

        // 5 秒內沒選，就預設鍵盤
        battleModeSelectTimer = setTimeout(() => {
            if (!inputMode) {
                startBattleWithMode('keyboard');
            }
        }, BATTLE_MODE_SELECT_SECONDS * 1000);

    }
    else if (gameMode === 'solo') {
        // --- 單人模式邏輯 (solo) ---
        if(dinoPanelTitleEl) dinoPanelTitleEl.textContent = `🏃 體力補充區`;
        if(opponentStatusEl) opponentStatusEl.style.display = 'none';
        
        if(gamePetMessageEl) gamePetMessageEl.textContent = `點擊下方按鈕開始補充體力！當前體力: ${Math.floor(mySpirit)}/100`;

        // ✅ 改成打開模式選擇畫面
        if(startGameBtn) {
            startGameBtn.removeEventListener('click', startBattleCountdown);
            startGameBtn.textContent = '選擇體力補充方式';
            startGameBtn.onclick = showModeSelection;  // <<< 這裡不再直接 startGame();
        }

         // 🔹 綁定模式選擇按鈕
        if (rpiModeBtn) {
            rpiModeBtn.onclick = () => startSoloGame('rpi');
        }
        if (keyboardModeBtn) {
            keyboardModeBtn.onclick = () => startSoloGame('keyboard');
        }

        if(startButtonWrapperEl) startButtonWrapperEl.style.display = 'block';
    } else {
        alert('遊戲模式錯誤，返回大廳。');
        window.location.href = 'lobby.html';
        return;
    }

    // 處理返回大廳按鈕
    if(backToLobbyBtn) {
        backToLobbyBtn.addEventListener('click', () => {
             if (gameRunning) {
                 if (!confirm('遊戲尚未結束，確定要返回大廳嗎？遊戲結果將不予計算。')) {
                     return;
                 }
             }

            // ⭐ 返回大廳前關掉偵測與攝影機
             stopPoseLoop();
             if (webcamStream) {
                 webcamStream.getTracks().forEach(t => t.stop());
                 webcamStream = null;
             }
             window.location.href = 'lobby.html';
        });
    }
}

// 啟動遊戲初始化
document.addEventListener('DOMContentLoaded', initGameSetup);
