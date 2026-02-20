import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import gsap from "gsap";
import { soundManager } from "../audio/SoundManager";

let fireAction: () => void = () => { };
let chargeAction: () => void = () => { };
let resetScene: () => void = () => { };
let updateBeamPos: (x: number, y: number) => void = () => { };

export const triggerCharge = () => chargeAction();
export const triggerFire = () => fireAction();
export const triggerReset = () => resetScene();
export const updateBeamPosition = (x: number, y: number) => updateBeamPos(x, y);

// 2d canvas
function makeCanvas(id: string, z: number) {
  const c = document.createElement("canvas");
  c.id = id;
  c.style.cssText = `position:fixed;inset:0;z-index:${z};pointer-events:none;`;
  document.body.appendChild(c);
  c.width = window.innerWidth; c.height = window.innerHeight;
  window.addEventListener("resize", () => { c.width = window.innerWidth; c.height = window.innerHeight; });
  return c;
}

const rayC = makeCanvas("ray-canvas", 3);
const rayCtx = rayC.getContext("2d")!;
let rayOpa = 0, rayRot = 0, rayProgress = 0;

const spdC = makeCanvas("speed-canvas", 6);
const spdCtx = spdC.getContext("2d")!;
let spdOpa = 0;

// ray
function drawAura(ox: number, oy: number) {
  const W = rayC.width, H = rayC.height;
  rayCtx.clearRect(0, 0, W, H);
  if (rayOpa <= 0.005) return;

  const cx = ox * W, cy = oy * H;
  const maxR = Math.hypot(W, H) * 0.95;
  const N = 24;

  for (let i = 0; i < N; i++) {
    const angle = rayRot + (i / N) * Math.PI * 2;
    const thick = i % 4 === 0 ? 0.035 : i % 2 === 0 ? 0.015 : 0.008;
    const bW = thick * Math.min(W, H);

    rayCtx.save();
    rayCtx.translate(cx, cy);
    rayCtx.rotate(angle);

    const g = rayCtx.createLinearGradient(0, 0, maxR, 0);
    g.addColorStop(0, `rgba(255,255,255,${rayOpa})`);
    g.addColorStop(0.2, `rgba(220,240,255,${rayOpa * 0.7})`);
    g.addColorStop(0.6, `rgba(180,220,255,${rayOpa * 0.3})`);
    g.addColorStop(1, "transparent");

    rayCtx.fillStyle = g;
    rayCtx.beginPath();
    rayCtx.moveTo(0, -bW);
    rayCtx.lineTo(maxR, 0);
    rayCtx.lineTo(0, bW);
    rayCtx.fill();
    rayCtx.restore();
  }

  const glow = rayCtx.createRadialGradient(cx, cy, 0, cx, cy, 140 * (1 + rayProgress));
  glow.addColorStop(0, `rgba(255,255,255,${rayOpa * 0.9})`);
  glow.addColorStop(0.5, `rgba(150,200,255,${rayOpa * 0.4})`);
  glow.addColorStop(1, "transparent");
  rayCtx.fillStyle = glow;
  rayCtx.beginPath();
  rayCtx.arc(cx, cy, 200 * (1 + rayProgress), 0, Math.PI * 2);
  rayCtx.fill();
}

// sspeed line
let spdSeed = 0;
function drawSpeedLines() {
  const W = spdC.width, H = spdC.height;
  spdCtx.clearRect(0, 0, W, H);
  if (spdOpa <= 0.005) return;
  const cx = W / 2, cy = H / 2;
  spdSeed++;
  const rng = (s: number) => Math.abs(Math.sin(s * 127.1 + spdSeed * 0.22));

  for (let i = 0; i < 120; i++) {
    const angle = rng(i * 0.45) * Math.PI * 2;
    const xOff = Math.cos(angle);
    const yOff = Math.sin(angle);
    const startR = 20 + rng(i * 0.8) * 120;
    const len = 100 + rng(i * 1.5) * 450;
    const x1 = cx + xOff * startR, y1 = cy + yOff * startR;
    const x2 = cx + xOff * (startR + len), y2 = cy + yOff * (startR + len);

    const g = spdCtx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, `rgba(255,255,255,${spdOpa})`);
    g.addColorStop(0.8, `rgba(180,220,255,${spdOpa * 0.4})`);
    g.addColorStop(1, "transparent");
    spdCtx.strokeStyle = g;
    spdCtx.lineWidth = 0.5 + rng(i * 2.1) * 3;
    spdCtx.beginPath(); spdCtx.moveTo(x1, y1); spdCtx.lineTo(x2, y2); spdCtx.stroke();
  }
}

function makeArcGeo(radius: number) {
  const pts: THREE.Vector3[] = [];
  const segs = 12;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2 + (Math.random() - 0.5) * 1.2;
    const r = radius * (0.4 + Math.random() * 0.9);
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.2));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// scence main
export function initScene(video: HTMLVideoElement) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 250);
  camera.position.z = 3;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.id = "three-canvas";
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 2.5, 0.4, 0.9);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloomPass);

  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  function planeSize() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.tan(vFov / 2) * camera.position.z;
    return { w: h * camera.aspect, h };
  }
  const { w, h } = planeSize();
  const camPlane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: videoTex }));
  camPlane.scale.x = -1;
  scene.add(camPlane);

  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });
  const flashPlane = new THREE.Mesh(new THREE.PlaneGeometry(w * 10, h * 10), flashMat);
  flashPlane.position.z = 2.5;
  scene.add(flashPlane);

  const fx = new THREE.Group();
  scene.add(fx);
  fx.position.set(0, -0.2, 0.5);

  const orbG = new THREE.Group();
  fx.add(orbG);

  function addOrb(radius: number, color: number, blend: THREE.Blending = THREE.AdditiveBlending) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: blend, depthWrite: false });
    const msh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
    orbG.add(msh);
    return mat;
  }

  const orbO1 = addOrb(0.8, 0x1144ff);
  const orbO2 = addOrb(0.6, 0x4488ff);
  const orbO3 = addOrb(0.4, 0x88ccff);
  const orbO4 = addOrb(0.25, 0xbbffff);
  const orbO5 = addOrb(0.12, 0xffffff, THREE.NormalBlending);

  const arcMats: THREE.LineBasicMaterial[] = [];
  const arcLines: THREE.Line[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    arcMats.push(m);
    const l = new THREE.Line(makeArcGeo(0.6 + i * 0.05), m);
    arcLines.push(l);
    fx.add(l);
  }

  const swMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const sw = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.4, 64), swMat);
  fx.add(sw);

  let state: "idle" | "charging" | "firing" = "idle";
  let tl: gsap.core.Timeline | null = null;
  let t = 0, arcT = 0, chargeP = 0;
  let orbSX = 0.5, orbSY = 0.5;

  updateBeamPos = (nx, ny) => {
    orbSX = nx; orbSY = ny;
    const dist = camera.position.z - fx.position.z;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const pH = 2 * Math.tan(vFov / 2) * dist;
    const pW = pH * camera.aspect;
    gsap.to(fx.position, { x: (0.5 - nx) * pW, y: -(ny - 0.5) * pH, duration: 0.08, ease: "power2.out" });
  };

  chargeAction = () => {
    if (state === "charging") return;
    state = "charging"; chargeP = 0;
    if (tl) tl.kill(); tl = gsap.timeline();
    tl.to([orbO1, orbO2, orbO3, orbO4, orbO5], { opacity: 0.9, duration: 1.0, stagger: 0.1 });
    tl.to(arcMats, { opacity: 0.8, duration: 0.8 }, 0.2);
    gsap.to(bloomPass, { strength: 4.5, duration: 2.0 });
    gsap.to({ v: 0 }, { v: 1, duration: 2.0, onUpdate: function () { rayOpa = this.targets()[0].v; } });
  };

  fireAction = () => {
    if (state === "firing") return;
    state = "firing";
    if (tl) tl.kill(); tl = gsap.timeline();

    // 100% white screen
    tl.set(flashMat, { opacity: 1 }, 0);

    // white screen for 1.5 seconds 
    tl.to(flashMat, { opacity: 1, duration: 1.5 }, 0.05);

    // fade solwy
    tl.to(flashMat, { opacity: 0, duration: 1.2, ease: "power2.inOut" }, 1.55);

    // clear 
    tl.set([orbO1, orbO2, orbO3, orbO4, orbO5, ...arcMats], { opacity: 0 }, 0.1);
    tl.call(() => { rayOpa = 0; spdOpa = 0; }, [], 0);

    // boommmmmmmmmmmmmmmmmmmmmmm visual
    gsap.to(bloomPass, { strength: 12, duration: 0.05 });
    gsap.to(bloomPass, { strength: 4, duration: 2.0, delay: 1.55 });

    // sokeewaved
    sw.scale.set(1, 1, 1);
    tl.set(swMat, { opacity: 1 }, 0);
    tl.to(sw.scale, { x: 100, y: 100, duration: 0.8, ease: "power4.out" }, 0);
    tl.to(swMat, { opacity: 0, duration: 0.6, ease: "power2.in" }, 0.1);

    // speed lines burst
    gsap.to({ v: 0 }, { v: 1, duration: 0.1, onUpdate: function () { spdOpa = this.targets()[0].v; } });
    gsap.to({ v: 1 }, { v: 0, duration: 3.5, delay: 0.2, onUpdate: function () { spdOpa = this.targets()[0].v; } });

    // camera shake
    tl.to(camera.position, {
      duration: 3.0,
      onUpdate: () => {
        camera.position.x = (Math.random() - 0.5) * 0.5 * flashMat.opacity;
        camera.position.y = (Math.random() - 0.5) * 0.5 * flashMat.opacity;
      }
    }, 0);

    // ruto-reset after flash
    tl.call(() => resetScene(), [], 3.0);
  };

  // reseter
  resetScene = () => {
    state = "idle"; chargeP = 0; rayOpa = 0; spdOpa = 0;
    soundManager.stopAll();
    gsap.to([orbO1, orbO2, orbO3, orbO4, orbO5, swMat, ...arcMats, flashMat], { opacity: 0, duration: 0.5 });
    gsap.to(bloomPass, { strength: 2.5, duration: 1.0 });
    gsap.to(camera.position, { x: 0, y: 0, z: 3, duration: 0.5 });
    window.dispatchEvent(new CustomEvent("flash-done"));
  };

  // progresssss
  window.addEventListener("KABUFLASH-progress", (e: any) => {
    chargeP = e.detail as number;
    if (state !== "charging") return;
    orbG.scale.setScalar(1 + chargeP * 1.5);
    arcMats.forEach((m, i) => { m.opacity = Math.min(1, chargeP * 1.5 - i * 0.05); });
    rayProgress = chargeP;
  });

  // animationn 
  function animate() {
    requestAnimationFrame(animate);
    t += 0.02; arcT += 0.02;
    if (state === "charging") {
      const s = (1 + chargeP * 1.5) * (1 + Math.sin(t * 20) * 0.05);
      orbG.scale.setScalar(s);
      orbO5.opacity = 0.8 + Math.sin(t * 40) * 0.2;
      if (arcT > 0.06) {
        arcT = 0;
        arcLines.forEach((l, i) => { l.geometry.dispose(); l.geometry = makeArcGeo(0.6 + chargeP * 1.2 + i * 0.05); });
      }
      rayRot += 0.02 + chargeP * 0.05;
    }
    drawAura(1 - orbSX, orbSY);
    drawSpeedLines();
    videoTex.needsUpdate = true;
    composer.render();
  }
  animate();
}