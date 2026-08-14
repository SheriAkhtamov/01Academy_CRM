import {
  AlertTriangle,
  CalendarClock,
  GraduationCap,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { copy, nav } from "../content";
import {
  AppWindow,
  AreaChart,
  Background,
  Card,
  MetricCard,
  Pill,
  ProgressBar,
  SceneHeading,
} from "../ui";
import { palette } from "../theme";

export const ExecutiveScene: React.FC = () => (
  <Background accent={palette.blue}>
    <div style={{ position: "absolute", left: 120, top: 54 }}>
      <SceneHeading {...copy.executive} />
    </div>
    <div style={{ position: "absolute", left: 120, top: 278 }}>
      <AppWindow
        sectionLabel="Администрирование"
        title={copy.executive.screenTitle}
        navItems={nav.administration}
        activeItem="Обзор"
        accent={palette.blue}
        delay={24}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
          }}
        >
          {copy.executive.metrics.map((metric, index) => (
            <MetricCard
              key={metric.label}
              {...metric}
              delay={38 + index * 6}
              color={
                [palette.blue, palette.green, palette.cyan, palette.violet][
                  index
                ]
              }
              icon={[Users, TrendingUp, Target, GraduationCap][index]}
            />
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.75fr .8fr",
            gap: 14,
            marginTop: 14,
          }}
        >
          <Card
            title="Динамика бизнеса"
            subtitle="Выручка, лиды и оплаты за последние 12 недель"
            style={{ height: 284 }}
          >
            <div style={{ padding: "11px 20px 0" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <Pill color={palette.blue}>Выручка +12,6%</Pill>
                <Pill color={palette.cyan}>Конверсия 31%</Pill>
              </div>
              <AreaChart delay={58} height={172} />
            </div>
          </Card>
          <Card
            title="Операционные сигналы"
            subtitle="Что требует внимания сегодня"
            style={{ height: 284 }}
          >
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              {[
                [AlertTriangle, "7 просроченных оплат", palette.rose],
                [CalendarClock, "3 конфликта расписания", palette.amber],
                [Users, "9 лидов без менеджера", palette.blue],
              ].map(([Icon, label, color]) => (
                <div
                  key={String(label)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 11,
                    borderRadius: 12,
                    background: `${color}0f`,
                    color: palette.text,
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 10,
                      display: "grid",
                      placeItems: "center",
                      background: `${color}18`,
                      color: String(color),
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {String(label)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 14,
            marginTop: 14,
          }}
        >
          {[
            ["План продаж", 78, palette.blue],
            ["Заполняемость групп", 84, palette.violet],
            ["Проведено уроков", 91, palette.green],
          ].map(([label, value, color], index) => (
            <Card key={String(label)} style={{ height: 112 }}>
              <div style={{ padding: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    fontWeight: 750,
                  }}
                >
                  <span>{String(label)}</span>
                  <span style={{ color: String(color) }}>{Number(value)}%</span>
                </div>
                <div style={{ marginTop: 15 }}>
                  <ProgressBar
                    value={Number(value)}
                    color={String(color)}
                    delay={80 + index * 7}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </AppWindow>
    </div>
  </Background>
);
