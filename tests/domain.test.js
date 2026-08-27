import test from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  isDateKey,
  shiftDate,
  lastDays,
  numberValue,
  foodSnapshot,
  calculateNutrition,
  makeMeal,
  makeWeight,
  makeWorkout,
  makeTask,
  nutritionTotals,
  weeklySummary,
  workoutPlan,
  normalizeLegacyTask,
  filterTasks,
  safeUrl,
} from "../js/domain.js";
import { FOOD_CATALOG } from "../js/foods.js";
import { copyLegacyTasks } from "../js/migration.js";

test("re-running legacy migration preserves original records and edited copies", async () => {
  const rows = [
    {
      id: "a",
      text: "Original",
      category: "work",
      completed: true,
      dueDate: "2026-08-20",
      createdAt: 123,
    },
    { id: "bad", text: "" },
  ];
  const before = structuredClone(rows),
    target = new Map();
  const copy = async (id, data) => {
    if (target.has(id)) return false;
    target.set(id, data);
    return true;
  };
  assert.deepEqual(await copyLegacyTasks(rows, copy), {
    copied: 1,
    existing: 0,
    skipped: 1,
  });
  target.get("legacy_a").text = "Edited after migration";
  assert.deepEqual(await copyLegacyTasks(rows, copy), {
    copied: 0,
    existing: 1,
    skipped: 1,
  });
  assert.equal(target.get("legacy_a").text, "Edited after migration");
  assert.equal(target.get("legacy_a").completed, true);
  assert.deepEqual(rows, before);
});

test("migration resumes after interruption without duplicate copies", async () => {
  const rows = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    target = new Map();
  await assert.rejects(
    copyLegacyTasks(rows, async (id, data) => {
      if (id === "legacy_b") throw new Error("offline");
      target.set(id, data);
      return true;
    }),
    /offline/,
  );
  const result = await copyLegacyTasks(rows, async (id, data) => {
    if (target.has(id)) return false;
    target.set(id, data);
    return true;
  });
  assert.deepEqual(result, { copied: 1, existing: 1, skipped: 0 });
  assert.equal(target.size, 2);
});

const food = {
  name: "Test yogurt",
  baseAmount: 150,
  baseUnit: "g",
  kcal: 120,
  protein: 12,
  carbs: 9,
  fat: 4,
  source: "Test label",
};
test("nutrition scales from label basis, without rounding before summation", () => {
  assert.deepEqual(calculateNutrition(food, 225), {
    kcal: 180,
    protein: 18,
    carbs: 13.5,
    fat: 6,
  });
  const meal = makeMeal({
    date: "2026-08-20",
    mealType: "breakfast",
    food,
    amount: 50,
  });
  assert.equal(nutritionTotals([meal, meal, meal]).values.kcal, 120);
});
test("g, ml and pieces stay distinct", () => {
  assert.throws(() => calculateNutrition(food, 100, "ml"), /같은 단위/);
  const piece = { ...food, baseAmount: 1, baseUnit: "개" };
  assert.equal(calculateNutrition(piece, 0.5).kcal, 60);
  assert.throws(() => calculateNutrition(piece, 101), /범위/);
  assert.equal(calculateNutrition({ ...food, baseUnit: "ml" }, 150).kcal, 120);
});
test("missing macros remain null and are not counted as zero data", () => {
  const snapshot = foodSnapshot({
    ...food,
    protein: "",
    carbs: undefined,
    fat: 0,
  });
  assert.equal(snapshot.protein, null);
  assert.equal(snapshot.carbs, null);
  assert.equal(snapshot.fat, 0);
  const meal = makeMeal({
    date: "2026-08-20",
    mealType: "lunch",
    food: snapshot,
    amount: 150,
  });
  assert.equal(nutritionTotals([meal]).missing.protein, 1);
  assert.equal(nutritionTotals([meal]).missing.fat, 0);
});
test("input validation rejects NaN, infinity, empties, zero quantities and bad enums", () => {
  for (const value of [
    "",
    " ",
    null,
    undefined,
    "NaN",
    NaN,
    Infinity,
    -1,
    true,
    {},
  ])
    assert.throws(() => numberValue(value, "value", { min: 0.1 }));
  for (const value of [0, -5, 5001])
    assert.throws(() => calculateNutrition(food, value));
  assert.throws(() => foodSnapshot({ ...food, baseAmount: 0 }));
  assert.throws(() =>
    makeMeal({ date: "2026-08-20", mealType: "invalid", food, amount: 100 }),
  );
  assert.throws(() => makeWeight({ date: "2026-08-20", kg: 0 }));
  assert.throws(() =>
    makeWorkout({
      date: "2026-08-20",
      label: "walk",
      kind: "walk",
      minutes: 0,
    }),
  );
  assert.throws(() => makeTask({ text: "  ", category: "work" }));
});
test("dates are local, validated and cross month/year/leap boundaries correctly", () => {
  assert.equal(dateKey(new Date(2026, 7, 20, 0, 1)), "2026-08-20");
  for (const key of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-8-20",
    "2026-00-12",
    "1999-12-31",
  ])
    assert.equal(isDateKey(key), false);
  assert.equal(isDateKey("2024-02-29"), true);
  assert.equal(shiftDate("2024-03-01", -1), "2024-02-29");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
  assert.deepEqual(lastDays("2026-01-03", 3), [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
  ]);
});
test("week average excludes unlogged days, not true zero-calorie entries", () => {
  const meals = [
    makeMeal({ date: "2026-08-20", mealType: "lunch", food, amount: 150 }),
    makeMeal({
      date: "2026-08-19",
      mealType: "snack",
      food: { ...food, kcal: 0 },
      amount: 150,
    }),
  ];
  const weights = [
    makeWeight({ date: "2026-08-20", kg: 68 }),
    makeWeight({ date: "2026-08-19", kg: 70 }),
    makeWeight({ date: "2026-08-01", kg: 80 }),
  ];
  const workouts = [
    makeWorkout({
      date: "2026-08-20",
      label: "walk",
      kind: "walk",
      minutes: 30,
    }),
  ];
  const summary = weeklySummary("2026-08-20", meals, workouts, weights);
  assert.equal(summary.averageKcal, 60);
  assert.equal(summary.mealDays, 2);
  assert.equal(summary.averageWeight, 69);
  assert.equal(summary.weightDays, 2);
  assert.equal(summary.workoutMinutes, 30);
  assert.equal(summary.days[0].weight, null);
  assert.equal(weeklySummary("2026-08-20", [], [], []).averageKcal, null);
});
test("a meal keeps an immutable nutrition snapshot and strips catalog-only metadata", () => {
  const reference = { ...food, id: "custom-1", keywords: "test" };
  const meal = makeMeal({
    date: "2026-08-20",
    mealType: "lunch",
    food: reference,
    amount: 100,
  });
  reference.kcal = 900;
  assert.equal(meal.food.kcal, 120);
  assert.equal("id" in meal.food, false);
  assert.equal("keywords" in meal.food, false);
});
test("yoga is Wednesday and Friday; Sunday has no automatic completed workout", () => {
  assert.equal(workoutPlan("2026-08-19").label, "인요가");
  assert.equal(workoutPlan("2026-08-21").label, "골반/어깨 테라피");
  assert.equal(workoutPlan("2026-08-17").kind, "strength");
  assert.equal(workoutPlan("2026-08-23"), null);
});
test("legacy migration preserves state, category, date and creation timestamp", () => {
  const result = normalizeLegacyTask(
    {
      id: "abc",
      text: "Original",
      category: "work",
      completed: true,
      dueDate: "2026-08-20",
      createdAt: 123,
    },
    1000,
  );
  assert.deepEqual(result, {
    text: "Original",
    category: "work",
    completed: true,
    dueDate: "2026-08-20",
    createdAt: 123,
    updatedAt: 1000,
    legacySourceId: "abc",
  });
  assert.equal(normalizeLegacyTask({ id: "bad", text: "" }), null);
  const fallback = normalizeLegacyTask(
    {
      id: "old",
      text: "Old",
      category: "unknown",
      dueDate: "bad",
      createdAt: { seconds: 2 },
    },
    10000,
  );
  assert.equal(fallback.createdAt, 2000);
  assert.equal(fallback.category, "personal");
  assert.equal(fallback.dueDate, "");
  const future = normalizeLegacyTask(
    { id: "future", text: "Clock was ahead", createdAt: 20000 },
    10000,
  );
  assert.equal(future.createdAt, 20000);
  assert.equal(future.updatedAt, 20000);
});
test("filter/search/sort keep completed last and do not mutate the input", () => {
  const rows = [
    { id: "a", text: "Hello", category: "work", completed: true, createdAt: 3 },
    {
      id: "b",
      text: "hello 2",
      category: "work",
      completed: false,
      createdAt: 2,
    },
    {
      id: "c",
      text: "study",
      category: "study",
      completed: false,
      createdAt: 1,
    },
  ];
  assert.deepEqual(
    filterTasks(rows, "work", "HELLO", "date-desc").map((x) => x.id),
    ["b", "a"],
  );
  assert.deepEqual(
    filterTasks(rows, "all", "", "date-asc").map((x) => x.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    rows.map((x) => x.id),
    ["a", "b", "c"],
  );
});
test("built-in foods have explicit sources, numeric nutrition and a valid base per unit", () => {
  const ids = new Set();
  for (const item of FOOD_CATALOG) {
    assert.equal(ids.has(item.id), false);
    ids.add(item.id);
    if (item.baseUnit === "개") {
      // A serving is only meaningful if its name states the weight it stands for.
      assert.equal(item.baseAmount, 1);
      assert.match(item.name, /[0-9]+(\.[0-9]+)?(g|ml|mg)/);
    } else {
      assert.equal(item.baseAmount, 100);
      assert.equal(["g", "ml"].includes(item.baseUnit), true);
    }
    assert.equal(Number.isFinite(item.kcal) && item.kcal >= 0, true);
    // Macros may be null: the source leaves them blank and null must not be
    // counted as a true zero.
    for (const key of ["protein", "carbs", "fat"])
      assert.equal(
        item[key] === null || (Number.isFinite(item[key]) && item[key] >= 0),
        true,
      );
    assert.equal(safeUrl(item.sourceUrl), item.sourceUrl);
    assert.equal(item.source.length > 0, true);
    assert.equal(calculateNutrition(item, item.baseAmount).kcal, item.kcal);
  }
  // The hand-curated part is pinned; the generated 식약처 rows only need to be
  // present, since regenerating the workbook changes their count.
  assert.equal(
    FOOD_CATALOG.filter((item) => !item.id.startsWith("mfds")).length,
    42,
  );
  assert.equal(FOOD_CATALOG.length > 10000, true);
});
test("unsafe links are not rendered", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,example"), "");
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
});
