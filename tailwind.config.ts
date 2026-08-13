import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
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
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          // The brand ramp was only reachable through hand-written utilities
          // in index.css, so gradient/ring variants (from-primary-600,
          // ring-primary-50) silently produced nothing. Registering it here
          // makes every Tailwind variant of the ramp work.
          "50": "var(--primary-50)",
          "100": "var(--primary-100)",
          "500": "var(--primary-500)",
          "600": "var(--primary-600)",
          "700": "var(--primary-700)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        input: {
          DEFAULT: "var(--input)",
          background: "var(--input-background)",
        },
        elevated: {
          DEFAULT: "var(--elevated)",
          foreground: "var(--elevated-foreground)",
        },
        surface: {
          "1": "var(--surface-1)",
          "2": "var(--surface-2)",
          "3": "var(--surface-3)",
          "4": "var(--surface-4)",
        },
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
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
