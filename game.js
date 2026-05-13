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
  cheatCapsLock: [],    // recent Caps Lock presses
  gameOver: false,
  ended: false,
  time: 0,              // accumulated game time (sec)
  realTime: 0,          // ms
  // Bullet-time (Shift): 적/총알/이펙트만 느려지고 플레이어는 정상속도.
  // active 면 화면에 시안 톤 + 스캔라인 오버레이 표시.
  slowMo: false,
  slowMoFactor: 0.25,   // 적/총알/효과의 시간 배율 (0.25 = 1/4 속도)
  slowMoIntensity: 0,   // 시각효과 강도 (0~1, 부드럽게 페이드 인/아웃)
  howtoOpen: false,     // How To Play 모달 열림 여부 (게임 일시정지)
  // 튜토리얼/스토리/컷씬
  inStory: false,       // 스토리/튜토리얼 컷씬 표시 중 (게임 일시정지)
  inTutorial: false,    // 튜토리얼 게임플레이 중 (특수 적/장애물)
  tutorialStep: 0,      // 현재 튜토리얼 단계
  inBossCutscene: false, // 보스 등장 컷씬 표시 중 (게임 일시정지)
  // === 점수/통계 추적 ===
  kills: 0,             // 잡몹 처치 수
  bossKills: 0,         // 보스 처치 수
  totalEarned: 0,       // 누적 획득 BTC (소비해도 깎이지 않음)
  maxPhaseReached: 1,   // 도달한 최고 페이즈
  // === 보스 진입/처치 시 임시 처리 ===
  bossInvulnTimer: 0,   // 보스 등장/처치 시 플레이어 임시 무적 (초)
  spawnFrozen: false,   // 페이즈 후반(2분 경과) — 더 이상 적 리젠 안 함, 남은 적 처치 시 보스 등장
  difficulty: 'normal',
  // === 히든 보스: 테레사 ===
  bossFightNoDamage: true,  // 제미네이터 전투 중 피격 없는지 추적
  hiddenBossActive: false,  // 테레사 전투 진행 중
  hiddenClear: false,       // 테레사 처치 완료
  usedCheat: false,         // 치트 사용 시 해당 런은 랭킹 등록 제외
};

const DIFFICULTY_SETTINGS = {
  hero: {
    label: 'Hero',
    batteryRegenMult: 1.6,
    rollCostMult: 0.5,
    grazeSlowMoSeconds: 1.0,
    enemySpeedMult: 1.0,
    enemyAttackCdMult: 1.35,
    enemyAimTimeMult: 1.25,
    enemyTelegraphMult: 1.1,
    bossTimeScale: 1.0,
  },
  normal: {
    label: 'Normal',
    batteryRegenMult: 1.0,
    rollCostMult: 1.0,
    grazeSlowMoSeconds: 0,
    enemySpeedMult: 1.0,
    enemyAttackCdMult: 1.0,
    enemyAimTimeMult: 1.0,
    enemyTelegraphMult: 1.0,
    bossTimeScale: 1.0,
  },
  dystopia: {
    label: 'Dystopia',
    batteryRegenMult: 1.0,
    rollCostMult: 1.0,
    grazeSlowMoSeconds: 0,
    enemySpeedMult: 1.25,
    enemyAttackCdMult: 0.45,
    enemyAimTimeMult: 0.35,
    enemyTelegraphMult: 0.65,
    bossTimeScale: 1.25,
  },
};

function normalizeDifficultyKey(key) {
  return DIFFICULTY_SETTINGS[key] ? key : 'normal';
}

function difficultyConfig() {
  return DIFFICULTY_SETTINGS[normalizeDifficultyKey(STATE.difficulty)];
}

function difficultyLabel(key) {
  const labels = {
    hero: '\uc8fc\uc778\uacf5',
    normal: '\ubcf4\ud1b5',
    dystopia: '\ub514\uc2a4\ud1a0\ud53c\uc544',
  };
  return labels[normalizeDifficultyKey(key)] || labels.normal;
}

function difficultyScoreMultiplier(key) {
  const multipliers = {
    hero: 1,
    normal: 1.5,
    dystopia: 2.25,
  };
  return multipliers[normalizeDifficultyKey(key)] || multipliers.normal;
}

function setDifficulty(key) {
  STATE.difficulty = normalizeDifficultyKey(key);
  document.querySelectorAll('[data-difficulty]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.difficulty === STATE.difficulty);
  });
}

const KEYS = {};
const MOUSE = { x: W/2, y: H/2, worldX: 0, worldY: 0, leftDown: false, rightDown: false, leftHoldTime: 0, rightHoldTime: 0 };

// =============================================================
// INPUT
// =============================================================
window.addEventListener('keydown', (e) => {
  KEYS[e.key.toLowerCase()] = true;
  KEYS[e.code] = true;
  
  // Cheat: Caps Lock x5 within 2 seconds
  if (e.code === 'CapsLock' && !e.repeat) {
    const now = performance.now();
    STATE.cheatCapsLock.push(now);
    STATE.cheatCapsLock = STATE.cheatCapsLock.filter(t => now - t < 2000);
    if (STATE.cheatCapsLock.length >= 5) {
      STATE.cheatCapsLock = [];
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
    // howto 모달도 ESC 로 닫기
    if (STATE.howtoOpen) {
      document.getElementById('howtoModal').classList.remove('active');
      STATE.howtoOpen = false;
      if (STATE.running && !STATE.inShop && !STATE.inLimitBreak && !STATE.inCheat) {
        STATE.paused = false;
      }
    }
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

// 우클릭 contextmenu 전역 차단 강화 (Chrome 등에서 카타나 충전 중에도
// 시스템 컨텍스트 메뉴가 뜨지 않도록 문서 전체에서 차단)
window.addEventListener('contextmenu', (e) => {
  // 게임 화면(canvas/gameWrap) 위에서만 차단. 외부 임베드 등에선 normal 동작
  if (e.target === canvas || e.target.closest('#gameWrap')) {
    e.preventDefault();
  }
});
// 일부 브라우저는 auxclick(2) 도 트리거 → 명시적 차단
window.addEventListener('auxclick', (e) => {
  if (e.button === 2 && (e.target === canvas || e.target.closest('#gameWrap'))) {
    e.preventDefault();
  }
});

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
  // 신규 효과음 (파일이 없으면 자동으로 절차생성 폴백)
  'parry':         'sounds/parry.mp3',         // 패링 (총알 반사)
  'slide':         'sounds/slide.mp3',         // 슬라이딩(구르기)
  'enemyShoot':    'sounds/enemy_shoot.mp3',   // 적이 총을 쏠 때
  'snipeAim':      'sounds/snipe_aim.mp3',     // 저격수/리퍼 조준 시작
  'cracksonCharge':'sounds/crackson_charge.mp3', // 크랙슨 돌진 발동
  'bombardAim':    'sounds/bombard_aim.mp3',   // 포격 조준 시작
  'playerDown':    'sounds/player_down.mp3',   // 플레이어 다운(게임오버)
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
  } else if (type === 'parry') {
    // 패링: 짧고 청량한 메탈릭 'ting' + 약간의 노이즈 임팩트
    const o1 = audioCtx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(2400, t);
    o1.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    const g1 = audioCtx.createGain();
    g1.gain.setValueAtTime(0.5, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o1.connect(g1); g1.connect(sfxGain);
    o1.start(); o1.stop(t + 0.22);
    // 노이즈 임팩트 (짧게)
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.06, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 12);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g2 = audioCtx.createGain();
    g2.gain.value = 0.35;
    src.connect(hp); hp.connect(g2); g2.connect(sfxGain);
    src.start();
  } else if (type === 'slide') {
    // 슬라이딩: 화이트노이즈 'shhh' + 빠른 페이드아웃
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.35, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.exp(-i / data.length * 3.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    const g = audioCtx.createGain();
    g.gain.value = 0.3;
    src.connect(bp); bp.connect(g); g.connect(sfxGain);
    src.start();
  } else if (type === 'enemyShoot') {
    // 적의 사격: shoot 보다 약간 어두운 톤 (구분되도록)
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.12, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 10);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    const g = audioCtx.createGain();
    g.gain.value = 0.4;
    src.connect(filter); filter.connect(g); g.connect(sfxGain);
    src.start();
  } else if (type === 'snipeAim') {
    // 저격수 조준: 짧은 레이저 차징 톤 (상승)
    const o = audioCtx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.45);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.5);
  } else if (type === 'cracksonCharge') {
    // 크랙슨 돌진: 무거운 저음 임팩트 + 노이즈
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g1 = audioCtx.createGain();
    g1.gain.setValueAtTime(0.45, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g1); g1.connect(sfxGain);
    o.start(); o.stop(t + 0.45);
    // 추가 노이즈 럼블
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 4);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const g2 = audioCtx.createGain();
    g2.gain.value = 0.5;
    src.connect(lp); lp.connect(g2); g2.connect(sfxGain);
    src.start();
  } else if (type === 'bombardAim') {
    // 포격 조준: 위협적인 알람 톤 (아래로 떨어지는 음)
    const o = audioCtx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.35);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(sfxGain);
    o.start(); o.stop(t + 0.4);
  } else if (type === 'playerDown') {
    // 플레이어 다운: 길고 어두운 'fall' 사운드 + 노이즈
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 1.0);
    const g1 = audioCtx.createGain();
    g1.gain.setValueAtTime(0.45, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(g1); g1.connect(sfxGain);
    o.start(); o.stop(t + 1.2);
    // 임팩트 노이즈
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.6, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 5);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g2 = audioCtx.createGain();
    g2.gain.value = 0.5;
    src.connect(lp); lp.connect(g2); g2.connect(sfxGain);
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
let damageNumberBuckets = new Map();
let nextDamageNumberTargetId = 1;

function getDamageNumberTargetId(target) {
  if (!target) return null;
  if (!target._damageNumberTargetId) target._damageNumberTargetId = nextDamageNumberTargetId++;
  return target._damageNumberTargetId;
}

function damageNumberColor(value) {
  if (value < 3) return '#ffffff';
  if (value < 8) return '#ffe45c';
  if (value < 16) return '#ff9f1c';
  if (value < 32) return '#ff3048';
  return '#c040ff';
}

function queueDamageNumber(target, value, yOffset) {
  if (!target || value <= 0) return;
  const id = getDamageNumberTargetId(target);
  if (!id) return;
  const bucket = damageNumberBuckets.get(id) || { target, value: 0, timer: 0.1, yOffset };
  bucket.target = target;
  bucket.value += value;
  bucket.timer = 0.1;
  bucket.yOffset = yOffset;
  damageNumberBuckets.set(id, bucket);
}

function flushDamageNumberBucket(bucket) {
  if (!bucket || bucket.value <= 0 || !bucket.target) return;
  const yOffset = bucket.yOffset !== undefined ? bucket.yOffset : -35;
  damageNumbers.push(new DmgNumber(bucket.target.x, bucket.target.y + yOffset, bucket.value));
}

function updateDamageNumberBuckets(dt) {
  for (const [id, bucket] of damageNumberBuckets) {
    bucket.timer -= dt;
    if (bucket.timer <= 0 || bucket.target.dead) {
      flushDamageNumberBucket(bucket);
      damageNumberBuckets.delete(id);
    }
  }
}
let bloodstains = [];    // 샷건 처치 시 남는 핏자국 (오래 지속)
let corpseStains = [];    // 적 사망 시 잠시 남는 시체 이미지
let respawnQueue = [];   // 파괴된 장애물 리스폰 큐 ({x, y, w, h, explosive, timer})
let holograms = [];      // 리스폰 직전 표시되는 푸른 홀로그램
let bossEntity = null;
let hiddenBossEntity = null;  // 히든 보스: 테레사
let hiddenBossDecoys = [];    // 테레사 분신 (페이즈 4)

// =============================================================
// PLAYER
// =============================================================
class Player {
  constructor() {
    this.x = WORLD.w / 2;
    this.y = WORLD.h / 2;
    this.r = 28;
    this.hitR = 16;            // 실제 피격 판정 (이미지보다 작게)
    this.grazeR = 32;          // 그레이즈 판정 반경 (hitR보다 큼, 시각적 r과 비슷)
    this.speed = 430;
    this.angle = 0;
    
    // Battery
    this.batteryMax = 100;
    this.battery = 100;
    this.batteryRegen = 9; // per sec (기존 12에서 30% 감소)
    this.batteryRegenDelay = 0;  // 배터리 소모 직후 재생 정지 시간 (초)
    
    // Time dilation energy (seconds): Shift slow-mo uses this, not battery.
    this.slowMoMax = 3;
    this.slowMoEnergy = this.slowMoMax;
    this.slowMoRegen = 0.3;
    this.slowMoCooldown = 0;
    this.slowMoAutoTimer = 0;
    
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
    this.slashDamage = 2;                  // 칼 휘두르기 기본 데미지 (낮음 — 패링이 메인)
    this.slashCooldown = 0;
    this.slashCdMax = 0.3;
    
    // Money
    this.btc = 0;
    
    // upgrades
    this.upgrades = {};  // {key: level}
    this.limitBreaks = []; // names
    
    // Animation
    this.animTime = 0;
    this.animState = 'idle'; // idle, walk, backwalk, shoot, slash
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
    
    // 슬로우모션은 매 프레임 false 로 리셋 → 아래 이동 분기에서 조건 맞으면 다시 켜짐.
    // rolling 중이거나 일시정지/게임오버에선 자동으로 꺼짐.
    STATE.slowMo = false;
    
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
    regenRate *= difficultyConfig().batteryRegenMult;
    // 그레이즈 부스트 — 총알이 스쳐갔을 때 일정 시간 재생 가속(×3)
    if (typeof this.grazeBoost !== 'number') this.grazeBoost = 0;
    if (this.grazeBoost > 0) {
      this.grazeBoost -= dt;
      regenRate *= 3.0;
    }
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
      // Shift = 시간 감속. 배터리 대신 별도 시간 에너지를 사용한다.
      if (this.slowMoCooldown > 0) this.slowMoCooldown = Math.max(0, this.slowMoCooldown - dt);
      if (this.slowMoAutoTimer > 0) this.slowMoAutoTimer = Math.max(0, this.slowMoAutoTimer - dt);
      const slowKey = KEYS['shift'] || KEYS['Shift'] || KEYS['ShiftLeft'] || KEYS['ShiftRight'];
      const wantsSlowMo = slowKey || this.slowMoAutoTimer > 0;
      const isSlowMo = wantsSlowMo && this.slowMoCooldown <= 0 && this.slowMoEnergy > 0 && !STATE.paused;
      STATE.slowMo = isSlowMo;
      
      if (isSlowMo) {
        this.slowMoEnergy = Math.max(0, this.slowMoEnergy - dt);
        if (this.slowMoEnergy <= 0) {
          this.slowMoCooldown = 3.0;
          this.slowMoAutoTimer = 0;
          STATE.slowMo = false;
        }
      } else {
        this.slowMoEnergy = Math.min(this.slowMoMax, this.slowMoEnergy + this.slowMoRegen * dt);
      }
      
      // 슬로우모 중엔 플레이어 이동 50% 가속 (적/총알이 느려진 상태에서 더 민첩하게)
      const moveMult = isSlowMo ? 1.5 : 1.0;
      this.x += mx * this.speed * dt * moveMult;
      this.y += my * this.speed * dt * moveMult;
      
      if (isSlowMo) {
        // 잔상 프레임 매우 자주 생성 — 불릿타임 느낌
        this.trailSpawnTimer -= dt;
        if (this.trailSpawnTimer <= 0) {
          this.trailFrames.push({
            x: this.x, y: this.y,
            state: this.anim.state,
            frameIdx: this.anim.frameIdx,
            flip: this.facingLeft,
            life: 0.5,
            life0: 0.5,
            slowMo: true,    // 슬로우모션 잔상 (시안 강조)
          });
          this.trailSpawnTimer = 0.025;  // 매우 자주 (40fps)
          if (this.trailFrames.length > 16) this.trailFrames.shift();
        }
        // 시안 파티클 (사이버펑크)
        if (Math.random() < 0.3) {
          particles.push(new Particle(this.x, this.y, rand(-20,20), rand(-20,20), 0.4, '#00ffee', 4));
        }
      }
      
      const aimX = Math.cos(this.angle);
      const backwalking = (mx < -0.1 && aimX > 0.15) || (mx > 0.1 && aimX < -0.15);
      this.animState = (mx || my) ? (backwalking ? 'backwalk' : 'walk') : 'idle';
      
      // Roll trigger
      const rollCost = this.rollCost * difficultyConfig().rollCostMult;
      if (KEYS[' '] && this.rollCooldown <= 0 && this.battery >= rollCost && (mx || my)) {
        this.rolling = true;
        this.rollTime = this.rollDuration * (this.hasUpgrade('slidingBoots') ? 1.2 : 1);
        this.rollCooldown = this.rollCdMax * (this.hasUpgrade('slidingBoots') ? 0.7 : 1);
        this.battery -= rollCost;
        this.batteryRegenDelay = 1.0;  // 구르기 후 1초 재생 정지
        this.rollDir = {x: mx, y: my};
        sfx('slide');
        
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
    
    // 우선순위: down(gameOver) > slide(rolling) > slash > shoot > walk > idle
    // slide/down 이미지가 없으면 자연스럽게 폴백 (draw 단계에서)
    let nextState;
    if (STATE.gameOver) {
      const downImg = ANIM_IMAGES['down'];
      const downOk = downImg && downImg.complete && downImg.naturalWidth > 0;
      nextState = downOk ? 'down' : 'idle';
    }
    else if (this.rolling) {
      const slideImg = ANIM_IMAGES['slide'];
      const slideOk = slideImg && slideImg.complete && slideImg.naturalWidth > 0;
      nextState = slideOk ? 'slide' : 'walk';
    }
    else if (this.slashAnimTime > 0) nextState = 'slash';
    else if (this.shootAnimTime > 0) nextState = 'shoot';
    else if (this.animState === 'backwalk') {
      const backImg = ANIM_IMAGES['backwalk'];
      const backOk = backImg && backImg.complete && backImg.naturalWidth > 0;
      nextState = backOk ? 'backwalk' : 'walk';
    }
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
      // 50%: 25도(±12.5도) 이내 집중탄 / 50%: 45도(±22.5도) 바깥 탄
      let a;
      if (Math.random() < 0.5) {
        a = this.angle + (Math.random() - 0.5) * (25 * Math.PI / 180);
      } else {
        a = this.angle + (Math.random() < 0.5 ? 1 : -1) * (22.5 * Math.PI / 180);
      }
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
    
    // 카운터 윈도우: 크랙슨이 돌진/대시 중이고 가까이 있으면, 슬래시 동안 짧은 무적
    // — 카운터 슬래시가 보스 contact damage 보다 먼저 발동되도록
    if (bossEntity && !bossEntity.dead && bossEntity.level === 2) {
      const isCharging = bossEntity.charging || bossEntity.tripleDashState === 'dashing';
      if (isCharging && dist(this, bossEntity) < range + bossEntity.r + 30) {
        this.invulnTime = Math.max(this.invulnTime, 0.25);
      }
    }
    
    sfx('slash');
    
    // Gun-Kata: 슬래시할 때 가까운 적에게 자동 기본 사격
    // - 적 1명당 1발 (가까운 순으로 최대 N명)
    // - 산탄(spread)이 적용되지 않은 깔끔한 단발 (기본 사격)
    if (this.hasUpgrade('gunKata') && this.ammo > 0) {
      const maxTargets = 6;          // 한 번에 최대 6명에게
      const maxRange = 700;          // 자동 사격 사정거리
      // 후보: 살아있는 적 + 보스
      const candidates = [];
      for (const en of enemies) {
        if (en.dead) continue;
        const dE = dist(this, en);
        if (dE <= maxRange) candidates.push({ ent: en, d: dE });
      }
      if (bossEntity && !bossEntity.dead) {
        const dB = dist(this, bossEntity);
        if (dB <= maxRange) candidates.push({ ent: bossEntity, d: dB });
      }
      // 가까운 순 정렬
      candidates.sort((a, b) => a.d - b.d);
      const targets = candidates.slice(0, maxTargets);
      const shots = Math.min(targets.length, this.ammo);
      this.ammo -= shots;
      for (let i = 0; i < shots; i++) {
        const t = targets[i].ent;
        const a = angleTo(this, t);
        bullets.push(new Bullet(this.x, this.y, Math.cos(a) * this.bulletSpeed, Math.sin(a) * this.bulletSpeed, this.rangeEff(), 1));
        // 발사 머즐 잔영
        for (let j = 0; j < 3; j++) {
          const pa = a + rand(-0.2, 0.2);
          particles.push(new Particle(this.x, this.y, Math.cos(pa) * rand(120, 220), Math.sin(pa) * rand(120, 220), 0.18, '#ffcc00', 3));
        }
      }
    }
    
    // Reset
    this.slashCharge = 0;
    MOUSE.rightHoldTime = 0;
  }
  
  triggerGraze() {
    const autoSlow = difficultyConfig().grazeSlowMoSeconds || 0;
    if (autoSlow > 0 && this.slowMoCooldown <= 0 && this.slowMoEnergy > 0) {
      this.slowMoAutoTimer = Math.max(this.slowMoAutoTimer, autoSlow);
    }
    if (typeof this.grazeBoost !== 'number') this.grazeBoost = 0;
    this.grazeBoost = Math.min(2.0, this.grazeBoost + 0.6);
    this.battery = Math.min(this.batteryMax * (1 + 0.2 * (this.upgrades['ionSlot'] || 0)), this.battery + 4);
    this.batteryRegenDelay = 0;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(40, 100), Math.sin(a) * rand(40, 100), 0.25, '#00d4ff', 3));
    }
  }
  
  takeDamage(source) {
    if (this.rolling) return;
    if (source === 'bullet' && STATE.slowMo) {
      this.triggerGraze();
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#00d4ff', 'GRAZE'));
      return;
    }
    if (STATE.gameOver) return;
    if (this.invulnTime > 0) return;  // 부활 직후 무적
    
    this.lives--;
    // 보스전 무피해 추적 (제미네이터 혹은 히든 보스 전투 중 피격 시 기록)
    if (STATE.bossActive || STATE.hiddenBossActive) STATE.bossFightNoDamage = false;
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
      effects.push(new SlashEffect(this.x, this.y, range, 3, damage, true));
      
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
      sfx('playerDown');
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
    // 현재 상태 결정 (gameOver > rolling > slash > shoot > walk > idle)
    let drawState;
    if (STATE.gameOver) {
      // 다운 이미지가 로드돼 있으면 down, 아니면 idle 로 폴백
      const downImg = ANIM_IMAGES['down'];
      const downOk = downImg && downImg.complete && downImg.naturalWidth > 0;
      drawState = downOk ? 'down' : 'idle';
    }
    else if (this.rolling) {
      // slide 이미지가 로드돼 있으면 slide, 아니면 walk
      const slideImg = ANIM_IMAGES['slide'];
      const slideOk = slideImg && slideImg.complete && slideImg.naturalWidth > 0;
      drawState = slideOk ? 'slide' : 'walk';
    }
    else if (this.slashAnimTime > 0) drawState = 'slash';
    else if (this.shootAnimTime > 0) drawState = 'shoot';
    else if (this.animState === 'backwalk') {
      const backImg = ANIM_IMAGES['backwalk'];
      const backOk = backImg && backImg.complete && backImg.naturalWidth > 0;
      drawState = backOk ? 'backwalk' : 'walk';
    }
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
        if (tf.slowMo) {
          // 슬로우모션 잔상 — 강한 시안 글로우
          ctx.globalAlpha = a * 0.55;
          ctx.filter = 'hue-rotate(180deg) saturate(2) brightness(1.2)';
        } else {
          // 일반 대시 잔상 — 시안 톤
          ctx.globalAlpha = a * 0.45;
          ctx.filter = 'hue-rotate(160deg) saturate(1.5)';
        }
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
    if (drawState === 'idle') bobY = Math.sin(this.animTime * 4) * 0;
    else if (drawState === 'walk' || drawState === 'backwalk') bobY = Math.abs(Math.sin(this.animTime * 14)) * -2;
    
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
    
    // Time dilation energy bar under player
    if (!STATE.gameOver) {
      const bw = 76;
      const bh = 1;
      const bx = s.x - bw / 2;
      const by = s.y + 64;
      const ratio = clamp(this.slowMoEnergy / this.slowMoMax, 0, 1);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      ctx.fillStyle = this.slowMoCooldown > 0 ? '#4a6f78' : '#00f5ff';
      ctx.shadowBlur = STATE.slowMo ? 14 : 7;
      ctx.shadowColor = '#00f5ff';
      ctx.fillRect(bx, by, bw * ratio, bh);
      ctx.strokeStyle = 'rgba(180,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
      ctx.restore();
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
      let hitShieldFace = false;
      if (en.type === 'shielder' && en.shieldHp > 0) {
        // 방패 정면 ±90도인지 — 방패는 적 진행 방향(en.angle)에 있음
        const toBullet = Math.atan2(this.y - en.y, this.x - en.x);
        let diff = toBullet - en.angle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        if (Math.abs(diff) < Math.PI / 2) {
          // 방패 정면 — 더 큰 충돌 반경 사용 (시각 방패 외곽 r+54 와 일치)
          effectiveR = en.r + 54;
          hitShieldFace = true;
        }
      }
      
      if (dist(this, en) < effectiveR + this.r) {
        const wasAlive = !en.dead;
        const pierceProc = player.hasUpgrade('piercing') && Math.random() < 0.5;
        const hitSource = pierceProc ? 'piercingBullet' : (hitShieldFace ? 'shieldedBullet' : 'bullet');
        en.takeDamage(this.damage, hitSource);
        if (player.hasUpgrade('emp')) en.stunTimer = 0.4;
        // 샷건 처치 시 핏자국 (지속)
        if (wasAlive && en.dead) {
          bloodstains.push(new BloodStain(en.x, en.y, en.r));
        }
        if (pierceProc) {
          this.pierced.push(en);
        } else {
          this.dead = true;
          return;
        }
      }
    }
    if (bossEntity && !bossEntity.dead) {
      // 제미네이터는 약점이 본체 앞으로 튀어나와 있어서, 충돌 반경을 약점 끝까지 확장
      // 그래야 약점에 총알이 도달할 수 있음 (본체에 맞은 건 takeDamage 안에서 BLOCKED 처리)
      let bossEffR = bossEntity.r;
      if (bossEntity.level === 5 && bossEntity.weakSpotOffset !== undefined) {
        bossEffR = bossEntity.weakSpotOffset + bossEntity.weakSpotR;
      }
      if (!this.pierced.includes(bossEntity) && dist(this, bossEntity) < bossEffR + this.r) {
        const pierceProc = player.hasUpgrade('piercing') && Math.random() < 0.5;
        bossEntity.takeDamage(this.damage, pierceProc ? 'piercingBullet' : 'bullet');
        if (player.hasUpgrade('emp')) bossEntity.slowTimer = 0.5;
        if (pierceProc) {
          this.pierced.push(bossEntity);
        } else {
          this.dead = true;
          return;
        }
      }
    }
    // 히든 보스(테레사) 피격
    if (hiddenBossEntity && !hiddenBossEntity.dead) {
      if (!this.pierced.includes(hiddenBossEntity) && dist(this, hiddenBossEntity) < hiddenBossEntity.r + this.r) {
        const pierceProc = player.hasUpgrade('piercing') && Math.random() < 0.5;
        hiddenBossEntity.takeDamage(this.damage, 'bullet');
        if (pierceProc) { this.pierced.push(hiddenBossEntity); }
        else { this.dead = true; return; }
      }
    }
    for (const decoy of hiddenBossDecoys) {
      if (!decoy.dead && dist(this, decoy) < decoy.r + this.r) {
        decoy.takeDamage(this.damage, 'bullet');
        this.dead = true; return;
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
          en.takeDamage(this.damage, 'bullet');
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
      if (hiddenBossEntity && !hiddenBossEntity.dead) {
        if (dist(this, hiddenBossEntity) < hiddenBossEntity.r + this.r) {
          hiddenBossEntity.takeDamage(this.damage, 'bullet');
          this.dead = true; return;
        }
      }
      for (const decoy of hiddenBossDecoys) {
        if (!decoy.dead && dist(this, decoy) < decoy.r + this.r) {
          decoy.takeDamage(this.damage, 'bullet');
          this.dead = true; return;
        }
      }
    } else {
      // Hit player
      if (player && !player.rolling && !STATE.gameOver) {
        const dPB = dist(this, player);
        // 실제 피격 판정 — 이미지보다 작은 hitR 사용
        if (dPB < player.hitR + this.r) {
          player.takeDamage('bullet');
          this.dead = true;
          return;
        }
        // 그레이즈(아슬아슬하게 스침) — hitR < d < grazeR + this.r 영역에서
        // 한 번만 트리거 (this.grazed 플래그)
        if (!this.grazed && dPB < player.grazeR + this.r) {
          this.grazed = true;
          player.triggerGraze();
          damageNumbers.push(new DmgNumber(player.x, player.y - 50, 0, '#00d4ff', 'GRAZE'));
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
      this.attackCd = 1.6;       // 1.3 → 1.6 (연발이라 조금 길게)
      this.aimTime = 0.7;     // 사격 전 조준 시간(초)
      this.aiming = 0;         // 현재 조준 중인지 (>0 이면 조준 중, 정지)
      // 3연발 버스트
      this.burstLeft = 0;       // 남은 연발 발사 수
      this.burstTimer = 0;      // 다음 연발까지 남은 시간
      this.burstInterval = 0.12; // 연발 사이 간격(초)
    } else if (type === 'shielder') {
      this.hp = 3; this.maxHp = 3;            // HP 10 → 3
      this.r = 62;
      this.speed = 75;
      this.color = '#888';
      this.shieldHp = 30;                     // 방패 내구도 10 → 30 (×3)
      this.shieldHpMax = 30;
      this.turnSpeed = 0.9;                   // 회전 속도 1.8 → 0.9 (1/2)
      this.attackCd = 1.0;
    } else if (type === 'assassin') {
      this.hp = 1; this.maxHp = 1;
      this.speed = 420;
      this.color = '#ff20a0';
      this.attackRange = 40;
      this.attackCd = 0.4;
      this.dashTimer = 0;
      // 회피 슬라이딩
      this.dodgeSlideCd = rand(0.3, 1.0);     // 다음 슬라이드까지 (재평가 주기)
      this.dodgeSlideTime = 0;                // 슬라이드 지속
      this.dodgeSlideDir = { x: 0, y: 0 };
      this.meleeAttackSpeedMult = 2.0;        // 근접 텔레그래프/쿨다운 가속
    } else if (type === 'sniper') {
      this.hp = 1; this.maxHp = 1;
      this.speed = 90;
      this.color = '#ffe040';
      this.preferredDist = 500;
      this.aimTime = 2;
      this.aiming = 0;
    }
    
    const diff = difficultyConfig();
    this.speed *= diff.enemySpeedMult;
    if (this.attackCd !== undefined) this.attackCd *= diff.enemyAttackCdMult;
    if (this.aimTime !== undefined) this.aimTime *= diff.enemyAimTimeMult;
    if (this.burstInterval !== undefined) this.burstInterval *= diff.enemyAttackCdMult;
    if (this.dodgeSlideCd !== undefined) this.dodgeSlideCd *= diff.enemyAttackCdMult;
  }
  
  // 화면(viewport) 안에 있는지 — 경계면 밖이면 무적 + 사격 X
  isOnScreen() {
    const s = worldToScreen(this.x, this.y);
    const margin = this.r;  // 살짝 안쪽까지는 OK
    return s.x > -margin && s.x < W + margin && s.y > -margin && s.y < H + margin;
  }
  
  takeDamage(d, source) {
    if (this.dead) return;
    // 경계면 밖에 있을 때는 무적
    if (!this.isOnScreen()) return;
    
    // (어쌔신 총알 회피 없음 — 슬라이딩은 단순 접근용)
    
    const piercesDefense = source === 'piercingBullet';
    const hitsShieldFace = source === 'shieldedBullet';
    // 방패병: 카타나(슬래시)는 방패를 못 뚫음 — 정면 방어 시 차단
    if (this.type === 'shielder' && this.shieldHp > 0 && source === 'slash') {
      // 방패가 플레이어를 향하고 있으면(즉 정면 방어) 차단
      const playerAngle = angleTo(this, player);
      let diff = playerAngle - this.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      if (Math.abs(diff) < Math.PI / 2) {
        damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#88ccff', 'SHIELD'));
        this.hitFlash = 0.05;
        return;
      }
      // 후면이면 정상 데미지
    }
    
    if (this.type === 'shielder' && this.shieldHp > 0 && hitsShieldFace && !piercesDefense) {
      this.shieldHp -= d;
      this.hitFlash = 0.05;
      sfx('hit');
      if (this.shieldHp <= 0) {
        // shield breaks, particles
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 200), Math.sin(a) * rand(80, 200), 0.6, '#aaa', 5));
        }
      } else {
        damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#88ccff', 'SHIELD'));
      }
      return;
    }
    
    this.hp -= d;
    queueDamageNumber(this, d, -40);
    this.hitFlash = 0.1;
    sfx('hit');
    
    if (this.hp <= 0) this.die();
  }
  
  die() {
    this.dead = true;
    corpseStains.push(new CorpseStain(this));
    sfx('hit');
    
    // 통계: 킬 수 증가 (튜토리얼 적은 카운트 안 함)
    if (!STATE.inTutorial) STATE.kills++;
    
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
      moveEnemyAroundObstacles(this, Math.cos(targetAngle) * this.speed * dt, Math.sin(targetAngle) * this.speed * dt);
      // 공격은 아래 telegraph 시스템에서 처리됨
    } else if (this.type === 'shooter') {
      this.angle = targetAngle;
      
      // 연발 진행 중 — burstTimer 카운트다운 후 추가 발사
      if (this.burstLeft > 0) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          if (this.isOnScreen()) {
            const sp = 840;
            // 약간의 산탄 흔들림 (연발이라 완벽한 조준은 아님)
            const jitter = rand(-0.06, 0.06);
            const a = targetAngle + jitter;
            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, {color: '#ff8030', r: 12}));
            sfx('enemyShoot');
          }
          this.burstLeft--;
          this.burstTimer = this.burstInterval;
          if (this.burstLeft <= 0) {
            this.cooldown = this.attackCd;
          }
        }
        // 연발 중에도 천천히 회전(추적)만, 이동은 정지
        return;  // 다른 행동 차단
      }
      
      if (this.aiming > 0) {
        // 조준 중 — 정지하고 카운트다운, 끝나면 발사
        this.aiming -= dt;
        // aimLine 으로 빨간 조준선 시각화 (sniper 와 동일한 방식)
        this.aimLine = { angle: targetAngle, length: d + 60 };
        if (this.aiming <= 0) {
          // 첫 발사 + 연발 시작 (총 3발)
          if (this.isOnScreen()) {
            const sp = 840;
            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(targetAngle) * sp, Math.sin(targetAngle) * sp, {color: '#ff8030', r: 12}));
            sfx('enemyShoot');
          }
          this.burstLeft = 2;          // 추가 2발 (총 3발)
          this.burstTimer = this.burstInterval;
          this.aiming = 0;
          this.aimLine = null;
        }
      } else {
        // 평시 — 거리 유지하며 이동
        if (d < this.preferredDist - 30) {
          moveEnemyAroundObstacles(this, -Math.cos(targetAngle) * this.speed * dt, -Math.sin(targetAngle) * this.speed * dt);
        } else if (d > this.preferredDist + 30) {
          moveEnemyAroundObstacles(this, Math.cos(targetAngle) * this.speed * dt * 0.7, Math.sin(targetAngle) * this.speed * dt * 0.7);
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
      
      moveEnemyAroundObstacles(this, Math.cos(this.angle) * this.speed * dt, Math.sin(this.angle) * this.speed * dt);
      
      if (this.cooldown <= 0 && d < 375 && this.isOnScreen()) {
        // 방패병 샷건: 5발 산탄
        const sp = 660;
        const spread = 28 * Math.PI / 180;  // 28도 산탄 (5발 펼침)
        for (let i = -2; i <= 2; i++) {
          const a = this.angle + i * spread / 4;
          enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, {color: '#cccccc'}));
        }
        sfx('enemyShoot');
        this.cooldown = this.attackCd;
      }
    } else if (this.type === 'assassin') {
      this.angle = targetAngle;
      
      // 불규칙 슬라이딩 접근: 빠른 돌진 + 짧은 정지를 반복하며 플레이어에게 접근
      if (this.dodgeSlideTime > 0) {
        // 슬라이딩 중 — 빠르게 이동
        this.dodgeSlideTime -= dt;
        const slideSpeed = this.speed * 2.2;
        moveEnemyAroundObstacles(this, this.dodgeSlideDir.x * slideSpeed * dt, this.dodgeSlideDir.y * slideSpeed * dt);
        // 슬라이드 잔영 파티클 (가끔)
        if (Math.random() < 0.15) {
          particles.push(new Particle(this.x, this.y, rand(-40, 40), rand(-40, 40), 0.18, '#ff20a0', 3));
        }
      } else {
        if (this.dodgeSlideCd > 0) {
          // 슬라이드 쿨다운 중 — 느린 불규칙 이동
          this.dodgeSlideCd -= dt;
          this.dashTimer -= dt;
          if (this.dashTimer <= 0) {
            this.dashAngle = targetAngle + rand(-0.5, 0.5);
            this.dashTimer = rand(0.1, 0.25);
          }
          moveEnemyAroundObstacles(this, Math.cos(this.dashAngle) * this.speed * 0.45 * dt, Math.sin(this.dashAngle) * this.speed * 0.45 * dt);
        } else {
          // 플레이어를 향해 빠른 슬라이딩 시작 (불규칙 각도 편차)
          const slideAngle = targetAngle + rand(-0.65, 0.65);
          this.dodgeSlideDir.x = Math.cos(slideAngle);
          this.dodgeSlideDir.y = Math.sin(slideAngle);
          this.dodgeSlideTime = rand(0.18, 0.38);
          this.dodgeSlideCd  = rand(0.12, 0.40);  // 짧은 쿨다운 → 연속 슬라이딩
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(30, 90), Math.sin(a) * rand(30, 90), 0.22, '#ff20a0', 3));
          }
        }
      }
      // 공격은 아래 telegraph 시스템에서 처리됨
    } else if (this.type === 'sniper') {
      this.angle = targetAngle;
      // Maintain far distance
      if (d < this.preferredDist - 50) {
        moveEnemyAroundObstacles(this, -Math.cos(targetAngle) * this.speed * dt, -Math.sin(targetAngle) * this.speed * dt);
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
          sfx('enemyShoot');
          this.cooldown = 3;
          this.aimLine = null;
        }
      } else if (this.cooldown <= 0 && d > 200) {
        this.aiming = this.aimTime;
        sfx('snipeAim');
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
        telegraphTime = 0.18;  // 0.35 → 0.18 (아주 빠른 근접)
        attackCd = 0.22;       // 0.4 → 0.22
      } else { // shielder
        triggerRange = this.r + player.r + 30;
        telegraphTime = 0.6;
        attackCd = 1.0;
      }
      const diff = difficultyConfig();
      telegraphTime *= diff.enemyTelegraphMult;
      attackCd *= diff.enemyAttackCdMult;
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
      // 부활 시스템 (1회 한정)
      this.revivesLeft = 1;             // 남은 부활 횟수
      this.maxRevives = 1;
      this.reviving = false;            // 부활 중 (무적 회복 페이즈)
      this.reviveTimer = 0;             // 부활 진행 시간
      this.reviveDuration = 3.0;        // 무적 회복 3초
      this.invulnAfterRevive = 0;       // 부활 직후 추가 무적 (페이즈 2 진입 보호)
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
      // 3연속 돌진 패턴 (딜레이 없음, 짧은 거리)
      this.tripleDashCd = 7;     // 첫 발동까지 7초
      this.tripleDashRemaining = 0;  // 남은 돌진 횟수 (3 → 0)
      this.tripleDashState = 'idle'; // 'idle' | 'gather' | 'dashing' | 'recover'
      this.tripleDashTimer = 0;       // 현재 dash/recover 시간
      this.tripleDashAngle = 0;
      this.tripleDashGatherTime = 0;  // 기 모으기 진행도 (시각용)
      this.tripleDashGatherDuration = 0.8;  // 기 모으기 0.8초 (예고)
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
      this.hp = 620; this.maxHp = 620;        // 50 → 120
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
      this.weakSpotR = 50;
      this.weakSpotOffset = this.r + 24;  // 본체보다 앞으로 튀어나온 약점 (r + 24)
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
  
  // 제미네이터 약점 월드 좌표 (본체 앞으로 튀어나온 위치)
  weakSpotPos() {
    return {
      x: this.x + Math.cos(this.angle) * this.weakSpotOffset,
      y: this.y + Math.sin(this.angle) * this.weakSpotOffset,
    };
  }
  
  takeDamage(d, source) {
    if (this.dead) return;
    // 경계면 밖에 있을 때는 무적 — 단, 리퍼(level 3)는 무한 사거리 사격하므로 패링 반격을 위해 예외
    if (this.level !== 3 && !this.isOnScreen()) return;
    
    // 백규 부활 회복 페이즈 중엔 완전 무적
    if (this.level === 1 && this.reviving) {
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#ffaa00', 'REVIVING'));
      return;
    }
    // 백규 부활 직후 추가 무적 (페이즈 2 진입 직후 보호)
    if (this.level === 1 && this.invulnAfterRevive > 0) {
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#ffaa00', 'INVULN'));
      return;
    }
    
    // 리퍼 슬라이딩 중에는 무적 (회피 액션의 보상)
    if (this.level === 3 && this.slidingTime > 0) {
      // 슬라이드 중 무적임을 시각적으로 표시
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#ff60ff', 'EVADED'));
      return;
    }
    
    // Geminator: only weak point
    // 약점은 보스의 정면에 본체보다 앞으로 튀어나와 있음 (weakSpotOffset)
    // 플레이어가 보스 정면 콘 안에 있어야 약점에 도달 가능 — 그 외엔 본체 장갑
    if (this.level === 5) {
      const playerAngle = angleTo(this, player);
      let diff = playerAngle - this.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      // 약점 콘 ±35도 안이어야 데미지 (약점이 본체보다 앞으로 튀어나와 있음)
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
    if (this.level === 2 && source !== 'piercingBullet') {
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
    queueDamageNumber(this, d, -50);
    this.hitFlash = 0.1;
    sfx('hit');
    if (this.hp <= 0) {
      // 백규: 1회 부활 (무적 회복 페이즈를 거친 뒤 풀 HP로 부활)
      if (this.level === 1 && this.revivesLeft > 0 && !this.reviving) {
        this.revivesLeft--;
        this.reviving = true;
        this.reviveTimer = 0;
        this.hp = 1;  // 회복 페이즈 동안엔 1로 유지 (무적이라 안 닳음)
        // 부활 트리거 효과
        sfx('death');
        sfx('charge');
        STATE.shake = 50;
        STATE.hitstop = 300;
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 380), Math.sin(a) * rand(80, 380), 1.0, '#ffaa00', 8));
        }
        effects.push(new Explosion(this.x, this.y, 240, 0));
        // 진행 중인 공격 패턴 초기화
        this.summonCd = Math.max(this.summonCd, 2);
        this.lateralSlideTime = 0;
        this.lateralSlideCd = rand(1.0, 2.0);
        // 알림
        showFlash('백규: 아직 안 끝났다', '#ffaa00');
        return;
      }
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
    
    // 통계: 보스 처치 수 증가
    STATE.bossKills++;
    
    // Big explosion
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(100, 500), Math.sin(a) * rand(100, 500), 1.5, ['#ff2050', '#ffcc00', '#fff'][i%3], 10));
    }
    effects.push(new Explosion(this.x, this.y, 400, 0));
    STATE.shake = 60;
    STATE.hitstop = 250;
    STATE.bossDefeated = true;
    
    // 보스 처치 직후: 필드의 모든 투사체 제거 + 플레이어 임시 무적
    enemyBullets = [];
    bullets = [];
    // 진행 중이던 포격 등 적 효과도 제거 (단, 방금 만든 Explosion 은 보존)
    const justSpawnedExplosion = effects[effects.length - 1];
    effects = effects.filter(e => !(e instanceof Bombardment));
    // 플레이어 임시 무적 (2.5초)
    if (player) player.invulnTime = Math.max(player.invulnTime, 2.5);
    STATE.bossInvulnTimer = 2.5;
  }
  
  update(dt) {
    if (this.dead) return;   // 사망 후 업데이트 차단
    if (this.slowTimer > 0) { this.slowTimer -= dt; dt *= 0.5; }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.hitFlash = Math.max(this.hitFlash - dt, 0);
    this.phaseTimer += dt;

    // 백규 부활 회복 페이즈: 정지 상태로 무적, HP 게이지가 차오르며 회복
    if (this.level === 1 && this.reviving) {
      this.reviveTimer += dt;
      // HP 게이지가 점점 회복 (시각적 진행도)
      const t = this.reviveTimer / this.reviveDuration;
      this.hp = Math.max(1, Math.floor(this.maxHp * t));
      
      // 회복 중 빨려들어오는 빨간/노란 파티클 (수렴)
      if (Math.random() < 0.6) {
        const ang = Math.random() * TAU;
        const startR = this.r + 200 + Math.random() * 80;
        const sx = this.x + Math.cos(ang) * startR;
        const sy = this.y + Math.sin(ang) * startR;
        const speed = rand(180, 320);
        particles.push(new Particle(sx, sy, -Math.cos(ang) * speed, -Math.sin(ang) * speed, 0.6, Math.random() < 0.5 ? '#ffaa00' : '#ff2050', 5));
      }
      // 보스 주변 작은 진동
      this.x += rand(-1, 1);
      this.y += rand(-1, 1);
      this.x = clamp(this.x, this.r, WORLD.w - this.r);
      this.y = clamp(this.y, this.r, WORLD.h - this.r);
      
      // 회복 완료 → 페이즈 2 진입
      if (this.reviveTimer >= this.reviveDuration) {
        this.reviving = false;
        this.hp = this.maxHp;
        this.invulnAfterRevive = 0.8;  // 부활 직후 0.8초 추가 무적
        // 부활 완료 폭발 효과
        sfx('explode');
        STATE.shake = 70;
        STATE.hitstop = 200;
        for (let i = 0; i < 80; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(150, 500), Math.sin(a) * rand(150, 500), 1.2, ['#ffaa00', '#ff2050', '#fff'][i%3], 9));
        }
        effects.push(new Explosion(this.x, this.y, 320, 0));
        // 페이즈 2: 더 빨라지고 소환 쿨다운 단축
        this.speed = 240;       // 195 → 240
        this.summonCd = 1.5;    // 첫 소환 빨리
        showFlash('백규: 진심으로 간다', '#ff2050');
      }
      return;  // 회복 중엔 다른 행동 안 함
    }
    if (this.level === 1 && this.invulnAfterRevive > 0) {
      this.invulnAfterRevive -= dt;
    }
    
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
        moveEnemyAroundObstacles(this, this.lateralSlideDir.x * slideSpeed * dt, this.lateralSlideDir.y * slideSpeed * dt);
        // 슬라이드 잔상
        if (Math.random() < 0.7) {
          particles.push(new Particle(this.x, this.y, rand(-40, 40), rand(-40, 40), 0.35, '#ffaa00', 5));
        }
      } else {
        // 평시 이동: 플레이어 추적
        moveEnemyAroundObstacles(this, Math.cos(targetAngle) * this.speed * dt, Math.sin(targetAngle) * this.speed * dt);
        
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
      
      // 3연속 돌진 패턴 — 짧은 거리, 빠른 연속 발동 (단, 첫 돌진 전 기 모으기)
      if (this.tripleDashCd > 0) this.tripleDashCd -= dt;
      
      // 트리플 대시 진행 중
      if (this.tripleDashRemaining > 0 || this.tripleDashState !== 'idle') {
        if (this.tripleDashState === 'gather') {
          // 기 모으기 단계 — 정지 상태로 0.8초 차징, 보스 주변에 빨간 기 파티클
          this.tripleDashGatherTime -= dt;
          // 진행도 0~1
          const gT = 1 - this.tripleDashGatherTime / this.tripleDashGatherDuration;
          // 보스 주변에 빨간 기 파티클이 안쪽으로 빨려들어감 (수렴 효과)
          if (Math.random() < 0.55) {
            const a = Math.random() * TAU;
            const startR = this.r + 80 + Math.random() * 100;   // 멀리서 시작
            const endR = this.r + 8;                            // 보스 근처로 수렴
            // 시작 위치
            const sx = this.x + Math.cos(a) * startR;
            const sy = this.y + Math.sin(a) * startR;
            // 보스 쪽으로 향하는 속도
            const inwardSpeed = 280 + 200 * gT;
            const inwardX = -Math.cos(a) * inwardSpeed;
            const inwardY = -Math.sin(a) * inwardSpeed;
            // 색깔: 진행 따라 빨강 → 흰색
            const color = gT > 0.7 ? '#ffffff' : (gT > 0.4 ? '#ff8888' : '#ff4040');
            particles.push(new Particle(sx, sy, inwardX, inwardY, rand(0.3, 0.5), color, 5 + gT * 4));
          }
          // 발끝/지면 충격파 느낌으로 가끔 빨간 링 파티클
          if (Math.random() < 0.15 && gT > 0.3) {
            const a = Math.random() * TAU;
            const rr = this.r + rand(20, 50);
            particles.push(new Particle(
              this.x + Math.cos(a) * rr,
              this.y + Math.sin(a) * rr,
              0, -rand(40, 80),
              0.4, '#ff4040', 4
            ));
          }
          // 시점 미세 떨림 (가까운 거리일 때만 의미가 있음)
          if (gT > 0.6 && d < 700) {
            STATE.shake = Math.max(STATE.shake, 4 * gT);
          }
          // 기 모으기 끝 → 첫 돌진 시작
          if (this.tripleDashGatherTime <= 0) {
            this.tripleDashAngle = targetAngle;
            this.tripleDashTimer = 0.3;   // 짧은 돌진 시간 (속도 20% 감소했으므로 시간 살짝 늘려 비슷한 거리)
            this.tripleDashState = 'dashing';
            // 발동 사운드
            sfx('cracksonCharge');
            STATE.shake = Math.max(STATE.shake, 14);
          }
        } else if (this.tripleDashState === 'dashing') {
          // 짧고 빠른 돌진 (속도 20% 감소: 1700 → 1360)
          this.tripleDashTimer -= dt;
          const dashSpeed = 1360;
          moveEnemyAroundObstacles(this, Math.cos(this.tripleDashAngle) * dashSpeed * dt, Math.sin(this.tripleDashAngle) * dashSpeed * dt);
          
          // 강화된 잔상 — 캐릭터 잔상 + 파티클 트레일
          // 1) 매우 자주 잔상 파티클 (진로를 따라 길게 늘어짐)
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(
              this.x, this.y,
              Math.cos(a) * rand(20, 80) - Math.cos(this.tripleDashAngle) * 200,
              Math.sin(a) * rand(20, 80) - Math.sin(this.tripleDashAngle) * 200,
              rand(0.25, 0.45),
              i === 0 ? '#ff8080' : (i === 1 ? '#ff4040' : '#ffffff'),
              rand(4, 7)
            ));
          }
          // 2) 보스 본체 위치에 잔상 'echo' 효과 — 진로 뒤쪽으로 페이드되는 빨간 큰 파티클
          if (Math.random() < 0.85) {
            // 뒤쪽으로 살짝 이동한 위치에 큰 페이드 파티클
            const trailDist = 30 + Math.random() * 20;
            particles.push(new Particle(
              this.x - Math.cos(this.tripleDashAngle) * trailDist,
              this.y - Math.sin(this.tripleDashAngle) * trailDist,
              -Math.cos(this.tripleDashAngle) * 40, -Math.sin(this.tripleDashAngle) * 40,
              0.35, '#ff3030', 14   // 큰 사이즈로 본체 잔상 흉내
            ));
          }
          
          // 벽/장애물 충돌
          let hit = false;
          if (this.x < this.r || this.x > WORLD.w - this.r || this.y < this.r || this.y > WORLD.h - this.r) hit = true;
          for (const ob of obstacles) {
            if (ob.dead) continue;
            if (this.x > ob.x - ob.w/2 - this.r && this.x < ob.x + ob.w/2 + this.r &&
                this.y > ob.y - ob.h/2 - this.r && this.y < ob.y + ob.h/2 + this.r) {
              hit = true;
              ob.takeDamage(40);
              break;
            }
          }
          // 플레이어 데미지
          if (!player.rolling && dist(this, player) < this.r + player.r) {
            player.takeDamage();
          }
          
          if (hit || this.tripleDashTimer <= 0) {
            this.tripleDashRemaining--;
            if (this.tripleDashRemaining > 0) {
              // 곧바로 다음 돌진 — 짧은 recover (0.1초) 후 즉시 시작
              this.tripleDashState = 'recover';
              this.tripleDashTimer = 0.1;
            } else {
              // 모든 돌진 종료
              this.tripleDashState = 'idle';
              this.tripleDashCd = rand(7, 10);  // 다음 트리플 대시까지 7~10초
            }
          }
        } else if (this.tripleDashState === 'recover') {
          // 짧은 recover — 거의 딜레이 없음
          this.tripleDashTimer -= dt;
          // 방향 재조준
          this.angle = targetAngle;
          if (this.tripleDashTimer <= 0) {
            this.tripleDashAngle = targetAngle;
            this.tripleDashTimer = 0.3;  // 속도 20% 감소했으므로 시간 살짝 늘림
            this.tripleDashState = 'dashing';
          }
        }
        // 트리플 대시 중엔 다른 행동 X
        this.x = clamp(this.x, this.r, WORLD.w - this.r);
        this.y = clamp(this.y, this.r, WORLD.h - this.r);
        this.facingLeft = Math.cos(this.angle) < 0;
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
          sfx('cracksonCharge');
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
        // 충격파 차징/활성 중에는 angle 고정 (방향 안 바꿈, 그 자리에서 발산)
        const inShockwave = (this.shockwavePrep > 0 || this.shockwaveActive > 0);
        if (!inShockwave) {
          this.angle = targetAngle;
        }
        if (this.shockwaveCd > 0) this.shockwaveCd -= dt;
        
        // 충격파 차징 중: 정지 + 시각 예고 + 방향 회전 X
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
          // 이 동안에도 방향 안 바꾸고 정지
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
          moveEnemyAroundObstacles(this, Math.cos(targetAngle) * this.speed * dt, Math.sin(targetAngle) * this.speed * dt);
          
          // 트리플 대시 트리거 (가까운 거리)
          if (this.tripleDashCd <= 0 && d < 600 && d > 100 && this.isOnScreen()) {
            this.tripleDashRemaining = 3;
            this.tripleDashState = 'gather';                       // 기 모으기 단계로 진입
            this.tripleDashGatherTime = this.tripleDashGatherDuration;
            this.tripleDashAngle = targetAngle;
            // 시작 효과
            for (let i = 0; i < 14; i++) {
              const a = Math.random() * TAU;
              particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 200), Math.sin(a) * rand(80, 200), 0.4, '#ff6060', 5));
            }
            sfx('cracksonCharge');
          } else if (this.cooldown <= 0 && d < 675 && this.isOnScreen()) {
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
      // 슬라이드 중에는 무적 (takeDamage에서 체크)
      if (this.slidingTime > 0) {
        this.slidingTime -= dt;
        const slideSpeed = 700;
        moveEnemyAroundObstacles(this, this.slidingDir.x * slideSpeed * dt, this.slidingDir.y * slideSpeed * dt);
        // 잔상 파티클 — 보라색 강조 (슬라이딩 중 무적임을 시각적으로)
        if (Math.random() < 0.8) {
          particles.push(new Particle(this.x, this.y, rand(-30, 30), rand(-30, 30), 0.4, '#ff60ff', 6));
        }
        // 슬라이드 중엔 다른 행동 X
        // Clamp 후 종료
        this.x = clamp(this.x, this.r, WORLD.w - this.r);
        this.y = clamp(this.y, this.r, WORLD.h - this.r);
        this.facingLeft = Math.cos(this.angle) < 0;
        return;
      }
      
      // 슬라이딩 회피 트리거: 플레이어 산탄총알 또는 패링된(튕긴) 총알이 정면으로 날아오면
      // 단, 마지막 슬라이딩 후 3초 쿨다운
      if (this.slidingCd <= 0) {
        let shouldSlide = false;
        let slideAngle = 0;
        let bulletThreat = null;
        
        // 1순위: 패링되어 튕겨오는 총알 (fromPlayer=true) — 매우 빠르고 데미지 큼
        for (const eb of enemyBullets) {
          if (eb.dead) continue;
          if (!eb.fromPlayer) continue;
          const bd = dist(this, eb);
          if (bd > 350) continue;   // 350px 안의 위협만 감지
          // 이쪽으로 향하는지
          const ba = Math.atan2(eb.dy, eb.dx);
          const toMe = angleTo(eb, this);
          let diff = toMe - ba;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          if (Math.abs(diff) < 0.5) {
            shouldSlide = true;
            bulletThreat = eb;
            // 총알 진행 방향에 수직으로 회피
            slideAngle = ba + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
            break;
          }
        }
        
        // 2순위: 플레이어 샷건 총알 (산탄) — 가까이 + 정면
        if (!shouldSlide) {
          for (const b of bullets) {
            if (b.dead) continue;
            const bd = dist(this, b);
            if (bd > 280) continue;
            const ba = Math.atan2(b.dy, b.dx);
            const toMe = angleTo(b, this);
            let diff = toMe - ba;
            while (diff > Math.PI) diff -= TAU;
            while (diff < -Math.PI) diff += TAU;
            if (Math.abs(diff) < 0.4) {
              shouldSlide = true;
              bulletThreat = b;
              slideAngle = ba + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
              break;
            }
          }
        }
        
        if (shouldSlide) {
          this.slidingTime = 0.4;
          this.slidingCd = 5.0;  // 5초 쿨다운 (사용자 요청)
          this.slidingDir = { x: Math.cos(slideAngle), y: Math.sin(slideAngle) };
          // 슬라이드 시작 효과 — 화이트 플래시 (회피했다는 시각 피드백)
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 220), Math.sin(a) * rand(80, 220), 0.5, '#ffffff', 6));
          }
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(60, 180), Math.sin(a) * rand(60, 180), 0.4, '#a020f0', 5));
          }
          // 조준 중이면 취소
          if (this.aiming > 0) { this.aiming = 0; this.aimLine = null; }
          sfx('slash');
          return;  // 슬라이딩 시작 즉시 다른 행동 X
        }
      }
      
      // 플레이어가 가까이 접근하면 — 텔레포트 대신 슬라이딩으로 회피
      // (슬라이딩 쿨에 묶이며, teleportCd 도 함께 보호로 사용)
      if (d < 200 && this.slidingCd <= 0 && this.slidingTime <= 0) {
        // 플레이어 반대 방향으로 슬라이딩
        const awayAngle = angleTo(player, this);   // 플레이어 → 리퍼 방향 = 도주 방향
        // 살짝 무작위 각도 첨가
        const slideAng = awayAngle + rand(-0.4, 0.4);
        this.slidingDir = { x: Math.cos(slideAng), y: Math.sin(slideAng) };
        this.slidingTime = 0.4;
        this.slidingCd = 5.0;   // 슬라이딩 쿨다운 (다른 슬라이딩 트리거와 동일)
        this.teleportCd = Math.max(this.teleportCd, 1.0);  // 짧은 보조 쿨
        // 시작 효과 — 보라색/흰색 파티클
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 220), Math.sin(a) * rand(80, 220), 0.5, '#ffffff', 6));
        }
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * TAU;
          particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(60, 180), Math.sin(a) * rand(60, 180), 0.4, '#a020f0', 5));
        }
        // 조준 중이면 취소
        if (this.aiming > 0) { this.aiming = 0; this.aimLine = null; }
        sfx('slide');
        return;  // 슬라이딩 시작 즉시 다른 행동 X
      }
      
      // Slow drift
      moveEnemyAroundObstacles(this, Math.cos(targetAngle + Math.PI * 0.7) * this.speed * dt, Math.sin(targetAngle + Math.PI * 0.7) * this.speed * dt);
      
      // 리퍼는 무한 사거리 — 화면 밖이든 맵 끝이든 조준 가능
      // 카타나 패링이 없으면 살아남기 어려운 강도로 사격
      // + 플레이어 움직임 예측 (lead aiming): 발사 후 도달 시점의 위치를 겨냥
      // + 조준선이 즉시 따라잡지 않고 매 프레임 일정 속도로 회전 (추적 방식)
      //   - 플레이어가 슬라이딩 중이면 더 빠르게 따라잡음 (일반보다 약 2.2배)
      if (this.aiming > 0) {
        this.aiming -= dt;
        // 예측 사격: 거의 완벽한 lead — 패링 없이는 회피 어려움
        // 총알 속도 5600, 거리 d, 도달 시간 t ≈ d / 5600
        const sp = 5600;
        const travelT = d / sp;
        const leadFactor = 0.75;   // 0.7 → 0.95 (강한 예측)
        const predX = player.x + player.vx * travelT * leadFactor;
        const predY = player.y + player.vy * travelT * leadFactor;
        const targetAimAngle = Math.atan2(predY - this.y, predX - this.x);
        
        // 현재 aimAngle 에서 targetAimAngle 까지 일정 각속도로 회전 (즉시 점프 X)
        // - 일반: 5.0 rad/s (≈ 286도/초)
        // - 플레이어 슬라이딩 중: 11.0 rad/s (약 2.2배 — 빠르게 따라잡음)
        // - 차징 후반에는 추가 가속 (조준 정확도 보정)
        const trackingSpeed = (player.rolling ? 6.0 : 2.5)
          + (1 - this.aiming / 1.2) * 2.0;   // 차징 진행도에 따라 +0~4
        let diff = targetAimAngle - this.aimAngle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const maxStep = trackingSpeed * dt;
        if (Math.abs(diff) <= maxStep) {
          this.aimAngle = targetAimAngle;
        } else {
          this.aimAngle += Math.sign(diff) * maxStep;
        }
        
        // 레이저 길이 — 맵 끝까지 충분히 길게 (장애물 무관)
        this.aimLine = { angle: this.aimAngle, length: 9000 };
        if (this.aiming <= 0) {
          // 발사 — 조준선 방향 그대로
          const b = new EnemyBullet(this.x, this.y, Math.cos(this.aimAngle) * sp, Math.sin(this.aimAngle) * sp, {color: '#ff00ff', r: 12, fast: true, piercing: true, life: 8});
          enemyBullets.push(b);
          sfx('enemyShoot');
          this.cooldown = 1.5;
          this.aimLine = null;
        }
      } else if (this.cooldown <= 0) {
        this.aiming = 1.2;
        sfx('snipeAim');
        // 조준 시작 시점의 aimAngle 을 현재 플레이어 방향으로 초기화 (한 번만)
        // — 아니면 이전 사격 직후 angle 이 남아있어 이상한 방향에서 추적 시작
        this.aimAngle = targetAngle;
      }
    } else if (this.level === 4) { // CP-09
      this.angle = targetAngle;
      this.spawnTimer -= dt;
      this.bombardCd -= dt;
      // CP-09 사격 쿨다운 (연사용) — 생성자에서 안 만들어진 경우 초기화
      if (this.cp09FireCd === undefined) this.cp09FireCd = 0;
      if (this.cp09Bombarding === undefined) this.cp09Bombarding = false;   // 포격 중 플래그
      this.cp09FireCd -= dt;
      
      // drift
      moveEnemyAroundObstacles(this, Math.cos(this.phaseTimer * 0.5) * this.speed * dt, Math.sin(this.phaseTimer * 0.7) * this.speed * dt);
      
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
        // 포격 시작 — 포격 시작 시각부터 마지막 폭탄 떨어지는 시각까지 사격 중단
        this.cp09Bombarding = true;
        const totalDelay = (numBombs - 1) * 0.15 + 2.5;   // 마지막 setTimeout(0.15*i s) + warningTime(2.5s)
        // 총 약 3초 정도 사격 중단
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
        this.bombardCd = 4.0;  // 다음 포격까지 4초 (사격 페이즈 확보)
        // 포격 종료 타이머 (마지막 폭탄이 떨어진 후 해제)
        setTimeout(() => {
          if (!this.dead) this.cp09Bombarding = false;
        }, totalDelay * 1000);
      }
      
      // 평시 연사 — 포격 중이 아니고, 화면 안일 때
      // 4발씩 짧은 연사 (점사 느낌) → 잠깐 쿨다운 → 반복
      if (!this.cp09Bombarding && this.cp09FireCd <= 0 && this.isOnScreen() && d < 1300) {
        // 점사 4발 (50ms 간격)
        const burstCount = 4;
        for (let i = 0; i < burstCount; i++) {
          setTimeout(() => {
            if (this.dead || this.cp09Bombarding) return;
            const a = angleTo(this, player) + (Math.random() - 0.5) * 0.08;  // 살짝 산탄
            const sp = 1100;
            enemyBullets.push(new EnemyBullet(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, {color: '#00aaff', r: 9}));
          }, i * 50);
        }
        // 점사 후 쿨다운 — 적당한 압박감
        this.cp09FireCd = 0.45;
      }
    } else if (this.level === 5) { // 제미네이터
      // 페이즈별 angle 처리:
      // - 레이저 페이즈: 차징 시작 시 잠긴 각도를 그대로 유지 (플레이어 추적 X)
      //   → 플레이어가 피할 수 있게 1초 딜레이를 주는 핵심 로직
      // - 발사 단계: 시계방향 회전 (아래 laser 페이즈 내부에서 처리)
      // - 그 외: 천천히 플레이어 추적
      if (this.geminatorPhase === 'laser') {
        // 차징/발사 모두 윗부분에서는 회전하지 않음 — 아래 laser 분기에서 일괄 처리
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
      moveEnemyAroundObstacles(this, Math.cos(this.angle) * moveSpeed * dt, Math.sin(this.angle) * moveSpeed * dt);
      
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
          showFlash('레이저 조준중', '#ff0040');
        }
      }
      // ─────────── 페이즈 3: 레이저 (LASER) — 차징 1s + 발사 6s ───────────
      else if (this.geminatorPhase === 'laser') {
        // 약점은 보스 정면(angle 방향, weakSpotOffset 거리)에 있음 — 약점이 곧 무기 부위
        const wsX = this.x + Math.cos(this.angle) * this.weakSpotOffset;
        const wsY = this.y + Math.sin(this.angle) * this.weakSpotOffset;
        
        if (!this.laserActive && this.laserFireTime === 0) {
          // 차징 단계 — 1초 동안 angle/laserAngle 모두 고정 (플레이어 추적 X)
          // → 플레이어가 회피 시간을 가질 수 있음
          // 진입 시점에 한 번만 plyr 방향으로 angle/laserAngle 결정 후 잠금
          if (this.laserChargeTime === 0) {
            // 차징 시작: 현재 플레이어 방향을 잠금
            const tgtA = angleTo(this, player);
            this.angle = tgtA;
            // 잠긴 약점 위치에서 잠긴 플레이어 방향으로 레이저 발사
            const lockedWsX = this.x + Math.cos(this.angle) * this.weakSpotOffset;
            const lockedWsY = this.y + Math.sin(this.angle) * this.weakSpotOffset;
            this.laserAngle = Math.atan2(player.y - lockedWsY, player.x - lockedWsX);
          }
          this.laserChargeTime += dt;
          // 차징 동안 angle/laserAngle 절대 갱신하지 않음 — 플레이어가 옆으로 빠질 수 있음
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
            showFlash('냉각 모드 가동', '#88ddff');
          }
        }
      }
      // ─────────── 페이즈 4: 냉각 (COOLING) — 3초, 약점 완전 노출 ───────────
      else if (this.geminatorPhase === 'cooling') {
        this.coolingTime -= dt;
        // 약점에서 김(증기) 파티클 — 본체 앞으로 튀어나온 위치
        if (Math.random() < 0.5) {
          const wsX = this.x + Math.cos(this.angle) * this.weakSpotOffset;
          const wsY = this.y + Math.sin(this.angle) * this.weakSpotOffset;
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
    
    // 백규 부활 회복 페이즈 — 진행률 링 + 오라
    if (this.level === 1 && this.reviving) {
      const t = clamp(this.reviveTimer / this.reviveDuration, 0, 1);
      // 외곽 빨간 오라 (펄싱)
      const pulse = 0.6 + 0.4 * Math.sin(this.reviveTimer * 8);
      ctx.save();
      ctx.shadowBlur = 50;
      ctx.shadowColor = '#ff2050';
      ctx.strokeStyle = `rgba(255, 32, 80, ${0.5 * pulse})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 14, 0, TAU);
      ctx.stroke();
      ctx.restore();
      // 진행도 호 (보스 위에 게이지)
      ctx.save();
      ctx.shadowBlur = 24;
      ctx.shadowColor = '#ffaa00';
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 30, -Math.PI / 2, -Math.PI / 2 + TAU * t);
      ctx.stroke();
      // 배경 호 (어두운 트랙)
      ctx.strokeStyle = 'rgba(80, 30, 30, 0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 30, 0, TAU);
      ctx.stroke();
      ctx.restore();
      // 안쪽 빨간 코어 글로우 (내부에서 차오름)
      ctx.save();
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ff2050';
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.r);
      grad.addColorStop(0, `rgba(255, 80, 100, ${0.55 * t})`);
      grad.addColorStop(1, 'rgba(255, 32, 80, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // 백규 부활 직후 무적: 짧은 깜빡임 링
    if (this.level === 1 && this.invulnAfterRevive > 0) {
      const blink = (Math.sin(this.invulnAfterRevive * 30) + 1) / 2;
      ctx.save();
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ffaa00';
      ctx.strokeStyle = `rgba(255, 170, 0, ${0.7 * blink})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (this.aimLine) {
      // 리퍼(level 3): 차징 진행에 따라 라인이 점점 선명해짐
      // - 차징 시작 (t=0): 매우 흐림 (alpha 0.1)
      // - 차징 끝 (t=1): 매우 선명 (alpha 1.0) → 발사 (aimLine 사라짐과 동시에 총알)
      if (this.level === 3) {
        const t = clamp(1 - this.aiming / 1.2, 0, 1);   // 0(시작) → 1(끝)
        // 비선형 — 끝에 가까워질수록 급격히 선명해짐 (예측 가능)
        const sharpness = Math.pow(t, 1.6);
        const alpha = 0.08 + 0.92 * sharpness;
        const lineW = 1 + 5 * sharpness;
        const blur = 4 + 30 * sharpness;
        
        ctx.save();
        // 외곽 글로우 (점점 진해짐)
        ctx.strokeStyle = `rgba(255, 0, 200, ${alpha * 0.6})`;
        ctx.lineWidth = lineW + 6;
        ctx.shadowBlur = blur;
        ctx.shadowColor = '#ff00ff';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.aimLine.angle) * this.aimLine.length, Math.sin(this.aimLine.angle) * this.aimLine.length);
        ctx.stroke();
        
        // 메인 라인 (선명도)
        ctx.strokeStyle = `rgba(255, 100, 255, ${alpha})`;
        ctx.lineWidth = lineW;
        ctx.shadowBlur = blur * 0.7;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.aimLine.angle) * this.aimLine.length, Math.sin(this.aimLine.angle) * this.aimLine.length);
        ctx.stroke();
        
        // 발사 직전 (t > 0.85) — 화이트 코어 추가 (마지막 경고)
        if (t > 0.85) {
          const finalT = (t - 0.85) / 0.15;
          ctx.strokeStyle = `rgba(255, 255, 255, ${finalT})`;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 25;
          ctx.shadowColor = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(this.aimLine.angle) * this.aimLine.length, Math.sin(this.aimLine.angle) * this.aimLine.length);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // 그 외 보스(미사용 — 보스에 aimLine 안 씀): 기존 단순 표시
        ctx.save();
        ctx.strokeStyle = `rgba(255, 0, 255, ${0.5 + 0.5 * (1 - this.aiming/1.5)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.aimLine.angle) * this.aimLine.length, Math.sin(this.aimLine.angle) * this.aimLine.length);
        ctx.stroke();
        ctx.restore();
      }
    }
    
    // 크랙슨: 정면(±90도) 방어 영역 항상 시각화 — 큰 청록 방패 호
    // (회전 적용 전, this.angle 방향이 정면)
    if (this.level === 2 && !this.dead) {
      ctx.save();
      const a0 = this.angle - Math.PI / 2;
      const a1 = this.angle + Math.PI / 2;
      const shR = this.r + 22;          // 방패 호 반경
      // 외곽 글로우
      ctx.shadowBlur = 24;
      ctx.shadowColor = '#88ccff';
      ctx.strokeStyle = 'rgba(140, 200, 255, 0.85)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, shR, a0, a1);
      ctx.stroke();
      // 내부 채움 (반투명 — 차단 영역 명확화)
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(140, 200, 255, 0.10)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, shR, a0, a1);
      ctx.closePath();
      ctx.fill();
      // 안쪽 얇은 라인 (테두리 보강)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, shR - 4, a0, a1);
      ctx.stroke();
      // hitFlash 시 방패가 빛남 (차단 피드백)
      if (this.hitFlash > 0) {
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#aaddff';
        ctx.strokeStyle = `rgba(200, 230, 255, ${Math.min(1, this.hitFlash * 8)})`;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(0, 0, shR, a0, a1);
        ctx.stroke();
      }
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
    
    // 크랙슨: 트리플 대시 'gather' (기 모으기) 시각화 — 보스 주변에 수렴하는 빨간 링
    if (this.level === 2 && this.tripleDashState === 'gather') {
      const gT = 1 - this.tripleDashGatherTime / this.tripleDashGatherDuration;   // 0..1
      ctx.save();
      
      // 외곽 수렴 링: 멀리서 시작해 보스 쪽으로 수렴 (애니메이션)
      // 진행될수록 링이 보스 쪽으로 작아짐
      const outerRadiusStart = this.r + 180;
      const outerRadiusEnd = this.r + 30;
      const outerR = lerp(outerRadiusStart, outerRadiusEnd, gT);
      ctx.strokeStyle = `rgba(255, 50, 50, ${0.3 + 0.5 * gT})`;
      ctx.lineWidth = 3 + 4 * gT;
      ctx.shadowBlur = 25;
      ctx.shadowColor = '#ff2020';
      ctx.setLineDash([14, 8]);
      ctx.lineDashOffset = -STATE.realTime * 0.06;   // 회전하는 패턴
      ctx.beginPath();
      ctx.arc(0, 0, outerR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 보스 본체 주변 강한 빨간 오라 (점점 진해짐)
      ctx.fillStyle = `rgba(255, 0, 0, ${0.08 + 0.22 * gT})`;
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 20 + 10 * Math.sin(STATE.realTime * 0.015), 0, TAU);
      ctx.fill();
      
      // 보스 안쪽 빨간 코어 글로우
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ff0000';
      ctx.fillStyle = `rgba(255, 80, 80, ${0.15 + 0.35 * gT})`;
      ctx.beginPath();
      ctx.arc(0, 0, this.r * 0.9, 0, TAU);
      ctx.fill();
      
      // 진행도 호 (보스 위에 게이지 — 발동 임박 알림)
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 5;
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#ff4040';
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 16, -Math.PI / 2, -Math.PI / 2 + TAU * gT);
      ctx.stroke();
      
      // 끝나기 직전(>0.85) 강한 화이트 깜빡임 — 임박 표시
      if (gT > 0.85) {
        const finalT = (gT - 0.85) / 0.15;
        const blink = Math.sin(STATE.realTime * 0.06) > 0 ? 1 : 0.4;
        ctx.strokeStyle = `rgba(255, 255, 255, ${finalT * blink})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, this.r + 5, 0, TAU);
        ctx.stroke();
      }
      
      // 돌진 방향 화살표 — 진행 따라 점점 선명해짐
      if (gT > 0.4) {
        const arrowAlpha = (gT - 0.4) / 0.6;
        const arrowAng = this.tripleDashAngle;   // 첫 돌진 방향 (gather 시작 시 잠금)
        const arrowLen = 90 + 40 * arrowAlpha;
        ctx.strokeStyle = `rgba(255, 80, 80, ${arrowAlpha})`;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#ff2020';
        ctx.beginPath();
        ctx.moveTo(Math.cos(arrowAng) * (this.r + 10), Math.sin(arrowAng) * (this.r + 10));
        ctx.lineTo(Math.cos(arrowAng) * (this.r + 10 + arrowLen), Math.sin(arrowAng) * (this.r + 10 + arrowLen));
        ctx.stroke();
        // 화살촉
        const tipX = Math.cos(arrowAng) * (this.r + 10 + arrowLen);
        const tipY = Math.sin(arrowAng) * (this.r + 10 + arrowLen);
        const headSize = 18;
        // tip 에서 뒤쪽 방향으로 headSize 만큼 떨어진 좌표
        const baseX = tipX - Math.cos(arrowAng) * headSize;
        const baseY = tipY - Math.sin(arrowAng) * headSize;
        // 진행 방향에 perpendicular 방향
        const perpX = -Math.sin(arrowAng);
        const perpY = Math.cos(arrowAng);
        const half = headSize * 0.55;
        ctx.fillStyle = `rgba(255, 80, 80, ${arrowAlpha})`;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + perpX * half, baseY + perpY * half);
        ctx.lineTo(baseX - perpX * half, baseY - perpY * half);
        ctx.closePath();
        ctx.fill();
      }
      
      ctx.restore();
    }
    
    // 크랙슨: 트리플 대시 'dashing' 캐릭터 잔상 효과
    // (보스 본체 그리기 직전에 보스의 이전 위치들을 페이드된 빨간 그림자로)
    if (this.level === 2 && this.tripleDashState === 'dashing') {
      ctx.save();
      // 진행 방향 반대로 잔상 그림자 3~4겹
      for (let i = 1; i <= 4; i++) {
        const offset = i * 22;
        const ox = -Math.cos(this.tripleDashAngle) * offset;
        const oy = -Math.sin(this.tripleDashAngle) * offset;
        const a = (1 - i / 5) * 0.45;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ff3030';
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ff0000';
        ctx.beginPath();
        ctx.arc(ox, oy, this.r * (1 - i * 0.05), 0, TAU);
        ctx.fill();
      }
      // 외곽 모션 블러 라인 (속도감)
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ff8080';
      ctx.lineWidth = 6;
      ctx.shadowBlur = 25;
      ctx.shadowColor = '#ff4040';
      const trailLen = 140;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-Math.cos(this.tripleDashAngle) * trailLen, -Math.sin(this.tripleDashAngle) * trailLen);
      ctx.stroke();
      ctx.restore();
    }
    
    // 제미네이터 레이저 차징/발사 시각화 (회전 적용 전, 보스 중심 기준)
    if (this.level === 5 && this.geminatorPhase === 'laser') {
      ctx.save();
      const lineLen = 9000;
      
      // 약점 오프셋 (보스 중심에서 앞면 weakSpotOffset 거리)
      const wsLocalX = Math.cos(this.angle) * this.weakSpotOffset;
      const wsLocalY = Math.sin(this.angle) * this.weakSpotOffset;
      
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
      // 제미네이터는 약점도 그려야 함 (약점은 본체보다 앞으로 튀어나온 위치)
      if (this.level === 5) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(this.angle);
        // 약점 위치: 본체보다 앞으로 튀어나옴 (weakSpotOffset)
        // 약점을 본체에 연결하는 짧은 메탈릭 받침 (시각적 연결감)
        ctx.fillStyle = '#222';
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 3;
        const stalkW = this.weakSpotR * 0.5;
        ctx.fillRect(this.r - 4, -stalkW / 2, this.weakSpotOffset - this.r + 4, stalkW);
        ctx.strokeRect(this.r - 4, -stalkW / 2, this.weakSpotOffset - this.r + 4, stalkW);
        
        // 약점 본체 — 둥근 빨간 코어
        ctx.fillStyle = '#ff0000';
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ff0000';
        ctx.beginPath();
        ctx.arc(this.weakSpotOffset, 0, this.weakSpotR, 0, TAU);
        ctx.fill();
        // 약점 안쪽 화이트 코어 (시인성 ↑)
        ctx.fillStyle = '#ffaaaa';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(this.weakSpotOffset, 0, this.weakSpotR * 0.45, 0, TAU);
        ctx.fill();
        // 약점 외곽 빛 펄스
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#ff5050';
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(STATE.realTime * 0.01);
        ctx.beginPath();
        ctx.arc(this.weakSpotOffset, 0, this.weakSpotR + 10, 0, TAU);
        ctx.stroke();
        // 냉각 모드일 때 — 추가 청록 글로우 (약점 노출 강조)
        if (this.coolingTime > 0) {
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = '#88ddff';
          ctx.lineWidth = 6;
          ctx.shadowColor = '#88ddff';
          ctx.shadowBlur = 30;
          ctx.beginPath();
          ctx.arc(this.weakSpotOffset, 0, this.weakSpotR + 18, 0, TAU);
          ctx.stroke();
        }
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
      
      // weak spot (FRONT — 본체보다 앞으로 튀어나옴)
      // 받침 (메탈릭 stalk)
      ctx.fillStyle = '#222';
      const stalkW = this.weakSpotR * 0.5;
      ctx.fillRect(this.r - 4, -stalkW / 2, this.weakSpotOffset - this.r + 4, stalkW);
      // 약점 본체
      ctx.fillStyle = '#ffff00';
      ctx.shadowBlur = 30;
      ctx.shadowColor = '#ffff00';
      ctx.beginPath();
      ctx.arc(this.weakSpotOffset, 0, this.weakSpotR * 0.5 + Math.sin(this.phaseTimer * 8) * 2, 0, TAU);
      ctx.fill();
    }
    
    ctx.restore();
  }
}

// =============================================================
// HIDDEN BOSS: 테레사
// =============================================================

// ★ 테레사 체력 — 이 값만 바꾸면 됩니다
const TERESA_MAX_HP = 10;

class HiddenBoss {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 28; this.hitR = 16;
    this.hp = TERESA_MAX_HP; this.maxHp = TERESA_MAX_HP;
    this.dead = false; this.boss = true;
    this.name = '테레사';
    this.color = '#e060ff';
    this.angle = 0;
    this.speed = 520;   // 플레이어(430)보다 살짝 빠름
    this.hitFlash = 0; this.invulnTime = 0;

    // 페이즈 관리 (1~4)
    this.phase = 1; this.phaseTimer = 0;
    this.subState = 'idle';

    // 페이즈 1: 샷건 패턴
    this.p1CycleCount = 0;    // 반복 횟수 (3번 후 페이즈 2)
    this.p1Cooldown = 1.0;    // 초기 딜레이
    this.p1SlideDir = { x: 0, y: 0 };
    this.p1SlideTime = 0;

    // 페이즈 2: 카타나 패턴
    this.p2ChargeTime = 0;
    this.p2ChargeDuration = 1.0;
    this.p2SlashActive = false;
    this.p2SlashTimer = 0;
    this.p2SlashHitPlayer = false;
    this.p2SlideCd = 0;
    this.p2ParryCd = 0;
    this.p2CycleCount = 0;    // 카타나 횟수 (2번 후 페이즈 3)

    // 페이즈 3: 광란 상태
    this.p3Duration = 6.0;    // ★ 6초 지속
    this.p3Timer = 0;
    this.p3Recovering = false;
    this.p3RecoverTimer = 0;
    this.p3RecoverDuration = 2.0;
    this.p3SlashCd = 0;
    this.afterimages = [];
    this.afterimageCd = 0;

    // 페이즈 4: 분신
    this.phase4Entered = false;

    // 공용 충돌 쿨다운
    this.clashCd = 0;
    this.facingLeft = false;

    // 페이즈 3 경험 여부 (이후 카타나 패링 활성화)
    this.hasBeenPhase3 = false;
    // 1500px 이상일 때 접근 슬라이딩 쿨다운
    this.approachSlideCd = 0;
  }

  isOnScreen() {
    const s = worldToScreen(this.x, this.y);
    return s.x > -200 && s.x < W + 200 && s.y > -200 && s.y < H + 200;
  }

  takeDamage(d, source) {
    if (this.dead) return;
    if (source === 'explosion') {
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#e060ff', 'IMMUNE'));
      return;
    }
    if (this.invulnTime > 0) {
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#e060ff', 'INVULN'));
      return;
    }
    // 슬라이딩 중에는 총알 무적 (페이즈 1/2의 슬라이드)
    if (this.subState === 'sliding' && source === 'bullet' && this.phase !== 3) {
      damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#e060ff', 'EVADED'));
      return;
    }
    // 페이즈 3 경험 후: 배터리 충전 중이 아니면 모든 공격 회피
    if (this.hasBeenPhase3) {
      const playerCharging = player && MOUSE.rightDown && player.slashCooldown <= 0;
      if (!playerCharging) {
        if (source === 'slash') {
          this._doClash();
          damageNumbers.push(new DmgNumber(this.x, this.y - 40, 0, '#e060ff', 'PARRY'));
        } else {
          if (this.subState !== 'sliding') this._startSlide(false);
          damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#e060ff', 'EVADED'));
        }
        return;
      }
      // 충전 중이더라도 카타나 공격은 여전히 패링 (배터리 있을 때)
      if (source === 'slash' && player.battery > 0) {
        this._doClash();
        damageNumbers.push(new DmgNumber(this.x, this.y - 40, 0, '#e060ff', 'PARRY'));
        return;
      }
    }
    this.hp -= d;
    queueDamageNumber(this, d, -50);
    this.hitFlash = 0.1;
    sfx('hit');

    if (this.hp <= 0) {
      this.die();
    } else if (this.phase === 3 && !this.p3Recovering) {
      // 페이즈 3 중 피격: 일시 무적 + 페이즈 1로 복귀
      this.invulnTime = 1.5;
      this.enterPhase(1);
      showFlash('테레사: ─!', '#e060ff');
      STATE.shake = Math.max(STATE.shake, 20);
    } else if (!this.phase4Entered && this.hp <= 1) {
      // HP 1: 페이즈 4 진입
      this.hp = 1;
      this.phase4Entered = true;
      this.enterPhase(4);
    }
  }

  die() {
    this.dead = true;
    sfx('explode'); sfx('death');
    STATE.bossKills++;
    STATE.hiddenBossActive = false;
    STATE.hiddenClear = true;

    for (let i = 0; i < 80; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(
        this.x, this.y,
        Math.cos(a) * rand(100, 500), Math.sin(a) * rand(100, 500),
        1.5, ['#e060ff', '#ffffff', '#ff80ff'][i % 3], 10
      ));
    }
    effects.push(new Explosion(this.x, this.y, 400, 0));
    STATE.shake = 60; STATE.hitstop = 250;

    enemyBullets = []; bullets = [];
    if (player) player.invulnTime = Math.max(player.invulnTime, 2.5);

    for (const decoy of hiddenBossDecoys) decoy.dead = true;

    STATE.ended = true;
    setTimeout(() => {
      document.getElementById('endingScreen').classList.add('show');
    }, 3000);
  }

  enterPhase(n) {
    this.phase = n; this.phaseTimer = 0; this.subState = 'idle';
    this.p1CycleCount = 0; this.p1Cooldown = 0.8; this.p1SlideTime = 0;
    this.p2ChargeTime = 0; this.p2SlashActive = false; this.p2CycleCount = 0;
    this.p3Timer = 0; this.p3Recovering = false; this.afterimages = [];

    if (n === 4) {
      this._spawnDecoys();
      showFlash('테레사: ...아직이야.', '#e060ff');
      STATE.shake = 40;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * TAU;
        particles.push(new Particle(this.x, this.y, Math.cos(a)*rand(100,350), Math.sin(a)*rand(100,350), 0.8, '#e060ff', 7));
      }
    }
  }

  _spawnDecoys() {
    hiddenBossDecoys = [];
    for (let i = 0; i < 2; i++) {
      const a = (i + 1) * TAU / 3 + this.angle;
      const dx = clamp(this.x + Math.cos(a) * 250, 100, WORLD.w - 100);
      const dy = clamp(this.y + Math.sin(a) * 250, 100, WORLD.h - 100);
      hiddenBossDecoys.push(new HiddenBossDecoy(dx, dy));
    }
  }

  _fireP1Shotgun() {
    // 최대 12발, 플레이어 탄속(1200)의 2/3, 장애물 통과
    const aimAngle = player ? angleTo(this, player) : this.angle;
    const spread = Math.PI / 4;
    const totalBullets = 12;
    const bulletSpeed = 800;
    for (let i = 0; i < totalBullets; i++) {
      const t = i / (totalBullets - 1);
      const a = aimAngle - spread / 2 + spread * t + rand(-0.04, 0.04);
      enemyBullets.push(new EnemyBullet(
        this.x, this.y,
        Math.cos(a) * bulletSpeed * rand(0.85, 1.1),
        Math.sin(a) * bulletSpeed * rand(0.85, 1.1),
        { r: 7, damage: 1, color: '#d080ff', life: 4, piercing: true }
      ));
    }
    sfx('shoot');
    STATE.shake = Math.max(STATE.shake, 8);
  }

  _startSlide(towardPlayer) {
    let a;
    if (towardPlayer) {
      a = angleTo(this, player);
    } else {
      // 수직 방향 슬라이딩
      const toPlayer = angleTo(this, player);
      a = toPlayer + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.p1SlideDir = { x: Math.cos(a), y: Math.sin(a) };
    this.p1SlideTime = towardPlayer ? 0.35 : 0.4;
    this.subState = 'sliding';
    sfx('slide');
  }

  _tryParry() {
    if (this.p2ParryCd > 0) return;
    if (this.phase === 3 && !this.p3Recovering) return; // 페이즈 3 중에는 패링 안 함

    // 일반 플레이어 총알 패링 (화면경직은 첫 번째 탄환에만 1회)
    let parryHitstopDone = false;
    for (const b of bullets) {
      if (b.dead) continue;
      if (dist(this, b) < 130) {
        b.dead = true;
        this.p2ParryCd = 0.4;
        sfx('parry');
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * TAU;
          enemyBullets.push(new EnemyBullet(
            this.x, this.y,
            Math.cos(a) * rand(300, 600), Math.sin(a) * rand(300, 600),
            { r: 7, damage: 1, color: '#d080ff', life: 3, piercing: true }
          ));
        }
        if (!parryHitstopDone) {
          STATE.shake = Math.max(STATE.shake, 5);
          STATE.hitstop = Math.max(STATE.hitstop, 60);
          parryHitstopDone = true;
        }
        damageNumbers.push(new DmgNumber(this.x, this.y - 40, 0, '#e060ff', 'PARRY'));
        return;  // 한 번에 하나씩 처리
      }
    }
    // 패링된 탄환(fromPlayer=true)이 다시 날아오면 이동으로 회피
    for (const eb of enemyBullets) {
      if (eb.dead || !eb.fromPlayer) continue;
      if (dist(this, eb) < 100) {
        // 탄환 방향 수직으로 이동해서 피함
        const bulletAngle = Math.atan2(eb.dy, eb.dx);
        const evadeA = bulletAngle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        this.x += Math.cos(evadeA) * this.speed * 0.5;
        this.y += Math.sin(evadeA) * this.speed * 0.5;
        this.x = clamp(this.x, this.r, WORLD.w - this.r);
        this.y = clamp(this.y, this.r, WORLD.h - this.r);
        damageNumbers.push(new DmgNumber(this.x, this.y - 40, 0, '#e060ff', 'EVADE'));
        return;
      }
    }
  }

  // 플레이어와 카타나 충돌 처리 (공용)
  _doClash() {
    if (this.clashCd > 0) return;
    this.clashCd = 0.6;
    const a = angleTo(this, player);
    const knock = 300;
    this.x -= Math.cos(a) * knock; this.y -= Math.sin(a) * knock;
    if (player) {
      player.x += Math.cos(a) * knock; player.y += Math.sin(a) * knock;
      player.x = clamp(player.x, player.r, WORLD.w - player.r);
      player.y = clamp(player.y, player.r, WORLD.h - player.r);
    }
    this.x = clamp(this.x, this.r, WORLD.w - this.r);
    this.y = clamp(this.y, this.r, WORLD.h - this.r);
    sfx('parry');
    STATE.shake = Math.max(STATE.shake, 20);
    STATE.hitstop = Math.max(STATE.hitstop, 200);
    damageNumbers.push(new DmgNumber(this.x, this.y - 50, 0, '#ffffff', 'CLASH!'));
    showFlash('CLASH!', '#ffffff');
    if (this.phase === 3 && !this.p3Recovering) {
      this._endPhase3ByParry();
    }
  }

  _endPhase3ByParry() {
    this.p3Recovering = true;
    this.p3RecoverTimer = 0;
    this.p2SlashActive = false;
    this.p2SlashTimer = 0;
    this.p2ChargeTime = 0;
    this.subState = 'recovering';
    this.afterimages = [];
    this.hasBeenPhase3 = true;
    showFlash('PARRY BREAK!', '#ffffff');
  }

  _startKatanaCharge(stage, duration) {
    this.p2ChargeTime = 0;
    this.p2ChargeDuration = duration;
    this.p2SlashStage = stage;
    this.p2SlashHitPlayer = false;
    this.subState = 'charging';
    sfx('charge');
  }

  _releaseKatanaSlash(stage) {
    const slashStage = stage !== undefined ? stage : (this.p2SlashStage || 1);
    const range = [200, 270, 382, 494][slashStage] || 200;
    this.p2SlashActive = true;
    this.p2SlashTimer = 0.32;
    this.p2SlashHitPlayer = false;
    this.subState = 'swinging';
    effects.push(new TeresaSlashEffect(this.x, this.y, range, slashStage, this.angle));
    sfx('slash');
    this._doKatanaHit(slashStage);
  }

  // 카타나 근접 공격 (플레이어 범위 내)
  _doKatanaHit(stage) {
    if (!player || player.dead) return;
    const range = [200, 270, 382, 494][stage] || 200;
    if (dist(this, player) < range + player.hitR) {
      // 플레이어가 같이 카타나를 휘두르고 있으면 충돌
      if ((player.slashAnimTime > 0) && this.clashCd <= 0) {
        this._doClash();
        return;
      }
      if (!this.p2SlashHitPlayer) {
        this.p2SlashHitPlayer = true;
        player.takeDamage('melee');
      }
    }
  }

  update(dt) {
    if (this.dead) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.invulnTime = Math.max(0, this.invulnTime - dt);
    this.phaseTimer += dt;
    this.clashCd = Math.max(0, this.clashCd - dt);
    this.approachSlideCd = Math.max(0, this.approachSlideCd - dt);

    // 좌우 반전만 (회전 없음) — 플레이어가 왼쪽에 있으면 반전
    if (player && !player.dead) {
      this.facingLeft = player.x < this.x;
      // 총알 방향 계산용으로만 angle 갱신
      this.angle = angleTo(this, player);
    }

    // 1500px 이상 떨어지면 공격 중단하고 슬라이딩으로 접근
    if (player && !player.dead && this.subState !== 'sliding' && this.approachSlideCd <= 0) {
      if (dist(this, player) > 1500) {
        this._startSlide(true);
        this.approachSlideCd = 1.0;
        return;  // 이번 프레임은 접근만
      }
    }

    switch (this.phase) {
      case 1: this._updatePhase1(dt); break;
      case 2: this._updatePhase2(dt); break;
      case 3: this._updatePhase3(dt); break;
      case 4: this._updatePhase4(dt); break;
    }

    this.x = clamp(this.x, this.r, WORLD.w - this.r);
    this.y = clamp(this.y, this.r, WORLD.h - this.r);
  }

  _updatePhase1(dt) {
    if (!player || player.dead) return;
    if (this.p1Cooldown > 0) { this.p1Cooldown -= dt; return; }

    if (this.subState === 'idle') {
      this._fireP1Shotgun();
      this.subState = 'postShot';
      this.p1Cooldown = 0.3;
    } else if (this.subState === 'postShot') {
      this._startSlide(false);   // 수직 슬라이딩
    } else if (this.subState === 'sliding') {
      if (this.p1SlideTime > 0) {
        this.p1SlideTime -= dt;
        this.x += this.p1SlideDir.x * this.speed * 1.2 * dt;
        this.y += this.p1SlideDir.y * this.speed * 1.2 * dt;
      } else {
        this.p1CycleCount++;
        if (this.p1CycleCount >= 3) {
          this.enterPhase(2);
        } else {
          this.subState = 'idle';
          this.p1Cooldown = 0.6;
        }
      }
    }
  }

  _updatePhase2(dt) {
    if (!player || player.dead) return;
    if (this.p2ParryCd > 0) this.p2ParryCd -= dt;
    if (this.p2SlideCd > 0) this.p2SlideCd -= dt;
    this._tryParry();

    const distToPlayer = dist(this, player);

    if (this.subState === 'idle') {
      if (distToPlayer > 350 && this.p2SlideCd <= 0) {
        // 너무 멀면 슬라이딩으로 추격
        this._startSlide(true);
        this.p2SlideCd = 1.5;
      } else {
        // 기 모으기
        this._startKatanaCharge(3, 1.0);
      }
    } else if (this.subState === 'sliding') {
      if (this.p1SlideTime > 0) {
        this.p1SlideTime -= dt;
        this.x += this.p1SlideDir.x * this.speed * dt;
        this.y += this.p1SlideDir.y * this.speed * dt;
      } else {
        this.subState = 'idle';
      }
    } else if (this.subState === 'charging') {
      this.p2ChargeTime += dt;
      if (this.p2ChargeTime >= this.p2ChargeDuration) {
        // 3단계 카타나 휘두르기
        this._releaseKatanaSlash(3);
      }
    } else if (this.subState === 'swinging') {
      this.p2SlashTimer -= dt;
      if (this.p2SlashTimer <= 0) {
        this.p2SlashActive = false;
        this.subState = 'idle';
        this.p2CycleCount++;
        this.p2ChargeTime = 0;
        if (this.p2CycleCount >= 2) this.enterPhase(3);
      }
    }
  }

  _updatePhase3(dt) {
    if (!player || player.dead) return;

    if (this.p3Recovering) {
      // 회복 중: 느리게 움직임, 패링/회피 불가
      this.p3RecoverTimer += dt;
      if (this.p3RecoverTimer >= this.p3RecoverDuration) {
        this.p3Recovering = false;
        this.enterPhase(1);
      } else {
        // 느린 접근
        const a = angleTo(this, player);
        const slowFactor = 0.25 * (1 - this.p3RecoverTimer / this.p3RecoverDuration);
        this.x += Math.cos(a) * this.speed * slowFactor * dt;
        this.y += Math.sin(a) * this.speed * slowFactor * dt;
      }
      return;
    }

    this.p3Timer += dt;
    this.p3SlashCd = Math.max(0, this.p3SlashCd - dt);

    // 잔상 생성
    this.afterimageCd -= dt;
    if (this.afterimageCd <= 0) {
      this.afterimageCd = 0.05;
      this.afterimages.push({ x: this.x, y: this.y, facingLeft: this.facingLeft, life: 0.3, life0: 0.3 });
    }
    for (const af of this.afterimages) af.life -= dt;
    this.afterimages = this.afterimages.filter(af => af.life > 0);

    // 총알 피하기 (슬라이딩 대신 이동으로 회피)
    let evading = false;
    for (const b of bullets) {
      if (b.dead) continue;
      if (dist(this, b) < 160) {
        const bulletAngle = Math.atan2(b.dy, b.dx);
        const evadeAngle = bulletAngle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        this.x += Math.cos(evadeAngle) * this.speed * 2 * dt;
        this.y += Math.sin(evadeAngle) * this.speed * 2 * dt;
        evading = true;
        break;
      }
    }
    if (this.subState === 'charging') {
      this.p2ChargeTime += dt;
      if (this.p2ChargeTime >= this.p2ChargeDuration) {
        this._releaseKatanaSlash(1);
        this.p3SlashCd = 0.65;
      }
    } else if (this.subState === 'swinging') {
      this.p2SlashTimer -= dt;
      this._doKatanaHit(1);
      if (this.p2SlashTimer <= 0) {
        this.p2SlashActive = false;
        this.subState = 'idle';
      }
    } else if (!evading) {
      // 접근해서 반드시 기를 모은 뒤 카타나를 휘두른다.
      const a = angleTo(this, player);
      const d = dist(this, player);
      if (d > 170 + player.hitR) {
        this.x += Math.cos(a) * this.speed * 2 * dt;
        this.y += Math.sin(a) * this.speed * 2 * dt;
      } else if (this.p3SlashCd <= 0) {
        this._startKatanaCharge(1, 0.35);
      }
    }

    // 6초 후 페이즈 3 종료 → 느려지는 회복 상태
    if (this.p3Timer >= this.p3Duration) {
      this.p3Recovering = true;
      this.p3RecoverTimer = 0;
      this.afterimages = [];
      this.p2SlashActive = false;
      this.p2ChargeTime = 0;
      this.hasBeenPhase3 = true;  // 페이즈 3 경험 기록
      showFlash('테레사: ...후.', '#e060ff');
    }
  }

  _updatePhase4(dt) {
    // 페이즈 1과 동일 패턴 (분신들은 각자 별도로 동작)
    this._updatePhase1(dt);
  }

  draw() {
    if (this.dead) return;
    const s = worldToScreen(this.x, this.y);
    if (s.x < -100 || s.x > W + 100 || s.y < -100 || s.y > H + 100) return;

    // 페이즈 3 잔상 그리기
    if (this.phase === 3 && !this.p3Recovering) {
      const drawSize = this.r * 4;
      for (const af of this.afterimages) {
        const as = worldToScreen(af.x, af.y);
        ctx.save();
        ctx.globalAlpha = (af.life / af.life0) * 0.35;
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#e060ff';
        ctx.filter = 'hue-rotate(270deg) saturate(3) brightness(1.5)';
        if (af.facingLeft) {
          ctx.translate(as.x, as.y);
          ctx.scale(-1, 1);
          drawAnimFrame && drawAnimFrame('idle', 0, 0, 0, drawSize, false);
        } else {
          drawAnimFrame && drawAnimFrame('idle', 0, as.x, as.y, drawSize, false);
        }
        ctx.filter = 'none';
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(s.x, s.y);

    // 기 모으기 시각효과: 플레이어 카타나 차지와 같은 링/파티클
    if (this.subState === 'charging') {
      const chargeStage = this.p2SlashStage || (this.phase === 2 ? 3 : 1);
      const colors = ['#ffffff', '#ffcc00', '#ffaa00'];
      const color = colors[Math.max(0, Math.min(2, chargeStage - 1))];
      ctx.shadowBlur = 30;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 + chargeStage;
      const radius = 60 + chargeStage * 16 + Math.sin(STATE.realTime * 0.012) * 6;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      if (Math.random() < 0.5) {
        const a = Math.random() * TAU;
        particles.push(new Particle(this.x + Math.cos(a) * radius, this.y + Math.sin(a) * radius, Math.cos(a) * 50, Math.sin(a) * 50, 0.5, color, 4));
      }
    }

    // 회전 없이 좌우 반전만
    if (this.facingLeft) ctx.scale(-1, 1);

    // 히트플래시
    if (this.hitFlash > 0) ctx.filter = 'brightness(3)';

    // 1순위: boss_teresa.png (커스텀 이미지 추가 시 자동 사용)
    // 2순위: 플레이어 idle 애니메이션 스프라이트 (기존 파일 재활용)
    // 3순위: 원형 폴백
    const drawSize = this.r * 4;
    const drew = drawEntityImage('boss_teresa', 0, 0, null, false)
      || (typeof drawAnimFrame === 'function' && drawAnimFrame('idle', 0, 0, 0, drawSize, false));

    ctx.filter = 'none';

    if (!drew) {
      ctx.fillStyle = this.hitFlash > 0 ? '#fff' : this.color;
      ctx.shadowBlur = 20;
      ctx.shadowColor = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = this.p2SlashActive ? '#ffffff' : '#cc88ff';
      ctx.fillRect(this.r * 0.3, -3, this.r + 14, 6);
      ctx.fillStyle = '#220022';
      ctx.beginPath();
      ctx.arc(this.r * 0.45, -6, 3, 0, TAU);
      ctx.arc(this.r * 0.45, 6, 3, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
}

// 테레사 분신 (페이즈 4)
class HiddenBossDecoy {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 28; this.hitR = 16;
    this.hp = 1; this.maxHp = 1;
    this.dead = false;
    this.name = '테레사(?)';
    this.color = '#e060ff';
    this.angle = 0;
    this.speed = 520;
    this.hitFlash = 0;
    // 분신도 같은 패턴으로 움직임
    this.subState = 'idle';
    this.p1CycleCount = 0; this.p1Cooldown = rand(0.5, 1.5);
    this.p1SlideDir = { x: 0, y: 0 }; this.p1SlideTime = 0;
    this.facingLeft = false;
  }

  takeDamage(d, source) {
    if (this.dead) return;
    if (source === 'explosion') return;
    if (this.subState === 'sliding' && source === 'bullet') {
      damageNumbers.push(new DmgNumber(this.x, this.y - 40, 0, '#e060ff', 'EVADED'));
      return;
    }
    this.dead = true;
    sfx('death');
    STATE.shake = Math.max(STATE.shake, 20);
    for (let i = 0; i < 25; i++) {
      const a = Math.random() * TAU;
      particles.push(new Particle(this.x, this.y, Math.cos(a)*rand(80,300), Math.sin(a)*rand(80,300), 0.6, '#e060ff', 6));
    }
    effects.push(new Explosion(this.x, this.y, 100, 0));
    damageNumbers.push(new DmgNumber(this.x, this.y - 60, 0, '#e060ff', '분신!'));
  }

  update(dt) {
    if (this.dead) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (!player || player.dead) return;

    // 좌우 반전만 (회전 없음)
    this.facingLeft = player.x < this.x;
    this.angle = angleTo(this, player);  // 총알 방향용

    // 1500px 이상이면 공격 안 하고 접근
    if (dist(this, player) > 1500 && this.subState !== 'sliding') {
      const a = angleTo(this, player);
      this.p1SlideDir = { x: Math.cos(a), y: Math.sin(a) };
      this.p1SlideTime = 0.4;
      this.subState = 'sliding';
    }

    // 페이즈 1과 동일한 샷건+슬라이드 패턴
    if (this.p1Cooldown > 0) { this.p1Cooldown -= dt; return; }
    if (this.subState === 'idle') {
      this._fireDecoyGun();
      this.subState = 'postShot'; this.p1Cooldown = 0.3;
    } else if (this.subState === 'postShot') {
      const toPlayer = angleTo(this, player);
      const perp = toPlayer + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      this.p1SlideDir = { x: Math.cos(perp), y: Math.sin(perp) };
      this.p1SlideTime = 0.4;
      this.subState = 'sliding';
    } else if (this.subState === 'sliding') {
      if (this.p1SlideTime > 0) {
        this.p1SlideTime -= dt;
        this.x += this.p1SlideDir.x * this.speed * 1.2 * dt;
        this.y += this.p1SlideDir.y * this.speed * 1.2 * dt;
      } else {
        this.p1CycleCount++;
        this.subState = 'idle';
        this.p1Cooldown = 0.7;
        if (this.p1CycleCount >= 3) this.p1CycleCount = 0;
      }
    }
    this.x = clamp(this.x, this.r, WORLD.w - this.r);
    this.y = clamp(this.y, this.r, WORLD.h - this.r);
  }

  _fireDecoyGun() {
    const aimAngle = player ? angleTo(this, player) : this.angle;
    const spread = Math.PI / 4;
    const total = 12;
    const spd = 800;  // 테레사와 동일 탄속, 장애물 통과
    for (let i = 0; i < total; i++) {
      const t = i / (total - 1);
      const a = aimAngle - spread / 2 + spread * t + rand(-0.04, 0.04);
      enemyBullets.push(new EnemyBullet(
        this.x, this.y,
        Math.cos(a) * spd * rand(0.85, 1.1), Math.sin(a) * spd * rand(0.85, 1.1),
        { r: 7, damage: 1, color: '#d080ff', life: 4, piercing: true }
      ));
    }
    sfx('shoot');
  }

  draw() {
    if (this.dead) return;
    const s = worldToScreen(this.x, this.y);
    if (s.x < -100 || s.x > W + 100 || s.y < -100 || s.y > H + 100) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    // 회전 없이 좌우 반전만
    if (this.facingLeft) ctx.scale(-1, 1);
    if (this.hitFlash > 0) ctx.filter = 'brightness(3)';
    const drawSize = this.r * 4;
    const drew = drawEntityImage('boss_teresa_decoy', 0, 0, null, false)
      || drawEntityImage('boss_teresa', 0, 0, null, false)
      || (typeof drawAnimFrame === 'function' && drawAnimFrame('idle', 0, 0, 0, drawSize, false));
    ctx.filter = 'none';
    if (!drew) {
      ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#c040ee';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#c040ee';
      ctx.beginPath();
      ctx.arc(0, 0, this.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#aa66ff';
      ctx.fillRect(this.r * 0.3, -3, this.r + 14, 6);
    }
    ctx.restore();
  }
}

// 히든 보스 소환 함수
function _spawnHiddenBoss() {
  const lines = BOSS_CUTSCENES['hidden'];
  STATE.hiddenBossActive = true;
  STATE.bossActive = true;   // 일반 보스 스폰 방지

  const doSpawn = () => {
    const w = document.getElementById('bossWarning');
    w.style.display = 'flex';
    setTimeout(() => {
      w.style.display = 'none';
      if (!STATE.gameOver && !STATE.ended) {
        const a = Math.random() * TAU;
        const dst = Math.max(W, H) * 0.5 + 150;
        const bx = clamp(player.x + Math.cos(a) * dst, 100, WORLD.w - 100);
        const by = clamp(player.y + Math.sin(a) * dst, 100, WORLD.h - 100);
        hiddenBossEntity = new HiddenBoss(bx, by);
        enemyBullets = []; bullets = [];
        if (player) player.invulnTime = Math.max(player.invulnTime, 2.5);
        showFlash('테레사', '#e060ff');
      }
    }, 2500);
  };

  if (lines && lines.length && !STATE.inBossCutscene) {
    playBossCutscene('hidden', doSpawn);
  } else {
    doSpawn();
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
    const shown = value > 0 ? Math.round(value * 10) / 10 : value;
    this.text = text || (value > 0 ? `-${shown}` : (value === 0 ? '0' : `+${-value}`));
    this.value = Math.max(0, value || 0);
    this.color = color || damageNumberColor(this.value);
    this.fontSize = text ? 18 : clamp(20 + Math.sqrt(this.value) * 5, 20, 56);
    this.life = text ? 0.8 : 0.95;
    this.life0 = this.life;
    this.dy = text ? -40 : -55;
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
    ctx.shadowBlur = this.value > 0 ? 12 : 6;
    ctx.shadowColor = this.color;
    ctx.font = `bold ${this.fontSize}px Bebas Neue`;
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(3, this.fontSize * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(this.text, s.x, s.y);
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
    
    // 맵 밖에 떨어진 아이템: 자석 범위 무시하고 플레이어에게 강제 흡수
    // (아이템이 폭발 등에 밀려 월드 밖으로 빠져나간 경우 회수 보장)
    const outOfBounds = (
      this.x < 0 || this.x > WORLD.w ||
      this.y < 0 || this.y > WORLD.h
    );
    if (outOfBounds) {
      const a = angleTo(this, player);
      const pullSpeed = 2800;   // 매우 빠르게 빨려옴
      this.x += Math.cos(a) * pullSpeed * dt;
      this.y += Math.sin(a) * pullSpeed * dt;
      // 가까이 오면 즉시 수거
      if (dist(this, player) < this.r + player.r + 8) {
        this.dead = true;
        this.collect();
      }
      return;
    }
    
    // Magnet (자석) - 범위 크게, 속도 빠르게
    // 'magnet' 업그레이드: 레벨당 +35% 범위 (1.0 → 1.35 → 1.70 → ...)
    const magnetLv = (player.upgrades && player.upgrades['magnet']) || 0;
    const magnetMult = 1 + 0.35 * magnetLv;
    const d = dist(this, player);
    const magnetRange = 320 * magnetMult;   // 범위도 220 → 320 으로 확장
    if (d < magnetRange) {
      const a = angleTo(this, player);
      // 가까울수록 더 빠르게 끌려옴 (역제곱 비슷한 느낌)
      const proximity = 1 - d / magnetRange;
      const pullSpeed = 1100 + proximity * 1700;   // 500~1300 → 1100~2800 (훨씬 빠름)
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
      const amt = Math.floor(rand(15, 50));
      player.btc += amt;
      STATE.totalEarned += amt;
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
    // 폭발 카운트다운 (피격 후 깜빡이다가 터짐)
    this.blinking = false;
    this.blinkOn = false;
    this.blinkTimer = 0;
    this.explodeTimer = 0;
  }

  // 폭발물 카운트다운 업데이트 (메인 루프에서 호출)
  update(dt) {
    if (!this.blinking) return;
    this.explodeTimer -= dt;
    // 남은 시간에 따라 점점 빨라지는 깜빡임 (2초 → 0.04초 주기)
    const blinkInterval = Math.max(0.04, 0.28 * (this.explodeTimer / 2.0));
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = blinkInterval;
      this.blinkOn = !this.blinkOn;
    }
    if (this.explodeTimer <= 0) {
      this._doExplode();
    }
  }

  // 실제 폭발 처리
  _doExplode() {
    this.dead = true;
    respawnQueue.push({
      x: this.x, y: this.y,
      w: this.w, h: this.h,
      explosive: this.explosive,
      destructible: true,
      timer: 60,
    });
    effects.push(new Explosion(this.x, this.y, 260, 5));
    sfx('explode');
    for (const en of enemies) {
      if (en.dead) continue;
      if (dist(this, en) < 260) en.takeDamage(5);
    }
    if (bossEntity && !bossEntity.dead && dist(this, bossEntity) < 260) bossEntity.takeDamage(5);
    if (hiddenBossEntity && !hiddenBossEntity.dead && dist(this, hiddenBossEntity) < 260) hiddenBossEntity.takeDamage(5, 'explosion');
    if (player && !player.rolling && dist(this, player) < 200) player.takeDamage();
    STATE.shake = Math.max(STATE.shake, 25);
    if (Math.random() < 0.1) {
      const types = ['ammo', 'btc', 'battery'];
      pickups.push(new Pickup(this.x, this.y, types[Math.floor(Math.random() * types.length)]));
    }
  }

  takeDamage(d) {
    if (!this.destructible) return;
    if (this.blinking) return;  // 이미 카운트다운 중
    this.hp -= d;
    if (this.hp <= 0) {
      if (this.explosive) {
        // 즉시 폭발 대신 2초 깜빡임 카운트다운 시작
        this.hp = 0;
        this.blinking = true;
        this.blinkOn = true;
        this.explodeTimer = 2.0;
        this.blinkTimer = 0.28;
        return;
      }
      // 비폭발 장애물: 즉시 처리
      this.dead = true;
      respawnQueue.push({
        x: this.x, y: this.y,
        w: this.w, h: this.h,
        explosive: false,
        destructible: true,
        timer: 60,
      });
      for (let i = 0; i < 15; i++) {
        const a = Math.random() * TAU;
        particles.push(new Particle(this.x, this.y, Math.cos(a) * rand(80, 200), Math.sin(a) * rand(80, 200), 0.6, '#666', 6));
      }
      if (Math.random() < 0.1) {
        const types = ['ammo', 'btc', 'battery'];
        pickups.push(new Pickup(this.x, this.y, types[Math.floor(Math.random() * types.length)]));
      }
    }
  }
  draw() {
    const s = worldToScreen(this.x, this.y);
    if (s.x + this.w < 0 || s.x - this.w > W || s.y + this.h < 0 || s.y - this.h > H) return;

    // 깜빡임 중: 밝은 빨강 오버레이
    const flashOn = this.blinking && this.blinkOn;
    if (flashOn) ctx.filter = 'brightness(3) saturate(2)';

    // Image override
    const imgKey = this.explosive ? 'obstacle_explosive' : 'obstacle_wall';
    if (drawEntityImageRect(imgKey, s.x, s.y, this.w, this.h)) {
      ctx.filter = 'none';
      // HP bar는 그대로 그림
      if (this.destructible && !this.explosive && this.hp < this.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(s.x - this.w/2, s.y - this.h/2 - 6, this.w, 3);
        ctx.fillStyle = '#ff5050';
        ctx.fillRect(s.x - this.w/2, s.y - this.h/2 - 6, this.w * (this.hp / this.maxHp), 3);
      }
      return;
    }

    ctx.filter = 'none';
    ctx.save();
    if (this.explosive) {
      ctx.fillStyle = flashOn ? '#ff6600' : '#330000';
      ctx.strokeStyle = flashOn ? '#ffff00' : '#ff0000';
      ctx.shadowBlur = flashOn ? 24 : 12;
      ctx.shadowColor = flashOn ? '#ff8800' : '#ff0000';
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
      ctx.fillStyle = flashOn ? '#ffffff' : '#ff0000';
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

class CorpseStain {
  constructor(enemy) {
    this.x = enemy.x;
    this.y = enemy.y;
    this.r = enemy.r;
    this.type = enemy.type;
    this.angle = enemy.angle || 0;
    this.facingLeft = !!enemy.facingLeft;
    this.life = 12;
    this.life0 = 12;
    this.fadeStart = 8;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw() {
    const key = `enemy_${this.type}_dead`;
    const conf = ENTITY_IMAGES[key];
    const img = ENTITY_IMG[key];
    if (!conf || !img || !img.complete || img.naturalWidth <= 0) return;
    
    const s = worldToScreen(this.x, this.y);
    const size = conf.size || this.r * 2;
    if (s.x + size < 0 || s.x - size > W || s.y + size < 0 || s.y - size > H) return;
    
    const alpha = this.life > this.fadeStart ? 0.9 : 0.9 * (this.life / this.fadeStart);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawEntityImage(key, s.x, s.y, this.angle, this.facingLeft);
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
  constructor(x, y, radius, stage, damage, isRevival = false) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.stage = stage;
    this.damage = damage;       // 한 번만 데미지를 입히기 위해 보관
    this.life = 0.32;           // 잔상 지속 시간 (slashAnimTime과 맞춤)
    this.life0 = 0.32;
    this.dead = false;
    this.angle = player ? player.angle : 0;
    this.isRevival = isRevival; // 부활 슬래시 여부 (테레사에게 데미지 없음)

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
        en.takeDamage(this.damage, 'slash');
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
        // 크랙슨 돌진 카운터: 크랙슨이 charging(긴 돌격) 또는 트리플 대시 dashing 중이면
        //   슬래시로 정면 카운터 시 → 양쪽 넉백 + 크랙슨은 장애물에 부딪힌 것처럼 기절
        const isCrackson = bossEntity.level === 2;
        const crackChargingNow = isCrackson && (
          bossEntity.charging === true ||
          bossEntity.tripleDashState === 'dashing'
        );
        
        if (crackChargingNow) {
          // 1) 양쪽 넉백 — 슬래시 충돌점에서 두 사람을 서로 밀어냄
          // 보스 → 카운터한 슬래시 발신점 반대 방향으로 밀려남
          const knockAngle = angleTo(this, bossEntity);   // 슬래시 중심 → 보스 방향
          const bossKnock = 320;
          bossEntity.x += Math.cos(knockAngle) * bossKnock;
          bossEntity.y += Math.sin(knockAngle) * bossKnock;
          // 플레이어 → 보스 반대 방향으로 살짝 밀려남 (카운터의 반동)
          if (player) {
            const playerKnock = 180;
            player.x += Math.cos(knockAngle + Math.PI) * playerKnock;
            player.y += Math.sin(knockAngle + Math.PI) * playerKnock;
            player.x = clamp(player.x, player.r, WORLD.w - player.r);
            player.y = clamp(player.y, player.r, WORLD.h - player.r);
          }
          // 보스도 월드 안으로 클램프
          bossEntity.x = clamp(bossEntity.x, bossEntity.r, WORLD.w - bossEntity.r);
          bossEntity.y = clamp(bossEntity.y, bossEntity.r, WORLD.h - bossEntity.r);
          
          // 2) 크랙슨 기절 — 장애물에 부딪힌 것과 동일하게
          bossEntity.charging = false;
          // 트리플 대시는 즉시 종료 (남은 돌진 횟수도 0)
          if (bossEntity.tripleDashState === 'dashing') {
            bossEntity.tripleDashState = 'idle';
            bossEntity.tripleDashRemaining = 0;
            bossEntity.tripleDashCd = rand(7, 10);
          }
          bossEntity.stunFromWall = 1.5;
          
          // 3) 카운터 보너스 데미지 — 방패 무시하고 직접 적용
          //    (정면으로 받아치는 거라 방패가 깨진다는 의미)
          // 일반 슬래시 데미지는 takeDamage 통해서 (시각 피드백 + EMP 등 효과 위해)
          bossEntity.takeDamage(this.damage);
          // 카운터 보너스 — 방패 무시 직접 적용
          if (!bossEntity.dead) {
            bossEntity.hp -= 8;
            bossEntity.hitFlash = 0.15;
            damageNumbers.push(new DmgNumber(bossEntity.x, bossEntity.y - 30, 8, '#ffaa00'));
            if (bossEntity.hp <= 0) bossEntity.die();
          }
          this.bossHit = true;
          
          // 4) 강한 임팩트 (카운터 한 만큼 시각/사운드 강조)
          STATE.hitstop = Math.max(STATE.hitstop, 350);
          STATE.shake = Math.max(STATE.shake, 35);
          sfx('explode');
          sfx('slash');
          
          // 카운터 파티클 (큰 폭발)
          for (let i = 0; i < 50; i++) {
            const a = Math.random() * TAU;
            const sp = rand(250, 700);
            particles.push(new Particle(
              bossEntity.x, bossEntity.y,
              Math.cos(a) * sp, Math.sin(a) * sp,
              rand(0.4, 1.0),
              i % 3 === 0 ? '#ffffff' : (i % 3 === 1 ? '#ff5050' : '#ffcc00'),
              rand(6, 9)
            ));
          }
          // 카운터 충격파 링
          effects.push(new SlashImpactFlash(bossEntity.x, bossEntity.y));
          effects.push(new Explosion(bossEntity.x, bossEntity.y, 280, 0));
          
          // 알림 메시지 + 데미지 숫자
          damageNumbers.push(new DmgNumber(bossEntity.x, bossEntity.y - 60, 0, '#ffcc00', 'COUNTER!'));
          showFlash('!!', '#ffcc00');
        } else {
          // 일반 슬래시 적중
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
    }
    
    // 히든 보스(테레사) 슬래시 적중
    if (hiddenBossEntity && !hiddenBossEntity.dead && !this.hiddenBossHit) {
      if (dist(this, hiddenBossEntity) < this.radius + hiddenBossEntity.r && inCone(hiddenBossEntity.x, hiddenBossEntity.y)) {
        // 부활 슬래시 또는 카타나 충돌(clash): 밀려나기만, 데미지 없음
        if (this.isRevival || (hiddenBossEntity.clashCd <= 0 && (hiddenBossEntity.subState === 'swinging' || (hiddenBossEntity.phase === 3 && !hiddenBossEntity.p3Recovering)))) {
          hiddenBossEntity._doClash();
        } else {
          hiddenBossEntity.takeDamage(this.damage, 'slash');
          STATE.hitstop = Math.max(STATE.hitstop, 200);
          STATE.shake = Math.max(STATE.shake, 15);
          for (let i = 0; i < 20; i++) {
            const a = Math.random() * TAU;
            particles.push(new Particle(hiddenBossEntity.x, hiddenBossEntity.y, Math.cos(a)*rand(150,400), Math.sin(a)*rand(150,400), rand(0.3,0.7), i%2===0?'#e060ff':'#ffffff', 6));
          }
          effects.push(new SlashImpactFlash(hiddenBossEntity.x, hiddenBossEntity.y));
        }
        this.hiddenBossHit = true;
      }
    }
    // 테레사 분신 슬래시 적중
    for (const decoy of hiddenBossDecoys) {
      if (!decoy.dead && dist(this, decoy) < this.radius + decoy.r && inCone(decoy.x, decoy.y)) {
        decoy.takeDamage(this.damage, 'slash');
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
        // 패링 데미지 — 슬래시 단계에 따라 크게 증가
        // stage 0: 8, stage 1: 12, stage 2: 18, stage 3: 25
        const parryDmgs = [4, 4, 6, 8];
        eb.damage = Math.max(eb.damage, parryDmgs[Math.min(this.stage, 3)]);
        this.reflectedBullets.add(eb);
        
        // 패링 사운드 (한 슬래시당 첫 반사에서만 재생해서 사운드 폭주 방지)
        if (!this._parrySoundPlayed) {
          sfx('parry');
          this._parrySoundPlayed = true;
        }
        
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

class TeresaSlashEffect {
  constructor(x, y, radius, stage, angle) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.stage = stage;
    this.angle = angle;
    this.life = 0.32;
    this.life0 = 0.32;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
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
    // 포격 조준(경고) 사운드 — 즉시 재생
    sfx('bombardAim');
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
  idle:  { src: 'images/player_idle.png',  frameW: 128, frameH: 128, frameCount: 4, fps: 4,  loop: true  },
  walk:  { src: 'images/player_move.png',  frameW: 128, frameH: 128, frameCount: 4, fps: 8,  loop: true  },
  backwalk: { src: 'images/player_backwalk.png', frameW: 128, frameH: 128, frameCount: 4, fps: 8, loop: true },
  shoot: { src: 'images/player_shoot.png', frameW: 128, frameH: 128, frameCount: 4, fps: 16, loop: false },
  slash: { src: 'images/player_slash.png', frameW: 128, frameH: 128, frameCount: 4, fps: 14, loop: false },
  // 슬라이딩(구르기) 전용 이미지 — 파일이 없으면 자동으로 walk 로 폴백
  // 한 장이거나 가로로 N프레임 스프라이트시트로 만들면 됨.
  slide: { src: 'images/player_slide.png', frameW: 128, frameH: 128, frameCount: 4, fps: 12, loop: false },
  // 다운(게임오버) 전용 이미지 — 파일이 없으면 자동으로 idle 로 폴백
  down:  { src: 'images/player_down.png',  frameW: 128, frameH: 128, frameCount: 1, fps: 1,  loop: false },
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
  
  // 일반 적 사망 잔상. 파일이 없으면 표시하지 않고 넘어갑니다.
  enemy_rusher_dead:    { src: 'images/enemy_rusher_dead.png',    size: 128, rotate: false, flip: false },
  enemy_shooter_dead:   { src: 'images/enemy_shooter_dead.png',   size: 128, rotate: false, flip: false },
  enemy_shielder_dead:  { src: 'images/enemy_shielder_dead.png',  size: 160, rotate: false, flip: false },
  enemy_assassin_dead:  { src: 'images/enemy_assassin_dead.png',  size: 128, rotate: false, flip: false },
  enemy_sniper_dead:    { src: 'images/enemy_sniper_dead.png',    size: 128, rotate: false, flip: false },
  
  // 보스 (5종) — 기존 대비 약 2배 확대. 회전 X.
  boss_baekgyu:    { src: 'images/boss_baekgyu.png',    size: 128, rotate: false, flip: false },  // 백규
  boss_crackson:   { src: 'images/boss_crackson.png',   size: 180, rotate: false, flip: false },  // 크랙슨
  boss_reaper:     { src: 'images/boss_reaper.png',     size: 150, rotate: false, flip: false },  // 리퍼
  boss_cp09:       { src: 'images/boss_cp09.png',       size: 160, rotate: false, flip: false },  // CP-09
  boss_geminator:  { src: 'images/boss_geminator.png',  size: 280, rotate: false, flip: false },  // 제미네이터
  boss_teresa:     { src: 'images/boss_teresa.png',     size: 128, rotate: false, flip: false },  // 테레사
  boss_teresa_decoy:{ src: 'images/boss_teresa_decoy.png', size: 128, rotate: false, flip: false }, // 테레사 분신
  
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
  { key: 'gunKata', name: '건카타', desc: '칼을 휘두르면 가까운 적들에게 자동 사격' },
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
  { key: 'magnet', name: '루팅 범위', desc: '아이템 자석 범위 +35%', icon: '🧲', cost: (lv) => 90 * Math.pow(1.7, lv), max: 6 },
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
  
  // Boss HP — 일반 보스 또는 히든 보스(테레사) HP 표시
  const activeHpTarget = (hiddenBossEntity && !hiddenBossEntity.dead) ? hiddenBossEntity
                        : (bossEntity && !bossEntity.dead) ? bossEntity : null;
  if (activeHpTarget) {
    document.getElementById('bossHpWrap').style.display = 'block';
    let nameLabel = activeHpTarget.name;
    if (activeHpTarget.level === 3 && activeHpTarget.reaperLives !== undefined) {
      let lifeStr = '';
      for (let i = 0; i < activeHpTarget.reaperMaxLives; i++) {
        lifeStr += i < activeHpTarget.reaperLives ? '◆' : '◇';
      }
      nameLabel = `${activeHpTarget.name}  ${lifeStr}`;
    }
    // 테레사: HP를 다이아몬드로 표시 (TERESA_MAX_HP 개)
    if (activeHpTarget === hiddenBossEntity) {
      let hpStr = '';
      for (let i = 0; i < activeHpTarget.maxHp; i++) {
        hpStr += i < activeHpTarget.hp ? '◆' : '◇';
      }
      nameLabel = `${activeHpTarget.name}  ${hpStr}`;
    }
    document.getElementById('bossName').textContent = nameLabel;
    document.getElementById('bossHpFill').style.width = `${(activeHpTarget.hp / activeHpTarget.maxHp) * 100}%`;
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
  document.body.classList.add('modal-open');  // HUD가 모달 위로 올라오도록
  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  for (const item of SHOP_ITEMS) {
    const lv = player.getShopLevel(item.key);
    const cost = Math.floor(item.cost(lv));
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
  const cost = Math.floor(item.cost(lv));
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
  document.body.classList.remove('modal-open');
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
  STATE.maxPhaseReached = Math.max(STATE.maxPhaseReached, STATE.phase);
  STATE.bossActive = false;
  STATE.bossDefeated = false;
  STATE.phaseStartTime = STATE.time;
  STATE.spawnFrozen = false;   // 새 페이즈 시작 — 적 리젠 재개
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
    STATE.usedCheat = true;
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
    if (c === 'teresa') {
      if (!STATE.bossActive && !STATE.hiddenBossActive) {
        closeCheat();
        _spawnHiddenBoss();
      }
      sfx('pickup');
      return;
    }
    sfx('pickup');
  });
});

// Cheat: spawn specific boss
document.querySelectorAll('[data-bosslevel]').forEach(el => {
  el.addEventListener('click', () => {
    STATE.usedCheat = true;
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
    else if (id === 'howtoModal') {
      document.getElementById(id).classList.remove('active');
      // 게임 중이었다면 일시정지 해제 (다른 모달이 열려있지 않을 때만)
      STATE.howtoOpen = false;
      if (STATE.running && !STATE.inShop && !STATE.inLimitBreak && !STATE.inCheat) {
        STATE.paused = false;
      }
    }
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

// 실제 보스 등장(경고 → 등장). 컷씬은 호출 측에서 처리.
function spawnBoss(forceLevel) {
  const level = forceLevel || STATE.phase;
  
  // 일반 적 모두 제거 (보스 시작 전 정리)
  for (const e of enemies) e.dead = true;
  
  // 보스 컷씬 (대화) 먼저 보여주고 그 후에 경고/등장
  // - 치트로 강제 소환할 때나 페이즈가 자동 트리거할 때나 모두 컷씬 거침
  // - 이미 컷씬 중이면 중복 방지
  if (!STATE.inBossCutscene) {
    STATE.bossActive = true;       // 일반 적 스폰 차단 (컷씬 동안)
    STATE.bossWarning = true;      // 컷씬 후 등장 대기
    STATE.bossPendingLevel = level;
    playBossCutscene(level, () => {
      _spawnBossWarning(level);
    });
    return;
  }
  
  _spawnBossWarning(level);
}

// 경고 → 보스 등장 (컷씬과 분리)
function _spawnBossWarning(level) {
  const w = document.getElementById('bossWarning');
  w.style.display = 'flex';
  STATE.bossActive = true;
  STATE.bossWarning = true;
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
      // 제미네이터(최종 보스) 등장 시 무피해 추적 초기화
      if (level === 5) STATE.bossFightNoDamage = true;

      // 보스 등장 시: 필드의 모든 투사체 제거 + 플레이어 임시 무적
      enemyBullets = [];
      bullets = [];
      // 진행 중이던 포격(Bombardment) 등 적 효과도 제거
      effects = effects.filter(e => !(e instanceof Bombardment));
      // 플레이어 임시 무적 (2.5초)
      if (player) player.invulnTime = Math.max(player.invulnTime, 2.5);
      STATE.bossInvulnTimer = 2.5;
    }
    STATE.bossWarning = false;
  }, 2500);
}

let nextSpawnIn = 0;

// 러쉬/휴식 페이즈 multiplier 계산 (스테이지 길이 2분 기준으로 단축)
// - 페이즈 시작 후 35~50초, 80~95초: 러쉬 (스폰 1.5배)
// - 50~65초, 95~110초: 휴식 (스폰 0.5배 이하)
// - 그 외: 평상시 (1.0배)
// - 2분(120초) 이후엔 보스 트리거되므로 러쉬 없음
function rushMultiplier() {
  const t = STATE.time - STATE.phaseStartTime;
  if (t < 35) return 1.0;
  if (t < 50) return 1.5;   // 러쉬 1
  if (t < 65) return 0.5;   // 휴식 1
  if (t < 80) return 1.0;
  if (t < 95) return 1.5;   // 러쉬 2
  if (t < 110) return 0.5;  // 휴식 2
  return 1.0;
}

function spawnLogic(dt) {
  if (STATE.bossActive) return;
  if (STATE.inLimitBreak) return;
  
  // 페이즈 시작 후 2분 경과 시 더 이상 스폰 안 함 (남은 적 처치 후 보스 등장)
  const phaseElapsed = STATE.time - STATE.phaseStartTime;
  if (phaseElapsed > 120) {
    STATE.spawnFrozen = true;
    return;
  }
  
  const mult = rushMultiplier();
  
  nextSpawnIn -= dt;
  if (nextSpawnIn <= 0) {
    // 동시 출현 캡: 페이즈가 올라갈수록 훨씬 많아짐
    const cap = 12 + STATE.phase * 7;     // 8+phase*4 → 12+phase*7
    if (enemies.length < cap) {
      spawnEnemyOffscreen();
      // 페이즈 ≥ 2: 추가로 1마리 더 (확률)
      if (STATE.phase >= 2 && Math.random() < 0.45) spawnEnemyOffscreen();
      // 러쉬 중이면 추가로 더 등장
      if (mult >= 1.5 && Math.random() < 0.7) spawnEnemyOffscreen();
      // 페이즈 ≥ 3: 가끔 배치 스폰
      if (STATE.phase >= 3 && Math.random() < 0.45) spawnEnemyOffscreen();
      // 페이즈 ≥ 4: 더 자주 배치
      if (STATE.phase >= 4 && Math.random() < 0.5) spawnEnemyOffscreen();
    }
    // 다음 스폰까지 간격: 페이즈 올라갈수록 짧아짐 (더 자주 스폰)
    const baseInterval = Math.max(0.25, 1.4 - STATE.phase * 0.18);
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

function circleHitsObstacleAt(ent, x, y) {
  const r = ent.obstacleRadius || ent.r * 0.72;
  for (const ob of obstacles) {
    if (ob.dead) continue;
    const left = ob.x - ob.w / 2;
    const right = ob.x + ob.w / 2;
    const top = ob.y - ob.h / 2;
    const bottom = ob.y + ob.h / 2;
    const cx = clamp(x, left, right);
    const cy = clamp(y, top, bottom);
    if (Math.hypot(x - cx, y - cy) < r) return true;
  }
  return false;
}

function moveEnemyAroundObstacles(ent, dx, dy) {
  if (!dx && !dy) return;
  const sx = ent.x;
  const sy = ent.y;
  if (circleHitsObstacleAt(ent, sx, sy)) {
    ent.x = clamp(sx + dx, ent.r, WORLD.w - ent.r);
    ent.y = clamp(sy + dy, ent.r, WORLD.h - ent.r);
    return;
  }
  let blockedX = false;
  let blockedY = false;
  
  if (dx) {
    const nx = clamp(sx + dx, ent.r, WORLD.w - ent.r);
    if (!circleHitsObstacleAt(ent, nx, ent.y)) ent.x = nx;
    else blockedX = true;
  }
  
  if (dy) {
    const ny = clamp(sy + dy, ent.r, WORLD.h - ent.r);
    if (!circleHitsObstacleAt(ent, ent.x, ny)) ent.y = ny;
    else blockedY = true;
  }
  
  if (blockedX || blockedY) {
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const step = Math.min(len, ent.speed ? ent.speed / 25 : len);
      const options = [
        { x: sx - dy / len * step, y: sy + dx / len * step },
        { x: sx + dy / len * step, y: sy - dx / len * step },
      ];
      let best = null;
      let bestScore = Infinity;
      for (const opt of options) {
        opt.x = clamp(opt.x, ent.r, WORLD.w - ent.r);
        opt.y = clamp(opt.y, ent.r, WORLD.h - ent.r);
        if (circleHitsObstacleAt(ent, opt.x, opt.y)) continue;
        const score = player ? Math.hypot(opt.x - player.x, opt.y - player.y) : 0;
        if (score < bestScore) {
          bestScore = score;
          best = opt;
        }
      }
      if (best) {
        ent.x = best.x;
        ent.y = best.y;
      }
    }
  }
  
  ent.x = clamp(ent.x, ent.r, WORLD.w - ent.r);
  ent.y = clamp(ent.y, ent.r, WORLD.h - ent.r);
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
          // 경계 밖에도 타일 적용 (화면 전체를 덮음)
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
  // (메인화면, 상점, 한계돌파, 게임오버, 일시정지, 치트, 하우투, 일반 메뉴 등에서 마우스 보이도록)
  const inMenu = !STATE.running
                 || STATE.paused
                 || STATE.inShop
                 || STATE.inLimitBreak
                 || STATE.gameOver
                 || STATE.ended
                 || STATE.inCheat
                 || STATE.howtoOpen
                 || STATE.inStory
                 || STATE.inBossCutscene;
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
  
  if (!STATE.paused && !STATE.gameOver && !STATE.ended && !STATE.inStory && !STATE.inBossCutscene) {
    STATE.time += realDt;
    update(realDt);
  } else {
    // 일시정지/게임오버/엔딩/컷씬 시 슬로우모션 자동 해제 (시안 오버레이도 페이드)
    STATE.slowMo = false;
    STATE.slowMoIntensity = Math.max(0, STATE.slowMoIntensity - dt * 4);
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
  document.getElementById('pauseText').style.display = (STATE.inShop || STATE.inCheat || STATE.howtoOpen) ? 'block' : 'none';
  
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  // 보스 등장/처치 시 임시 무적 카운트다운 (player.invulnTime 과 별개로 시각 효과용 추적)
  if (STATE.bossInvulnTimer > 0) STATE.bossInvulnTimer = Math.max(0, STATE.bossInvulnTimer - dt);
  
  if (player) player.update(dt);
  if (drone) drone.update(dt);
  
  // 슬로우모션: 플레이어 외 모든 entity의 시간만 느리게
  // STATE.slowMo는 player.update 안에서 설정됨 (이 시점엔 이미 갱신된 상태)
  const baseEnemyDt = STATE.slowMo ? dt * STATE.slowMoFactor : dt;
  const enemyDt = baseEnemyDt;
  const bossDt = baseEnemyDt * difficultyConfig().bossTimeScale;
  
  // 슬로우모션 시각 강도 페이드 (켜고 끌 때 부드럽게)
  if (STATE.slowMo) {
    STATE.slowMoIntensity = Math.min(1, STATE.slowMoIntensity + dt * 6);
  } else {
    STATE.slowMoIntensity = Math.max(0, STATE.slowMoIntensity - dt * 4);
  }
  
  // Player vs obstacles
  if (player && !player.rolling) resolvePlayerObstacles();
  
  // Update entities — 적/총알/효과는 슬로우모션 영향 받음
  for (const en of enemies) en.update(enemyDt);
  if (bossEntity) bossEntity.update(bossDt);
  if (hiddenBossEntity) hiddenBossEntity.update(bossDt);
  for (const decoy of hiddenBossDecoys) decoy.update(bossDt);
  for (const b of bullets) b.update(dt);                  // 플레이어 총알은 정상속도 (플레이어가 쏘는 거니까)
  for (const eb of enemyBullets) {
    // 플레이어가 반사한 총알은 정상속도, 적 총알은 슬로우모션
    eb.update(eb.fromPlayer ? dt : baseEnemyDt);
  }
  for (const p of particles) p.update(dt);                // 파티클은 정상속도 유지 (시각 효과)
  for (const pk of pickups) pk.update(dt);                // 픽업도 정상속도 (플레이어와 상호작용)
  for (const e of effects) e.update(enemyDt);             // 폭격/충격파 등 적 효과는 슬로우
  updateDamageNumberBuckets(dt);
  for (const dn of damageNumbers) dn.update(dt);
  for (const bs of bloodstains) bs.update(dt);
  for (const cs of corpseStains) cs.update(dt);
  for (const h of holograms) h.update(dt);
  for (const ob of obstacles) ob.update(dt);  // 폭발물 카운트다운
  
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
  
  // 2분이 지나면 플레이어에게서 너무 먼 일반 적은 보스 진입을 막지 않도록 정리
  if (player && STATE.time - STATE.phaseStartTime > 120) {
    for (const en of enemies) {
      if (!en.dead && dist(en, player) > 2000) en.dead = true;
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
  corpseStains = corpseStains.filter(cs => !cs.dead);
  holograms = holograms.filter(h => !h.dead);
  if (bossEntity && bossEntity.dead) bossEntity = null;
  if (hiddenBossEntity && hiddenBossEntity.dead) hiddenBossEntity = null;
  hiddenBossDecoys = hiddenBossDecoys.filter(d => !d.dead);

  // Boss flow
  // 2분이 지난 뒤(STATE.spawnFrozen=true) + 남은 적이 모두 처치된 뒤 보스 등장
  const phaseElapsed = STATE.time - STATE.phaseStartTime;
  if (!STATE.bossActive && !STATE.bossDefeated && STATE.phase <= 5 &&
      phaseElapsed > 120 && enemies.length === 0) {
    spawnBoss();
  }
  // Cheat: also allow triggering boss faster — for now keep as is.
  
  if (STATE.bossDefeated && !STATE.inLimitBreak) {
    // 즉시 setTimeout/limitBreak 트리거가 두 번 들리지 않도록 플래그 잠금
    STATE.bossDefeated = false;  // 이번 처치 처리됨 → 다음 spawnBoss 의 트리거 방지는 bossActive 유지로 보장
    
    // Phase 5 = ending (or hidden boss if conditions met)
    if (STATE.phase >= 5) {
      for (const e of enemies) e.dead = true;
      // 히든 보스 조건: 보통(normal) 이상 난이도 + 제미네이터 무피해 클리어
      const diffKey = normalizeDifficultyKey(STATE.difficulty);
      if (diffKey !== 'hero' && STATE.bossFightNoDamage) {
        _spawnHiddenBoss();
        return;
      }
      // 일반 엔딩
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

function drawDepthSortedWorldEntities() {
  const items = [];
  for (const ob of obstacles) {
    if (!ob.dead) items.push({ y: ob.y + ob.h / 2, draw: () => ob.draw() });
  }
  for (const pk of pickups) {
    if (!pk.dead) items.push({ y: pk.y + 18, draw: () => pk.draw() });
  }
  for (const en of enemies) {
    if (!en.dead) items.push({ y: en.y + en.r, draw: () => en.draw() });
  }
  if (bossEntity && !bossEntity.dead) {
    items.push({ y: bossEntity.y + bossEntity.r, draw: () => bossEntity.draw() });
  }
  if (hiddenBossEntity && !hiddenBossEntity.dead) {
    items.push({ y: hiddenBossEntity.y + hiddenBossEntity.r, draw: () => hiddenBossEntity.draw() });
  }
  for (const decoy of hiddenBossDecoys) {
    if (!decoy.dead) items.push({ y: decoy.y + decoy.r, draw: () => decoy.draw() });
  }
  if (player) {
    items.push({ y: player.y + player.r, draw: () => player.draw() });
  }
  if (drone) {
    items.push({ y: drone.y + 20, draw: () => drone.draw() });
  }
  items.sort((a, b) => a.y - b.y);
  for (const item of items) item.draw();
}

function draw() {
  drawBackground();
  
  // World entities
  for (const bs of bloodstains) bs.draw();   // 핏자국은 가장 먼저 (땅 위, 다른 것 아래)
  for (const cs of corpseStains) cs.draw();  // 시체 이미지는 핏자국 위, 살아있는 객체 아래
  for (const h of holograms) h.draw();       // 홀로그램은 핏자국 위에
  drawDepthSortedWorldEntities();
  // 보스 화면 밖이면 화살표/마커로 위치 표시 (리퍼 제외 — 리퍼는 은신/저격 컨셉)
  if (bossEntity && !bossEntity.dead && bossEntity.level !== 3) drawBossOffscreenMarker();
  for (const b of bullets) b.draw();
  for (const eb of enemyBullets) eb.draw();
  for (const e of effects) e.draw();
  for (const p of particles) p.draw();
  for (const dn of damageNumbers) dn.draw();
  
  // 커스텀 십자선 커서 — 게임 진행 중일 때만 (메뉴/모달은 시스템 커서)
  const inMenu = !STATE.running || STATE.paused || STATE.inShop || STATE.inLimitBreak || STATE.gameOver || STATE.ended || STATE.inCheat || STATE.howtoOpen;
  if (!inMenu) drawCursor();
  
  // 슬로우모션 사이버펑크 오버레이 — 시안 톤 + 스캔라인 + 비네팅
  if (STATE.slowMoIntensity > 0) {
    const intensity = STATE.slowMoIntensity;
    ctx.save();
    
    // 시안 컬러 오버레이 (multiply 비슷한 느낌으로 색감 변경)
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(0, 200, 220, ${0.15 * intensity})`;
    ctx.fillRect(0, 0, W, H);
    
    // 어두운 시안 비네팅 (가장자리 짙게)
    ctx.globalCompositeOperation = 'multiply';
    const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H) * 0.2, W/2, H/2, Math.max(W,H) * 0.7);
    vg.addColorStop(0, `rgba(180, 255, 255, 1)`);
    vg.addColorStop(1, `rgba(20, 60, 100, ${1 - 0.5 * intensity})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    
    ctx.globalCompositeOperation = 'source-over';
    
    // 가로 스캔라인 (사이버펑크)
    ctx.fillStyle = `rgba(0, 255, 255, ${0.04 * intensity})`;
    for (let y = 0; y < H; y += 4) {
      ctx.fillRect(0, y, W, 1);
    }
    
    // 화면 가장자리 시안 글로우 라인
    ctx.strokeStyle = `rgba(0, 255, 255, ${0.5 * intensity})`;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#00ffff';
    ctx.strokeRect(2, 2, W - 4, H - 4);
    
    // 위/아래 살짝 검은 띠 (시네마틱)
    const barH = 30 * intensity;
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * intensity})`;
    ctx.fillRect(0, 0, W, barH);
    ctx.fillRect(0, H - barH, W, barH);
    
    // 좌측 상단에 "SLOW MODE" 표시
    if (intensity > 0.5) {
      ctx.fillStyle = `rgba(0, 255, 255, ${(intensity - 0.5) * 2})`;
      ctx.font = 'bold 14px Bebas Neue, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#00ffff';
      ctx.fillText('▌ TIME DILATION ACTIVE', 18, 60);
      ctx.shadowBlur = 0;
    }
    
    ctx.restore();
  }
  
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
  damageNumberBuckets = new Map();
  bloodstains = [];
  corpseStains = [];
  obstacles = [];
  respawnQueue = [];
  holograms = [];
  bossEntity = null;
  hiddenBossEntity = null;
  hiddenBossDecoys = [];
  drone = null;

  STATE.running = true;
  STATE.paused = false;
  STATE.phase = 1;
  STATE.phaseStartTime = 0;
  STATE.time = 0;
  STATE.bossActive = false;
  STATE.bossWarning = false;
  STATE.bossDefeated = false;
  STATE.spawnFrozen = false;
  STATE.bossInvulnTimer = 0;
  document.getElementById('bossWarning').style.display = 'none';
  STATE.gameOver = false;
  STATE.ended = false;
  STATE.bossFightNoDamage = true;
  STATE.hiddenBossActive = false;
  STATE.hiddenClear = false;
  STATE.usedCheat = false;
  // 통계 초기화
  STATE.kills = 0;
  STATE.bossKills = 0;
  STATE.totalEarned = 0;
  STATE.maxPhaseReached = 1;
  // 튜토리얼/스토리/컷씬 플래그 초기화 (튜토리얼 완료 후 startGame 재호출 대응)
  STATE.inTutorial = false;
  STATE.tutorialStep = 0;
  STATE.inStory = false;
  STATE.inBossCutscene = false;
  
  spawnInitialObstacles();
}

// Title screen background — 이미지 위에 깔리는 글리치/노이즈 오버레이
// (mix-blend-mode: screen 으로 검은 부분은 사라지고 밝은 노이즈만 보임)
function drawTitleBg() {
  const tbg = document.getElementById('titleBg');
  if (!tbg) return;
  const tctx = tbg.getContext('2d');
  
  function resizeTbg() {
    // 노이즈는 작은 해상도로 그려도 충분 (성능). 1/2 해상도.
    tbg.width = Math.floor(window.innerWidth / 2);
    tbg.height = Math.floor(window.innerHeight / 2);
    tbg.style.width = window.innerWidth + 'px';
    tbg.style.height = window.innerHeight + 'px';
  }
  resizeTbg();
  window.addEventListener('resize', resizeTbg);
  
  let frame = 0;
  let glitchUntil = 0;          // 큰 글리치가 발생 중인 프레임 한도
  let nextGlitchAt = 60;        // 다음 큰 글리치까지 프레임 카운트
  
  function tick() {
    // 타이틀 화면 숨겨졌으면 멈춤
    if (document.getElementById('titleScreen').style.display === 'none') return;
    
    frame++;
    const W = tbg.width, H = tbg.height;
    
    // 1) 캔버스 클리어 (완전 투명) — mix-blend-mode: screen 이면 투명은 검정과 같음
    tctx.clearRect(0, 0, W, H);
    
    // 2) TV 정전기 풍 미세 노이즈: 랜덤 점 드문드문 찍기
    //    매 프레임 약간만 그려서 어른거리는 느낌 (너무 많으면 화면이 뿌예짐)
    const dotCount = 600;
    for (let i = 0; i < dotCount; i++) {
      const x = (Math.random() * W) | 0;
      const y = (Math.random() * H) | 0;
      const v = Math.random();
      // 대부분은 흰 노이즈, 가끔 빨강/시안 (사이버펑크 톤)
      let r, g, b;
      if (v < 0.85) { r = g = b = 200 + Math.random() * 55 | 0; }
      else if (v < 0.93) { r = 255; g = 40; b = 80; }
      else { r = 0; g = 220; b = 255; }
      const a = 0.15 + Math.random() * 0.4;
      tctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      tctx.fillRect(x, y, 1, 1);
    }
    
    // 3) 얇은 가로 글리치 라인 (스캔라인 위 가끔 빛나는 줄)
    const lineCount = 2 + (Math.random() < 0.3 ? 2 : 0);
    for (let i = 0; i < lineCount; i++) {
      const y = (Math.random() * H) | 0;
      const v = Math.random();
      const color = v < 0.6 ? `rgba(255,255,255,${0.15 + Math.random() * 0.3})`
                  : v < 0.85 ? `rgba(255, 40, 80, ${0.25 + Math.random() * 0.4})`
                  : `rgba(0, 220, 255, ${0.25 + Math.random() * 0.4})`;
      tctx.fillStyle = color;
      tctx.fillRect(0, y, W, Math.random() < 0.5 ? 1 : 2);
    }
    
    // 4) 큰 글리치 (가로 tear) — 불규칙 간격으로 0.1~0.3초 동안만 발생
    nextGlitchAt--;
    if (nextGlitchAt <= 0 && glitchUntil < frame) {
      glitchUntil = frame + 4 + (Math.random() * 10) | 0;
      nextGlitchAt = 60 + (Math.random() * 200) | 0;  // 1~4초마다
    }
    if (glitchUntil > frame) {
      // 화면 일부에 굵은 글리치 밴드 — RGB 채널 어긋나는 느낌
      const bandY = (Math.random() * H) | 0;
      const bandH = 6 + (Math.random() * 30) | 0;
      // 노이즈 블록 여러 개
      for (let i = 0; i < 8; i++) {
        const x = (Math.random() * W) | 0;
        const w = 20 + (Math.random() * 120) | 0;
        const v = Math.random();
        const color = v < 0.5 ? `rgba(255, 40, 80, 0.55)`
                    : v < 0.85 ? `rgba(0, 220, 255, 0.55)`
                    : `rgba(255, 255, 255, 0.7)`;
        tctx.fillStyle = color;
        tctx.fillRect(x, bandY + (Math.random() * 4 - 2) | 0, w, bandH);
      }
    }
    
    requestAnimationFrame(tick);
  }
  tick();
}
drawTitleBg();

document.querySelectorAll('[data-difficulty]').forEach(btn => {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty));
});
setDifficulty(STATE.difficulty);

document.getElementById('startBtn').addEventListener('click', () => startGame(false));
document.getElementById('tutorialBtn').addEventListener('click', () => {
  // ?쒗넗由ъ뼹: ?명듃濡??ㅽ넗由????쒗넗由ъ뼹 寃뚯엫?뚮젅????蹂?寃뚯엫
  document.getElementById('titleScreen').style.display = 'none';
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (musicOn) startMusic();
  playIntroStory();
});
document.getElementById('howtoBtn').addEventListener('click', () => {
  document.getElementById('howtoModal').classList.add('active');
  // 게임 진행 중이면 일시정지 (타이틀 화면이면 STATE.running=false 라 영향 없음)
  STATE.howtoOpen = true;
  if (STATE.running && !STATE.gameOver && !STATE.ended) {
    STATE.paused = true;
  }
});

// =============================================================
// STORY / DIALOGUE SYSTEM
// =============================================================
// 대사 라인 형식:
//   { name: '이름', text: '대사', portrait: '이미지경로(선택)', side: 'left'|'right' (선택, 기본 left) }
// portrait이 빈 문자열이면 이미지 안 바꿈 (이전 이미지 유지),
// null이면 이미지 숨김.
// playDialogue(lines, screenId, onDone) - 모달형 컷씬 한 번 재생

let _dlgState = null;

/**
 * 일반 대화 컷씬 재생기. 다른 컷씬에서도 재사용.
 * @param {Array} lines - {name, text, portrait, side, portraitRight} 배열
 * @param {string} screenId - 'storyScreen' or 'bossCutscene'
 * @param {Function} onDone - 끝나면 호출
 */
function playDialogue(lines, screenId, onDone) {
  const screen = document.getElementById(screenId);
  if (!screen) { if (onDone) onDone(); return; }
  
  _dlgState = {
    lines: lines.slice(),
    idx: -1,
    screenId,
    onDone: onDone || (() => {}),
    // 타이핑 효과
    typing: false,
    fullText: '',
    typedLen: 0,
    typeTimer: 0,
  };
  
  if (screenId === 'bossCutscene') {
    STATE.inBossCutscene = true;
  } else {
    STATE.inStory = true;
  }
  
  screen.classList.add('show');
  _dlgAdvance();
}

function _dlgAdvance() {
  if (!_dlgState) return;
  
  // 타이핑 중이면 즉시 완료
  if (_dlgState.typing) {
    _dlgState.typedLen = _dlgState.fullText.length;
    _renderDlgText();
    _dlgState.typing = false;
    return;
  }
  
  _dlgState.idx++;
  if (_dlgState.idx >= _dlgState.lines.length) {
    _dlgEnd();
    return;
  }
  
  const line = _dlgState.lines[_dlgState.idx];
  const screenId = _dlgState.screenId;
  
  // 이름/포트레이트 ID는 화면별로 다름
  let nameId, textId, portraitId;
  if (screenId === 'bossCutscene') {
    nameId = 'bossDialogueName';
    textId = 'bossDialogueText';
  } else {
    nameId = 'storyName';
    textId = 'storyText';
  }
  
  document.getElementById(nameId).textContent = line.name || '';
  
  // 보스 컷씬은 보스가 우측, 플레이어가 좌측. 일반 스토리는 좌측 한 명.
  if (screenId === 'bossCutscene') {
    const bossPort = document.getElementById('bossPortrait');
    const playerPort = document.getElementById('bossCutscenePlayerPortrait');
    
    // 좌측 (플레이어) 포트레이트 처리
    if (line.side === 'left' || line.side === 'player') {
      if (line.portrait) {
        playerPort.src = line.portrait;
        playerPort.classList.add('show');
      } else if (line.portrait === null) {
        playerPort.classList.remove('show');
      }
      bossPort.style.filter = 'drop-shadow(0 0 25px rgba(0,200,255,0.2)) brightness(0.5)';
      playerPort.style.filter = 'drop-shadow(0 0 25px rgba(255,32,80,0.5)) brightness(1)';
    } else {
      // right (보스) 또는 미지정
      if (line.portrait !== undefined && line.portrait !== '') {
        if (line.portrait === null) {
          bossPort.classList.remove('show');
        } else {
          bossPort.src = line.portrait;
          bossPort.classList.add('show');
        }
      }
      bossPort.style.filter = 'drop-shadow(0 0 25px rgba(255,32,80,0.5)) brightness(1)';
      playerPort.style.filter = 'drop-shadow(0 0 25px rgba(0,200,255,0.2)) brightness(0.5)';
    }
  } else {
    // 일반 스토리: 좌측 단일 포트레이트
    const portrait = document.getElementById('storyPortrait');
    if (line.portrait !== undefined && line.portrait !== '') {
      if (line.portrait === null) {
        portrait.classList.remove('show');
      } else {
        portrait.src = line.portrait;
        portrait.classList.add('show');
      }
    }
  }
  
  // 타이핑 시작
  _dlgState.fullText = line.text || '';
  _dlgState.typedLen = 0;
  _dlgState.typing = true;
  _dlgState.typeTimer = 0;
  _renderDlgText();
}

function _renderDlgText() {
  if (!_dlgState) return;
  const textId = _dlgState.screenId === 'bossCutscene' ? 'bossDialogueText' : 'storyText';
  const el = document.getElementById(textId);
  if (el) el.textContent = _dlgState.fullText.slice(0, _dlgState.typedLen);
}

// 타이핑 애니메이션 (gameLoop 와 별개의 타이머)
setInterval(() => {
  if (!_dlgState || !_dlgState.typing) return;
  _dlgState.typedLen = Math.min(_dlgState.fullText.length, _dlgState.typedLen + 2);
  _renderDlgText();
  if (_dlgState.typedLen >= _dlgState.fullText.length) {
    _dlgState.typing = false;
  }
}, 25);

function _dlgEnd() {
  if (!_dlgState) return;
  const screenId = _dlgState.screenId;
  const onDone = _dlgState.onDone;
  
  document.getElementById(screenId).classList.remove('show');
  // 포트레이트 숨김
  if (screenId === 'storyScreen') {
    document.getElementById('storyPortrait').classList.remove('show');
  } else {
    const bp = document.getElementById('bossPortrait');
    const pp = document.getElementById('bossCutscenePlayerPortrait');
    bp.classList.remove('show');
    pp.classList.remove('show');
    // src 초기화 — 다음 컷씬 시작 시 이전 보스 이미지가 잠깐 보이는 현상 방지
    bp.src = '';
    pp.src = '';
  }
  
  if (screenId === 'bossCutscene') {
    STATE.inBossCutscene = false;
  } else {
    STATE.inStory = false;
  }
  
  _dlgState = null;
  if (onDone) onDone();
}

// 클릭/스페이스로 대사 진행
window.addEventListener('keydown', (e) => {
  if (!_dlgState) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    _dlgAdvance();
  }
  if (e.key === 'Escape') {
    // ESC = 컷씬 스킵
    const screenId = _dlgState.screenId;
    const onDone = _dlgState.onDone;
    document.getElementById(screenId).classList.remove('show');
    if (screenId === 'bossCutscene') STATE.inBossCutscene = false;
    else STATE.inStory = false;
    _dlgState = null;
    if (onDone) onDone();
  }
});
document.getElementById('storyScreen').addEventListener('click', () => {
  if (_dlgState && _dlgState.screenId === 'storyScreen') _dlgAdvance();
});
document.getElementById('bossCutscene').addEventListener('click', () => {
  if (_dlgState && _dlgState.screenId === 'bossCutscene') _dlgAdvance();
});

// =============================================================
// INTRO STORY (튜토리얼 시작 시)
// =============================================================
// 주인공: 참진리연구회 요원
// 상황: 우주 해적이 빼돌린 연구물자 회수하러 컨테이너 항구에 침투
//
// 대사 확장: INTRO_LINES 배열에 더 추가하면 됨.
// portrait 경로: images/standing.png (이미 게임에서 쓰는 주인공 스탠딩)
// 다른 캐릭터 추가하려면 images/ 폴더에 png 넣고 경로 지정.
const INTRO_LINES = [
  { name: '???', text: '...STATION 44 도크. 여기가 맞다.', portrait: 'images/standing.png' },
  { name: '사마엘', text: '여기에 우리 참진리연구회의 탈취당한 샘플이 있다. \n그것도 \"진리\"의 모방 샘플을.' },
  { name: '사마엘', text: '잃어버린 우리 물건을 도로 가져가는 게 임무.'},
  { name: '사마엘', text: '컨테이너 더미 사이로 간다.\n조용히, 빠르게.' },
  { name: '???', text: '— 침입자다! 누군가 부두에 들어왔어!', portrait: null },
  { name: '사마엘', text: '...들켰군.', portrait: 'images/standing.png' },
  { name: '사마엘', text: '뭐, 어쩔 수 없지.\n어차피 진리에 함부로 손댄자는 모두 죽어야한다.' },
];

function playIntroStory() {
  playDialogue(INTRO_LINES, 'storyScreen', () => {
    // 인트로 끝 → 튜토리얼 게임플레이 시작
    startTutorial();
  });
}

// =============================================================
// TUTORIAL GAMEPLAY
// =============================================================
// 단계별로 hint를 띄우고, 조건 충족 시 다음 단계로.
// 마지막 단계 끝 → 암전 → 본 게임 시작.

const TUTORIAL_STEPS = [
  {
    title: '이동',
    text: 'WASD 키로 사방을 이동해보자.',
    progress: '1 / 8',
    check: (s) => s.movedDist > 400,  // 충분히 움직이면 통과
  },
  {
    title: '샷건 사격',
    text: '마우스 좌클릭으로 샷건 3발을 쏜다.\n시험 표적을 부숴보자.',
    progress: '2 / 8',
    check: (s) => s.targetsBroken >= 1,
  },
  {
    title: '샷건 충전 사격',
    text: '좌클릭을 길게 눌러 충전, 떼면 일제 사격.\n많이 충전할수록 강력하다.',
    progress: '3 / 8',
    check: (s) => s.chargedShots >= 1,
  },
  {
    title: '카타나 베기',
    text: '마우스 우클릭으로 카타나를 휘두른다.\n실전에선 날아오는 총알을 반사할 수도 있다.',
    progress: '4 / 8',
    check: (s) => s.slashesPerformed >= 2,
  },
  {
    title: '카타나 패링',
    text: '한 번 더 휘둘러보자.\n타이밍을 맞춰 휘두르면 적의 총알이 되돌아간다.',
    progress: '5 / 8',
    check: (s) => s.slashesPerformed >= 4,
  },
  {
    title: '카타나 충전',
    text: '우클릭을 오래 누르면 3단계까지 충전.\n광범위한 일격을 가할 수 있다. (배터리 소모)',
    progress: '6 / 8',
    check: (s) => s.chargedSlashes >= 1,
  },
  {
    title: '슬라이딩 회피',
    text: 'SPACE로 짧게 미끄러져 회피한다.\n무적이지만 배터리를 소모한다.',
    progress: '7 / 8',
    check: (s) => s.rolls >= 1,
  },
  {
    title: '시간 감속',
    text: 'SHIFT를 누르면 시간 감속 에너지를 써서 적과 총알이 느려진다.\n감속 중 총알에 맞으면 죽지 않고 GRAZE 처리된다.',
    progress: '8 / 8',
    check: (s) => s.slowMoUsed >= 1,
  },
];

let TUTORIAL_TRACK = null;

function startTutorial() {
  // 일반 startGame 과 비슷하지만 적/보스 자동 스폰 끔
  initAudio();
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
  damageNumberBuckets = new Map();
  bloodstains = [];
  corpseStains = [];
  obstacles = [];
  respawnQueue = [];
  holograms = [];
  bossEntity = null;
  hiddenBossEntity = null;
  hiddenBossDecoys = [];
  drone = null;

  STATE.running = true;
  STATE.paused = false;
  STATE.phase = 1;
  STATE.phaseStartTime = 0;
  STATE.time = 0;
  STATE.bossActive = true;       // 자동 보스 스폰 차단
  STATE.bossWarning = false;
  STATE.bossDefeated = false;
  STATE.spawnFrozen = false;
  STATE.bossInvulnTimer = 0;
  STATE.gameOver = false;
  STATE.ended = false;
  STATE.bossFightNoDamage = true;
  STATE.hiddenBossActive = false;
  STATE.hiddenClear = false;
  STATE.usedCheat = false;
  STATE.inTutorial = true;
  STATE.tutorialStep = 0;
  
  // 추적 데이터
  TUTORIAL_TRACK = {
    movedDist: 0,
    lastX: player.x,
    lastY: player.y,
    targetsBroken: 0,
    chargedShots: 0,    // 1+ 충전 후 발사 카운트
    slashesPerformed: 0,
    chargedSlashes: 0,
    rolls: 0,
    slowMoUsed: 0,
    slowMoTimer: 0,
    prevRolling: false,
    prevSlashCharge: 0,
  };
  
  spawnInitialObstacles();
  
  // 튜토리얼용 시험 표적 (폭발 통)을 플레이어 근처에 배치 — 부수기 좋게
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const r = 320;
    const tx = player.x + Math.cos(a) * r;
    const ty = player.y + Math.sin(a) * r;
    if (typeof Obstacle === 'function') {
      const ob = new Obstacle(tx, ty, true);  // explosive = true
      obstacles.push(ob);
    }
  }
  
  // 첫 힌트
  showTutorialHint(0);
}

function showTutorialHint(stepIdx) {
  const step = TUTORIAL_STEPS[stepIdx];
  const el = document.getElementById('tutorialHint');
  if (!step || !el) return;
  document.getElementById('tutorialHintTitle').textContent = step.title;
  document.getElementById('tutorialHintText').textContent = step.text;
  document.getElementById('tutorialHintProgress').textContent = step.progress;
  el.classList.add('show');
}

function hideTutorialHint() {
  const el = document.getElementById('tutorialHint');
  if (el) el.classList.remove('show');
}

// gameLoop에서 매 프레임 호출 — 튜토리얼 진행 체크
function updateTutorial(dt) {
  if (!STATE.inTutorial || !TUTORIAL_TRACK || !player) return;
  
  // 추적 갱신
  const t = TUTORIAL_TRACK;
  const moved = Math.hypot(player.x - t.lastX, player.y - t.lastY);
  t.movedDist += moved;
  t.lastX = player.x;
  t.lastY = player.y;
  
  // 슬로우모션 사용 추적
  if (STATE.slowMo) {
    t.slowMoTimer += dt;
    if (t.slowMoTimer > 0.5) t.slowMoUsed = Math.max(t.slowMoUsed, 1);
  }
  
  // 슬라이딩 추적 (rolling false → true 전환)
  if (player.rolling && !t.prevRolling) {
    t.rolls++;
  }
  t.prevRolling = player.rolling;
  
  // 표적 부순 거: Obstacle.takeDamage 후킹에서 직접 카운트되므로 여기선 처리 안 함.
  
  // 단계 체크
  const step = TUTORIAL_STEPS[STATE.tutorialStep];
  if (step && step.check(t)) {
    STATE.tutorialStep++;
    sfx('pickup');
    if (STATE.tutorialStep >= TUTORIAL_STEPS.length) {
      // 튜토리얼 완료
      hideTutorialHint();
      finishTutorial();
    } else {
      showTutorialHint(STATE.tutorialStep);
      // 새 단계 시작 시 추가 표적/세팅
      onTutorialStepStart(STATE.tutorialStep);
    }
  }
}

function onTutorialStepStart(stepIdx) {
  // 카타나 베기 단계: 적이 약하게 공격하는 더미 추가하면 좋지만,
  // 게임플레이 단순화를 위해 그냥 계속 진행 (우클릭만 하면 통과)
  // 슬라이딩 단계: 추가 폭발 통 두 개 더 배치
  if (stepIdx === 6 && typeof Obstacle === 'function') {
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * TAU;
      const r = 280;
      obstacles.push(new Obstacle(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r, true));
    }
  }
}

// 튜토리얼 → 본 게임 (암전 후 시작)
function finishTutorial() {
  // 짧은 안내 후 암전 → 본 게임
  showTutorialHint(0);  // 임시로 마지막 힌트 갱신
  document.getElementById('tutorialHintTitle').textContent = '준비됐다';
  document.getElementById('tutorialHintText').textContent = '본격적인 임무를 시작한다.';
  document.getElementById('tutorialHintProgress').textContent = '완료';
  document.getElementById('tutorialHint').classList.add('show');
  
  setTimeout(() => {
    hideTutorialHint();
    // 암전
    const fade = document.getElementById('blackFade');
    fade.classList.add('active');
    setTimeout(() => {
      // 본 게임 상태로 전환
      STATE.inTutorial = false;
      TUTORIAL_TRACK = null;
      startGame(true);  // tutorial 직후 호출 — 부드럽게 본 게임 시작
      // 페이드 아웃
      setTimeout(() => fade.classList.remove('active'), 100);
    }, 1000);
  }, 1800);
}

// =============================================================
// startGame 수정: 튜토리얼 직후 호출되면 단순 초기화만
// =============================================================
const _origStartGame = startGame;
// (위 startGame 함수는 이미 정의돼 있고 이 시점에서 우리가 다시 정의하지 않음.
//  대신 인자가 있을 때 흐름 분기를 추가하기 위해 startGame 정의를 직접 못 건드리니,
//  여기서 startBtn 핸들러는 startGame 만 호출하면 됨.
//  finishTutorial 에서는 startGame() 호출 → 튜토리얼 플래그가 false 라면 정상 흐름)

// =============================================================
// BOSS CUTSCENE
// =============================================================
// 보스별 대사. 확장 가능한 구조 — 한 줄 더 넣고 싶으면 배열에 push.
// portrait: 이미지 경로. 없으면 빈 문자열 또는 null
// side: 'right' = 보스, 'left' = 플레이어
const BOSS_CUTSCENES = {
  // 페이즈 1: 백규
  1: [
    { side: 'right', name: '백규', text: '여기까지 들어온 놈은 처음이군.', portrait: 'images/boss1_baekgyu.png' },
    { side: 'left',  name: '사마엘', text: '샘플 어딨어. 곱게 내놓으면 살려두지.', portrait: 'images/standing.png' },
    { side: 'right', name: '백규', text: '하하, 농담은.\n일단 죽여서 끌어낼까.', portrait: 'images/boss1_baekgyu.png' },
  ],
  // 페이즈 2: 크랙슨
  2: [
    { side: 'right', name: '크랙슨', text: '—백규를 죽인 놈이 너냐.', portrait: 'images/boss2_crackson.png' },
    { side: 'left',  name: '사마엘', text: '이번에는 또 두툼한 놈이 나왔군', portrait: 'images/standing.png' },
    { side: 'right', name: '크랙슨', text: '...좋아, 비명지르면서도 배짱이 살아있나 볼까.', portrait: 'images/boss2_crackson.png' },
  ],
  // 페이즈 3: 리퍼
  3: [
    { side: 'right', name: '리퍼', text: '...너, 참진리연구회구나.', portrait: 'images/boss3_reaper.png' },
    { side: 'left',  name: '사마엘', text: '샘플 내놔.', portrait: 'images/standing.png' },
    { side: 'right', name: '리퍼', text: '진리를 독점하려는 네놈들의 수작은 끝났다.', portrait: 'images/boss3_reaper.png' },
    { side: 'right', name: '리퍼', text: '샘플은 이미 사용됐어.\n계속 남아있으면 죽을 뿐이야.', portrait: 'images/boss3_reaper.png' },
  ],
  // 페이즈 4: CP-09
  4: [
    { side: 'right', name: 'CP-09', text: '—적성 식별. 참진리 연구회 회수요원.\n위협등급 갱신: 최상.', portrait: 'images/boss4_cp09.png' },
    { side: 'left',  name: '사마엘', text: '기계인가. 그쪽이 더 깔끔하겠군.', portrait: 'images/standing.png' },
    { side: 'right', name: 'CP-09', text: '너 지금 정말 **핵심**을 짚었어.\n제거 절차 개시.', portrait: 'images/boss4_cp09.png' },
  ],
  // 페이즈 5: 제미네이터 (최종 보스)
  5: [
    { side: 'right', name: '제미네이터', text: '여기까지 왔나, 광신도.', portrait: 'images/boss5_geminator.png' },
    { side: 'left',  name: '사마엘', text: '네녀석이 마지막인가? \n슬슬 지겹군.', portrait: 'images/standing.png' },
    { side: 'right', name: '제미네이터', text: '\"진리\"는 독점할 수 있는게 아니야.\n우주는 모두에게 열려 있어야지.', portrait: 'images/boss5_geminator.png' },
    { side: 'left',  name: '사마엘', text: '너희 같은 무지렁이들이 진리를 들여다보면\n그건 진리가 아니라 재앙이 될걸.', portrait: 'images/standing.png' },
    { side: 'right', name: '제미네이터', text: '과연 그럴까? 한번 진리의 힘을 시험해보자고.', portrait: 'images/boss5_geminator.png' },
  ],
  // 히든 보스: 테레사
  hidden: [
    { side: 'left',  name: '사마엘', text: '...너는 누구지?.', portrait: 'images/standing.png' },
    { side: 'right', name: '테레사', text: '이 지역은 이제 중앙에서 관리한다. 연구회.', portrait: 'images/boss6_teresa.png' },
    { side: 'left',  name: '사마엘', text: '이건 연구회 일이야. 중앙은 개입하면 안될텐데.', portrait: 'images/standing.png' },
    { side: 'right', name: '테레사', text: '샘플 666번은 해적들 손에 둘수도, 광신도들 손에 둘 수 없다\n죽고 싶지 않으면 조용히 물러나라.', portrait: 'images/boss6_teresa.png' },
    { side: 'left',  name: '사마엘', text: '누가 죽는지 확인해볼까.', portrait: 'images/standing.png' },
    { side: 'right', name: '테레사', text: '어리석기는. \n애초에 네 능력이 어디서 기원했는지 모르는구나.', portrait: 'images/boss6_teresa.png' },
    { side: 'right', name: '테레사', text: '덤벼라, 카피캣. 귀여워 해주마.', portrait: 'images/boss6_teresa.png' },
  ],
};

function playBossCutscene(level, onDone) {
  const lines = BOSS_CUTSCENES[level];
  if (!lines || !lines.length) {
    if (onDone) onDone();
    return;
  }
  playDialogue(lines, 'bossCutscene', onDone);
}

// =============================================================
// gameLoop 안에서 튜토리얼 진행 체크
// =============================================================
// gameLoop의 update() 호출 후에 튜토리얼 추적 함수가 돌아가도록 후킹.
// gameLoop는 STATE.inStory/inBossCutscene 시 update를 호출하지 않음 (위 분기 참고).
const _origUpdate = update;
// eslint-disable-next-line no-func-assign
update = function(dt) {
  _origUpdate(dt);
  if (STATE.inTutorial) updateTutorial(dt);
};

// 튜토리얼 중에는 보스 자동 트리거 무시 — STATE.bossActive 를 true 로 두면 됨 (이미 startTutorial 에서 함)
// 또한 페이즈 0 (튜토리얼)에서 자동 보스 트리거 안 됨

// 추적: 충전샷 발사 카운트, 카타나 휘두르기/충전 카타나 카운트
// player.releaseShoot/releaseSlash를 후킹.
(function patchPlayerForTutorial() {
  // 클래스가 정의된 시점에 prototype 메서드를 후킹.
  if (typeof Player !== 'function') return;
  const _origReleaseShoot = Player.prototype.releaseShoot;
  Player.prototype.releaseShoot = function(...args) {
    const wasMulti = this.charged >= 2;
    const prevFireCd = this.fireCooldown;
    const ret = _origReleaseShoot.apply(this, args);
    // 실제로 발사됐는지 — fireCooldown 이 갱신됐으면 발사된 것.
    const fired = this.fireCooldown !== prevFireCd && this.fireCooldown > 0;
    if (STATE.inTutorial && TUTORIAL_TRACK && wasMulti && fired) {
      TUTORIAL_TRACK.chargedShots++;
    }
    return ret;
  };
  const _origReleaseSlash = Player.prototype.releaseSlash;
  Player.prototype.releaseSlash = function(...args) {
    const wasStage = this.slashCharge;
    const prevCd = this.slashCooldown;
    const ret = _origReleaseSlash.apply(this, args);
    // 실제로 슬래시가 발생했는지: slashCooldown 이 길게(>= 0.2s) 갱신되면 휘두른 것.
    // 헛스윙(배터리 부족)은 0.15s 만 걸리고, 쿨다운 중일 땐 변화 없음.
    const slashed = this.slashCooldown >= 0.2 && this.slashCooldown !== prevCd;
    if (STATE.inTutorial && TUTORIAL_TRACK && slashed) {
      TUTORIAL_TRACK.slashesPerformed++;
      if (wasStage >= 2) TUTORIAL_TRACK.chargedSlashes++;
    }
    return ret;
  };
})();

// Obstacle 후킹 — takeDamage 시 dead 가 되는 순간 표적 카운트.
// updateTutorial 에서 obstacles 배열을 검사하면 이미 filter로 제거된 후라 늦음 → 직접 후킹.
(function patchObstacleForTutorial() {
  if (typeof Obstacle !== 'function') return;
  const _origObTakeDamage = Obstacle.prototype.takeDamage;
  Obstacle.prototype.takeDamage = function(d) {
    const wasAlive = !this.dead;
    _origObTakeDamage.apply(this, arguments);
    if (STATE.inTutorial && TUTORIAL_TRACK && wasAlive && this.dead) {
      TUTORIAL_TRACK.targetsBroken++;
    }
  };
})();

// =============================================================
// startGame 보강: 튜토리얼 종료 후 호출되면 인트로 알림 띄우고 시작
// =============================================================
// (인자 fromTutorial 은 startGame 원본은 모르지만, 일단 그냥 무시해도 동작 OK)

// =============================================================
// 점수 / 랭킹 시스템 (게임오버, 엔딩, 타이틀 화면)
// =============================================================
// 점수 산식:
//   • 잡몹 처치        : 30 / kill
//   • 보스 처치        : 5000 / boss
//   • 도달 페이즈      : 2000 × (phase - 1)
//   • 누적 획득 BTC    : 2 × totalEarned
//   • 생존 시간        : 10 × seconds
//   • 클리어 보너스    : ended 면 +20000
//   • 노데스 보너스    : 목숨이 처음 그대로면 +5000
//
// 등급 (S/A/B/C/D) 는 총점 기준
// 좌측: 전대 랭킹 기록 (localStorage 에 최대 10개), 우측: 현재 결과
// 타이틀 화면에도 좌측에 랭킹 표시

// =====================
// localStorage 랭킹 저장소
// =====================
const RANKING_KEY = 'shotgunKatanaRanking_v1';
const RANKING_NAME_KEY = 'shotgunKatanaPlayerName_v1';
const RANKING_MAX_ENTRIES = 10;
const SUPABASE_URL = 'https://ptpqqpjducalfdvevota.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZShTNM3ZXPwYUKQVrgacag_VmNJk4_6';
const SUPABASE_RANKING_TABLE = 'sk_rankings';
const SUPABASE_RANKING_ENABLED = true;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function normalizePlayerName(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
  return cleaned || 'PLAYER';
}

function getPlayerName() {
  try {
    const saved = normalizePlayerName(localStorage.getItem(RANKING_NAME_KEY));
    if (saved && saved !== 'PLAYER') return saved;
    const typed = prompt('랭킹에 올릴 닉네임을 입력하세요', saved || 'PLAYER');
    const name = normalizePlayerName(typed);
    localStorage.setItem(RANKING_NAME_KEY, name);
    return name;
  } catch (e) {
    return 'PLAYER';
  }
}

function toSupabaseRankingEntry(entry) {
  return {
    player_name: entry.playerName || 'PLAYER',
    rank: entry.rank,
    total: entry.total,
    kills: entry.kills,
    boss_kills: entry.bossKills,
    earned: entry.earned,
    phase: entry.phase,
    survived_sec: entry.survivedSec,
    cleared: !!entry.cleared,
    difficulty: normalizeDifficultyKey(entry.difficulty),
    client_run_id: entry.clientRunId || entry.date,
    created_at: entry.date,
  };
}

function fromSupabaseRankingEntry(row) {
  return {
    playerName: row.player_name || 'PLAYER',
    rank: row.rank,
    total: row.total || 0,
    kills: row.kills || 0,
    bossKills: row.boss_kills || 0,
    earned: row.earned || 0,
    phase: row.phase || 1,
    survivedSec: row.survived_sec || 0,
    cleared: !!row.cleared,
    difficulty: normalizeDifficultyKey(row.difficulty || 'normal'),
    date: row.created_at || new Date().toISOString(),
    clientRunId: row.client_run_id || '',
    remote: true,
  };
}

async function fetchServerRanking() {
  if (!SUPABASE_RANKING_ENABLED || typeof fetch !== 'function') return null;
  
  const requestRanking = async (withDifficulty) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${SUPABASE_RANKING_TABLE}`);
    const fields = withDifficulty
      ? 'player_name,rank,total,kills,boss_kills,earned,phase,survived_sec,cleared,difficulty,created_at,client_run_id'
      : 'player_name,rank,total,kills,boss_kills,earned,phase,survived_sec,cleared,created_at,client_run_id';
    url.searchParams.set('select', fields);
    url.searchParams.set('order', 'total.desc,survived_sec.desc,created_at.asc');
    url.searchParams.set('limit', String(RANKING_MAX_ENTRIES));
    return fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
  };
  
  let res = await requestRanking(true);
  if (!res.ok) res = await requestRanking(false);
  if (!res.ok) throw new Error(`ranking fetch failed: ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map(fromSupabaseRankingEntry) : [];
}

async function saveServerRankingEntry(entry) {
  if (!SUPABASE_RANKING_ENABLED || typeof fetch !== 'function') return null;
  const payload = toSupabaseRankingEntry(entry);
  let res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_RANKING_TABLE}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok && payload.difficulty) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.difficulty;
    res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_RANKING_TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(fallbackPayload),
    });
  }
  if (!res.ok) throw new Error(`ranking save failed: ${res.status}`);
  return fetchServerRanking();
}

async function loadRankingOnline() {
  try {
    const serverRanking = await fetchServerRanking();
    if (serverRanking) return { ranking: serverRanking, source: 'server' };
  } catch (e) {
    console.warn('[ranking] server load failed, using local ranking', e);
  }
  return { ranking: loadRanking(), source: 'local' };
}

async function saveRankingEntryOnline(entry) {
  const localRanking = saveRankingEntry(entry);
  try {
    const serverRanking = await saveServerRankingEntry(entry);
    if (serverRanking) return { ranking: serverRanking, source: 'server' };
  } catch (e) {
    console.warn('[ranking] server save failed, using local ranking', e);
  }
  return { ranking: localRanking, source: 'local' };
}

function loadRanking() {
  try {
    const raw = localStorage.getItem(RANKING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    return [];
  }
}

function saveRankingEntry(entry) {
  try {
    const list = loadRanking();
    list.push(entry);
    list.sort((a, b) => b.total - a.total);
    const trimmed = list.slice(0, RANKING_MAX_ENTRIES);
    localStorage.setItem(RANKING_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch (e) {
    return [];
  }
}

// =====================
// 점수 계산
// =====================
function computeFinalScore() {
  const survivedSec = Math.floor(STATE.time);
  const kills = STATE.kills || 0;
  const bossKills = STATE.bossKills || 0;
  const earned = STATE.totalEarned || 0;
  const phase = STATE.maxPhaseReached || 1;
  const lives = (player && player.lives) || 0;
  const maxLives = (player && player.maxLives) || 3;
  
  const breakdown = {
    kills:      kills * 30,
    bossKills:  bossKills * 5000,
    phase:      Math.max(0, (phase - 1)) * 2000,
    earned:     earned * 2,
    survival:   survivedSec * 10,
    clearBonus: STATE.ended ? 20000 : 0,
    noDeath:    (!STATE.gameOver && lives === maxLives) ? 5000 : 0,
    hiddenClear: STATE.hiddenClear ? 50000 : 0,  // 히든 보스(테레사) 처치 특별 점수
  };
  const rawTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const difficulty = normalizeDifficultyKey(STATE.difficulty);
  const difficultyMultiplier = difficultyScoreMultiplier(difficulty);
  const total = Math.round(rawTotal * difficultyMultiplier);
  
  let rank = 'D';
  if (total >= 80000) rank = 'S';
  else if (total >= 50000) rank = 'A';
  else if (total >= 25000) rank = 'B';
  else if (total >= 10000) rank = 'C';
  
  return {
    survivedSec, kills, bossKills, earned, phase,
    breakdown, rawTotal, total, rank,
    cleared: STATE.ended,
    difficulty,
    difficultyMultiplier,
    date: new Date().toISOString(),
  };
}

const RANK_COLORS = {
  'S': '#ffcc00',
  'A': '#ff8800',
  'B': '#00d4ff',
  'C': '#88aa88',
  'D': '#888',
};

function fmtNum(n) { return Number(n).toLocaleString(); }
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// =====================
// 현재 결과 (우측) 패널 HTML
// =====================
function buildResultPanelHTML(result) {
  const rankColor = RANK_COLORS[result.rank] || '#fff';
  const b = result.breakdown;
  const rows = [
    ['처치 수',     `${result.kills}`,           `+${fmtNum(b.kills)}`],
    ['보스 처치',   `${result.bossKills}`,       `+${fmtNum(b.bossKills)}`],
    ['도달 페이즈', `${result.phase}`,           `+${fmtNum(b.phase)}`],
    ['누적 획득',   `₿ ${fmtNum(result.earned)}`,`+${fmtNum(b.earned)}`],
    ['생존 시간',   fmtTime(result.survivedSec), `+${fmtNum(b.survival)}`],
  ];
  if (b.clearBonus > 0) rows.push(['클리어 보너스', '★', `+${fmtNum(b.clearBonus)}`]);
  if (b.noDeath > 0)    rows.push(['NO DEATH', '♥♥♥', `+${fmtNum(b.noDeath)}`]);
  if (b.hiddenClear > 0) rows.push(['히든 클리어', '테레사 처치', `+${fmtNum(b.hiddenClear)}`]);
  if (result.difficultyMultiplier && result.difficultyMultiplier !== 1) {
    rows.push(['난이도 보정', difficultyLabel(result.difficulty), `x${result.difficultyMultiplier}`]);
  }
  
  let rowsHTML = '';
  for (const [label, val, pts] of rows) {
    rowsHTML += `
      <div class="score-row">
        <span class="score-label">${label}</span>
        <span class="score-value">${val}</span>
        <span class="score-points">${pts}</span>
      </div>`;
  }
  
  return `
    <div class="result-panel">
      <div class="panel-header">결과</div>
      <div class="score-rank" style="color:${rankColor}; text-shadow: 0 0 20px ${rankColor};">${result.rank}</div>
      <div class="score-rank-label">RANK</div>
      <div class="score-rows">${rowsHTML}</div>
      <div class="score-total">
        <span class="score-total-label">TOTAL</span>
        <span class="score-total-value">${fmtNum(result.total)}</span>
      </div>
    </div>
  `;
}

// =====================
// 전대 랭킹 (좌측) 패널 HTML
// highlightIdx: 방금 추가된 엔트리 인덱스 (강조)
// =====================
function buildRankingPanelHTML(ranking, highlightIdx) {
  if (!ranking || ranking.length === 0) {
    return `
      <div class="ranking-panel">
        <div class="panel-header">전대 랭킹</div>
        <div class="ranking-empty">아직 기록이 없습니다.</div>
      </div>
    `;
  }
  
  let rowsHTML = '';
  for (let i = 0; i < ranking.length; i++) {
    const r = ranking[i];
    const rankColor = RANK_COLORS[r.rank] || '#fff';
    const cls = (i === highlightIdx) ? 'rank-row highlight' : 'rank-row';
    const cleared = r.cleared ? ' <span class="cleared-mark">★</span>' : '';
    const playerName = escapeHTML(r.playerName || 'PLAYER');
    const diffKey = normalizeDifficultyKey(r.difficulty);
    const diffLabel = escapeHTML(difficultyLabel(diffKey));
    rowsHTML += `
      <div class="${cls}">
        <span class="rank-pos">${i + 1}</span>
        <span class="rank-grade" style="color:${rankColor};">${r.rank}</span>
        <span class="rank-stats">
          <span class="rank-total">${fmtNum(r.total)} <span class="rank-name">${playerName}</span></span>
          <span class="rank-meta"><span class="rank-difficulty difficulty-${diffKey}">${diffLabel}</span> · P${r.phase} · ${fmtTime(r.survivedSec)} · K${r.kills}${cleared}</span>
        </span>
      </div>`;
  }
  
  return `
    <div class="ranking-panel">
      <div class="panel-header">전대 랭킹 TOP ${ranking.length}</div>
      <div class="ranking-list">${rowsHTML}</div>
    </div>
  `;
}

// =====================
// CSS 주입 (한 번만)
// =====================
function ensureScoreboardCSS() {
  if (document.getElementById('scoreboardStyle')) return;
  const style = document.createElement('style');
  style.id = 'scoreboardStyle';
  style.textContent = `
    .scoreboard-wrap {
      display: flex;
      gap: 24px;
      justify-content: center;
      align-items: flex-start;
      flex-wrap: wrap;
      margin: 20px auto;
      max-width: 1100px;
      padding: 0 12px;
      box-sizing: border-box;
    }
    .ranking-panel, .result-panel {
      flex: 1 1 360px;
      min-width: 320px;
      max-width: 480px;
      padding: 22px 26px;
      background: rgba(0,0,0,0.72);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 4px;
      color: #eee;
      letter-spacing: 0.5px;
      box-sizing: border-box;
      box-shadow: 0 0 24px rgba(0,0,0,0.5);
      backdrop-filter: blur(2px);
    }
    .panel-header {
      font-size: 12px;
      letter-spacing: 6px;
      color: #888;
      text-align: center;
      margin-bottom: 14px;
      text-transform: uppercase;
    }
    /* 결과 패널 */
    .score-rank {
      text-align: center;
      font-size: 88px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -2px;
    }
    .score-rank-label {
      text-align: center;
      font-size: 12px;
      color: #888;
      letter-spacing: 6px;
      margin-bottom: 16px;
    }
    .score-rows {
      border-top: 1px solid rgba(255,255,255,0.08);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      padding: 8px 0;
    }
    .score-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 16px;
      padding: 6px 4px;
      font-size: 14px;
      align-items: baseline;
    }
    .score-label  { color: #999; }
    .score-value  { color: #fff; font-weight: 600; min-width: 60px; text-align: right; }
    .score-points { color: #ffcc00; font-weight: 700; min-width: 80px; text-align: right; }
    .score-total {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-top: 14px;
      padding-top: 4px;
    }
    .score-total-label {
      font-size: 13px;
      color: #888;
      letter-spacing: 4px;
    }
    .score-total-value {
      font-size: 30px;
      font-weight: 900;
      color: #ffcc00;
      text-shadow: 0 0 16px rgba(255,204,0,0.6);
    }
    /* 랭킹 패널 */
    .ranking-empty {
      color: #666;
      text-align: center;
      padding: 40px 0;
      font-size: 13px;
    }
    .ranking-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .rank-row {
      display: grid;
      grid-template-columns: 36px 36px 1fr;
      gap: 10px;
      padding: 8px 6px;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 13px;
    }
    .rank-row.highlight {
      background: rgba(255,204,0,0.10);
      border: 1px solid rgba(255,204,0,0.5);
      box-shadow: 0 0 12px rgba(255,204,0,0.25);
    }
    .rank-pos {
      color: #777;
      font-weight: 700;
      text-align: right;
    }
    .rank-grade {
      font-weight: 900;
      font-size: 18px;
      text-align: center;
    }
    .rank-stats {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .rank-total {
      color: #ffcc00;
      font-weight: 700;
      font-size: 15px;
    }
    .rank-name {
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
      letter-spacing: 0.5px;
    }
    .rank-difficulty {
      display: inline-block;
      padding: 1px 6px;
      border: 1px solid #fff;
      border-radius: 3px;
      line-height: 1.3;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-shadow: 0 0 6px rgba(0,0,0,0.7);
    }
    .rank-difficulty.difficulty-hero {
      color: #fff;
      background: rgba(255,255,255,0.08);
      box-shadow: 0 0 8px rgba(255,255,255,0.22);
    }
    .rank-difficulty.difficulty-normal {
      color: #ff9d2e;
      background: rgba(255,140,32,0.14);
      box-shadow: 0 0 8px rgba(255,140,32,0.3);
    }
    .rank-difficulty.difficulty-dystopia {
      color: #d36cff;
      background: rgba(160,70,255,0.16);
      box-shadow: 0 0 8px rgba(190,90,255,0.35);
    }
    .ranking-source {
      margin-top: 10px;
      text-align: center;
      font-size: 11px;
      color: #777;
      letter-spacing: 2px;
    }
    .rank-meta {
      color: #888;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .cleared-mark {
      color: #ffcc00;
      margin-left: 4px;
    }
    /* 타이틀 화면 랭킹 (좌측, 작게) */
    .title-ranking {
      position: absolute;
      left: 24px;
      top: 50%;
      transform: translateY(-50%);
      width: 320px;
      max-width: 32vw;
      max-height: 72vh;
      overflow-y: auto;
      padding: 18px 20px;
      background: rgba(0,0,0,0.72);
      border: 1px solid rgba(255,204,0,0.25);
      border-radius: 4px;
      color: #eee;
      /* titleScreen 의 ::before/::after (z 1, 2) 보다 위 */
      z-index: 10;
      pointer-events: auto;
      box-shadow: 0 0 24px rgba(0,0,0,0.6);
      backdrop-filter: blur(2px);
    }
    .title-ranking .panel-header {
      color: #ffcc00;
      margin-bottom: 10px;
    }
    .title-ranking .rank-row { font-size: 12px; padding: 6px 4px; }
    .title-ranking .rank-grade { font-size: 16px; }
    .title-ranking .rank-total { font-size: 13px; }
    @media (max-width: 900px) {
      .title-ranking { display: none; }
      .scoreboard-wrap { flex-direction: column; align-items: center; }
    }
  `;
  document.head.appendChild(style);
}

// =====================
// 게임오버 / 엔딩 화면 점수판 삽입
// =====================
let _scoreSavedThisRun = false;  // 같은 죽음에서 두 번 저장 방지
function resetScoreSaveFlag() { _scoreSavedThisRun = false; }

async function injectScoreboard(screenId) {
  ensureScoreboardCSS();
  const screen = document.getElementById(screenId);
  if (!screen) return;
  
  const result = computeFinalScore();
  const old = screen.querySelector('.scoreboard-wrap');
  if (old) old.remove();
  
  const wrap = document.createElement('div');
  wrap.className = 'scoreboard-wrap';
  wrap.innerHTML =
    buildRankingPanelHTML([], -1) +
    buildResultPanelHTML(result);
  
  const btn = screen.querySelector('button, .btn, [data-restart], [data-action]');
  if (btn && btn.parentElement) {
    btn.parentElement.insertBefore(wrap, btn);
  } else {
    const inner = screen.querySelector('.modal, .content, .panel, .inner') || screen;
    inner.appendChild(wrap);
  }
  
  // 랭킹 저장 (같은 런 1회만)
  let rankingResult;
  let highlightIdx = -1;
  if (STATE.usedCheat) {
    _scoreSavedThisRun = true;
    rankingResult = await loadRankingOnline();
  } else if (!_scoreSavedThisRun) {
    _scoreSavedThisRun = true;
    result.playerName = getPlayerName();
    result.clientRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    rankingResult = await saveRankingEntryOnline({
      playerName: result.playerName,
      rank: result.rank,
      total: result.total,
      kills: result.kills,
      bossKills: result.bossKills,
      earned: result.earned,
      phase: result.phase,
      survivedSec: result.survivedSec,
      cleared: result.cleared,
      difficulty: result.difficulty,
      date: result.date,
      clientRunId: result.clientRunId,
    });
    highlightIdx = rankingResult.ranking.findIndex(r => r.clientRunId === result.clientRunId || r.date === result.date);
  } else {
    rankingResult = await loadRankingOnline();
  }
  
  wrap.innerHTML =
    buildRankingPanelHTML(rankingResult.ranking, highlightIdx) +
    buildResultPanelHTML(result);
  const panel = wrap.querySelector('.ranking-panel');
  if (panel) {
    const source = rankingResult.source === 'server' ? 'ONLINE RANKING' : 'LOCAL RANKING';
    const suffix = STATE.usedCheat ? ' · CHEAT RUN NOT SAVED' : '';
    panel.insertAdjacentHTML('beforeend', `<div class="ranking-source">${source}${suffix}</div>`);
  }
}

// =====================
// 게임오버 / 엔딩 화면 표시 후킹
// =====================
(function hookEndScreens() {
  function tryHook() {
    const goEl = document.getElementById('gameOverScreen');
    const endEl = document.getElementById('endingScreen');
    if (!goEl && !endEl) {
      setTimeout(tryHook, 200);
      return;
    }
    if (goEl) {
      const obs = new MutationObserver(() => {
        if (goEl.classList.contains('show')) injectScoreboard('gameOverScreen');
        else { /* 화면 숨겨질 때 */ }
      });
      obs.observe(goEl, { attributes: true, attributeFilter: ['class'] });
    }
    if (endEl) {
      const obs2 = new MutationObserver(() => {
        if (endEl.classList.contains('show')) injectScoreboard('endingScreen');
      });
      obs2.observe(endEl, { attributes: true, attributeFilter: ['class'] });
    }
  }
  tryHook();
})();

// =====================
// 타이틀 화면 랭킹 표시
// =====================
async function renderTitleRanking() {
  ensureScoreboardCSS();
  const titleScreen = document.getElementById('titleScreen');
  if (!titleScreen) return;
  
  // 기존 패널 갱신/생성
  let panel = titleScreen.querySelector('.title-ranking');
  
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'title-ranking';
    titleScreen.appendChild(panel);
  }
  panel.innerHTML = buildRankingPanelHTML([], -1);
  const rankingResult = await loadRankingOnline();
  panel.innerHTML = buildRankingPanelHTML(rankingResult.ranking, -1);
  const source = rankingResult.source === 'server' ? 'ONLINE RANKING' : 'LOCAL RANKING';
  panel.insertAdjacentHTML('beforeend', `<div class="ranking-source">${source}</div>`);
}

// 타이틀 화면 표시 시점에 랭킹 갱신
(function hookTitleRanking() {
  function tryHook() {
    const titleEl = document.getElementById('titleScreen');
    if (!titleEl) {
      setTimeout(tryHook, 200);
      return;
    }
    // 초기 렌더 (페이지 로드 시 타이틀이 이미 떠 있음)
    renderTitleRanking();
    // 타이틀이 다시 표시될 때(예: display none → block)도 갱신
    const obs = new MutationObserver(() => {
      const visible = (titleEl.style.display !== 'none')
        && !titleEl.classList.contains('hidden');
      if (visible) renderTitleRanking();
    });
    obs.observe(titleEl, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  tryHook();
})();

// 게임 시작/재시작 시 점수 저장 플래그 리셋
const _origStartGameForScore = (typeof startGame === 'function') ? startGame : null;
if (_origStartGameForScore) {
  // eslint-disable-next-line no-func-assign
  startGame = function(...args) {
    resetScoreSaveFlag();
    return _origStartGameForScore.apply(this, args);
  };
}

requestAnimationFrame(gameLoop);
