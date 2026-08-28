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
  basalMetabolicRate,
  energyBalance,
  weightDriftKg,
  activityMinutes,
  exerciseOptions,
  portionFor,
  foodSuggestions,
  containersFor,
  containerAmount,
  describeContainer,
  containerEquivalent,
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
    52,
  );
  assert.equal(FOOD_CATALOG.length > 10000, true);
});
test("unsafe links are not rendered", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,example"), "");
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
});

test("basal metabolic rate needs every input and is resting energy only", () => {
  const on = new Date(2026, 7, 28);
  const profile = {
    sex: "female",
    birthYear: 1991,
    heightCm: 164.8,
    weightKg: 53.4,
  };
  // Mifflin-St Jeor: 10*53.4 + 6.25*164.8 - 5*35 - 161
  assert.equal(basalMetabolicRate(profile, on), 1228);
  assert.equal(basalMetabolicRate({ ...profile, sex: "male" }, on), 1394);

  // Anything missing or out of range yields null rather than a made-up number.
  for (const missing of [
    { sex: "" },
    { sex: "other" },
    { birthYear: null },
    { birthYear: 1800 },
    { heightCm: null },
    { heightCm: 40 },
    { weightKg: null },
    { weightKg: 5 },
  ])
    assert.equal(basalMetabolicRate({ ...profile, ...missing }, on), null);
  assert.equal(basalMetabolicRate(null, on), null);
});

test("energy balance is signed arithmetic and drift is a linear rule of thumb", () => {
  assert.equal(energyBalance(1800, null), null);
  assert.equal(energyBalance(Number.NaN, 1228), null);

  const over = energyBalance(1800, 1228);
  assert.equal(over.difference, 572);
  assert.equal(over.over, true);
  const under = energyBalance(1000, 1228);
  assert.equal(under.difference, -228);
  assert.equal(under.over, false);
  // Eating exactly the estimate is neither over nor under.
  assert.equal(energyBalance(1228, 1228).difference, 0);
  assert.equal(energyBalance(1228, 1228).over, false);

  assert.equal(weightDriftKg(572, 30), 2.23);
  assert.equal(weightDriftKg(-228, 30), -0.89);
  assert.equal(weightDriftKg(0, 30), 0);
  assert.equal(weightDriftKg(Number.NaN, 30), null);
});

test("activity minutes use the MET formula and refuse impossible inputs", () => {
  // 300 kcal at MET 8 for 53.4 kg: 300 / (8*3.5*53.4/200) = 40.1 min
  assert.equal(activityMinutes(300, 8, 53.4), 40);
  assert.equal(activityMinutes(300, 2.5, 53.4), 128);
  for (const bad of [
    [0, 8, 53.4],
    [-10, 8, 53.4],
    [300, 0, 53.4],
    [300, 8, 0],
    [Number.NaN, 8, 53.4],
    [300, 8, null],
  ])
    assert.equal(activityMinutes(...bad), null);
});

test("exercise options are sorted, capped in length and never absurdly long", () => {
  const options = exerciseOptions(300, 53.4);
  assert.equal(options.length, 3);
  assert.deepEqual(
    options.map((option) => option.minutes),
    [...options.map((option) => option.minutes)].sort((a, b) => a - b),
  );
  // Every option carries the compendium code so the number can be checked.
  assert.ok(options.every((option) => /^[0-9]{5}$/.test(option.code)));
  // A gap no realistic single session covers yields nothing rather than
  // suggesting hours of exercise.
  assert.deepEqual(exerciseOptions(5000, 53.4), []);
});

test("portions round to servable amounts and report the rounded calories", () => {
  const rice = { name: "밥", kcal: 130, baseAmount: 100, baseUnit: "g" };
  const bowl = { name: "비빔밥", kcal: 639, baseAmount: 1, baseUnit: "개" };
  assert.deepEqual(portionFor(400, rice), {
    food: rice,
    amount: 310,
    unit: "g",
    kcal: 403,
  });
  // Servings round to a half, not to three decimal places.
  assert.equal(portionFor(900, bowl).amount, 1.5);
  assert.equal(portionFor(0, rice), null);
  assert.equal(portionFor(400, { ...rice, kcal: 0 }), null);
});

test("food suggestions skip portions nobody would actually serve", () => {
  const banana = { name: "바나나", kcal: 89, baseAmount: 100, baseUnit: "g" };
  const rice = { name: "밥", kcal: 130, baseAmount: 100, baseUnit: "g" };
  // 400 kcal of banana is 450g; that is filtered out, rice at 310g stays.
  const picks = foodSuggestions(400, [banana, rice]);
  assert.deepEqual(
    picks.map((pick) => pick.food.name),
    ["밥"],
  );
  // Duplicates by name are collapsed.
  assert.equal(foodSuggestions(400, [rice, { ...rice }]).length, 1);
  assert.deepEqual(foodSuggestions(400, []), []);
});

test("alcohol is in the catalog and findable by the words people search", () => {
  const search = (term) =>
    FOOD_CATALOG.filter((food) =>
      `${food.name} ${food.keywords || ""}`.includes(term),
    );
  // 식약처 excludes alcohol, so these come from USDA and must be present.
  for (const term of ["맥주", "와인", "위스키", "청주"])
    assert.equal(search(term).length > 0, true, term);

  const beer = FOOD_CATALOG.find((food) => food.id === "usda-168746");
  assert.equal(beer.kcal, 43);
  assert.equal(beer.baseAmount, 100);
  // Beer carries its can and bottle sizes so it can be logged by container.
  assert.equal(beer.containers.length > 0, true);
  assert.ok(beer.containers.every((c) => c.ml > 0 && c.amount > 0));

  // 식약처 rows carry their classification in keywords, so a dish is findable
  // by a category word its own name never contains.
  const byCategory = FOOD_CATALOG.filter(
    (food) =>
      food.id.startsWith("mfds-") &&
      !food.name.includes("밥류") &&
      (food.keywords || "").includes("밥류"),
  );
  assert.equal(byCategory.length > 0, true);
});

test("containers convert between volume and the food's own unit", () => {
  const beer = FOOD_CATALOG.find((food) => food.id === "usda-168746");
  const can = beer.containers.find((c) => c.label === "캔 355ml");
  // USDA lists a 12 fl oz can of beer at 360 g, so a can is 360 g, not 355.
  assert.equal(can.amount, 360);
  assert.equal(containerAmount(can, 1), 360);
  assert.equal(containerAmount(can, 2), 720);
  assert.equal(describeContainer(can, 2), "710ml");

  const bottle = FOOD_CATALOG.find(
    (food) => food.id === "usda-173190",
  ).containers.find((c) => c.label === "병 750ml");
  // Half a bottle is the case the whole feature exists for.
  assert.equal(containerAmount(bottle, 0.5), 375);
  assert.equal(describeContainer(bottle, 0.5), "375ml");

  for (const bad of [0, -1, "", null, Number.NaN])
    assert.equal(containerAmount(can, bad), null);
  assert.equal(containerAmount(null, 1), null);
});

test("a millilitre food gets the standard containers, a solid gets none", () => {
  assert.equal(containersFor({ baseUnit: "ml" }).length > 0, true);
  // No published container weight means no guessing from a density.
  assert.deepEqual(containersFor({ baseUnit: "g" }), []);
  assert.deepEqual(containersFor({ baseUnit: "개" }), []);
  assert.deepEqual(containersFor(null), []);
});

test("a typed amount reports the container it comes to, or nothing", () => {
  const beer = FOOD_CATALOG.find((food) => food.id === "usda-168746");
  const wine = FOOD_CATALOG.find((food) => food.id === "usda-173190");
  assert.equal(containerEquivalent(beer, 720).count, 2);
  assert.match(containerEquivalent(beer, 720).text, /710ml/);
  assert.equal(containerEquivalent(wine, 375).ml, 375);
  // An amount that is not near any container count says nothing rather than
  // rounding it into a tidy-looking lie.
  assert.equal(containerEquivalent(beer, 123), null);
  assert.equal(containerEquivalent({ baseUnit: "개" }, 1), null);
  assert.equal(containerEquivalent(beer, 0), null);
});
