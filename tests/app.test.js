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
  assert.equal(f.store.listeners.length, 5);
  assert.ok(f.store.listeners.every((item) => item.uid === "alice"));
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
