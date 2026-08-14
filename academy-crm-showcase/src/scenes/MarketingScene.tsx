import {
  Activity,
  ArrowRight,
  BadgePercent,
  Camera,
  HeartHandshake,
  MousePointerClick,
  RadioTower,
  Target,
} from "lucide-react";
import { copy, nav } from "../content";
import {
  AppWindow,
  Background,
  Card,
  MetricCard,
  Pill,
  ProgressBar,
  SceneHeading,
} from "../ui";
import { palette } from "../theme";

export const MarketingScene: React.FC = () => (
  <Background accent={palette.rose}>
    <div style={{ position: "absolute", left: 120, top: 54 }}>
      <SceneHeading {...copy.marketing} accent="#fb7185" />
    </div>
    <div style={{ position: "absolute", left: 120, top: 278 }}>
      <AppWindow
        sectionLabel="Маркетинг"
        title={copy.marketing.screenTitle}
        navItems={nav.marketing}
        activeItem="Обзор"
        accent={palette.rose}
        delay={24}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 13,
          }}
        >
          <MetricCard
            label="Новые лиды"
            value="428"
            delta="+24%"
            color={palette.rose}
            delay={38}
            icon={MousePointerClick}
          />
          <MetricCard
            label="Стоимость лида"
            value="42 800"
            delta="−8%"
            color={palette.blue}
            delay={44}
            icon={BadgePercent}
          />
          <MetricCard
            label="Конверсия в оплату"
            value="18,6%"
            delta="+3,1%"
            color={palette.green}
            delay={50}
            icon={Target}
          />
          <MetricCard
            label="ROMI"
            value="312%"
            delta="+41%"
            color={palette.violet}
            delay={56}
            icon={Activity}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 13,
            marginTop: 13,
          }}
        >
          <Card
            title="Воронка маркетинга"
            subtitle="От показа до оплаты"
            style={{ height: 318 }}
          >
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              {[
                ["Показы", "128K", 100, palette.violet],
                ["Клики", "6 840", 82, palette.blue],
                ["Лиды", "428", 63, palette.cyan],
                ["Демо", "164", 44, palette.amber],
                ["Оплаты", "79", 26, palette.green],
              ].map(([label, value, width, color], index) => (
                <div
                  key={String(label)}
                  style={{
                    width: `${Number(width)}%`,
                    minWidth: 150,
                    height: 37,
                    margin: "0 auto",
                    borderRadius: 9,
                    background: `${color}13`,
                    border: `1px solid ${color}28`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 11px",
                    color: palette.text,
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 750 }}>
                    {String(label)}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      color: String(color),
                    }}
                  >
                    {String(value)}
                  </span>
                  {index < 4 ? (
                    <ArrowRight size={11} color={String(color)} />
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
          <Card
            title="Источники лидов"
            subtitle="Выручка и конверсия"
            style={{ height: 318 }}
          >
            <div style={{ padding: 18 }}>
              <div style={{ display: "grid", placeItems: "center" }}>
                <div
                  style={{
                    width: 132,
                    height: 132,
                    borderRadius: "50%",
                    background: `conic-gradient(${palette.violet} 0 41%, ${palette.blue} 41% 70%, ${palette.cyan} 70% 87%, ${palette.amber} 87% 100%)`,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 23,
                      borderRadius: "50%",
                      background: "#fff",
                      display: "grid",
                      placeItems: "center",
                      textAlign: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 900 }}>428</div>
                      <div style={{ fontSize: 8, color: palette.muted }}>
                        лидов
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 9,
                }}
              >
                {[
                  ["Instagram", "41%", palette.violet],
                  ["Meta Ads", "29%", palette.blue],
                  ["Рефералы", "17%", palette.cyan],
                  ["Сайт", "13%", palette.amber],
                ].map(([label, value, color]) => (
                  <div
                    key={String(label)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 3,
                        background: String(color),
                      }}
                    />
                    <span style={{ flex: 1, color: palette.muted }}>
                      {String(label)}
                    </span>
                    <strong>{String(value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card
            title="Meta Event Manager"
            subtitle="События отправляются автоматически"
            style={{ height: 318 }}
          >
            <div style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderRadius: 13,
                  background: `${palette.blue}0c`,
                  border: `1px solid ${palette.blue}22`,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    background: palette.blue,
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <RadioTower size={17} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 850 }}>
                    Conversions API
                  </div>
                  <div
                    style={{ fontSize: 9, color: palette.green, marginTop: 3 }}
                  >
                    подключено • качество 9.2 / 10
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14, display: "grid", gap: 11 }}>
                {[
                  ["Lead", 96, palette.violet],
                  ["Schedule", 88, palette.blue],
                  ["Purchase", 91, palette.green],
                ].map(([label, value, color], index) => (
                  <div key={String(label)}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        fontWeight: 750,
                        marginBottom: 6,
                      }}
                    >
                      <span>{String(label)}</span>
                      <span style={{ color: String(color) }}>
                        {Number(value)}%
                      </span>
                    </div>
                    <ProgressBar
                      value={Number(value)}
                      color={String(color)}
                      delay={70 + index * 7}
                      height={6}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 15, display: "flex", gap: 7 }}>
                <Pill color={palette.green}>
                  <Activity size={11} /> realtime
                </Pill>
                <Pill color={palette.violet}>
                  <Camera size={11} /> attributed
                </Pill>
              </div>
            </div>
          </Card>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 13,
            marginTop: 13,
          }}
        >
          <div
            style={{
              height: 122,
              borderRadius: 17,
              padding: 17,
              background: "linear-gradient(135deg, #fff4f6, #fff)",
              border: `1px solid ${palette.rose}22`,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 15,
                background: `${palette.rose}14`,
                color: palette.rose,
                display: "grid",
                placeItems: "center",
              }}
            >
              <HeartHandshake size={23} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 850 }}>
                Реферальная программа
              </div>
              <div style={{ fontSize: 10, color: palette.muted, marginTop: 4 }}>
                37 новых клиентов • 52,8 млн UZS выручки
              </div>
            </div>
            <Pill color={palette.rose}>+19%</Pill>
          </div>
          <div
            style={{
              height: 122,
              borderRadius: 17,
              padding: 17,
              background: "linear-gradient(135deg, #f2f7ff, #fff)",
              border: `1px solid ${palette.blue}22`,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 15,
                background: `${palette.blue}14`,
                color: palette.blue,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Camera size={23} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 850 }}>
                Сквозная атрибуция
              </div>
              <div style={{ fontSize: 10, color: palette.muted, marginTop: 4 }}>
                Кампания → лид → демо → оплата
              </div>
            </div>
            <Pill color={palette.green}>работает</Pill>
          </div>
        </div>
      </AppWindow>
    </div>
  </Background>
);
