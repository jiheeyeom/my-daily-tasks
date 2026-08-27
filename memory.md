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
│   ├── foods.js        # USDA 참고 식품 26종 (SR Legacy 17 + FNDDS 커피 9)
│   ├── migration.js    # 기존 my_tasks → users/{uid}/tasks 복사
│   ├── news.js         # RSS 뉴스 + 오늘의 문구
│   └── theme.js        # 다크모드 즉시 적용 (렌더 전)
├── docs/
│   ├── FIREBASE_SETUP.md  # Firebase 설정 절차 (필독)
│   └── FOOD_DATA.md       # 식품 자료 출처 및 계산 방식
├── scripts/
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
- **식품 자료는 두 데이터셋**: SR Legacy(2018) 기본 식품 17종 + Survey FNDDS(2024-10-31)
  커피 음료 9종. 커피는 SR Legacy에 없어서 FNDDS를 씀. 값은 반드시 FDC에서 확인 후 추가하고
  임의 추정치를 넣지 않음. `foods.js` 항목을 늘리면 `tests/domain.test.js` 의 개수 단언도 함께 수정.

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
