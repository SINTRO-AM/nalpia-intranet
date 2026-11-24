// Setzt das Farbschema vor dem ersten Rendern (verhindert Aufblitzen). Extern, damit die CSP kein inline-Script braucht.
(function () {
  try {
    var t = localStorage.getItem("nalpia-theme") || "system";
    var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
