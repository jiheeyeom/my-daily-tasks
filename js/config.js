// Firebase web configuration identifies the project. It is not an AI/service-account secret.
export const firebaseConfig = {
  apiKey: "AIzaSyCZ1yq2FivxetLa5IW6p1-gSvwn8oCy3fc",
  authDomain: "my-daily-tasks-64a0b.firebaseapp.com",
  projectId: "my-daily-tasks-64a0b",
  storageBucket: "my-daily-tasks-64a0b.firebasestorage.app",
  messagingSenderId: "107857208354",
  appId: "1:107857208354:web:5b19eadf79a6342306167b",
};

export const appConfig = {
  // Enable only AFTER deploying the supplied Firestore rules. See docs/FIREBASE_SETUP.md.
  // This flag prevents accidental writes during setup; only the server-side rules provide security.
  securityRulesConfigured: true,
  // The owner who may copy the OLD shared my_tasks collection. Never auto-assign the first login.
  // Use the same UID in firestore.rules. Leave empty if legacy migration is not needed.
  legacyOwnerUid: "xVhMdeOb3Uh0yVovUmnooRb8mSn2",
};
