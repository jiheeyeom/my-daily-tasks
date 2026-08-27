import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { copyLegacyTasks } from "./migration.js";

const ALLOWED = new Set([
  "tasks",
  "foods",
  "meals",
  "workouts",
  "weights",
  "checkups",
]);

export function createFirebaseStore(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  // Memory cache only: shared devices should not retain health records on disk.
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  function privateCollection(uid, kind) {
    if (!uid || auth.currentUser?.uid !== uid || !ALLOWED.has(kind))
      throw new Error("로그인한 계정을 확인해 주세요.");
    return collection(db, "users", uid, kind);
  }

  function documentRef(uid, kind, id) {
    const parent = privateCollection(uid, kind);
    if (typeof id !== "string" || !id || id.includes("/"))
      throw new Error("기록 식별자가 올바르지 않습니다.");
    return doc(parent, id);
  }

  return {
    observeAuth(callback) {
      return onAuthStateChanged(auth, callback);
    },
    login() {
      return signInWithPopup(auth, provider);
    },
    logout() {
      return signOut(auth);
    },
    watch(uid, kind, options, callback, onError) {
      let target = privateCollection(uid, kind);
      if (options?.start && options?.end)
        target = query(
          target,
          where("date", ">=", options.start),
          where("date", "<=", options.end),
          orderBy("date"),
        );
      return onSnapshot(
        target,
        { includeMetadataChanges: true },
        (snapshot) => {
          callback(
            snapshot.docs.map((item) => ({ ...item.data(), id: item.id })),
            {
              fromCache: snapshot.metadata.fromCache,
              pending: snapshot.metadata.hasPendingWrites,
            },
          );
        },
        onError,
      );
    },
    async save(uid, kind, id, data) {
      const ref = id
        ? documentRef(uid, kind, id)
        : doc(privateCollection(uid, kind));
      await setDoc(ref, data);
      return ref.id;
    },
    remove(uid, kind, id) {
      return deleteDoc(documentRef(uid, kind, id));
    },
    async removeMany(uid, kind, ids) {
      // Keep each batch below Firestore's 500-write limit.
      for (let offset = 0; offset < ids.length; offset += 400) {
        const batch = writeBatch(db);
        for (const id of ids.slice(offset, offset + 400))
          batch.delete(documentRef(uid, kind, id));
        await batch.commit();
      }
    },
    async readLegacy(uid) {
      privateCollection(uid, "tasks");
      const snapshot = await getDocs(collection(db, "my_tasks"));
      return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
    },
    async importLegacy(uid, rows, onProgress = () => {}) {
      return copyLegacyTasks(
        rows,
        async (id, data) => {
          // Same source ID always maps to the same destination. Never overwrite edits.
          const ref = documentRef(uid, "tasks", id);
          return runTransaction(db, async (transaction) => {
            if ((await transaction.get(ref)).exists()) return false;
            transaction.set(ref, data);
            return true;
          });
        },
        onProgress,
      );
    },
  };
}
