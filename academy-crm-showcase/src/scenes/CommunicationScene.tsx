import {
  Camera,
  CheckCheck,
  MessageCircle,
  Phone,
  PhoneCall,
  Send,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { copy, nav } from "../content";
import {
  AppWindow,
  Avatar,
  Background,
  Pill,
  SceneHeading,
  enter,
} from "../ui";
import { palette } from "../theme";

const conversations = [
  ["Амина Юсупова", "Здравствуйте! Хочу на Python", "2", palette.violet],
  ["Тимур Саидов", "Спасибо, буду на демо", "", palette.blue],
  ["Малика Рахимова", "Можно расписание занятий?", "1", palette.rose],
  ["Рустам Каримов", "Отправил подтверждение", "", palette.green],
];

export const CommunicationScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Background accent={palette.cyan}>
      <div style={{ position: "absolute", left: 120, top: 54 }}>
        <SceneHeading {...copy.communication} accent="#5eead4" />
      </div>
      <div style={{ position: "absolute", left: 120, top: 278 }}>
        <AppWindow
          sectionLabel="Продажи"
          title={copy.communication.screenTitle}
          navItems={nav.sales}
          activeItem="Сообщения"
          accent={palette.cyan}
          delay={24}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "330px 1fr",
              height: 646,
              background: "#fff",
              border: `1px solid ${palette.line}`,
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                borderRight: `1px solid ${palette.line}`,
                background: "#fbfcfe",
              }}
            >
              <div
                style={{
                  height: 62,
                  padding: "0 17px",
                  borderBottom: `1px solid ${palette.line}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontSize: 14,
                    fontWeight: 850,
                  }}
                >
                  <Camera size={18} color={palette.violet} /> Instagram Direct
                </div>
                <Pill color={palette.green}>online</Pill>
              </div>
              <div style={{ padding: 9 }}>
                {conversations.map(([name, message, count, color], index) => (
                  <div
                    key={String(name)}
                    style={{
                      padding: 12,
                      borderRadius: 13,
                      display: "flex",
                      gap: 10,
                      background:
                        index === 0 ? `${palette.cyan}13` : "transparent",
                      border: `1px solid ${index === 0 ? `${palette.cyan}28` : "transparent"}`,
                      opacity: enter(frame, 44 + index * 6),
                    }}
                  >
                    <Avatar
                      initials={String(name)
                        .split(" ")
                        .map((p) => p[0])
                        .join("")}
                      color={String(color)}
                      size={38}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 800 }}>
                          {String(name)}
                        </span>
                        <span style={{ fontSize: 9, color: palette.muted }}>
                          12:4{index}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 10,
                          color: palette.muted,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {String(message)}
                      </div>
                    </div>
                    {count ? (
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: palette.cyan,
                          color: "#fff",
                          fontSize: 9,
                          fontWeight: 900,
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        {String(count)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  height: 62,
                  borderBottom: `1px solid ${palette.line}`,
                  padding: "0 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <Avatar initials="АЮ" color={palette.violet} size={37} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 850 }}>
                      Амина Юсупова
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: palette.green,
                        marginTop: 2,
                      }}
                    >
                      в сети • источник Instagram
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div
                    style={{
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 10,
                      background: `${palette.green}12`,
                      color: palette.green,
                      display: "flex",
                      gap: 7,
                      alignItems: "center",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    <Phone size={14} /> Позвонить
                  </div>
                  <Pill color={palette.blue}>
                    <UserPlus size={12} /> Лид создан
                  </Pill>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  padding: 22,
                  background: "linear-gradient(180deg, #fbfdff, #f7f9fc)",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    marginLeft: "auto",
                    width: 390,
                    padding: "12px 14px",
                    borderRadius: "15px 15px 4px 15px",
                    background: palette.cyan,
                    color: "#063a34",
                    fontSize: 12,
                    lineHeight: 1.5,
                    fontWeight: 650,
                    opacity: enter(frame, 55),
                  }}
                >
                  Здравствуйте, Амина! Подберём удобную группу. Вам подходят
                  будни после 17:00?
                </div>
                <div
                  style={{
                    marginTop: 16,
                    width: 360,
                    padding: "12px 14px",
                    borderRadius: "15px 15px 15px 4px",
                    background: "#fff",
                    border: `1px solid ${palette.line}`,
                    color: palette.text,
                    fontSize: 12,
                    lineHeight: 1.5,
                    opacity: enter(frame, 75),
                  }}
                >
                  Да, идеально. И можно сначала прийти на демо-урок?
                </div>
                <div
                  style={{
                    marginTop: 16,
                    marginLeft: "auto",
                    width: 420,
                    padding: "12px 14px",
                    borderRadius: "15px 15px 4px 15px",
                    background: palette.cyan,
                    color: "#063a34",
                    fontSize: 12,
                    lineHeight: 1.5,
                    fontWeight: 650,
                    opacity: enter(frame, 95),
                  }}
                >
                  Конечно! Записала вас на завтра, 18:30. Подтверждение уже в
                  карточке сделки.
                </div>
                <div
                  style={{
                    marginTop: 7,
                    marginLeft: "auto",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 5,
                    color: palette.cyan,
                    fontSize: 9,
                    fontWeight: 750,
                  }}
                >
                  <CheckCheck size={13} /> прочитано
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 22,
                    right: 22,
                    bottom: 18,
                    height: 46,
                    borderRadius: 13,
                    background: "#fff",
                    border: `1px solid ${palette.line}`,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    color: palette.muted,
                    fontSize: 11,
                  }}
                >
                  Написать сообщение…
                  <div
                    style={{
                      marginLeft: "auto",
                      width: 31,
                      height: 31,
                      borderRadius: 10,
                      background: palette.cyan,
                      display: "grid",
                      placeItems: "center",
                      color: "#fff",
                    }}
                  >
                    <Send size={15} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              right: 18,
              top: 20,
              width: 370,
              height: 610,
              background: "#fff",
              borderRadius: 18,
              border: `1px solid ${palette.line}`,
              boxShadow: "-22px 24px 60px rgba(15,23,42,.19)",
              opacity: enter(frame, 128),
              translate: `${interpolate(frame, [128, 156], [55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0`,
              overflow: "hidden",
            }}
          >
            <div
              style={{ padding: 18, borderBottom: `1px solid ${palette.line}` }}
            >
              <div style={{ fontSize: 16, fontWeight: 850 }}>
                {copy.communication.sheetTitle}
              </div>
              <div style={{ fontSize: 10, color: palette.muted, marginTop: 4 }}>
                Сделка • активность • оплата • задачи
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
                <Avatar initials="АЮ" color={palette.violet} size={46} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 850 }}>
                    Амина Юсупова
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                    <Pill color={palette.amber}>Демо-урок</Pill>
                    <Pill color={palette.violet}>Instagram</Pill>
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 20,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 9,
                }}
              >
                {[
                  ["Курс", "Python Start"],
                  ["Менеджер", "Шери"],
                  ["Демо", "15 авг • 18:30"],
                  ["Ожидаем", "1 200 000 UZS"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      padding: 11,
                      borderRadius: 11,
                      background: palette.surface,
                    }}
                  >
                    <div style={{ fontSize: 9, color: palette.muted }}>
                      {label}
                    </div>
                    <div
                      style={{ fontSize: 11, fontWeight: 800, marginTop: 4 }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, fontSize: 11, fontWeight: 850 }}>
                Последняя активность
              </div>
              <div style={{ marginTop: 11, display: "grid", gap: 13 }}>
                {[
                  [
                    MessageCircle,
                    "Ответ в Instagram",
                    "сейчас",
                    palette.violet,
                  ],
                  [Sparkles, "Демо-урок назначен", "1 мин", palette.amber],
                  [PhoneCall, "Исходящий звонок", "12 мин", palette.green],
                ].map(([Icon, label, time, color]) => (
                  <div
                    key={String(label)}
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 10,
                        display: "grid",
                        placeItems: "center",
                        background: `${color}12`,
                        color: String(color),
                      }}
                    >
                      <Icon size={15} />
                    </div>
                    <div style={{ flex: 1, fontSize: 11, fontWeight: 700 }}>
                      {String(label)}
                    </div>
                    <div style={{ fontSize: 9, color: palette.muted }}>
                      {String(time)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              right: 392,
              bottom: 24,
              height: 54,
              padding: "0 18px",
              borderRadius: 16,
              background: "#0f172a",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 11,
              boxShadow: "0 20px 40px rgba(15,23,42,.28)",
              opacity: enter(frame, 155),
              translate: `0 ${interpolate(frame, [155, 177], [24, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px`,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: palette.green,
                display: "grid",
                placeItems: "center",
              }}
            >
              <PhoneCall size={17} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 850 }}>
                OnlinePBX • входящий звонок
              </div>
              <div style={{ fontSize: 9, color: "#9fb0c5", marginTop: 3 }}>
                Малика Рахимова • лид найден
              </div>
            </div>
          </div>
        </AppWindow>
      </div>
    </Background>
  );
};
