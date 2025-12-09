// frontend/js/dino_game.js

// 取得 canvas
const canvas = document.getElementById('game-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

// ===============================
//  圖片資源載入 & 尺寸設定
// ===============================
const bgImage = new Image();
bgImage.src = './assets/game-background.png';
let bgReady = false;
bgImage.onload = () => { bgReady = true; };

// 狗狗（主角 - 跑）
const dogRunImage = new Image();
dogRunImage.src = './assets/pet-run.png';
let dogReady = false;
let dogAspect = 80 / 50;   // 預設比例（寬 / 高）

// 狗狗（跳）
const dogJumpImage = new Image();
dogJumpImage.src = './assets/pet-jump.png';
let dogJumpReady = false;

// 狗狗（蹲）
const dogDuckImage = new Image();
dogDuckImage.src = './assets/pet-duck.png';
let dogDuckReady = false;

// 仙人掌
const cactusImage = new Image();
cactusImage.src = './assets/game-tree.png';
let cactusReady = false;
let cactusAspect = 1;

// 鳥
const birdImage = new Image();
birdImage.src = './assets/game-bird.png';
let birdReady = false;
let birdAspect = 1;

// ===============================
//  遊戲常數與狀態
// ===============================
const FLOOR_Y = canvas ? canvas.height - 60 : 340; // 地板線

// 先給一個預設，之後依狗狗原圖更新
let DINO_WIDTH = 80;
let DINO_HEIGHT = 50;

const JUMP_VELOCITY = -13;
const GRAVITY = 0.8;
const GAME_SPEED = 5;

// 主角狀態
let dino = {
    x: 60,
    y: FLOOR_Y - DINO_HEIGHT,
    width: DINO_WIDTH,
    height: DINO_HEIGHT,
    velocityY: 0,
    isJumping: false,
    isDucking: false,
    isDead: false
};

// ⭐ 用來決定畫哪一張狗圖：'run' | 'jump' | 'duck'
let dogPose = 'run';

// ---- 圖片 onload 設定（狗狗用原圖大小） ----
dogRunImage.onload = () => {
    dogReady = true;

    //dogAspect = dogRunImage.naturalWidth / dogRunImage.naturalHeight;

// 🐶 改成等比例縮放（不再用原圖大小）
const TARGET_DINO_HEIGHT = 90;   // 你可以調 60~90，看起來舒服即可
const scale = TARGET_DINO_HEIGHT / dogRunImage.naturalHeight;

DINO_HEIGHT = TARGET_DINO_HEIGHT;
DINO_WIDTH  = dogRunImage.naturalWidth * scale;

    dino.width  = DINO_WIDTH;
    dino.height = DINO_HEIGHT;
    dino.y      = FLOOR_Y - DINO_HEIGHT;  // 貼在地板上
};

dogJumpImage.onload = () => {
    dogJumpReady = true;
    dogJumpImage.scaledWidth  = dogJumpImage.naturalWidth  * (DINO_HEIGHT / dogJumpImage.naturalHeight);
    dogJumpImage.scaledHeight = DINO_HEIGHT;
};

dogDuckImage.onload = () => {
    dogDuckReady = true;
    dogDuckImage.scaledWidth  = dogDuckImage.naturalWidth  * (DINO_HEIGHT / dogDuckImage.naturalHeight);
    dogDuckImage.scaledHeight = DINO_HEIGHT;
};

cactusImage.onload = () => {
    cactusReady = true;
    cactusAspect = cactusImage.naturalWidth / cactusImage.naturalHeight;
};

birdImage.onload = () => {
    birdReady = true;
    birdAspect = birdImage.naturalWidth / birdImage.naturalHeight;
};

// 障礙物
let obstacles = [];
let animationFrameId = null;
let gameFrame = 0;
let difficultyLevel = 1;
let difficultyFrameCounter = 0;
const MAX_OBSTACLES_ON_SCREEN = 3;

// ===============================
//  工具函式：建立障礙物
// ===============================
function createObstacle() {
    const dinoH = DINO_HEIGHT || 60; // 保險用

    // 30% 機率生成鳥，其他是仙人掌
    const isBird = Math.random() < 0.3;

    if (isBird) {
        // 🐦 鳥：變大 + 調低，站立一定會撞，蹲下才會躲過
        const birdHeight = dinoH * 1;     // 比原本 45 再大一點，跟狗狗有比例感
        const birdWidth  = birdHeight * birdAspect;

        /**
         * 位置設定：
         * - 站立：頭會撞到鳥 → 會死
         * - 蹲下：高度變 0.6H，頭在下面 → 剛好躲過
         *
         * duck 時 dino top ≒ FLOOR_Y - 0.6H
         * 所以我們讓鳥的 bottom 大約在 FLOOR_Y - 0.7H 上下
         */
        const birdBottomY = FLOOR_Y - dinoH * 0.55;
        const y = birdBottomY - birdHeight;

        return {
            x: canvas.width,
            y,
            width: birdWidth,
            height: birdHeight,
            isPassed: false,
            type: 'bird'
        };
    } else {
        // 地上仙人掌：再放大一點，約 90~120 高
        const baseHeight = 50;
        const height = baseHeight + Math.random() * 15;   // 90 ~ 120
        const width  = height * cactusAspect;             // 等比例縮放

        return {
            x: canvas.width,
            y: FLOOR_Y - height,
            width,
            height,
            isPassed: false,
            type: 'cactus'
        };
    }
}

// ===============================
//  碰撞判定與物理
// ===============================

/**
 * 恐龍的判定框：
 * - 蹲下時高度變矮（符合「按下可以躲鳥」的規則）
 * - 再加一點內縮 margin，讓判定不那麼嚴格
 */
function getDinoBoundingBox() {
    const currentHeight = dino.isDucking ? dino.height * 0.6 : dino.height;
    const offsetY = dino.isDucking ? (dino.height - currentHeight) : 0;

    const marginX = dino.width * 0.2;    // 左右各縮 20%
    const marginY = currentHeight * 0.2; // 上下各縮 20%

    return {
        left:   dino.x + marginX,
        right:  dino.x + dino.width - marginX,
        top:    dino.y + offsetY + marginY,
        bottom: dino.y + offsetY + currentHeight - marginY
    };
}

function checkCollision() {
    if (dino.isDead) return false;
    const dinoBox = getDinoBoundingBox();

    for (const obs of obstacles) {
        // ⭐ 障礙物也縮一點，不要用滿版
        const marginX = obs.width * 0.15;
        const marginY = obs.height * 0.15;

        const obsBox = {
            left:   obs.x + marginX,
            right:  obs.x + obs.width  - marginX,
            top:    obs.y + marginY,
            bottom: obs.y + obs.height - marginY
        };

        const isCollision =
            dinoBox.right  > obsBox.left &&
            dinoBox.left   < obsBox.right &&
            dinoBox.bottom > obsBox.top &&
            dinoBox.top    < obsBox.bottom;

        if (isCollision) {
            dino.isDead = true;
            console.log('發生碰撞！遊戲結束。');
            stopDinoGame();
            if (window.game_state && window.game_state.forceEnd) {
                window.game_state.forceEnd();
            }
            return true;
        }
    }
    return false;
}

function updateDino() {
    if (dino.isDead) return;

    // 跳躍物理
    if (dino.isJumping) {
        dino.velocityY += GRAVITY;
        dino.y += dino.velocityY;

        if (dino.y >= FLOOR_Y - dino.height) {
            dino.y = FLOOR_Y - dino.height;
            dino.isJumping = false;
            dino.velocityY = 0;
            dogPose = 'run';   // 落地就回跑步姿勢
        }
    }

    checkCollision();
}

function updateObstacles() {
    for (const obs of obstacles) {
        const speedFactor = 1 + Math.min(difficultyLevel - 1, 0.8);
        obs.x -= GAME_SPEED * speedFactor;

        // 加分：完全通過恐龍
        if (!obs.isPassed && obs.x + obs.width < dino.x) {
            obs.isPassed = true;
            if (window.game_state && window.game_state.addScore) {
                window.game_state.addScore(10);
            }
            if (
                window.game_state &&
                window.game_state.getGameMode &&
                window.game_state.getGameMode() === 'battle' &&
                window.game_state.sendBattleUpdate
            ) {
                window.game_state.sendBattleUpdate(window.game_state.getScore());
            }
        }
    }

    // 移除超出畫面的障礙
    obstacles = obstacles.filter(o => o.x + o.width > 0);

    // 產生新障礙物（難度隨時間上升）
    gameFrame++;
    const baseInterval   = 100;
    const spawnInterval  = Math.max(55, baseInterval - difficultyLevel * 8);

    if (gameFrame >= spawnInterval) {
        if (obstacles.length < MAX_OBSTACLES_ON_SCREEN) {
            obstacles.push(createObstacle());
        }
        gameFrame = 0;
    }

    // 每隔一段時間稍微提高難度
    difficultyFrameCounter++;
    if (difficultyFrameCounter >= 300) {
        difficultyLevel += 0.4;
        difficultyFrameCounter = 0;
        console.log('難度提升為', difficultyLevel.toFixed(1));
    }
}

// ===============================
//  繪圖
// ===============================
function drawBackground() {
    if (!ctx) return;

    if (bgReady) {
        // 背景圖等比例縮放＋置中，不滿版拉伸
        const iw = bgImage.naturalWidth;
        const ih = bgImage.naturalHeight;
        const cw = canvas.width;
        const ch = canvas.height;

        const scale = Math.min(cw / iw, ch / ih);
        const dw = iw * scale;
        const dh = ih * scale;

        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;

        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, cw, ch);

        ctx.drawImage(bgImage, dx, dy, dw, dh);
    } else {
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(canvas.width, FLOOR_Y);
    ctx.stroke();
}

// 狗狗畫圖（跑 / 跳 / 蹲 三種姿勢）
function drawDino() {
    if (!ctx) return;

    let img = dogRunImage;

    if (dogPose === 'jump' && dogJumpReady) {
        img = dogJumpImage;
    } else if (dogPose === 'duck' && dogDuckReady) {
        img = dogDuckImage;
    }

    if (dogReady) {
        let w = (img.scaledWidth  || dino.width);
        let h = (img.scaledHeight || dino.height);

        ctx.drawImage(img, dino.x, dino.y, w, h);
    } else {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(dino.x, dino.y, dino.width, dino.height);
    }
}

function drawObstacles() {
    if (!ctx) return;

    for (const obs of obstacles) {
        if (obs.type === 'cactus') {
            if (cactusReady) {
                ctx.drawImage(
                    cactusImage,
                    obs.x,
                    obs.y,
                    obs.width,
                    obs.height
                );
            } else {
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
            }
        } else if (obs.type === 'bird') {
            if (birdReady) {
                ctx.drawImage(
                    birdImage,
                    obs.x,
                    obs.y,
                    obs.width,
                    obs.height
                );
            } else {
                ctx.fillStyle = '#00BFFF';
                ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
            }
        }
    }
}

function gameLoop() {
    if (!window.game_state || !window.game_state.isRunning() || dino.isDead) {
        return;
    }

    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    updateDino();
    updateObstacles();
    drawObstacles();
    drawDino();

    if (window.game_state.drawGame) {
        window.game_state.drawGame();
    }

    animationFrameId = requestAnimationFrame(gameLoop);
}

// ===============================
//  對外 API
// ===============================
export function startDinoGame() {
    if (!canvas || !ctx) return;

    dino.isDead    = false;
    dino.x         = 60;
    dino.y         = FLOOR_Y - DINO_HEIGHT;
    dino.velocityY = 0;
    dino.isJumping = false;
    dino.isDucking = false;
    dogPose        = 'run';

    obstacles              = [];
    gameFrame              = 0;
    difficultyLevel        = 1;
    difficultyFrameCounter = 0;

    if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

export function stopDinoGame() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

export function handleKeyboardInput(event) {
    if (!window.game_state || !window.game_state.isRunning() || dino.isDead) return;

    if (event.type === 'keydown') {
        // 上 / 空白鍵 → 跳起來躲仙人掌
        if (event.key === ' ' || event.key === 'ArrowUp') {
            if (!dino.isJumping && !dino.isDucking) {
                dino.isJumping = true;
                dino.velocityY = JUMP_VELOCITY;
                dogPose = 'jump';
            }
        }
        // 下 → 蹲下躲鳥
        else if (event.key === 'ArrowDown') {
            if (!dino.isJumping) {
                dino.isDucking = true;
                dogPose = 'duck';
            }
        }
    } else if (event.type === 'keyup') {
        if (event.key === 'ArrowDown') {
            dino.isDucking = false;
            dogPose = 'run';
        }
    }
}

// ⭐ 給「外部輸入」用的跳躍函式（例如：鏡頭偵測到跳）
export function jumpByExternalInput() {
    if (!window.game_state || !window.game_state.isRunning() || dino.isDead) return;

    if (!dino.isJumping && !dino.isDucking) {
        dino.isJumping = true;
        dino.velocityY = JUMP_VELOCITY;
        dogPose = 'jump';
    }
}

// ⭐ 給「外部輸入」用的蹲下函式（例如：鏡頭偵測到蹲）
export function duckByExternalInput() {
    if (!window.game_state || !window.game_state.isRunning() || dino.isDead) return;

    if (!dino.isJumping) {
        dino.isDucking = true;
        dogPose = 'duck';

        // 簡單設定 300ms 之後自動站起來
        setTimeout(() => {
            dino.isDucking = false;
            dogPose = 'run';
        }, 300);
    }
}
