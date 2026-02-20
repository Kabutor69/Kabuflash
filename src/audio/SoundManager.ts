// sound logic
export class SoundManager {
    private audioCtx: AudioContext | null = null;
    private masterGain: GainNode | null = null;

    // energy loop
    private chargeOscs: OscillatorNode[] = [];
    private chargeGain: GainNode | null = null;

    // cleanup nodes
    private fireNodes: AudioNode[] = [];

    constructor() {
        this.initAudio();
    }

    private initAudio() {
        try {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = 0.9;
            this.masterGain.connect(this.audioCtx.destination);
        } catch (e) {
            console.warn("Audio init failed:", e);
        }
    }

    resume() {
        if (this.audioCtx?.state === "suspended") {
            this.audioCtx.resume();
        }
    }

    // charge sound logic
    playCharge() {
        this.resume();
        if (!this.audioCtx || !this.masterGain) return;

        this.stopAll();

        const ctx = this.audioCtx;
        const t = ctx.currentTime;

        this.chargeGain = ctx.createGain();
        this.chargeGain.gain.setValueAtTime(0, t);
        this.chargeGain.gain.linearRampToValueAtTime(0.6, t + 0.4);
        this.chargeGain.connect(this.masterGain);

        const freqs = [70, 110, 180];

        freqs.forEach(f => {
            const osc = ctx.createOscillator();
            osc.type = "sawtooth";

            osc.frequency.setValueAtTime(f, t);
            osc.frequency.exponentialRampToValueAtTime(f * 3.2, t + 2.5);

            const filter = ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(180, t);
            filter.frequency.exponentialRampToValueAtTime(4200, t + 2.0);

            osc.connect(filter);
            filter.connect(this.chargeGain!);

            osc.start();
            this.chargeOscs.push(osc);
        });
    }

    // boom sounds (detonationnn)
    playFire() {
        this.resume();
        if (!this.audioCtx || !this.masterGain) return;

        this.stopAll();

        const ctx = this.audioCtx;
        const t = ctx.currentTime;

        // main boom
        const boomGain = ctx.createGain();
        boomGain.gain.setValueAtTime(1.0, t);
        boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 4.0);
        boomGain.connect(this.masterGain);
        this.fireNodes.push(boomGain);

        // initial blast 
        const burstBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
        const burstData = burstBuffer.getChannelData(0);

        for (let i = 0; i < burstData.length; i++) {
            burstData[i] = Math.random() * 2 - 1;
        }

        const burst = ctx.createBufferSource();
        burst.buffer = burstBuffer;

        const burstFilter = ctx.createBiquadFilter();
        burstFilter.type = "lowpass";
        burstFilter.frequency.value = 180;

        const burstGain = ctx.createGain();
        burstGain.gain.setValueAtTime(1.4, t);
        burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        burst.connect(burstFilter);
        burstFilter.connect(burstGain);
        burstGain.connect(boomGain);

        burst.start(t);
        burst.stop(t + 0.2);

        this.fireNodes.push(burst, burstFilter, burstGain);

        // deep sub layer
        const sub = ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.setValueAtTime(140, t);
        sub.frequency.exponentialRampToValueAtTime(38, t + 1.3);
        sub.frequency.exponentialRampToValueAtTime(26, t + 4.0);

        const subGain = ctx.createGain();
        subGain.gain.value = 0.9;

        sub.connect(subGain);
        subGain.connect(boomGain);

        sub.start(t);
        sub.stop(t + 4.0);

        this.fireNodes.push(sub, subGain);

        // audible punch layer
        const punch = ctx.createOscillator();
        punch.type = "triangle";

        punch.frequency.setValueAtTime(220, t);
        punch.frequency.exponentialRampToValueAtTime(90, t + 0.6);
        punch.frequency.exponentialRampToValueAtTime(70, t + 2.2);

        const punchGain = ctx.createGain();
        punchGain.gain.setValueAtTime(0.75, t);
        punchGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);

        punch.connect(punchGain);
        punchGain.connect(boomGain);

        punch.start(t);
        punch.stop(t + 2.2);

        this.fireNodes.push(punch, punchGain);

        // rumble layer
        const rumbleBuffer = ctx.createBuffer(1, ctx.sampleRate * 4.0, ctx.sampleRate);
        const rumbleData = rumbleBuffer.getChannelData(0);

        for (let i = 0; i < rumbleData.length; i++) {
            rumbleData[i] = (Math.random() * 2 - 1) * 0.6;
        }

        const rumble = ctx.createBufferSource();
        rumble.buffer = rumbleBuffer;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.setValueAtTime(240, t);
        lowpass.frequency.exponentialRampToValueAtTime(60, t + 4.0);

        const rumbleGain = ctx.createGain();
        rumbleGain.gain.setValueAtTime(0.35, t);
        rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t + 4.0);

        rumble.connect(lowpass);
        lowpass.connect(rumbleGain);
        rumbleGain.connect(boomGain);

        rumble.start(t);
        rumble.stop(t + 4.0);

        this.fireNodes.push(rumble, lowpass, rumbleGain);
    }

    // stop all stuff
    stopAll() {
        this.chargeOscs.forEach(o => { try { o.stop(); } catch { } });
        this.chargeOscs = [];

        this.fireNodes.forEach(n => {
            try { (n as any).stop?.(); } catch { }
            try { n.disconnect(); } catch { }
        });
        this.fireNodes = [];

        if (this.chargeGain) {
            try { this.chargeGain.disconnect(); } catch { }
            this.chargeGain = null;
        }
    }

    // compatibility
    get currentAudioTime() { return 0; }
    get fireTimestamp() { return 2.0; }
}

export const soundManager = new SoundManager();