import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  GraduationCap,
  KanbanSquare,
  Landmark,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { brand } from "./content";
import { palette } from "./theme";

export const enter = (frame: number, delay = 0) =>
  interpolate(frame, [delay, delay + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

export const Background: React.FC<{
  accent?: string;
  children?: ReactNode;
  dark?: boolean;
}> = ({ accent = palette.blue, children, dark = true }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: dark
          ? `radial-gradient(circle at 12% 18%, ${accent}24, transparent 31%), radial-gradient(circle at 88% 78%, #7c3aed20, transparent 34%), linear-gradient(145deg, #040812 0%, #081326 54%, #050914 100%)`
          : "#f7f9fc",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: dark ? 0.18 : 0.08,
          backgroundImage:
            "linear-gradient(rgba(148,163,184,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.22) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          translate: `${interpolate(frame, [0, 300], [0, -24], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px ${interpolate(frame, [0, 300], [0, -14], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          borderRadius: "50%",
          left: -250,
          top: 520,
          background: `radial-gradient(circle, ${accent}28 0%, transparent 68%)`,
          scale: interpolate(frame, [0, 150, 300], [0.92, 1.08, 0.95], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.ease),
          }),
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

export const BrandMark: React.FC<{ compact?: boolean; light?: boolean }> = ({
  compact = false,
  light = false,
}) => (
  <div
    style={{ display: "flex", alignItems: "center", gap: compact ? 12 : 18 }}
  >
    <div
      style={{
        width: compact ? 46 : 70,
        height: compact ? 46 : 70,
        borderRadius: compact ? 13 : 20,
        display: "grid",
        placeItems: "center",
        background: light ? "#fff" : "rgba(255,255,255,.96)",
        boxShadow: "0 12px 34px rgba(52,120,246,.2)",
        overflow: "hidden",
      }}
    >
      <Img
        src={staticFile("logo.png")}
        style={{
          width: compact ? 42 : 64,
          height: compact ? 42 : 64,
          objectFit: "contain",
        }}
      />
    </div>
    <div>
      <div
        style={{
          fontSize: compact ? 21 : 31,
          lineHeight: 1,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          color: light ? palette.text : "#fff",
        }}
      >
        {brand.name}
      </div>
      {!compact ? (
        <div
          style={{
            marginTop: 7,
            fontSize: 15,
            color: light ? palette.muted : "#93a4bd",
            fontWeight: 600,
          }}
        >
          {brand.product}
        </div>
      ) : null}
    </div>
  </div>
);

export const SceneHeading: React.FC<{
  eyebrow: string;
  title: string;
  subtitle: string;
  accent?: string;
  align?: "left" | "center";
}> = ({ eyebrow, title, subtitle, accent = palette.blue2, align = "left" }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: align === "center" ? 1260 : 1540,
        margin: align === "center" ? "0 auto" : 0,
        textAlign: align,
        opacity: enter(frame, 0),
        translate: `0 ${interpolate(frame, [0, 24], [26, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`,
      }}
    >
      <div
        style={{
          fontSize: 18,
          letterSpacing: ".18em",
          fontWeight: 800,
          color: accent,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 67,
          lineHeight: 1.02,
          fontWeight: 850,
          letterSpacing: "-0.055em",
          color: "#f8fbff",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 27,
          lineHeight: 1.35,
          color: "#9eacc2",
          fontWeight: 500,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
};

const navIcons: Record<string, LucideIcon> = {
  Обзор: BarChart3,
  Сотрудники: Users,
  "Структура академии": Settings2,
  "Управление продажами": TrendingUp,
  Аудит: ShieldCheck,
  Интеграции: Activity,
  Воронка: TrendingUp,
  Архив: ClipboardCheck,
  Расписание: CalendarDays,
  Клиенты: GraduationCap,
  Сообщения: MessageCircle,
  "Журнал звонков": Phone,
  Эффективность: BarChart3,
  "Мои группы": Users,
  Посещаемость: ClipboardCheck,
  Источники: Megaphone,
  Рефералы: Users,
  Расходы: CircleDollarSign,
  "Meta Attribution": Sparkles,
  "Meta Events": Activity,
  Доходы: TrendingUp,
  Зарплаты: Landmark,
  Транзакции: CircleDollarSign,
  "Доска задач": KanbanSquare,
};

export const AppWindow: React.FC<{
  sectionLabel: string;
  title: string;
  navItems: readonly string[];
  activeItem?: string;
  children: ReactNode;
  accent?: string;
  delay?: number;
  scale?: number;
  style?: CSSProperties;
}> = ({
  sectionLabel,
  title,
  navItems,
  activeItem,
  children,
  accent = palette.blue,
  delay = 20,
  scale = 1,
  style,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: 1680,
        height: 770,
        borderRadius: 30,
        background: "#fff",
        overflow: "hidden",
        boxShadow:
          "0 42px 110px rgba(0,0,0,.38), 0 0 0 1px rgba(255,255,255,.12)",
        display: "flex",
        opacity: enter(frame, delay),
        translate: `0 ${interpolate(frame, [delay, delay + 28], [50, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`,
        scale:
          scale *
          interpolate(frame, [delay, delay + 28], [0.965, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        transformOrigin: "50% 50%",
        ...style,
      }}
    >
      <aside
        style={{
          width: 260,
          background: "linear-gradient(180deg, #fbfdff, #f6f8fc)",
          borderRight: `1px solid ${palette.line}`,
          padding: "24px 18px",
          flexShrink: 0,
        }}
      >
        <BrandMark compact light />
        <div
          style={{
            marginTop: 32,
            padding: "0 10px",
            fontSize: 12,
            letterSpacing: ".13em",
            fontWeight: 800,
            color: "#94a3b8",
            textTransform: "uppercase",
          }}
        >
          {sectionLabel}
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
          {navItems.map((item, index) => {
            const Icon = navIcons[item] ?? BarChart3;
            const active = item === activeItem;
            return (
              <div
                key={item}
                style={{
                  height: 44,
                  borderRadius: 12,
                  padding: "0 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  color: active ? "#194fbb" : "#64748b",
                  background: active ? `${accent}16` : "transparent",
                  fontSize: 14,
                  fontWeight: active ? 750 : 600,
                  opacity: enter(frame, delay + 8 + index * 3),
                  position: "relative",
                }}
              >
                {active ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 11,
                      width: 3,
                      height: 22,
                      borderRadius: 6,
                      background: accent,
                    }}
                  />
                ) : null}
                <Icon size={18} strokeWidth={2.2} />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item}
                </span>
              </div>
            );
          })}
        </div>
      </aside>
      <section
        style={{
          minWidth: 0,
          flex: 1,
          background: palette.surface,
          color: palette.text,
        }}
      >
        <header
          style={{
            height: 74,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 30px",
            borderBottom: `1px solid ${palette.line}`,
            background: "rgba(255,255,255,.92)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 21,
                fontWeight: 800,
                letterSpacing: "-0.03em",
              }}
            >
              {title}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: palette.muted }}>
              14 августа 2026 • данные обновлены сейчас
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                height: 37,
                width: 260,
                border: `1px solid ${palette.line}`,
                background: "#fff",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "0 13px",
                color: "#94a3b8",
                fontSize: 13,
              }}
            >
              <Search size={16} /> Поиск и быстрые действия
            </div>
            <div
              style={{
                height: 37,
                width: 37,
                borderRadius: 12,
                background: "#fff",
                border: `1px solid ${palette.line}`,
                display: "grid",
                placeItems: "center",
                color: palette.muted,
              }}
            >
              <Bell size={17} />
            </div>
            <div
              style={{
                height: 38,
                padding: "0 10px 0 6px",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#fff",
                border: `1px solid ${palette.line}`,
              }}
            >
              <Avatar initials="ША" color={accent} size={27} />
              <span style={{ fontSize: 12, fontWeight: 750 }}>Шери</span>
              <ChevronDown size={14} color={palette.muted} />
            </div>
          </div>
        </header>
        <div
          style={{
            height: 696,
            padding: 24,
            overflow: "hidden",
            position: "relative",
          }}
        >
          {children}
        </div>
      </section>
    </div>
  );
};

export const Avatar: React.FC<{
  initials: string;
  color?: string;
  size?: number;
}> = ({ initials, color = palette.blue, size = 34 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.32),
      background: `linear-gradient(145deg, ${color}, ${color}aa)`,
      color: "#fff",
      display: "grid",
      placeItems: "center",
      fontSize: Math.max(10, size * 0.33),
      fontWeight: 800,
      boxShadow: `0 5px 14px ${color}28`,
      flexShrink: 0,
    }}
  >
    {initials}
  </div>
);

export const Pill: React.FC<{
  children: ReactNode;
  color?: string;
  muted?: boolean;
}> = ({ children, color = palette.blue, muted = false }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      borderRadius: 999,
      padding: "5px 9px",
      color: muted ? palette.muted : color,
      background: muted ? "#eef2f7" : `${color}14`,
      border: `1px solid ${muted ? "#e2e8f0" : `${color}22`}`,
      fontSize: 11,
      fontWeight: 750,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

export const MetricCard: React.FC<{
  label: string;
  value: string;
  delta?: string;
  color?: string;
  delay?: number;
  icon?: LucideIcon;
}> = ({
  label,
  value,
  delta,
  color = palette.blue,
  delay = 0,
  icon: Icon = TrendingUp,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${palette.line}`,
        borderRadius: 18,
        padding: 17,
        boxShadow: "0 8px 26px rgba(15,23,42,.055)",
        opacity: enter(frame, delay),
        translate: `0 ${interpolate(frame, [delay, delay + 20], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 12, color: palette.muted, fontWeight: 650 }}>
          {label}
        </div>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            background: `${color}14`,
            display: "grid",
            placeItems: "center",
            color,
          }}
        >
          <Icon size={15} />
        </div>
      </div>
      <div
        style={{
          marginTop: 9,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 27,
            lineHeight: 1,
            fontWeight: 850,
            letterSpacing: "-0.045em",
          }}
        >
          {value}
        </div>
        {delta ? (
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: palette.green,
              display: "flex",
              gap: 3,
              alignItems: "center",
            }}
          >
            <ArrowUpRight size={12} />
            {delta}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const Card: React.FC<{
  children: ReactNode;
  title?: string;
  subtitle?: string;
  style?: CSSProperties;
}> = ({ children, title, subtitle, style }) => (
  <div
    style={{
      background: "#fff",
      border: `1px solid ${palette.line}`,
      borderRadius: 18,
      boxShadow: "0 10px 28px rgba(15,23,42,.055)",
      overflow: "hidden",
      ...style,
    }}
  >
    {title ? (
      <div
        style={{
          height: 58,
          padding: "0 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${palette.line}`,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
          {subtitle ? (
            <div style={{ fontSize: 10, color: palette.muted, marginTop: 3 }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        <MoreHorizontal size={18} color={palette.muted} />
      </div>
    ) : null}
    {children}
  </div>
);

export const AreaChart: React.FC<{
  color?: string;
  height?: number;
  delay?: number;
  compact?: boolean;
}> = ({ color = palette.blue, height = 176, delay = 0, compact = false }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [delay, delay + 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const points = compact
    ? "0,84 60,72 120,77 180,50 240,58 300,29 360,38 420,18"
    : "0,146 120,128 240,137 360,96 480,108 600,62 720,76 840,34 960,50 1080,17";
  const id = color.replace("#", "");
  return (
    <svg
      viewBox={compact ? "0 0 420 100" : "0 0 1080 170"}
      style={{ width: "100%", height }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".26" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`clip-${id}`}>
          <rect width={`${progress * 100}%`} height="100%" />
        </clipPath>
      </defs>
      {[30, 65, 100, 135].map((y) => (
        <line
          key={y}
          x1="0"
          x2="1080"
          y1={y}
          y2={y}
          stroke="#e9edf4"
          strokeWidth="1"
        />
      ))}
      <g clipPath={`url(#clip-${id})`}>
        <polygon
          points={`${points} ${compact ? "420,100 0,100" : "1080,170 0,170"}`}
          fill={`url(#fill-${id})`}
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={compact ? 4 : 5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};

export const ProgressBar: React.FC<{
  value: number;
  color?: string;
  delay?: number;
  height?: number;
}> = ({ value, color = palette.blue, delay = 0, height = 8 }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        height,
        borderRadius: 999,
        background: "#edf1f6",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${interpolate(frame, [delay, delay + 35], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}%`,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${color}, ${color}bb)`,
          boxShadow: `0 0 14px ${color}44`,
        }}
      />
    </div>
  );
};

export const CheckLine: React.FC<{
  label: string;
  checked?: boolean;
  color?: string;
}> = ({ label, checked = true, color = palette.green }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 12,
      color: checked ? palette.text : palette.muted,
      fontWeight: 650,
    }}
  >
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 7,
        background: checked ? color : "#fff",
        border: `1px solid ${checked ? color : "#dbe2ea"}`,
        color: "#fff",
        display: "grid",
        placeItems: "center",
      }}
    >
      {checked ? <Check size={13} strokeWidth={3} /> : null}
    </div>
    {label}
  </div>
);

export const Modal: React.FC<{
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
  style?: CSSProperties;
}> = ({ title, subtitle, children, width = 660, style }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(7,18,36,.33)",
        backdropFilter: "blur(3px)",
        display: "grid",
        placeItems: "center",
        opacity: enter(frame, 55),
        ...style,
      }}
    >
      <div
        style={{
          width,
          borderRadius: 22,
          background: "#fff",
          border: "1px solid rgba(255,255,255,.8)",
          boxShadow: "0 34px 90px rgba(7,18,36,.35)",
          scale: interpolate(frame, [55, 79], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
        }}
      >
        <div
          style={{
            padding: "22px 24px 18px",
            borderBottom: `1px solid ${palette.line}`,
          }}
        >
          <div
            style={{ fontSize: 20, fontWeight: 850, letterSpacing: "-.025em" }}
          >
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: palette.muted, marginTop: 5 }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
};

export const Cursor: React.FC<{
  x: number;
  y: number;
  delay?: number;
  clickAt?: number;
  color?: string;
}> = ({ x, y, delay = 0, clickAt = 70, color = palette.blue }) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(
    frame,
    [clickAt, clickAt + 8, clickAt + 20],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: enter(frame, delay),
        translate: `${interpolate(frame, [delay, delay + 24], [55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px ${interpolate(frame, [delay, delay + 24], [35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px`,
        zIndex: 50,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 46,
          height: 46,
          left: -14,
          top: -14,
          borderRadius: "50%",
          border: `3px solid ${color}`,
          opacity: pulse,
          scale: 0.55 + pulse * 0.7,
        }}
      />
      <svg width="30" height="36" viewBox="0 0 30 36">
        <path
          d="M3 2L26 21H16L12 32L6 29L10 18H3V2Z"
          fill="#fff"
          stroke="#0f172a"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

export const SectionBadge: React.FC<{
  children: ReactNode;
  color?: string;
}> = ({ children, color = palette.blue }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 11px",
      borderRadius: 10,
      background: `${color}10`,
      color,
      fontSize: 12,
      fontWeight: 800,
    }}
  >
    {children}
  </div>
);
