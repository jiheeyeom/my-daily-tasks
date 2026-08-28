export const CATEGORIES = { work: "BOM", personal: "변경", study: "LATER" };
export const MEAL_TYPES = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};
export const WORKOUT_TYPES = {
  yoga: "요가",
  walk: "걷기",
  strength: "근력",
  other: "기타",
};
export const UNITS = ["g", "ml", "개"];

export function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("날짜를 확인해 주세요.");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return (
    year >= 2000 &&
    year <= 2100 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function shiftDate(key, days) {
  if (!isDateKey(key)) throw new Error("올바른 날짜가 아닙니다.");
  const [year, month, day] = key.split("-").map(Number);
  return dateKey(new Date(year, month - 1, day + days, 12));
}

export function lastDays(end, count = 7) {
  return Array.from({ length: count }, (_, index) =>
    shiftDate(end, index - count + 1),
  );
}

export function formatDate(key) {
  if (!isDateKey(key)) return "날짜 없음";
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(year, month - 1, day, 12));
}

export function round(value, digits = 1) {
  return Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
}

export function numberValue(
  value,
  label,
  { min = 0, max = 10000, optional = false } = {},
) {
  if (
    (typeof value === "string" && value.trim() === "") ||
    value === null ||
    value === undefined
  ) {
    if (optional) return null;
    throw new Error(`${label}을(를) 입력해 주세요.`);
  }
  if (
    typeof value === "boolean" ||
    !["number", "string"].includes(typeof value)
  )
    throw new Error(`${label}은(는) 숫자로 입력해 주세요.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max)
    throw new Error(`${label}은(는) ${min}~${max} 범위로 입력해 주세요.`);
  return result;
}

function textValue(value, label, max, optional = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((!text && !optional) || text.length > max)
    throw new Error(`${label}을(를) ${max}자 이내로 입력해 주세요.`);
  return text;
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function foodSnapshot(input) {
  if (!UNITS.includes(input.baseUnit))
    throw new Error("기준 단위를 확인해 주세요.");
  return {
    name: textValue(input.name, "음식명", 100),
    baseAmount: numberValue(input.baseAmount, "기준량", {
      min: 0.1,
      max: 5000,
    }),
    baseUnit: input.baseUnit,
    kcal: numberValue(input.kcal, "열량", { max: 10000 }),
    protein: numberValue(input.protein, "단백질", {
      max: 2000,
      optional: true,
    }),
    carbs: numberValue(input.carbs, "탄수화물", { max: 2000, optional: true }),
    fat: numberValue(input.fat, "지방", { max: 2000, optional: true }),
    source: textValue(input.source || "직접 입력", "출처", 240),
    sourceUrl: textValue(
      safeUrl(input.sourceUrl || ""),
      "출처 주소",
      500,
      true,
    ),
  };
}

export function calculateNutrition(food, amount, unit = food.baseUnit) {
  const reference = foodSnapshot(food);
  if (unit !== reference.baseUnit)
    throw new Error(
      "g·ml·개는 임의로 바꿀 수 없습니다. 영양표와 같은 단위로 입력해 주세요.",
    );
  const quantity = numberValue(amount, "먹은 양", {
    min: 0.1,
    max: unit === "개" ? 100 : 5000,
  });
  const ratio = quantity / reference.baseAmount;
  const result = {};
  for (const key of ["kcal", "protein", "carbs", "fat"])
    result[key] = reference[key] === null ? null : reference[key] * ratio;
  return result;
}

// Drinks are counted in cans, glasses and bottles, but stored in the unit the
// nutrition is published in. A container therefore carries both: the volume a
// person recognises and the amount in the food's own base unit.
export const ML_CONTAINERS = [
  { label: "잔 200ml", ml: 200, amount: 200 },
  { label: "캔 355ml", ml: 355, amount: 355 },
  { label: "캔 500ml", ml: 500, amount: 500 },
  { label: "병 360ml", ml: 360, amount: 360 },
  { label: "병 500ml", ml: 500, amount: 500 },
  { label: "병 750ml", ml: 750, amount: 750 },
];

export function containersFor(food) {
  if (food?.containers?.length) return food.containers;
  // A millilitre-based food needs no conversion at all, so the standard sizes
  // apply directly. Anything measured by weight needs a published container
  // weight, which only the curated drinks have.
  return food?.baseUnit === "ml" ? ML_CONTAINERS : [];
}

export function containerAmount(container, count) {
  const quantity = Number(count);
  if (!container || !Number.isFinite(quantity) || quantity <= 0) return null;
  return round(container.amount * quantity, 1);
}

export function describeContainer(container, count) {
  const quantity = Number(count);
  if (!container || !Number.isFinite(quantity) || quantity <= 0) return "";
  return `${round(container.ml * quantity, 0)}ml`;
}

// Reverse view: what a typed amount comes to in containers, so the two inputs
// always agree. Only reported when it lands close to a recognisable count.
export function containerEquivalent(food, amount) {
  const containers = containersFor(food);
  const quantity = Number(amount);
  if (!containers.length || !Number.isFinite(quantity) || quantity <= 0)
    return null;
  let best = null;
  for (const container of containers) {
    const count = round(quantity / container.amount, 2);
    if (count < 0.25 || count > 20) continue;
    const rounded = Math.round(count * 4) / 4;
    const drift = Math.abs(count - rounded) / count;
    if (drift > 0.05) continue;
    if (!best || Math.abs(rounded - 1) < Math.abs(best.count - 1))
      best = { container, count: rounded };
  }
  if (!best) return null;
  return {
    ...best,
    ml: round(best.container.ml * best.count, 0),
    text: `${best.count}${best.container.label.replace(/\s?[0-9.]+ml$/, "")} · ${round(best.container.ml * best.count, 0)}ml`,
  };
}

export function makeMeal(input, now = Date.now()) {
  if (!isDateKey(input.date)) throw new Error("날짜를 확인해 주세요.");
  if (!Object.hasOwn(MEAL_TYPES, input.mealType))
    throw new Error("식사 구분을 선택해 주세요.");
  const food = foodSnapshot(input.food);
  const amount = numberValue(input.amount, "먹은 양", {
    min: 0.1,
    max: food.baseUnit === "개" ? 100 : 5000,
  });
  return {
    date: input.date,
    mealType: input.mealType,
    food,
    amount,
    unit: food.baseUnit,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function makeTask(input, now = Date.now()) {
  const text = textValue(input.text, "할 일", 1000);
  if (!Object.hasOwn(CATEGORIES, input.category))
    throw new Error("분류를 선택해 주세요.");
  if (input.dueDate && !isDateKey(input.dueDate))
    throw new Error("마감일을 확인해 주세요.");
  return {
    text,
    category: input.category,
    dueDate: input.dueDate || "",
    completed: Boolean(input.completed),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function makeWorkout(input, now = Date.now()) {
  if (!isDateKey(input.date)) throw new Error("운동 날짜를 확인해 주세요.");
  if (!Object.hasOwn(WORKOUT_TYPES, input.kind))
    throw new Error("운동 종류를 선택해 주세요.");
  return {
    date: input.date,
    kind: input.kind,
    label: textValue(input.label, "운동명", 100),
    minutes: numberValue(input.minutes, "운동 시간", { min: 1, max: 720 }),
    planKey: textValue(input.planKey || "", "일정 식별자", 64, true),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function makeWeight(input, now = Date.now()) {
  if (!isDateKey(input.date))
    throw new Error("체중 기록 날짜를 확인해 주세요.");
  return {
    date: input.date,
    kg: numberValue(input.kg, "체중", { min: 20, max: 400 }),
    note: textValue(input.note || "", "메모", 200, true),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

// Health checkup metrics, with the plausible range each value must fall in.
// Values are transcribed from a checkup report; the app stores and shows them
// and does not judge, diagnose or derive targets from them.
export const CHECKUP_METRICS = {
  height_cm: { label: "키", unit: "cm", max: 300 },
  weight_kg: { label: "체중", unit: "kg", max: 400 },
  bmi_kg_m2: { label: "체질량지수", unit: "kg/m²", max: 100 },
  waist_cm: { label: "허리둘레", unit: "cm", max: 300 },
  systolic_bp_mmhg: { label: "수축기 혈압", unit: "mmHg", max: 400 },
  diastolic_bp_mmhg: { label: "이완기 혈압", unit: "mmHg", max: 300 },
  hemoglobin_g_dl: { label: "혈색소", unit: "g/dL", max: 30 },
  fasting_glucose_mg_dl: { label: "공복혈당", unit: "mg/dL", max: 1000 },
  total_cholesterol_mg_dl: { label: "총콜레스테롤", unit: "mg/dL", max: 1000 },
  hdl_cholesterol_mg_dl: { label: "HDL 콜레스테롤", unit: "mg/dL", max: 500 },
  triglycerides_mg_dl: { label: "중성지방", unit: "mg/dL", max: 5000 },
  ldl_cholesterol_mg_dl: { label: "LDL 콜레스테롤", unit: "mg/dL", max: 1000 },
  creatinine_mg_dl: { label: "혈청 크레아티닌", unit: "mg/dL", max: 50 },
  egfr_ml_min_1_73m2: {
    label: "신사구체여과율",
    unit: "mL/min/1.73m²",
    max: 300,
  },
  ast_iu_l: { label: "AST", unit: "IU/L", max: 5000 },
  alt_iu_l: { label: "ALT", unit: "IU/L", max: 5000 },
  ggt_iu_l: { label: "감마지티피", unit: "IU/L", max: 5000 },
  visual_acuity_left_decimal: { label: "시력(좌)", unit: "", max: 3 },
  visual_acuity_right_decimal: { label: "시력(우)", unit: "", max: 3 },
};
export const CHECKUP_KINDS = {
  general: "일반건강검진",
  screening: "기타 검사",
};

export const checkupId = (input) => `${input.kind}_${input.date}`;

export function makeCheckup(input, now = Date.now()) {
  if (!isDateKey(input.date)) throw new Error("검진일을 확인해 주세요.");
  if (!Object.hasOwn(CHECKUP_KINDS, input.kind))
    throw new Error("검진 구분을 확인해 주세요.");
  const measurements = {};
  for (const [key, metric] of Object.entries(CHECKUP_METRICS)) {
    const raw = input.measurements?.[key];
    // A blank result stays null. It is not zero, and not a normal result.
    measurements[key] =
      raw === undefined || raw === null || raw === ""
        ? null
        : numberValue(raw, metric.label, { min: 0, max: metric.max });
  }
  return {
    date: input.date,
    kind: input.kind,
    label: textValue(input.label || CHECKUP_KINDS[input.kind], "검진명", 100),
    measurements,
    note: textValue(input.note || "", "소견", 2000, true),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export const BODY_PROFILE_SEXES = { female: "여성", male: "남성" };
export const BODY_PROFILE_ID = "body";

export function makeBodyProfile(input, now = Date.now()) {
  if (!Object.hasOwn(BODY_PROFILE_SEXES, input.sex ?? ""))
    throw new Error("성별을 선택해 주세요.");
  const optional = (value, label, options) =>
    value === "" || value === null || value === undefined
      ? null
      : numberValue(value, label, options);
  return {
    sex: input.sex,
    birthYear: numberValue(input.birthYear, "출생연도", {
      min: 1900,
      max: 2100,
    }),
    heightCm: optional(input.heightCm, "키", { min: 100, max: 250 }),
    targetKcal: optional(input.targetKcal, "목표 열량", {
      min: 500,
      max: 10000,
    }),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

// MET values transcribed from the 2011 Compendium of Physical Activities
// (Ainsworth et al.), with the activity code so each one can be checked.
// https://pacompendium.com/
export const ACTIVITIES = [
  {
    key: "walk",
    label: "걷기",
    detail: "4.5~5km/h 보통 속도",
    met: 3.5,
    code: "17190",
  },
  {
    key: "brisk",
    label: "빠르게 걷기",
    detail: "5.6km/h",
    met: 4.3,
    code: "17200",
  },
  { key: "yoga", label: "하타 요가", detail: "", met: 2.5, code: "02150" },
  {
    key: "calisthenics",
    label: "맨몸운동",
    detail: "보통 강도",
    met: 3.8,
    code: "02022",
  },
  {
    key: "strength",
    label: "근력운동",
    detail: "높은 강도",
    met: 6,
    code: "02050",
  },
  { key: "jog", label: "조깅", detail: "", met: 7, code: "12020" },
  { key: "bike", label: "자전거", detail: "19~22km/h", met: 8, code: "01030" },
];

// kcal/min = MET x 3.5 x kg / 200, the usual companion formula to the
// compendium. It is an average for a body size, not a personal measurement.
export function activityMinutes(kcal, met, weightKg) {
  if (![kcal, met, weightKg].every(Number.isFinite)) return null;
  if (kcal <= 0 || met <= 0 || weightKg <= 0) return null;
  return Math.round(kcal / ((met * 3.5 * weightKg) / 200));
}

export function exerciseOptions(kcal, weightKg, limit = 3) {
  return ACTIVITIES.map((activity) => ({
    ...activity,
    minutes: activityMinutes(kcal, activity.met, weightKg),
  }))
    .filter((option) => option.minutes !== null && option.minutes <= 240)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, limit);
}

// How much of a food would cover a shortfall. Portions are rounded to
// something a person can actually serve, so the kcal is recomputed from the
// rounded amount rather than reported as the exact target.
export function portionFor(kcal, food) {
  if (!Number.isFinite(kcal) || kcal <= 0) return null;
  if (!food || !Number.isFinite(food.kcal) || food.kcal <= 0) return null;
  const perBase = food.kcal / food.baseAmount;
  const raw = kcal / perBase;
  const amount =
    food.baseUnit === "개"
      ? Math.round(raw * 2) / 2
      : Math.round(raw / 10) * 10;
  if (amount <= 0) return null;
  return {
    food,
    amount,
    unit: food.baseUnit,
    kcal: round(amount * perBase, 0),
  };
}

// A suggestion is only useful if the portion is one a person would actually
// serve. 450 g of banana technically fills the gap but nobody eats that.
const servable = (portion) =>
  portion.unit === "개"
    ? portion.amount >= 0.5 && portion.amount <= 3
    : portion.amount >= 30 && portion.amount <= 400;

export function foodSuggestions(kcal, foods, limit = 3) {
  const seen = new Set();
  return (foods || [])
    .filter((food) => {
      if (!food?.name || seen.has(food.name)) return false;
      seen.add(food.name);
      return true;
    })
    .map((food) => portionFor(kcal, food))
    .filter((portion) => portion && servable(portion))
    .slice(0, limit);
}

// Roughly 7,700 kcal is often quoted as one kilogram of body fat. It is a rule
// of thumb, not a law: real change also involves water, glycogen and the body
// adapting, so any projection from it is an order of magnitude, not a forecast.
export const KCAL_PER_KG = 7700;

// Mifflin-St Jeor. This is resting metabolic rate only. It is NOT total daily
// energy expenditure: it excludes all activity, so a deficit against it is
// deeper than it looks. It is not a recommended intake or a weight-loss target.
export function basalMetabolicRate(profile, on = new Date()) {
  if (!profile) return null;
  const { sex, birthYear, heightCm, weightKg } = profile;
  if (!Object.hasOwn(BODY_PROFILE_SEXES, sex ?? "")) return null;
  const age = on.getFullYear() - Number(birthYear);
  if (!Number.isFinite(age) || age < 10 || age > 120) return null;
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250)
    return null;
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400)
    return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return round(base + (sex === "male" ? 5 : -161), 0);
}

// Positive means more was logged than the resting estimate, negative means less.
export function energyBalance(intakeKcal, bmr) {
  if (bmr === null || !Number.isFinite(intakeKcal)) return null;
  const difference = round(intakeKcal - bmr, 0);
  return {
    bmr,
    intakeKcal: round(intakeKcal, 0),
    difference,
    over: difference > 0,
  };
}

// What the same daily gap would add up to, if it held and nothing else changed.
export function weightDriftKg(dailyDifferenceKcal, days = 30) {
  if (!Number.isFinite(dailyDifferenceKcal) || !Number.isFinite(days))
    return null;
  return round((dailyDifferenceKcal * days) / KCAL_PER_KG, 2);
}

export function nutritionTotals(meals) {
  const values = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const missing = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const meal of meals) {
    let nutrition;
    try {
      nutrition = calculateNutrition(meal.food, meal.amount, meal.unit);
    } catch {
      for (const key of Object.keys(missing)) missing[key]++;
      continue;
    }
    for (const key of Object.keys(values)) {
      if (nutrition[key] === null) missing[key]++;
      else values[key] += nutrition[key];
    }
  }
  for (const key of Object.keys(values)) values[key] = round(values[key]);
  return { count: meals.length, values, missing };
}

export function weeklySummary(end, meals, workouts, weights) {
  const dates = lastDays(end);
  const days = dates.map((date) => ({
    date,
    nutrition: nutritionTotals(meals.filter((meal) => meal.date === date)),
    minutes: workouts
      .filter((item) => item.date === date)
      .reduce((sum, item) => sum + item.minutes, 0),
    weight: weights.find((item) => item.date === date)?.kg ?? null,
  }));
  const loggedDays = days.filter((day) => day.nutrition.count > 0);
  const recordedWeights = days.filter((day) => day.weight !== null);
  return {
    days,
    mealDays: loggedDays.length,
    averageKcal: loggedDays.length
      ? round(
          loggedDays.reduce((sum, day) => sum + day.nutrition.values.kcal, 0) /
            loggedDays.length,
          0,
        )
      : null,
    incompleteCalories: loggedDays.some(
      (day) => day.nutrition.missing.kcal > 0,
    ),
    workoutMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
    workoutCount: workouts.filter((item) => dates.includes(item.date)).length,
    weightDays: recordedWeights.length,
    averageWeight: recordedWeights.length
      ? round(
          recordedWeights.reduce((sum, day) => sum + day.weight, 0) /
            recordedWeights.length,
        )
      : null,
  };
}

export function workoutPlan(date) {
  if (!isDateKey(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const dayOfWeek = new Date(year, month - 1, day, 12).getDay();
  const plans = {
    1: {
      label: "전신 근력",
      kind: "strength",
      minutes: 25,
      detail: "스쿼트·힙브리지·푸시업·로우 중 가능한 동작을 가볍게",
    },
    2: {
      label: "빠르게 걷기",
      kind: "walk",
      minutes: 35,
      detail: "대화가 가능한 강도로 걷기",
    },
    3: {
      label: "인요가",
      kind: "yoga",
      minutes: 60,
      detail: "19:00 · 초급 · 이완과 유연성",
    },
    4: {
      label: "빠르게 걷기",
      kind: "walk",
      minutes: 30,
      detail: "컨디션에 맞춰 시간 조절",
    },
    5: {
      label: "골반/어깨 테라피",
      kind: "yoga",
      minutes: 60,
      detail: "19:00 · 초급 · 회복과 가동성",
    },
    6: {
      label: "주말 걷기",
      kind: "walk",
      minutes: 50,
      detail: "가능하면 짧은 근력운동도 별도로 기록",
    },
  };
  return plans[dayOfWeek]
    ? { ...plans[dayOfWeek], key: `routine-${date}` }
    : null;
}

export function normalizeLegacyTask(raw, now = Date.now()) {
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text || text.length > 1000) return null;
  const timestamp =
    typeof raw.createdAt === "number"
      ? raw.createdAt
      : typeof raw.createdAt?.seconds === "number"
        ? raw.createdAt.seconds * 1000
        : now;
  const createdAt =
    Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 4133980800000
      ? timestamp
      : now;
  return {
    ...makeTask(
      {
        text,
        category: Object.hasOwn(CATEGORIES, raw.category)
          ? raw.category
          : "personal",
        completed: raw.completed === true,
        dueDate: isDateKey(raw.dueDate) ? raw.dueDate : "",
        createdAt,
      },
      Math.max(now, createdAt),
    ),
    legacySourceId: String(raw.id),
  };
}

export function filterTasks(tasks, filter, search, sort) {
  return tasks
    .filter(
      (task) =>
        (filter === "all" || task.category === filter) &&
        task.text
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (sort === "date-asc") return a.createdAt - b.createdAt;
      if (sort === "category")
        return (
          a.category.localeCompare(b.category) || b.createdAt - a.createdAt
        );
      return b.createdAt - a.createdAt;
    });
}
