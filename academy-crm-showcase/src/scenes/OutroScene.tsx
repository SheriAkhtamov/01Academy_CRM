import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  GraduationCap,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { brand, copy } from "../content";
import { Background, BrandMark, enter } from "../ui";
import { palette } from "../theme";

const stepIcons = [
  UserPlus,
  Sparkles,
  GraduationCap,
  CalendarCheck2,
  CircleDollarSign,
  BarChart3,
];
const stepColors = [
  palette.violet,
  palette.rose,
  palette.blue,
  palette.cyan,
  palette.green,
  palette.amber,
];

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Background accent={palette.cyan}>
      <div
        style={{
          position: "absolute",
          top: 94,
          left: 0,
          right: 0,
          display: "grid",
          placeItems: "center",
          opacity: enter(frame, 0),
        }}
      >
        <BrandMark />
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          top: 260,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: ".2em",
            fontWeight: 850,
            color: palette.cyan,
            opacity: enter(frame, 14),
          }}
        >
          {copy.outro.eyebrow}
        </div>
        <Interactive.Div
          name="Финальный заголовок"
          style={{
            marginTop: 20,
            fontSize: 82,
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: "-.065em",
            color: "#f8fbff",
            opacity: interpolate(frame, [16, 44], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: `0px ${interpolate(frame, [16, 44], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`,
          }}
        >
          {brand.closing}
        </Interactive.Div>
        <div
          style={{
            marginTop: 20,
            fontSize: 25,
            color: "#9eacc2",
            fontWeight: 520,
            opacity: enter(frame, 40),
          }}
        >
          {copy.outro.subtitle}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 145,
          right: 145,
          top: 560,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        {copy.outro.steps.map((step, index) => {
          const Icon = stepIcons[index];
          const color = stepColors[index];
          return (
            <div key={step} style={{ display: "contents" }}>
              <div
                style={{
                  width: 205,
                  height: 118,
                  borderRadius: 24,
                  background: "rgba(255,255,255,.07)",
                  border: `1px solid ${color}42`,
                  backdropFilter: "blur(14px)",
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                  opacity: enter(frame, 62 + index * 8),
                  translate: `0 ${interpolate(frame, [62 + index * 8, 84 + index * 8], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px`,
                }}
              >
                <div>
                  <div
                    style={{
                      width: 41,
                      height: 41,
                      margin: "0 auto",
                      borderRadius: 13,
                      background: `${color}24`,
                      color,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon size={20} />
                  </div>
                  <div
                    style={{
                      marginTop: 11,
                      color: "#eef5ff",
                      fontSize: 15,
                      fontWeight: 800,
                    }}
                  >
                    {step}
                  </div>
                </div>
              </div>
              {index < copy.outro.steps.length - 1 ? (
                <ArrowRight size={19} color="#5f718b" />
              ) : null}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 102,
          textAlign: "center",
          opacity: enter(frame, 126),
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 22px",
            borderRadius: 16,
            background: "linear-gradient(135deg, #3478f6, #2162db)",
            color: "#fff",
            boxShadow: "0 18px 45px rgba(52,120,246,.36)",
            fontSize: 18,
            fontWeight: 850,
          }}
        >
          <CheckCircle2 size={21} />
          {copy.outro.cta}
        </div>
      </div>
    </Background>
  );
};
