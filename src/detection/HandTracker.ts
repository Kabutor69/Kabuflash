import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type NormalizedLandmark = { x: number; y: number; z: number };
type HandLandmarkerResult = ReturnType<HandLandmarker["detectForVideo"]>;

export type GestureType =
  | "NONE"
  | "KABUFLASH_CHARGE"
  | "KABUFLASH_FIRE"
  | "CLOSE";

// tracker logic
export class HandTracker {
  private landmarker!: HandLandmarker;
  private gestureBuffer: GestureType[] = [];
  private readonly BUFFER_SIZE = 5;

  // velocity for fire
  private prevWristDist: number | null = null;
  private lastTime: number = 0;
  private lastFireTime: number = 0;
  private readonly FIRE_COOLDOWN_MS = 2000;

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      // both hands thresholding
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  }

  detect(video: HTMLVideoElement): HandLandmarkerResult | null {
    if (!this.landmarker) return null;
    return this.landmarker.detectForVideo(video, performance.now());
  }

  // fingers open check
  private countOpenFingers(lm: NormalizedLandmark[]): number {
    const wrist = lm[0];
    const tips = [8, 12, 16, 20];
    const mcp = [5, 9, 13, 17];
    let open = 0;
    for (let i = 0; i < 4; i++) {
      const dTip = Math.hypot(lm[tips[i]].x - wrist.x, lm[tips[i]].y - wrist.y);
      const dMcp = Math.hypot(lm[mcp[i]].x - wrist.x, lm[mcp[i]].y - wrist.y);
      if (dTip > dMcp * 1.1) open++;
    }
    return open;
  }

  // hand is open
  private isHandOpen(lm: NormalizedLandmark[]): boolean {
    return this.countOpenFingers(lm) >= 2;
  }

  // charge logic (2 hands or 1 hand fallback)
  private isCharging(hands: NormalizedLandmark[][]): boolean {
    if (hands.length === 0) return false;

    if (hands.length >= 2) {
      const [h1, h2] = hands;
      if (!this.isHandOpen(h1) || !this.isHandOpen(h2)) return false;
      const dist = Math.hypot(h1[0].x - h2[0].x, h1[0].y - h2[0].y);
      // cup pose
      return dist > 0.02 && dist < 0.42;
    }

    // 1 hand fallback (u like this)
    const hand = hands[0];
    if (!this.isHandOpen(hand)) return false;
    const cx = hand[0].x;
    return cx > 0.25 && cx < 0.75;
  }

  // fire logic (speed boom)
  private isFiring(hands: NormalizedLandmark[][]): boolean {
    if (hands.length === 0) return false;

    const now = performance.now();
    if (now - this.lastFireTime < this.FIRE_COOLDOWN_MS) {
      if (hands.length >= 2) {
        this.prevWristDist = Math.hypot(
          hands[0][0].x - hands[1][0].x,
          hands[0][0].y - hands[1][0].y
        );
      }
      this.lastTime = now;
      return false;
    }

    let dist: number;
    if (hands.length >= 2) {
      dist = Math.hypot(hands[0][0].x - hands[1][0].x, hands[0][0].y - hands[1][0].y);
    } else {
      // 1 hand speed measure
      this.prevWristDist = null;
      this.lastTime = now;
      return false;
    }

    const dt = now - this.lastTime;
    let fired = false;

    if (this.prevWristDist !== null && dt > 0 && dt < 200) {
      const velocity = (dist - this.prevWristDist) / dt;
      if (velocity > 0.001 && dist > 0.20) {
        fired = true;
      }
    }

    this.prevWristDist = dist;
    this.lastTime = now;

    if (fired) this.lastFireTime = now;
    return fired;
  }

  // stable guesture
  getStableGesture(result: HandLandmarkerResult): GestureType {
    let frame: GestureType = "NONE";

    if (this.isFiring(result.landmarks)) {
      frame = "KABUFLASH_FIRE";
    } else if (this.isCharging(result.landmarks)) {
      frame = "KABUFLASH_CHARGE";
    } else if (result.landmarks.some(h => this.isHandOpen(h))) {
      frame = "CLOSE";
    }

    this.gestureBuffer.push(frame);
    if (this.gestureBuffer.length > this.BUFFER_SIZE) this.gestureBuffer.shift();

    const counts: Record<GestureType, number> = { NONE: 0, KABUFLASH_CHARGE: 0, KABUFLASH_FIRE: 0, CLOSE: 0 };
    for (const g of this.gestureBuffer) counts[g]++;

    if (counts.KABUFLASH_FIRE >= 2) return "KABUFLASH_FIRE";
    if (counts.KABUFLASH_CHARGE >= this.BUFFER_SIZE * 0.4) return "KABUFLASH_CHARGE";
    if (counts.CLOSE >= this.BUFFER_SIZE * 0.5) return "CLOSE";
    return "NONE";
  }

  notifyFired() {
    this.lastFireTime = performance.now();
  }
}
