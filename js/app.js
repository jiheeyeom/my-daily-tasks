import {
  CATEGORIES,
  MEAL_TYPES,
  WORKOUT_TYPES,
  dateKey,
  isDateKey,
  shiftDate,
  formatDate,
  round,
  safeUrl,
  foodSnapshot,
  calculateNutrition,
  containersFor,
  containerAmount,
  describeContainer,
  containerEquivalent,
  makeMeal,
  makeTask,
  makeWorkout,
  makeWeight,
  makeCheckup,
  checkupId,
  makeBodyProfile,
  BODY_PROFILE_ID,
  basalMetabolicRate,
  energyBalance,
  weightDriftKg,
  foodSuggestions,
  exerciseOptions,
  KCAL_PER_KG,
  CHECKUP_METRICS,
  CHECKUP_KINDS,
  nutritionTotals,
  weeklySummary,
  workoutPlan,
  filterTasks,
} from "./domain.js";

export function friendlyError(error) {
  const messages = {
    "auth/popup-closed-by-user":
      "로그인 창이 닫혔어요. 다시 시도할 수 있습니다.",
    "auth/cancelled-popup-request": "이미 열린 로그인 창을 확인해 주세요.",
    "auth/popup-blocked":
      "로그인 팝업이 차단됐어요. 팝업을 허용하거나 일반 브라우저에서 열어 주세요.",
    "auth/unauthorized-domain":
      "Firebase에 이 사이트 도메인을 승인해야 합니다. 설정 안내를 확인해 주세요.",
    "auth/operation-not-allowed":
      "Firebase에서 Google 로그인을 먼저 사용 설정해 주세요.",
    "auth/network-request-failed":
      "네트워크 연결을 확인하고 다시 시도해 주세요.",
    "permission-denied":
      "기록 접근 권한이 없습니다. Firebase UID와 보안 규칙을 확인해 주세요.",
    unavailable:
      "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
    "resource-exhausted":
      "Firebase 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  };
  return (
    messages[error?.code] ||
    error?.message ||
    "처리하지 못했어요. 다시 시도해 주세요."
  );
}

export function createApp({
  document: doc,
  store,
  catalog = [],
  config,
  now = () => new Date(),
  confirm: ask = (message) => doc.defaultView.confirm(message),
  download: downloadFile,
  clipboard,
} = {}) {
  const win = doc.defaultView;
  const $ = (id) => doc.getElementById(id);
  const dataKeys = [
    "tasks",
    "foods",
    "meals",
    "workouts",
    "weights",
    "checkups",
    "profile",
  ];
  const state = {
    user: null,
    epoch: 0,
    healthEpoch: 0,
    date: dateKey(now()),
    data: {},
    sync: {},
    tab: "tasks",
    filter: "all",
    search: "",
    sort: "date-desc",
    calendar: false,
    calendarDate: new Date(now().getFullYear(), now().getMonth(), 1, 12),
    editingMeal: null,
    weightDirty: false,
    editingWorkout: null,
    editingTask: null,
    temporaryFood: null,
    legacy: [],
    backedUp: false,
  };
  const busy = new Set();
  let subscriptions = [],
    healthSubscriptions = [],
    timer;
  const listeners = [];
  const on = (element, event, fn) => {
    element.addEventListener(event, fn);
    listeners.push(() => element.removeEventListener(event, fn));
  };
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (label, fn, className = "text-btn") => {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", fn);
    return node;
  };
  const setText = (id, text) => {
    $(id).textContent = text;
  };
  const isCurrent = (epoch) => epoch === state.epoch;
  const fmt = (number, digits = 1) =>
    new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(
      number,
    );
  const preference = (key, value) => {
    try {
      if (value !== undefined)
        win.localStorage.setItem(`myDailyTasks_${key}`, value);
      else return win.localStorage.getItem(`myDailyTasks_${key}`);
    } catch {
      /* Private browsing may disable preference storage. */
    }
  };
  // The 가공식품 workbook is ~5MB, so it is fetched only when asked for. The
  // choice is remembered per device and the browser caches the file itself.
  let processedFoods = [],
    processedLoading = false;
  async function loadProcessedFoods(remember = true) {
    if (processedFoods.length || processedLoading) return;
    processedLoading = true;
    $("load-processed").disabled = true;
    setText("processed-status", "가공식품 목록을 불러오는 중…");
    try {
      const response = await win.fetch("./data/foods-processed.json");
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      processedFoods = payload.rows.map(
        ([name, kcal, protein, carbs, fat, baseAmount, baseUnit, group], i) =>
          Object.freeze({
            id: `${payload.prefix}-${i}`,
            name,
            kcal,
            protein,
            carbs,
            fat,
            keywords: group,
            baseAmount,
            baseUnit,
            source: payload.source,
            sourceUrl: payload.sourceUrl,
          }),
      );
      if (remember) preference("loadProcessedFoods", "1");
      $("load-processed").hidden = true;
      setText(
        "processed-status",
        `가공식품 ${fmt(processedFoods.length, 0)}종을 불러왔어요.`,
      );
      renderFoods();
    } catch {
      $("load-processed").disabled = false;
      setText(
        "processed-status",
        "가공식품 목록을 불러오지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.",
      );
    } finally {
      processedLoading = false;
    }
  }

  const availableFoods = () => [
    ...state.data.foods.map((food) => ({ ...food, id: `custom:${food.id}` })),
    ...catalog,
    ...processedFoods,
    ...(state.temporaryFood ? [state.temporaryFood] : []),
  ];
  const selectedFood = () =>
    availableFoods().find((food) => food.id === $("food-select").value);

  // Pinned foods are a per-device convenience, not synced health data, so they
  // stay in localStorage. Storage can throw or be empty; that is not an error.
  const favoritesKey = () => `favorites_${state.user?.uid ?? ""}`;
  function favorites() {
    if (!state.user) return [];
    try {
      const raw = JSON.parse(preference(favoritesKey()) || "[]");
      return Array.isArray(raw)
        ? raw.filter((id) => typeof id === "string").slice(0, 20)
        : [];
    } catch {
      return [];
    }
  }
  function toggleFavorite(id) {
    if (!state.user || !id) return;
    const current = favorites();
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [id, ...current].slice(0, 20);
    preference(favoritesKey(), JSON.stringify(next));
    renderQuickAdd();
    renderFavoriteButton();
  }
  function renderFavoriteButton() {
    const target = $("food-favorite"),
      food = selectedFood(),
      pinned = !!food && favorites().includes(food.id);
    target.disabled = !food;
    target.setAttribute("aria-pressed", String(pinned));
    setText(target.id, pinned ? "★ 고정됨" : "☆ 고정");
  }

  // Quick picks fill the form only. Writing a meal stays an explicit submit so
  // a stray tap cannot create a record.
  function quickPick(food, amount, mealType) {
    state.temporaryFood = catalog.some((item) => item.id === food.id)
      ? null
      : { ...food, id: "saved-meal" };
    $("food-search").value = "";
    if (mealType) $("meal-type").value = mealType;
    renderFoods(state.temporaryFood ? "saved-meal" : food.id);
    $("meal-amount").value = amount ?? food.baseAmount;
    previewMeal();
    renderFavoriteButton();
    $("meal-amount").focus();
  }

  function renderQuickAdd() {
    const list = $("quick-add-list");
    list.replaceChildren();
    if (!state.user) {
      $("quick-add").hidden = true;
      return;
    }
    const foods = availableFoods(),
      picks = [],
      seen = new Set();
    const add = (food, amount, mealType, pinned) => {
      const key = food.id || food.name;
      if (seen.has(key) || picks.length >= 10) return;
      seen.add(key);
      picks.push({ food, amount, mealType, pinned });
    };
    for (const id of favorites()) {
      const food = foods.find((item) => item.id === id);
      if (food) add(food, food.baseAmount, null, true);
    }
    const recent = [...(state.data.meals || [])].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    for (const meal of recent) {
      if (!meal.food?.name) continue;
      // Resolve the stored snapshot back to the real food so pinning it keeps a
      // stable id. A food that has since been deleted falls back to the snapshot.
      const food =
        foods.find((item) => item.name === meal.food.name) ?? meal.food;
      add(food, meal.amount, meal.mealType, false);
    }
    for (const pick of picks) {
      const label = `${pick.pinned ? "★ " : ""}${pick.food.name} · ${pick.amount}${pick.food.baseUnit}`;
      const chip = button(
        label,
        () => quickPick(pick.food, pick.amount, pick.mealType),
        `chip${pick.pinned ? " chip-pinned" : ""}`,
      );
      chip.title = `${pick.food.name} ${pick.amount}${pick.food.baseUnit} 입력하기`;
      list.append(chip);
    }
    $("quick-add").hidden = picks.length === 0;
  }

  function toast(message, error = false) {
    win.clearTimeout(timer);
    const target = $("snackbar");
    target.textContent = message;
    target.dataset.error = String(error);
    target.hidden = false;
    timer = win.setTimeout(
      () => {
        target.hidden = true;
      },
      error ? 9000 : 4500,
    );
  }

  function canUse(kind) {
    return Boolean(
      state.user &&
      config.securityRulesConfigured &&
      state.sync[kind]?.server &&
      !state.sync[kind]?.error,
    );
  }

  function controls() {
    const groups = {
      task: ["task-form", "tasks"],
      meal: ["meal-form", "meals"],
      food: ["food-form", "foods"],
      workout: ["workout-form", "workouts"],
      weight: ["weight-form", "weights"],
    };
    for (const [key, [id, kind]] of Object.entries(groups)) {
      const disabled = busy.has(key) || !canUse(kind);
      for (const input of $(id).querySelectorAll("input,select,button"))
        input.disabled = disabled;
    }
    for (const [id, kind, key] of [
      ["task-list", "tasks", "task"],
      ["calendar-grid", "tasks", "task"],
      ["meal-list", "meals", "meal"],
      ["custom-food-list", "foods", "food"],
      ["workout-list", "workouts", "workout"],
    ]) {
      for (const input of $(id).querySelectorAll("input,select,button"))
        input.disabled = !canUse(kind) || busy.has(key);
    }
    $("plan-check").disabled =
      !canUse("workouts") || busy.has("workout") || !workoutPlan(state.date);
    $("delete-completed-btn").disabled =
      !canUse("tasks") ||
      busy.has("task") ||
      !state.data.tasks.some((task) => task.completed);
    $("legacy-load").disabled = busy.has("legacy");
    $("legacy-import").disabled = busy.has("legacy") || !state.backedUp;
    $("legacy-backup").disabled = busy.has("legacy");
    const changingRecord = [...busy].some((key) =>
      ["meal", "workout", "weight"].includes(key),
    );
    $("health-date").disabled = changingRecord;
    $("health-prev").disabled = changingRecord || state.date <= "2000-01-01";
    $("health-next").disabled = changingRecord || state.date >= dateKey(now());
    $("health-today").disabled = changingRecord;
  }

  async function action(key, kind, work, success) {
    // Every refusal says why. A button that silently does nothing is
    // indistinguishable from a broken one.
    if (busy.has(key)) {
      toast(
        "앞선 저장이 아직 끝나지 않았어요. 잠시 후 다시 눌러 주세요.",
        true,
      );
      return;
    }
    if (kind && !canUse(kind)) {
      toast(
        state.sync[kind]?.error
          ? `${friendlyError(state.sync[kind].error)} 새로고침한 뒤 다시 시도해 주세요.`
          : "서버 동기화를 마친 뒤 다시 시도해 주세요.",
        true,
      );
      return;
    }
    if (!state.user) {
      toast("로그인한 뒤 저장할 수 있어요.", true);
      return;
    }
    if (win.navigator.onLine === false) {
      toast(
        "인터넷 연결 후 저장해 주세요. 오프라인 저장은 지원하지 않습니다.",
        true,
      );
      return;
    }
    const epoch = state.epoch,
      uid = state.user.uid;
    busy.add(key);
    controls();
    try {
      const result = await work(uid);
      if (isCurrent(epoch)) success?.(result);
    } catch (error) {
      if (isCurrent(epoch)) toast(friendlyError(error), true);
    } finally {
      if (isCurrent(epoch)) {
        busy.delete(key);
        controls();
      }
    }
  }

  function showSync() {
    const status = (keys) => {
      if (keys.some((key) => state.sync[key]?.error))
        return "동기화 오류 · 권한이나 연결을 확인해 주세요";
      if (keys.some((key) => !state.sync[key]?.server))
        return "서버에서 기록을 확인하는 중…";
      if (keys.some((key) => state.sync[key]?.pending))
        return "서버에 저장 중…";
      if (keys.some((key) => state.sync[key]?.cached))
        return "연결 확인 중 · 화면은 마지막 동기화 기록입니다";
      return "클라우드 동기화됨";
    };
    setText("task-sync-status", status(["tasks"]));
    setText(
      "health-sync-status",
      status(["foods", "meals", "workouts", "weights", "checkups", "profile"]),
    );
    const error = dataKeys.map((key) => state.sync[key]?.error).find(Boolean);
    $("sync-error").hidden = !error;
    setText(
      "sync-error",
      error
        ? `${friendlyError(error)} 설정을 고친 뒤 로그아웃·재로그인해 주세요.`
        : "",
    );
    controls();
  }

  function watch(kind, options, list, epoch, healthEpoch) {
    state.sync[kind] = { server: false };
    const valid = () =>
      isCurrent(epoch) &&
      (healthEpoch === undefined || healthEpoch === state.healthEpoch);
    const fail = (error) => {
      if (!valid()) return;
      state.data[kind] = [];
      state.sync[kind] = { server: false, error };
      if (kind === "tasks") renderTasks();
      else if (kind === "foods") renderFoods();
      else if (kind === "checkups") renderCheckups();
      else if (kind === "profile") renderBalance();
      else renderHealth();
      if (kind === "weights") fillWeight(true);
      showSync();
    };
    try {
      list.push(
        store.watch(
          state.user.uid,
          kind,
          options,
          (rows, meta = {}) => {
            if (!valid()) return;
            state.data[kind] = rows;
            state.sync[kind] = {
              server: state.sync[kind]?.server || !meta.fromCache,
              cached: Boolean(meta.fromCache),
              pending: Boolean(meta.pending),
            };
            if (kind === "tasks") renderTasks();
            else if (kind === "foods") renderFoods();
            else if (kind === "checkups") renderCheckups();
            else if (kind === "profile") {
              fillBodyProfile();
              renderBalance();
            } else {
              renderHealth();
              if (kind === "weights") fillWeight();
            }
            showSync();
          },
          fail,
        ),
      );
    } catch (error) {
      fail(error);
    }
  }

  function listenHealth() {
    healthSubscriptions.forEach((stop) => stop());
    healthSubscriptions = [];
    state.healthEpoch++;
    state.weightDirty = false;
    for (const kind of ["meals", "workouts", "weights"]) {
      state.data[kind] = [];
      state.sync[kind] = { server: false };
    }
    renderHealth();
    fillWeight();
    if (!state.user || !config.securityRulesConfigured) return;
    const options = { start: shiftDate(state.date, -6), end: state.date };
    for (const kind of ["meals", "workouts", "weights"])
      watch(kind, options, healthSubscriptions, state.epoch, state.healthEpoch);
    showSync();
  }

  function resetMeal() {
    state.editingMeal = null;
    state.temporaryFood = null;
    $("meal-form").reset();
    $("food-search").value = "";
    $("meal-cancel").hidden = true;
    setText("meal-submit", "식사 기록");
    renderFoods();
  }

  function resetWorkout() {
    state.editingWorkout = null;
    $("workout-form").reset();
    $("workout-cancel").hidden = true;
    setText("workout-submit", "운동 기록");
  }

  function changeDate(value) {
    if (!isDateKey(value) || value > dateKey(now())) {
      toast("오늘까지의 올바른 날짜를 선택해 주세요.", true);
      $("health-date").value = state.date;
      return;
    }
    state.date = value;
    $("health-date").value = value;
    resetMeal();
    resetWorkout();
    listenHealth();
    controls();
  }

  function authChanged(user) {
    state.epoch++;
    state.healthEpoch++;
    subscriptions.forEach((stop) => stop());
    healthSubscriptions.forEach((stop) => stop());
    subscriptions = [];
    healthSubscriptions = [];
    busy.clear();
    state.user = user;
    state.data = Object.fromEntries(dataKeys.map((key) => [key, []]));
    state.sync = {};
    state.legacy = [];
    state.backedUp = false;
    state.editingTask = null;
    state.weightDirty = false;
    state.date = dateKey(now());
    $("health-date").value = state.date;
    $("health-date").max = state.date;
    for (const form of doc.querySelectorAll("form")) form.reset();
    $("search-input").value = "";
    state.search = "";
    $("account-settings").open = false;
    $("custom-food-details").open = false;
    $("legacy-actions").hidden = true;
    $("snackbar").hidden = true;
    setText("legacy-status", "");
    setText("account-name", user?.displayName || "나의 계정");
    setText("account-email", user?.email || "");
    setText("account-uid", user?.uid || "");
    $("auth-card").hidden = Boolean(user);
    $("account-bar").hidden = !user;
    $("account-settings").hidden = !user;
    $("setup-banner").hidden = !user || config.securityRulesConfigured;
    $("private-app").hidden = !user || !config.securityRulesConfigured;
    $("legacy-section").hidden =
      !user ||
      !config.securityRulesConfigured ||
      !config.legacyOwnerUid ||
      user.uid !== config.legacyOwnerUid;
    $("login-btn").disabled = false;
    setText("auth-status", user ? "" : "개인 기록은 로그인 후 볼 수 있습니다.");
    resetMeal();
    resetWorkout();
    renderTasks();
    renderHealth();
    renderCheckups();
    fillBodyProfile();
    fillWeight();
    $("checkup-file").value = "";
    setText("checkup-import-status", "아직 불러온 파일이 없어요.");
    if (user && config.securityRulesConfigured) {
      watch("tasks", null, subscriptions, state.epoch);
      watch("foods", null, subscriptions, state.epoch);
      // Checkups span years, so they are not bound to the 7-day health window.
      watch("checkups", null, subscriptions, state.epoch);
      watch("profile", null, subscriptions, state.epoch);
      listenHealth();
    }
    showSync();
  }

  function taskPayload(task, changes) {
    const result = makeTask({ ...task, ...changes });
    if (task.legacySourceId) result.legacySourceId = task.legacySourceId;
    return result;
  }

  function toggleTask(task) {
    action(
      "task",
      "tasks",
      (uid) =>
        store.save(
          uid,
          "tasks",
          task.id,
          taskPayload(task, { completed: !task.completed }),
        ),
      () => toast(task.completed ? "미완료로 바꿨어요." : "완료했어요."),
    );
  }

  function taskEditor(task) {
    const form = el("form", "task-edit-form");
    const text = el("input");
    text.type = "text";
    text.value = task.text;
    text.maxLength = 1000;
    text.required = true;
    text.setAttribute("aria-label", "할 일 수정");
    const category = el("select");
    category.setAttribute("aria-label", "분류 수정");
    for (const [value, label] of Object.entries(CATEGORIES)) {
      const option = el("option", "", label);
      option.value = value;
      category.append(option);
    }
    category.value = task.category;
    const date = el("input");
    date.type = "date";
    date.value = task.dueDate;
    date.min = "2000-01-01";
    date.max = "2100-12-31";
    date.setAttribute("aria-label", "마감일 수정");
    const buttons = el("div", "button-row");
    const save = el("button", "secondary-btn", "저장");
    save.type = "submit";
    buttons.append(
      save,
      button("취소", () => {
        state.editingTask = null;
        renderTasks();
      }),
    );
    form.append(text, category, date, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      action(
        "task",
        "tasks",
        (uid) =>
          store.save(
            uid,
            "tasks",
            task.id,
            taskPayload(task, {
              text: text.value,
              category: category.value,
              dueDate: date.value,
            }),
          ),
        () => {
          state.editingTask = null;
          renderTasks();
          toast("수정했어요.");
        },
      );
    });
    form.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        state.editingTask = null;
        renderTasks();
      }
    });
    return form;
  }

  function renderTasks() {
    const tasks = filterTasks(
      state.data.tasks,
      state.filter,
      state.search,
      state.sort,
    );
    const completed = state.data.tasks.filter((task) => task.completed).length;
    const total = state.data.tasks.length,
      percent = total ? Math.round((completed / total) * 100) : 0;
    setText("overall-text", `${completed}/${total} 완료`);
    setText("overall-percent", `${percent}%`);
    $("overall-bar").style.width = `${percent}%`;
    setText(
      "cheer-msg",
      !total
        ? "오늘의 작은 시작을 기록해 보세요."
        : completed === total
          ? "오늘의 할 일을 모두 마쳤어요. 수고했어요!"
          : "하나씩, 나의 속도로 해 나가요.",
    );
    $("task-list").replaceChildren();
    for (const task of tasks) {
      const row = el("li", `task-item${task.completed ? " completed" : ""}`);
      row.dataset.id = task.id;
      if (state.editingTask === task.id) row.append(taskEditor(task));
      else {
        const check = el("input");
        check.type = "checkbox";
        check.checked = task.completed;
        check.setAttribute("aria-label", `${task.text} 완료 상태`);
        check.addEventListener("change", () => {
          check.checked = task.completed;
          toggleTask(task);
        });
        const main = el("div", "task-main");
        const text = el("div", "task-text", task.text);
        text.addEventListener("dblclick", () => {
          state.editingTask = task.id;
          renderTasks();
        });
        const meta = el("div", "task-meta");
        meta.append(
          el("span", "tag", CATEGORIES[task.category] || task.category),
        );
        if (task.dueDate)
          meta.append(
            el(
              "span",
              task.dueDate < dateKey(now()) && !task.completed ? "danger" : "",
              formatDate(task.dueDate),
            ),
          );
        main.append(text, meta);
        const actions = el("div", "task-actions");
        actions.append(
          button("수정", () => {
            state.editingTask = task.id;
            renderTasks();
          }),
          button(
            "삭제",
            () => {
              if (ask("이 할 일을 삭제할까요? 삭제하면 되돌릴 수 없습니다."))
                action(
                  "task",
                  "tasks",
                  (uid) => store.remove(uid, "tasks", task.id),
                  () => toast("할 일을 삭제했어요."),
                );
            },
            "text-btn danger",
          ),
        );
        row.append(check, main, actions);
      }
      $("task-list").append(row);
    }
    $("task-list").hidden = state.calendar;
    $("empty-state").hidden = tasks.length > 0 || state.calendar;
    setText(
      "empty-state",
      state.data.tasks.length
        ? "조건에 맞는 할 일이 없어요."
        : "첫 할 일을 적어 보세요.",
    );
    $("calendar-view").hidden = !state.calendar;
    setText("view-toggle", state.calendar ? "☰" : "📅");
    $("view-toggle").setAttribute(
      "aria-label",
      state.calendar ? "목록 보기" : "캘린더 보기",
    );
    renderCalendar(tasks);
    controls();
  }

  function renderCalendar(tasks) {
    const target = $("calendar-grid");
    target.replaceChildren();
    const year = state.calendarDate.getFullYear(),
      month = state.calendarDate.getMonth();
    setText("calendar-title", `${year}년 ${month + 1}월`);
    for (const name of ["일", "월", "화", "수", "목", "금", "토"])
      target.append(el("div", "calendar-weekday", name));
    const first = new Date(year, month, 1, 12).getDay(),
      count = new Date(year, month + 1, 0, 12).getDate();
    for (let i = 0; i < first; i++) target.append(el("div", "calendar-blank"));
    for (let day = 1; day <= count; day++) {
      const date = dateKey(new Date(year, month, day, 12));
      const cell = el(
        "div",
        `calendar-day${date === dateKey(now()) ? " today" : ""}`,
      );
      cell.append(el("span", "calendar-number", day));
      for (const task of tasks.filter((item) => item.dueDate === date)) {
        const item = button(
          task.text,
          () => toggleTask(task),
          `calendar-task${task.completed ? " completed" : ""}`,
        );
        item.title = `${task.text} · 클릭하여 ${task.completed ? "미완료" : "완료"}로 변경`;
        item.setAttribute("aria-label", item.title);
        cell.append(item);
      }
      target.append(cell);
    }
  }

  // The catalog holds thousands of foods, so the dropdown renders a capped
  // slice. Without a cap the browser would build every option on each keystroke.
  const FOOD_OPTION_LIMIT = 200;
  // Ranking, most significant first. Starting with the search term is a weak
  // signal — "와인비니거" starts with 와인 but "레드와인" is what was meant — so
  // what the person actually uses, then how generic the name is, comes first.
  const rankFood = (food, search, usage) => {
    const name = food.name.toLocaleLowerCase();
    return [
      favorites().includes(food.id) ? 0 : 1,
      -(usage.get(food.name) || 0),
      // A match in the name beats one that only came from the category.
      name.includes(search) ? 0 : 1,
      // Then the curated lists, which hold the plain "레드와인" a search for
      // 와인 is usually after, ahead of 250k branded products.
      food.id.startsWith("custom:") ? 0 : food.id.startsWith("mfds") ? 2 : 1,
      // Only within one of those groups is "starts with" a useful tiebreak;
      // applied any earlier it would float 와인비니거 above 레드와인.
      name.startsWith(search) ? 0 : 1,
      food.name.length,
    ];
  };

  const compareRank = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };

  // How often each food shows up in the meals currently loaded.
  function usageCounts() {
    const counts = new Map();
    for (const meal of state.data.meals || []) {
      const name = meal.food?.name;
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
  }
  const FOOD_GROUPS = [
    [
      "내 음식",
      (food) => food.id.startsWith("custom:") || food.id === "saved-meal",
    ],
    ["한국 음식 · 식약처", (food) => food.id.startsWith("mfds-")],
    ["가공식품 · 식약처", (food) => food.id.startsWith("mfdsp-")],
    ["건강기능식품 · 식약처", (food) => food.id.startsWith("mfdshf-")],
    ["참고 식품 · USDA 외", () => true],
  ];

  function renderFoods(preferredId) {
    const select = $("food-select"),
      previous = preferredId ?? select.value;
    const search = $("food-search").value.trim().toLocaleLowerCase();
    let matches = availableFoods().filter(
      (food) =>
        `${food.name} ${food.keywords || ""}`
          .toLocaleLowerCase()
          .includes(search) || food.id === previous,
    );
    // Category words live in the keywords, so a search for 맥주 also matches
    // 맥주효모 supplements. Name matches come first, and among those the ones
    // that start with the term, so the obvious answer is not buried.
    const usage = usageCounts();
    if (search) {
      const keyed = matches.map((food) => ({
        food,
        key: rankFood(food, search, usage),
      }));
      keyed.sort((a, b) => compareRank(a.key, b.key));
      matches = keyed.map((item) => item.food);
    }
    const foods = matches.slice(0, FOOD_OPTION_LIMIT);
    if (previous && !foods.some((food) => food.id === previous)) {
      const selected = matches.find((food) => food.id === previous);
      if (selected) foods.push(selected);
    }
    const placeholder = el(
      "option",
      "",
      matches.length
        ? "음식을 선택해 주세요"
        : "검색 결과 없음 · 내 음식으로 등록해 주세요",
    );
    placeholder.value = "";
    select.replaceChildren(placeholder);
    const option = (food) => {
      const used = usage.get(food.name) || 0;
      const node = el(
        "option",
        "",
        `${favorites().includes(food.id) ? "★ " : ""}${food.name} · ${food.baseAmount}${food.baseUnit}당 ${food.kcal}kcal${
          used >= 2 ? ` · 최근 ${used}회` : ""
        }`,
      );
      node.value = food.id;
      return node;
    };
    if (search) {
      // While searching, the ranking is the whole point, so the list stays flat.
      // Grouping here would push a better match below a whole category.
      for (const food of foods) select.append(option(food));
    } else {
      const grouped = new Map(FOOD_GROUPS.map(([name]) => [name, []]));
      for (const food of foods) {
        const [name] = FOOD_GROUPS.find(([, belongs]) => belongs(food));
        grouped.get(name).push(food);
      }
      for (const [name, items] of grouped) {
        if (!items.length) continue;
        const group = el("optgroup");
        group.label = name;
        for (const food of items) group.append(option(food));
        select.append(group);
      }
    }
    select.value = foods.some((food) => food.id === previous) ? previous : "";
    setText(
      "food-count",
      matches.length > FOOD_OPTION_LIMIT
        ? `${fmt(matches.length, 0)}종 중 ${FOOD_OPTION_LIMIT}종만 보여요. 검색어를 좁혀 주세요.`
        : `${fmt(matches.length, 0)}종`,
    );
    $("custom-food-list").replaceChildren();
    for (const food of state.data.foods) {
      const row = el("li", "record-row"),
        copy = el("div", "record-copy");
      copy.append(
        el("strong", "", food.name),
        el(
          "small",
          "",
          `${food.baseAmount}${food.baseUnit}당 ${food.kcal}kcal`,
        ),
      );
      row.append(
        copy,
        button(
          "삭제",
          () => {
            if (
              ask("내 음식에서 삭제할까요? 이전 식사 기록은 그대로 남습니다.")
            )
              action(
                "food",
                "foods",
                (uid) => store.remove(uid, "foods", food.id),
                () => toast("내 음식에서 삭제했어요. 식사 기록은 유지됩니다."),
              );
          },
          "text-btn danger",
        ),
      );
      $("custom-food-list").append(row);
    }
    previewMeal();
    controls();
  }

  // Volume and weight stay in step: choosing a container fills the amount box,
  // and typing an amount reports the container it comes to.
  function renderContainers(food) {
    const row = $("container-row"),
      select = $("container-select"),
      options = containersFor(food);
    row.hidden = options.length === 0;
    if (!options.length) {
      select.replaceChildren();
      return;
    }
    const previous = select.value;
    select.replaceChildren();
    for (const [index, container] of options.entries()) {
      const option = el("option", "", container.label);
      option.value = String(index);
      select.append(option);
    }
    select.value = options[Number(previous)] ? previous : "0";
  }

  const selectedContainer = () =>
    containersFor(selectedFood())[Number($("container-select").value)] || null;

  function applyContainer() {
    const food = selectedFood(),
      container = selectedContainer();
    if (!food || !container) return;
    const amount = containerAmount(container, $("container-count").value);
    if (amount === null) return;
    $("meal-amount").value = amount;
    previewMeal();
  }

  function renderContainerHint(food) {
    if ($("container-row").hidden) return;
    const container = selectedContainer(),
      count = $("container-count").value;
    const equivalent = containerEquivalent(food, $("meal-amount").value);
    const forward = container
      ? `${count}${container.label.replace(/\s?[0-9.]+ml$/, "")} = ${describeContainer(container, count)} (${fmt(containerAmount(container, count) ?? 0, 1)}${food.baseUnit})`
      : "";
    setText(
      "container-hint",
      equivalent
        ? `${forward}${forward ? " · " : ""}지금 입력한 양은 약 ${equivalent.text}`
        : forward,
    );
  }

  function previewMeal() {
    const food = selectedFood(),
      reference = $("food-reference");
    reference.replaceChildren();
    if (!food) {
      reference.textContent =
        "기본 식품은 참고값입니다. 제품·조리법이 다르면 영양표로 직접 등록해 주세요.";
      setText("meal-preview", "음식을 선택하면 계산됩니다.");
      setText("meal-unit", "g");
      $("container-row").hidden = true;
      renderFavoriteButton();
      return;
    }
    setText("meal-unit", food.baseUnit);
    $("meal-amount").max = food.baseUnit === "개" ? "100" : "5000";
    renderContainers(food);
    renderContainerHint(food);
    renderFavoriteButton();
    reference.append(
      doc.createTextNode(
        `${food.baseAmount}${food.baseUnit}당 ${food.kcal}kcal · `,
      ),
    );
    if (safeUrl(food.sourceUrl)) {
      const link = el("a", "", food.source);
      link.href = safeUrl(food.sourceUrl);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      reference.append(link);
    } else reference.append(doc.createTextNode(food.source || "직접 입력"));
    try {
      const n = calculateNutrition(food, $("meal-amount").value);
      setText(
        "meal-preview",
        `${fmt(n.kcal)} kcal · 단백질 ${n.protein === null ? "정보 없음" : `${fmt(n.protein)}g`}\n탄수 ${n.carbs === null ? "—" : `${fmt(n.carbs)}g`} · 지방 ${n.fat === null ? "—" : `${fmt(n.fat)}g`}`,
      );
    } catch (error) {
      setText("meal-preview", error.message);
    }
  }

  function editMeal(meal) {
    state.editingMeal = meal;
    state.temporaryFood = {
      ...meal.food,
      id: "saved-meal",
      name: meal.food.name,
    };
    $("food-search").value = "";
    $("meal-type").value = meal.mealType;
    $("meal-amount").value = meal.amount;
    renderFoods("saved-meal");
    setText("meal-submit", "식사 수정");
    $("meal-cancel").hidden = false;
    $("meal-amount").focus();
  }

  function renderCheckups() {
    renderCheckupTrend();
    renderBalance();
    const target = $("checkup-list");
    target.replaceChildren();
    const rows = [...(state.data.checkups || [])].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    if (!rows.length) {
      target.append(
        el(
          "p",
          "empty-state",
          "아직 검진 기록이 없어요. 결과 파일을 불러오면 여기에 표시됩니다.",
        ),
      );
      return;
    }
    for (const checkup of rows) {
      const card = el("article", "checkup-card"),
        head = el("div", "checkup-head");
      head.append(
        el(
          "strong",
          "",
          checkup.label || CHECKUP_KINDS[checkup.kind] || "검진",
        ),
        el("small", "", formatDate(checkup.date)),
      );
      card.append(head);

      const measured = Object.entries(CHECKUP_METRICS).filter(
        ([key]) => checkup.measurements?.[key] !== null,
      );
      if (measured.length) {
        const list = el("dl", "checkup-metrics");
        for (const [key, metric] of measured) {
          const value = checkup.measurements[key];
          list.append(
            el("dt", "", metric.label),
            el(
              "dd",
              "",
              metric.unit ? `${fmt(value, 2)} ${metric.unit}` : fmt(value, 2),
            ),
          );
        }
        card.append(list);
      }
      const blank = Object.entries(CHECKUP_METRICS).filter(
        ([key]) => checkup.measurements?.[key] === null,
      );
      if (blank.length)
        card.append(
          el(
            "p",
            "help-text",
            `검사하지 않았거나 결과가 없는 항목 ${blank.length}개: ${blank
              .map(([, metric]) => metric.label)
              .join(", ")}`,
          ),
        );
      if (checkup.note) card.append(el("p", "checkup-note", checkup.note));

      const actions = el("div", "record-actions");
      actions.append(
        button(
          "삭제",
          () => {
            if (ask("이 검진 기록을 삭제할까요?"))
              action(
                "checkup",
                "checkups",
                (uid) => store.remove(uid, "checkups", checkup.id),
                () => toast("검진 기록을 삭제했어요."),
              );
          },
          "text-btn danger",
        ),
      );
      card.append(actions);
      target.append(card);
    }
  }

  const bodyProfile = () =>
    (state.data.profile || []).find((row) => row.id === BODY_PROFILE_ID) ||
    null;

  function fillBodyProfile() {
    const saved = bodyProfile() || {};
    $("profile-sex").value = saved.sex || "";
    $("profile-birth-year").value = saved.birthYear ?? "";
    $("profile-height").value = saved.heightCm ?? "";
    $("profile-target").value = saved.targetKcal ?? "";
  }

  const latestOf = (rows, pick) =>
    [...(rows || [])]
      .filter((row) => pick(row) !== null && pick(row) !== undefined)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(pick)[0] ?? null;

  function balanceInputs() {
    const saved = bodyProfile() || {};
    // Height falls back to the most recent checkup; weight always comes from
    // the weight log, which is the number the person actually measured.
    const checkupHeight = latestOf(
      (state.data.checkups || []).filter((item) => item.kind === "general"),
      (item) => item.measurements?.height_cm ?? null,
    );
    const heightCm = Number(saved.heightCm) || checkupHeight;
    const weightKg = latestOf(state.data.weights, (item) => item.kg ?? null);
    return {
      sex: saved.sex,
      birthYear: saved.birthYear,
      heightCm,
      weightKg,
      heightFromCheckup: !Number(saved.heightCm) && checkupHeight !== null,
    };
  }

  function renderBalance() {
    const inputs = balanceInputs(),
      bmr = basalMetabolicRate(inputs, now());
    const meals = (state.data.meals || []).filter(
      (item) => item.date === state.date,
    );
    const totals = nutritionTotals(meals);
    const balance = meals.length
      ? energyBalance(totals.values.kcal, bmr)
      : null;
    $("balance-result").hidden = !balance;
    $("balance-empty").hidden = Boolean(balance);
    if (!balance) {
      setText(
        "balance-empty",
        bmr === null
          ? "내 기준(성별·출생연도·키)을 입력하고 체중을 한 번 기록하면 계산해 드릴게요."
          : "오늘 먹은 것을 기록하면 기초대사량과 비교해 드릴게요.",
      );
      return;
    }
    setText("balance-bmr", `${fmt(balance.bmr, 0)} kcal`);
    setText(
      "balance-basis",
      `${fmt(inputs.weightKg)}kg · ${fmt(inputs.heightCm)}cm${
        inputs.heightFromCheckup ? " (검진 키)" : ""
      }`,
    );
    setText(
      "balance-intake",
      `${fmt(balance.intakeKcal, 0)} kcal${totals.missing.kcal ? "*" : ""}`,
    );
    setText(
      "balance-intake-note",
      totals.missing.kcal
        ? `${totals.missing.kcal}개 음식은 열량을 세지 못했어요`
        : `${meals.length}개 음식 기록`,
    );
    const gap = Math.abs(balance.difference);
    setText("balance-diff", `${balance.over ? "+" : "−"}${fmt(gap, 0)} kcal`);
    setText(
      "balance-diff-note",
      balance.over ? "기초대사량 초과" : "기초대사량 미달",
    );

    renderGoal(totals.values.kcal, totals.missing.kcal);
    // Suggestions follow whichever line the person is actually tracking.
    const target = bodyProfile()?.targetKcal ?? null;
    renderAdvice(
      target === null
        ? balance.difference
        : round(totals.values.kcal - target, 0),
      inputs.weightKg,
    );

    // Intl renders a plain hyphen, so signs are written by hand to match the
    // "+"/"−" shown on the difference card.
    const signed = (value) =>
      `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value), 2)}kg`;
    const week = weightDriftKg(balance.difference, 7),
      month = weightDriftKg(balance.difference, 30);
    setText(
      "balance-drift",
      `오늘 같은 수지가 이어진다면 대략 7일에 ${signed(week)}, 30일에 ${signed(month)} 쪽입니다. ${KCAL_PER_KG.toLocaleString("ko-KR")}kcal을 1kg으로 잡은 어림 계산이고, 활동량이 빠져 있어 실제 변화는 이보다 작게 나오는 경우가 많아요.`,
    );
  }

  // Foods the person already eats come first: their own recent meals, then a
  // few staples, so a suggestion is something they actually keep around.
  const STAPLE_NAMES = [
    "흰쌀밥 · 단립종, 조리 후",
    "삶은 달걀 · 껍데기 제외",
    "바나나 · 껍질 제외, 생것",
    "그릭요거트 · 플레인 전지",
    "우유 · 전지 3.25%, 무강화 (g 기준)",
    "닭가슴살 · 껍질 없이 구운 것",
    "아몬드 · 생것",
    "고구마 · 껍질 없이 삶은 것",
  ];

  function suggestionPool() {
    const foods = availableFoods();
    const recent = [...(state.data.meals || [])]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((meal) => foods.find((food) => food.name === meal.food?.name))
      .filter(Boolean);
    const staples = STAPLE_NAMES.map((name) =>
      catalog.find((food) => food.name === name),
    ).filter(Boolean);
    return [...recent, ...staples];
  }

  function renderAdvice(gapKcal, weightKg) {
    const wrap = $("balance-advice"),
      list = $("balance-advice-list");
    list.replaceChildren();
    // Landing within about 50 kcal is close enough that suggesting anything
    // would be noise.
    if (Math.abs(gapKcal) < 50) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    if (gapKcal > 0) {
      const options = exerciseOptions(gapKcal, weightKg);
      setText("balance-advice-title", `${fmt(gapKcal, 0)} kcal만큼 움직인다면`);
      if (!options.length) {
        list.append(
          el("li", "", "이 정도 열량은 한 번의 운동으로 맞추기 어려워요."),
        );
      }
      for (const option of options) {
        const item = el("li");
        item.append(
          el("strong", "", `${option.label} ${fmt(option.minutes, 0)}분`),
          el(
            "small",
            "",
            `${option.detail ? `${option.detail} · ` : ""}MET ${option.met} · 코드 ${option.code}`,
          ),
        );
        list.append(item);
      }
      setText(
        "balance-advice-note",
        "체중과 MET로 계산한 어림값이라 실제 소모와 다릅니다. 운동으로 쓴 열량을 섭취에서 빼지는 않아요.",
      );
      return;
    }
    const shortfall = Math.abs(gapKcal);
    const picks = foodSuggestions(shortfall, suggestionPool());
    setText("balance-advice-title", `${fmt(shortfall, 0)} kcal을 채운다면`);
    if (!picks.length) {
      list.append(el("li", "", "한 번에 먹기 적당한 항목을 찾지 못했어요."));
    }
    for (const pick of picks) {
      const item = el("li"),
        protein = pick.food.protein;
      item.append(
        el(
          "strong",
          "",
          `${pick.food.name} ${fmt(pick.amount, 1)}${pick.unit}`,
        ),
        el(
          "small",
          "",
          `약 ${fmt(pick.kcal, 0)}kcal${
            protein === null || protein === undefined
              ? ""
              : ` · 단백질 ${fmt((protein / pick.food.baseAmount) * pick.amount)}g`
          }`,
        ),
      );
      list.append(item);
    }
    setText(
      "balance-advice-note",
      "최근 먹은 음식과 기본 식품에서 고른 계산 예시입니다. 꼭 채워야 하는 양이 아니고, 권장 섭취량도 아니에요.",
    );
  }

  function renderGoal(intakeKcal, missingKcal) {
    const target = bodyProfile()?.targetKcal ?? null,
      wrap = $("balance-goal");
    wrap.hidden = target === null;
    if (target === null) return;
    const remaining = round(target - intakeKcal, 0),
      percent = Math.min((intakeKcal / target) * 100, 100);
    setText("balance-goal-label", `목표 ${fmt(target, 0)} kcal`);
    setText(
      "balance-goal-left",
      remaining >= 0
        ? `${fmt(remaining, 0)} kcal 남음`
        : `${fmt(Math.abs(remaining), 0)} kcal 초과`,
    );
    const bar = $("balance-goal-bar");
    bar.style.width = `${percent}%`;
    bar.dataset.over = String(remaining < 0);
    setText(
      "balance-goal-note",
      `${fmt(intakeKcal, 0)} / ${fmt(target, 0)} kcal (${fmt(percent, 0)}%)${
        missingKcal
          ? ` · 열량을 세지 못한 음식 ${missingKcal}개는 빠져 있어요`
          : ""
      }`,
    );
  }

  // A checkup is a point in time, so the chart plots one point per checkup and
  // labels it 연도.월. Missing results break the line instead of being filled in.
  const checkupMonth = (date) => `${date.slice(0, 4)}.${date.slice(5, 7)}`;

  function checkupSeries(metric) {
    return [...(state.data.checkups || [])]
      .filter((item) => item.kind === "general")
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({
        date: item.date,
        label: checkupMonth(item.date),
        value: item.measurements?.[metric] ?? null,
      }));
  }

  function renderCheckupTrend() {
    const wrap = $("checkup-trend"),
      select = $("checkup-metric");
    const usable = Object.entries(CHECKUP_METRICS).filter(
      ([key]) =>
        checkupSeries(key).filter((point) => point.value !== null).length,
    );
    if (!usable.length) {
      wrap.hidden = true;
      select.replaceChildren();
      return;
    }
    wrap.hidden = false;
    const previous = select.value;
    select.replaceChildren();
    for (const [key, metric] of usable) {
      const option = el("option", "", metric.label);
      option.value = key;
      select.append(option);
    }
    select.value = usable.some(([key]) => key === previous)
      ? previous
      : usable[0][0];
    drawCheckupChart(select.value);
  }

  function drawCheckupChart(metric) {
    const target = $("checkup-chart"),
      info = CHECKUP_METRICS[metric];
    target.replaceChildren();
    if (!info) return;
    const series = checkupSeries(metric);
    const measured = series.filter((point) => point.value !== null);
    setText(
      "checkup-chart-caption",
      `${info.label}${info.unit ? ` · ${info.unit}` : ""}`,
    );
    if (measured.length < 2) {
      target.append(
        el(
          "p",
          "help-text",
          measured.length
            ? `${measured[0].label} 한 번만 기록되어 흐름을 그릴 수 없어요. 값은 ${fmt(measured[0].value, 2)}${info.unit ? ` ${info.unit}` : ""}입니다.`
            : "이 지표는 기록이 없어요.",
        ),
      );
      setText("checkup-chart-note", "");
      return;
    }
    const values = measured.map((point) => point.value),
      lowest = Math.min(...values),
      highest = Math.max(...values);
    // A flat series would divide by zero, so give it a band to sit in.
    const pad = highest === lowest ? Math.max(Math.abs(highest) * 0.1, 1) : 0,
      min = lowest - pad,
      max = highest + pad;
    const width = 360,
      left = 34,
      right = width - 20,
      step = series.length > 1 ? (right - left) / (series.length - 1) : 0;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 360 180");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `${info.label} 검진 기록 ${measured.length}회. ${measured
        .map((point) => `${point.label} ${fmt(point.value, 2)}`)
        .join(", ")}`,
    );
    const points = series.map((point, index) =>
      point.value === null
        ? null
        : {
            x: left + index * step,
            y: 125 - ((point.value - min) / (max - min)) * 90,
            value: point.value,
          },
    );
    let segment = [];
    const line = () => {
      if (segment.length > 1) {
        const node = doc.createElementNS(svg.namespaceURI, "polyline");
        node.setAttribute(
          "points",
          segment.map((p) => `${p.x},${p.y}`).join(" "),
        );
        svg.append(node);
      }
      segment = [];
    };
    for (const point of [...points, null]) {
      if (point) segment.push(point);
      else line();
    }
    for (const [index, point] of series.entries()) {
      const label = doc.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", left + index * step);
      label.setAttribute("y", 160);
      label.setAttribute("text-anchor", "middle");
      label.textContent = point.label;
      svg.append(label);
      const plotted = points[index];
      if (!plotted) continue;
      const circle = doc.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", plotted.x);
      circle.setAttribute("cy", plotted.y);
      circle.setAttribute("r", "4");
      const value = doc.createElementNS(svg.namespaceURI, "text");
      value.setAttribute("x", plotted.x);
      value.setAttribute("y", plotted.y - 12);
      value.setAttribute("text-anchor", "middle");
      value.textContent = fmt(plotted.value, 2);
      svg.append(circle, value);
    }
    target.append(svg);
    const blank = series.length - measured.length;
    setText(
      "checkup-chart-note",
      `검진 ${series.length}회 중 ${measured.length}회 기록${blank ? ` · ${blank}회는 결과가 없어 선을 잇지 않았어요` : ""}. 세로축은 기록된 값의 범위에 맞춰 그려지며, 정상 범위를 뜻하지 않습니다.`,
    );
  }

  // The checkup file holds private medical data. It is read in the browser and
  // written straight to the signed-in user's own space; it is never uploaded
  // anywhere else, and never becomes part of the site's files.
  function readCheckupFile(raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.dataset_type !== "personal_health_checkups")
      throw new Error("건강검진 결과 파일이 아니에요.");
    const records = [];
    for (const item of parsed.general_checkups || [])
      records.push(
        makeCheckup({
          date: item.exam_date,
          kind: "general",
          label: `일반건강검진 ${item.year ?? ""}`.trim(),
          measurements: item.measurements || {},
          note: (parsed.metric_definitions && item.summary_ko) || "",
        }),
      );
    for (const item of parsed.other_screenings || []) {
      const results = item.reported_results || {};
      records.push(
        makeCheckup({
          date: item.exam_date,
          kind: "screening",
          label: item.type ? `기타 검사 · ${item.type}` : "기타 검사",
          measurements: {},
          note: Object.entries(results)
            .filter(([, value]) => typeof value === "string")
            .map(([, value]) => value)
            .join(" · "),
        }),
      );
    }
    if (!records.length) throw new Error("파일에서 검진 기록을 찾지 못했어요.");
    return records;
  }

  async function importCheckups(file) {
    setText("checkup-import-status", "파일을 읽는 중…");
    let records;
    try {
      records = readCheckupFile(await file.text());
    } catch (error) {
      setText(
        "checkup-import-status",
        `불러오지 못했어요 · ${friendlyError(error)}`,
      );
      return;
    }
    await action(
      "checkup-import",
      "checkups",
      async (uid) => {
        let weights = 0;
        for (const record of records) {
          // The id is derived from kind and date, so re-importing the same file
          // updates those records instead of duplicating them.
          await store.save(uid, "checkups", checkupId(record), record);
          const kg = record.measurements?.weight_kg ?? null;
          if (record.kind !== "general" || kg === null) continue;
          // The checkup weight joins the weight log so it shows up in the day
          // view, the 7-day average and the chart. saveIfAbsent keeps a weight
          // typed in by hand for that date from being overwritten.
          const added = await store.saveIfAbsent(
            uid,
            "weights",
            record.date,
            makeWeight({ date: record.date, kg, note: "건강검진 측정" }),
          );
          if (added) weights++;
        }
        return { count: records.length, weights };
      },
      ({ count, weights }) => {
        $("checkup-file").value = "";
        setText(
          "checkup-import-status",
          `검진 기록 ${count}건을 저장했어요.${weights ? ` 체중 ${weights}건은 체중 기록에도 추가했어요.` : ""}`,
        );
        toast("건강검진 기록을 저장했어요.");
      },
    );
  }

  function renderMeals(meals) {
    const target = $("meal-list");
    target.replaceChildren();
    if (!meals.length) {
      target.append(
        el(
          "p",
          "empty-state",
          "아직 식사 기록이 없어요. 먹은 것부터 편하게 적어 보세요.",
        ),
      );
      return;
    }
    for (const [kind, name] of Object.entries(MEAL_TYPES)) {
      const rows = meals
        .filter((meal) => meal.mealType === kind)
        .sort((a, b) => a.createdAt - b.createdAt);
      if (!rows.length) continue;
      const group = el("section", "meal-group"),
        list = el("ul");
      group.append(el("h4", "", name), list);
      for (const meal of rows) {
        const row = el("li", "record-row"),
          copy = el("div", "record-copy"),
          actions = el("div", "record-actions");
        let detail;
        try {
          const n = calculateNutrition(meal.food, meal.amount, meal.unit);
          detail = `${meal.amount}${meal.unit} · ${fmt(n.kcal)}kcal · 단백질 ${n.protein === null ? "정보 없음" : `${fmt(n.protein)}g`}`;
        } catch {
          detail = "계산할 수 없는 기록 · 내용을 확인해 주세요";
        }
        copy.append(
          el("strong", "", meal.food?.name || "음식 정보 없음"),
          el("small", "", detail),
        );
        actions.append(
          button("수정", () => editMeal(meal)),
          button(
            "삭제",
            () => {
              if (ask("이 식사 기록을 삭제할까요?"))
                action(
                  "meal",
                  "meals",
                  (uid) => store.remove(uid, "meals", meal.id),
                  () => {
                    if (state.editingMeal?.id === meal.id) resetMeal();
                    toast("식사 기록을 삭제했어요.");
                  },
                );
            },
            "text-btn danger",
          ),
        );
        row.append(copy, actions);
        list.append(row);
      }
      target.append(group);
    }
  }

  function renderWorkouts(workouts) {
    const plan = workoutPlan(state.date),
      saved = plan && workouts.find((workout) => workout.id === plan.key);
    setText(
      "plan-title",
      plan ? `${plan.label} · ${plan.minutes}분` : "오늘은 쉬어 가는 날",
    );
    setText(
      "plan-detail",
      plan
        ? `${plan.detail}${saved ? ` · 실제 기록 ${saved.minutes}분` : ""}`
        : "가벼운 산책을 했다면 아래에 따로 기록해 주세요.",
    );
    $("plan-check-wrap").hidden = !plan;
    $("plan-check").checked = Boolean(saved);
    const target = $("workout-list");
    target.replaceChildren();
    if (!workouts.length)
      target.append(el("li", "help-text", "아직 완료한 운동이 없어요."));
    for (const workout of workouts
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)) {
      const row = el("li", "record-row"),
        copy = el("div", "record-copy"),
        actions = el("div", "record-actions");
      copy.append(
        el("strong", "", workout.label),
        el(
          "small",
          "",
          `${WORKOUT_TYPES[workout.kind]} · ${workout.minutes}분`,
        ),
      );
      actions.append(
        button("수정", () => {
          state.editingWorkout = workout;
          $("workout-kind").value = workout.kind;
          $("workout-minutes").value = workout.minutes;
          $("workout-label").value = workout.label;
          setText("workout-submit", "운동 수정");
          $("workout-cancel").hidden = false;
          $("workout-minutes").focus();
        }),
        button(
          "삭제",
          () => {
            if (ask("이 운동 기록을 삭제할까요?"))
              action(
                "workout",
                "workouts",
                (uid) => store.remove(uid, "workouts", workout.id),
                () => {
                  if (state.editingWorkout?.id === workout.id) resetWorkout();
                  toast("운동 기록을 삭제했어요.");
                },
              );
          },
          "text-btn danger",
        ),
      );
      row.append(copy, actions);
      target.append(row);
    }
  }

  function fillWeight(force = false) {
    if (state.weightDirty && !force) return;
    state.weightDirty = false;
    const weight = state.data.weights.find((item) => item.date === state.date);
    $("weight-kg").value = weight?.kg ?? "";
    $("weight-note").value = weight?.note || "";
    $("weight-delete").hidden = !weight;
    setText("weight-submit", weight ? "체중 수정" : "체중 기록");
  }

  function renderHealth() {
    const meals = state.data.meals.filter((item) => item.date === state.date),
      workouts = state.data.workouts.filter((item) => item.date === state.date);
    const weight = state.data.weights.find((item) => item.date === state.date),
      totals = nutritionTotals(meals);
    setText(
      "health-date-label",
      `${formatDate(state.date)}${state.date === dateKey(now()) ? " · 오늘" : ""}`,
    );
    setText(
      "day-kcal",
      meals.length
        ? `${fmt(totals.values.kcal, 0)} kcal${totals.missing.kcal ? "*" : ""}`
        : "—",
    );
    setText(
      "day-meal-count",
      meals.length
        ? `${meals.length}개 음식 기록${totals.missing.kcal ? " · 확인 필요" : ""}`
        : "식사를 기록해 주세요",
    );
    setText(
      "day-protein",
      meals.length && totals.missing.protein < meals.length
        ? `${fmt(totals.values.protein)} g`
        : "—",
    );
    setText(
      "day-protein-note",
      totals.missing.protein
        ? `${totals.missing.protein}개 음식의 정보 없음 · 합계 제외`
        : meals.length
          ? "기록한 음식의 합계"
          : "빈 항목은 0으로 세지 않아요",
    );
    setText(
      "day-workout",
      workouts.length
        ? `${fmt(
            workouts.reduce((sum, item) => sum + item.minutes, 0),
            0,
          )} 분`
        : "—",
    );
    setText(
      "day-workout-count",
      workouts.length
        ? `${workouts.length}회 완료`
        : "가벼운 움직임도 기록해요",
    );
    setText("day-weight", weight ? `${fmt(weight.kg)} kg` : "—");
    renderMeals(meals);
    renderBalance();
    renderQuickAdd();
    renderWorkouts(workouts);
    renderWeekly();
    controls();
  }

  function renderWeekly() {
    const summary = weeklySummary(
      state.date,
      state.data.meals,
      state.data.workouts,
      state.data.weights,
    );
    setText(
      "weekly-range",
      `${summary.days[0].date.slice(5)} ~ ${state.date.slice(5)}`,
    );
    setText(
      "weekly-kcal",
      summary.averageKcal === null
        ? "—"
        : `${fmt(summary.averageKcal, 0)} kcal${summary.incompleteCalories ? "*" : ""}`,
    );
    setText(
      "weekly-meal-days",
      `${summary.mealDays}/7일 기록${summary.incompleteCalories ? " · 계산 불가 기록 제외" : ""}`,
    );
    setText("weekly-workout", `${fmt(summary.workoutMinutes, 0)} 분`);
    setText("weekly-workout-count", `${summary.workoutCount}회 완료 기록`);
    setText(
      "weekly-weight",
      summary.averageWeight === null ? "—" : `${fmt(summary.averageWeight)} kg`,
    );
    setText("weekly-weight-days", `${summary.weightDays}/7일 측정 평균`);
    const max = Math.max(
      1,
      ...summary.days.map((day) => day.nutrition.values.kcal),
    );
    $("calorie-chart").replaceChildren();
    $("weekly-table-body").replaceChildren();
    for (const day of summary.days) {
      const n = day.nutrition,
        value = n.count
          ? `${fmt(n.values.kcal, 0)}${n.missing.kcal ? "*" : ""}`
          : "—";
      const column = el("div", "chart-column"),
        track = el("div", "bar-track"),
        bar = el("div", `chart-bar${n.count ? "" : " missing"}`);
      bar.style.height = `${n.count ? (n.values.kcal / max) * 100 : 0}%`;
      track.append(bar);
      column.append(
        el("span", "chart-value", value),
        track,
        el("span", "chart-date", day.date.slice(5)),
      );
      $("calorie-chart").append(column);
      const row = el("tr");
      for (const text of [
        day.date.slice(5),
        value === "—" ? "미기록" : `${value} kcal`,
        n.count && n.missing.protein < n.count
          ? `${fmt(n.values.protein)} g${n.missing.protein ? " (일부)" : ""}`
          : "정보 없음",
        day.minutes ? `${day.minutes}분` : "미기록",
        day.weight === null ? "미기록" : `${day.weight} kg`,
      ])
        row.append(el("td", "", text));
      $("weekly-table-body").append(row);
    }
    const target = $("weight-chart");
    target.replaceChildren();
    if (!summary.weightDays) {
      target.append(el("p", "help-text", "체중을 기록하면 흐름이 보여요."));
      return;
    }
    const values = summary.days
        .filter((day) => day.weight !== null)
        .map((day) => day.weight),
      min = Math.min(...values) - 0.5,
      maxWeight = Math.max(...values) + 0.5;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 360 162");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "최근 7일 체중. 아래 날짜별 수치 표에서 상세 기록을 확인할 수 있습니다.",
    );
    const points = summary.days.map((day, index) =>
      day.weight === null
        ? null
        : {
            x: 25 + index * 51,
            y: 115 - ((day.weight - min) / (maxWeight - min)) * 83,
            weight: day.weight,
          },
    );
    // Break the line at unmeasured days instead of inventing intermediate weights.
    let segment = [];
    const line = () => {
      if (segment.length > 1) {
        const node = doc.createElementNS(svg.namespaceURI, "polyline");
        node.setAttribute(
          "points",
          segment.map((p) => `${p.x},${p.y}`).join(" "),
        );
        svg.append(node);
      }
      segment = [];
    };
    for (const point of [...points, null]) {
      if (point) segment.push(point);
      else line();
    }
    for (const [index, day] of summary.days.entries()) {
      const label = doc.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", 25 + index * 51);
      label.setAttribute("y", 155);
      label.setAttribute("text-anchor", "middle");
      label.textContent = day.date.slice(5);
      svg.append(label);
      const point = points[index];
      if (!point) continue;
      const circle = doc.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", point.x);
      circle.setAttribute("cy", point.y);
      circle.setAttribute("r", "4");
      const value = doc.createElementNS(svg.namespaceURI, "text");
      value.setAttribute("x", point.x);
      value.setAttribute("y", point.y - 12);
      value.setAttribute("text-anchor", "middle");
      value.textContent = fmt(point.weight);
      svg.append(circle, value);
    }
    target.append(svg);
  }

  function defaultDownload(name, data) {
    const url = win.URL.createObjectURL(
      new win.Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      }),
    );
    const link = el("a");
    link.href = url;
    link.download = name;
    doc.body.append(link);
    link.click();
    link.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  }

  // Auth actions are deliberately invoked directly by clicks (popup policies).
  on($("login-btn"), "click", async () => {
    $("login-btn").disabled = true;
    setText("auth-status", "Google 로그인 창을 확인해 주세요.");
    try {
      await store.login();
    } catch (error) {
      setText("auth-status", friendlyError(error));
    } finally {
      $("login-btn").disabled = false;
    }
  });
  on($("logout-btn"), "click", async () => {
    $("logout-btn").disabled = true;
    // Clear sensitive DOM and listeners immediately, even if sign-out later fails.
    authChanged(null);
    try {
      await store.logout();
    } catch (error) {
      toast(
        `로그아웃에 실패했어요. 페이지를 닫고 다시 확인해 주세요. ${friendlyError(error)}`,
        true,
      );
    } finally {
      $("logout-btn").disabled = false;
    }
  });
  function themeToggle() {
    const dark = doc.documentElement.dataset.theme !== "dark";
    doc.documentElement.dataset.theme = dark ? "dark" : "light";
    preference("theme", dark ? "dark" : "light");
    renderTheme();
  }
  function renderTheme() {
    const dark = doc.documentElement.dataset.theme === "dark";
    setText("theme-toggle", dark ? "☀️" : "🌙");
    $("theme-toggle").setAttribute(
      "aria-label",
      dark ? "라이트 모드 전환" : "다크 모드 전환",
    );
  }
  on($("theme-toggle"), "click", themeToggle);
  for (const tab of doc.querySelectorAll("[data-tab]"))
    on(tab, "click", () => {
      state.tab = tab.dataset.tab;
      for (const item of doc.querySelectorAll("[data-tab]")) {
        const active = item.dataset.tab === state.tab;
        item.classList.toggle("active", active);
        if (active) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
      $("tasks-panel").hidden = state.tab !== "tasks";
      $("health-panel").hidden = state.tab !== "health";
    });
  on(doc, "keydown", (event) => {
    if (event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      themeToggle();
    }
    if (
      event.altKey &&
      event.key.toLowerCase() === "n" &&
      !$("private-app").hidden
    ) {
      event.preventDefault();
      $("tab-tasks").click();
      $("task-input").focus();
    }
  });
  on($("task-form"), "submit", (event) => {
    event.preventDefault();
    action(
      "task",
      "tasks",
      (uid) =>
        store.save(
          uid,
          "tasks",
          null,
          makeTask({
            text: $("task-input").value,
            category: $("category-select").value,
            dueDate: $("due-date-input").value,
          }),
        ),
      () => {
        $("task-input").value = "";
        $("due-date-input").value = "";
        toast("할 일을 추가했어요.");
      },
    );
  });
  on($("search-input"), "input", () => {
    state.search = $("search-input").value;
    renderTasks();
  });
  state.filter = ["all", ...Object.keys(CATEGORIES)].includes(
    preference("filter"),
  )
    ? preference("filter")
    : "all";
  state.sort = ["date-desc", "date-asc", "category", "status"].includes(
    preference("sort"),
  )
    ? preference("sort")
    : "date-desc";
  $("sort-select").value = state.sort;
  for (const filter of doc.querySelectorAll("[data-filter]")) {
    filter.classList.toggle("active", filter.dataset.filter === state.filter);
    filter.setAttribute(
      "aria-pressed",
      String(filter.dataset.filter === state.filter),
    );
    on(filter, "click", () => {
      state.filter = filter.dataset.filter;
      preference("filter", state.filter);
      for (const other of doc.querySelectorAll("[data-filter]")) {
        other.classList.toggle("active", other === filter);
        other.setAttribute("aria-pressed", String(other === filter));
      }
      renderTasks();
    });
  }
  on($("sort-select"), "change", () => {
    state.sort = $("sort-select").value;
    preference("sort", state.sort);
    renderTasks();
  });
  on($("view-toggle"), "click", () => {
    state.calendar = !state.calendar;
    state.editingTask = null;
    renderTasks();
  });
  for (const [id, step] of [
    ["prev-month", -1],
    ["next-month", 1],
  ])
    on($(id), "click", () => {
      const date = state.calendarDate;
      state.calendarDate = new Date(
        date.getFullYear(),
        date.getMonth() + step,
        1,
        12,
      );
      renderTasks();
    });
  on($("delete-completed-btn"), "click", () => {
    const ids = state.data.tasks
      .filter((task) => task.completed)
      .map((task) => task.id);
    if (
      ids.length &&
      ask(`완료한 할 일 ${ids.length}개를 삭제할까요? 되돌릴 수 없습니다.`)
    )
      action(
        "task",
        "tasks",
        (uid) => store.removeMany(uid, "tasks", ids),
        () => toast(`${ids.length}개 항목을 삭제했어요.`),
      );
  });
  on($("health-date"), "change", () => changeDate($("health-date").value));
  on($("health-prev"), "click", () => changeDate(shiftDate(state.date, -1)));
  on($("health-next"), "click", () => changeDate(shiftDate(state.date, 1)));
  on($("health-today"), "click", () => changeDate(dateKey(now())));
  on($("food-search"), "input", () => renderFoods(""));
  on($("food-select"), "change", () => {
    const food = selectedFood();
    if (food) $("meal-amount").value = food.baseAmount;
    previewMeal();
    renderFavoriteButton();
  });
  on($("meal-amount"), "input", previewMeal);
  on($("container-count"), "input", applyContainer);
  on($("container-select"), "change", applyContainer);
  on($("food-favorite"), "click", () => toggleFavorite(selectedFood()?.id));
  on($("load-processed"), "click", () => loadProcessedFoods());
  on($("body-profile-form"), "submit", (event) => {
    event.preventDefault();
    action(
      "profile",
      "profile",
      (uid) =>
        store.save(
          uid,
          "profile",
          BODY_PROFILE_ID,
          makeBodyProfile({
            ...(bodyProfile() || {}),
            sex: $("profile-sex").value,
            birthYear: $("profile-birth-year").value,
            heightCm: $("profile-height").value,
            targetKcal: $("profile-target").value,
          }),
        ),
      () => {
        $("body-profile-details").open = false;
        toast("내 기준을 저장했어요.");
      },
    );
  });
  on($("profile-use-bmr"), "click", () => {
    const bmr = basalMetabolicRate(balanceInputs(), now());
    if (bmr === null) {
      toast("성별·출생연도·키와 체중 기록이 있어야 계산할 수 있어요.", true);
      return;
    }
    $("profile-target").value = bmr;
    toast("기초대사량을 목표 칸에 넣었어요. 저장을 눌러 주세요.");
  });
  on($("checkup-metric"), "change", () =>
    drawCheckupChart($("checkup-metric").value),
  );
  on($("checkup-file"), "change", () => {
    const [file] = $("checkup-file").files;
    if (file) importCheckups(file);
  });
  on($("meal-cancel"), "click", resetMeal);
  on($("meal-form"), "submit", (event) => {
    event.preventDefault();
    action(
      "meal",
      "meals",
      (uid) => {
        const food = selectedFood();
        if (!food) throw new Error("음식을 선택해 주세요.");
        const meal = makeMeal({
          date: state.date,
          mealType: $("meal-type").value,
          food,
          amount: $("meal-amount").value,
          createdAt: state.editingMeal?.createdAt,
        });
        return store.save(uid, "meals", state.editingMeal?.id || null, meal);
      },
      () => {
        resetMeal();
        toast("식사 기록을 저장했어요.");
      },
    );
  });
  on($("food-form"), "submit", (event) => {
    event.preventDefault();
    action(
      "food",
      "foods",
      (uid) => {
        const food = foodSnapshot({
          name: $("custom-food-name").value,
          baseAmount: $("custom-base-amount").value,
          baseUnit: $("custom-base-unit").value,
          kcal: $("custom-kcal").value,
          protein: $("custom-protein").value,
          carbs: $("custom-carbs").value,
          fat: $("custom-fat").value,
          source: $("custom-source").value || "제품 영양표 · 직접 입력",
        });
        return store.save(uid, "foods", null, {
          ...food,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      },
      (id) => {
        $("food-form").reset();
        $("food-search").value = "";
        renderFoods(`custom:${id}`);
        const food = selectedFood();
        if (food) $("meal-amount").value = food.baseAmount;
        previewMeal();
        toast("내 음식에 저장했어요. 먹은 양을 입력해 식사를 기록하세요.");
      },
    );
  });
  on($("workout-cancel"), "click", resetWorkout);
  on($("workout-form"), "submit", (event) => {
    event.preventDefault();
    action(
      "workout",
      "workouts",
      (uid) =>
        store.save(
          uid,
          "workouts",
          state.editingWorkout?.id || null,
          makeWorkout({
            date: state.date,
            kind: $("workout-kind").value,
            minutes: $("workout-minutes").value,
            label: $("workout-label").value,
            planKey: state.editingWorkout?.planKey || "",
            createdAt: state.editingWorkout?.createdAt,
          }),
        ),
      () => {
        resetWorkout();
        toast("운동 기록을 저장했어요.");
      },
    );
  });
  on($("plan-check"), "change", () => {
    const plan = workoutPlan(state.date);
    if (!plan) return;
    const existing = state.data.workouts.find((item) => item.id === plan.key);
    $("plan-check").checked = Boolean(existing);
    if (
      existing &&
      !ask("기본 일정의 완료 기록을 삭제할까요? 수정한 시간도 함께 삭제됩니다.")
    )
      return;
    action(
      "workout",
      "workouts",
      (uid) =>
        existing
          ? store.remove(uid, "workouts", plan.key)
          : store.save(
              uid,
              "workouts",
              plan.key,
              makeWorkout({ ...plan, date: state.date, planKey: plan.key }),
            ),
      () => {
        if (existing && state.editingWorkout?.id === plan.key) resetWorkout();
        toast(existing ? "완료 기록을 해제했어요." : "운동 완료를 기록했어요.");
      },
    );
  });
  for (const id of ["weight-kg", "weight-note"])
    on($(id), "input", () => {
      state.weightDirty = true;
    });
  on($("weight-form"), "submit", (event) => {
    event.preventDefault();
    action(
      "weight",
      "weights",
      (uid) => {
        const previous = state.data.weights.find(
          (item) => item.date === state.date,
        );
        return store.save(
          uid,
          "weights",
          state.date,
          makeWeight({
            date: state.date,
            kg: $("weight-kg").value,
            note: $("weight-note").value,
            createdAt: previous?.createdAt,
          }),
        );
      },
      () => {
        fillWeight(true);
        toast("체중을 저장했어요. 하루 변화보다 7일 평균을 살펴봐요.");
      },
    );
  });
  on($("weight-delete"), "click", () => {
    if (ask("이 날짜의 체중 기록을 삭제할까요?"))
      action(
        "weight",
        "weights",
        (uid) => store.remove(uid, "weights", state.date),
        () => {
          fillWeight(true);
          toast("체중 기록을 삭제했어요.");
        },
      );
  });
  on($("copy-uid"), "click", async () => {
    try {
      await (clipboard || win.navigator.clipboard).writeText(
        state.user?.uid || "",
      );
      toast("UID를 복사했어요.");
    } catch {
      toast("자동 복사를 할 수 없어요. 화면의 UID를 직접 복사해 주세요.", true);
    }
  });
  on($("legacy-load"), "click", () => {
    if (state.user?.uid !== config.legacyOwnerUid) return;
    state.legacy = [];
    state.backedUp = false;
    $("legacy-actions").hidden = true;
    action(
      "legacy",
      "tasks",
      (uid) => store.readLegacy(uid),
      (rows) => {
        state.legacy = rows;
        setText(
          "legacy-status",
          `${rows.length}개 원본을 확인했어요. 먼저 백업을 내려받아 보관해 주세요.`,
        );
        $("legacy-actions").hidden = !rows.length;
      },
    );
  });
  on($("legacy-backup"), "click", () => {
    try {
      (downloadFile || defaultDownload)(
        `my-daily-tasks-legacy-${dateKey(now())}.json`,
        {
          exportedAt: now().toISOString(),
          source: "my_tasks",
          tasks: state.legacy,
        },
      );
      state.backedUp = true;
      controls();
      setText(
        "legacy-status",
        "다운로드된 백업 파일이 정상적으로 열리는지 확인한 뒤 복사해 주세요.",
      );
    } catch (error) {
      toast(friendlyError(error), true);
    }
  });
  on($("legacy-import"), "click", () => {
    if (
      !state.backedUp ||
      state.user?.uid !== config.legacyOwnerUid ||
      !ask("백업 파일을 확인했나요? 원본을 보존한 채 내 계정으로 복사합니다.")
    )
      return;
    const epoch = state.epoch;
    action(
      "legacy",
      "tasks",
      (uid) =>
        store.importLegacy(uid, state.legacy, (result) => {
          if (isCurrent(epoch))
            setText(
              "legacy-status",
              `${result.copied}개 복사 · ${result.existing}개 이미 존재 · ${result.skipped}개 건너뜀`,
            );
        }),
      (result) => {
        setText(
          "legacy-status",
          `완료: ${result.copied}개 복사, ${result.existing}개 이미 존재, ${result.skipped}개 형식 확인 필요. 원본은 삭제하지 않았습니다.`,
        );
        toast("기존 할 일 복사를 마쳤어요.");
      },
    );
  });

  authChanged(null);
  renderTheme();
  // Resetting forms during auth changes should not reset a stored sort preference.
  $("sort-select").value = state.sort;
  if (preference("loadProcessedFoods") === "1") loadProcessedFoods(false);
  const stopAuth = store.observeAuth(authChanged);
  return {
    getState: () => state,
    // Exposed so the import can be exercised without a real file picker.
    importCheckups,
    destroy() {
      state.epoch++;
      subscriptions.forEach((stop) => stop());
      healthSubscriptions.forEach((stop) => stop());
      stopAuth?.();
      listeners.forEach((stop) => stop());
      win.clearTimeout(timer);
    },
  };
}
