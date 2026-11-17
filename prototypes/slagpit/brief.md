# Game Brief: Slagpit

## In your words
> Krunker.io 이런 게임 만들어줘.

1. Direction: usual (bot deathmatch)
2. Weapons: usual
3. Feel: usual
4. Look: 어둡고 대비 강한 Quake풍으로 해줘
5. Challenge: usual
6. Slice or quick test: usual (slice)
After play: 1번으로 고쳐줘 (예비탄이 모두 가득 차 있으면 탄약 상자를 먹지 않게)
After play: 봇 머리 위에 체력바 띄워줘
After play: 바닥에도 체력 팩 추가해줘
After play: 전투에서 벗어나 있어도 서서히 차게 해줘. 그리고 명확하게 나의 체력을 알고 싶기는 해.
After play: 20마리를 죽이는 목표가 좀 어려워 → 권장으로 해줘 (Easy 10, Normal 15, Hard 20)
After play: 좀 너무 어두운거 같아.

**Pitch:** 어두운 산업형 아레나에서 봇 5명과 벌이는 빠른 개인전 FPS. 슬라이드와 점프로 날아다니며 먼저 20킬. *(provisional)*

**Genre:** first-person arena shooter vs bots (first-person-shooter + competitive-multiplayer)

**Controls:** WASD move, mouse aim, left click fire, R reload, Space jump, Shift (while moving) slide, 1/2/3 weapons, Esc pause (sensitivity setting). *(guessed)*

**Question:** 봇 상대로 빠른 이동+사격 데스매치가 10분 동안 재밌는가?

**Hooks:** 슬라이드→점프로 속도를 이어가는 이동, 한 방 한 방 확실한 히트 피드백 *(from Krunker.io)*

**Intent:**

## Look and references
- Look: 어둡고 대비 강한 Quake풍 레트로 3D. 거친 저해상도 텍스처(nearest 필터), 각진 브러시형 지형. 배경은 짙은 갈색·녹슨 회색의 좁은 명도대, 플레이어 무기와 봇은 밝게. 팔레트: 바닥/벽 녹슨 갈색, 위협(봇) 핏빛 주황 눈 발광, 강조 유황빛 노랑(픽업·히트마커), 그림자는 차가운 청록, 조명은 따뜻한 주황. 디테일은 무기 모델과 봇 실루엣에, 벽은 단순하게. 시그니처: 벽에 걸린 용암 홈이 깜빡이며 아레나를 붉게 비춤. Every figure drawn, no emoji, no plain circles.
- References: Krunker.io (빠른 슬라이드·홉 이동, 짧은 매치, 즉시 리스폰), Quake / Dusk / ULTRAKILL (어둡고 대비 강한 레트로 룩, 거침없는 속도)
- View: 3D · Camera: first person, mouse-look with no smoothing

## First minute
타이틀에서 봇 난이도(쉬움/보통/어려움)와 무기(라이플·샷건·저격총)를 고른다 → 클릭 시 포인터 잠금, 아레나 구석 스폰. 3초 카운트다운 동안 걷고 점프해보며 Shift 슬라이드를 화면 힌트로 배운다 → 첫 봇이 회랑 끝에서 나타나 사격, 화면 가장자리 피격 방향 표시 → 맞추면 히트마커+틱 소리, 처치 시 킬 사운드와 킬피드 → 슬라이드-점프로 다음 봇에게 돌진하며 속도가 붙는 순간이 첫 보상.

## Challenge
보통 난이도에서 1~2분 안에 봇 둘이 동시에 노리는 진짜 접전 *(provisional)*. 봇은 사람 같은 반응 지연을 두고 가끔 빗나가며 벽 너머를 못 본다. 죽으면 2초 후 랜덤 스폰 지점에서 리스폰 — 그동안 상대가 점수를 쌓는 게 손실. 매치 후반엔 선두 봇이 더 공격적으로 플레이어를 노린다.

## Core loop
- 움직이며 봇을 찾고 → 쏴서 킬 → 점수 +1, 체력·탄약 픽업으로 회복
- 죽으면 짧은 리스폰 후 다시 합류
- 20킬 먼저 또는 5분 종료 시 최다 킬이 승리 → 결과 화면에서 R 한 번으로 재대결

## Goal & fail state
- 승리: 봇보다 먼저 목표 킬 — Easy 10, Normal 15, Hard 20 (또는 5분 후 1위)
- 패배: 봇이 먼저 목표 킬 / 시간 종료 시 1위 아님

## Features
- [x] 1인칭 이동: 걷기·점프·슬라이드, 슬라이드-점프 속도 유지
- [x] 무기 3종(라이플·샷건·저격총), 각자 반동·섬광·소리, 탄창+예비탄, 재장전, 탄 부족 경고음
- [x] 히트마커·킬 사운드·피격 방향 표시
- [x] 내가 맞춘 봇 머리 위 체력바 (3초간)
- [x] 4초간 안 맞으면 체력 서서히 회복, 왼쪽 아래 큰 체력 표시(숫자/최대치, 막대, 회복 중 표시)
- [x] 봇 5명, 3 enemy kinds each attacking differently: 돌진형(샷건), 거리 유지 저격형, 맷집형 — 각자 다른 실루엣, 난이도별 반응 지연·명중률, 시야 판정
- [x] 대칭형 아레나 1개: 순환 동선, 엄폐, 높낮이, 체력·탄약 픽업 (체력 팩: 탑 위 4개 + 바닥 2개)
- [x] 스코어보드·킬피드·매치 타이머, 결과 화면과 즉시 재대결
- [x] 일시정지 화면 마우스 감도 설정

## Keep
-

## Avoid
- Krunker.io의 이름, 아트, 캐릭터, UI *(guessed)*

## Out of scope
- Online matches and lag compensation: needs a server: not built yet (built instead: bots in the seats, named as bots)
- Matchmaking, ranks and seasons: needs a server: not built yet
- A campaign of levels: grow it
- Weapon upgrades and mods: add it as a feature
- Replays and a kill cam: add it as a feature
- Wall runs: change it after play

## Build order
1. 슬라이스: 아레나 1개, 이동+무기 3종+봇 5명, 20킬 승리와 패배, 재대결까지 한 판 완결.

---
**Kill condition:** 튜닝 두 번 후에도 이동·사격이 둔하게 느껴지면 중단 *(guessed)*

**Who it's for / what they feel:** 짧고 빠른 FPS 한 판을 원하는 혼자 하는 플레이어 — 날카로운 숙련감 *(guessed)*

**Games you love / don't:** Love Krunker.io (빠른 이동과 짧은 매치)
