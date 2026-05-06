# 에셋 교체 가이드 (이미지 / BGM / 효과음 / 적·보스·아이템)

## ⚠️ 가장 중요한 사항: 로컬 서버에서 실행하세요!

`index.html` 을 더블클릭으로 열면 (`file://` 프로토콜) 브라우저가 보안상 이미지·오디오 파일 로드를 차단합니다.

```bash
python -m http.server 8000
```
→ 브라우저에서 `http://localhost:8000` 접속.

---

## 🖼️ 이미지 교체 — 전체 목록

`images/` 폴더에 아래 파일명으로 PNG 를 넣으면 자동 적용됩니다. **파일이 없으면 기존 도형 렌더링이 그대로 작동**하므로 필요한 것만 추가하면 됩니다.

### 🎮 캐릭터 (애니메이션 가능)
| 파일명 | 권장 크기 | 용도 |
|---|---|---|
| `player_idle.png` | 64×64 (스프라이트 시트로 N×64 가능) | 플레이어 대기 |
| `player_move.png` | 64×64 (스프라이트 시트로 N×64 가능) | 플레이어 이동 |
| `player_shoot.png` | 64×64 | 플레이어 사격 |
| `player_slash.png` | 64×64 | 플레이어 칼 휘두름 |
| `standing.png` | 300×480 | 우하단 스탠딩 CG |
| `title.png` | 자유 | 타이틀 (현재 미사용) |

(애니메이션 추가는 `ANIMATION_GUIDE.md` 참고)

### 👹 일반 적 (5종)
| 파일명 | 권장 크기 | 적 종류 |
|---|---|---|
| `enemy_rusher.png` | 36×36 | 빨강, 돌진형 (HP 1) |
| `enemy_shooter.png` | 32×32 | 주황, 원거리 사격 (HP 1) |
| `enemy_shielder.png` | 50×50 | 회색, 방패병 (HP 10 + 방패 10) |
| `enemy_assassin.png` | 36×36 | 핑크, 빠른 돌진 (HP 1) |
| `enemy_sniper.png` | 32×32 | 노랑, 저격 (HP 1) |

### 👑 보스 (5종)
| 파일명 | 권장 크기 | 보스 |
|---|---|---|
| `boss_baekgyu.png` | 64×64 | 백규 (1단계) |
| `boss_crackson.png` | 90×90 | 크랙슨 (2단계) |
| `boss_reaper.png` | 56×56 | 리퍼 (3단계) |
| `boss_cp09.png` | 80×80 | CP-09 (4단계) |
| `boss_geminator.png` | 140×140 | 제미네이터 (5단계, 약점은 코드로 추가 표시) |

### 💎 아이템 (3종)
| 파일명 | 권장 크기 | 아이템 |
|---|---|---|
| `pickup_ammo.png` | 28×28 | 탄약 (노랑) |
| `pickup_btc.png` | 28×28 | BTC (주황) |
| `pickup_battery.png` | 28×28 | 배터리 (시안) |

### 🧱 장애물 (2종)
| 파일명 | 권장 크기 | 장애물 |
|---|---|---|
| `obstacle_wall.png` | 가변 (자동 스트레치) | 벽 (회색) |
| `obstacle_explosive.png` | 가변 (자동 스트레치) | 폭발물 (빨강) |

### 🌐 필드/배경 (1종)
| 파일명 | 권장 크기 | 모드 |
|---|---|---|
| `field.png` | 256×256 (타일 모드 권장) | 게임 필드 바닥 |

`game.js` 의 `ENTITY_IMAGES.field` 에서 동작 모드 변경 가능:
```javascript
field: { src: 'images/field.png', mode: 'tile', tileSize: 256, ... },
```
- `mode: 'tile'` = 같은 이미지를 반복 타일링 (작은 이미지에 적합)
- `mode: 'stretch'` = 월드 전체(3000×3000)를 이미지 한 장으로 채움 (큰 이미지에 적합)
- `tileSize` = 타일 한 장의 표시 크기 (px). 작게 하면 더 촘촘히 반복됨.

이미지가 없으면 기존의 다크 그라데이션 + 빨간 그리드가 그대로 표시됩니다.

### 🛸 기타
| 파일명 | 권장 크기 | 용도 |
|---|---|---|
| `drone.png` | 24×24 | 라이브러리안 드론 |
| `bombardment.png` | 가변 | CP-09/제미네이터의 포격 경고 마커 |

---

## 🎨 이미지 사이즈 조정

`game.js` 의 `ENTITY_IMAGES` 객체에서 각 항목의 `size` 값을 조정할 수 있습니다:

```javascript
const ENTITY_IMAGES = {
  enemy_rusher: { src: 'images/enemy_rusher.png', size: 36, rotate: true, flip: false },
  //                                              ↑ 표시 크기 (px). 더 크게/작게 가능
  ...
};
```

- `size: 0` 으로 하면 장애물의 경우 실제 직사각형 크기에 맞춰 늘어납니다.
- `rotate: true` = 적이 향하는 방향으로 이미지 회전.
- `rotate: false` = 항상 같은 방향으로 표시 (아이템처럼).

---

## 💡 디자인 팁

### 적/보스 이미지 방향
**탑다운 시점**이고 적은 마우스/플레이어 방향으로 회전합니다. 따라서 이미지의 **위쪽이 적의 정면(앞)** 이 되도록 그리세요.
- ✅ 위쪽 = 머리/총구 방향
- ❌ 옆에서 본 모습 (회전 시 어색)

### 아이템 이미지
회전 안 하고 위아래 보브(살짝 흔들림)만 적용됩니다. 정사각형 + 가운데 정렬.

### 장애물 이미지
가변 크기로 늘어나기 때문에 **타일링 가능한** 텍스처(예: 벽돌, 금속판) 가 가장 잘 어울립니다. 또는 가운데 1개 오브젝트 + 투명 패딩.

### 폭발물
빨간 펄스가 위에 깜빡이게 그려지므로, 이미지는 **너무 빨갛지 않게** 만드는 게 가시성 좋음.

---

## 🎵 BGM 교체

`sounds/bgm.mp3` 파일을 넣으세요. 끝.

다른 경로 쓰려면 `game.js` ~117번째 줄:
```javascript
const BGM_FILE = 'sounds/bgm.mp3';
const BGM_VOLUME = 0.4;
```

빈 문자열로 하면 절차생성 헤비메탈로 폴백.

---

## 🔊 효과음 교체

`game.js` ~130번째 줄의 `SFX_FILES`:
```javascript
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
```

활성화하고 싶은 것만 주석을 풀고 파일 추가. 나머지는 절차생성으로 작동.

---

## 🐞 디버깅

F12 → Console 에서 확인할 로그:
- `[ENT] Loaded: images/enemy_rusher.png (...)` — 정상 로드
- `[ANIM] Loaded: walk (...)` — 캐릭터 애니메이션 로드
- `[IMG] Loaded: images/standing.png (...)` — 스탠딩 CG 로드

로그가 없거나 404 오류가 뜨면:
1. 파일명/경로 정확한지 확인 (대소문자 구분)
2. **로컬 서버**로 실행 중인지 확인
3. **Ctrl+Shift+R** 강력 새로고침

엔티티 이미지가 로드 실패해도 콘솔에 경고가 뜨지 않게 처리했습니다 (선택사항이라). 정상 로드된 것만 `[ENT] Loaded:` 로그가 뜹니다.
