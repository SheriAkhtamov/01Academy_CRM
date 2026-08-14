import {
  Activity,
  Camera,
  CheckCircle2,
  Cloud,
  Database,
  Globe2,
  Languages,
  LockKeyhole,
  MoonStar,
  PhoneCall,
  RadioTower,
  ShieldCheck,
  SunMedium,
  Users,
} from "lucide-react";
import { copy, integrationNames, nav } from "../content";
import {
  AppWindow,
  Background,
  Card,
  Pill,
  ProgressBar,
  SceneHeading,
} from "../ui";
import { palette } from "../theme";

const integrationIcons = [Camera, RadioTower, PhoneCall, Globe2, Activity];

export const PlatformScene: React.FC = () => (
  <Background accent={palette.blue}>
    <div style={{ position: "absolute", left: 120, top: 54 }}>
      <SceneHeading {...copy.platform} />
    </div>
    <div style={{ position: "absolute", left: 120, top: 278 }}>
      <AppWindow
        sectionLabel="Администрирование"
        title={copy.platform.screenTitle}
        navItems={nav.administration}
        activeItem="Интеграции"
        accent={palette.blue}
        delay={24}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr .8fr",
            gap: 14,
            height: 646,
          }}
        >
          <div
            style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 14 }}
          >
            <Card
              title="Подключённые каналы"
              subtitle="Все системы обмениваются данными автоматически"
            >
              <div
                style={{
                  padding: 15,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 9,
                }}
              >
                {integrationNames.map((name, index) => {
                  const Icon = integrationIcons[index];
                  const color = [
                    palette.violet,
                    palette.blue,
                    palette.green,
                    palette.amber,
                    palette.cyan,
                  ][index];
                  return (
                    <div
                      key={name}
                      style={{
                        height: 70,
                        borderRadius: 13,
                        background: `${color}0b`,
                        border: `1px solid ${color}22`,
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "0 12px",
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 11,
                          display: "grid",
                          placeItems: "center",
                          color: "#fff",
                          background: color,
                        }}
                      >
                        <Icon size={18} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 850 }}>
                          {name}
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: palette.green,
                            marginTop: 4,
                          }}
                        >
                          подключено
                        </div>
                      </div>
                      <CheckCircle2 size={15} color={palette.green} />
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card
              title="Надёжность и realtime"
              subtitle="Стабильная работа для всей команды"
            >
              <div
                style={{
                  padding: 16,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 10,
                }}
              >
                {[
                  [Cloud, "99,98%", "доступность", palette.blue],
                  [Database, "PostgreSQL", "единые данные", palette.violet],
                  [RadioTower, "< 1 сек", "realtime", palette.cyan],
                ].map(([Icon, value, label, color]) => (
                  <div
                    key={String(label)}
                    style={{
                      height: 115,
                      borderRadius: 14,
                      background: palette.surface,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background: `${color}12`,
                        color: String(color),
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Icon size={16} />
                    </div>
                    <div
                      style={{ marginTop: 13, fontSize: 16, fontWeight: 900 }}
                    >
                      {String(value)}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 9,
                        color: palette.muted,
                      }}
                    >
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
              gridTemplateRows: "1.15fr .85fr",
              gap: 14,
            }}
          >
            <Card
              title="Роли и доступ"
              subtitle="Каждый видит только своё рабочее пространство"
            >
              <div style={{ padding: 16 }}>
                {[
                  ["Супер-администратор", 100, palette.blue],
                  ["Менеджер продаж", 68, palette.violet],
                  ["Преподаватель", 46, palette.green],
                  ["Бухгалтер", 52, palette.amber],
                ].map(([label, value, color], index) => (
                  <div
                    key={String(label)}
                    style={{ marginBottom: index < 3 ? 15 : 0 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 10,
                        fontWeight: 780,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Users size={12} color={String(color)} />
                        {String(label)}
                      </span>
                      <span style={{ color: String(color) }}>
                        {Number(value)}%
                      </span>
                    </div>
                    <ProgressBar
                      value={Number(value)}
                      color={String(color)}
                      delay={60 + index * 7}
                      height={6}
                    />
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 18,
                    padding: 12,
                    borderRadius: 12,
                    background: `${palette.blue}0b`,
                    border: `1px solid ${palette.blue}20`,
                    display: "flex",
                    gap: 10,
                  }}
                >
                  <ShieldCheck size={20} color={palette.blue} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 850 }}>
                      Полный журнал аудита
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: palette.muted,
                        marginTop: 4,
                      }}
                    >
                      Кто, когда и что изменил
                    </div>
                  </div>
                </div>
              </div>
            </Card>
            <Card title="Интерфейс для всей команды">
              <div style={{ padding: 16, display: "grid", gap: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: 11,
                    borderRadius: 12,
                    background: palette.surface,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    <Languages size={17} color={palette.violet} /> Русский •
                    O‘zbekcha • English
                  </div>
                  <Pill color={palette.violet}>i18n</Pill>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 9,
                  }}
                >
                  <div
                    style={{
                      height: 64,
                      borderRadius: 12,
                      background: "#fff",
                      border: `1px solid ${palette.line}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    <SunMedium size={17} color={palette.amber} /> Светлая тема
                  </div>
                  <div
                    style={{
                      height: 64,
                      borderRadius: 12,
                      background: palette.navy,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    <MoonStar size={17} color={palette.blue2} /> Тёмная тема
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <Pill color={palette.green}>
                    <LockKeyhole size={11} /> Безопасно
                  </Pill>
                  <Pill color={palette.blue}>
                    <Activity size={11} /> Быстро
                  </Pill>
                  <Pill color={palette.violet}>
                    <ShieldCheck size={11} /> Контролируемо
                  </Pill>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </AppWindow>
    </div>
  </Background>
);
