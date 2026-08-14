import {
  BookOpenCheck,
  CalendarCheck,
  Check,
  Clock3,
  UserCheck,
  Users,
} from "lucide-react";
import { copy, nav } from "../content";
import {
  AppWindow,
  Avatar,
  Background,
  Modal,
  Pill,
  ProgressBar,
  SceneHeading,
} from "../ui";
import { palette } from "../theme";

const roster = [
  ["Амина Юсупова", "АЮ", true],
  ["Тимур Саидов", "ТС", true],
  ["Малика Рахимова", "МР", false],
  ["Рустам Каримов", "РК", true],
  ["Лола Алиева", "ЛА", true],
];

export const TeacherScene: React.FC = () => (
  <Background accent={palette.green}>
    <div style={{ position: "absolute", left: 120, top: 54 }}>
      <SceneHeading {...copy.teacher} accent="#4ade80" />
    </div>
    <div style={{ position: "absolute", left: 120, top: 278 }}>
      <AppWindow
        sectionLabel="Преподаватель"
        title={copy.teacher.screenTitle}
        navItems={nav.teacher}
        activeItem="Расписание"
        accent={palette.green}
        delay={24}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.25fr .75fr",
            gap: 14,
            height: 646,
          }}
        >
          <div
            style={{
              background: "#fff",
              border: `1px solid ${palette.line}`,
              borderRadius: 18,
              padding: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 850 }}>
                  Сегодня • пятница, 14 августа
                </div>
                <div
                  style={{ fontSize: 10, color: palette.muted, marginTop: 4 }}
                >
                  3 занятия • 27 учеников
                </div>
              </div>
              <Pill color={palette.green}>
                <CalendarCheck size={12} /> всё по плану
              </Pill>
            </div>
            <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
              {[
                [
                  "10:00",
                  "Python Start",
                  "CYP-PY-GRP-26-0018",
                  "Проведён",
                  palette.green,
                ],
                [
                  "14:30",
                  "Web Junior",
                  "CYP-WEB-GRP-26-0021",
                  "Сейчас",
                  palette.blue,
                ],
                [
                  "17:30",
                  "Python Start",
                  "ONL-PY-GRP-26-0027",
                  "Далее",
                  palette.violet,
                ],
              ].map(([time, title, code, status, color]) => (
                <div
                  key={String(code)}
                  style={{
                    padding: 15,
                    borderRadius: 14,
                    border: `1px solid ${status === "Сейчас" ? `${color}66` : palette.line}`,
                    background: status === "Сейчас" ? `${color}0b` : "#fff",
                    display: "grid",
                    gridTemplateColumns: "74px 1fr auto",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 850,
                      color: String(color),
                    }}
                  >
                    {String(time)}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 850 }}>
                      {String(title)}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: palette.muted,
                        marginTop: 4,
                      }}
                    >
                      {String(code)} • Room 3
                    </div>
                  </div>
                  <Pill color={String(color)}>{String(status)}</Pill>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 18,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div
                style={{
                  padding: 15,
                  borderRadius: 14,
                  background: palette.surface,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  <span>Прогресс курса</span>
                  <span style={{ color: palette.blue }}>18 / 24 урока</span>
                </div>
                <div style={{ marginTop: 13 }}>
                  <ProgressBar value={75} color={palette.blue} delay={55} />
                </div>
              </div>
              <div
                style={{
                  padding: 15,
                  borderRadius: 14,
                  background: palette.surface,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  <span>Средняя посещаемость</span>
                  <span style={{ color: palette.green }}>89%</span>
                </div>
                <div style={{ marginTop: 13 }}>
                  <ProgressBar value={89} color={palette.green} delay={61} />
                </div>
              </div>
            </div>
          </div>
          <div
            style={{ display: "grid", gap: 14, gridTemplateRows: "1fr 1fr" }}
          >
            <div
              style={{
                background: "linear-gradient(145deg, #0f2f25, #0f4c3a)",
                borderRadius: 18,
                padding: 20,
                color: "#fff",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 13,
                  background: "rgba(255,255,255,.12)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <BookOpenCheck size={20} color="#86efac" />
              </div>
              <div style={{ marginTop: 26, fontSize: 14, fontWeight: 850 }}>
                Текущий урок
              </div>
              <div
                style={{
                  marginTop: 7,
                  fontSize: 23,
                  fontWeight: 900,
                  letterSpacing: "-.04em",
                }}
              >
                Web Junior
              </div>
              <div
                style={{
                  marginTop: 12,
                  color: "#b7d9cc",
                  fontSize: 11,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Clock3 size={14} /> 14:30–16:00 • 9 учеников
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                border: `1px solid ${palette.line}`,
                borderRadius: 18,
                padding: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  fontSize: 13,
                  fontWeight: 850,
                }}
              >
                <Users size={17} color={palette.violet} /> Мои группы
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                {[
                  ["Python Start", 75, palette.blue],
                  ["Web Junior", 42, palette.violet],
                  ["Python Online", 64, palette.cyan],
                ].map(([label, value, color]) => (
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
                      delay={75}
                      height={6}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <Modal
          title={copy.teacher.dialogTitle}
          subtitle="Web Junior • 14 августа, 14:30 • 9 учеников"
          width={650}
        >
          <div style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Pill color={palette.green}>
                <UserCheck size={12} /> 4 отмечено
              </Pill>
              <div style={{ fontSize: 10, color: palette.muted }}>
                Автосохранение включено
              </div>
            </div>
            <div style={{ marginTop: 14, display: "grid", gap: 7 }}>
              {roster.map(([name, initials, present], index) => (
                <div
                  key={String(name)}
                  style={{
                    height: 45,
                    display: "grid",
                    gridTemplateColumns: "34px 1fr 88px 88px",
                    alignItems: "center",
                    gap: 9,
                    padding: "0 10px",
                    borderRadius: 11,
                    background: index % 2 ? "#fbfcfe" : palette.surface,
                  }}
                >
                  <Avatar
                    initials={String(initials)}
                    color={present ? palette.green : palette.rose}
                    size={28}
                  />
                  <div style={{ fontSize: 11, fontWeight: 800 }}>
                    {String(name)}
                  </div>
                  <div
                    style={{
                      height: 28,
                      borderRadius: 9,
                      background: present ? palette.green : "#fff",
                      color: present ? "#fff" : palette.muted,
                      border: `1px solid ${present ? palette.green : palette.line}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      fontSize: 9,
                      fontWeight: 800,
                    }}
                  >
                    {present ? <Check size={12} /> : null} Присутствует
                  </div>
                  <div
                    style={{
                      height: 28,
                      borderRadius: 9,
                      background: !present ? `${palette.rose}12` : "#fff",
                      color: !present ? palette.rose : palette.muted,
                      border: `1px solid ${!present ? `${palette.rose}48` : palette.line}`,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 9,
                      fontWeight: 800,
                    }}
                  >
                    Отсутствует
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 17,
                display: "flex",
                justifyContent: "flex-end",
                gap: 9,
              }}
            >
              <div
                style={{
                  height: 36,
                  padding: "0 14px",
                  border: `1px solid ${palette.line}`,
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 750,
                }}
              >
                Сохранить черновик
              </div>
              <div
                style={{
                  height: 36,
                  padding: "0 14px",
                  background: palette.green,
                  color: "#fff",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                <Check size={15} /> Завершить урок
              </div>
            </div>
          </div>
        </Modal>
      </AppWindow>
    </div>
  </Background>
);
