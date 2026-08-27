import { readFile } from "node:fs/promises";
import { test, before, after, beforeEach } from "node:test";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
} from "firebase/firestore";
import {
  makeTask,
  makeMeal,
  makeWorkout,
  makeWeight,
  foodSnapshot,
} from "../js/domain.js";
import { FOOD_CATALOG } from "../js/foods.js";

let env;
before(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST.startsWith("127.0.0.1:")
  )
    throw new Error("Only a local emulator is allowed for security tests.");
  const rules = (
    await readFile(new URL("../firestore.rules", import.meta.url), "utf8")
  ).replace("let uid = '';", "let uid = 'owner';");
  env = await initializeTestEnvironment({
    projectId: "demo-my-daily-tasks",
    firestore: { rules },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const food = foodSnapshot(FOOD_CATALOG[0]);
const records = {
  tasks: {
    id: "one",
    data: makeTask(
      { text: "Example task", category: "work", dueDate: "2026-08-20" },
      1000,
    ),
  },
  foods: { id: "one", data: { ...food, createdAt: 1000, updatedAt: 1000 } },
  meals: {
    id: "one",
    data: makeMeal(
      { date: "2026-08-20", mealType: "lunch", food, amount: 120 },
      1000,
    ),
  },
  workouts: {
    id: "one",
    data: makeWorkout(
      { date: "2026-08-20", kind: "yoga", label: "Yoga", minutes: 45 },
      1000,
    ),
  },
  weights: {
    id: "2026-08-20",
    data: makeWeight({ date: "2026-08-20", kg: 68, note: "Test data" }, 1000),
  },
};

for (const [kind, { id, data }] of Object.entries(records)) {
  test(`${kind}: only document owner can create/read/query/update/delete`, async () => {
    const owner = env.authenticatedContext("alice").firestore(),
      other = env.authenticatedContext("bob").firestore(),
      anon = env.unauthenticatedContext().firestore();
    const path = `users/alice/${kind}/${id}`;
    await assertFails(setDoc(doc(anon, path), data));
    await assertFails(setDoc(doc(other, path), data));
    await assertSucceeds(setDoc(doc(owner, path), data));
    await assertSucceeds(getDoc(doc(owner, path)));
    await assertSucceeds(getDocs(collection(owner, `users/alice/${kind}`)));
    await assertFails(getDoc(doc(other, path)));
    await assertFails(getDocs(collection(other, `users/alice/${kind}`)));
    await assertFails(getDoc(doc(anon, path)));
    await assertSucceeds(updateDoc(doc(owner, path), { updatedAt: 2000 }));
    await assertFails(
      updateDoc(doc(owner, path), { createdAt: 2, updatedAt: 3000 }),
    );
    await assertFails(updateDoc(doc(owner, path), { unexpected: true }));
    await assertFails(deleteDoc(doc(other, path)));
    await assertFails(deleteDoc(doc(anon, path)));
    await assertSucceeds(deleteDoc(doc(owner, path)));
  });
}

test("meal validation rejects mismatched units, missing fields and invalid numbers", async () => {
  const db = env.authenticatedContext("alice").firestore(),
    ref = doc(db, "users/alice/meals/m");
  const meal = records.meals.data;
  for (const bad of [
    { ...meal, amount: -1 },
    { ...meal, amount: "100" },
    { ...meal, amount: 0 },
    { ...meal, amount: Infinity },
    { ...meal, unit: "ml" },
    { ...meal, mealType: "unknown" },
    { ...meal, date: "2026-99-01" },
    { ...meal, food: { ...food, kcal: null } },
    { ...meal, food: { ...food, extra: true } },
  ])
    await assertFails(setDoc(ref, bad));
  const missing = { ...meal };
  delete missing.amount;
  await assertFails(setDoc(ref, missing));
  await assertSucceeds(
    setDoc(ref, {
      ...meal,
      food: { ...food, protein: null, fat: null, carbs: null },
    }),
  );
});

test("zero calories and macro nulls are allowed; unsafe sources are denied", async () => {
  const db = env.authenticatedContext("alice").firestore(),
    ref = doc(db, "users/alice/foods/zero");
  await assertSucceeds(
    setDoc(ref, { ...records.foods.data, kcal: 0, protein: null }),
  );
  await assertFails(updateDoc(ref, { sourceUrl: "javascript:alert(1)" }));
  await assertFails(updateDoc(ref, { baseAmount: 0 }));
  await assertFails(updateDoc(ref, { name: "x".repeat(101) }));
});

test("weight uses one document per date and health ranges support filtered queries", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(
    setDoc(doc(db, "users/alice/weights/not-the-date"), records.weights.data),
  );
  await assertSucceeds(
    setDoc(doc(db, "users/alice/weights/2026-08-20"), records.weights.data),
  );
  await assertSucceeds(
    getDocs(
      query(
        collection(db, "users/alice/weights"),
        where("date", ">=", "2026-08-14"),
        where("date", "<=", "2026-08-20"),
        orderBy("date"),
      ),
    ),
  );
  await assertFails(
    updateDoc(doc(db, "users/alice/weights/2026-08-20"), { kg: 0 }),
  );
  await assertFails(
    setDoc(doc(db, "users/alice/weights/2026-02-29"), {
      ...records.weights.data,
      date: "2026-02-29",
    }),
  );
  await assertSucceeds(
    setDoc(doc(db, "users/alice/weights/2024-02-29"), {
      ...records.weights.data,
      date: "2024-02-29",
    }),
  );
});

test("legacy records can only be read by configured owner and never written", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "my_tasks/legacy-one"), {
      text: "Original",
    });
  });
  const owner = env.authenticatedContext("owner").firestore(),
    alice = env.authenticatedContext("alice").firestore(),
    anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(collection(owner, "my_tasks")));
  await assertFails(getDocs(collection(alice, "my_tasks")));
  await assertFails(getDoc(doc(anon, "my_tasks/legacy-one")));
  await assertFails(setDoc(doc(owner, "my_tasks/new"), { text: "No" }));
  await assertFails(deleteDoc(doc(owner, "my_tasks/legacy-one")));
  await assertSucceeds(
    setDoc(doc(owner, "users/owner/tasks/legacy_one"), {
      ...records.tasks.data,
      legacySourceId: "one",
    }),
  );
});

test("unknown collections and root profiles are denied even to authenticated users", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(setDoc(doc(db, "users/alice"), { admin: true }));
  await assertFails(setDoc(doc(db, "users/alice/secrets/x"), { value: true }));
  await assertFails(getDocs(collection(db, "users")));
});
