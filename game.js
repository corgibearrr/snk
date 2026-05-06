// =============================================================
// SHOTGUN & KATANA — Main Game Logic
// =============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W = window.innerWidth;
let H = window.innerHeight;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
}
window.addEventListener('resize', resize);
resize();

// =============================================================
// GLOBAL STATE
// =============================================================
const STATE = {
  running: false,
  paused: false,
  phase: 1,
  phaseTimer: 0,
  phaseStartTime: 0,
  bossActive: false,
  bossWarning: false,
  bossPendingLevel: 0,
  bossDefeated: false,
  inLimitBreak: false,
  inShop: false,
  inCheat: false,
  hitstop: 0,           // freeze frame timer (ms)
  shake: 0,             // screen shake intensity
  cheatBacktick: [],    // recent backtick presses
  gameOver: false,
  ended: false,
  time: 0,              // accumulated game time (sec)
  realTime: 0,          // ms
};

const KEYS = {};
const MOUSE = { x: W/2, y: H/2, worldX: 0, worldY: 0, leftDown: false, rightDown: false, leftHoldTime: 0, rightHoldTime: 0 };

// =============================================================
// INPUT
// =============================================================
window.addEventListener('keydown', (e) => {
  KEYS[e.key.toLowerCase()] = true;
  KEYS[e.code] = true;
  
  // Cheat: backtick x3
  if (e.key === '`') {
    const now = performance.now();
    STATE.cheatBacktick.push(now);
    STATE.cheatBacktick = STATE.cheatBacktick.filter(t => now - t < 1500);
    if (STATE.cheatBacktick.length >= 3) {
      STATE.cheatBacktick = [];
      openCheat();
    }
  }
  
  // E for shop (toggle) / 게임오버 시 재시작
  if (e.key.toLowerCase() === 'e') {
    if (STATE.gameOver) {
      // 게임오버 상태에서 E 누르면 페이지 새로고침으로 처음부터
      location.reload();
      return;
    }
    if (STATE.running) {
      if (STATE.inShop) {
        closeShop();
      } else if (!STATE.paused && !STATE.inLimitBreak && !STATE.bossActive && !STATE.inCheat) {
        openShop();
      }
    }
  }
  
  // Esc closes shop
  if (e.key === 'Escape') {
    if (STATE.inShop) closeShop();
    if (STATE.inCheat) closeCheat();
  }
});
window.addEventListener('keyup', (e) => {
  KEYS[e.key.toLowerCase()] = false;
  KEYS[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
  MOUSE.x = e.clientX;
  MOUSE.y = e.clientY;
});
canvas.addEventListener('mousedown', (e) => {
  if (!STATE.running || STATE.paused) return;
  if (e.button === 0) { MOUSE.leftDown = true; MOUSE.leftHoldTime = 0; }
  if (e.button === 2) { MOUSE.rightDown = true; MOUSE.rightHoldTime = 0; }
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0 && MOUSE.leftDown) {
    MOUSE.leftDown = false;
    if (player) player.releaseShoot();
  }
  if (e.button === 2 && MOUSE.rightDown) {
    MOUSE.rightDown = false;
    if (player) player.releaseSlash();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// =============================================================
// MATH
// =============================================================
const TAU = Math.PI * 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

// =============================================================
// AUDIO (Web Audio API generated SFX)
// =============================================================
let audioCtx = null;
let musicGain = null, sfxGain = null;
let musicOn = true;
let musicNodes = [];

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.15;
  musicGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.3;
  sfxGain.connect(audioCtx.destination);
  preloadAllSfx();
}

// ===== SFX FILE OVERRIDES =====
// 효과음 파일을 sounds/ 폴더에 두고 아래 매핑에 추가하면 절차생성음 대신 사용됩니다.
// 사용 가능한 type: 'shoot', 'reload', 'slash', 'charge', 'hit', 'death', 'pickup', 'explode'
// 파일이 없으면 자동으로 절차 생성 효과음으로 되돌아갑니다.
// 효과음 파일을 sounds/ 폴더에 두면 자동으로 절차생성음 대신 사용됩니다.
// 사용 가능한 type: 'shoot', 'reload', 'slash', 'charge', 'hit', 'death', 'pickup', 'explode'
// 파일이 없으면 자동으로 절차 생성 효과음으로 되돌아갑니다.
// 특정 효과음만 쓰고 싶으면 다른 항목을 빈 문자열 ''로 바꾸세요.
const SFX_FILES = {
  'shoot': 'sounds/shoot.mp3',
  'reload': 'sounds/reload.mp3',
  'slash': 'sounds/slash.mp3',
  'charge': 'sounds/charge.mp3',
  'hit': 'sounds/hit.mp3',
  'death': 'sounds/death.mp3',
  'pickup': 'sounds/pickup.mp3',
  'explode': 'sounds/explode.mp3',
};
const SFX_VOLUME = 1;

const _sfxBuffers = {};   // decoded AudioBuffers
const _sfxFailed = {};    // types that failed to load → use procedural

function preloadSfxFile(type, url) {
  fetch(url)
    .then(r => { if (!r.ok) throw new Error('404'); return r.arrayBuffer(); })
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => { _sfxBuffers[type] = decoded; })
    .catch(() => { _sfxFailed[type] = true; });
}

function preloadAllSfx() {
  if (!audioCtx) return;
  for (const [type, url] of Object.entries(SFX_FILES)) {
    if (!url) continue;  // 빈 문자열은 절차생성 사용
    if (!_sfxBuffers[type] && !_sfxFailed[type]) {
      preloadSfxFile(type, url);
    }
  }
}

function sfx(type) {
  if (!audioCtx) return;
  
  // Try file-based SFX first
  if (SFX_FILES[type] && _sfxBuffers[type]) {
    const src = audioCtx.createBufferSource();
    src.buffer = _sfxBuffers[type];
    const g = audioCtx.createGain();
    g.gain.value = SFX_VOLUME;
    src.connect(g);
    g.connect(sfxGain);
    src.start();
    return;
  }
  
  // Procedural fallback
  const t = audioCtx.currentTime;
  
  if (type === 'shoot') {
    // shotgun blast
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.15, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 8);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    const g = audioCtx.createGain();
    g.gain.value = 0.6;
    src.connect(filter); filter.connect(g); g.connect(sfxGain);
    src.start();
  } else if (type === 'reload') {
    const o = audioCtx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.1);
  } else if (type === 'slash') {
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(800, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.2);
  } else if (type === 'charge') {
    const o = audioCtx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.3);
  } else if (type === 'hit') {
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.05, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 15);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const g = audioCtx.createGain();
    g.gain.value = 0.4;
    src.connect(g); g.connect(sfxGain);
    src.start();
  } else if (type === 'death') {
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.3);
  } else if (type === 'pickup') {
    const o = audioCtx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(800, t);
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.1);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.15);
  } else if (type === 'explode') {
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 4);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const g = audioCtx.createGain();
    g.gain.value = 0.8;
    src.connect(filter); filter.connect(g); g.connect(sfxGain);
    src.start();
  }
}

// HEAVY METAL-ISH MUSIC LOOP (procedural)
// ===== BGM CONFIG =====
// 외부 음악 파일을 사용하려면 아래 BGM_FILE 경로를 지정하세요.
// 빈 문자열("")이면 절차 생성된 헤비메탈 BGM을 사용합니다.
// 예시: const BGM_FILE = 'sounds/bgm.mp3';
const BGM_FILE = 'sounds/bgm.mp3';
const BGM_VOLUME = 0.4;  // 0.0 ~ 1.0 (파일 BGM 음량)

let bgmAudio = null;
let useProceduralMusic = false;

function startMusic() {
  if (!audioCtx || !musicOn) return;
  stopMusic();
  
  // 1) Try external file first
  if (BGM_FILE && !useProceduralMusic) {
    if (!bgmAudio) {
      bgmAudio = new Audio(BGM_FILE);
      bgmAudio.loop = true;
      bgmAudio.volume = BGM_VOLUME;
      bgmAudio.addEventListener('error', () => {
        // File missing or unsupported → fallback
        console.warn('BGM file not found at ' + BGM_FILE + ' — falling back to procedural music.');
        useProceduralMusic = true;
        bgmAudio = null;
        if (musicOn) startMusic();
      });
    }
    bgmAudio.currentTime = 0;
    bgmAudio.play().catch(err => {
      // Autoplay blocked or other error → fallback
      console.warn('BGM playback failed:', err);
      useProceduralMusic = true;
      bgmAudio = null;
      startMusic();
    });
    return;
  }
  
  // 2) Procedural heavy metal fallback
  const bpm = 180;
  const beat = 60 / bpm;
  
  const riff = [
    {n: 55, d: 0.5}, {n: 55, d: 0.25}, {n: 58, d: 0.25}, {n: 60, d: 0.5},
    {n: 55, d: 0.25}, {n: 53, d: 0.25}, {n: 50, d: 0.5}, {n: 55, d: 0.5},
    {n: 55, d: 0.5}, {n: 55, d: 0.25}, {n: 62, d: 0.25}, {n: 60, d: 0.5},
    {n: 58, d: 0.25}, {n: 55, d: 0.25}, {n: 53, d: 0.5}, {n: 50, d: 0.5},
  ];
  
  const noteToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
  
  let t = audioCtx.currentTime + 0.1;
  
  function scheduleLoop(startT) {
    let curT = startT;
    for (const note of riff) {
      const dur = note.d * beat;
      const freq = noteToFreq(note.n);
      
      const o1 = audioCtx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = freq;
      const o2 = audioCtx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = freq * 1.005;
      const filt = audioCtx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1500;
      filt.Q.value = 5;
      const dist = audioCtx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = Math.tanh(x * 4);
      }
      dist.curve = curve;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0, curT);
      g.gain.linearRampToValueAtTime(0.3, curT + 0.005);
      g.gain.linearRampToValueAtTime(0.2, curT + dur * 0.3);
      g.gain.linearRampToValueAtTime(0, curT + dur * 0.95);
      
      o1.connect(filt); o2.connect(filt);
      filt.connect(dist); dist.connect(g); g.connect(musicGain);
      o1.start(curT); o2.start(curT);
      o1.stop(curT + dur); o2.stop(curT + dur);
      musicNodes.push(o1, o2);
      
      curT += dur;
    }
    return curT;
  }
  
  let schedulerTimer = null, drumTimer = null;
  
  function loopScheduler() {
    if (!musicOn || !audioCtx || !useProceduralMusic) return;
    const lookahead = 2;
    while (t < audioCtx.currentTime + lookahead) {
      t = scheduleLoop(t);
    }
    schedulerTimer = setTimeout(loopScheduler, 500);
  }
  
  function drumLoop() {
    if (!musicOn || !audioCtx || !useProceduralMusic) return;
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.1, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const decay = Math.exp(-i / data.length * 6);
      data[i] = Math.sin(2 * Math.PI * 60 * (i / audioCtx.sampleRate) * Math.exp(-i / data.length * 3)) * decay;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const g = audioCtx.createGain();
    g.gain.value = 0.5;
    src.connect(g); g.connect(musicGain);
    src.start();
    drumTimer = setTimeout(drumLoop, beat * 500);
  }
  
  loopScheduler();
  drumLoop();
}

function stopMusic() {
  if (bgmAudio) {
    try { bgmAudio.pause(); } catch(e) {}
  }
  musicNodes.forEach(n => { try { n.stop(); } catch(e) {} });
  musicNodes = [];
}

document.getElementById('musicToggle').addEventListener('click', () => {
  musicOn = !musicOn;
  document.getElementById('musicToggle').textContent = musicOn ? '♪ MUSIC: ON' : '♪ MUSIC: OFF';
  if (musicOn) startMusic();
  else stopMusic();
});

// =============================================================
// CAMERA
// =============================================================
const CAM = { x: 0, y: 0, shakeX: 0, shakeY: 0 };
const WORLD = { w: 6000, h: 6000 };

function worldToScreen(wx, wy) {
  return { x: wx - CAM.x + CAM.shakeX, y: wy - CAM.y + CAM.shakeY };
}
function screenToWorld(sx, sy) {
  return { x: sx + CAM.x - CAM.shakeX, y: sy + CAM.y - CAM.shakeY };
}

// =============================================================
// ENTITIES POOLS
// =============================================================
let player = null;
let enemies = [];
let bullets = [];        // player bullets
let enemyBullets = [];
let particles = [];
let pickups = [];
let obstacles = [];
let effects = [];        // visual effects (slash arcs, explosions)
let damageNumbers = [];
let bloodstains = [];    // 샷건 처치 시 남는 핏자국 (오래 지속)
let respawnQueue = [];   // 파괴된 장애물 리스폰 큐 ({x, y, w, h, explosive, timer})
let holograms = [];      // 리스폰 직전 표시되는 푸른 홀로그램
let bossEntity = null;

// =============================================================
// PLAYER
// =============================================================
class Player {
  constructor() {
    this.x = WORLD.w / 2;
    this.y = WORLD.h / 2;
    this.r = 28;
    this.speed = 430;
    this.angle = 0;
    
    // Battery
    this.batteryMax = 100;
    this.battery = 100;
    this.batteryRegen = 9; // per sec (기존 12에서 30% 감소)
    this.batteryRegenDelay = 0;  // 배터리 소모 직후 재생 정지 시간 (초)
    
    // 목숨 시스템 (3목숨)
    this.lives = 3;
    this.maxLives = 3;
    this.invulnTime = 0;     // 부활 후 무적 시간
    
    // Roll
    this.rolling = false;
    this.rollTime = 0;
    this.rollDuration = 0.30;
    this.rollCooldown = 0;
    this.rollCdMax = 0.6;
    this.rollCost = 15;
    this.rollSpeed = 1550;
    this.rollDir = {x: 1, y: 0};
    
    // Shotgun
    this.ammo = 120;
    this.ammoMax = 360;
    this.baseShots = 3;
    this.maxCharge = 12;
    this.charged = 0;
    this.chargeTimer = 0;
    this.chargeInterval = 0.1;
    this.chargeFullDuration = 1.2;  // 풀충전까지 걸리는 총 시간 (고정)
    this.spreadAngle = 45 * Math.PI / 180;
    this.bulletRange = 1200;
    this.bulletSpeed = 4200;
    this.fireCooldown = 0;
    this.fireCdMax = 0.25;
    
    // Katana
    this.slashCharge = 0;       // 0..3 stages
    this.slashChargeTimer = 0;
    this.slashStage1Time = 0.4;
    this.slashStage2Time = 0.9;
    this.slashStage3Time = 1.5;
    this.slashCost = [15, 25, 40];
    this.slashRange = [270, 382, 494];     // 기존 [135, 191, 247] × 2 (캐릭터 크기와 동일 비율)
    this.slashDamage = 12;
    this.slashCooldown = 0;
    this.slashCdMax = 0.3;
    
    // Money
    this.btc = 0;
    
    // upgrades
    this.upgrades = {};  // {key: level}
    this.limitBreaks = []; // names
    
    // Animation
    this.animTime = 0;
    this.animState = 'idle'; // idle, walk, shoot, slash
    this.shootAnimTime = 0;
    this.slashAnimTime = 0;
    this.warningPulse = 0;
    this.anim = makeAnimController();   // 프레임 애니메이션 컨트롤러
    this.facingLeft = false;            // 마우스가 왼쪽이면 true (좌우 반전용)
    this.trailFrames = [];              // 대시 잔상: {x, y, state, frameIdx, flip, life}
    this.trailSpawnTimer = 0;
    // 속도 추적 (적의 lead aiming용)
    this.vx = 0;
    this.vy = 0;
    this._prevX = this.x;
    this._prevY = this.y;
  }
  
  hasUpgrade(key) { return this.limitBreaks.includes(key); }
  getShopLevel(key) { return this.upgrades[key] || 0; }
  
  update(dt) {
    // 속도 추적 (지난 프레임 대비 변위 / dt)
    if (dt > 0) {
      this.vx = (this.x - this._prevX) / dt;
      this.vy = (this.y - this._prevY) / dt;
    }
    this._prevX = this.x;
    this._prevY = this.y;
    
    if (this.rollCooldown > 0) this.rollCooldown -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.slashCooldown > 0) this.slashCooldown -= dt;
    
    // Aim
    const m = screenToWorld(MOUSE.x, MOUSE.y);
    MOUSE.worldX = m.x; MOUSE.worldY = m.y;
    this.angle = Math.atan2(m.y - this.y, m.x - this.x);
    
    // Battery regen (소모 직후 1초 동안 정지)
    let batteryMaxEff = this.batteryMax;
    if (this.upgrades['ionSlot']) batteryMaxEff *= (1 + 0.2 * this.upgrades['ionSlot']);
    let regenRate = this.batteryRegen;
    if (this.upgrades['ionCharger']) regenRate *= (1 + 0.2 * this.upgrades['ionCharger']);
    if (this.batteryRegenDelay > 0) {
      this.batteryRegenDelay -= dt;
    } else {
      this.battery = Math.min(batteryMaxEff, this.battery + regenRate * dt);
    }
    
    // Roll
    if (this.rolling) {
      this.rollTime -= dt;
      this.x += this.rollDir.x * this.rollSpeed * dt * (this.hasUpgrade('slidingBoots') ? 1.4 : 1);
      this.y += this.rollDir.y * this.rollSpeed * dt * (this.hasUpgrade('slidingBoots') ? 1.4 : 1);
      
      // Spawn trail particles
      if (Math.random() < 0.7) {
        particles.push(new Particle(this.x, this.y, rand(-30,30), rand(-30,30), 0.4, '#00d4ff', 6));
      }
      
      // 대시 잔상: 일정 간격마다 캐릭터 스냅샷을 기록
      this.trailSpawnTimer -= dt;
      if (this.trailSpawnTimer <= 0) {
        this.trailFrames.push({
          x: this.x, y: this.y,
          state: this.anim.state,
          frameIdx: this.anim.frameIdx,
          flip: this.facingLeft,
          life: 0.35,    // 잔상 지속 시간
          life0: 0.35,
        });
        this.trailSpawnTimer = 0.04;  // 약 25fps로 잔상 생성
        // 너무 많이 쌓이지 않도록 제한
        if (this.trailFrames.length > 12) this.trailFrames.shift();
      }
      
      // Shukoji: damage enemies on roll
      if (this.hasUpgrade('shukoji')) {
        for (const en of enemies) {
          if (en.dead) continue;
          if (dist(this, en) < this.r + en.r + 8) {
            en.takeDamage(2);
          }
        }
        if (bossEntity && !bossEntity.dead) {
          if (dist(this, bossEntity) < this.r + bossEntity.r + 8) bossEntity.takeDamage(2);
        }
      }
      
      if (this.rollTime <= 0) {
        this.rolling = false;
      }
    } else {
      // Movement
      let mx = 0, my = 0;
      if (KEYS['w']) my -= 1;
      if (KEYS['s']) my += 1;
      if (KEYS['a']) mx -= 1;
      if (KEYS['d']) mx += 1;
      const len = Math.hypot(mx, my);
      if (len > 0) { mx /= len; my /= len; }
      
      // 쉬프트 = 스프린트 (배터리 지속 소모, 1.7배 속도)
      // - 실제로 움직이고 있을 때만 (mx/my 가 0이 아닌 경우) 발동
      // - 배터리가 0 이상일 때만 작동, 0 도달 시 자동 해제
      const sprintCostPerSec = 18;       // 초당 배터리 18 소모
      const sprintMult = 2.55;
      const sprintKey = KEYS['shift'] || KEYS['Shift'] || KEYS['ShiftLeft'] || KEYS['ShiftRight'];
      const isSprinting = sprintKey && (mx || my) && this.battery > 0;
      const speedMult = isSprinting ? sprintMult : 1;
      
      this.x += mx * this.speed * speedMult * dt;
      this.y += my * this.speed * speedMult * dt;
      
      if (isSprinting) {
        this.battery = Math.max(0, this.battery - sprintCostPerSec * dt);
        // 스프린트 중엔 배터리 회복 정지 살짝 유지 (스프린트 멈추자마자 회복되는 부자연스러움 방지)
        this.batteryRegenDelay = Math.max(this.batteryRegenDelay, 0.3);
        // 잔상 파티클 살짝 (대시처럼 강하지 않고 가볍게)
        if (Math.random() < 0.25) {
          particles.push(new Particle(this.x, this.y, rand(-15,15), rand(-15,15), 0.25, '#88ccff', 4));
        }
      }
      
      this.animState = (mx || my) ? 'walk' : 'idle';
      
      // Roll trigger
      if (KEYS[' '] && this.rollCooldown <= 0 && this.battery >= this.rollCost && (mx || my)) {
        this.rolling = true;
        this.rollTime = this.rollDuration * (this.hasUpgrade('slidingBoots') ? 1.2 : 1);
        this.rollCooldown = this.rollCdMax * (this.hasUpgrade('slidingBoots') ? 0.7 : 1);
        this.battery -= this.rollCost;
        this.batteryRegenDelay = 1.0;  // 구르기 후 1초 재생 정지
        this.rollDir = {x: mx, y: my};
        sfx('charge');
        
        // Run & Gun
        if (this.hasUpgrade('runAndGun')) {
          this.charged = this.maxChargeEff();
        }
      }
    }
    
    // Clamp to world
    this.x = clamp(this.x, this.r, WORLD.w - this.r);
    this.y = clamp(this.y, this.r, WORLD.h - this.r);
    
    // Shooting (구르는 중엔 사격 불가)
    if (!this.rolling) {
      if (MOUSE.leftDown) {
        MOUSE.leftHoldTime += dt;
        // Tap detection: short tap = quick burst
        if (MOUSE.leftHoldTime < 0.15) {
          // not yet released, charging
        }
        // Hold & charge
        this.chargeTimer += dt;
        const chargeIv = this.chargeIntervalEff();
        if (this.chargeTimer >= chargeIv) {
          this.chargeTimer -= chargeIv;
          // 1 장전 = 탄약 1발 소모 (탄환은 3발 발사됨)
          if (this.charged < this.maxChargeEff() && this.ammo >= this.charged + 1) {
            this.charged++;
            sfx('reload');
          }
        }
      }
    }
    
    // 카타나는 슬라이딩 중에도 사용 가능 (런닝 슬래시)
    // 충전 중에는 배터리 소모 없음. 휘두르면 단계에 따라 일시 소모.
    if (MOUSE.rightDown && this.slashCooldown <= 0) {
      MOUSE.rightHoldTime += dt;
      
      if (this.slashCharge < 3) {
        // Stage transitions
        if (MOUSE.rightHoldTime > this.slashStage1Time && this.slashCharge < 1) {
          this.slashCharge = 1;
          sfx('charge');
        }
        if (MOUSE.rightHoldTime > this.slashStage2Time && this.slashCharge < 2) {
          this.slashCharge = 2;
          sfx('charge');
        }
        if (MOUSE.rightHoldTime > this.slashStage3Time && this.slashCharge < 3) {
          this.slashCharge = 3;
          sfx('charge');
        }
      }
    }
    
    // Anim
    this.animTime += dt;
    this.shootAnimTime = Math.max(0, this.shootAnimTime - dt);
    this.slashAnimTime = Math.max(0, this.slashAnimTime - dt);
    this.invulnTime = Math.max(0, this.invulnTime - dt);
    
    // Facing direction: 마우스 각도 기준 (좌측 반구이면 flip)
    // angle: 0 = 오른쪽, π = 왼쪽
    const ax = Math.cos(this.angle);
    this.facingLeft = ax < 0;
    
    // 우선순위: slash > shoot > walk > idle
    let nextState;
    if (this.slashAnimTime > 0) nextState = 'slash';
    else if (this.shootAnimTime > 0) nextState = 'shoot';
    else if (this.animState === 'walk') nextState = 'walk';
    else nextState = 'idle';
    this.anim.setState(nextState);
    this.anim.update(dt);
    
    // Warning pulse
    this.warningPulse += dt * 8;
    
    // 잔상 프레임 라이프 감소
    for (let i = this.trailFrames.length - 1; i >= 0; i--) {
      this.trailFrames[i].life -= dt;
      if (this.trailFrames[i].life <= 0) {
        this.trailFrames.splice(i, 1);
      }
    }
  }
  
  maxChargeEff() {
    return this.maxCharge + (this.upgrades['maxCharge'] || 0) * 3;
  }
  // 풀충전까지 걸리는 시간을 maxCharge 와 무관하게 일정하게 유지.
  // 즉 maxCharge 가 늘어나면 한 발 장전 간격이 그만큼 짧아짐.
  chargeIntervalEff() {
    return this.chargeFullDuration / this.maxChargeEff();
  }
  baseShotsEff() {
    return this.baseShots + (this.upgrades['baseShots'] || 0);
  }
  ammoMaxEff() {
    return this.ammoMax + (this.upgrades['ammoMax'] || 0) * 30;
  }
  spreadEff() {
    let s = this.spreadAngle;
    // 조준경 업그레이드 (상점): 레벨당 5도씩 산탄 좁힘
    const scopeLv = this.upgrades['scope'] || 0;
    s -= (5 * Math.PI / 180) * scopeLv;
    return Math.max(3 * Math.PI / 180, s);
  }
  rangeEff() {
    // 조준경 업그레이드: 레벨당 +200px 사거리
    return this.bulletRange + (this.upgrades['scope'] || 0) * 200;
  }
  slashDamageEff() {
    let d = this.slashDamage;
    if (this.upgrades['katanaDmg']) d *= (1 + 0.3 * this.upgrades['katanaDmg']);
    return d;
  }
  slashRangeMult() {
    // 카타나 범위 업그레이드: 레벨당 +20%
    return 1 + 0.2 * (this.upgrades['katanaRange'] || 0);
  }
  
  releaseShoot() {
    if (this.rolling) return;
    if (this.fireCooldown > 0) return;
    
    // 탄약 vs 탄환 구분:
    // - 탄약 1발 = 발사되는 탄환 3발
    // - 베이스 발사 = 탄약 1발 → 탄환 baseShotsEff() 발 (기본 3, 업글로 +1씩)
    // - 충전 발사 = 탄약 N발 → 탄환 N×3 발
    let ammoUsed;     // 차감할 탄약 수
    let bulletCount;  // 발사할 탄환 수
    let isFullCharge = false;
    
    if (this.charged > 0) {
      ammoUsed = this.charged;
      bulletCount = this.charged * 3;
      isFullCharge = (this.charged >= this.maxChargeEff());
      this.charged = 0;
    } else {
      ammoUsed = 1;
      bulletCount = this.baseShotsEff();
    }
    
    // 탄약 부족 시 가능한 만큼만 발사
    if (this.ammo < ammoUsed) {
      ammoUsed = this.ammo;
      bulletCount = ammoUsed * 3;
      if (ammoUsed === 0) {
        this.chargeTimer = 0;
        return;
      }
      isFullCharge = false;
    }
    
    this.ammo -= ammoUsed;
    this.fireCooldown = this.fireCdMax;
    this.shootAnimTime = 0.18;
    this.chargeTimer = 0;
    
    // Damage multiplier: 많이 장전할수록 ↑
    const dmgMult = 1 + (ammoUsed >= 6 ? 0.5 : (ammoUsed >= 3 ? 0.25 : 0));
    
    const spread = this.spreadEff();
    for (let i = 0; i < bulletCount; i++) {
      const a = this.angle + (Math.random() - 0.5) * spread;
      const speed = this.bulletSpeed * rand(0.85, 1.1);
      const b = new Bullet(this.x, this.y, Math.cos(a) * speed, Math.sin(a) * speed, this.rangeEff(), 1 * dmgMult);
      bullets.push(b);
    }
    
    // 풀충전 시 근거리 충격파 데미지
    if (isFullCharge) {
      const blastRange = 360;
      const blastDmg = 5;  // 근접한 적 즉사급
      // 시각 효과: 폭발 + 충격파 링
      effects.push(new Explosion(this.x, this.y, blastRange, 0));
      STATE.shake = Math.max(STATE.shake, 30);
      STATE.hitstop = Math.max(STATE.hitstop, 80);
      
      // AoE 데미지
      for (const en of enemies) {
        if (en.dead) continue;
        if (dist(this, en) < blastRange + en.r) {
          en.takeDamage(blastDmg);
        }
      }
      if (bossEntity && !bossEntity.dead && dist(this, bossEntity) < blastRange + bossEntity.r) {
        bossEntity.takeDamage(blastDmg);
      }
      // 폭발물도 터트림
      for (const ob of obstacles) {
        if (ob.dead || !ob.explosive) continue;
        if (dist(this, ob) < blastRange) ob.takeDamage(99);
      }
      
      // 추가 머즐플래시
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * TAU;
        particles.push(new Particle(
          this.x + Math.cos(this.angle) * 60,
          this.y + Math.sin(this.angle) * 60,
          Math.cos(a) * rand(150, 500),
          Math.sin(a) * rand(150, 500),
          0.5, '#ffffff', 8
        ));
      }
    }
    
    sfx('shoot');
    STATE.shake = Math.min(35, STATE.shake + 5 + bulletCount * 0.3);
    // Recoil
    this.x -= Math.cos(this.angle) * Math.min(bulletCount, 12) * 0.3;
    this.y -= Math.sin(this.angle) * Math.min(bulletCount, 12) * 0.3;
    
    // muzzle flash particle
    for (let i = 0; i < 8; i++) {
      const a = this.angle + (Math.random() - 0.5) * spread;
      particles.push(new Particle(
        this.x + Math.cos(this.angle) * 60,
        this.y + Math.sin(this.angle) * 60,
        Math.cos(a) * rand(100, 300),
        Math.sin(a) * rand(100, 300),
        0.3, '#ffcc00', 6
      ));
    }
  }
  
  releaseSlash() {
    // 슬라이딩(rolling) 중에도 칼 휘두르기 가능 — 더 많은 적을 한 번에 벨 수 있음
    if (this.slashCooldown > 0) return;
    
    const stage = this.slashCharge;
    // 휘두를 때 배터리 일시 소모 (단계별)
    // 0단계(짧게 클릭): 10, 1단계: 15, 2단계: 25, 3단계: 40
    const cost = stage > 0 ? this.slashCost[stage - 1] : 10;
    
    // 배터리 부족 시 휘두르기 불가 (충전 상태 초기화 + 사운드 피드백)
    if (this.battery < cost) {
      this.slashCharge = 0;
      MOUSE.rightHoldTime = 0;
      // 짧은 경고: 작은 쿨다운 + 화면 흔들림 약간 (헛스윙 느낌)
      this.slashCooldown = 0.15;
      // 시각 피드백 — 배터리 경고를 강조하기 위해 warningPulse 가속
      this.warningPulse += 4;
      return;
    }
    
    this.battery = Math.max(0, this.battery - cost);
    // 배터리 소모 후 1초간 재생 정지
    this.batteryRegenDelay = 1.0;
    
    this.slashCooldown = this.slashCdMax;
    this.slashAnimTime = 0.32;
    
    const baseRange = stage > 0 ? this.slashRange[stage - 1] : 200;
    const range = baseRange * this.slashRangeMult();
    const damage = this.slashDamageEff();
    
    // Visual + 지속 히트박스 (잔상이 남는 동안 베기/반사 효과)
    effects.push(new SlashEffect(this.x, this.y, range, stage, damage));
    
    sfx('slash');
    
    // Gun-Kata: auto-fire 12 shots
    if (this.hasUpgrade('gunKata') && this.ammo > 0) {
      const n = Math.min(12, this.ammo);
      this.ammo -= n;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        bullets.push(new Bullet(this.x, this.y, Math.cos(a) * this.bulletSpeed, Math.sin(a) * this.bulletSpeed, this.rangeEff(), 1));
      }
    }
    
    // Reset
    this.slashCharge = 0;
    MOUSE.rightHoldTime = 0;
  }
  
  takeDamage() {
    if (this.rolling) return;
    if (STATE.gameOver) return;
    if (this.invulnTime > 0) return;  // 부활 직후 무적
    
    this.lives--;
    sfx('hit');
    STATE.shake = 40;
    STATE.hitstop = 150;
    
    // 피격 파티클
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 250), Math.sin(a) * rand(80, 250), 0.8, '#ff2050', 6));
    }
    
    if (this.lives > 0) {
      // 부활 슬래시: 3단계 충전 슬래시를 무료로 발동
      const range = this.slashRange[2] * this.slashRangeMult();
      const damage = this.slashDamageEff() * 1.5;  // 부활 슬래시는 더 강함
      effects.push(new SlashEffect(this.x, this.y, range, 3, damage));
      
      // 추가 충격파 (모든 적 밀어내기)
      for (const en of enemies) {
        if (en.dead) continue;
        const d = dist(this, en);
        if (d < range * 1.5) {
          const a = angleTo(this, en);
          en.x += Math.cos(a) * 160;
          en.y += Math.sin(a) * 160;
          if (en.meleeTelegraph > 0) en.meleeTelegraph = 0;  // 진행 중인 공격 취소
          if (en.cooldown < 0.5) en.cooldown = 0.5;
        }
      }
      // 모든 적 총알 반사
      for (const eb of enemyBullets) {
        if (eb.dead) continue;
        if (eb.fromPlayer) continue;
        if (dist(this, eb) < range * 2) {
          eb.dx *= -1;
          eb.dy *= -1;
          eb.fromPlayer = true;
          eb.damage = Math.max(eb.damage, 3);
        }
      }
      
      // 시각/사운드 임팩트
      sfx('slash');
      sfx('charge');
      STATE.shake = 50;
      STATE.hitstop = 250;
      
      // 강한 화이트 플래시 (부활 표시)
      effects.push(new Explosion(this.x, this.y, range * 0.8, 0));
      
      // 부활 후 1초 무적 + 배터리 풀충전 보상
      this.invulnTime = 1.2;
      this.battery = this.batteryMax * (1 + 0.2 * (this.upgrades['ionSlot'] || 0));
      
      // 부활 알림 메시지
      showFlash(`목숨 ${this.lives} 남음`, '#ff2050');
    } else {
      // 진짜 게임 오버
      STATE.gameOver = true;
      sfx('death');
      STATE.shake = 60;
      STATE.hitstop = 200;
      
      for (let i = 0; i < 50; i++) {
        const a = Math.random() * TAU;
        particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(100, 400), Math.sin(a) * rand(100, 400), 1.5, '#ff2050', 8));
      }
      
      setTimeout(() => {
        document.getElementById('gameOverScreen').classList.add('show');
      }, 1500);
    }
  }
  
  draw() {
    const s = worldToScreen(this.x, this.y);
    
    // Aim line
    const aimX = s.x + Math.cos(this.angle) * this.rangeEff();
    const aimY = s.y + Math.sin(this.angle) * this.rangeEff();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,32,80,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(aimX, aimY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Spread cone
    const spread = this.spreadEff();
    ctx.fillStyle = 'rgba(255,32,80,0.07)';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, this.rangeEff(), this.angle - spread/2, this.angle + spread/2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,32,80,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(this.angle - spread/2) * this.rangeEff(), s.y + Math.sin(this.angle - spread/2) * this.rangeEff());
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(this.angle + spread/2) * this.rangeEff(), s.y + Math.sin(this.angle + spread/2) * this.rangeEff());
    ctx.stroke();
    ctx.restore();
    
    // Slash charge aura
    if (this.slashCharge > 0) {
      const colors = ['#ffffff', '#ffcc00', '#ffaa00'];
      const color = colors[this.slashCharge - 1];
      ctx.save();
      ctx.shadowBlur = 30;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 + this.slashCharge;
      const radius = 60 + this.slashCharge * 16 + Math.sin(this.animTime * 12) * 6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, TAU);
      ctx.stroke();
      
      // particles
      if (Math.random() < 0.5) {
        const a = Math.random() * TAU;
        particles.push(new Particle(this.x + Math.cos(a) * radius, this.y + Math.sin(a) * radius, Math.cos(a) * 50, Math.sin(a) * 50, 0.5, color, 4));
      }
      ctx.restore();
    }
    
    // Roll glow
    if (this.rolling) {
      ctx.save();
      ctx.shadowBlur = 25;
      ctx.shadowColor = '#00d4ff';
      ctx.fillStyle = 'rgba(0,212,255,0.3)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, this.r + 8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    
    // Try to draw animated sprite
    // 현재 상태 결정 (rolling 은 walk 로 취급)
    let drawState;
    if (this.rolling) drawState = 'walk';
    else if (this.slashAnimTime > 0) drawState = 'slash';
    else if (this.shootAnimTime > 0) drawState = 'shoot';
    else if (this.animState === 'walk') drawState = 'walk';
    else drawState = 'idle';
    
    // anim controller 상태가 다르면 동기화 (draw에서만 보정)
    if (this.anim.state !== drawState) {
      this.anim.setState(drawState);
    }
    
    const size = 128;
    
    // 대시 잔상 그리기 (본체 뒤에 — 가장 오래된 것부터 페이드)
    if (this.trailFrames.length > 0) {
      ctx.save();
      for (const tf of this.trailFrames) {
        const ts = worldToScreen(tf.x, tf.y);
        const a = tf.life / tf.life0;
        ctx.globalAlpha = a * 0.45;
        // 시안 톤으로 살짝 물들이기 (대시 색)
        ctx.filter = 'hue-rotate(160deg) saturate(1.5)';
        drawAnimFrame(tf.state, tf.frameIdx, ts.x, ts.y, size, tf.flip);
      }
      ctx.filter = 'none';
      ctx.restore();
    }
    
    // 사격 시 약간 뒤로 밀리는 반동 효과 (살아있는 느낌 추가)
    let recoilX = 0, recoilY = 0;
    if (this.shootAnimTime > 0) {
      const t = this.shootAnimTime / 0.1; // 0..1
      const back = t * 4;
      recoilX = -Math.cos(this.angle) * back;
      recoilY = -Math.sin(this.angle) * back;
    }
    
    // idle/walk 시 살짝 위아래 보브
    let bobY = 0;
    if (drawState === 'idle') bobY = Math.sin(this.animTime * 4) * 1.5;
    else if (drawState === 'walk') bobY = Math.abs(Math.sin(this.animTime * 14)) * -2;
    
    // 부활 직후 무적: 깜빡거림 효과
    let invulnAlpha = 1;
    if (this.invulnTime > 0) {
      const blink = Math.sin(this.invulnTime * 30);
      invulnAlpha = blink > 0 ? 1 : 0.3;
    }
    
    ctx.save();
    ctx.globalAlpha = invulnAlpha;
    
    const drew = drawAnimFrame(drawState, this.anim.frameIdx,
                               s.x + recoilX, s.y + bobY + recoilY,
                               size, this.facingLeft);
    
    if (!drew) {
      // Fallback: draw character (회전식 도형 렌더링)
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(this.angle);
      drawCharacterFallback(ctx, this.angle, this.shootAnimTime > 0, this.slashAnimTime > 0);
      ctx.restore();
    }
    ctx.restore();
    
    // 무적 중 빨간 오라
    if (this.invulnTime > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 50, 80, ${0.6 * (this.invulnTime / 1.2)})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ff2050';
      const r = 60 + Math.sin(this.animTime * 12) * 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    
    // Charged shots indicator (around player)
    if (this.charged > 0) {
      const max = this.maxChargeEff();
      for (let i = 0; i < this.charged; i++) {
        const a = (i / max) * TAU - Math.PI / 2;
        const px = s.x + Math.cos(a) * 56;
        const py = s.y + Math.sin(a) * 56;
        ctx.fillStyle = '#ffcc00';
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, TAU);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    
    // Battery low warning
    if (this.battery < 15) {
      const alpha = (Math.sin(this.warningPulse) + 1) / 2;
      ctx.save();
      ctx.translate(s.x, s.y - 70);
      ctx.font = 'bold 32px Bebas Neue, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255, 50, 50, ${0.5 + alpha * 0.5})`;
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 12;
      ctx.fillText('⚠', 0, 0);
      ctx.restore();
    }
  }
}

function drawCharacterFallback(ctx, angle, shooting, slashing) {
  // Body
  ctx.fillStyle = '#222';
  ctx.strokeStyle = '#ff2050';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.fill();
  ctx.stroke();
  
  // Coat tail
  ctx.fillStyle = '#1a0008';
  ctx.beginPath();
  ctx.ellipse(-8, 0, 10, 14, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  
  // Gun
  ctx.fillStyle = shooting ? '#ffcc00' : '#444';
  ctx.fillRect(8, -3, 18, 6);
  ctx.strokeRect(8, -3, 18, 6);
  
  // Muzzle flash
  if (shooting) {
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.moveTo(26, -4);
    ctx.lineTo(40, 0);
    ctx.lineTo(26, 4);
    ctx.closePath();
    ctx.fill();
  }
  
  // Katana
  if (slashing) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(35, -15);
    ctx.stroke();
  } else {
    // sheathed
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 5);
    ctx.lineTo(-25, 10);
    ctx.stroke();
  }
  
  // Head
  ctx.fillStyle = '#ddd';
  ctx.beginPath();
  ctx.arc(2, -2, 6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Visor
  ctx.fillStyle = '#ff2050';
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#ff2050';
  ctx.fillRect(2, -3, 6, 2);
  ctx.shadowBlur = 0;
}

// =============================================================
// BULLET (player)
// =============================================================
class Bullet {
  constructor(x, y, dx, dy, range, damage) {
    this.x = x; this.y = y;
    this.dx = dx; this.dy = dy;
    this.range = range;
    this.traveled = 0;
    this.damage = damage;
    this.r = 8;
    this.dead = false;
    this.pierced = [];
  }
  update(dt) {
    const mx = this.dx * dt;
    const my = this.dy * dt;
    this.x += mx;
    this.y += my;
    this.traveled += Math.hypot(mx, my);
    if (this.traveled > this.range) this.dead = true;
    
    // Hit obstacles
    for (const ob of obstacles) {
      if (ob.dead) continue;
      if (this.x > ob.x - ob.w/2 && this.x < ob.x + ob.w/2 && this.y > ob.y - ob.h/2 && this.y < ob.y + ob.h/2) {
        if (player.hasUpgrade('piercing') && Math.random() < 0.5) {
          // pass through
        } else {
          ob.takeDamage(this.damage);
          this.dead = true;
          return;
        }
      }
    }
    
    // Hit enemies
    for (const en of enemies) {
      if (en.dead) continue;
      if (this.pierced.includes(en)) continue;
      
      // 충돌 반경 결정: 방패병의 방패 정면이면 시각 방패 외곽까지 확장
      let effectiveR = en.r;
      if (en.type === 'shielder' && en.shieldHp > 0) {
        // 방패 정면 ±90도인지 — 방패는 적 진행 방향(en.angle)에 있음
        const toBullet = Math.atan2(this.y - en.y, this.x - en.x);
        let diff = toBullet - en.angle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        if (Math.abs(diff) < Math.PI / 2) {
          // 방패 정면 — 더 큰 충돌 반경 사용 (시각 방패 외곽 r+54 와 일치)
          effectiveR = en.r + 54;
        }
      }
      
      if (dist(this, en) < effectiveR + this.r) {
        const wasAlive = !en.dead;
        en.takeDamage(this.damage);
        if (player.hasUpgrade('emp')) en.stunTimer = 0.4;
        damageNumbers.push(new DmgNumber(en.x, en.y - 30, this.damage, '#ffcc00'));
        // 샷건 처치 시 핏자국 (지속)
        if (wasAlive && en.dead) {
          bloodstains.push(new BloodStain(en.x, en.y, en.r));
        }
        if (player.hasUpgrade('piercing') && Math.random() < 0.5) {
          this.pierced.push(en);
        } else {
          this.dead = true;
          return;
        }
      }
    }
    if (bossEntity && !bossEntity.dead) {
      if (!this.pierced.includes(bossEntity) && dist(this, bossEntity) < bossEntity.r + this.r) {
        bossEntity.takeDamage(this.damage);
        if (player.hasUpgrade('emp')) bossEntity.slowTimer = 0.5;
        damageNumbers.push(new DmgNumber(bossEntity.x, bossEntity.y - 50, this.damage, '#ffcc00'));
        if (player.hasUpgrade('piercing') && Math.random() < 0.5) {
          this.pierced.push(bossEntity);
        } else {
          this.dead = true;
          return;
        }
      }
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) return;
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ffcc00';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.r, 0, TAU);
    ctx.fill();
    // trail
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - this.dx * 0.02, s.y - this.dy * 0.02);
    ctx.stroke();
    ctx.restore();
  }
}

// =============================================================
// ENEMY BULLET
// =============================================================
class EnemyBullet {
  constructor(x, y, dx, dy, opts = {}) {
    this.x = x; this.y = y;
    this.dx = dx; this.dy = dy;
    this.r = opts.r || 10;
    this.damage = opts.damage || 1;
    this.life = opts.life || 4;
    this.color = opts.color || '#ff4060';
    this.fast = opts.fast || false;
    this.piercing = opts.piercing || false;   // 장애물 통과 (리퍼 저격용)
    this.fromPlayer = false;
    this.dead = false;
    this.life0 = this.life;
  }
  update(dt) {
    this.x += this.dx * dt;
    this.y += this.dy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    
    // Obstacle (piercing 이면 장애물 통과 — 리퍼 저격 등)
    if (!this.piercing) {
      for (const ob of obstacles) {
        if (ob.dead) continue;
        if (this.x > ob.x - ob.w/2 && this.x < ob.x + ob.w/2 && this.y > ob.y - ob.h/2 && this.y < ob.y + ob.h/2) {
          ob.takeDamage(this.damage);
          this.dead = true;
          return;
        }
      }
    }
    
    if (this.fromPlayer) {
      // Reflected, hit enemies
      for (const en of enemies) {
        if (en.dead) continue;
        if (dist(this, en) < en.r + this.r) {
          en.takeDamage(this.damage);
          this.dead = true;
          return;
        }
      }
      if (bossEntity && !bossEntity.dead) {
        if (dist(this, bossEntity) < bossEntity.r + this.r) {
          bossEntity.takeDamage(this.damage);
          this.dead = true;
          return;
        }
      }
    } else {
      // Hit player
      if (player && !player.rolling && !STATE.gameOver) {
        if (dist(this, player) < player.r + this.r) {
          player.takeDamage();
          this.dead = true;
        }
      }
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) return;
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.fromPlayer ? '#fff' : this.color;
    ctx.fillStyle = this.fromPlayer ? '#fff' : this.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.r, 0, TAU);
    ctx.fill();
    if (this.fast) {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - this.dx * 0.04, s.y - this.dy * 0.04);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// =============================================================
// ENEMIES
// =============================================================
class Enemy {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.type = type;
    this.r = 48;
    this.dead = false;
    this.angle = 0;
    this.cooldown = 0;
    this.stunTimer = 0;
    this.hitFlash = 0;
    this.config = {};
    this.aimLine = null;
    this.meleeTelegraph = 0;   // 근접 공격 예고 시간 (>0 동안 빨간 원 표시, 끝날 때 데미지)
    this.meleeAttackCd = 0;    // 근접 공격 후 쿨다운
    this.meleeRange = 0;       // 근접 공격 발동 거리 (작을수록 가까이 와야 맞음)
    this.facingLeft = false;   // 좌우 반전용 (회전 X)
    
    // Types
    if (type === 'rusher') {
      this.hp = 1; this.maxHp = 1;
      this.speed = 270;
      this.color = '#ff5050';
      this.attackRange = 35;
      this.attackCd = 0.6;
    } else if (type === 'shooter') {
      this.hp = 1; this.maxHp = 1;
      this.speed = 155;
      this.color = '#ff8030';
      this.preferredDist = 360;
      this.attackCd = 1.3;
      this.aimTime = 1.0;     // 사격 전 조준 시간(초)
      this.aiming = 0;         // 현재 조준 중인지 (>0 이면 조준 중, 정지)
    } else if (type === 'shielder') {
      this.hp = 10; this.maxHp = 10;
      this.r = 62;
      this.speed = 75;
      this.color = '#888';
      this.shieldHp = 10;
      this.turnSpeed = 1.8;
      this.attackCd = 1.0;
    } else if (type === 'assassin') {
      this.hp = 1; this.maxHp = 1;
      this.speed = 420;
      this.color = '#ff20a0';
      this.attackRange = 40;
      this.attackCd = 0.4;
      this.dashTimer = 0;
    } else if (type === 'sniper') {
      this.hp = 1; this.maxHp = 1;
      this.speed = 90;
      this.color = '#ffe040';
      this.preferredDist = 500;
      this.aimTime = 2;
      this.aiming = 0;
    }
  }
  
  // 화면(viewport) 안에 있는지 — 경계면 밖이면 무적 + 사격 X
  isOnScreen() {
    const s = worldToScreen(this.x, this.y);
    const margin = this.r;  // 살짝 안쪽까지는 OK
    return s.x > -margin && s.x < W + margin && s.y > -margin && s.y < H + margin;
  }
  
  takeDamage(d) {
    if (this.dead) return;
    // 경계면 밖에 있을 때는 무적
    if (!this.isOnScreen()) return;
    
    this.hp -= d;
    this.hitFlash = 0.1;
    sfx('hit');
    
    if (this.type === 'shielder' && this.shieldHp > 0) {
      this.shieldHp -= d;
      if (this.shieldHp <= 0) {
        // shield breaks, particles
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 200), Math.sin(a) * rand(80, 200), 0.6, '#aaa', 5));
        }
      } else {
        this.hp = this.maxHp;
        return;
      }
    }
    
    if (this.hp <= 0) this.die();
  }
  
  die() {
    this.dead = true;
    sfx('hit');
    
    // particles
    for (let i = 0; i < 15; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(50, 250), Math.sin(a) * rand(50, 250), 0.8, this.color, 6));
    }
    
    // drops
    const r = Math.random();
    if (r < 0.20) {
      pickups.push(new Pickup(this.x, this.y, 'ammo'));
    } else if (r < 0.50) {
      pickups.push(new Pickup(this.x, this.y, 'btc'));
    } else if (r < 0.43) {
      pickups.push(new Pickup(this.x, this.y, 'battery'));
    }
    
    // Battery boost on kill
    player.battery = Math.min(player.batteryMax * (1 + 0.2 * (player.upgrades['ionSlot'] || 0)), player.battery + 5);
    
    // Corpse explosion
    if (player.hasUpgrade('corpseExplode')) {
      effects.push(new Explosion(this.x, this.y, 200, 4));
      for (const en of enemies) {
        if (en.dead || en === this) continue;
        if (dist(this, en) < 200) en.takeDamage(4);
      }
    }
  }
  
  update(dt) {
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.hitFlash = Math.max(this.hitFlash - dt, 0);
      return;
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.hitFlash = Math.max(this.hitFlash - dt, 0);
    
    const targetAngle = angleTo(this, player);
    const d = dist(this, player);
    
    if (this.type === 'rusher') {
      this.angle = targetAngle;
      this.x += Math.cos(targetAngle) * this.speed * dt;
      this.y += Math.sin(targetAngle) * this.speed * dt;
      // 공격은 아래 telegraph 시스템에서 처리됨
    } else if (this.type === 'shooter') {
      this.angle = targetAngle;
      
      if (this.aiming > 0) {
        // 조준 중 — 정지하고 카운트다운, 끝나면 발사
        this.aiming -= dt;
        // aimLine 으로 빨간 조준선 시각화 (sniper 와 동일한 방식)
        this.aimLine = { angle: targetAngle, length: d + 60 };
        if (this.aiming <= 0) {
          // 발사 (화면 밖이면 스킵)
          if (this.isOnScreen()) {
            const sp = 840;
            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(targetAngle) * sp, Math.sin(targetAngle) * sp, {color: '#ff8030', r: 12}));
          }
          this.cooldown = this.attackCd;
          this.aiming = 0;
          this.aimLine = null;
        }
      } else {
        // 평시 — 거리 유지하며 이동
        if (d < this.preferredDist - 30) {
          this.x -= Math.cos(targetAngle) * this.speed * dt;
          this.y -= Math.sin(targetAngle) * this.speed * dt;
        } else if (d > this.preferredDist + 30) {
          this.x += Math.cos(targetAngle) * this.speed * dt * 0.7;
          this.y += Math.sin(targetAngle) * this.speed * dt * 0.7;
        }
        // 사정거리(700) 안에 들어오고 쿨다운 끝나면 조준 시작
        if (this.cooldown <= 0 && d < 700 && this.isOnScreen()) {
          this.aiming = this.aimTime;
        }
      }
    } else if (this.type === 'shielder') {
      // Slow turn
      let diff = targetAngle - this.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      this.angle += clamp(diff, -this.turnSpeed * dt, this.turnSpeed * dt);
      
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      
      if (this.cooldown <= 0 && d < 375 && this.isOnScreen()) {
        // 방패병 샷건: 3발 산탄
        const sp = 660;
        const spread = 18 * Math.PI / 180;  // 18도 산탄
        for (let i = -1; i <= 1; i++) {
          const a = this.angle + i * spread / 2;
          enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, {color: '#cccccc'}));
        }
        this.cooldown = this.attackCd;
      }
    } else if (this.type === 'assassin') {
      this.angle = targetAngle;
      // Erratic movement
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.dashAngle = targetAngle + rand(-1, 1);
        this.dashTimer = rand(0.3, 0.7);
      }
      this.x += Math.cos(this.dashAngle) * this.speed * dt;
      this.y += Math.sin(this.dashAngle) * this.speed * dt;
      // 공격은 아래 telegraph 시스템에서 처리됨
    } else if (this.type === 'sniper') {
      this.angle = targetAngle;
      // Maintain far distance
      if (d < this.preferredDist - 50) {
        this.x -= Math.cos(targetAngle) * this.speed * dt;
        this.y -= Math.sin(targetAngle) * this.speed * dt;
      }
      
      // 화면 밖이면 조준 취소 (무적 + 사격 X)
      if (!this.isOnScreen()) {
        if (this.aiming > 0) { this.aiming = 0; this.aimLine = null; }
      } else if (this.aiming > 0) {
        this.aiming -= dt;
        this.aimAngle = targetAngle; // track
        // 레이저 길이를 플레이어까지 닿게 (살짝 여유 있게)
        this.aimLine = { angle: targetAngle, length: d + 50 };
        if (this.aiming <= 0) {
          // fire fast bullet
          const sp = 2700;
          enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(this.aimAngle) * sp, Math.sin(this.aimAngle) * sp, {color: '#ffff00', r: 8, fast: true}));
          this.cooldown = 3;
          this.aimLine = null;
        }
      } else if (this.cooldown <= 0 && d > 200) {
        this.aiming = this.aimTime;
      }
    }
    
    // 근접 공격 예고 시스템:
    // - 가까운 적이 일정 거리 안에 들어오면 0.5초 telegraph (빨간 원 표시)
    // - telegraph 끝날 때 여전히 범위 안이면 데미지 적용
    // - 플레이어가 범위 밖으로 빠지거나 굴렀으면 telegraph 취소
    
    // melee 가능 타입만 (shooter/sniper 는 원거리 전용)
    const isMelee = (this.type === 'rusher' || this.type === 'assassin' || this.type === 'shielder');
    if (isMelee) {
      // 적 타입별로 trigger 거리 다르게
      let triggerRange, telegraphTime, attackCd;
      if (this.type === 'rusher') {
        triggerRange = this.r + player.r + 25;
        telegraphTime = 0.45;
        attackCd = 0.5;
      } else if (this.type === 'assassin') {
        triggerRange = this.r + player.r + 20;
        telegraphTime = 0.35;  // 빠른 적은 짧은 예고
        attackCd = 0.4;
      } else { // shielder
        triggerRange = this.r + player.r + 30;
        telegraphTime = 0.6;
        attackCd = 1.0;
      }
      const hitRange = this.r + player.r + 8;       // 실제 적중 판정 거리
      const d = dist(this, player);
      
      if (this.meleeTelegraph > 0) {
        this.meleeTelegraph -= dt;
        if (this.meleeTelegraph <= 0) {
          // 발동: 범위 안이면 데미지
          if (!player.rolling && dist(this, player) < hitRange) {
            player.takeDamage();
          }
          this.meleeTelegraph = 0;
          this.meleeAttackCd = attackCd;
          // 시각적 발동 효과 (빨간 펄스)
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(100, 250), Math.sin(a) * rand(100, 250), 0.3, '#ff3030', 4));
          }
        }
      } else if (this.meleeAttackCd > 0) {
        this.meleeAttackCd -= dt;
      } else if (!player.rolling && d < triggerRange) {
        // 새 공격 시작
        this.meleeTelegraph = telegraphTime;
        this.meleeTelegraphMax = telegraphTime;  // 시각화용
      }
    }
    
    // 좌우 반전: 플레이어 방향 기준 (이미지 회전 대신)
    this.facingLeft = Math.cos(this.angle) < 0;
  }
  
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x < -50 || s.x > W + 50 || s.y < -50 || s.y > H + 50) return;
    
    ctx.save();
    ctx.translate(s.x, s.y);
    
    // 근접 공격 예고 indicator (수축하는 빨간 원)
    if (this.meleeTelegraph > 0) {
      const tgMax = this.meleeTelegraphMax || 0.5;
      const t = 1 - this.meleeTelegraph / tgMax;  // 0..1
      const ringR = (this.r + 90) * (1 - t * 0.55);  // 점점 수축
      ctx.save();
      ctx.strokeStyle = `rgba(255, 50, 50, ${0.5 + 0.5 * t})`;
      ctx.lineWidth = 3 + t * 4;
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ff0000';
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, TAU);
      ctx.stroke();
      // 마지막 30% 는 빨갛게 차오름 (확실한 임팩트)
      if (t > 0.7) {
        ctx.fillStyle = `rgba(255, 0, 0, ${(t - 0.7) * 1.5})`;
        ctx.beginPath();
        ctx.arc(0, 0, ringR, 0, TAU);
        ctx.fill();
      }
      // 가운데 ! 표시
      ctx.fillStyle = `rgba(255, 220, 50, ${t})`;
      ctx.font = 'bold 36px Bebas Neue';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, -this.r - 30);
      ctx.restore();
    }
    
    // Sniper aim line
    if (this.aimLine) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 0, 0, ${0.4 + 0.4 * (1 - this.aiming/this.aimTime)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(this.aimLine.angle) * this.aimLine.length, Math.sin(this.aimLine.angle) * this.aimLine.length);
      ctx.stroke();
      ctx.restore();
    }
    
    // Image override (이미지 있으면 도형 대신 이미지 사용 — 회전 X, 좌우반전만)
    const imgKey = 'enemy_' + this.type;
    if (drawEntityImage(imgKey, 0, 0, 0, this.facingLeft)) {
      // 이미지로 그렸으면 도형은 스킵
      ctx.restore();
      // shielder는 방패만 추가로 그림 (좌우반전에 맞춰)
      if (this.type === 'shielder' && this.shieldHp > 0) {
        ctx.save();
        ctx.translate(s.x, s.y);
        // 방패는 플레이어를 향한 면에 표시 → 적의 진행 방향(angle) 사용
        ctx.rotate(this.angle);
        ctx.fillStyle = `rgba(150, 200, 255, ${0.3 + 0.5 * this.shieldHp / 10})`;
        ctx.strokeStyle = '#88ccff';
        ctx.lineWidth = 6;
        ctx.beginPath();
        // 방패 호 — 캐릭터 시각 반경(이미지 size=160의 절반=80) 살짝 바깥
        ctx.arc(0, 0, this.r + 54, -Math.PI/2, Math.PI/2);
        ctx.stroke();
        // 방패 손잡이 (오른쪽 가장자리)
        ctx.fillRect(this.r + 50, -this.r - 4, 8, this.r * 2 + 8);
        ctx.restore();
      }
      // HP bar
      if (this.maxHp > 1 && this.hp < this.maxHp) {
        const w = 60;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(s.x - w/2, s.y - this.r - 16, w, 8);
        ctx.fillStyle = '#ff5050';
        ctx.fillRect(s.x - w/2, s.y - this.r - 16, w * (this.hp / this.maxHp), 8);
      }
      return;
    }
    
    // 도형 폴백: 회전 적용 (이미지가 없을 때만)
    ctx.rotate(this.angle);
    
    if (this.hitFlash > 0) {
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = this.color;
    }
    
    if (this.type === 'rusher') {
      // angular figure
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(-this.r, this.r * 0.7);
      ctx.lineTo(-this.r * 0.5, 0);
      ctx.lineTo(-this.r, -this.r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#600';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (this.type === 'shooter') {
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();
      // gun
      ctx.fillStyle = '#000';
      ctx.fillRect(this.r * 0.5, -2, 12, 4);
    } else if (this.type === 'shielder') {
      // body
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      ctx.stroke();
      // shield
      if (this.shieldHp > 0) {
        ctx.fillStyle = `rgba(150, 200, 255, ${0.3 + 0.5 * this.shieldHp / 10})`;
        ctx.strokeStyle = '#88ccff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 8, -Math.PI/2, Math.PI/2);
        ctx.stroke();
        ctx.fillRect(this.r + 4, -this.r - 2, 6, this.r * 2 + 4);
      }
    } else if (this.type === 'assassin') {
      // diamond
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(0, this.r);
      ctx.lineTo(-this.r, 0);
      ctx.lineTo(0, -this.r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#600040';
      ctx.lineWidth = 2;
      ctx.stroke();
      // glow
      ctx.shadowBlur = 12;
      ctx.shadowColor = this.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (this.type === 'sniper') {
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();
      // long barrel
      ctx.fillStyle = '#222';
      ctx.fillRect(this.r * 0.3, -2, 22, 4);
    }
    
    ctx.restore();
    
    // HP bar for >1HP enemies
    if (this.maxHp > 1 && this.hp < this.maxHp) {
      const w = 60;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(s.x - w/2, s.y - this.r - 16, w, 8);
      ctx.fillStyle = '#ff5050';
      ctx.fillRect(s.x - w/2, s.y - this.r - 16, w * (this.hp / this.maxHp), 8);
    }
  }
}

// =============================================================
// BOSSES
// =============================================================
class Boss extends Enemy {
  constructor(x, y, level) {
    super(x, y, 'boss');
    this.level = level;
    this.boss = true;
    this.r = 28;
    this.slowTimer = 0;
    this.phaseTimer = 0;
    this.attackPhase = 0;
    this.lastTeleport = 0;
    this.dashTimer = 0;
    this.spawnedObstacles = 0;
    
    if (level === 1) { // 백규 - revolver rusher
      this.hp = 50; this.maxHp = 50;          // 20 → 50
      this.name = '백규';
      this.speed = 195;
      this.color = '#ffaa00';
      this.dodgeCd = 0;
      this.r = 50;
      this.summonCd = 5;  // 5초마다 부하 소환
      // 좌우 슬라이딩 회피용 (불규칙 주기)
      this.lateralSlideCd = rand(1.0, 2.5);  // 다음 슬라이드까지 시간 (랜덤)
      this.lateralSlideTime = 0;              // 슬라이드 지속
      this.lateralSlideDir = {x: 0, y: 0};
    } else if (level === 2) { // 크랙슨
      this.hp = 100; this.maxHp = 100;        // 40 → 100
      this.name = '크랙슨';
      this.speed = 120;
      this.color = '#888';
      this.r = 70;
      this.charging = false;
      // 충격파 (주변 AOE) 패턴
      this.shockwaveCd = 4;            // 첫 발동까지 4초
      this.shockwaveCharge = 0;        // 차징 시간 (>0 동안 예고 표시, 0 도달 시 발동)
      this.shockwaveActive = 0;        // 활성 시간 (링 확장 중)
      this.shockwaveRange = 380;       // 최대 도달 거리
      this.shockwaveDamaged = false;   // 이번 사이클에 플레이어 맞았는지
      this.chargingPrep = 0;     // 돌격 준비 정지 시간
      this.chargeAngle = 0;
      this.stunFromWall = 0;
      this.shockwaveCd = 4;      // 충격파 발사 쿨다운 (4초마다)
      this.shockwavePrep = 0;    // 충격파 차징 시간 (0.5초)
    } else if (level === 3) { // 리퍼
      this.hp = 1; this.maxHp = 1;
      this.name = '리퍼';
      this.speed = 90;
      this.color = '#a020f0';
      this.r = 44;
      this.aimAngle = 0;
      this.aiming = 0;
      this.teleportCd = 0;
      this.reaperLives = 3;     // 3개의 목숨 (죽으면 멀리 재등장)
      this.reaperMaxLives = 3;
      // 슬라이딩 회피 (플레이어처럼)
      this.slidingTime = 0;
      this.slidingCd = 0;
      this.slidingDir = {x: 0, y: 0};
    } else if (level === 4) { // CP-09
      this.hp = 120; this.maxHp = 120;        // 50 → 120
      this.name = 'CP-09';
      this.speed = 75;
      this.color = '#00aaff';
      this.r = 62;
      this.spawnTimer = 0;
      this.bombardCd = 0;
    } else if (level === 5) { // 제미네이터
      this.hp = 900; this.maxHp = 900;        // 400 → 900
      this.name = '제미네이터';
      this.speed = 90;
      this.color = '#ff0040';
      this.r = 108;
      this.weakSpotR = 90;
      this.barrageTimer = 0;
      this.barragePhase = 0;
      this.bombardCd = 0;
      // 페이즈 분리: barrage(탄막) → bombard(포격) → laser(레이저) → cooling(냉각)
      this.geminatorPhase = 'barrage';   // 'barrage' | 'bombard' | 'laser' | 'cooling'
      this.phaseStartedAt = 0;            // 진입 시각 (this.phaseTimer 기준)
      this.bombardCount = 0;              // 포격 페이즈에서 발사 횟수
      this.laserAngle = 0;                // 레이저 방향
      this.laserActive = false;           // 데미지 발생 중인지
      this.laserChargeTime = 0;           // 0~1초: 레이저 차징
      this.laserFireTime = 0;             // 0~6초: 레이저 발사 중
      this.coolingTime = 0;               // 0~3초: 냉각 (정지 + 약점 노출)
    }
  }
  
  takeDamage(d) {
    if (this.dead) return;
    // 경계면 밖에 있을 때는 무적 — 단, 리퍼(level 3)는 무한 사거리 사격하므로 패링 반격을 위해 예외
    if (this.level !== 3 && !this.isOnScreen()) return;
    
    // Geminator: only weak point
    // 약점은 보스의 정면(this.angle 방향)에 있음 — 플레이어가 약점 방향에 있어야 데미지
    // 레이저 페이즈에선 angle 이 플레이어를 추적하므로 약점이 자연스럽게 플레이어 방향
    if (this.level === 5) {
      const playerAngle = angleTo(this, player);
      let diff = playerAngle - this.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      // 약점 콘 ±35도 안이어야 데미지
      if (Math.abs(diff) > Math.PI * 0.2) {
        damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#666', 'BLOCKED'));
        return;
      }
      // 냉각 페이즈일 땐 데미지 1.5배
      if (this.coolingTime > 0) {
        d = d * 1.5;
      }
    }
    
    // 크랙슨 방패: 진행 방향(this.angle) 정면 ±90도면 완전 무적
    // → 후면을 노리거나 돌격 후 스턴 상태에서 공격해야 함
    if (this.level === 2) {
      const playerAngle = angleTo(this, player);
      let diff = playerAngle - this.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      if (Math.abs(diff) < Math.PI / 2) {
        // 방패 정면 — 완전 차단
        damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#88ccff', 'SHIELD'));
        // 약간의 시각 피드백
        this.hitFlash = 0.05;
        return;
      }
    }
    
    this.hp -= d;
    this.hitFlash = 0.1;
    sfx('hit');
    if (this.hp <= 0) {
      // 리퍼: 3목숨 (죽으면 플레이어로부터 멀리 재등장)
      if (this.level === 3 && this.reaperLives > 1) {
        this.reaperLives--;
        // 사망 효과
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(100, 350), Math.sin(a) * rand(100, 350), 0.8, '#a020f0', 7));
        }
        effects.push(new Explosion(this.x, this.y, 160, 0));
        sfx('death');
        STATE.shake = 30;
        STATE.hitstop = 200;
        
        // 플레이어가 있는 맵 반대편에 재등장
        // 반대편 = (WORLD.w - player.x, WORLD.h - player.y), 약간의 무작위 오프셋
        let nx = WORLD.w - player.x + rand(-150, 150);
        let ny = WORLD.h - player.y + rand(-150, 150);
        nx = clamp(nx, 100, WORLD.w - 100);
        ny = clamp(ny, 100, WORLD.h - 100);
        this.x = nx;
        this.y = ny;
        
        // HP 풀충전
        this.hp = this.maxHp;
        this.aiming = 0;
        this.teleportCd = 1;
        this.aimLine = null;
        
        // 재등장 효과
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(50, 200), Math.sin(a) * rand(50, 200), 0.5, '#a020f0', 6));
        }
        // 알림
        showFlash(`리퍼 잔여 ${this.reaperLives}`, '#a020f0');
      } else {
        this.die();
      }
    }
  }
  
  die() {
    this.dead = true;
    sfx('explode');
    sfx('death');
    
    // Big explosion
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(100, 500), Math.sin(a) * rand(100, 500), 1.5, ['#ff2050', '#ffcc00', '#fff'][i%3], 10));
    }
    effects.push(new Explosion(this.x, this.y, 400, 0));
    STATE.shake = 60;
    STATE.hitstop = 250;
    STATE.bossDefeated = true;
  }
  
  update(dt) {
    if (this.slowTimer > 0) { this.slowTimer -= dt; dt *= 0.5; }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.hitFlash = Math.max(this.hitFlash - dt, 0);
    this.phaseTimer += dt;
    
    const targetAngle = angleTo(this, player);
    const d = dist(this, player);
    
    if (this.level === 1) { // 백규
      this.angle = targetAngle;
      if (this.dodgeCd > 0) this.dodgeCd -= dt;
      if (this.summonCd > 0) this.summonCd -= dt;
      if (this.lateralSlideCd > 0) this.lateralSlideCd -= dt;
      
      // 5초마다 rusher 3마리 소환
      if (this.summonCd <= 0) {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + Math.random() * 0.5;
          const sx = this.x + Math.cos(a) * 80;
          const sy = this.y + Math.sin(a) * 80;
          enemies.push(new Enemy(sx, sy, 'rusher'));
          // 소환 파티클
          for (let j = 0; j < 8; j++) {
            const pa = Math.random() * TAU;
            particles.push(new Particle(sx, sy, Math.cos(pa) * rand(60, 200), Math.sin(pa) * rand(60, 200), 0.4, '#ffaa00', 5));
          }
        }
        this.summonCd = 5;
        sfx('charge');
      }
      
      // 좌우 슬라이딩 — 더 빠르고 불규칙. 플레이어 시점 기준 좌/우 (수직 방향)
      if (this.lateralSlideTime > 0) {
        this.lateralSlideTime -= dt;
        const slideSpeed = 1400;
        this.x += this.lateralSlideDir.x * slideSpeed * dt;
        this.y += this.lateralSlideDir.y * slideSpeed * dt;
        // 슬라이드 잔상
        if (Math.random() < 0.7) {
          particles.push(new Particle(this.x, this.y, rand(-40, 40), rand(-40, 40), 0.35, '#ffaa00', 5));
        }
      } else {
        // 평시 이동: 플레이어 추적
        this.x += Math.cos(targetAngle) * this.speed * dt;
        this.y += Math.sin(targetAngle) * this.speed * dt;
        
        // 슬라이드 트리거 — 불규칙 주기 (자주 발동)
        if (this.lateralSlideCd <= 0 && d < 1500) {
          // 플레이어 시점에서 좌/우 (시야 방향과 수직)
          const sideSign = Math.random() < 0.5 ? 1 : -1;
          const perpAngle = targetAngle + sideSign * Math.PI / 2;
          this.lateralSlideDir = { x: Math.cos(perpAngle), y: Math.sin(perpAngle) };
          this.lateralSlideTime = rand(0.2, 0.4);     // 짧고 빠르게
          this.lateralSlideCd = rand(0.5, 1.6);        // 더 자주
          // 시작 효과
          for (let i = 0; i < 8; i++) {
            const pa = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(pa) * rand(50, 150), Math.sin(pa) * rand(50, 150), 0.35, '#ffaa00', 5));
          }
        }
      }
      
      // Fire 6-shot revolver — 사거리 ↑
      if (this.cooldown <= 0 && d < 1500 && this.isOnScreen()) {
        // 6 shots in spread
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            if (this.dead) return;
            const a = angleTo(this, player) + (i - 2.5) * 0.05;
            const sp = 1050;
            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, {color: '#ffaa00', r: 10}));
          }, i * 80);
        }
        this.cooldown = 2;
      }
      
      // Dodge: 사격 거리(480)보다 가까이 들어왔을 때만 발동 (워프와 사격이 충돌하지 않게)
      if (this.dodgeCd <= 0 && d < 300) {
        // 플레이어 반대 방향 ±60도 안에서 워프 (회피 의도 강화)
        const awayAngle = angleTo(player, this);
        const a = awayAngle + rand(-Math.PI / 3, Math.PI / 3);
        this.x += Math.cos(a) * 200;
        this.y += Math.sin(a) * 200;
        for (let i = 0; i < 10; i++) {
          particles.push(new Particle(this.x, this.y, rand(-100,100), rand(-100,100), 0.5, '#ffaa00', 6));
        }
        this.dodgeCd = 3;
      }
    } else if (this.level === 2) { // 크랙슨
      if (this.stunFromWall > 0) {
        this.stunFromWall -= dt;
        return;
      }
      
      if (this.chargingPrep > 0) {
        // 돌격 준비: 정지 상태로 1초 카운트다운, 궤도 표시
        this.chargingPrep -= dt;
        // 매 프레임 빨간 궤도 라인 그리도록 chargeAngle 유지
        if (this.chargingPrep <= 0) {
          // 돌격 시작
          this.charging = true;
          this.chargingPrep = 0;
          sfx('charge');
        }
      } else if (this.charging) {
        // 매우 빠른 돌격 — 저격수 탄속(2700)에 가까운 속도로 돌진
        const chargeSpeed = 2700;
        this.x += Math.cos(this.chargeAngle) * chargeSpeed * dt;
        this.y += Math.sin(this.chargeAngle) * chargeSpeed * dt;
        // Hit obstacles or wall
        let hit = false;
        if (this.x < this.r || this.x > WORLD.w - this.r || this.y < this.r || this.y > WORLD.h - this.r) hit = true;
        for (const ob of obstacles) {
          if (ob.dead) continue;
          if (this.x > ob.x - ob.w/2 - this.r && this.x < ob.x + ob.w/2 + this.r && this.y > ob.y - ob.h/2 - this.r && this.y < ob.y + ob.h/2 + this.r) {
            hit = true;
            ob.takeDamage(50);
            break;
          }
        }
        if (hit) {
          this.charging = false;
          this.stunFromWall = 1.5;
          STATE.shake = 30;
          for (let i = 0; i < 20; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(100, 300), Math.sin(a) * rand(100, 300), 0.7, '#888', 5));
          }
        }
        // Damage on contact during charge
        if (!player.rolling && dist(this, player) < this.r + player.r) {
          player.takeDamage();
          this.charging = false;
          this.stunFromWall = 0.8;
        }
      } else {
        this.angle = targetAngle;
        if (this.shockwaveCd > 0) this.shockwaveCd -= dt;
        
        // 충격파 차징 중: 정지 + 시각 예고
        if (this.shockwavePrep > 0) {
          this.shockwavePrep -= dt;
          // 매 프레임 자기 주변에 빨간 파티클 (차징 표시)
          if (Math.random() < 0.5) {
            const a = Math.random() * TAU;
            const rr = this.r + 30 + Math.random() * 60;
            particles.push(new Particle(
              this.x + Math.cos(a) * rr,
              this.y + Math.sin(a) * rr,
              -Math.cos(a) * 100, -Math.sin(a) * 100,
              0.3, '#ff6060', 4
            ));
          }
          if (this.shockwavePrep <= 0) {
            // 충격파 발동 (링 AOE)
            this.shockwaveActive = 0.0001;   // 링 확장 시작
            this.shockwaveDamaged = false;
            // 시각/사운드
            STATE.shake = Math.max(STATE.shake, 22);
            sfx('explode');
            this.shockwaveCd = 5 + Math.random() * 2;  // 다음까지 5~7초
          }
        } else if (this.shockwaveActive > 0) {
          // 링 확장 중 — 0.6초 동안 0 → shockwaveRange 까지 확장
          this.shockwaveActive += dt;
          const t = this.shockwaveActive / 0.6;
          const radiusNow = t * this.shockwaveRange;
          
          // 링 두께 60px 안의 적/플레이어/장애물에 영향
          const ringThickness = 60;
          
          // 플레이어 데미지 (한 번만)
          if (!this.shockwaveDamaged && !player.rolling && player.invulnTime <= 0) {
            const pd = dist(this, player);
            if (pd > radiusNow - ringThickness && pd < radiusNow + 10) {
              player.takeDamage();
              this.shockwaveDamaged = true;
            }
          }
          
          // 장애물 파괴 — 링이 닿으면 즉시
          for (const ob of obstacles) {
            if (ob.dead) continue;
            const od = dist(this, ob);
            if (od > radiusNow - ringThickness && od < radiusNow + 20) {
              ob.takeDamage(50);
            }
          }
          
          // 0.6초 후 종료
          if (t >= 1) {
            this.shockwaveActive = 0;
          }
        } else {
          // 평시 이동
          this.x += Math.cos(targetAngle) * this.speed * dt;
          this.y += Math.sin(targetAngle) * this.speed * dt;
          
          if (this.cooldown <= 0 && d < 675 && this.isOnScreen()) {
            // 돌격 준비 시작 — 1초 정지 후 발사
            this.chargingPrep = 1.0;
            this.chargeAngle = targetAngle;
            this.cooldown = 5;
          } else if (this.shockwaveCd <= 0 && this.isOnScreen() && d < 900) {
            // 충격파 차징 시작 (0.6초 정지)
            this.shockwavePrep = 0.6;
          }
        }
      }
    } else if (this.level === 3) { // 리퍼
      this.angle = targetAngle;
      if (this.teleportCd > 0) this.teleportCd -= dt;
      if (this.slidingCd > 0) this.slidingCd -= dt;
      
      // 슬라이딩 회피 (플레이어처럼) — 슬라이드 중이면 이동만
      if (this.slidingTime > 0) {
        this.slidingTime -= dt;
        const slideSpeed = 700;
        this.x += this.slidingDir.x * slideSpeed * dt;
        this.y += this.slidingDir.y * slideSpeed * dt;
        // 잔상 파티클
        if (Math.random() < 0.7) {
          particles.push(new Particle(this.x, this.y, rand(-30, 30), rand(-30, 30), 0.4, '#a020f0', 6));
        }
        // 슬라이드 중엔 다른 행동 X
        // Clamp 후 종료
        this.x = clamp(this.x, this.r, WORLD.w - this.r);
        this.y = clamp(this.y, this.r, WORLD.h - this.r);
        this.facingLeft = Math.cos(this.angle) < 0;
        return;
      }
      
      // 슬라이딩 회피 트리거: 플레이어가 가까이 오거나, 정면으로 총알이 날아오면
      if (this.slidingCd <= 0) {
        let shouldSlide = false;
        let slideAngle = 0;
        // 플레이어가 너무 가깝다 → 옆으로 슬라이드
        if (d < 250) {
          shouldSlide = true;
          // 플레이어 진행 방향에 수직으로 회피
          slideAngle = targetAngle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        } else {
          // 정면 근처로 빠른 총알이 오면 슬라이드
          for (const b of bullets) {
            if (b.dead) continue;
            const bd = dist(this, b);
            if (bd > 200) continue;
            // 총알이 이쪽으로 향하는지
            const ba = Math.atan2(b.dy, b.dx);
            const toMe = angleTo(b, this);
            let diff = toMe - ba;
            while (diff > Math.PI) diff -= TAU;
            while (diff < -Math.PI) diff += TAU;
            if (Math.abs(diff) < 0.4) {
              shouldSlide = true;
              slideAngle = ba + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
              break;
            }
          }
        }
        if (shouldSlide) {
          this.slidingTime = 0.3;
          this.slidingCd = 1.8;  // 다음 슬라이드까지 쿨다운
          this.slidingDir = { x: Math.cos(slideAngle), y: Math.sin(slideAngle) };
          // 슬라이드 시작 효과
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(60, 180), Math.sin(a) * rand(60, 180), 0.4, '#a020f0', 5));
          }
          // 조준 중이면 취소
          if (this.aiming > 0) { this.aiming = 0; this.aimLine = null; }
        }
      }
      
      if (d < 200 && this.teleportCd <= 0) {
        // teleport away
        const a = angleTo(player, this) + rand(-0.5, 0.5);
        this.x += Math.cos(a) * 500;
        this.y += Math.sin(a) * 500;
        for (let i = 0; i < 30; i++) {
          particles.push(new Particle(this.x, this.y, rand(-200, 200), rand(-200, 200), 0.5, '#a020f0', 6));
        }
        this.teleportCd = 5;
      }
      
      // Slow drift
      this.x += Math.cos(targetAngle + Math.PI * 0.7) * this.speed * dt;
      this.y += Math.sin(targetAngle + Math.PI * 0.7) * this.speed * dt;
      
      // 리퍼는 무한 사거리 — 화면 밖이든 맵 끝이든 조준 가능
      // 카타나 패링이 없으면 살아남기 어려운 강도로 사격
      // + 플레이어 움직임 예측 (lead aiming): 발사 후 도달 시점의 위치를 겨냥
      if (this.aiming > 0) {
        this.aiming -= dt;
        // 예측 사격: 거의 완벽한 lead — 패링 없이는 회피 어려움
        // 총알 속도 5600, 거리 d, 도달 시간 t ≈ d / 5600
        const sp = 5600;
        const travelT = d / sp;
        const leadFactor = 0.95;   // 0.7 → 0.95 (강한 예측)
        const predX = player.x + player.vx * travelT * leadFactor;
        const predY = player.y + player.vy * travelT * leadFactor;
        this.aimAngle = Math.atan2(predY - this.y, predX - this.x);
        // 레이저 길이 — 맵 끝까지 충분히 길게 (장애물 무관)
        this.aimLine = { angle: this.aimAngle, length: 9000 };
        if (this.aiming <= 0) {
          // 발사 — 조준선 방향 그대로
          const b = new EnemyBullet(this.x, this.y, Math.cos(this.aimAngle) * sp, Math.sin(this.aimAngle) * sp, {color: '#ff00ff', r: 12, fast: true, piercing: true, life: 8});
          enemyBullets.push(b);
          this.cooldown = 1.5;
          this.aimLine = null;
        }
      } else if (this.cooldown <= 0) {
        this.aiming = 1.2;
      }
    } else if (this.level === 4) { // CP-09
      this.angle = targetAngle;
      this.spawnTimer -= dt;
      this.bombardCd -= dt;
      
      // drift
      this.x += Math.cos(this.phaseTimer * 0.5) * this.speed * dt;
      this.y += Math.sin(this.phaseTimer * 0.7) * this.speed * dt;
      
      // Spawn enemies (화면 안에 있을 때만)
      if (this.spawnTimer <= 0 && enemies.length < 15 && this.isOnScreen()) {
        const types = ['rusher', 'shooter'];
        const t = types[Math.floor(Math.random() * types.length)];
        const a = Math.random() * TAU;
        const sx = this.x + Math.cos(a) * 100;
        const sy = this.y + Math.sin(a) * 100;
        enemies.push(new Enemy(sx, sy, t));
        // also obstacle
        if (this.spawnedObstacles < 6 && Math.random() < 0.4) {
          obstacles.push(new Obstacle(rand(player.x - 300, player.x + 300), rand(player.y - 300, player.y + 300), Math.random() < 0.3));
          this.spawnedObstacles++;
        }
        this.spawnTimer = 2;
      }
      
      // Bombardment — 더 자주 + 한 번에 5~7개 (화면 안에 있을 때만)
      if (this.bombardCd <= 0 && this.isOnScreen()) {
        const numBombs = 5 + Math.floor(Math.random() * 3);  // 5~7개
        for (let i = 0; i < numBombs; i++) {
          // 첫 번째는 항상 플레이어 위치
          let tx, ty;
          if (i === 0) {
            tx = player.x;
            ty = player.y;
          } else {
            // 나머지는 플레이어 주변 + 예측 위치 일부
            const a = Math.random() * TAU;
            const r = rand(80, 350);
            tx = player.x + Math.cos(a) * r;
            ty = player.y + Math.sin(a) * r;
          }
          // 약간 시간차로 떨어지게 (더 압박감)
          const delay = i * 0.15;
          setTimeout(() => {
            if (this.dead) return;
            effects.push(new Bombardment(tx, ty, 180, 2.5));
          }, delay * 1000);
        }
        this.bombardCd = 2.2;  // 4 → 2.2 (훨씬 자주)
      }
    } else if (this.level === 5) { // 제미네이터
      // 페이즈별 angle 처리:
      // - 레이저 페이즈: 약점(후면)이 플레이어를 향하도록 → this.angle = 플레이어 반대 방향
      // - 그 외: 천천히 플레이어 추적
      if (this.geminatorPhase === 'laser') {
        // 약점이 플레이어를 향함 = this.angle 이 플레이어 '반대' 방향
        const desiredAngle = targetAngle + Math.PI;   // 플레이어 반대
        let diff = desiredAngle - this.angle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        // 차징 중엔 빠르게 회전, 발사 중엔 회전 없음
        if (!this.laserActive) {
          this.angle += clamp(diff, -3.0 * dt, 3.0 * dt);
        }
      } else if (this.geminatorPhase === 'cooling') {
        // 냉각 중 — angle 유지 (약점이 그대로 보이게)
      } else {
        let diff = targetAngle - this.angle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        this.angle += clamp(diff, -1.0 * dt, 1.0 * dt);
      }
      
      // 이동: 레이저(차징·발사) 중과 냉각 중에는 정지
      const moveSpeed = (
        this.geminatorPhase === 'laser' || 
        this.geminatorPhase === 'cooling'
      ) ? 0 : this.speed;
      this.x += Math.cos(this.angle) * moveSpeed * dt;
      this.y += Math.sin(this.angle) * moveSpeed * dt;
      
      const phaseAge = this.phaseTimer - this.phaseStartedAt;
      
      // ─────────── 페이즈 1: 탄막 (BARRAGE) — 7초 ───────────
      if (this.geminatorPhase === 'barrage') {
        this.barrageTimer -= dt;
        if (this.barrageTimer <= 0 && this.isOnScreen()) {
          this.barragePhase++;
          const n = 24;
          const offset = this.barragePhase * 0.2;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + offset;
            const sp = 660;
            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, {color: '#ff0040', r: 12}));
          }
          this.barrageTimer = 0.4;
        }
        if (phaseAge > 7) {
          this.geminatorPhase = 'bombard';
          this.phaseStartedAt = this.phaseTimer;
          this.bombardCount = 0;
          this.bombardCd = 0;
          showFlash('포격 개시', '#ff0040');
        }
      }
      // ─────────── 페이즈 2: 포격 (BOMBARD) — 10발 ───────────
      else if (this.geminatorPhase === 'bombard') {
        this.bombardCd -= dt;
        if (this.bombardCd <= 0 && this.bombardCount < 10 && this.isOnScreen()) {
          // 플레이어 위치 + 약간 예측 이동 위치도 섞음
          let tx, ty;
          if (this.bombardCount % 2 === 0) {
            tx = player.x;
            ty = player.y;
          } else {
            const a = Math.random() * TAU;
            tx = player.x + Math.cos(a) * rand(80, 250);
            ty = player.y + Math.sin(a) * rand(80, 250);
          }
          effects.push(new Bombardment(tx, ty, 240, 2.5));
          this.bombardCount++;
          this.bombardCd = 0.6;
        }
        if (this.bombardCount >= 10 && this.bombardCd <= -1.5) {
          // 마지막 포격이 떨어진 뒤 1.5초 여유 후 다음 페이즈
          this.geminatorPhase = 'laser';
          this.phaseStartedAt = this.phaseTimer;
          this.laserChargeTime = 0;
          this.laserFireTime = 0;
          this.laserActive = false;
          showFlash('레이저 차징', '#ff0040');
        }
      }
      // ─────────── 페이즈 3: 레이저 (LASER) — 차징 1s + 발사 6s ───────────
      else if (this.geminatorPhase === 'laser') {
        // 약점은 보스 정면(angle 방향, this.r * 0.7 거리)에 있음 — 약점이 곧 무기 부위
        const wsX = this.x + Math.cos(this.angle) * (this.r * 0.7);
        const wsY = this.y + Math.sin(this.angle) * (this.r * 0.7);
        
        if (!this.laserActive && this.laserFireTime === 0) {
          // 차징 단계 — 1초 동안 보스가 플레이어를 추적 (약점도 함께 회전)
          this.laserChargeTime += dt;
          // angle 자체를 플레이어 방향으로 회전 (천천히 — 정밀하게)
          const tgtA = angleTo(this, player);
          let aDiff = tgtA - this.angle;
          while (aDiff > Math.PI) aDiff -= TAU;
          while (aDiff < -Math.PI) aDiff += TAU;
          this.angle += clamp(aDiff, -3 * dt, 3 * dt);
          // 레이저 방향은 약점 → 플레이어
          this.laserAngle = Math.atan2(player.y - wsY, player.x - wsX);
          if (this.laserChargeTime >= 1.0) {
            this.laserActive = true;
            this.laserFireTime = 0;
            sfx('charge');
          }
        } else {
          // 발사 단계 — 시계방향 회전 (한 바퀴 ≈ 6초)
          this.laserFireTime += dt;
          const rotateSpeed = TAU / 6;
          this.laserAngle += rotateSpeed * dt;
          // 보스 angle 도 같이 회전 → 약점이 항상 레이저 방향
          this.angle = this.laserAngle;
          
          // 레이저 시작점 = 약점, 길이 = 9000
          const lineLen = 9000;
          const sx = wsX;
          const sy = wsY;
          const ex = sx + Math.cos(this.laserAngle) * lineLen;
          const ey = sy + Math.sin(this.laserAngle) * lineLen;
          
          // 플레이어 데미지
          if (!player.rolling && player.invulnTime <= 0) {
            const px = player.x - sx;
            const py = player.y - sy;
            const lx = ex - sx;
            const ly = ey - sy;
            const lLen2 = lx*lx + ly*ly;
            let t = (px * lx + py * ly) / lLen2;
            t = Math.max(0, Math.min(1, t));
            const cx = sx + lx * t;
            const cy = sy + ly * t;
            const distToLine = Math.hypot(player.x - cx, player.y - cy);
            if (distToLine < 30) {
              player.takeDamage();
            }
          }
          
          // 장애물 청소: 레이저 라인 가까이 있는 모든 장애물/폭발물 강제 파괴
          // (destructible=false 까지 무시 — 레이저는 모든 걸 부숨)
          for (const ob of obstacles) {
            if (ob.dead) continue;
            const px = ob.x - sx;
            const py = ob.y - sy;
            const lx = ex - sx;
            const ly = ey - sy;
            const lLen2 = lx*lx + ly*ly;
            let t = (px * lx + py * ly) / lLen2;
            t = Math.max(0, Math.min(1, t));
            const cx = sx + lx * t;
            const cy = sy + ly * t;
            const distToLine = Math.hypot(ob.x - cx, ob.y - cy);
            if (distToLine < Math.max(ob.w, ob.h) / 2 + 20) {
              const wasDestructible = ob.destructible;
              ob.destructible = true;
              ob.takeDamage(999);
              if (!ob.dead) ob.destructible = wasDestructible;
            }
          }
          
          // 6초 후 종료 → cooling 페이즈 진입 (약점 노출, 정지)
          if (this.laserFireTime >= 6) {
            this.geminatorPhase = 'cooling';
            this.phaseStartedAt = this.phaseTimer;
            this.coolingTime = 3.0;       // 3초 정지
            this.laserActive = false;
            this.laserFireTime = 0;
            this.laserChargeTime = 0;
            STATE.shake = Math.max(STATE.shake, 20);
            sfx('charge');
            showFlash('과열 — 냉각 중', '#88ddff');
          }
        }
      }
      // ─────────── 페이즈 4: 냉각 (COOLING) — 3초, 약점 완전 노출 ───────────
      else if (this.geminatorPhase === 'cooling') {
        this.coolingTime -= dt;
        // 약점에서 김(증기) 파티클 — 앞면 위치
        if (Math.random() < 0.5) {
          const wsX = this.x + Math.cos(this.angle) * (this.r * 0.7);
          const wsY = this.y + Math.sin(this.angle) * (this.r * 0.7);
          particles.push(new Particle(
            wsX + rand(-30, 30), wsY + rand(-30, 30),
            rand(-20, 20), rand(-100, -40),
            0.7, '#88ddff', 6
          ));
        }
        if (this.coolingTime <= 0) {
          // 냉각 끝 → 다시 탄막 + 맵 장애물/폭발물 재생성
          this.geminatorPhase = 'barrage';
          this.phaseStartedAt = this.phaseTimer;
          this.barrageTimer = 0;
          
          // 맵 전역에 장애물 + 폭발물 재생성
          const newCount = 100;
          let added = 0;
          let tries = 0;
          while (added < newCount && tries < newCount * 4) {
            tries++;
            const ox = rand(150, WORLD.w - 150);
            const oy = rand(150, WORLD.h - 150);
            if (Math.hypot(ox - this.x, oy - this.y) < 250) continue;
            if (Math.hypot(ox - player.x, oy - player.y) < 250) continue;
            const isExplosive = Math.random() < 0.18;
            obstacles.push(new Obstacle(ox, oy, isExplosive));
            added++;
          }
        }
      }
    }
    
    // Clamp
    this.x = clamp(this.x, this.r, WORLD.w - this.r);
    this.y = clamp(this.y, this.r, WORLD.h - this.r);
    
    // 좌우 반전 (이미지 회전 없음 — facingLeft만)
    this.facingLeft = Math.cos(this.angle) < 0;
    
    // Damage on contact
    if (!player.rolling && dist(this, player) < this.r + player.r - 4 && !this.dead) {
      player.takeDamage();
    }
  }
  
  draw() {
    const s = worldToScreen(this.x, this.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    
    if (this.aimLine) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 0, 255, ${0.5 + 0.5 * (1 - this.aiming/1.5)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(this.aimLine.angle - this.angle) * this.aimLine.length, 0);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = `rgba(255, 0, 255, ${0.5 + 0.5 * (1 - this.aiming/1.5)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(this.aimLine.angle) * this.aimLine.length, Math.sin(this.aimLine.angle) * this.aimLine.length);
      ctx.stroke();
      ctx.restore();
    }
    
    // 크랙슨: 돌격 준비 중일 때 빨간 궤도 라인 (회전 적용 전, 보스 중심 기준)
    if (this.level === 2 && this.chargingPrep > 0) {
      const t = 1 - this.chargingPrep / 1.0;  // 0..1 진행도
      ctx.save();
      // 라인 굵어지면서 빨강이 진해짐
      ctx.strokeStyle = `rgba(255, 50, 50, ${0.3 + 0.6 * t})`;
      ctx.lineWidth = 4 + t * 8;
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ff0000';
      ctx.setLineDash([20, 10]);
      ctx.lineDashOffset = -t * 30;  // 흐르는 효과
      ctx.beginPath();
      ctx.moveTo(0, 0);
      // 돌격 거리 (충분히 길게 — 화면 끝까지)
      const len = 1500;
      ctx.lineTo(Math.cos(this.chargeAngle) * len, Math.sin(this.chargeAngle) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 끝나기 직전 강한 깜빡임
      if (this.chargingPrep < 0.3) {
        const blink = Math.sin(STATE.realTime * 0.06) > 0 ? 1 : 0.3;
        ctx.strokeStyle = `rgba(255, 50, 50, ${blink})`;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.chargeAngle) * len, Math.sin(this.chargeAngle) * len);
        ctx.stroke();
      }
      ctx.restore();
    }
    
    // 크랙슨: 충격파 차징(예고) 시각화 — 보스 주변 빨간 링이 점점 진해짐
    if (this.level === 2 && this.shockwavePrep > 0) {
      ctx.save();
      const t = 1 - this.shockwavePrep / 0.6;  // 0..1
      ctx.strokeStyle = `rgba(255, 60, 60, ${0.4 + 0.5 * t})`;
      ctx.lineWidth = 4 + t * 6;
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ff4040';
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 30, 0, TAU);
      ctx.stroke();
      // 외곽 펄스 (예고 범위)
      ctx.globalAlpha = 0.15 + 0.15 * Math.sin(STATE.realTime * 0.02);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.shockwaveRange, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    
    // 크랙슨: 충격파 활성 (링 확장 중)
    if (this.level === 2 && this.shockwaveActive > 0) {
      ctx.save();
      const t = this.shockwaveActive / 0.6;
      const radiusNow = t * this.shockwaveRange;
      const alpha = 1 - t * 0.7;
      // 외곽 글로우
      ctx.strokeStyle = `rgba(255, 80, 80, ${alpha * 0.7})`;
      ctx.lineWidth = 30;
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ff4040';
      ctx.beginPath();
      ctx.arc(0, 0, radiusNow, 0, TAU);
      ctx.stroke();
      // 메인 링
      ctx.strokeStyle = `rgba(255, 200, 200, ${alpha})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, radiusNow, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    
    // 제미네이터 레이저 차징/발사 시각화 (회전 적용 전, 보스 중심 기준)
    if (this.level === 5 && this.geminatorPhase === 'laser') {
      ctx.save();
      const lineLen = 9000;
      
      // 약점 오프셋 (보스 중심에서 앞면 r*0.7 거리)
      const wsLocalX = Math.cos(this.angle) * (this.r * 0.7);
      const wsLocalY = Math.sin(this.angle) * (this.r * 0.7);
      
      if (!this.laserActive) {
        // 차징 중 — 가는 빨간 라인 (예고)
        const t = this.laserChargeTime / 1.0;
        ctx.strokeStyle = `rgba(255, 50, 80, ${0.3 + 0.5 * t})`;
        ctx.lineWidth = 2 + t * 4;
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ff2050';
        ctx.setLineDash([15, 8]);
        ctx.lineDashOffset = -t * 60;
        ctx.beginPath();
        ctx.moveTo(wsLocalX, wsLocalY);
        ctx.lineTo(wsLocalX + Math.cos(this.laserAngle) * lineLen, wsLocalY + Math.sin(this.laserAngle) * lineLen);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 차징 게이지 (보스 주변)
        ctx.strokeStyle = '#ff2050';
        ctx.lineWidth = 4;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 20, -Math.PI/2, -Math.PI/2 + TAU * t);
        ctx.stroke();
      } else {
        // 발사 중 — 두꺼운 빨간 빔 + 화이트 코어
        const fireT = this.laserFireTime / 6;
        // 빔 끝나갈 때 알파 감소
        const alpha = fireT > 0.85 ? (1 - fireT) / 0.15 : 1;
        
        // 외곽 글로우
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = '#ff0040';
        ctx.lineWidth = 60;
        ctx.shadowBlur = 40;
        ctx.shadowColor = '#ff0040';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(wsLocalX, wsLocalY);
        ctx.lineTo(wsLocalX + Math.cos(this.laserAngle) * lineLen, wsLocalY + Math.sin(this.laserAngle) * lineLen);
        ctx.stroke();
        
        // 메인 빔
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ff2050';
        ctx.lineWidth = 30;
        ctx.beginPath();
        ctx.moveTo(wsLocalX, wsLocalY);
        ctx.lineTo(wsLocalX + Math.cos(this.laserAngle) * lineLen, wsLocalY + Math.sin(this.laserAngle) * lineLen);
        ctx.stroke();
        
        // 화이트 코어
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8;
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(wsLocalX, wsLocalY);
        ctx.lineTo(wsLocalX + Math.cos(this.laserAngle) * lineLen, wsLocalY + Math.sin(this.laserAngle) * lineLen);
        ctx.stroke();
        
        ctx.lineCap = 'butt';
      }
      
      ctx.restore();
    }
    
    const bossKeys = { 1: 'boss_baekgyu', 2: 'boss_crackson', 3: 'boss_reaper', 4: 'boss_cp09', 5: 'boss_geminator' };
    const bossKey = bossKeys[this.level];
    if (bossKey && drawEntityImage(bossKey, 0, 0, 0, this.facingLeft)) {
      ctx.restore();
      // 제미네이터는 약점도 그려야 함 (약점은 보스 뒤쪽 — angle 기반 위치 유지)
      if (this.level === 5) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(this.angle);
        // weak spot at FRONT (앞면) — 플레이어 방향
        ctx.fillStyle = '#ff0000';
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#ff0000';
        ctx.beginPath();
        ctx.arc(this.r * 0.7, 0, this.weakSpotR, 0, TAU);
        ctx.fill();
        // 약점 외곽 빛 펄스 (시인성 ↑)
        ctx.strokeStyle = '#ffaaaa';
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(STATE.realTime * 0.01);
        ctx.beginPath();
        ctx.arc(this.r * 0.7, 0, this.weakSpotR + 8, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      // boss HP bar at top is handled by HUD; nothing else to draw
      return;
    }
    
    // 도형 폴백: 회전 적용 (이미지가 없을 때만)
    ctx.rotate(this.angle);
    
    if (this.hitFlash > 0) {
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = this.color;
    }
    
    ctx.shadowBlur = 20;
    ctx.shadowColor = this.color;
    
    if (this.level === 1) {
      // 백규 - cowboy figure
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.stroke();
      // hat
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.ellipse(-2, -2, this.r * 1.2, 4, 0, 0, TAU);
      ctx.fill();
      // revolver
      ctx.fillStyle = '#444';
      ctx.fillRect(this.r * 0.4, -3, 18, 6);
    } else if (this.level === 2) {
      // shielded brute
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 3;
      ctx.stroke();
      // shield
      ctx.fillStyle = `rgba(180, 220, 255, 0.6)`;
      ctx.strokeStyle = '#88ccff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 12, -Math.PI/2.5, Math.PI/2.5);
      ctx.stroke();
      ctx.fillRect(this.r + 8, -this.r - 4, 6, this.r * 2 + 8);
      // charge indicator
      if (this.charging) {
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ff2050';
        ctx.fillStyle = '#ff2050';
        ctx.fillRect(-this.r, -this.r, this.r * 2, this.r * 2);
      }
    } else if (this.level === 3) {
      // hooded reaper
      ctx.beginPath();
      ctx.moveTo(this.r, 0);
      ctx.lineTo(0, this.r);
      ctx.lineTo(-this.r, 0);
      ctx.lineTo(0, -this.r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#400060';
      ctx.lineWidth = 3;
      ctx.stroke();
      // scythe glow
      ctx.fillStyle = '#ff00ff';
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ff00ff';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.4, 0, TAU);
      ctx.fill();
    } else if (this.level === 4) {
      // robotic
      ctx.fillStyle = '#003366';
      ctx.fillRect(-this.r, -this.r, this.r * 2, this.r * 2);
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 3;
      ctx.strokeRect(-this.r, -this.r, this.r * 2, this.r * 2);
      // eye
      ctx.fillStyle = '#00ffff';
      ctx.shadowBlur = 25;
      ctx.shadowColor = '#00ffff';
      ctx.fillRect(-this.r * 0.6, -3, this.r * 1.2, 6);
      // bits
      const bx = Math.sin(this.phaseTimer * 3) * 6;
      ctx.fillStyle = '#00aaff';
      ctx.fillRect(this.r * 0.7, -8 + bx, 4, 4);
      ctx.fillRect(this.r * 0.7, 4 - bx, 4, 4);
    } else if (this.level === 5) {
      // tank
      ctx.fillStyle = '#660020';
      ctx.fillRect(-this.r, -this.r, this.r * 2, this.r * 2);
      ctx.strokeStyle = '#ff0040';
      ctx.lineWidth = 4;
      ctx.strokeRect(-this.r, -this.r, this.r * 2, this.r * 2);
      // legs
      ctx.fillStyle = '#222';
      for (const corner of [[-this.r-4, -this.r-4], [this.r-4, -this.r-4], [-this.r-4, this.r-4], [this.r-4, this.r-4]]) {
        ctx.fillRect(corner[0], corner[1], 8, 8);
      }
      // turret
      ctx.fillStyle = '#aa0030';
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, -3, this.r + 5, 6);
      
      // weak spot (FRONT)
      ctx.fillStyle = '#ffff00';
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ffff00';
      ctx.beginPath();
      ctx.arc(this.r + 8, 0, this.weakSpotR * 0.5 + Math.sin(this.phaseTimer * 8) * 2, 0, TAU);
      ctx.fill();
    }
    
    ctx.restore();
  }
}

// =============================================================
// PARTICLES
// =============================================================
class Particle {
  constructor(x, y, dx, dy, life, color, size) {
    this.x = x; this.y = y; this.dx = dx; this.dy = dy;
    this.life = life; this.life0 = life;
    this.color = color; this.size = size;
    this.dead = false;
  }
  update(dt) {
    this.x += this.dx * dt;
    this.y += this.dy * dt;
    this.dx *= 0.92;
    this.dy *= 0.92;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    const a = this.life / this.life0;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;
    ctx.fillRect(s.x - this.size/2, s.y - this.size/2, this.size, this.size);
    ctx.restore();
  }
}

class DmgNumber {
  constructor(x, y, value, color, text) {
    this.x = x; this.y = y;
    this.text = text || (value > 0 ? `-${value}` : (value === 0 ? '0' : `+${-value}`));
    this.color = color;
    this.life = 0.8; this.life0 = 0.8;
    this.dy = -40;
    this.dead = false;
  }
  update(dt) {
    this.y += this.dy * dt;
    this.dy *= 0.95;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    const a = this.life / this.life0;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;
    ctx.font = 'bold 14px Bebas Neue';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, s.x, s.y);
    ctx.restore();
  }
}

// =============================================================
// PICKUPS
// =============================================================
class Pickup {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.type = type;
    this.r = 24;
    this.life = 30;
    this.dead = false;
    this.bounce = 0;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.bounce += dt * 4;
    
    // Magnet (자석) - 범위 크게, 속도 빠르게
    const d = dist(this, player);
    const magnetRange = 220;   // 기존 100 → 220 (2.2배)
    if (d < magnetRange) {
      const a = angleTo(this, player);
      // 가까울수록 더 빠르게 끌려옴 (역제곱 비슷한 느낌)
      const proximity = 1 - d / magnetRange;
      const pullSpeed = 500 + proximity * 800;   // 기존 200 고정 → 500~1300
      this.x += Math.cos(a) * pullSpeed * dt;
      this.y += Math.sin(a) * pullSpeed * dt;
    }
    
    if (d < this.r + player.r + 8) {  // +8 여유로 더 쉽게 줍기
      this.dead = true;
      this.collect();
    }
  }
  collect() {
    if (this.type === 'ammo') {
      player.ammo = Math.min(player.ammoMaxEff(), player.ammo + 30);
    } else if (this.type === 'btc') {
      player.btc += Math.floor(rand(15, 50));
    } else if (this.type === 'battery') {
      player.battery = Math.min(player.batteryMax * (1 + 0.2 * (player.upgrades['ionSlot'] || 0)), player.battery + 50);
    }
    sfx('pickup');
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x < -30 || s.x > W + 30 || s.y < -30 || s.y > H + 30) return;
    
    // Image override 시도
    const imgKey = 'pickup_' + this.type;
    const bobOffset = Math.sin(this.bounce) * 3;
    const alpha = this.life < 5 ? (Math.sin(this.life * 8) + 1) / 2 : 1;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    if (drawEntityImage(imgKey, s.x, s.y + bobOffset, 0, false)) {
      ctx.restore();
      return;
    }
    ctx.restore();
    
    // Fallback: 도형 렌더링
    const colors = { ammo: '#ffcc00', btc: '#ff8800', battery: '#00d4ff' };
    const labels = { ammo: '▣', btc: '₿', battery: '⚡' };
    const c = colors[this.type];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s.x, s.y + bobOffset);
    ctx.shadowBlur = 12;
    ctx.shadowColor = c;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px Bebas Neue';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[this.type], 0, 1);
    ctx.restore();
  }
}

// =============================================================
// OBSTACLES
// =============================================================
class Obstacle {
  constructor(x, y, explosive, opts) {
    this.x = x; this.y = y;
    // opts 가 주어지면 그 값을 사용 (리스폰 시) — 아니면 새로 랜덤 생성
    // 캐릭터 크기에 비례해서 2배 확대 (기존 40~100 → 80~200)
    this.w = (opts && opts.w) || rand(80, 200);
    this.h = (opts && opts.h) || rand(80, 200);
    this.hp = explosive ? 5 : 999;
    this.maxHp = this.hp;
    // destructible: 폭발물이거나, opts 로 지정됐거나, 40% 확률
    if (opts && opts.destructible !== undefined) {
      this.destructible = opts.destructible;
    } else {
      this.destructible = explosive || Math.random() < 0.4;
    }
    if (this.destructible && !explosive) this.hp = 8;
    this.explosive = explosive;
    this.dead = false;
  }
  takeDamage(d) {
    if (!this.destructible) return;
    this.hp -= d;
    if (this.hp <= 0) {
      this.dead = true;
      // 60초 후 리스폰 큐에 추가 (이 위치에 새 장애물이 다시 생김)
      respawnQueue.push({
        x: this.x, y: this.y,
        w: this.w, h: this.h,
        explosive: this.explosive,
        destructible: true,  // 리스폰된 건 항상 destructible
        timer: 60,           // 60초 후 홀로그램 시작
      });
      
      if (this.explosive) {
        effects.push(new Explosion(this.x, this.y, 260, 5));
        sfx('explode');
        for (const en of enemies) {
          if (en.dead) continue;
          if (dist(this, en) < 260) en.takeDamage(5);
        }
        if (bossEntity && !bossEntity.dead && dist(this, bossEntity) < 260) bossEntity.takeDamage(5);
        if (player && !player.rolling && dist(this, player) < 200) player.takeDamage();
        STATE.shake = Math.max(STATE.shake, 25);
      } else {
        for (let i = 0; i < 15; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 200), Math.sin(a) * rand(80, 200), 0.6, '#666', 6));
        }
      }
      
      // 10% 확률로 픽업 드롭 (탄박스/BTC/배터리 중 하나)
      if (Math.random() < 0.1) {
        const types = ['ammo', 'btc', 'battery'];
        const t = types[Math.floor(Math.random() * types.length)];
        pickups.push(new Pickup(this.x, this.y, t));
      }
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x + this.w < 0 || s.x - this.w > W || s.y + this.h < 0 || s.y - this.h > H) return;
    
    // Image override
    const imgKey = this.explosive ? 'obstacle_explosive' : 'obstacle_wall';
    if (drawEntityImageRect(imgKey, s.x, s.y, this.w, this.h)) {
      // HP bar는 그대로 그림
      if (this.destructible && !this.explosive && this.hp < this.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(s.x - this.w/2, s.y - this.h/2 - 6, this.w, 3);
        ctx.fillStyle = '#ff5050';
        ctx.fillRect(s.x - this.w/2, s.y - this.h/2 - 6, this.w * (this.hp / this.maxHp), 3);
      }
      return;
    }
    
    ctx.save();
    if (this.explosive) {
      ctx.fillStyle = '#330000';
      ctx.strokeStyle = '#ff0000';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ff0000';
    } else if (this.destructible) {
      ctx.fillStyle = '#333';
      ctx.strokeStyle = '#888';
    } else {
      ctx.fillStyle = '#1a1a22';
      ctx.strokeStyle = '#444';
    }
    ctx.lineWidth = 3;
    ctx.fillRect(s.x - this.w/2, s.y - this.h/2, this.w, this.h);
    ctx.strokeRect(s.x - this.w/2, s.y - this.h/2, this.w, this.h);
    
    if (this.explosive) {
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 18px Bebas Neue';
      ctx.textAlign = 'center';
      ctx.fillText('☢', s.x, s.y + 6);
    }
    
    if (this.destructible && !this.explosive && this.hp < this.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(s.x - this.w/2, s.y - this.h/2 - 6, this.w, 3);
      ctx.fillStyle = '#ff5050';
      ctx.fillRect(s.x - this.w/2, s.y - this.h/2 - 6, this.w * (this.hp / this.maxHp), 3);
    }
    ctx.restore();
  }
}

// =============================================================
// EFFECTS
// =============================================================
class RespawnHologram {
  constructor(x, y, w, h, explosive, destructible) {
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this.explosive = explosive;
    this.destructible = destructible;
    this.life = 3.0;       // 3초 동안 홀로그램 표시
    this.life0 = 3.0;
    this.dead = false;
    this.scanline = 0;
  }
  update(dt) {
    this.life -= dt;
    this.scanline += dt;
    if (this.life <= 0) {
      // 실제 장애물 생성
      const ob = new Obstacle(this.x, this.y, this.explosive, {
        w: this.w, h: this.h, destructible: this.destructible
      });
      obstacles.push(ob);
      // 등장 효과
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * TAU;
        particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 200), Math.sin(a) * rand(80, 200), 0.4, '#00d4ff', 5));
      }
      sfx('pickup');
      this.dead = true;
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x + this.w < 0 || s.x - this.w > W || s.y + this.h < 0 || s.y - this.h > H) return;
    
    // 처음 0.5초는 서서히 나타나고, 마지막 0.3초는 깜빡거림
    const t = 1 - this.life / this.life0;
    let alpha;
    if (t < 0.15) alpha = t / 0.15;
    else if (this.life < 0.3) alpha = (Math.sin(this.life * 40) + 1) / 2;
    else alpha = 0.7 + Math.sin(this.scanline * 6) * 0.15;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    
    // 메인 색깔 — 폭발물이면 노란빛, 아니면 시안
    const mainColor = this.explosive ? '#ffaa00' : '#00d4ff';
    
    // 외곽 글로우 사각형
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 25;
    ctx.shadowColor = mainColor;
    ctx.strokeRect(s.x - this.w/2, s.y - this.h/2, this.w, this.h);
    
    // 내부 fill (반투명)
    ctx.fillStyle = mainColor;
    ctx.globalAlpha = alpha * 0.15;
    ctx.fillRect(s.x - this.w/2, s.y - this.h/2, this.w, this.h);
    
    // 스캔라인 (홀로그램스러움)
    ctx.globalAlpha = alpha * 0.4;
    ctx.shadowBlur = 0;
    ctx.fillStyle = mainColor;
    const scanY = s.y - this.h/2 + (this.scanline * 60) % this.h;
    ctx.fillRect(s.x - this.w/2, scanY, this.w, 2);
    
    // 가로 격자 (디지털 느낌)
    ctx.globalAlpha = alpha * 0.25;
    ctx.lineWidth = 1;
    ctx.strokeStyle = mainColor;
    for (let i = 0; i < this.h; i += 8) {
      ctx.beginPath();
      ctx.moveTo(s.x - this.w/2, s.y - this.h/2 + i);
      ctx.lineTo(s.x + this.w/2, s.y - this.h/2 + i);
      ctx.stroke();
    }
    
    // 가운데 ⚠ (폭발물) 또는 ▣ (벽)
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = 15;
    ctx.shadowColor = mainColor;
    ctx.fillStyle = mainColor;
    ctx.font = 'bold 20px Bebas Neue';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.explosive ? '☢' : '▣', s.x, s.y);
    
    ctx.restore();
  }
}

class BloodStain {
  constructor(x, y, enemyR) {
    this.x = x; this.y = y;
    this.r = enemyR + rand(4, 12);  // 약간 흩뿌려진 듯한 크기
    // 8초 가량 진하게 → 4초 동안 천천히 사라짐
    this.life = 12;
    this.life0 = 12;
    this.fadeStart = 8;
    this.dead = false;
    // 약간의 형태 변형: 메인 원 + 작은 spatter 점들
    this.splatters = [];
    const count = Math.floor(rand(4, 8));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const d = rand(this.r * 0.4, this.r * 1.4);
      this.splatters.push({
        ox: Math.cos(a) * d,
        oy: Math.sin(a) * d,
        r: rand(2, 6),
      });
    }
    // 미세한 회전으로 모든 핏자국이 똑같이 보이지 않게
    this.rotation = Math.random() * TAU;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x < -50 || s.x > W + 50 || s.y < -50 || s.y > H + 50) return;
    
    // 페이드 알파: life > fadeStart 면 1, 그 이하면 선형 감소
    let alpha;
    if (this.life > this.fadeStart) {
      alpha = 0.7;
    } else {
      alpha = 0.7 * (this.life / this.fadeStart);
    }
    
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(this.rotation);
    ctx.globalAlpha = alpha;
    
    // 메인 핏 풀 (약간 어두운 빨강)
    ctx.fillStyle = '#7a0010';
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, TAU);
    ctx.fill();
    
    // 가운데 더 진한 코어
    ctx.fillStyle = '#4a0008';
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.55, 0, TAU);
    ctx.fill();
    
    // 흩뿌려진 점들
    ctx.fillStyle = '#6a000c';
    for (const sp of this.splatters) {
      ctx.beginPath();
      ctx.arc(sp.ox, sp.oy, sp.r, 0, TAU);
      ctx.fill();
    }
    
    ctx.restore();
  }
}

class SlashImpactFlash {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.life = 0.25;
    this.life0 = 0.25;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    const a = this.life / this.life0;
    const r = (1 - a) * 100 + 20;
    ctx.save();
    // 외곽 빨간 링 (확장)
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ff3050';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 25;
    ctx.shadowColor = '#ff3050';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, TAU);
    ctx.stroke();
    // 중심 화이트 (강한 임팩트)
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.4, 0, TAU);
    ctx.fill();
    // 십자선 (베인 자국)
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const len = r * 1.4;
    ctx.moveTo(s.x - len * 0.7, s.y - len * 0.3);
    ctx.lineTo(s.x + len * 0.7, s.y + len * 0.3);
    ctx.stroke();
    ctx.restore();
  }
}

class SlashEffect {
  constructor(x, y, radius, stage, damage) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.stage = stage;
    this.damage = damage;       // 한 번만 데미지를 입히기 위해 보관
    this.life = 0.32;           // 잔상 지속 시간 (slashAnimTime과 맞춤)
    this.life0 = 0.32;
    this.dead = false;
    this.angle = player ? player.angle : 0;
    
    // 이미 맞은 적/총알을 추적 (한 슬래시에서 한 번만 적중)
    this.hitEnemies = new Set();
    this.reflectedBullets = new Set();
    this.bossHit = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    
    // 슬래시는 플레이어를 따라다니지 않음 — 휘두른 위치/각도에 고정.
    // (이게 더 자연스러움. 플레이어가 움직이면서 같은 슬래시가 따라다니면 어색)
    
    // 부채꼴(180도) 안에 들어오는지 체크하는 헬퍼
    // — 플레이어가 보고 있는 방향(this.angle) ±90도 안에 있어야 적중
    const inCone = (tx, ty) => {
      const a = Math.atan2(ty - this.y, tx - this.x);
      let diff = a - this.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      return Math.abs(diff) <= Math.PI / 2;  // ±90도 = 180도 콘
    };
    
    // 적 데미지 (지속) — 강한 타격감
    for (const en of enemies) {
      if (en.dead) continue;
      if (this.hitEnemies.has(en)) continue;
      if (dist(this, en) < this.radius + en.r && inCone(en.x, en.y)) {
        en.takeDamage(this.damage);
        this.hitEnemies.add(en);
        STATE.hitstop = Math.max(STATE.hitstop, 180);   // 110 → 180 (더 멈춤)
        STATE.shake = Math.max(STATE.shake, 14);        // 32 → 14 (덜 흔들림)
        
        // 강한 적중 파티클 (적 위치에서 폭발하듯)
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * TAU;
          const sp = rand(180, 480);
          particles.push(new Particle(en.x, en.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), i % 3 === 0 ? '#ffffff' : '#ff5050', 6));
        }
        // 슬래시 라인 잔상
        effects.push(new SlashImpactFlash(en.x, en.y));
      }
    }
    if (bossEntity && !bossEntity.dead && !this.bossHit) {
      if (dist(this, bossEntity) < this.radius + bossEntity.r && inCone(bossEntity.x, bossEntity.y)) {
        bossEntity.takeDamage(this.damage);
        this.bossHit = true;
        STATE.hitstop = Math.max(STATE.hitstop, 250);   // 150 → 250
        STATE.shake = Math.max(STATE.shake, 18);        // 40 → 18
        for (let i = 0; i < 25; i++) {
          const a = Math.random() * TAU;
          const sp = rand(200, 550);
          particles.push(new Particle(bossEntity.x, bossEntity.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.4, 0.9), i % 3 === 0 ? '#ffffff' : '#ff5050', 7));
        }
        effects.push(new SlashImpactFlash(bossEntity.x, bossEntity.y));
      }
    }
    
    // 장애물/폭발물 파괴 — 카타나는 destructible 무시 (모든 걸 부숨)
    for (const ob of obstacles) {
      if (ob.dead) continue;
      // 사각형의 가장 가까운 점까지 거리
      const cx = clamp(this.x, ob.x - ob.w/2, ob.x + ob.w/2);
      const cy = clamp(this.y, ob.y - ob.h/2, ob.y + ob.h/2);
      const dd = Math.hypot(this.x - cx, this.y - cy);
      if (dd < this.radius && inCone(ob.x, ob.y)) {
        const wasDestructible = ob.destructible;
        ob.destructible = true;
        ob.takeDamage(999);
        if (!ob.dead) ob.destructible = wasDestructible;
      }
    }
    
    // 총알 반사 (지속) — 매우 빠르게 + 강한 임팩트
    // 플레이어가 보고 있는 방향 ±90도 안의 총알만 반격
    for (const eb of enemyBullets) {
      if (eb.dead) continue;
      if (this.reflectedBullets.has(eb)) continue;
      if (eb.fromPlayer) continue;
      if (dist(this, eb) < this.radius && inCone(eb.x, eb.y)) {
        // 반사 시 가장 가까운 적/보스 방향으로 redirect
        let target = null;
        let bestD = Infinity;
        for (const en of enemies) {
          if (en.dead) continue;
          const d = dist(eb, en);
          if (d < bestD) { bestD = d; target = en; }
        }
        if (bossEntity && !bossEntity.dead) {
          const d = dist(eb, bossEntity);
          if (d < bestD) { bestD = d; target = bossEntity; }
        }
        
        // 기존 속도 크기 측정
        const curSpeed = Math.hypot(eb.dx, eb.dy);
        const newSpeed = Math.max(curSpeed, 1200) * 3;  // 3배 가속, 최소 3600
        
        let nx, ny;
        if (target && bestD < 600) {
          // 자동 조준 (가까이 있는 적이 있으면)
          const a = angleTo(eb, target);
          nx = Math.cos(a);
          ny = Math.sin(a);
        } else {
          // 단순 반사
          const cur = Math.hypot(eb.dx, eb.dy) || 1;
          nx = -eb.dx / cur;
          ny = -eb.dy / cur;
        }
        eb.dx = nx * newSpeed;
        eb.dy = ny * newSpeed;
        eb.fromPlayer = true;
        eb.damage = Math.max(eb.damage, 5);  // 데미지도 ↑
        this.reflectedBullets.add(eb);
        
        STATE.hitstop = Math.max(STATE.hitstop, 140);    // 80 → 140
        STATE.shake = Math.max(STATE.shake, 10);         // 22 → 10
        
        // 반사 시 강한 파티클 + 충격파
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * TAU;
          const sp = rand(200, 450);
          particles.push(new Particle(eb.x, eb.y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.6), '#ffffff', 5));
        }
        // 황금색 트레일 시작점 표시
        effects.push(new SlashImpactFlash(eb.x, eb.y));
      }
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    const colors = ['#fff', '#ffffff', '#ffcc00', '#ffaa00'];
    const color = colors[this.stage] || '#fff';
    const a = this.life / this.life0;
    
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.shadowBlur = 25;
    ctx.shadowColor = color;
    ctx.lineWidth = 6 + this.stage * 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius * (0.7 + 0.3 * (1 - a)), this.angle - Math.PI * 0.7, this.angle + Math.PI * 0.7);
    ctx.stroke();
    
    // inner arc
    ctx.lineWidth = 3;
    ctx.globalAlpha = a * 0.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius * (0.6 + 0.4 * (1 - a)), this.angle - Math.PI * 0.5, this.angle + Math.PI * 0.5);
    ctx.stroke();
    
    ctx.restore();
  }
}

class Explosion {
  constructor(x, y, radius, dmg) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.dmg = dmg;
    this.life = 0.4;
    this.life0 = 0.4;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    const a = this.life / this.life0;
    const r = this.radius * (1 - a);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffcc00';
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#ff6600';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class Bombardment {
  constructor(x, y, radius, warningTime) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.warningTime = warningTime;
    this.timer = warningTime;
    this.exploded = false;
    this.dead = false;
    this.afterTime = 0.5;
  }
  update(dt) {
    if (!this.exploded) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.exploded = true;
        sfx('explode');
        STATE.shake = 25;
        if (!player.rolling && dist(this, player) < this.radius) {
          player.takeDamage();
        }
        for (const en of enemies) {
          if (en.dead) continue;
          if (dist(this, en) < this.radius) en.takeDamage(5);
        }
        // 장애물/폭발물 강제 파괴 (destructible 무시 — CP-09 포격은 모든 걸 부숨)
        for (const ob of obstacles) {
          if (ob.dead) continue;
          if (dist(this, ob) < this.radius) {
            // destructible 잠깐 켜고 큰 데미지
            const wasDestructible = ob.destructible;
            ob.destructible = true;
            ob.takeDamage(999);
            // 살아남은 경우(이론상 없음)는 원복
            if (!ob.dead) ob.destructible = wasDestructible;
          }
        }
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(150, 400), Math.sin(a) * rand(150, 400), 1, ['#ff0000', '#ffcc00'][i%2], 8));
        }
      }
    } else {
      this.afterTime -= dt;
      if (this.afterTime <= 0) this.dead = true;
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    ctx.save();
    if (!this.exploded) {
      // Image override 시도 (경고 단계만 - 폭발은 항상 effects/explosion으로)
      if (drawEntityImageRect('bombardment', s.x, s.y, this.radius * 2, this.radius * 2)) {
        // 깜빡이는 알파 적용용 — 이미지 위에 빨간 펄스 오버레이
        const t = 1 - this.timer / this.warningTime;
        ctx.globalAlpha = 0.4 * (0.5 + 0.5 * Math.sin(t * 30));
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(s.x, s.y, this.radius, 0, TAU);
        ctx.fill();
        ctx.restore();
        return;
      }
      
      const t = 1 - this.timer / this.warningTime;
      ctx.strokeStyle = `rgba(255, 0, 0, ${0.5 + 0.4 * Math.sin(t * 30)})`;
      ctx.lineWidth = 3;
      ctx.fillStyle = `rgba(255, 0, 0, ${0.15 + 0.2 * t})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, this.radius, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // crosshair
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - this.radius, s.y);
      ctx.lineTo(s.x + this.radius, s.y);
      ctx.moveTo(s.x, s.y - this.radius);
      ctx.lineTo(s.x, s.y + this.radius);
      ctx.stroke();
    } else {
      const t = this.afterTime / 0.5;
      ctx.fillStyle = `rgba(255, 200, 0, ${t})`;
      ctx.shadowBlur = 50;
      ctx.shadowColor = '#ff6600';
      ctx.beginPath();
      ctx.arc(s.x, s.y, this.radius * (1.2 - t * 0.2), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Drone
class Drone {
  constructor() {
    this.angle = Math.random() * TAU;
    this.distance = 160;
    this.cooldown = 1;
    this.x = player.x;
    this.y = player.y;
    this.spinTime = 0;
  }
  update(dt) {
    this.spinTime += dt;
    this.angle += dt * 1.5 + Math.sin(this.spinTime * 2) * 0.3;
    this.distance = 140 + Math.sin(this.spinTime * 1.3) * 50;
    this.x = player.x + Math.cos(this.angle) * this.distance;
    this.y = player.y + Math.sin(this.angle) * this.distance;
    
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      // Find nearest enemy
      let target = null;
      let bd = 400;
      for (const en of enemies) {
        if (en.dead) continue;
        const d = dist(this, en);
        if (d < bd) { bd = d; target = en; }
      }
      if (!target && bossEntity && !bossEntity.dead) {
        if (dist(this, bossEntity) < 400) target = bossEntity;
      }
      if (target) {
        const a = angleTo(this, target);
        bullets.push(new Bullet(this.x, this.y, Math.cos(a) * 1500, Math.sin(a) * 1500, 400, 1));
        this.cooldown = 0.4;
      } else {
        this.cooldown = 0.2;
      }
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    
    // Image override
    if (drawEntityImage('drone', s.x, s.y, this.spinTime * 5, false)) {
      return;
    }
    
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(this.spinTime * 5);
    ctx.fillStyle = '#0080ff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#00aaff';
    ctx.fillRect(-6, -6, 12, 12);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
}

let drone = null;


// =============================================================
// IMAGES
// =============================================================
// =============================================================
// IMAGE & ANIMATION SYSTEM
// =============================================================
// 
// 애니메이션 사용 방법:
// 1) 단일 이미지 (현재 기본): 한 장만 사용. 프레임 = 1.
// 2) 스프라이트 시트 (가로 배열): 한 장 안에 N개 프레임이 가로로 배치된 PNG.
//    예: player_move.png 가 256x64 (= 64x64 프레임 4개) 라면 자동으로 4프레임 애니메이션.
// 3) 개별 프레임 이미지: player_move_0.png, player_move_1.png ... 형태로 저장.
//
// ANIMATIONS 정의에서 각 상태의 frameWidth, frameCount, fps, loop 를 지정.
// frameCount > 1 이고 단일 이미지를 사용하면, 이미지 너비가 frameCount * frameWidth 여야 함.
// 이미지가 그보다 작으면(=단일 프레임 이미지면) 자동으로 1프레임으로 fallback.

const ANIMATIONS = {
  idle:  { src: 'images/player_idle.png',  frameW: 128, frameH: 128, frameCount: 1, fps: 4,  loop: true  },
  walk:  { src: 'images/player_move.png',  frameW: 128, frameH: 128, frameCount: 4, fps: 8,  loop: true  },
  shoot: { src: 'images/player_shoot.png', frameW: 128, frameH: 128, frameCount: 1, fps: 16, loop: false },
  slash: { src: 'images/player_slash.png', frameW: 128, frameH: 128, frameCount: 1, fps: 14, loop: false },
};

// =============================================================
// 적/보스/장애물/아이템 이미지 등록표
// =============================================================
// 이미지 파일을 images/ 폴더에 넣고 같은 키로 이름을 맞추세요.
// 파일이 없으면 자동으로 기존 도형 렌더링으로 폴백됩니다 (게임 안 깨짐).
//
// size: 표시 크기 (px). 적/보스의 경우 entity.r 의 약 2배가 적당합니다.
// rotate: true 면 마우스/이동 방향으로 회전. false 면 좌우 반전 또는 고정.
// flip: 'left' 면 좌측으로 진행 시 좌우 반전.
//
const ENTITY_IMAGES = {
  // 일반 적 (5종) — 모두 플레이어와 같은 128px, 방패병만 160px. 회전 X (좌우 반전만).
  enemy_rusher:    { src: 'images/enemy_rusher.png',    size: 128, rotate: false, flip: false },
  enemy_shooter:   { src: 'images/enemy_shooter.png',   size: 128, rotate: false, flip: false },
  enemy_shielder:  { src: 'images/enemy_shielder.png',  size: 160, rotate: false, flip: false },
  enemy_assassin:  { src: 'images/enemy_assassin.png',  size: 128, rotate: false, flip: false },
  enemy_sniper:    { src: 'images/enemy_sniper.png',    size: 128, rotate: false, flip: false },
  
  // 보스 (5종) — 기존 대비 약 2배 확대. 회전 X.
  boss_baekgyu:    { src: 'images/boss_baekgyu.png',    size: 128, rotate: false, flip: false },  // 백규
  boss_crackson:   { src: 'images/boss_crackson.png',   size: 180, rotate: false, flip: false },  // 크랙슨
  boss_reaper:     { src: 'images/boss_reaper.png',     size: 112, rotate: false, flip: false },  // 리퍼
  boss_cp09:       { src: 'images/boss_cp09.png',       size: 160, rotate: false, flip: false },  // CP-09
  boss_geminator:  { src: 'images/boss_geminator.png',  size: 280, rotate: false, flip: false },  // 제미네이터
  
  // 아이템 (3종) — 픽업도 캐릭터 비율에 맞춰 2배
  pickup_ammo:     { src: 'images/pickup_ammo.png',     size: 56, rotate: false, flip: false },
  pickup_btc:      { src: 'images/pickup_btc.png',      size: 56, rotate: false, flip: false },
  pickup_battery:  { src: 'images/pickup_battery.png',  size: 56, rotate: false, flip: false },
  
  // 장애물 (2종)
  obstacle_wall:     { src: 'images/obstacle_wall.png',     size: 0, rotate: false, flip: false }, // size=0 = 실제 사이즈에 맞춤
  obstacle_explosive:{ src: 'images/obstacle_explosive.png',size: 0, rotate: false, flip: false },
  
  // 필드/배경
  // mode: 'tile' = 타일링 (기본), 'stretch' = 월드 전체에 한 장으로 늘림
  // tileSize: 타일 한 장의 크기 (기본=이미지 원본 크기)
  field:           { src: 'images/field.png', mode: 'tile', tileSize: 256, rotate: false, flip: false },
  
  // 기타
  drone:           { src: 'images/drone.png',           size: 48, rotate: false, flip: false },
  bombardment:     { src: 'images/bombardment.png',     size: 0,  rotate: false, flip: false }, // size=0 = radius*2
};

// ↑ 위 frameCount 만 바꾸면 됩니다.
// 예: walk 애니메이션을 4프레임으로 하고 싶으면 player_move.png 를 256x64 스프라이트시트로 만들고
// frameCount: 4 로 변경. 그 외 코드는 건드릴 필요 없음.

const IMG = {};          // 추가 이미지 (title, standing 등) - 직접 접근용
const IMG_READY = {};    // 로드 상태
const ANIM_IMAGES = {};  // 애니메이션용 Image 객체
const ENTITY_IMG = {};   // 엔티티 이미지 (key → Image)

// 애니메이션 이외의 이미지
const extraImages = [
  ['title', 'images/title.png'],
  ['standing', 'images/standing.png'],
];
for (const [key, src] of extraImages) {
  const img = new Image();
  IMG_READY[key] = false;
  img.onload = () => {
    IMG_READY[key] = true;
    console.log('[IMG] Loaded: ' + src + ' (' + img.naturalWidth + 'x' + img.naturalHeight + ')');
  };
  img.onerror = () => {
    IMG_READY[key] = false;
    console.warn('[IMG] FAILED to load: ' + src);
  };
  img.src = src + '?v=' + Date.now();
  IMG[key] = img;
}

// 애니메이션 이미지 로딩
for (const [state, anim] of Object.entries(ANIMATIONS)) {
  const img = new Image();
  IMG_READY['anim_' + state] = false;
  img.onload = () => {
    IMG_READY['anim_' + state] = true;
    // 자동 프레임 수 보정: 이미지 너비가 작으면 1프레임으로 강제
    const detectedFrames = Math.max(1, Math.floor(img.naturalWidth / anim.frameW));
    if (detectedFrames < anim.frameCount) {
      console.warn('[ANIM] ' + state + ': declared ' + anim.frameCount + ' frames but image only has ' + detectedFrames + '. Using ' + detectedFrames + '.');
      anim.frameCount = detectedFrames;
    }
    console.log('[ANIM] Loaded: ' + state + ' (' + img.naturalWidth + 'x' + img.naturalHeight + ', frames=' + anim.frameCount + ')');
  };
  img.onerror = () => {
    IMG_READY['anim_' + state] = false;
    console.warn('[ANIM] FAILED to load: ' + anim.src + ' — using shape fallback for ' + state);
  };
  img.src = anim.src + '?v=' + Date.now();
  ANIM_IMAGES[state] = img;
}

// 엔티티 이미지 로딩
for (const [key, conf] of Object.entries(ENTITY_IMAGES)) {
  const img = new Image();
  IMG_READY['ent_' + key] = false;
  img.onload = () => {
    IMG_READY['ent_' + key] = true;
    console.log('[ENT] Loaded: ' + conf.src + ' (' + img.naturalWidth + 'x' + img.naturalHeight + ')');
  };
  img.onerror = () => {
    IMG_READY['ent_' + key] = false;
    // 적/보스/장애물/아이템 이미지는 선택사항이므로 조용히 폴백
  };
  img.src = conf.src + '?v=' + Date.now();
  ENTITY_IMG[key] = img;
}

// 엔티티 이미지를 그리는 헬퍼.
// (cx, cy) = 캔버스상 중심점.
// 성공 시 true, 실패(이미지 없음) 시 false 반환 → false면 도형 폴백 사용.
// rotateAngle: 회전이 필요한 경우 라디안. null/undefined 면 회전 안 함.
// flipX: true 면 좌우 반전.
// overrideSize: ENTITY_IMAGES의 size를 무시하고 강제 지정 (장애물처럼 가변 크기용).
function drawEntityImage(key, cx, cy, rotateAngle, flipX, overrideSize) {
  const img = ENTITY_IMG[key];
  const conf = ENTITY_IMAGES[key];
  if (!img || !conf || !img.complete || img.naturalWidth === 0) return false;
  
  const size = overrideSize !== undefined ? overrideSize : conf.size;
  if (size <= 0) return false;
  
  ctx.save();
  ctx.translate(cx, cy);
  if (rotateAngle != null && conf.rotate) ctx.rotate(rotateAngle);
  if (flipX) ctx.scale(-1, 1);
  ctx.drawImage(img, -size/2, -size/2, size, size);
  ctx.restore();
  return true;
}

// 가변 크기(직사각형) 엔티티용 헬퍼: 장애물 등.
// (cx, cy) = 중심점, w/h = 크기.
function drawEntityImageRect(key, cx, cy, w, h) {
  const img = ENTITY_IMG[key];
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  
  ctx.save();
  ctx.translate(cx, cy);
  ctx.drawImage(img, -w/2, -h/2, w, h);
  ctx.restore();
  return true;
}

// 현재 시점의 프레임 그리기 도우미. (cx, cy) = 캔버스상 중심점, size = 표시 크기, flip = 좌우반전.
function drawAnimFrame(state, frameIndex, cx, cy, size, flip) {
  const anim = ANIMATIONS[state];
  const img = ANIM_IMAGES[state];
  if (!anim || !img || !img.complete || img.naturalWidth === 0) return false;
  
  const fIdx = Math.max(0, Math.min(anim.frameCount - 1, Math.floor(frameIndex)));
  const sx = fIdx * anim.frameW;
  const sy = 0;
  const sw = anim.frameW;
  const sh = anim.frameH;
  
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, sx, sy, sw, sh, -size/2, -size/2, size, size);
  ctx.restore();
  return true;
}

// 애니메이션 상태 매니저 (Player 인스턴스가 사용)
function makeAnimController() {
  return {
    state: 'idle',
    frameTime: 0,      // 현재 프레임에서 경과한 시간
    frameIdx: 0,       // 현재 프레임 인덱스
    finished: false,   // non-loop 애니메이션이 끝났는지
    
    setState(newState) {
      if (this.state === newState) return;
      this.state = newState;
      this.frameTime = 0;
      this.frameIdx = 0;
      this.finished = false;
    },
    
    update(dt) {
      const anim = ANIMATIONS[this.state];
      if (!anim) return;
      const frameDuration = 1 / anim.fps;
      this.frameTime += dt;
      while (this.frameTime >= frameDuration) {
        this.frameTime -= frameDuration;
        this.frameIdx++;
        if (this.frameIdx >= anim.frameCount) {
          if (anim.loop) {
            this.frameIdx = 0;
          } else {
            this.frameIdx = anim.frameCount - 1;
            this.finished = true;
            break;
          }
        }
      }
    },
  };
}

// =============================================================
// LIMIT BREAK OPTIONS
// =============================================================
const LIMIT_BREAKS = [
  { key: 'emp', name: '전자기총탄', desc: '총에 맞은 적 경직 (보스는 둔화)' },
  { key: 'runAndGun', name: '런앤건', desc: '구르기 사용시 총탄 풀충전' },
  { key: 'gunKata', name: '건카타', desc: '칼 휘두르면 주변 12발 자동 발사' },
  { key: 'slidingBoots', name: '슬라이딩 부츠', desc: '구르기 속도/빈도 증가' },
  { key: 'piercing', name: '관통탄', desc: '50% 확률로 적/장애물 관통' },
  { key: 'shukoji', name: '축지', desc: '구르기로 적 관통+데미지+장거리' },
  { key: 'librarian', name: '라이브러리안 드론', desc: '주변에서 적을 자동 사격' },
  { key: 'corpseExplode', name: '시체폭발', desc: '적 사망시 폭발해 주변 적 데미지' },
];

// =============================================================
// SHOP ITEMS
// =============================================================
const SHOP_ITEMS = [
  { key: 'ammoBuy', name: '탄약 구매', desc: '총알 +60', icon: '▣', cost: () => 50, max: 999, action: () => { player.ammo = Math.min(player.ammoMaxEff(), player.ammo + 60); } },
  { key: 'batteryBuy', name: '배터리 구매', desc: '배터리 풀충전', icon: '⚡', cost: () => 80, max: 999, action: () => { player.battery = player.batteryMax * (1 + 0.2 * (player.upgrades['ionSlot'] || 0)); } },
  { key: 'baseShots', name: '기본 발사 산탄수', desc: '+1 기본 산탄', icon: '✦', cost: (lv) => 100 * Math.pow(2, lv), max: 5 },
  { key: 'maxCharge', name: '최대 장전 산탄수', desc: '+3 최대 장전', icon: '◉', cost: (lv) => 80 * Math.pow(2, lv), max: 8 },
  { key: 'ammoMax', name: '최대 소지 탄약', desc: '+30 소지 탄약', icon: '◈', cost: (lv) => 60 * Math.pow(1.8, lv), max: 10 },
  { key: 'ionCharger', name: '이온 충전기', desc: '배터리 충전 +20%', icon: '⚡', cost: (lv) => 120 * Math.pow(2, lv), max: 5 },
  { key: 'ionSlot', name: '이온 배터리 슬롯', desc: '최대 배터리 +20%', icon: '🔋', cost: (lv) => 150 * Math.pow(2, lv), max: 5 },
  { key: 'scope', name: '조준경', desc: '탄퍼짐 -5° / 사거리 +100', icon: '◎', cost: (lv) => 110 * Math.pow(2, lv), max: 6 },
  { key: 'katanaDmg', name: '카타나 데미지', desc: '+30% 데미지', icon: '⚔', cost: (lv) => 130 * Math.pow(2, lv), max: 5 },
  { key: 'katanaRange', name: '카타나 범위', desc: '+20% 범위', icon: '◯', cost: (lv) => 120 * Math.pow(2, lv), max: 5 },
  { key: 'katanaCharge', name: '카타나 충전속도', desc: '+15% 충전속도', icon: '⟲', cost: (lv) => 100 * Math.pow(2, lv), max: 5 },
];

// =============================================================
// HUD UPDATE
// =============================================================
function showFlash(text, color) {
  const el = document.getElementById('flashMessage');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '#ffffff';
  el.classList.remove('show');
  // 강제 reflow → 애니메이션 재시작
  void el.offsetWidth;
  el.classList.add('show');
  // 끝나면 hide
  setTimeout(() => el.classList.remove('show'), 1600);
}

function updateHUD() {
  const batteryMaxEff = player.batteryMax * (1 + 0.2 * (player.upgrades['ionSlot'] || 0));
  document.getElementById('batteryText').textContent = `${Math.floor(player.battery)}/${Math.floor(batteryMaxEff)}`;
  document.getElementById('batteryFill').style.width = `${(player.battery / batteryMaxEff) * 100}%`;
  document.getElementById('ammoText').textContent = `${player.ammo}/${player.ammoMaxEff()}`;
  document.getElementById('btcText').textContent = player.btc;
  
  // Lives display
  const livesEl = document.getElementById('livesText');
  if (livesEl) {
    let str = '';
    for (let i = 0; i < player.maxLives; i++) {
      str += i < player.lives ? '♥' : '♡';
    }
    livesEl.textContent = str;
  }
  
  const time = STATE.time - STATE.phaseStartTime;
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  document.getElementById('timer').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  document.getElementById('phaseLabel').textContent = `PHASE ${STATE.phase}`;
  
  // Upgrades list
  const ul = document.getElementById('upgradesList');
  ul.innerHTML = '';
  for (const lb of player.limitBreaks) {
    const item = LIMIT_BREAKS.find(x => x.key === lb);
    if (item) {
      const tag = document.createElement('div');
      tag.className = 'upgrade-tag';
      tag.textContent = `◆ ${item.name}`;
      ul.appendChild(tag);
    }
  }
  
  // Boss HP
  if (bossEntity && !bossEntity.dead) {
    document.getElementById('bossHpWrap').style.display = 'block';
    let nameLabel = bossEntity.name;
    // 리퍼는 이름 옆에 잔여 목숨 표시
    if (bossEntity.level === 3 && bossEntity.reaperLives !== undefined) {
      let lifeStr = '';
      for (let i = 0; i < bossEntity.reaperMaxLives; i++) {
        lifeStr += i < bossEntity.reaperLives ? '◆' : '◇';
      }
      nameLabel = `${bossEntity.name}  ${lifeStr}`;
    }
    document.getElementById('bossName').textContent = nameLabel;
    document.getElementById('bossHpFill').style.width = `${(bossEntity.hp / bossEntity.maxHp) * 100}%`;
  } else {
    document.getElementById('bossHpWrap').style.display = 'none';
  }
}

// =============================================================
// SHOP / LIMIT BREAK / CHEAT
// =============================================================
function openShop() {
  STATE.inShop = true;
  STATE.paused = true;
  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  for (const item of SHOP_ITEMS) {
    const lv = player.getShopLevel(item.key);
    const cost = item.cost(lv);
    const maxed = lv >= item.max;
    const card = document.createElement('div');
    card.className = 'upgrade-card shop' + (maxed || player.btc < cost ? ' disabled' : '');
    card.innerHTML = `
      <div class="icon">${item.icon}</div>
      <h3>${item.name}</h3>
      <p>${item.desc}</p>
      <div class="cost">₿ ${cost}</div>
      ${item.max < 999 ? `<div class="level">LV ${lv}/${item.max}</div>` : ''}
    `;
    if (!maxed && player.btc >= cost) {
      card.addEventListener('click', () => buyShop(item));
    }
    grid.appendChild(card);
  }
  document.getElementById('shopModal').classList.add('active');
}

function buyShop(item) {
  const lv = player.getShopLevel(item.key);
  const cost = item.cost(lv);
  if (player.btc < cost) return;
  player.btc -= cost;
  if (item.action) item.action();
  if (item.max < 999) {
    player.upgrades[item.key] = lv + 1;
  }
  sfx('pickup');
  openShop(); // refresh
}

function closeShop() {
  STATE.inShop = false;
  STATE.paused = false;
  document.getElementById('shopModal').classList.remove('active');
}

function openLimitBreak() {
  STATE.inLimitBreak = true;
  STATE.paused = true;
  
  // Pick 3 random not yet selected
  const available = LIMIT_BREAKS.filter(lb => !player.limitBreaks.includes(lb.key));
  const choices = [];
  while (choices.length < 3 && available.length > 0) {
    const idx = Math.floor(Math.random() * available.length);
    choices.push(available.splice(idx, 1)[0]);
  }
  
  const grid = document.getElementById('limitBreakGrid');
  grid.innerHTML = '';
  for (const lb of choices) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="icon">◆</div>
      <h3>${lb.name}</h3>
      <p>${lb.desc}</p>
    `;
    card.addEventListener('click', () => pickLimitBreak(lb.key));
    grid.appendChild(card);
  }
  document.getElementById('limitBreakModal').classList.add('active');
}

function pickLimitBreak(key) {
  player.limitBreaks.push(key);
  if (key === 'librarian' && !drone) drone = new Drone();
  STATE.inLimitBreak = false;
  STATE.paused = false;
  document.getElementById('limitBreakModal').classList.remove('active');
  
  // Continue to next phase
  STATE.phase++;
  STATE.bossActive = false;
  STATE.bossDefeated = false;
  STATE.phaseStartTime = STATE.time;
  bossEntity = null;
}

function openCheat() {
  STATE.inCheat = true;
  STATE.paused = true;
  document.getElementById('cheatModal').classList.add('active');
}

function closeCheat() {
  STATE.inCheat = false;
  STATE.paused = false;
  document.getElementById('cheatModal').classList.remove('active');
}

// Cheat handlers
document.querySelectorAll('[data-cheat]').forEach(el => {
  el.addEventListener('click', () => {
    const c = el.dataset.cheat;
    if (c === 'money') player.btc += 99999;
    if (c === 'battery') {
      player.batteryMax = 999;
      player.battery = 999;
    }
    if (c === 'limit') {
      closeCheat();
      openLimitBreak();
      return;
    }
    if (c === 'bossmenu') {
      const wrap = document.getElementById('bossPickerWrap');
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
      return;
    }
    sfx('pickup');
  });
});

// Cheat: spawn specific boss
document.querySelectorAll('[data-bosslevel]').forEach(el => {
  el.addEventListener('click', () => {
    const level = parseInt(el.dataset.bosslevel);
    if (STATE.bossActive) return;  // 이미 보스 있으면 무시
    
    // 페이즈 동기화 + 진행 상태 초기화
    STATE.phase = level;
    STATE.bossDefeated = false;
    
    // 보스 소환 (spawnBoss 가 알아서 일반 적 정리)
    spawnBoss(level);
    document.getElementById('bossPickerWrap').style.display = 'none';
    closeCheat();
    sfx('pickup');
  });
});

// Modal close handlers
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => {
    const id = el.dataset.close;
    if (id === 'shopModal') closeShop();
    else if (id === 'cheatModal') closeCheat();
    else document.getElementById(id).classList.remove('active');
  });
});

// =============================================================
// SPAWNING
// =============================================================
function spawnEnemyOffscreen() {
  // 화면보다 더 멀리 + 월드 경계 밖에서 등장 (경계면 바로 옆에서 갑자기 튀어나오는 거 방지)
  // 플레이어로부터 화면 절반 + 200px 거리에서 시작
  const dist = Math.max(W, H) * 0.6 + 200;
  const a = Math.random() * TAU;
  let x = player.x + Math.cos(a) * dist;
  let y = player.y + Math.sin(a) * dist;
  
  // 월드 한계는 신경 안 씀 — 적은 월드 밖에서 시작해서 안으로 걸어옴
  // (단, 플레이어는 여전히 월드 안에 갇혀 있음)
  
  // Enemy types unlocked per phase
  const types = ['rusher', 'shooter'];
  if (STATE.phase >= 2) types.push('shielder');
  if (STATE.phase >= 3) types.push('assassin');
  if (STATE.phase >= 4) types.push('sniper');
  
  // Probability weights
  const weights = {
    rusher: 4,
    shooter: 3,
    shielder: 1.5,
    assassin: 1.5,
    sniper: 1
  };
  
  let total = 0;
  for (const t of types) total += weights[t];
  let r = Math.random() * total;
  let pickedType = types[0];
  for (const t of types) {
    r -= weights[t];
    if (r <= 0) { pickedType = t; break; }
  }
  
  enemies.push(new Enemy(x, y, pickedType));
}

function spawnBoss(forceLevel) {
  const level = forceLevel || STATE.phase;
  
  // 일반 적 모두 제거 (보스 시작 전 정리)
  for (const e of enemies) e.dead = true;
  
  // 경고 표시
  const w = document.getElementById('bossWarning');
  w.style.display = 'flex';
  STATE.bossActive = true;     // 일반 적 스폰 차단 (경고 동안)
  STATE.bossWarning = true;    // 보스 등장 대기
  STATE.bossPendingLevel = level;
  
  // 2.5초 후 경고 끝 + 보스 등장
  setTimeout(() => {
    w.style.display = 'none';
    if (!STATE.gameOver && !STATE.ended) {
      // 플레이어로부터 충분히 떨어진 곳, 월드 안쪽
      const dst = Math.max(W, H) * 0.5 + 150;
      const a = Math.random() * TAU;
      let bx = player.x + Math.cos(a) * dst;
      let by = player.y + Math.sin(a) * dst;
      bx = clamp(bx, 100, WORLD.w - 100);
      by = clamp(by, 100, WORLD.h - 100);
      bossEntity = new Boss(bx, by, level);
    }
    STATE.bossWarning = false;
  }, 2500);
}

let nextSpawnIn = 0;

// 러쉬/휴식 페이즈 multiplier 계산
// - 페이즈 시작 후 60~75초, 120~135초: 러쉬 (스폰 1.5배)
// - 75~95초, 135~155초: 휴식 (스폰 0.5배 이하)
// - 그 외: 평상시 (1.0배)
// - 3분(180초) 이후엔 보스 트리거되므로 러쉬 없음
function rushMultiplier() {
  const t = STATE.time - STATE.phaseStartTime;
  if (t < 60) return 1.0;
  if (t < 75) return 1.5;   // 러쉬 1
  if (t < 95) return 0.5;   // 휴식 1
  if (t < 120) return 1.0;
  if (t < 135) return 1.5;  // 러쉬 2
  if (t < 155) return 0.5;  // 휴식 2
  return 1.0;
}

function spawnLogic(dt) {
  if (STATE.bossActive) return;
  if (STATE.inLimitBreak) return;
  
  const mult = rushMultiplier();
  
  nextSpawnIn -= dt;
  if (nextSpawnIn <= 0) {
    const cap = 8 + STATE.phase * 4;
    if (enemies.length < cap) {
      spawnEnemyOffscreen();
      // 러쉬 중이면 추가로 더 등장 (50% 더 많이)
      if (mult >= 1.5 && Math.random() < 0.5) spawnEnemyOffscreen();
      // sometimes batch (페이즈 3 이상)
      if (STATE.phase >= 3 && Math.random() < 0.3) spawnEnemyOffscreen();
    }
    // 다음 스폰까지 간격: 평상시 기준에서 mult 의 역수로 (러쉬일수록 자주, 휴식일수록 드물게)
    const baseInterval = Math.max(0.4, 1.5 - STATE.phase * 0.15);
    nextSpawnIn = baseInterval / mult;
  }
}

// =============================================================
// OBSTACLE SPAWNING
// =============================================================
function spawnInitialObstacles() {
  obstacles = [];
  // 맵이 6000×6000 으로 4배 넓어졌으므로 장애물도 비례해서 4배
  for (let i = 0; i < 120; i++) {
    let tries = 0;
    while (tries < 10) {
      const x = rand(100, WORLD.w - 100);
      const y = rand(100, WORLD.h - 100);
      // Not too close to player spawn
      if (Math.hypot(x - WORLD.w/2, y - WORLD.h/2) < 200) { tries++; continue; }
      const explosive = Math.random() < 0.15;
      const ob = new Obstacle(x, y, explosive);
      // Check overlap
      let ok = true;
      for (const o of obstacles) {
        if (Math.abs(o.x - ob.x) < (o.w + ob.w)/2 + 30 && Math.abs(o.y - ob.y) < (o.h + ob.h)/2 + 30) { ok = false; break; }
      }
      if (ok) { obstacles.push(ob); break; }
      tries++;
    }
  }
}

// =============================================================
// COLLISION: player vs obstacles
// =============================================================
function resolvePlayerObstacles() {
  for (const ob of obstacles) {
    if (ob.dead) continue;
    const left = ob.x - ob.w/2;
    const right = ob.x + ob.w/2;
    const top = ob.y - ob.h/2;
    const bottom = ob.y + ob.h/2;
    
    const cx = clamp(player.x, left, right);
    const cy = clamp(player.y, top, bottom);
    const dx = player.x - cx;
    const dy = player.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < player.r) {
      if (d === 0) {
        player.x += player.r;
      } else {
        player.x = cx + (dx / d) * player.r;
        player.y = cy + (dy / d) * player.r;
      }
    }
  }
}

// =============================================================
// BG GRID DRAW
// =============================================================
function drawBackground() {
  // 1) 필드 이미지가 로드되어 있으면 월드 좌표 기준으로 타일링/스트레치
  // 2) 없으면 기본 다크 그라데이션 + 그리드
  const fieldImg = ENTITY_IMG['field'];
  const fieldConf = ENTITY_IMAGES['field'];
  const useFieldImage = fieldImg && fieldImg.complete && fieldImg.naturalWidth > 0;
  
  if (useFieldImage) {
    if (fieldConf.mode === 'stretch') {
      // 월드 전체에 한 장으로 스트레치
      const tl = worldToScreen(0, 0);
      ctx.drawImage(fieldImg, tl.x, tl.y, WORLD.w, WORLD.h);
    } else {
      // 타일링 — 월드 (0,0) 부터 일정 간격으로 타일을 깔고, 화면에 보이는 것만 그림
      const tileSize = fieldConf.tileSize || fieldImg.naturalWidth;
      // 월드 좌표 기준 시작/끝 (화면 좌표 → 월드 좌표 역변환)
      const worldLeft = CAM.x;
      const worldTop = CAM.y;
      const worldRight = CAM.x + W;
      const worldBottom = CAM.y + H;
      // 화면에 보이는 첫 타일의 월드 좌표
      const startX = Math.floor(worldLeft / tileSize) * tileSize;
      const startY = Math.floor(worldTop / tileSize) * tileSize;
      for (let wx = startX; wx < worldRight; wx += tileSize) {
        for (let wy = startY; wy < worldBottom; wy += tileSize) {
          // 월드 경계 밖은 안 그림
          if (wx + tileSize <= 0 || wy + tileSize <= 0 || wx >= WORLD.w || wy >= WORLD.h) continue;
          const s = worldToScreen(wx, wy);
          ctx.drawImage(fieldImg, s.x, s.y, tileSize, tileSize);
        }
      }
    }
  } else {
    // Dark gradient base (화면 고정)
    ctx.fillStyle = '#08070d';
    ctx.fillRect(0, 0, W, H);
    
    // Grid (월드 좌표 기준 — 플레이어 이동시 그리드가 월드와 함께 움직임)
    ctx.strokeStyle = 'rgba(255, 32, 80, 0.08)';
    ctx.lineWidth = 1;
    const gs = 80;
    // 화면 첫 그리드 라인의 월드 좌표
    const startGX = Math.floor(CAM.x / gs) * gs;
    const startGY = Math.floor(CAM.y / gs) * gs;
    for (let wx = startGX; wx < CAM.x + W; wx += gs) {
      const sx = wx - CAM.x;
      ctx.beginPath();
      ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    }
    for (let wy = startGY; wy < CAM.y + H; wy += gs) {
      const sy = wy - CAM.y;
      ctx.beginPath();
      ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }
  }
  
  // World boundary
  ctx.strokeStyle = '#ff2050';
  ctx.lineWidth = 4;
  ctx.shadowBlur = 15;
  ctx.shadowColor = '#ff2050';
  const tl2 = worldToScreen(0, 0);
  ctx.strokeRect(tl2.x, tl2.y, WORLD.w, WORLD.h);
  ctx.shadowBlur = 0;
  
  // Vignette (화면 고정)
  const grad = ctx.createRadialGradient(W/2, H/2, Math.min(W, H) * 0.3, W/2, H/2, Math.max(W, H) * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// =============================================================
// CURSOR
// =============================================================
function drawCursor() {
  ctx.save();
  ctx.translate(MOUSE.x, MOUSE.y);
  ctx.strokeStyle = '#ff2050';
  ctx.lineWidth = 2;
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#ff2050';
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-18, 0); ctx.lineTo(-6, 0);
  ctx.moveTo(6, 0); ctx.lineTo(18, 0);
  ctx.moveTo(0, -18); ctx.lineTo(0, -6);
  ctx.moveTo(0, 6); ctx.lineTo(0, 18);
  ctx.stroke();
  ctx.fillStyle = '#ff2050';
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// =============================================================
// MAIN LOOP
// =============================================================
let lastTime = 0;
function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 1/30);
  lastTime = now;
  
  // 시스템 커서 표시 여부 — 게임 진행 중이 아니면 무조건 표시
  // (메인화면, 상점, 한계돌파, 게임오버, 일시정지, 치트, 일반 메뉴 등에서 마우스 보이도록)
  const inMenu = !STATE.running
                 || STATE.paused
                 || STATE.inShop
                 || STATE.inLimitBreak
                 || STATE.gameOver
                 || STATE.ended
                 || STATE.inCheat;
  document.body.style.cursor = inMenu ? 'default' : 'none';
  
  if (!STATE.running) {
    requestAnimationFrame(gameLoop);
    return;
  }
  
  STATE.realTime += dt * 1000;
  
  // Hitstop
  let realDt = dt;
  if (STATE.hitstop > 0) {
    STATE.hitstop -= dt * 1000;
    realDt = dt * 0.05;
  }
  
  if (!STATE.paused && !STATE.gameOver && !STATE.ended) {
    STATE.time += realDt;
    update(realDt);
  }
  
  // Update screen shake decay
  if (STATE.shake > 0) {
    STATE.shake = Math.max(0, STATE.shake - dt * 60);
    CAM.shakeX = (Math.random() - 0.5) * STATE.shake;
    CAM.shakeY = (Math.random() - 0.5) * STATE.shake;
  } else {
    CAM.shakeX = 0; CAM.shakeY = 0;
  }
  
  // Camera follows player
  if (player) {
    CAM.x = lerp(CAM.x, player.x - W/2, 0.15);
    CAM.y = lerp(CAM.y, player.y - H/2, 0.15);
  }
  
  draw();
  updateHUD();
  
  // Pause text
  document.getElementById('pauseText').style.display = (STATE.inShop || STATE.inCheat) ? 'block' : 'none';
  
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  if (player) player.update(dt);
  if (drone) drone.update(dt);
  
  // Player vs obstacles
  if (player && !player.rolling) resolvePlayerObstacles();
  
  // Update entities
  for (const en of enemies) en.update(dt);
  if (bossEntity) bossEntity.update(dt);
  for (const b of bullets) b.update(dt);
  for (const eb of enemyBullets) eb.update(dt);
  for (const p of particles) p.update(dt);
  for (const pk of pickups) pk.update(dt);
  for (const e of effects) e.update(dt);
  for (const dn of damageNumbers) dn.update(dt);
  for (const bs of bloodstains) bs.update(dt);
  for (const h of holograms) h.update(dt);
  
  // 리스폰 큐 처리: 60초 카운트다운 → 0 도달 시 홀로그램으로 변환
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const r = respawnQueue[i];
    r.timer -= dt;
    if (r.timer <= 0) {
      // 플레이어가 너무 가까이 있으면 잠시 보류 (들어가지 않게)
      if (player && dist(r, player) < 80) {
        r.timer = 1.5;  // 1.5초 뒤 다시 시도
        continue;
      }
      holograms.push(new RespawnHologram(r.x, r.y, r.w, r.h, r.explosive, r.destructible));
      respawnQueue.splice(i, 1);
    }
  }
  
  // Cleanup
  enemies = enemies.filter(e => !e.dead);
  bullets = bullets.filter(b => !b.dead);
  enemyBullets = enemyBullets.filter(b => !b.dead);
  particles = particles.filter(p => !p.dead);
  pickups = pickups.filter(p => !p.dead);
  effects = effects.filter(e => !e.dead);
  damageNumbers = damageNumbers.filter(d => !d.dead);
  obstacles = obstacles.filter(o => !o.dead);
  bloodstains = bloodstains.filter(bs => !bs.dead);
  holograms = holograms.filter(h => !h.dead);
  
  // Boss flow
  const phaseElapsed = STATE.time - STATE.phaseStartTime;
  if (!STATE.bossActive && !STATE.bossDefeated && phaseElapsed > 180 && STATE.phase <= 5) {
    spawnBoss();
  }
  // Cheat: also allow triggering boss faster — for now keep as is.
  
  if (STATE.bossDefeated && !STATE.inLimitBreak) {
    // 즉시 setTimeout/limitBreak 트리거가 두 번 들리지 않도록 플래그 잠금
    STATE.bossDefeated = false;  // 이번 처치 처리됨 → 다음 spawnBoss 의 트리거 방지는 bossActive 유지로 보장
    
    // Phase 5 = ending
    if (STATE.phase >= 5) {
      // Wipe all enemies
      for (const e of enemies) e.dead = true;
      STATE.ended = true;
      setTimeout(() => {
        document.getElementById('endingScreen').classList.add('show');
      }, 3000);
      // bossActive 는 게임 끝까지 유지 → 추가 spawn 차단
      return;
    }
    
    // Wait 1.5 sec then limit break
    // bossActive 는 limit break 종료(pickLimitBreak)까지 유지 → 추가 spawnBoss 트리거 방지
    setTimeout(() => {
      // Wipe enemies
      for (const e of enemies) {
        e.dead = true;
      }
      openLimitBreak();
    }, 1500);
  }
  
  spawnLogic(dt);
}

function draw() {
  drawBackground();
  
  // World entities
  for (const bs of bloodstains) bs.draw();   // 핏자국은 가장 먼저 (땅 위, 다른 것 아래)
  for (const h of holograms) h.draw();       // 홀로그램은 핏자국 위에
  for (const ob of obstacles) ob.draw();
  for (const pk of pickups) pk.draw();
  for (const en of enemies) en.draw();
  if (bossEntity && !bossEntity.dead) bossEntity.draw();
  // 보스 화면 밖이면 화살표/마커로 위치 표시 (리퍼 제외 — 리퍼는 은신/저격 컨셉)
  if (bossEntity && !bossEntity.dead && bossEntity.level !== 3) drawBossOffscreenMarker();
  if (player) player.draw();
  if (drone) drone.draw();
  for (const b of bullets) b.draw();
  for (const eb of enemyBullets) eb.draw();
  for (const e of effects) e.draw();
  for (const p of particles) p.draw();
  for (const dn of damageNumbers) dn.draw();
  
  // 커스텀 십자선 커서 — 게임 진행 중일 때만 (메뉴/모달은 시스템 커서)
  const inMenu = !STATE.running || STATE.paused || STATE.inShop || STATE.inLimitBreak || STATE.gameOver || STATE.ended || STATE.inCheat;
  if (!inMenu) drawCursor();
  
  // 게임오버 시 재시작 안내 (캔버스 상단 중앙)
  if (STATE.gameOver) {
    ctx.save();
    ctx.font = 'bold 28px Bebas Neue, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const pulse = 0.6 + 0.4 * Math.sin(STATE.realTime * 0.005);
    ctx.fillStyle = `rgba(255, 220, 80, ${pulse})`;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    ctx.fillText('PRESS  E  TO RESTART', W / 2, 30);
    ctx.restore();
  }
}

function drawBossOffscreenMarker() {
  const s = worldToScreen(bossEntity.x, bossEntity.y);
  const margin = 60;
  // 화면 안에 있으면 그릴 필요 없음
  if (s.x > margin && s.x < W - margin && s.y > margin && s.y < H - margin) return;
  
  // 화면 가장자리에 클램프
  const cx = clamp(s.x, margin, W - margin);
  const cy = clamp(s.y, margin, H - margin);
  
  // 보스 이름 + 거리 표시
  const dx = bossEntity.x - player.x;
  const dy = bossEntity.y - player.y;
  const d = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  
  // 빨간 화살표 (펄스)
  const pulse = 0.7 + 0.3 * Math.sin(STATE.realTime * 0.008);
  ctx.fillStyle = `rgba(255, 50, 50, ${pulse})`;
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#ff2050';
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(-12, -16);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-12, 16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  
  // 보스 이름 + 거리
  ctx.save();
  ctx.font = 'bold 14px Bebas Neue, sans-serif';
  ctx.fillStyle = '#ff5050';
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 화살표 바깥 (텍스트는 화면 안쪽으로)
  const tx = cx - Math.cos(angle) * 50;
  const ty = cy - Math.sin(angle) * 50;
  ctx.fillText(bossEntity.name || 'BOSS', tx, ty - 8);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${Math.round(d)}m`, tx, ty + 10);
  ctx.restore();
}


function startGame() {
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (musicOn) startMusic();

  document.getElementById('titleScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  
  player = new Player();
  enemies = [];
  bullets = [];
  enemyBullets = [];
  particles = [];
  pickups = [];
  effects = [];
  damageNumbers = [];
  bloodstains = [];
  obstacles = [];
  respawnQueue = [];
  holograms = [];
  bossEntity = null;
  drone = null;
  
  STATE.running = true;
  STATE.paused = false;
  STATE.phase = 1;
  STATE.phaseStartTime = 0;
  STATE.time = 0;
  STATE.bossActive = false;
  STATE.bossWarning = false;
  STATE.bossDefeated = false;
  document.getElementById('bossWarning').style.display = 'none';
  STATE.gameOver = false;
  STATE.ended = false;
  
  spawnInitialObstacles();
}

// Title screen background
function drawTitleBg() {
  const tbg = document.getElementById('titleBg');
  if (!tbg) return;
  const tctx = tbg.getContext('2d');
  tbg.width = window.innerWidth;
  tbg.height = window.innerHeight;
  
  // Animated streaks
  function tick() {
    if (document.getElementById('titleScreen').style.display === 'none') return;
    tctx.fillStyle = 'rgba(8,0,16,0.15)';
    tctx.fillRect(0, 0, tbg.width, tbg.height);
    
    for (let i = 0; i < 3; i++) {
      const y = Math.random() * tbg.height;
      tctx.strokeStyle = `rgba(255, ${Math.random() * 100 + 32}, 80, ${0.2 + Math.random() * 0.4})`;
      tctx.lineWidth = Math.random() * 3 + 1;
      tctx.beginPath();
      tctx.moveTo(0, y);
      tctx.lineTo(tbg.width, y);
      tctx.stroke();
    }
    requestAnimationFrame(tick);
  }
  tick();
}
drawTitleBg();

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('howtoBtn').addEventListener('click', () => {
  document.getElementById('howtoModal').classList.add('active');
});

requestAnimationFrame(gameLoop);
