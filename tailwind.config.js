/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./web/index.html", "./web/src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        surface2: v("surface-2"),
        ink: v("ink"),
        muted: v("muted"),
        line: v("line"),
        brand: { DEFAULT: v("brand"), ink: v("brand-ink"), deep: v("brand-deep") },
        accent: { DEFAULT: v("accent"), soft: v("accent-soft"), ink: v("accent-ink") },
        pos: { DEFAULT: v("pos"), soft: v("pos-soft") },
        neg: { DEFAULT: v("neg"), soft: v("neg-soft") },
        info: { DEFAULT: v("info"), soft: v("info-soft") },
        viz: { out: v("viz-out"), in: v("viz-in") },
        rail: { DEFAULT: v("rail"), ink: v("rail-ink"), muted: v("rail-muted"), hover: v("rail-hover") },
      },
      fontFamily: {
        sans: ['"Sofia Sans Variable"', '"Sofia Sans"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { xl: "14px", "2xl": "18px", "3xl": "24px" },
      boxShadow: {
        lift: "0 1px 2px rgb(5 34 75 / .06), 0 8px 28px rgb(5 34 75 / .08)",
        pop: "0 12px 40px rgb(5 34 75 / .18)",
      },
      keyframes: {
        "check-pop": { "0%": { transform: "scale(.6)" }, "60%": { transform: "scale(1.15)" }, "100%": { transform: "scale(1)" } },
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": { from: { transform: "translateY(8px)", opacity: 0 }, to: { transform: "none", opacity: 1 } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "panel-in": { from: { transform: "translateX(24px)", opacity: 0 }, to: { transform: "none", opacity: 1 } },
        "pop-in": { from: { transform: "translateY(6px) scale(.98)", opacity: 0 }, to: { transform: "none", opacity: 1 } },
      },
      animation: {
        "check-pop": "check-pop .32s cubic-bezier(.2,.9,.3,1.3)",
        "fade-in": "fade-in .18s ease-out",
        "slide-up": "slide-up .22s cubic-bezier(.2,.8,.2,1)",
        "panel-in": "panel-in .24s cubic-bezier(.2,.8,.2,1)",
        "pop-in": "pop-in .16s cubic-bezier(.2,.8,.2,1)",
      },
    },
  },
  plugins: [],
};
