import {
  CalendarDays,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Sparkles,
} from "lucide-react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { copy, nav, people } from "../content";
import {
  AppWindow,
  Avatar,
  Background,
  Cursor,
  Pill,
  SceneHeading,
  enter,
} from "../ui";
import { palette } from "../theme";

const leadRows = [
  [people[0], "Instagram", palette.violet],
  [people[1], "Сайт", palette.blue],
  [people[2], "Рекомендация", palette.green],
  [people[3], "Meta Ads", palette.amber],
];

const PipelineCard: React.FC<{
  person: (typeof people)[number];
  source: string;
  color: string;
  delay: number;
  highlighted?: boolean;
}> = ({ person, source, color, delay, highlighted }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        padding: 13,
        background: "#fff",
        borderRadius: 14,
        border: `1px solid ${highlighted ? `${palette.blue}66` : palette.line}`,
        boxShadow: highlighted
          ? "0 18px 34px rgba(52,120,246,.2)"
          : "0 7px 18px rgba(15,23,42,.05)",
        opacity: enter(frame, delay),
        translate: highlighted
          ? `${interpolate(frame, [95, 142], [0, 270], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px ${interpolate(frame, [95, 142], [0, 85], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px`
          : "0 0",
        zIndex: highlighted ? 20 : 1,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <Avatar
            initials={person.name
              .split(" ")
              .map((part) => part[0])
              .join("")}
            color={color}
            size={31}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{person.name}</div>
            <div style={{ fontSize: 10, color: palette.muted, marginTop: 3 }}>
              {person.course}
            </div>
          </div>
        </div>
        <MoreHorizontal size={15} color={palette.muted} />
      </div>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Pill color={color}>{source}</Pill>
        <span style={{ fontSize: 10, color: palette.muted }}>сегодня</span>
      </div>
      <div
        style={{
          marginTop: 12,
          borderTop: `1px solid ${palette.line}`,
          paddingTop: 10,
          display: "flex",
          justifyContent: "space-between",
          color: palette.muted,
        }}
      >
        <div style={{ display: "flex", gap: 9 }}>
          <Phone size={14} />
          <MessageCircle size={14} />
          <CalendarDays size={14} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 750 }}>
          {person.amount} UZS
        </span>
      </div>
    </div>
  );
};

export const SalesScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Background accent={palette.violet}>
      <div style={{ position: "absolute", left: 120, top: 54 }}>
        <SceneHeading {...copy.sales} accent="#a78bfa" />
      </div>
      <div style={{ position: "absolute", left: 120, top: 278 }}>
        <AppWindow
          sectionLabel="Продажи"
          title={copy.sales.screenTitle}
          navItems={nav.sales}
          activeItem="Воронка"
          accent={palette.violet}
          delay={24}
        >
          <div
            style={{
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <Pill color={palette.violet}>
                <Sparkles size={12} /> 38 новых
              </Pill>
              <Pill muted>Мои лиды</Pill>
              <Pill muted>Все источники</Pill>
            </div>
            <div
              style={{
                height: 38,
                padding: "0 15px",
                borderRadius: 11,
                background: palette.violet,
                color: "#fff",
                fontSize: 12,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                gap: 7,
                boxShadow: `0 10px 20px ${palette.violet}35`,
              }}
            >
              <Plus size={16} /> Новый лид
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 13,
              height: 578,
            }}
          >
            {copy.sales.columns.map((column, columnIndex) => (
              <div
                key={column}
                style={{
                  background: "#eef2f7",
                  borderRadius: 16,
                  padding: 12,
                  position: "relative",
                  overflow: "visible",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    height: 34,
                    padding: "0 3px",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: [
                          palette.blue,
                          palette.cyan,
                          palette.amber,
                          palette.green,
                        ][columnIndex],
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 850 }}>
                      {column}
                    </span>
                  </div>
                  <Pill muted>{[12, 8, 5, 3][columnIndex]}</Pill>
                </div>
                <div style={{ display: "grid", gap: 10, marginTop: 7 }}>
                  {columnIndex === 0 ? (
                    <PipelineCard
                      person={leadRows[0][0] as (typeof people)[number]}
                      source={String(leadRows[0][1])}
                      color={String(leadRows[0][2])}
                      delay={54}
                      highlighted
                    />
                  ) : null}
                  <PipelineCard
                    person={
                      leadRows[
                        (columnIndex + 1) % 4
                      ][0] as (typeof people)[number]
                    }
                    source={String(leadRows[(columnIndex + 1) % 4][1])}
                    color={String(leadRows[(columnIndex + 1) % 4][2])}
                    delay={58 + columnIndex * 7}
                  />
                  <PipelineCard
                    person={
                      leadRows[
                        (columnIndex + 2) % 4
                      ][0] as (typeof people)[number]
                    }
                    source={String(leadRows[(columnIndex + 2) % 4][1])}
                    color={String(leadRows[(columnIndex + 2) % 4][2])}
                    delay={68 + columnIndex * 7}
                  />
                </div>
              </div>
            ))}
          </div>
          <Cursor
            x={214}
            y={176}
            delay={84}
            clickAt={146}
            color={palette.violet}
          />
          <div
            style={{
              position: "absolute",
              left: 520,
              top: 235,
              padding: "9px 13px",
              borderRadius: 12,
              background: palette.violet,
              color: "#fff",
              fontSize: 11,
              fontWeight: 800,
              opacity: interpolate(frame, [122, 142, 174, 190], [0, 1, 1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              boxShadow: `0 12px 30px ${palette.violet}48`,
            }}
          >
            Статус обновлён • realtime
          </div>
        </AppWindow>
      </div>
    </Background>
  );
};
