import {
  CalendarDays,
  CheckCircle2,
  FileText,
  MessageCircle,
  Paperclip,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { copy, nav } from "../content";
import {
  AppWindow,
  Avatar,
  Background,
  CheckLine,
  Pill,
  ProgressBar,
  SceneHeading,
  enter,
} from "../ui";
import { palette } from "../theme";

const taskColumns = [
  {
    title: "Бэклог",
    color: palette.muted,
    tasks: [
      ["Обновить презентацию курса", "Маркетинг", "ЛА"],
      ["Проверить оплаты августа", "Финансы", "АК"],
    ],
  },
  {
    title: "К выполнению",
    color: palette.blue,
    tasks: [
      ["Запустить новую группу", "Академия", "ША"],
      ["Позвонить лидам после демо", "Продажи", "МТ"],
    ],
  },
  {
    title: "В работе",
    color: palette.amber,
    tasks: [
      ["Интеграция Meta CAPI", "Маркетинг", "ТК"],
      ["Расписание преподавателей", "Академия", "ДХ"],
    ],
  },
  {
    title: "Готово",
    color: palette.green,
    tasks: [
      ["Отчёт по ROMI", "Маркетинг", "ЛА"],
      ["Начислить зарплаты", "Финансы", "АК"],
    ],
  },
];

export const TasksScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Background accent={palette.violet}>
      <div style={{ position: "absolute", left: 120, top: 54 }}>
        <SceneHeading {...copy.tasks} accent="#a78bfa" />
      </div>
      <div style={{ position: "absolute", left: 120, top: 278 }}>
        <AppWindow
          sectionLabel="Команда"
          title={copy.tasks.screenTitle}
          navItems={nav.tasks}
          activeItem="Доска задач"
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
                <Sparkles size={11} /> Все отделы
              </Pill>
              <Pill muted>Мои задачи</Pill>
              <Pill muted>Эта неделя</Pill>
            </div>
            <div
              style={{
                height: 37,
                padding: "0 14px",
                borderRadius: 11,
                background: palette.violet,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              <Plus size={15} /> Создать задачу
            </div>
          </div>
          <div
            style={{
              height: 582,
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
            }}
          >
            {taskColumns.map((column, columnIndex) => (
              <div
                key={column.title}
                style={{ background: "#eef2f7", borderRadius: 16, padding: 12 }}
              >
                <div
                  style={{
                    height: 34,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 2px",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: column.color,
                    }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 850, flex: 1 }}>
                    {column.title}
                  </span>
                  <Pill muted>{column.tasks.length}</Pill>
                </div>
                <div style={{ display: "grid", gap: 10, marginTop: 7 }}>
                  {column.tasks.map(([title, department, initials], index) => (
                    <div
                      key={title}
                      style={{
                        padding: 13,
                        background: "#fff",
                        borderRadius: 14,
                        border: `1px solid ${palette.line}`,
                        boxShadow: "0 7px 18px rgba(15,23,42,.05)",
                        opacity: enter(frame, 49 + columnIndex * 7 + index * 5),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            fontSize: 12,
                            lineHeight: 1.35,
                            fontWeight: 850,
                          }}
                        >
                          {title}
                        </div>
                        <Avatar
                          initials={initials}
                          color={column.color}
                          size={28}
                        />
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <Pill color={column.color}>{department}</Pill>
                      </div>
                      <div
                        style={{
                          marginTop: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          color: palette.muted,
                        }}
                      >
                        <CalendarDays size={13} />
                        <span style={{ fontSize: 9 }}>до 18 авг</span>
                        <MessageCircle size={13} />
                        <span style={{ fontSize: 9 }}>3</span>
                        <Paperclip size={13} />
                      </div>
                      {columnIndex === 2 && index === 0 ? (
                        <div style={{ marginTop: 11 }}>
                          <ProgressBar
                            value={68}
                            color={column.color}
                            delay={90}
                            height={6}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              right: 16,
              top: 16,
              width: 420,
              height: 616,
              background: "#fff",
              borderRadius: 18,
              border: `1px solid ${palette.line}`,
              boxShadow: "-24px 28px 64px rgba(15,23,42,.2)",
              opacity: enter(frame, 128),
              translate: `${interpolate(frame, [128, 158], [65, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px 0`,
              overflow: "hidden",
            }}
          >
            <div
              style={{ padding: 19, borderBottom: `1px solid ${palette.line}` }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 17,
                    lineHeight: 1.25,
                    fontWeight: 900,
                    letterSpacing: "-.025em",
                  }}
                >
                  {copy.tasks.sheetTitle}
                </div>
                <Pill color={palette.amber}>Высокий</Pill>
              </div>
              <div style={{ fontSize: 10, color: palette.muted, marginTop: 7 }}>
                Академия • до 18 августа
              </div>
            </div>
            <div style={{ padding: 19 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 9,
                }}
              >
                {[
                  [UserRound, "Ответственный", "Шери"],
                  [CalendarDays, "Срок", "18 августа"],
                  [MessageCircle, "Комментарии", "6 сообщений"],
                  [Paperclip, "Вложения", "3 файла"],
                ].map(([Icon, label, value]) => (
                  <div
                    key={String(label)}
                    style={{
                      padding: 11,
                      borderRadius: 11,
                      background: palette.surface,
                      display: "flex",
                      gap: 9,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: 29,
                        height: 29,
                        borderRadius: 9,
                        background: `${palette.violet}12`,
                        color: palette.violet,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <Icon size={14} />
                    </div>
                    <div>
                      <div style={{ fontSize: 8, color: palette.muted }}>
                        {String(label)}
                      </div>
                      <div
                        style={{ fontSize: 10, fontWeight: 800, marginTop: 3 }}
                      >
                        {String(value)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 850 }}>Чек-лист</div>
                <Pill color={palette.green}>3 / 5</Pill>
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <CheckLine label="Подтвердить преподавателя" />
                <CheckLine label="Забронировать кабинет" />
                <CheckLine label="Собрать учеников из CRM" />
                <CheckLine label="Отправить напоминания" checked={false} />
                <CheckLine label="Создать чат группы" checked={false} />
              </div>
              <div
                style={{
                  marginTop: 18,
                  borderTop: `1px solid ${palette.line}`,
                  paddingTop: 15,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 850,
                    display: "flex",
                    gap: 7,
                    alignItems: "center",
                  }}
                >
                  <FileText size={15} color={palette.violet} /> Последний
                  комментарий
                </div>
                <div
                  style={{
                    marginTop: 10,
                    padding: 11,
                    borderRadius: 11,
                    background: `${palette.violet}0c`,
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: palette.text,
                  }}
                >
                  Группа почти укомплектована. Осталось подтвердить двух
                  учеников.
                </div>
              </div>
              <div
                style={{
                  marginTop: 17,
                  height: 36,
                  borderRadius: 10,
                  background: palette.green,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  fontSize: 11,
                  fontWeight: 850,
                }}
              >
                <CheckCircle2 size={15} /> Перевести в «Готово»
              </div>
            </div>
          </div>
        </AppWindow>
      </div>
    </Background>
  );
};
