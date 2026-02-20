import { initScene, triggerCharge, triggerFire, triggerReset } from "./rendering/Scene";
import { initCamera } from "./core/Camera";
import { HandTracker, GestureType } from "./detection/HandTracker";
import { soundManager } from "./audio/SoundManager";

// ui
const loadingEl = document.getElementById("loading")!;
const statusEl = document.getElementById("status")!;
const progressBar = document.getElementById("progress-fill")!;
const gestureHint = document.getElementById("gesture-hint")!;
const overlayCanvas = document.getElementById("landmark-canvas") as HTMLCanvasElement;
const ctx = overlayCanvas.getContext("2d")!;
const kiMeterFill = document.getElementById("ki-meter-fill") as HTMLElement;

function setProgress(pct: number, label: string) {
  progressBar.style.width = `${pct}%`;
  (document.getElementById("progress-label") as HTMLElement).textContent = label;
}

// skele
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

// map mediapipe space to screen cover 
function getMappedCoords(x: number, y: number, video: HTMLVideoElement) {
  const videoAspect = video.videoWidth / video.videoHeight;
  const screenAspect = overlayCanvas.width / overlayCanvas.height;

  let repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0;
  if (screenAspect > videoAspect) {
    repeatY = videoAspect / screenAspect;
    offsetY = (1 - repeatY) / 2;
  } else {
    repeatX = screenAspect / videoAspect;
    offsetX = (1 - repeatX) / 2;
  }

  return {
    x: ((1 - x) - offsetX) / repeatX,
    y: (y - offsetY) / repeatY
  };
}

// 2d skeleton draw 
function drawHands(landmarks: { x: number; y: number; z: number }[][], gesture: GestureType, video: HTMLVideoElement) {
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!landmarks.length || !video.videoWidth) return;

  const isCharge = gesture === "KABUFLASH_CHARGE";
  const isFire = gesture === "KABUFLASH_FIRE";
  const col = isFire ? "#fff" : isCharge ? "#fff" : "rgba(255,255,255,0.2)";

  for (const lm of landmarks) {
    ctx.strokeStyle = col; ctx.lineWidth = isCharge || isFire ? 3.5 : 1.5;
    for (const [a, b] of CONNECTIONS) {
      const p1 = getMappedCoords(lm[a].x, lm[a].y, video);
      const p2 = getMappedCoords(lm[b].x, lm[b].y, video);
      ctx.beginPath();
      ctx.moveTo(p1.x * overlayCanvas.width, p1.y * overlayCanvas.height);
      ctx.lineTo(p2.x * overlayCanvas.width, p2.y * overlayCanvas.height);
      ctx.stroke();
    }
  }
}

// state 
type AppState = "idle" | "charging" | "firing";
let appState: AppState = "idle";
let chargeStartTime = 0;
const CHARGE_DURATION_MS = 2500;

const GRACE_MS = 600;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let graceActive = false;

window.addEventListener("flash-done", () => {
  appState = "idle";
  setKiMeter(0);
  updateHoldRing(0);
});

function setKiMeter(p: number) {
  if (!kiMeterFill) return;
  kiMeterFill.style.width = `${Math.round(p * 100)}%`;
  kiMeterFill.style.background = `linear-gradient(90deg, #fff, #88ccff)`;
  kiMeterFill.style.boxShadow = `0 0 ${10 + p * 25}px #fff`;
}

let holdRing: HTMLElement;

// build circular progress ring 
function buildHoldRing() {
  holdRing = document.createElement("div");
  holdRing.id = "hold-ring";
  document.body.appendChild(holdRing);
}
function updateHoldRing(p: number) {
  if (!holdRing) return;
  holdRing.style.opacity = p > 0 ? "1" : "0";
  holdRing.style.setProperty("--deg", `${Math.round(p * 360)}deg`);
}

function startGrace(onExpire: () => void) {
  if (graceActive) return;
  graceActive = true;
  graceTimer = setTimeout(() => { graceActive = false; onExpire(); }, GRACE_MS);
}
function cancelGrace() {
  graceActive = false;
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
}

// main entry point 
async function start() {
  buildHoldRing();
  setProgress(20, "Initializing lens...");
  let video: HTMLVideoElement;
  try { video = await initCamera(); }
  catch (e) {
    console.error(e);
    loadingEl.innerHTML = `<p style="color:#ff6666">Camera access failed or element missing. <br>Please check console for details.</p>`;
    return;
  }

  setProgress(50, "Calibrating sensors...");
  initScene(video);

  setProgress(75, "Loading neural tracker...");
  const tracker = new HandTracker();
  try { await tracker.init(); }
  catch { loadingEl.innerHTML = `<p>Tracker failed.</p>`; return; }

  setProgress(100, "SYSTEM READY");
  setTimeout(() => { loadingEl.style.opacity = "0"; setTimeout(() => loadingEl.remove(), 600); }, 500);

  function resize() { overlayCanvas.width = window.innerWidth; overlayCanvas.height = window.innerHeight; }
  resize(); window.addEventListener("resize", resize);

  window.addEventListener("click", () => soundManager.resume(), { once: true });

  function loop() {
    const result = tracker.detect(video);
    if (result) {
      const gesture = tracker.getStableGesture(result);
      // draw skeleton with cover mapping 
      drawHands(result.landmarks, gesture, video);

      if (result.landmarks.length > 0) {
        // center of hands for beam 
        let tx = 0, ty = 0;
        for (const h of result.landmarks) {
          const mapped = getMappedCoords(h[0].x, h[0].y, video);
          tx += mapped.x;
          ty += mapped.y;
        }
        import("./rendering/Scene").then(({ updateBeamPosition }) => updateBeamPosition(tx / result.landmarks.length, ty / result.landmarks.length));
      }

      const now = performance.now();
      if (appState === "idle") {
        if (gesture === "KABUFLASH_CHARGE") {
          appState = "charging";
          chargeStartTime = now;
          cancelGrace();
          triggerCharge();
          soundManager.playCharge();
        }
      } else if (appState === "charging") {
        if (gesture === "KABUFLASH_CHARGE" || graceActive) {
          if (gesture === "KABUFLASH_CHARGE") cancelGrace();
          const progress = Math.min((now - chargeStartTime) / CHARGE_DURATION_MS, 1);
          updateHoldRing(progress);
          setKiMeter(progress);
          window.dispatchEvent(new CustomEvent("KABUFLASH-progress", { detail: progress }));

          if (progress >= 1 || gesture === "KABUFLASH_FIRE") {
            appState = "firing";
            cancelGrace();
            tracker.notifyFired();
            triggerFire();
            soundManager.playFire();
            updateHoldRing(0);
            setKiMeter(0);
          }
        } else {
          startGrace(() => {
            if (appState === "charging") {
              appState = "idle";
              updateHoldRing(0); setKiMeter(0);
              soundManager.stopAll();
              triggerReset();
            }
          });
        }
      }

      if (appState === "idle") {
        statusEl.textContent = "WAITING FOR INPUT";
        statusEl.style.color = "rgba(255,255,255,0.3)";
        gestureHint.textContent = "CUP HANDS TO GENERATE ENERGY";
      } else if (appState === "charging") {
        const p = Math.min((now - chargeStartTime) / CHARGE_DURATION_MS, 1);
        statusEl.textContent = `CHARGING CORE: ${Math.round(p * 100)}%`;
        statusEl.style.color = "#fff";
        gestureHint.textContent = "CRITICAL MASS IMMIINENT";
      } else if (appState === "firing") {
        statusEl.textContent = "Kabuflash DETONATED";
        statusEl.style.color = "#fff";
        gestureHint.textContent = "";
      }
    } else { ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); }
    requestAnimationFrame(loop);
  }
  loop();
}
start();