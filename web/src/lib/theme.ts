export type Theme = "system" | "light" | "dark";

let mq: MediaQueryList | null = null;
let listener: (() => void) | null = null;

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem("nalpia-theme", t);
  } catch {
    /* private mode */
  }
  const root = document.documentElement;
  const set = () => {
    const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", dark ? "#07111F" : "#05224B");
  };
  if (mq && listener) mq.removeEventListener("change", listener);
  mq = window.matchMedia("(prefers-color-scheme: dark)");
  listener = set;
  if (t === "system") mq.addEventListener("change", listener);
  set();
}

export function currentTheme(): Theme {
  try {
    return (localStorage.getItem("nalpia-theme") as Theme) || "system";
  } catch {
    return "system";
  }
}
