// frontend/js/game_app.js (PK 對戰 + Solo + 鏡頭/鍵盤模式 最終修正版)

import { getPetStatus, updatePetSpirit } from './api_client.js';
import { sendMessage, registerCallback } from './websocket_client.js';
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
const rpiVideoEl = document.getElementById('webcam-video');  // ⭐ 鏡頭 video

// 鍵盤模式下，是否開啟預覽狗狗
let keyboardPreviewActive = false;

// 模式選擇相關 DOM
const modeSelectScreenEl = document.getElementById('mode-select-screen'); // 模式選擇畫面
const rpiModeBtn = document.getElementById('rpi-mode-btn'); // 樹莓派模式按鈕
const keyboardModeBtn = document.getElementById('keyboard-mode-btn'); // 鍵盤模式按鈕

// ⭐ PK 倒數圈圈
const battleCountdownEl = document.getElementById('battle-mode-countdown');
const battleCountdownTextEl = document.getElementById('battle-mode-countdown-text');

// 狀態變數
let inputMode = ''; // 'rpi' 或 'keyboard'
let isGameActive = false; // 追蹤遊戲是否在運行 (避免重複綁定/解綁)
let webcamStream = null;   // 儲存 getUserMedia 拿到的 stream

// PK 模式：選擇操作方式倒數
let battleModeSelectTimer = null;
let battleModeCountdownInterval = null;
const BATTLE_MODE_SELECT_SECONDS = 5;

// 狀態顯示元素
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

// 遊戲 Canvas 元素
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

// 儲存時間（秒）
let elapsedTime = 0;

// 遊戲運行旗標
let gameRunning = false;
let gameInterval = null;

// ⭐ PK 結算相關旗標
let myFinished = false;
let opponentFinished = false;
let sentBattleResult = false;

// ======================================================
// 預覽狗狗鍵盤控制（左邊小狗預覽）
// ======================================================
function handlePreviewKeyDown(event) {
    if (!keyboardPreviewActive || !dogPreviewImgEl) return;

    if (event.key === ' ' || event.key === 'ArrowUp') {
        dogPreviewImgEl.src = './assets/pet-jump.png';
    } else if (event.key === 'ArrowDown') {
        dogPreviewImgEl.src = './assets/pet-duck.png';
    }
}

function handlePreviewKeyUp(event) {
    if (!keyboardPreviewActive || !dogPreviewImgEl) return;

    if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        dogPreviewImgEl.src = './assets/pet-run.png';
    }
}

// ======================================================
// 共用：安全取得自己的 user_id
// ======================================================
function getMyUserId() {
    // 兩種 key 都試試看，避免有一邊存 my_user_id、一邊存 user_id
    const id1 = Number(localStorage.getItem('my_user_id'));
    if (!Number.isNaN(id1) && id1 > 0) return id1;

    const id2 = Number(localStorage.getItem('user_id'));
    if (!Number.isNaN(id2) && id2 > 0) return id2;

    return 0;
}

// ======================================================
// 3. 精神狀態 → 文字與圖片
// ======================================================
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

    // 左上角第二行：自己的分數
    ctx.fillStyle = 'yellow';
    ctx.fillText(`我的分數: ${myGameScore}`, 10, 50);

    ctx.restore();

    // 下方提示文字
    if (gamePromptEl) {
        if (gameMode === 'battle') {
            gamePromptEl.textContent =
                `PK 模式｜躲避障礙物與鳥，活越久、得分越高！目前時間: ${elapsedTime}s`;
        } else {
            gamePromptEl.textContent =
                `躲避障礙物與鳥，活越久越難！目前時間: ${elapsedTime}s`;
        }
    }

    // 對方分數（右側區塊顯示）
    if (gameMode === 'battle' && opponentScoreEl) {
        opponentScoreEl.textContent = `分數: ${opponentScore}`;
    }
}

/** 遊戲計時器迴圈 */
function gameTimerLoop() {
    if (!gameRunning) return;
    elapsedTime++;
    drawGame();
}

/** 開始遊戲（進入 Dino 畫面 + 開始計時） */
function startGame() {
    if (petStatusScreenEl) petStatusScreenEl.style.display = 'none';
    if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex'; 
    if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';

    myGameScore = 0;
    elapsedTime = 0;
    gameRunning = true;

    // 每次開始遊戲都重置 PK 旗標
    myFinished = false;
    opponentFinished = false;
    sentBattleResult = false;

    drawGame();
    gameInterval = setInterval(gameTimerLoop, 1000);
}

/** 遊戲結束邏輯（包含 Solo / Battle 結算） */
async function endGame() {
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

    // ================= Solo 模式：體力加成 =================
    if (gameMode === 'solo') {
    const spiritGained = Math.floor(myGameScore / 100);
    newSpirit = Math.min(100, initialSpirit + spiritGained);

    // 先更新後端
    try {
        await updatePetSpirit(newSpirit);
        console.log('[SOLO] 已將體力值更新到後端：', newSpirit);
    } catch (err) {
        console.error('[SOLO] 更新後端體力值失敗：', err);
    }

    // 文字顯示用 newSpirit
    finalMessage = `
        <div style="font-size: 1.2em; line-height: 1.8; text-align: center;">
            🎉 訓練完成！<br>
            您獲得 <span id="animated-score-value" style="font-weight: bold; color: ${SCORE_COLOR}; font-size: 1.8em;">0</span> 分，換算成體力值為 ${spiritGained} 點。<br>
            <hr style="border-top: 2px solid var(--pixel-black); width: 80%; margin: 15px auto;">
            您現在的體力值為: 
            <span id="animated-spirit-value" style="font-weight: bold; color: ${SPIRIT_COLOR}; font-size: 1.8em;">
                ${Math.floor(newSpirit)}/100
            </span>
        </div>
    `; 
    
    finalPetImg = getSpiritInfo(newSpirit).statusImg;
    }

    // ================= Battle 模式：勝負判定 =================
    else if (gameMode === 'battle') {
        let resultText;
        let battleResult;
        if (myGameScore > opponentScore) {
            resultText = `<span style="color: ${WIN_COLOR};">🏆 獲勝！</span>`;
            finalPetImg = './assets/pet-win.png'; 
            battleResult = 'win';
        } else if (myGameScore < opponentScore) {
            resultText = `<span style="color: ${LOSE_COLOR};">😭 敗北！</span>`;
            finalPetImg = './assets/pet-lose.png'; 
            battleResult = 'lose';
        } else {
            resultText = '🤝 平手。';
            finalPetImg = './assets/pet-resting.png'; 
            battleResult = 'draw';
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

        // ⭐ 把本機結果送給 wsA（只送一次，避免接到廣播又再送）
        const battleId = localStorage.getItem('current_battle_id');
        if (battleId && !sentBattleResult) {
        // ✅ 改成 battle_result，payload 帶 battle_id + score
        sendMessage('battle_result', {
            battle_id: battleId,
            score: myGameScore
        });
        sentBattleResult = true;
        }
    
        if (opponentStatusEl) {
            opponentStatusEl.style.display = 'none';
        }
    }

    // 顯示結算用字卡
    if (petStatusScreenEl) {
        petStatusScreenEl.classList.add('pixel-border-box');
        petStatusScreenEl.style.backgroundColor = '#fff9c4'; 
        petStatusScreenEl.style.boxShadow = '8px 8px 0 var(--pixel-dark-blue)'; 
        petStatusScreenEl.style.color = 'var(--pixel-black)'; 
        petStatusScreenEl.style.padding = '25px'; 
        
        petStatusScreenEl.style.flexGrow = '1';
        petStatusScreenEl.style.width = '100%';
        petStatusScreenEl.style.display = 'flex';
        petStatusScreenEl.style.flexDirection = 'column';
        petStatusScreenEl.style.justifyContent = 'center';
        petStatusScreenEl.style.alignItems = 'center';

        if (gamePetMessageEl) {
            gamePetMessageEl.style.color = 'var(--pixel-black)'; 
            gamePetMessageEl.style.textAlign = 'center';
            gamePetMessageEl.innerHTML = finalMessage;
        }
    }

    if (petStatusScreenEl) petStatusScreenEl.style.display = 'flex';
    if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'none';
    
    // 更新寵物圖片
    if (gamePetImgEl) {
        gamePetImgEl.src = finalPetImg; 
        gamePetImgEl.style.marginBottom = '5px';
    }
    
    // 分數動畫
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
            if (playerStatusEl) {
                playerStatusEl.textContent = `精神狀態: ${Math.floor(newSpirit)}/100`;
            }
        }
    }

    // 清理鍵盤事件監聽
    if (isGameActive && inputMode === 'keyboard') {
        document.removeEventListener('keydown', handleKeyboardInput);
        document.removeEventListener('keyup', handleKeyboardInput); 
        isGameActive = false;
    }

    // 清理預覽狗狗鍵盤監聽
    if (keyboardPreviewActive) {
        document.removeEventListener('keydown', handlePreviewKeyDown);
        document.removeEventListener('keyup', handlePreviewKeyUp);
        keyboardPreviewActive = false;
    }

    // 鏡頭模式：關閉姿態偵測與攝影機
    if (inputMode === 'rpi') {
        stopPoseLoop();
        if (webcamStream) {
            webcamStream.getTracks().forEach(t => t.stop());
            webcamStream = null;
        }
    }

    // 結算畫面上的按鈕：返回大廳
    if (startGameBtn) {
        startGameBtn.style.display = 'block'; 
        startGameBtn.textContent = '返回大廳'; 
        
        startGameBtn.removeEventListener('click', startGame);
        startGameBtn.onclick = () => window.location.href = 'lobby.html';
        
        const buttonWrapper = document.createElement('div');
        buttonWrapper.style.textAlign = 'center';
        buttonWrapper.style.marginTop = '20px';
        buttonWrapper.appendChild(startGameBtn);
        
        if (petStatusScreenEl) {
            petStatusScreenEl.appendChild(buttonWrapper); 
        }
    }
}

/** 體力值 / 分數動畫 */
function animateCounter(startValue, endValue, targetEl, headerEl = null, finalValue = null, isSpirit = false) {
    const duration = 1500;
    const stepTime = 16; 
    const steps = duration / stepTime;
    const increment = (endValue - startValue) / steps;
    let currentValue = startValue;
    let stepCount = 0;
    
    const petImgEl = document.getElementById('game-pet-img'); 
    let lastSpiritStatus = -1;

    const interval = setInterval(() => {
        stepCount++;
        
        if (stepCount >= steps) {
            clearInterval(interval);
            currentValue = endValue;
        } else {
            currentValue += increment;
        }
        
        const displayValue = Math.floor(currentValue);

        if (isSpirit) {
            targetEl.textContent = `${displayValue}/100`;
            if (headerEl) headerEl.textContent = `精神狀態: ${displayValue}/100`;

            const currentStatus = getSpiritInfo(displayValue).statusClass;
            if (currentStatus !== lastSpiritStatus) {
                const { statusImg } = getSpiritInfo(displayValue); 
                if (petImgEl) petImgEl.src = statusImg;
                lastSpiritStatus = currentStatus;
            }

            if (stepCount >= steps && finalValue !== null) {
                localStorage.setItem('my_spirit_value', finalValue);
            }
        } else {
            targetEl.textContent = displayValue;
        }

    }, stepTime);
}

/** 倒數計時並啟動遊戲（舊版，現在 PK 換成模式選擇） */
function startBattleCountdown() {
    let count = 5;
    
    if (petStatusScreenEl) petStatusScreenEl.style.display = 'none';
    if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex'; 
    if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';
    
    if (gamePromptEl) {
        gamePromptEl.style.display = 'block';
        gamePromptEl.style.fontSize = '3em';
    }
    
    const countdownInterval = setInterval(() => {
        if (count > 0) {
            if (gamePromptEl) gamePromptEl.textContent = `戰鬥將於 ${count} 秒後開始...`;
            count--;
        } else {
            clearInterval(countdownInterval);
            if (gamePromptEl) gamePromptEl.style.display = 'none'; 
            startGame();
        }
    }, 1000);
}

/** 顯示模式選擇畫面 (Solo 模式專用) */
function showModeSelection() {
    if (petStatusScreenEl) petStatusScreenEl.style.display = 'none';
    if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';
    if (modeSelectScreenEl) modeSelectScreenEl.style.display = 'flex'; 
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

/** 啟動 Solo / Battle 的實際遊戲（根據選擇的輸入方式） */
async function startSoloGame(mode) {
    inputMode = mode;

    if (mode === 'rpi') {
        setBirdsEnabled(false);
        setGameSpeedScale(1.0);
    } else {
        setBirdsEnabled(true);
        setGameSpeedScale(0.7);  // 覺得太快可以再調小
    }
    
    if (modeSelectScreenEl) modeSelectScreenEl.style.display = 'none';

    keyboardPreviewActive = false;
    document.removeEventListener('keydown', handlePreviewKeyDown);
    document.removeEventListener('keyup', handlePreviewKeyUp);

    if (mode === 'rpi') {
        if (rpiCamBoxEl) rpiCamBoxEl.classList.remove('keyboard-preview-bg');
        if (rpiCamLabelEl) rpiCamLabelEl.style.display = 'block';
        if (dogPreviewImgEl) dogPreviewImgEl.style.display = 'none';

        if (gameIframeScreenEl) gameIframeScreenEl.style.display = 'flex';
        if (canvas) canvas.style.display = 'block';
        if (gamePromptEl) {
            gamePromptEl.style.display = 'block';
            gamePromptEl.style.fontSize = '1.1em';
            gamePromptEl.textContent = '鏡頭與偵測模型初始化中，請稍候…';
        }

        const ok = await startWebcamControl();
        if (!ok) {
            if (gamePromptEl) {
                gamePromptEl.textContent = '鏡頭初始化失敗，請檢查權限或重新整理頁面。';
            }
            return;
        }

        if (gamePromptEl) {
            gamePromptEl.style.display = 'none';
        }

        startGame();
        startDinoGame();

        if (dinoPanelTitleEl) {
            dinoPanelTitleEl.textContent = 
                (gameMode === 'battle') 
                ? '⚔️ 對戰模式：樹莓派運動偵測'
                : '🏃 鏡頭模式：運動控制小恐龍';
        }

    } else if (mode === 'keyboard') {
        if (rpiCamLabelEl) rpiCamLabelEl.style.display = 'none';
        if (rpiCamBoxEl)  rpiCamBoxEl.classList.add('keyboard-preview-bg');

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

        startGame();

        if (!isGameActive) {
            document.addEventListener('keydown', handleKeyboardInput);
            document.addEventListener('keyup', handleKeyboardInput);
            isGameActive = true;
        }

        startDinoGame();

        keyboardPreviewActive = true;
        document.addEventListener('keydown', handlePreviewKeyDown);
        document.addEventListener('keyup', handlePreviewKeyUp);

        if (dinoPanelTitleEl) {
            dinoPanelTitleEl.textContent =
                (gameMode === 'battle')
                ? '⚔️ 對戰模式：小恐龍對決（鍵盤）'
                : '🎮 鍵盤模式: 挑戰小恐龍';
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcamStream = stream;
        videoEl.srcObject = stream;
        await videoEl.play();

        if (labelEl) {
            labelEl.textContent = '鏡頭運作中：跳 = Dino 跳';
        }

        await initPoseDetector(videoEl);

        // 如果你前面有把蹲下偵測關掉，這裡第二個參數會被忽略
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

/** PK 模式：依據選擇的操作方式啟動遊戲 */
function startBattleWithMode(mode) {
    clearBattleModeCountdown();
    inputMode = mode;
    startSoloGame(mode); // battle / solo 共用邏輯

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
// 5. 讓 Dino 遊戲可以呼叫的全域 game_state
// ======================================================
window.game_state = {
    getScore: () => myGameScore,
    addScore: (points) => {
        myGameScore += points;
    },
    drawGame: drawGame,
    isRunning: () => gameRunning,
    getGameMode: () => gameMode,
    sendBattleUpdate: (score) => {
        if (gameMode === 'battle') {
            const battleId = localStorage.getItem('current_battle_id');
            if (!battleId) return;

            sendMessage('battle_update', {
                battle_id: battleId,
                score: score,
                state: 'running'
            });
        }
    },
    forceEnd: () => {
        if (gameRunning) {
            clearInterval(gameInterval);
            endGame();
        }
    }
};

// ======================================================
// 6. 初始化：依遊戲模式設定畫面 + WebSocket 事件
// ======================================================
function initGameSetup() {
    gameMode = localStorage.getItem('game_mode');
    mySpirit = Number(localStorage.getItem('my_spirit_value')) || 50;
    initialSpirit = mySpirit;
    const myDisplayName = localStorage.getItem('my_display_name') || '我';
    
    if (playerStatusEl) {
        playerStatusEl.textContent = `精神狀態: ${Math.floor(mySpirit)}/100`;
    }

    const { statusImg } = getSpiritInfo(mySpirit);
    if (gamePetImgEl) {
        gamePetImgEl.src = statusImg;
    }

    if (petStatusScreenEl) {
        petStatusScreenEl.classList.remove('pixel-border-box');
        petStatusScreenEl.style.backgroundColor = 'transparent';
        petStatusScreenEl.style.boxShadow = 'none';
        petStatusScreenEl.style.color = 'white'; 
        petStatusScreenEl.style.padding = '20px'; 
        petStatusScreenEl.style.flexGrow = '0'; 
        petStatusScreenEl.style.display = 'block';
    }
    if (gamePetMessageEl) {
        gamePetMessageEl.style.color = 'white'; 
    }

    // ===================== Battle Mode =====================
    if (gameMode === 'battle') {
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

        if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'none';
        if (petStatusScreenEl) petStatusScreenEl.style.display = 'none';

        if (modeSelectScreenEl) modeSelectScreenEl.style.display = 'flex';

        // 圓圈倒數 5 秒
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

        // 綁定兩個模式按鈕（PK 版）👉 只記錄選擇，不直接開遊戲
        if (rpiModeBtn) {
            rpiModeBtn.onclick = () => {
                inputMode = 'rpi';
                if (gamePetMessageEl) {
                    gamePetMessageEl.textContent = '已選擇「樹莓派模式」，請等待倒數結束後開始對戰！';
                }
            };
        }
        if (keyboardModeBtn) {
            keyboardModeBtn.onclick = () => {
                inputMode = 'keyboard';
                if (gamePetMessageEl) {
                    gamePetMessageEl.textContent = '已選擇「鍵盤模式」，請等待倒數結束後開始對戰！';
                }
            };
        }


        // 滿 5 秒才開始：有選就用玩家選的，沒選就預設鍵盤
        battleModeSelectTimer = setTimeout(() => {
            const modeToStart = inputMode || 'keyboard';
            startBattleWithMode(modeToStart);
        }, BATTLE_MODE_SELECT_SECONDS * 1000);


        // ==================================================
        // ⭐ WebSocket 對戰事件處理
        // ==================================================

        // 1. 即時接收對手分數
        // 注意：websocket_client 會把「整包 data」丟進來，不是只丟 payload
        registerCallback('battle_update', (data) => {
            try {
                if (!data) return;

                // WebSocket 標準格式：
                // {
                //   type: "battle_update",
                //   server_id: "...",
                //   user_id: 發送這則消息的人,
                //   payload: { battle_id, score, ... }
                // }
                const payload = data.payload || data;

                const myId = getMyUserId();
                const battleId = localStorage.getItem('current_battle_id');

                if (!battleId || payload.battle_id !== battleId) return;

                const senderId = (typeof data.user_id === 'number')
                    ? data.user_id
                    : payload.user_id;

                // 只更新「對手」的分數
                if (senderId && senderId !== myId) {
                    opponentScore = payload.score || 0;
                    if (opponentScoreEl) {
                        opponentScoreEl.textContent = `分數: ${opponentScore}`;
                    }
                }
            } catch (err) {
                console.error('battle_update handler error:', err);
            }
        });

                // 2. 雙方最終成績，雙方都結束時一起結算
        registerCallback('battle_result', (data) => {
            try {
                if (!data) return;

                const payload = data.payload || data;
                const myId = getMyUserId();
                const battleId = localStorage.getItem('current_battle_id');
                if (!battleId || payload.battle_id !== battleId) return;

                const senderId = (typeof data.user_id === 'number')
                    ? data.user_id
                    : payload.user_id;
                const score = payload.score || 0;

                if (senderId === myId) {
                    // 這一則是「伺服器認定的我的最終分數」
                    myFinished = true;
                    myGameScore = score;
                } else {
                    // 這一則是對手的最終分數
                    opponentFinished = true;
                    opponentScore = score;
                    if (opponentScoreEl) {
                        opponentScoreEl.textContent = `分數: ${opponentScore}`;
                    }
                }

                // ⚖️ 雙方都結束，才真的跳出結算畫面（兩邊同步）
                if (myFinished && opponentFinished) {
                    // 保險：有些情境下 gameRunning 已被設為 false
                    if (!gameRunning) {
                        gameRunning = true;
                    }
                    endGame();
                }
            } catch (err) {
                console.error('battle_result handler error:', err);
            }
        });
}
    // ===================== Solo Mode =====================
    else if (gameMode === 'solo') {
        if (dinoPanelTitleEl) dinoPanelTitleEl.textContent = '🏃 體力補充區';
        if (opponentStatusEl) opponentStatusEl.style.display = 'none';
        
        if (gamePetMessageEl) {
            gamePetMessageEl.textContent =
                `點擊下方按鈕開始補充體力！當前體力: ${Math.floor(mySpirit)}/100`;
        }

        if (startGameBtn) {
            startGameBtn.removeEventListener('click', startBattleCountdown);
            startGameBtn.textContent = '選擇體力補充方式';
            startGameBtn.onclick = showModeSelection;
        }

        if (rpiModeBtn) {
            rpiModeBtn.onclick = () => startSoloGame('rpi');
        }
        if (keyboardModeBtn) {
            keyboardModeBtn.onclick = () => startSoloGame('keyboard');
        }

        if (startButtonWrapperEl) startButtonWrapperEl.style.display = 'block';

    } else {
        alert('遊戲模式錯誤，返回大廳。');
        window.location.href = 'lobby.html';
        return;
    }

    // 返回大廳按鈕
    if (backToLobbyBtn) {
        backToLobbyBtn.addEventListener('click', () => {
            if (gameRunning) {
                if (!confirm('遊戲尚未結束，確定要返回大廳嗎？遊戲結果將不予計算。')) {
                    return;
                }
            }

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
