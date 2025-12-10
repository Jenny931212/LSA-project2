// frontend/js/webcam_pose.js

let detector = null;
let videoEl = null;
let running = false;
let lastHipY = null;

// 只剩下「跳」的冷卻時間
let lastJumpTime = 0;

// 🔧 靈敏度設定：可以之後再自己微調
// 數字越小 → 越容易連續觸發
const JUMP_COOLDOWN_MS = 250;   // 原本 400ms，改成 0.25 秒就可以再跳一次
// 數字越小 → 身體抖一抖也會被當成跳
const JUMP_THRESHOLD = 10;      // 原本 15，改成 10 比較敏感

/**
 * 初始化 MoveNet 姿態偵測器
 * - 需要先在 HTML 載入 tfjs 與 @tensorflow-models/pose-detection
 */
export async function initPoseDetector(videoElement) {
    videoEl = videoElement;

    if (!window.tf || !window.poseDetection) {
        console.error("❌ 找不到 tf 或 poseDetection，全域 script 有載入嗎？");
        return;
    }

    const poseDetection = window.poseDetection;
    const tf = window.tf;

    await tf.ready();

    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
            modelType: 'SinglePose.Lightning',  // 輕量版就夠用了
        }
    );

    console.log("✅ MoveNet 偵測器初始化完成");
}

/**
 * 單一步驟：抓畫面 → 偵測姿勢 → 根據臀部高度變化判斷「跳」
 */
async function detectStep(onJump) {
    if (!detector || !videoEl) return;

    const poses = await detector.estimatePoses(videoEl);
    if (!poses || poses.length === 0) return;

    const keypoints = poses[0].keypoints;

    // 嘗試從左 / 右臀部取得一個有信心值的點
    const leftHip  = keypoints.find(p => p.name === "left_hip");
    const rightHip = keypoints.find(p => p.name === "right_hip");

    const hip = (leftHip && leftHip.score > 0.3) ? leftHip :
                (rightHip && rightHip.score > 0.3) ? rightHip : null;

    if (!hip) return;

    const y = hip.y;

    if (lastHipY !== null) {
        const dy = y - lastHipY;   // 正：往下，負：往上
        const now = Date.now();

        // ⭐ 只有「往上」而且移動量超過 JUMP_THRESHOLD，才視為跳
        if (dy < -JUMP_THRESHOLD && (now - lastJumpTime > JUMP_COOLDOWN_MS)) {
            console.log("⏫ Jump detected, dy =", dy.toFixed(2));
            lastJumpTime = now;
            onJump && onJump();
        }

        // ❌ 不再判斷蹲下（完全關掉 duck 偵測）
    }

    lastHipY = y;
}

/**
 * 開始持續偵測
 * - onJump: 偵測到「跳」時呼叫
 * - 你如果在別的地方多傳第二個參數，也會被忽略，不會壞掉
 */
export function startPoseLoop(onJump /*, onDuckIgnored */) {
    if (!detector || !videoEl) {
        console.warn("❗ detector 或 video 還沒準備好，無法啟動 pose loop");
        return;
    }

    if (running) return;
    running = true;

    async function loop() {
        if (!running) return;
        try {
            await detectStep(onJump);
        } catch (err) {
            console.error("偵測過程發生錯誤", err);
        }
        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

/** 停止偵測迴圈 */
export function stopPoseLoop() {
    running = false;
    lastHipY = null;
    lastJumpTime = 0;
}
