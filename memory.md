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
- **식약처 원본 워크북은 커밋 금지**: `docs/FOOD DATABASE/` 는 gitignore. 가공식품DB 가 109MB 라
  GitHub 100MB 파일 상한을 넘김. 생성물 `js/foods-kr.js` 만 커밋하고
  `python3 scripts/import_food_db.py` 로 재생성.
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
