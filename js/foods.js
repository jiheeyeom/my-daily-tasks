import { KOREAN_FOODS } from "./foods-kr.js";
import { SUPPLEMENT_FOODS } from "./foods-supplement.js";

// USDA FoodData Central, SR Legacy (April 2018). See docs/FOOD_DATA.md.
// All values are per 100 g of edible food, not per portion or 100 ml.
const references = [
  [168932, "흰쌀밥 · 단립종, 조리 후", 130, 2.36, 28.7, 0.19, "밥 백미 쌀밥"],
  [168875, "현미밥 · 중립종, 조리 후", 112, 2.32, 23.5, 0.83, "밥 현미"],
  [173424, "삶은 달걀 · 껍데기 제외", 155, 12.6, 1.12, 10.6, "계란 달걀"],
  [171477, "닭가슴살 · 껍질 없이 구운 것", 165, 31, 0, 3.57, "닭고기 치킨"],
  [
    172475,
    "단단한 두부 · 황산칼슘 응고, 생것",
    144,
    17.3,
    2.78,
    8.72,
    "두부 콩",
  ],
  [173944, "바나나 · 껍질 제외, 생것", 89, 1.09, 22.8, 0.33, "과일"],
  [171688, "사과 · 껍질 포함, 생것", 52, 0.26, 13.8, 0.17, "과일"],
  [168484, "고구마 · 껍질 없이 삶은 것", 76, 1.37, 17.7, 0.14, "고구마"],
  [173904, "오트밀 · 건조, 무강화", 379, 13.2, 67.7, 6.52, "귀리 오트"],
  [
    172217,
    "우유 · 전지 3.25%, 무강화 (g 기준)",
    61,
    3.15,
    4.78,
    3.27,
    "우유 유제품",
  ],
  [
    170894,
    "그릭요거트 · 플레인 무지방",
    59,
    10.2,
    3.6,
    0.39,
    "요구르트 유제품",
  ],
  [171304, "그릭요거트 · 플레인 전지", 97, 9, 3.98, 5, "요구르트 유제품"],
  [170567, "아몬드 · 생것", 579, 21.2, 21.6, 49.9, "견과류"],
  [171413, "올리브유 (g 기준)", 884, 0, 0, 100, "기름 올리브오일"],
  [175168, "대서양 연어 · 양식, 구운 것", 206, 22.1, 0, 12.4, "생선"],
  [169967, "브로콜리 · 무염, 삶아 물 뺀 것", 35, 2.38, 7.18, 0.41, "채소 야채"],
  [173905, "오트밀 · 물로 조리 후, 무염", 71, 2.54, 12, 1.52, "귀리 오트"],
];

// USDA FoodData Central, SR Legacy (April 2018). Snacks and sweets, per 100 g.
const snackReferences = [
  [
    169677,
    "감자칩 · 플레인, 소금 간",
    532,
    6.39,
    53.8,
    34,
    "과자 스낵 감자칩 포테이토칩",
  ],
  [
    167962,
    "감자칩 · 바비큐 맛",
    487,
    6.51,
    55.9,
    31.1,
    "과자 스낵 감자칩 바비큐",
  ],
  [
    167559,
    "나초칩 · 나초치즈 맛",
    519,
    7.36,
    60.8,
    27.4,
    "과자 스낵 나초 또띠아칩",
  ],
  [170246, "팝콘 · 에어팝, 무염", 382, 12, 77.9, 4.2, "과자 스낵 팝콘"],
  [167555, "프레첼 · 하드, 소금", 384, 10, 80.4, 2.93, "과자 스낵 프레첼"],
  [
    174982,
    "크래커 · 일반 스낵형",
    510,
    6.64,
    61.3,
    26.4,
    "과자 스낵 크래커 비스킷",
  ],
  [
    167967,
    "현미 라이스케이크 · 메밀 (뻥튀기류)",
    380,
    9,
    80.1,
    3.5,
    "과자 스낵 뻥튀기 쌀과자 현미",
  ],
  [
    173160,
    "새우 크래커 (새우깡류)",
    426,
    7.14,
    59.1,
    17.9,
    "과자 스낵 새우깡 새우",
  ],
  [
    167542,
    "그래놀라바 · 하드, 플레인",
    471,
    10.1,
    64.4,
    19.8,
    "과자 스낵 그래놀라바 시리얼바",
  ],
  [
    167561,
    "트레일믹스 · 일반",
    462,
    13.8,
    44.9,
    29.4,
    "과자 스낵 트레일믹스 견과류",
  ],
  [
    172716,
    "초코칩 쿠키 · 시판",
    492,
    5.1,
    65.4,
    24.7,
    "과자 스낵 쿠키 초코칩 초콜릿",
  ],
  [
    172718,
    "크림 샌드위치 쿠키 · 초콜릿 (오레오류)",
    464,
    5.21,
    71,
    19.1,
    "과자 스낵 쿠키 오레오 샌드위치",
  ],
  [
    174967,
    "쇼트브레드 쿠키 · 플레인",
    514,
    5.37,
    63.8,
    26.2,
    "과자 스낵 쿠키 버터 쇼트브레드",
  ],
  [167587, "밀크초콜릿", 535, 7.65, 59.4, 29.7, "과자 초콜릿 밀크초콜릿"],
  [
    167976,
    "다크초콜릿 · 세미스위트",
    480,
    4.2,
    63.9,
    30,
    "과자 초콜릿 다크초콜릿",
  ],
];

// USDA FoodData Central, Survey (FNDDS), published 2024-10-31. See docs/FOOD_DATA.md.
// Coffee is absent from SR Legacy. Values below are per 100 g; the gram weight of one
// serving comes from the same FDC entry's portion table, so one cup is derived, not guessed.
// 480 g / 496 g is USDA's "1 medium", which matches a 473 ml grande.
const coffeeServings = [
  [
    2710375,
    "아메리카노(브루드 커피) · 그란데 1잔 480g",
    480,
    1,
    0.12,
    0,
    0.02,
    "커피 아메리카노 드립 잔",
  ],
  [
    2710378,
    "에스프레소 · 1샷 30g",
    30,
    9,
    0.12,
    1.67,
    0.18,
    "커피 에스프레소 샷",
  ],
  [
    2710386,
    "카페라떼 · 그란데 1잔 480g",
    480,
    43,
    2.81,
    4.35,
    1.61,
    "커피 라떼 우유 잔",
  ],
  [
    2710389,
    "바닐라·카라멜 라떼(시럽 향미) · 그란데 1잔 496g",
    496,
    55,
    2.72,
    7.49,
    1.57,
    "커피 라떼 바닐라 카라멜 시럽 잔",
  ],
  [
    2710387,
    "카페라떼 · 무지방 우유 · 그란데 1잔 480g",
    480,
    30,
    2.87,
    4.37,
    0.1,
    "커피 라떼 무지방 스키니 잔",
  ],
  [
    2710431,
    "아이스 카페라떼 · 그란데 1잔 480g (얼음 포함)",
    480,
    27,
    1.75,
    2.81,
    1.01,
    "커피 라떼 아이스 잔",
  ],
  [
    2710472,
    "카푸치노 · 그란데 1잔 480g",
    480,
    27,
    1.71,
    2.75,
    0.99,
    "커피 카푸치노 잔",
  ],
  [
    2710410,
    "카페모카 · 그란데 1잔 496g",
    496,
    64,
    2.56,
    10.2,
    1.47,
    "커피 모카 초콜릿 잔",
  ],
  [
    2710383,
    "카라멜 마키아토 · 1잔 62g",
    62,
    40,
    1.13,
    6.89,
    0.8,
    "커피 마키아토 카라멜 잔",
  ],
];

const entry = (fdcId, dataset, fields) =>
  Object.freeze({
    id: `usda-${fdcId}`,
    ...fields,
    source: `${dataset} · FDC ${fdcId}`,
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`,
  });

// Branded products are not in USDA. Values come from the maker's own published
// label, so each one carries its own source and link rather than an FDC id.
const brandServings = [
  {
    id: "fitline-powercocktail",
    name: "FitLine 파워칵테일 · 1포 15g",
    kcal: 45,
    protein: 0.16,
    carbs: 8,
    fat: 0.2,
    keywords: "핏라인 fitline 파워칵테일 비타민 보충제 영양제",
    baseAmount: 1,
    baseUnit: "개",
    source: "PM-International 제품 라벨 (1포 15g, 물 180ml)",
    sourceUrl:
      "https://www.pmebusiness.com/files/sg/product_usage/FL.PowerCocktailBox.LMIV.3717.DEII.P14_INTERNET.pdf",
  },
];

// Per 100 g of edible food, not per portion or 100 ml.
const perHundredGrams =
  (dataset) =>
  ([fdcId, name, kcal, protein, carbs, fat, keywords]) =>
    entry(fdcId, dataset, {
      name,
      kcal,
      protein,
      carbs,
      fat,
      keywords,
      baseAmount: 100,
      baseUnit: "g",
    });

// One serving, scaled from the published per-100 g values by that serving's gram weight.
// Rounded to two decimals so the list does not imply precision the source does not have.
const perServing =
  (dataset) =>
  ([fdcId, name, grams, kcal, protein, carbs, fat, keywords]) => {
    const scale = (value) => Math.round(value * grams) / 100;
    return entry(fdcId, dataset, {
      name,
      kcal: scale(kcal),
      protein: scale(protein),
      carbs: scale(carbs),
      fat: scale(fat),
      keywords,
      baseAmount: 1,
      baseUnit: "개",
    });
  };

export const FOOD_CATALOG = [
  ...references.map(perHundredGrams("USDA SR Legacy")),
  ...snackReferences.map(perHundredGrams("USDA SR Legacy")),
  ...coffeeServings.map(perServing("USDA FNDDS 2024-10-31")),
  ...brandServings.map(Object.freeze),
  ...KOREAN_FOODS,
  ...SUPPLEMENT_FOODS,
];
