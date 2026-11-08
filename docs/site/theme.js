// Apply before paint; storage may be unavailable in private contexts.
(() => {
  let preference;
  try {
    preference = localStorage.getItem("fiore-theme");
  } catch {}
  document.documentElement.dataset.theme =
    preference === "light" || preference === "dark"
      ? preference
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
})();
