try {
  const saved = localStorage.getItem("myDailyTasks_theme");
  if (
    saved === "dark" ||
    (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)
  )
    document.documentElement.dataset.theme = "dark";
} catch {
  /* Browser storage may be disabled; the light theme remains usable. */
}
