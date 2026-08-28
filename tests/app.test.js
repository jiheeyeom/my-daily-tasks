import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createApp } from "../js/app.js";
import { FOOD_CATALOG } from "../js/foods.js";
import { makeTask, makeMeal, makeWorkout, makeWeight } from "../js/domain.js";
import { refreshPublicContent } from "../js/news.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const USER = {
  uid: "alice",
  displayName: "Test User",
  email: "test@example.com",
};

class FakeStore {
  constructor() {
    this.rows = new Map();
    this.listeners = [];
    this.writes = [];
    this.sequence = 0;
    this.nextError = null;
    this.legacy = [];
    this.auth = null;
  }
  observeAuth(callback) {
    this.auth = callback;
    callback(null);
    return () => {
      this.auth = null;
    };
  }
  emitAuth(user) {
    this.auth?.(user);
  }
  async login() {
    this.emitAuth(USER);
  }
  async logout() {
    this.emitAuth(null);
  }
  list(uid, kind) {
    return this.rows.get(`${uid}/${kind}`) || [];
  }
  seed(uid, kind, rows) {
    this.rows.set(`${uid}/${kind}`, structuredClone(rows));
    this.notify(uid, kind);
  }
  watch(uid, kind, options, callback, onError) {
    const listener = { uid, kind, options, callback, onError, active: true };
    this.listeners.push(listener);
    this.emit(listener);
    return () => {
      listener.active = false;
    };
  }
  emit(listener, meta = { fromCache: false }) {
    const rows = this.list(listener.uid, listener.kind).filter(
      (row) =>
        !listener.options ||
        (row.date >= listener.options.start &&
          row.date <= listener.options.end),
    );
    listener.callback(structuredClone(rows), meta);
  }
  notify(uid, kind) {
    this.listeners
      .filter((item) => item.active && item.uid === uid && item.kind === kind)
      .forEach((item) => this.emit(item));
  }
  async saveIfAbsent(uid, kind, id, data) {
    if (this.list(uid, kind).some((row) => row.id === id)) return false;
    await this.save(uid, kind, id, data);
    return true;
  }
  async save(uid, kind, id, data) {
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    id ||= `record-${++this.sequence}`;
    this.writes.push({ uid, kind, id, data: structuredClone(data) });
    if (this.delay) await this.delay;
    this.seed(uid, kind, [
      ...this.list(uid, kind).filter((row) => row.id !== id),
      { ...data, id },
    ]);
    return id;
  }
  async remove(uid, kind, id) {
    this.seed(
      uid,
      kind,
      this.list(uid, kind).filter((row) => row.id !== id),
    );
  }
  async removeMany(uid, kind, ids) {
    this.seed(
      uid,
      kind,
      this.list(uid, kind).filter((row) => !ids.includes(row.id)),
    );
  }
  async readLegacy() {
    return structuredClone(this.legacy);
  }
  async importLegacy() {
    return { copied: 0, existing: 0, skipped: 0 };
  }
}

function fixture(t, overrides = {}) {
  const dom = new JSDOM(html, { url: "https://example.com/my-daily-tasks/" });
  const store = new FakeStore(),
    downloads = [];
  const app = createApp({
    document: dom.window.document,
    store,
    catalog: FOOD_CATALOG,
    config: {
      securityRulesConfigured: true,
      legacyOwnerUid: "alice",
      ...overrides,
    },
    now: () => new Date(2026, 7, 26, 12),
    confirm: () => true,
    download: (...args) => downloads.push(args),
    clipboard: { writeText: async () => {} },
  });
  t.after(() => {
    app.destroy();
    dom.window.close();
  });
  const $ = (id) => dom.window.document.getElementById(id);
  const event = (id, name) =>
    $(id).dispatchEvent(
      new dom.window.Event(name, { bubbles: true, cancelable: true }),
    );
  const value = (id, text, name = "input") => {
    $(id).value = text;
    event(id, name);
  };
  const submit = async (id) => {
    event(id, "submit");
    await tick();
  };
  return { dom, store, app, $, event, value, submit, downloads };
}

test("no auth means no subscriptions or visible private data; setup guard also blocks reads", (t) => {
  const f = fixture(t, { securityRulesConfigured: false });
  assert.equal(f.store.listeners.length, 0);
  assert.equal(f.$("private-app").hidden, true);
  f.store.emitAuth(USER);
  assert.equal(f.store.listeners.length, 0);
  assert.equal(f.$("setup-banner").hidden, false);
  assert.equal(f.$("account-uid").textContent, "alice");
  assert.equal(f.$("private-app").hidden, true);
});

test("login loads only UID-scoped paths and default yoga is Wednesday", (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  // tasks, foods, checkups, profile plus the three date-scoped health collections.
  assert.equal(f.store.listeners.length, 7);
  assert.ok(f.store.listeners.every((item) => item.uid === "alice"));
  assert.deepEqual(
    [...new Set(f.store.listeners.map((item) => item.kind))].sort(),
    ["checkups", "foods", "meals", "profile", "tasks", "weights", "workouts"],
  );
  assert.equal(f.$("private-app").hidden, false);
  assert.equal(f.$("day-kcal").textContent, "—");
  assert.match(f.$("plan-title").textContent, /인요가/);
  assert.equal(f.$("plan-check").checked, false);
  assert.equal(f.store.writes.length, 0);
});

test("meal selection/quantity creates a nutrition snapshot and updates day/week totals", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "150");
  assert.match(f.$("meal-preview").textContent, /195 kcal/);
  await f.submit("meal-form");
  const saved = f.store.writes.at(-1);
  assert.equal(saved.kind, "meals");
  assert.equal(saved.data.amount, 150);
  assert.equal(saved.data.food.kcal, 130);
  assert.equal("id" in saved.data.food, false);
  assert.equal(saved.data.unit, "g");
  assert.equal(f.$("day-kcal").textContent, "195 kcal");
  assert.equal(f.$("weekly-kcal").textContent, "195 kcal");
  assert.equal(f.$("meal-cancel").hidden, true);
});

test("a per-serving catalog food switches the meal unit away from grams", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  const latte = FOOD_CATALOG.find((food) => food.id === "usda-2710386");
  assert.equal(latte.baseUnit, "개");
  f.value("food-select", latte.id, "change");
  assert.equal(f.$("meal-unit").textContent, "개");
  assert.equal(f.$("meal-amount").value, "1");
  assert.equal(f.$("meal-amount").max, "100");
  assert.match(f.$("meal-preview").textContent, /206.4 kcal/);
  f.value("meal-amount", "0.75");
  assert.match(f.$("meal-preview").textContent, /154.8 kcal/);
  await f.submit("meal-form");
  const saved = f.store.writes.at(-1);
  assert.equal(saved.data.unit, "개");
  assert.equal(saved.data.amount, 0.75);
});

test("quick add fills the form from recent meals and pinned foods without writing", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  assert.equal(f.$("quick-add").hidden, true);

  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "210");
  f.value("meal-type", "lunch", "change");
  await f.submit("meal-form");
  const writes = f.store.writes.length;

  const chips = [...f.$("quick-add-list").children];
  assert.equal(f.$("quick-add").hidden, false);
  assert.equal(chips.length, 1);
  assert.match(chips[0].textContent, /210g/);

  f.value("food-select", "", "change");
  chips[0].click();
  assert.equal(f.$("meal-amount").value, "210");
  assert.equal(f.$("meal-type").value, "lunch");
  assert.match(f.$("meal-preview").textContent, /273 kcal/);
  assert.equal(f.store.writes.length, writes);

  f.$("food-favorite").click();
  assert.equal(f.$("food-favorite").getAttribute("aria-pressed"), "true");
  const pinned = [...f.$("quick-add-list").children];
  assert.equal(pinned.length, 1);
  assert.match(pinned[0].textContent, /^★/);
  assert.equal(f.store.writes.length, writes);
});

test("the food dropdown caps its options and keeps the selected food visible", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  const options = () => f.$("food-select").querySelectorAll("option").length;
  // One placeholder plus the cap; the full catalog is far larger.
  assert.equal(FOOD_CATALOG.length > 1000, true);
  assert.equal(options() <= 201, true);
  assert.match(f.$("food-count").textContent, /검색어를 좁혀/);

  f.value("food-search", "김치찌개");
  assert.match(f.$("food-count").textContent, /^[0-9,]+종$/);
  const listed = [...f.$("food-select").querySelectorAll("option")].filter(
    (option) => option.value,
  );
  assert.equal(listed.length > 0, true);
  assert.equal(
    listed.every((option) => option.textContent.includes("김치찌개")),
    true,
  );

  // Picking a food outside the first 200 and then clearing the search must keep
  // it selected, or the cap would silently drop the choice before submitting.
  const chosen = listed[0].value;
  assert.equal(
    FOOD_CATALOG.findIndex((food) => food.id === chosen) > 200,
    true,
  );
  f.value("food-select", chosen, "change");
  f.value("meal-amount", "1");
  await f.submit("meal-form");
  const saved = f.store.writes.at(-1);
  assert.equal(saved.kind, "meals");
  assert.match(saved.data.food.name, /김치찌개/);

  f.value("food-search", "");
  const chip = f.$("quick-add-list").children[0];
  chip.click();
  assert.equal(f.$("food-select").value, chosen);
  assert.match(f.$("meal-preview").textContent, /kcal/);
});

test("checkup import stores transcribed values, keeps blanks null and does not duplicate", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  assert.match(f.$("checkup-list").textContent, /아직 검진 기록이 없어요/);

  const payload = {
    dataset_type: "personal_health_checkups",
    general_checkups: [
      {
        year: 2023,
        exam_date: "2023-12-27",
        measurements: {
          height_cm: 165,
          weight_kg: 49,
          fasting_glucose_mg_dl: 107,
          total_cholesterol_mg_dl: null,
        },
      },
    ],
    other_screenings: [
      {
        type: "cervical_cytology",
        exam_date: "2025-08-14",
        reported_results: { cytology_diagnosis_ko: "음성" },
      },
    ],
  };
  const file = { text: async () => JSON.stringify(payload) };
  await f.app.importCheckups(file);
  await tick();

  const saved = f.store.writes.filter((item) => item.kind === "checkups");
  assert.equal(saved.length, 2);
  // The checkup weight also joins the weight log so it reaches the day view,
  // the 7-day average and the chart.
  const weights = f.store.writes.filter((item) => item.kind === "weights");
  assert.equal(weights.length, 1);
  assert.equal(weights[0].id, "2023-12-27");
  assert.equal(weights[0].data.kg, 49);
  assert.match(weights[0].data.note, /건강검진/);
  // The id comes from kind and date so a second import updates in place.
  assert.deepEqual(saved.map((item) => item.id).sort(), [
    "general_2023-12-27",
    "screening_2025-08-14",
  ]);
  const general = saved.find((item) => item.id === "general_2023-12-27").data;
  assert.equal(general.measurements.height_cm, 165);
  assert.equal(general.measurements.fasting_glucose_mg_dl, 107);
  // A blank result must stay null, never 0 and never "normal".
  assert.equal(general.measurements.total_cholesterol_mg_dl, null);
  assert.equal(general.measurements.ldl_cholesterol_mg_dl, null);
  assert.match(f.store.writes.at(-1).data.note, /음성/);

  await f.app.importCheckups(file);
  await tick();
  const ids = f.store.writes
    .filter((item) => item.kind === "checkups")
    .map((item) => item.id);
  assert.equal(new Set(ids).size, 2);
});

test("the checkup chart plots year.month points and breaks on missing results", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  assert.equal(f.$("checkup-trend").hidden, true);

  const measurements = (over) => ({
    height_cm: null,
    weight_kg: null,
    bmi_kg_m2: null,
    waist_cm: null,
    systolic_bp_mmhg: null,
    diastolic_bp_mmhg: null,
    hemoglobin_g_dl: null,
    fasting_glucose_mg_dl: null,
    total_cholesterol_mg_dl: null,
    hdl_cholesterol_mg_dl: null,
    triglycerides_mg_dl: null,
    ldl_cholesterol_mg_dl: null,
    creatinine_mg_dl: null,
    egfr_ml_min_1_73m2: null,
    ast_iu_l: null,
    alt_iu_l: null,
    ggt_iu_l: null,
    visual_acuity_left_decimal: null,
    visual_acuity_right_decimal: null,
    ...over,
  });
  f.store.seed(USER.uid, "checkups", [
    {
      id: "general_2023-12-27",
      date: "2023-12-27",
      kind: "general",
      label: "일반건강검진 2023",
      measurements: measurements({ weight_kg: 49, fasting_glucose_mg_dl: 107 }),
      note: "",
    },
    {
      id: "general_2025-12-23",
      date: "2025-12-23",
      kind: "general",
      label: "일반건강검진 2025",
      measurements: measurements({ weight_kg: 53 }),
      note: "",
    },
  ]);

  assert.equal(f.$("checkup-trend").hidden, false);
  const options = [...f.$("checkup-metric").options].map((o) => o.value);
  // Only metrics that actually have a value are offered.
  assert.deepEqual(options, ["weight_kg", "fasting_glucose_mg_dl"]);

  const labels = [...f.$("checkup-chart").querySelectorAll("text")].map(
    (node) => node.textContent,
  );
  assert.equal(labels.includes("2023.12"), true);
  assert.equal(labels.includes("2025.12"), true);
  assert.equal(f.$("checkup-chart").querySelectorAll("circle").length, 2);
  assert.equal(f.$("checkup-chart").querySelectorAll("polyline").length, 1);

  // A metric measured once cannot form a line, and must not be interpolated.
  f.value("checkup-metric", "fasting_glucose_mg_dl", "change");
  assert.equal(f.$("checkup-chart").querySelectorAll("polyline").length, 0);
  assert.match(f.$("checkup-chart").textContent, /한 번만 기록되어/);
  assert.match(f.$("checkup-chart").textContent, /107/);
});

test("the balance card waits for a profile, a weight and a meal", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  assert.equal(f.$("balance-result").hidden, true);
  assert.match(f.$("balance-empty").textContent, /내 기준/);

  f.value("profile-sex", "female", "change");
  f.value("profile-birth-year", "1991");
  f.value("profile-height", "164.8");
  await f.submit("body-profile-form");
  // Height and birth year alone are not enough: weight comes from the log.
  assert.equal(f.$("balance-result").hidden, true);

  f.store.seed(USER.uid, "weights", [
    { id: "2026-08-26", date: "2026-08-26", kg: 53.4, note: "" },
  ]);
  assert.equal(f.$("balance-result").hidden, true);
  assert.match(f.$("balance-empty").textContent, /먹은 것을 기록하면/);

  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");

  assert.equal(f.$("balance-result").hidden, false);
  assert.equal(f.$("balance-bmr").textContent, "1,228 kcal");
  assert.equal(f.$("balance-intake").textContent, "1,300 kcal");
  assert.equal(f.$("balance-diff").textContent, "+72 kcal");
  assert.match(f.$("balance-diff-note").textContent, /초과/);
  assert.match(f.$("balance-drift").textContent, /7일에 \+0.07kg/);
  assert.match(f.$("balance-drift").textContent, /30일에 \+0.28kg/);
  // It must never read as a target or a recommendation.
  assert.match(f.$("balance-drift").textContent, /어림 계산/);
});

test("the balance card falls back to the checkup height and shows a shortfall", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.value("profile-sex", "female", "change");
  f.value("profile-birth-year", "1991");
  await f.submit("body-profile-form");
  f.store.seed(USER.uid, "weights", [
    { id: "2026-08-26", date: "2026-08-26", kg: 53.4, note: "" },
  ]);
  f.store.seed(USER.uid, "checkups", [
    {
      id: "general_2025-12-23",
      date: "2025-12-23",
      kind: "general",
      label: "일반건강검진 2025",
      measurements: { height_cm: 164.8, weight_kg: 53 },
      note: "",
    },
  ]);
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "500");
  await f.submit("meal-form");

  assert.equal(f.$("balance-bmr").textContent, "1,228 kcal");
  assert.match(f.$("balance-basis").textContent, /검진 키/);
  assert.equal(f.$("balance-diff").textContent, "−578 kcal");
  assert.match(f.$("balance-diff-note").textContent, /미달/);
  assert.match(f.$("balance-drift").textContent, /30일에 −2.25kg/);
});

test("a hand-recorded weight is not overwritten by a checkup import", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.store.seed(USER.uid, "weights", [
    { id: "2023-12-27", date: "2023-12-27", kg: 50.2, note: "아침 측정" },
  ]);
  await f.app.importCheckups({
    text: async () =>
      JSON.stringify({
        dataset_type: "personal_health_checkups",
        general_checkups: [
          {
            exam_date: "2023-12-27",
            measurements: { height_cm: 165, weight_kg: 49 },
          },
        ],
      }),
  });
  await tick();
  assert.equal(
    f.store.writes.filter((item) => item.kind === "weights").length,
    0,
  );
  assert.equal(f.store.list(USER.uid, "weights")[0].kg, 50.2);
  assert.match(f.$("checkup-import-status").textContent, /검진 기록 1건/);
});

test("a calorie goal shows progress and marks going over without scolding", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.store.seed(USER.uid, "weights", [
    { id: "2026-08-26", date: "2026-08-26", kg: 53.4, note: "" },
  ]);
  f.value("profile-sex", "female", "change");
  f.value("profile-birth-year", "1991");
  f.value("profile-height", "164.8");
  f.value("profile-target", "1800");
  await f.submit("body-profile-form");
  await tick();

  const saved = f.store.writes.find((item) => item.kind === "profile");
  assert.equal(saved.id, "body");
  assert.equal(saved.data.targetKcal, 1800);
  assert.equal(saved.data.heightCm, 164.8);

  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");
  assert.equal(f.$("balance-goal").hidden, false);
  assert.match(f.$("balance-goal-left").textContent, /500 kcal 남음/);
  assert.equal(f.$("balance-goal-bar").dataset.over, "false");
  assert.match(
    f.$("balance-goal-note").textContent,
    /1,300 \/ 1,800 kcal \(72%\)/,
  );

  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");
  assert.match(f.$("balance-goal-left").textContent, /800 kcal 초과/);
  assert.equal(f.$("balance-goal-bar").dataset.over, "true");
  // The bar is capped so an overshoot cannot overflow its track.
  assert.equal(f.$("balance-goal-bar").style.width, "100%");
});

test("suggestions follow the goal: eat to fill a shortfall, move for an excess", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.store.seed(USER.uid, "weights", [
    { id: "2026-08-26", date: "2026-08-26", kg: 53.4, note: "" },
  ]);
  f.value("profile-sex", "female", "change");
  f.value("profile-birth-year", "1991");
  f.value("profile-height", "164.8");
  f.value("profile-target", "1800");
  await f.submit("body-profile-form");
  await tick();

  // 1,300 kcal logged against an 1,800 goal: 500 short, so food is offered.
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");
  assert.equal(f.$("balance-advice").hidden, false);
  assert.match(f.$("balance-advice-title").textContent, /500 kcal을 채운다면/);
  assert.equal(f.$("balance-advice-list").children.length > 0, true);
  assert.match(
    f.$("balance-advice-note").textContent,
    /권장 섭취량도 아니에요/,
  );

  // Now well past the goal: the same block switches to movement.
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");
  assert.match(
    f.$("balance-advice-title").textContent,
    /800 kcal만큼 움직인다면/,
  );
  const first = f.$("balance-advice-list").children[0].textContent;
  assert.match(first, /분/);
  // Every activity states the compendium code it came from.
  assert.match(first, /코드 [0-9]{5}/);
  assert.match(
    f.$("balance-advice-note").textContent,
    /섭취에서 빼지는 않아요/,
  );
});

test("landing near the goal suggests nothing at all", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.store.seed(USER.uid, "weights", [
    { id: "2026-08-26", date: "2026-08-26", kg: 53.4, note: "" },
  ]);
  f.value("profile-sex", "female", "change");
  f.value("profile-birth-year", "1991");
  f.value("profile-height", "164.8");
  f.value("profile-target", "1300");
  await f.submit("body-profile-form");
  await tick();
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");
  assert.equal(f.$("balance-goal").hidden, false);
  assert.equal(f.$("balance-advice").hidden, true);
});

test("no goal set means no goal bar", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.store.seed(USER.uid, "weights", [
    { id: "2026-08-26", date: "2026-08-26", kg: 53.4, note: "" },
  ]);
  f.value("profile-sex", "female", "change");
  f.value("profile-birth-year", "1991");
  f.value("profile-height", "164.8");
  await f.submit("body-profile-form");
  await tick();
  assert.equal(
    f.store.writes.find((i) => i.kind === "profile").data.targetKcal,
    null,
  );
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "1000");
  await f.submit("meal-form");
  assert.equal(f.$("balance-goal").hidden, true);
});

test("a file that is not a checkup export is rejected without writing", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  await f.app.importCheckups({ text: async () => '{"dataset_type":"other"}' });
  await tick();
  assert.equal(
    f.store.writes.filter((item) => item.kind === "checkups").length,
    0,
  );
  assert.match(f.$("checkup-import-status").textContent, /불러오지 못했어요/);

  await f.app.importCheckups({ text: async () => "not json at all" });
  await tick();
  assert.equal(
    f.store.writes.filter((item) => item.kind === "checkups").length,
    0,
  );
});

test("search puts name matches ahead of category-keyword matches", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.dom.window.fetch = async () => ({
    ok: true,
    json: async () => ({
      prefix: "mfdsp",
      source: "식약처 가공식품DB",
      sourceUrl: "https://various.foodsafetykorea.go.kr/nutrient/",
      rows: [
        // Name has no 맥주 in it; only the category does.
        ["카스 프레시", 49, 0.3, 3, 0, 100, "ml", "주류 맥주 발효주류"],
        // A supplement whose name contains 맥주 but is not a drink.
        ["맥주효모 비오틴", 333, 30, 40, 5, 100, "g", "건강기능식품"],
      ],
    }),
  });
  f.$("load-processed").click();
  await tick();

  f.value("food-search", "맥주");
  const listed = [...f.$("food-select").querySelectorAll("option")]
    .filter((option) => option.value)
    .map((option) => option.textContent);
  // The catalog already holds real 맥주 entries; the point is ordering.
  const cass = listed.findIndex((text) => text.includes("카스 프레시"));
  assert.equal(cass > -1, true);
  // Everything before the keyword-only match names 맥주 outright.
  assert.equal(
    listed.slice(0, cass).every((text) => text.includes("맥주")),
    true,
  );
  assert.match(listed[0], /맥주/);
});

test("processed foods load only when asked and then join the catalog", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  const requests = [];
  f.dom.window.fetch = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => ({
        prefix: "mfdsp",
        source: "식약처 가공식품DB",
        sourceUrl: "https://various.foodsafetykorea.go.kr/nutrient/",
        rows: [["테스트 과자 · 1회분 30g", 150, 2, 20, 7, 1, "개", "과자류"]],
      }),
    };
  };
  // Nothing is fetched until the user asks: the file is several megabytes.
  assert.equal(requests.length, 0);

  f.$("load-processed").click();
  await tick();
  assert.deepEqual(requests, ["./data/foods-processed.json"]);
  assert.equal(f.$("load-processed").hidden, true);

  f.value("food-search", "테스트 과자");
  const listed = [...f.$("food-select").querySelectorAll("option")].filter(
    (option) => option.value,
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].value, "mfdsp-0");
  f.value("food-select", "mfdsp-0", "change");
  assert.equal(f.$("meal-unit").textContent, "개");
  assert.match(f.$("meal-preview").textContent, /150 kcal/);
});

test("a failed processed-food download leaves the button usable", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.dom.window.fetch = async () => ({ ok: false, status: 503 });
  f.$("load-processed").click();
  await tick();
  assert.equal(f.$("load-processed").disabled, false);
  assert.equal(f.$("load-processed").hidden, false);
  assert.match(f.$("processed-status").textContent, /불러오지 못했어요/);
});

test("custom food supports ml, missing macros and true zero calories", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.value("custom-food-name", "My drink");
  f.value("custom-base-amount", "250");
  f.value("custom-base-unit", "ml", "change");
  f.value("custom-kcal", "0");
  await f.submit("food-form");
  const food = f.store.writes[0].data;
  assert.equal(food.protein, null);
  assert.equal(food.kcal, 0);
  assert.equal(food.baseUnit, "ml");
  assert.equal(f.$("meal-unit").textContent, "ml");
  assert.equal(f.$("meal-amount").value, "250");
  await f.submit("meal-form");
  assert.equal(f.$("day-kcal").textContent, "0 kcal");
  assert.equal(f.$("day-protein").textContent, "—");
  assert.match(f.$("day-protein-note").textContent, /정보 없음/);
  assert.equal(f.$("weekly-kcal").textContent, "0 kcal");
  assert.match(f.$("weekly-meal-days").textContent, /1\/7/);
});

test("failed and invalid writes preserve input and never report success", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.value("food-select", "usda-168932", "change");
  f.value("meal-amount", "0");
  await f.submit("meal-form");
  assert.equal(f.store.writes.length, 0);
  assert.equal(f.$("snackbar").dataset.error, "true");
  f.value("meal-amount", "100");
  f.store.nextError = { code: "permission-denied" };
  await f.submit("meal-form");
  assert.equal(f.store.writes.length, 0);
  assert.equal(f.$("meal-amount").value, "100");
  assert.match(f.$("snackbar").textContent, /접근 권한/);
  assert.equal(f.$("meal-submit").disabled, false);
});

test("double submit is blocked while pending; sign-out clears DOM and ignores late snapshots", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.value("food-select", "usda-168932", "change");
  let resolve;
  f.store.delay = new Promise((done) => {
    resolve = done;
  });
  f.event("meal-form", "submit");
  f.event("meal-form", "submit");
  assert.equal(f.store.writes.length, 1);
  assert.equal(f.$("meal-submit").disabled, true);
  const oldListener = f.store.listeners.find((item) => item.kind === "meals");
  f.store.emitAuth({ uid: "bob", displayName: "Second account" });
  assert.equal(f.$("day-kcal").textContent, "—");
  assert.equal(f.$("meal-amount").value, "100");
  oldListener.callback(
    [
      {
        id: "late",
        ...makeMeal({
          date: "2026-08-26",
          mealType: "lunch",
          food: FOOD_CATALOG[0],
          amount: 500,
        }),
      },
    ],
    { fromCache: false },
  );
  assert.equal(f.$("day-kcal").textContent, "—");
  resolve();
  await tick();
  assert.equal(f.$("day-kcal").textContent, "—");
  assert.equal(f.$("snackbar").hidden, true);
  f.$("logout-btn").click();
  await tick();
  assert.equal(f.$("private-app").hidden, true);
  assert.equal(f.$("account-uid").textContent, "");
  assert.ok(f.store.listeners.every((item) => !item.active));
  assert.equal(f.dom.window.localStorage.length, 0);
});

test("date changes unsubscribe previous range and ignore late date callbacks", (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  const old = f.store.listeners.find((item) => item.kind === "weights");
  f.value("health-date", "2026-08-21", "change");
  assert.match(f.$("plan-title").textContent, /골반\/어깨/);
  assert.equal(old.active, false);
  old.callback([
    { id: "2026-08-21", ...makeWeight({ date: "2026-08-21", kg: 68 }) },
  ]);
  assert.equal(f.$("day-weight").textContent, "—");
  f.value("health-date", "2026-08-30", "change");
  assert.equal(f.$("health-date").value, "2026-08-21");
});

test("routine completion is explicit and can be updated, then deleted", async (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  f.$("plan-check").checked = true;
  f.event("plan-check", "change");
  await tick();
  const saved = f.store.writes.at(-1);
  assert.equal(saved.id, "routine-2026-08-26");
  assert.equal(saved.data.minutes, 60);
  assert.equal(f.$("plan-check").checked, true);
  assert.equal(f.$("day-workout").textContent, "60 분");
  f.$("workout-list").querySelector("button").click();
  f.value("workout-minutes", "45");
  await f.submit("workout-form");
  assert.equal(f.store.writes.at(-1).id, "routine-2026-08-26");
  assert.equal(f.$("day-workout").textContent, "45 분");
  f.$("plan-check").checked = false;
  f.event("plan-check", "change");
  await tick();
  assert.equal(f.store.list("alice", "workouts").length, 0);
  assert.equal(f.$("day-workout").textContent, "—");
});

test("one weight per date is replaced, not duplicated, and 7-day average uses measured days", async (t) => {
  const f = fixture(t);
  f.store.seed("alice", "weights", [
    { id: "2026-08-25", ...makeWeight({ date: "2026-08-25", kg: 70 }) },
  ]);
  f.store.emitAuth(USER);
  f.value("weight-kg", "68");
  f.value("weight-note", "Test measurement");
  await f.submit("weight-form");
  assert.equal(f.$("weekly-weight").textContent, "69 kg");
  f.value("weight-kg", "69");
  await f.submit("weight-form");
  assert.equal(f.store.list("alice", "weights").length, 2);
  assert.equal(f.$("weekly-weight").textContent, "69.5 kg");
  f.$("weight-delete").click();
  await tick();
  assert.equal(f.$("weight-kg").value, "");
  assert.equal(f.$("weekly-weight").textContent, "70 kg");
});

test("task HTML is text, edit preserves migration metadata, and calendar/filter work", async (t) => {
  const f = fixture(t);
  f.store.seed("alice", "tasks", [
    {
      id: "one",
      legacySourceId: "original",
      ...makeTask({
        text: "<img src=x onerror=alert(1)>",
        category: "work",
        dueDate: "2026-08-26",
      }),
    },
  ]);
  f.store.emitAuth(USER);
  assert.equal(f.$("task-list").querySelector("img"), null);
  assert.match(f.$("task-list").textContent, /<img/);
  f.$("task-list").querySelector("button").click();
  const editor = f.$("task-list").querySelector("form");
  editor.querySelector('input[type="text"]').value = "Edited";
  editor.dispatchEvent(
    new f.dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert.equal(f.store.writes.at(-1).data.legacySourceId, "original");
  assert.equal(f.$("task-list").querySelector("form"), null);
  f.$("view-toggle").click();
  assert.equal(f.$("calendar-view").hidden, false);
  assert.match(f.$("calendar-grid").textContent, /Edited/);
  f.value("search-input", "no match");
  assert.equal(f.$("calendar-grid").querySelectorAll("button").length, 0);
});

test("permission error clears scoped data and disables that resource's writes", (t) => {
  const f = fixture(t);
  f.store.emitAuth(USER);
  const watcher = f.store.listeners.find((item) => item.kind === "meals");
  watcher.onError({ code: "permission-denied" });
  assert.equal(f.$("sync-error").hidden, false);
  assert.equal(f.$("meal-submit").disabled, true);
  assert.equal(f.$("day-kcal").textContent, "—");
});

test("legacy import requires backup and only configured owner can see it", async (t) => {
  const f = fixture(t);
  f.store.legacy = [{ id: "old", text: "Original task" }];
  f.store.emitAuth(USER);
  assert.equal(f.$("legacy-section").hidden, false);
  assert.equal(f.$("legacy-import").disabled, true);
  f.$("legacy-load").click();
  await tick();
  assert.equal(f.$("legacy-actions").hidden, false);
  f.$("legacy-backup").click();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0][1].tasks[0].text, "Original task");
  assert.equal(f.$("legacy-import").disabled, false);
  f.store.emitAuth({ uid: "bob" });
  assert.equal(f.$("legacy-section").hidden, true);
  assert.equal(f.$("legacy-import").disabled, true);
});

test("RSS title markup and unsafe URLs cannot execute HTML or script", async (t) => {
  const f = fixture(t);
  const rss =
    "<rss><channel><item><title>&lt;img src=x onerror=alert(1)&gt;</title><link>https://example.com/news</link></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>";
  await refreshPublicContent(f.dom.window.document, async (url) => ({
    ok: true,
    json: async () =>
      url.includes("gist.") ? ["Example quote"] : { contents: rss },
  }));
  assert.equal(f.$("kr-news-list").querySelectorAll("a").length, 1);
  assert.equal(f.$("kr-news-list").querySelector("img"), null);
  assert.match(f.$("daily-news").textContent, /<img/);
  assert.equal(f.$("daily-news").querySelector("img"), null);
});
