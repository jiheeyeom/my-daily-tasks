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
