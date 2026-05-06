# 캐릭터 애니메이션 가이드

## 현재 상태

✅ 업로드해주신 4장의 이미지가 적용되었습니다 (배경 자동 투명화 처리).
✅ 프레임 애니메이션 시스템이 구축되어 있습니다.
✅ 좌우 반전 (마우스 좌/우) 적용됨.
✅ 살아있는 느낌을 위한 절차적 효과 추가:
- idle 시 위아래 호흡 보브 (±1.5px, 4Hz)
- walk 시 위아래 보브 (-2px, 14Hz)
- shoot 시 뒤로 밀리는 반동
- slash 시 anim 길이 0.32초로 늘려 액션 시간 확보

지금은 모든 상태가 1프레임이지만, 시스템은 N프레임을 지원합니다.

---

## 프레임 애니메이션 추가 방법

### 옵션 1: 스프라이트 시트 (추천)

한 장의 PNG에 프레임을 가로로 나열합니다. 예시:

**예: walk 4프레임 애니메이션**
1. `player_move.png` 를 가로 256×64 (= 64×64 프레임 4개) 로 만들기
2. `game.js` 에서 `ANIMATIONS.walk.frameCount` 를 `4` 로 변경:

```javascript
const ANIMATIONS = {
  idle:  { src: 'images/player_idle.png',  frameW: 64, frameH: 64, frameCount: 1, fps: 4,  loop: true  },
  walk:  { src: 'images/player_move.png',  frameW: 64, frameH: 64, frameCount: 4, fps: 8,  loop: true  },  // ← 4로 변경
  shoot: { src: 'images/player_shoot.png', frameW: 64, frameH: 64, frameCount: 1, fps: 16, loop: false },
  slash: { src: 'images/player_slash.png', frameW: 64, frameH: 64, frameCount: 1, fps: 14, loop: false },
};
```

끝. 코드는 자동으로 64픽셀씩 잘라서 8 fps 로 재생합니다.

### 옵션 2: 다른 프레임 크기

128×128 프레임을 쓰고 싶으면:
```javascript
walk: { src: 'images/player_move.png', frameW: 128, frameH: 128, frameCount: 4, fps: 8, loop: true },
```
이미지는 512×128 (= 128×128 × 4) 로 만들면 됩니다.

### 안전장치

이미지 너비가 `frameCount × frameW` 보다 작으면 자동으로 1프레임으로 보정됩니다.
콘솔에 경고 로그가 뜨고 게임은 정상 작동합니다.

---

## 애니메이션 파라미터

| 필드 | 의미 | 권장값 |
|---|---|---|
| `src` | 이미지 경로 | `images/player_*.png` |
| `frameW` | 한 프레임 너비 (px) | 64 |
| `frameH` | 한 프레임 높이 (px) | 64 |
| `frameCount` | 프레임 개수 | 1 ~ 8 |
| `fps` | 초당 프레임 | idle: 4, walk: 8, shoot: 16, slash: 14 |
| `loop` | 반복 여부 | idle/walk: true, shoot/slash: false |

---

## 권장 프레임 구성

캐릭터 액션을 더 살리고 싶다면:

### idle (대기) — 2~3프레임 (선택)
```
[정자세] [숨 들이쉼 (살짝 몸이 큼)]
```
- frameCount: 2, fps: 3, loop: true

### walk (이동) — 4프레임 (강추)
```
[다리1] [중간] [다리2] [중간]
```
- frameCount: 4, fps: 8~10, loop: true
- 가장 큰 차이를 만드는 부분입니다.

### shoot (사격) — 2~3프레임 (강추)
```
[조준] [발사 (반동/머즐플래시)] [복귀]
```
- frameCount: 2 또는 3, fps: 16, loop: false
- 한 번 재생 후 정지 (코드가 마지막 프레임 유지)

### slash (베기) — 4~6프레임 (강추)
```
[칼 들기] [휘두르는 중] [휘두름 끝] [복귀]
```
- frameCount: 4~6, fps: 12~16, loop: false

---

## 캐릭터 방향 처리

**좌우 반전 방식** 사용 중:
- 마우스가 캐릭터 오른쪽 → 정면 표시
- 마우스가 캐릭터 왼쪽 → 좌우 반전

이미지에 좌우 비대칭 요소(예: 어깨에 멘 무기, 팔의 위치)가 있으면 반전 시 어색해 보일 수 있습니다.
이 경우 좌우 대칭이 되는 디자인이거나, 위/정면을 향한 자세로 그리시면 자연스러워집니다.

---

## 회전이 필요하면

만약 8방향(상/하/좌/우/대각선) 회전이 필요하면 알려주세요.
현재 좌우 반전 → 8방향 회전 시스템으로 바꿔드릴 수 있습니다.
이 경우 각 상태별로 8장의 이미지가 필요합니다 (총 32장).

---

## 적용 즉시 확인하기

1. 브라우저에서 `python -m http.server 8000` 으로 게임 실행
2. F12 → Console 열기
3. 게임 시작 시 다음과 같은 로그 확인:
```
[ANIM] Loaded: idle (64x64, frames=1)
[ANIM] Loaded: walk (64x64, frames=1)
[ANIM] Loaded: shoot (64x64, frames=1)
[ANIM] Loaded: slash (64x64, frames=1)
```

스프라이트 시트로 교체하면 frames 숫자가 자동으로 올라갑니다.

캐시 문제로 안 바뀌면 **Ctrl+Shift+R** 강력 새로고침.
