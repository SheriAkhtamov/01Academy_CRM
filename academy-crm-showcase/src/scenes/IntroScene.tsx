import { Interactive, Easing, interpolate, useCurrentFrame } from "remotion";
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  GraduationCap,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { brand, copy } from "../content";
import { Background, BrandMark, enter } from "../ui";
import { palette } from "../theme";

const chipIcons = [
  BarChart3,
  GraduationCap,
  Sparkles,
  CircleDollarSign,
  MessageCircle,
];

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Background accent={palette.blue}>
      <div
        style={{
          position: "absolute",
          left: 118,
          top: 92,
          opacity: enter(frame, 0),
        }}
      >
        <BrandMark />
      </div>
      <div
        style={{
          position: "absolute",
          right: 110,
          top: 100,
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "#8ea0ba",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: ".04em",
          opacity: enter(frame, 12),
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: palette.green,
            boxShadow: `0 0 18px ${palette.green}`,
          }}
        />
        REALTIME • 2026
      </div>
      <div style={{ position: "absolute", left: 118, right: 118, top: 282 }}>
        <div
          style={{
            fontSize: 18,
            letterSpacing: ".2em",
            fontWeight: 850,
            color: palette.blue2,
            opacity: enter(frame, 18),
          }}
        >
          {copy.intro.eyebrow}
        </div>
        <Interactive.Div
          name="Главный заголовок"
          style={{
            marginTop: 20,
            maxWidth: 1280,
            fontSize: 112,
            lineHeight: 0.98,
            fontWeight: 900,
            letterSpacing: "-0.07em",
            color: "#f8fbff",
            opacity: interpolate(frame, [16, 45], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: `${interpolate(frame, [16, 45], [-18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0px`,
          }}
        >
          {brand.promise}
        </Interactive.Div>
        <div
          style={{
            marginTop: 28,
            maxWidth: 950,
            fontSize: 34,
            lineHeight: 1.35,
            color: "#a5b2c7",
            fontWeight: 520,
            opacity: enter(frame, 40),
          }}
        >
          {copy.intro.subtitle}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 118,
          bottom: 102,
          display: "flex",
          gap: 14,
        }}
      >
        {copy.intro.chips.map((chip, index) => {
          const Icon = chipIcons[index] ?? CalendarDays;
          return (
            <div
              key={chip}
              style={{
                height: 58,
                padding: "0 20px",
                borderRadius: 17,
                display: "flex",
                alignItems: "center",
                gap: 11,
                background: "rgba(255,255,255,.07)",
                border: "1px solid rgba(255,255,255,.12)",
                color: "#dce6f5",
                fontSize: 16,
                fontWeight: 750,
                backdropFilter: "blur(12px)",
                opacity: enter(frame, 62 + index * 7),
                translate: `0 ${interpolate(frame, [62 + index * 7, 84 + index * 7], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px`,
              }}
            >
              <Icon
                size={19}
                color={index % 2 ? palette.cyan : palette.blue2}
              />
              {chip}
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          width: 540,
          height: 540,
          borderRadius: "50%",
          right: -70,
          top: 250,
          border: "1px solid rgba(104,160,255,.16)",
          scale: interpolate(frame, [0, 120, 240], [0.86, 1.04, 0.9], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.ease),
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 360,
          height: 360,
          borderRadius: "50%",
          right: 20,
          top: 340,
          border: "1px solid rgba(45,212,191,.17)",
          rotate: `${interpolate(frame, [0, 240], [0, 34], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}deg`,
        }}
      />
    </Background>
  );
};
