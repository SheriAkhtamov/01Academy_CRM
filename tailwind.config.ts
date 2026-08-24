import type { Config } from "tailwindcss";

/*
  Every theme colour is a CSS variable holding a complete colour — `hsl(...)`,
  `#fff`, or another variable — rather than the bare channel triplet Tailwind
  expects. Tailwind cannot slice an alpha channel into a value it cannot parse,
  and rather than failing it silently emits nothing: `bg-card/95`,
  `bg-muted/40` and `bg-background/85` produced no rule at all, so the sidebar
  drawer, the task board columns and the sticky header were painted with no
  background whatsoever. On a desktop that is invisible — those panels sit on a
  page of the same colour — but on a phone the drawer is `fixed` above the
  page, and the whole screen showed straight through the navigation.

  `color-mix()` applies the alpha without Tailwind ever having to understand
  the colour. Tailwind substitutes `<alpha-value>` here exactly as it would in
  an `hsl(… / <alpha-value>)` string, and with no modifier it substitutes `1`,
  which resolves back to the untouched colour.
*/
const themeColor = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      /*
        Card and tile rows size themselves from the width of their own
        container, not the width of the window.

        A breakpoint like `xl:grid-cols-5` fires at a 1280px *viewport*, but the
        panel holding the tiles is 960px once the sidebar and page padding are
        taken out — so five columns land at 182px each, labels truncate, and
        "цель меньше 50 000" breaks across two lines. auto-fit drops to as many
        columns as actually fit, and the minmax floor is what a tile needs to
        stay readable. Pick the step by content: `tile` for a KPI number,
        `card` for a card with a sentence in it, `panel` for a chart.

        The floor is wrapped in `min(_, 100%)` because a bare minmax floor is a
        *minimum*, not a preference: in a container narrower than the floor —
        a phone, or a card nested two levels deep inside one — the single
        remaining track still claims its full 13/17/22rem and pushes the page
        into horizontal scroll. `min()` lets that last track collapse to the
        width it actually has, and changes nothing whenever there is room.
      */
      gridTemplateColumns: {
        tile: "repeat(auto-fit, minmax(min(13rem, 100%), 1fr))",
        card: "repeat(auto-fit, minmax(min(17rem, 100%), 1fr))",
        panel: "repeat(auto-fit, minmax(min(22rem, 100%), 1fr))",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "2xs": "var(--shadow-2xs)",
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        primary: "var(--shadow-primary)",
        "primary-lg": "var(--shadow-primary-lg)",
      },
      colors: {
        background: themeColor("--background"),
        foreground: themeColor("--foreground"),
        card: {
          DEFAULT: themeColor("--card"),
          foreground: themeColor("--card-foreground"),
        },
        popover: {
          DEFAULT: themeColor("--popover"),
          foreground: themeColor("--popover-foreground"),
        },
        primary: {
          DEFAULT: themeColor("--primary"),
          foreground: themeColor("--primary-foreground"),
          // The brand ramp was only reachable through hand-written utilities
          // in index.css, so gradient/ring variants (from-primary-600,
          // ring-primary-50) silently produced nothing. Registering it here
          // makes every Tailwind variant of the ramp work.
          "50": themeColor("--primary-50"),
          "100": themeColor("--primary-100"),
          "500": themeColor("--primary-500"),
          "600": themeColor("--primary-600"),
          "700": themeColor("--primary-700"),
        },
        secondary: {
          DEFAULT: themeColor("--secondary"),
          foreground: themeColor("--secondary-foreground"),
        },
        muted: {
          DEFAULT: themeColor("--muted"),
          foreground: themeColor("--muted-foreground"),
        },
        accent: {
          DEFAULT: themeColor("--accent"),
          foreground: themeColor("--accent-foreground"),
        },
        destructive: {
          DEFAULT: themeColor("--destructive"),
          foreground: themeColor("--destructive-foreground"),
        },
        border: {
          DEFAULT: themeColor("--border"),
          strong: themeColor("--border-strong"),
        },
        input: {
          DEFAULT: themeColor("--input"),
          background: themeColor("--input-background"),
        },
        elevated: {
          DEFAULT: themeColor("--elevated"),
          foreground: themeColor("--elevated-foreground"),
        },
        surface: {
          "1": themeColor("--surface-1"),
          "2": themeColor("--surface-2"),
          "3": themeColor("--surface-3"),
          "4": themeColor("--surface-4"),
        },
        ring: themeColor("--ring"),
        chart: {
          "1": themeColor("--chart-1"),
          "2": themeColor("--chart-2"),
          "3": themeColor("--chart-3"),
          "4": themeColor("--chart-4"),
          "5": themeColor("--chart-5"),
        },
        sidebar: {
          DEFAULT: themeColor("--sidebar-background"),
          foreground: themeColor("--sidebar-foreground"),
          primary: themeColor("--sidebar-primary"),
          "primary-foreground": themeColor("--sidebar-primary-foreground"),
          accent: themeColor("--sidebar-accent"),
          "accent-foreground": themeColor("--sidebar-accent-foreground"),
          border: themeColor("--sidebar-border"),
          ring: themeColor("--sidebar-ring"),
        },
      },
      // Motion timing shared with the framer-motion tokens in
      // client/src/lib/motion.ts — CSS-driven and JS-driven animation must
      // agree on easing, or a hover and the entrance it follows look like they
      // came from two different apps.
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "overshoot": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "in-expo": "cubic-bezier(0.7, 0, 0.84, 0)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // Loading sweep for <Skeleton>. Travels a full width past the right
        // edge so the pause between passes reads as a rhythm, not a stall.
        "skeleton-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "60%, 100%": { transform: "translateX(100%)" },
        },
        // Slides a 200%-wide gradient across its own box. Used for animated
        // brand text and living borders.
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        // An expanding halo behind a live status dot (call ringing, socket up).
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.65" },
          "70%, 100%": { transform: "scale(2.1)", opacity: "0" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "skeleton-sweep": "skeleton-sweep 1.6s ease-in-out infinite",
        "gradient-pan": "gradient-pan 6s ease infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "float": "float 4s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
