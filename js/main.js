import { firebaseConfig, appConfig } from "./config.js";
import { createApp } from "./app.js";
import { FOOD_CATALOG } from "./foods.js";
import { refreshPublicContent } from "./news.js";

// A CDN/network failure should leave a useful error, not an endless loading screen.
try {
  const { createFirebaseStore } = await import("./firebase-store.js");
  createApp({
    document,
    store: createFirebaseStore(firebaseConfig),
    catalog: FOOD_CATALOG,
    config: appConfig,
  });
} catch {
  document.getElementById("auth-status").textContent =
    "로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.";
  document.getElementById("login-btn").disabled = true;
}

refreshPublicContent(document);
setInterval(
  () => {
    if (!document.hidden) refreshPublicContent(document);
  },
  30 * 60 * 1000,
);
