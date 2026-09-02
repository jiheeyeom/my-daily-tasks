# My Daily Tasks · 프로젝트 메모

## 프로젝트 개요

GitHub Pages + Firebase Firestore 기반 개인 정적 웹앱.
**Google 로그인**, **건강 기록 (식사·운동·체중)**, **기존 할 일 마이그레이션** 기능 추가.

- 저장소: https://github.com/jiheeyeom/my-daily-tasks
- 배포: https://jiheeyeom.github.io/my-daily-tasks/
- Firebase 프로젝트: `my-daily-tasks-64a0b`

---

## 현재 상태 (2026-08-27)

**설정·배포 전부 완료. 운영 중.**

- [x] 코드 전체 구조 작성 완료 (v2.0.0)
- [x] Firebase Console → Google 로그인 활성화
- [x] Firebase Console → Authorized domains 에 `jiheeyeom.github.io` 추가
- [x] `firestore.rules` 운영 서버에 게시
- [x] `js/config.js` 의 `securityRulesConfigured: true` 로 변경
- [x] `legacyOwnerUid` = `xVhMdeOb3Uh0yVovUmnooRb8mSn2` (firestore.rules 와 동일)
- [x] GitHub Pages 배포 (main 브랜치 / (root)) — 푸시하면 자동 재빌드
- [ ] 기존 `my_tasks` 레거시 마이그레이션 실행 (백업 후 진행)
- [x] 식약처 음식DB 11,086종 도입 (2025-04-08 워크북)
- [x] 가공식품DB 255,785종 + 건강기능식품 3,346종 도입
- [x] firestore.rules 재게시 완료 (checkups 컬렉션 포함, 2026-08-27)
- [x] firestore.rules 재게시 완료 (profile 컬렉션 포함, 2026-08-28)
- [ ] 다른 계정으로 내 데이터 접근 차단 확인 (콘솔 Rules Playground, 계정 2개 필요)

규칙 게시 검증: Firestore REST API로 비로그인 읽기를 시도해 `my_tasks`,
`users/<uid>/{meals,tasks,weights}`, 미지 경로 모두 403 PERMISSION_DENIED 확인함.

---

## 파일 구조

```
.
├── index.html          # 메인 HTML (할 일 + 건강 기록 탭)
├── styles.css          # 반응형 CSS, 다크모드, 컴포넌트
├── firestore.rules     # Firestore 서버 보안 규칙 (반드시 콘솔에 게시)
├── firebase.json       # 에뮬레이터 설정
├── package.json        # 개발 의존성 및 스크립트
├── js/
│   ├── config.js       # Firebase 프로젝트 설정 + 앱 플래그
│   ├── main.js         # 앱 진입점 (ES Module)
│   ├── app.js          # UI / 이벤트 핸들러 / 상태 관리
│   ├── domain.js       # 순수 계산 (영양, 날짜, 할 일, 집계)
│   ├── firebase-store.js  # Auth + Firestore 접근
│   ├── foods.js        # 참고 식품 42종 (USDA 기본 17 + 과자 15 + 커피 9 + 브랜드 1)
│   ├── foods-kr.js     # 생성 파일 · 식약처 음식DB 11,086종 (1.2MB, gzip 196KB)
│   ├── foods-supplement.js # 생성 파일 · 건강기능식품 3,346종
│   ├── migration.js    # 기존 my_tasks → users/{uid}/tasks 복사
│   ├── news.js         # RSS 뉴스 + 오늘의 문구
│   └── theme.js        # 다크모드 즉시 적용 (렌더 전)
├── data/
│   └── foods-processed.json # 생성 파일 · 가공식품 255,785종 (24MB, gzip 5MB, 눌러서 로드)
├── docs/
│   ├── FIREBASE_SETUP.md  # Firebase 설정 절차 (필독)
│   ├── HEALTH_CHECKUPS.md # 건강검진 가져오기 · 개인정보 취급
│   ├── ENERGY_BALANCE.md  # 기초대사량 대비 계산과 한계
│   └── FOOD_DATA.md       # 식품 자료 출처 및 계산 방식
├── scripts/
│   ├── import_food_db.py  # 식약처 xlsx → js/foods-kr.js (수동 실행)
│   ├── build.mjs       # dist/ 빌드 (공개 파일만 복사)
│   └── check.mjs       # 정적 검사 (중복 ID, unsafe DOM, import 검증)
└── tests/
    ├── domain.test.js  # 순수 함수 단위 테스트
    ├── app.test.js     # DOM/UI 상태 테스트 (jsdom)
    └── rules.test.js   # Firestore 에뮬레이터 권한 테스트
```

---

## 개발 명령어

```sh
npm ci --ignore-scripts        # 의존성 설치
npm test                       # 단위 테스트 (domain + app)
npm run check                  # 정적 검사
npm run test:rules             # Firestore 에뮬레이터 규칙 테스트 (Java 17 필요)
npm run build                  # dist/ 생성
python3 -m http.server 8000 --bind 127.0.0.1  # 로컬 서버
```

---

## 주요 설계 결정

- **securityRulesConfigured 플래그**: Firestore 규칙 게시 전 실수 방지용.
  실제 보안은 서버 규칙이 담당. 플래그만으로 보안 보장 안 됨.
- **legacyOwnerUid**: 기존 `my_tasks` 컬렉션 마이그레이션 소유자 UID.
  빈 값이면 모든 사용자가 차단됨 (원본 데이터는 삭제 안 됨).
- **영양 null 처리**: 모르는 영양소는 `null`로 저장. 0으로 계산 안 함.
- **오프라인 캐시 비활성화**: 건강 데이터는 디스크 오프라인 캐시 없음.
- **운동 열량 차감 없음**: 의도적 설계. 운동 소모량은 섭취에서 빼지 않음.
- **식품 자료는 두 데이터셋**: SR Legacy(2018) 기본 17종 + 과자 15종, Survey FNDDS(2024-10-31)
  커피 9종. 커피는 SR Legacy에 없어서 FNDDS를 씀.
- **커피만 `개`(1잔) 단위, 나머지는 100g 단위**: 커피는 g으로 재기 번거로워 그란데(473ml≈480g)를
  1잔으로 등록. 잔 무게는 FDC 분량표(`foodMeasures`)의 `1 medium` 값이며 임의 환산이 아님.
  톨=0.75잔, 벤티=1.25잔. 1잔 영양값은 100g 값에 잔 무게를 곱해 코드에서 계산함(하드코딩 아님).
- **빠른 추가/고정**: 칩은 입력칸을 채우기만 하고 저장은 명시적 제출로만. 고정 목록은
  `preference()` 통해 localStorage 저장(계정 동기화 아님) — Firestore 로 옮기려면 규칙 재게시 필요.
  최근 음식은 저장된 스냅샷을 이름으로 실제 음식에 다시 연결해야 고정 ID가 안정적임.
- **술은 식약처 DB 에 거의 없음**(영양표시 의무 대상 아님): 가공식품DB `주류` 39종뿐.
  일반 맥주·와인·증류주 9종은 USDA SR Legacy 로 별도 추가(100g 기준, 이름에 "(g 기준)" 명시).
  소주는 USDA 에 없음 — 제품명 검색 또는 보드카로 대용 안내.
- **용기(잔/캔/병) 입력**: food.containers = [{label, ml, amount}] — amount 는 그 음식의 base 단위.
  ml 기준 음식은 ML_CONTAINERS 자동 적용(변환 불필요). g 기준은 USDA 분량표에 무게가 있는
  술 9종만. 밀도를 임의로 만들지 않는 것이 원칙 — USDA 의 1 fl oz = 30g 만 사용.
  저장 값은 항상 원래 단위이고 용기는 입력 보조일 뿐. 역방향 표시는 오차 5% 이내일 때만.
- **jsdom 은 HTML 제약검증을 안 함**: number input 의 value 가 min/step 시퀀스에 안 맞으면
  브라우저가 제출을 막는데, 그 입력이 hidden 이면 포커스도 못 줘서 **버튼이 조용히 죽음**.
  실제로 container-count(min .1 step .5 value 1) 때문에 식사 기록 버튼이 안 눌렸음(2026-09-01).
  숨긴 행의 입력은 반드시 disabled 로 둘 것 — 단 hidden 검사는 폼 내부까지만(탭 패널이 hidden 이라 전체가 죽음).
- **일러스트는 unDraw**: cdn.undraw.co/illustration/<name>_<hash>.svg 에서 받아 인라인.
  라이선스: 상업/개인 무료, 출처표기 불필요. 단 재배포 팩 제작·AI 학습 사용은 금지.
  삽입 시 `id` 속성 제거(페이지 ID 공간 오염 방지), width/height 제거(CSS 로 크기 지정),
  `#6c63ff`→`var(--accent)`, `#f2f2f2`/`#e6e6e6`→`var(--surface-alt)`, `#3f3d56`/`#090814`→`var(--ink)`.
  **직접 SVG 를 손으로 그리지 말 것** — 렌더링 확인 수단이 없어 인물 그림은 반드시 실패함.
- **디자인은 유리+글로우 구성(2026-09-02)**: 파스텔 틴트 워시는 사용자가 거부("밍숭맹숭").
  Calm 레퍼런스의 실제 구성은 **채도 높은 오브(0.55/0.5) + backdrop-filter 유리 패널(surface 78%)**.
  바닥에 앉는 텍스트는 --muted-on-ground / --accent-on-ground 토큰 필수(오브가 지나가는 자리).
  잔무늬는 카드가 아니라 **배경 레이어**에: 얇은 동심 타원 + 스파클(.backdrop .lines).
- **일러스트 방향 결정(2026-09-01)**: 캐릭터 그림 전부 제거. unDraw 는 낡았고 무료 세트는 대부분
  같은 계열. Calm/Oura 처럼 **추상 그라데이션 + 타이포 + 데이터 자체**로 감. 장식이 필요하면
  수치에서 그려지는 것(진행 링 등)을 쓸 것 — 낡지도 않고 렌더링 확인 없이도 정확함.
- **검색 순위**: 고정 → 최근 사용횟수 → 이름매칭 → 컬렉션(내음식/큐레이션/식약처) → startsWith → 이름길이.
  startsWith 를 앞에 두면 "와인비니거"가 "레드와인"을 이겨서 실패함 — 반드시 컬렉션 뒤에 둘 것.
  **검색 중에는 optgroup 을 쓰지 않음**(그룹 순서가 순위를 덮어써서 버그였음).
- **검색 키워드에 분류명 포함**: 대분류·대표식품명·중분류·소분류를 keywords 에 넣음. 제품명에 없는
  말로도 찾게 하려는 것(예: "카스 프레시"를 `맥주`로 검색). 이게 빠져서 술이 안 나온다는 신고가 있었음.
- **식약처 원본 워크북은 커밋 금지**: `docs/FOOD DATABASE/` 는 gitignore. 가공식품DB 가 109MB 라
  GitHub 100MB 파일 상한을 넘김. 생성물 `js/foods-kr.js` 만 커밋하고
  `python3 scripts/import_food_db.py` 로 재생성.
- **검진 체중 → weights 자동 추가**: 검진 가져올 때 그 날짜 체중 기록도 생성(`saveIfAbsent`)해서
  7일 평균·그래프에 반영. 직접 기록한 값은 절대 덮어쓰지 않음.
- **기초대사량 카드**: Mifflin-St Jeor. TDEE 가 아니라 안정시 열량이라 활동량 누락 — UI 와 문서에
  반드시 명시. 7700kcal=1kg 은 어림 규칙. 목표 열량 기능은 만들지 않음(검진 파일도 금지 명시).
  성별·출생연도·키·목표열량은 Firestore `users/{uid}/profile/body`(계정 동기화), 체중은 weights 최신값.
- **먹을 것/운동 제안**: 차이 50kcal 이상일 때만. MET 는 2011 Compendium 원문 PDF 에서 전사하고
  활동 코드를 UI 에 노출(검증 가능하게). 240분 초과 제안 안 함. 음식 제안은 실제로 서빙 가능한
  범위(개 0.5~3, g 30~400)만 통과시킴 — 바나나 450g 같은 게 나오지 않도록.
- **목표 열량 기능 있음**: 사용자가 한계를 인지하고 동기부여용으로 요청함(2026-08-28). 경고·잔소리 없이
  진행 막대와 남은/초과 kcal 만 표시. 앱이 목표치를 대신 정하지는 않음.
- **건강검진 그래프**: 일반검진 2회 이상인 지표만 연도.월 꺾은선으로. 결과 없는 회차는 선을 끊고
  보간하지 않음. 세로축은 기록값 범위이며 정상 범위가 아님.
- **브랜드 제품 값 출처**: 호식이두마리치킨은 제조사가 열량 미공개 → 제3자 앱 값을 쓰되
  100g 환산·탄단지 역산·소비자원 실측 중량 세 가지로 교차검증하고 출처에 '제조사 미공개' 명시.
- **건강검진 기록**: 파일은 브라우저에서만 파싱해 `users/{uid}/checkups` 로 저장. 문서 ID 는
  `{kind}_{date}` 라 재수입해도 중복되지 않음. 앱은 정상/이상 판정을 하지 않고, 빈 값은 null 유지.
  자세한 원칙은 docs/HEALTH_CHECKUPS.md.
- **build.mjs 는 docs/ 를 통째로 복사**하므로 FOOD DATABASE·health_checkups·private-data·backups 를
  filter 로 제외함. docs/ 에 민감 파일을 두면 dist 로 새어나감.
- **개인 건강 데이터는 docs/ 에 두지 말 것**: `docs/` 는 GitHub Pages 로 그대로 공개됨.
  `docs/health_checkups*.json` 는 gitignore 처리했으나, 원칙적으로 `private-data/` 에 둘 것.
- **선택 상자 200종 상한**: 카탈로그가 1만 종을 넘어 전체 렌더링이 불가. 이미 선택된 음식은
  상한 밖이어도 목록에 남겨야 제출 시 선택이 사라지지 않음.
- **식품 추가 규칙**: 값은 반드시 FDC에서 확인 후 추가하고 임의 추정치를 넣지 않음.
  손으로 넣는 항목(비-mfds)은 `tests/domain.test.js` 에서 42개로 고정 단언 중 — 늘리면 함께 수정.
  USDA API는 `DEMO_KEY` 로 시간당 10회 제한 — 검색 결과 JSON을 파일로 받아 재사용할 것.

---

## 배포 흐름 (GitHub Pages, main 브랜치 루트)

공개 파일: `index.html`, `styles.css`, `.nojekyll`, `js/`, `docs/`
비포함: `node_modules/`, `tests/`, `scripts/`, `*.rules`, `firebase.json`, 개인 데이터

---

## 문제 해결 빠른 참조

| 증상 | 확인 사항 |
|------|-----------|
| `auth/operation-not-allowed` | Firebase Console → Google 로그인 활성화 |
| `auth/unauthorized-domain` | Authorized domains 에 호스트 추가 |
| `permission-denied` | Firestore rules 게시 여부, UID 일치 여부 확인 |
| 빈 할 일 목록 | 새 개인 공간은 비어있음. 마이그레이션 절차 진행 |
| 커피 열량이 이상함 | 카탈로그 값은 100g 기준이며 한 잔이 아님. g·ml 자동 변환 없음 |
