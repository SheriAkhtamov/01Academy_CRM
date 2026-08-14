import {
  BookOpen,
  Building2,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  DoorOpen,
  MapPin,
  UserRoundPlus,
} from "lucide-react";
import { copy, nav } from "../content";
import {
  AppWindow,
  Avatar,
  Background,
  Modal,
  Pill,
  SceneHeading,
} from "../ui";
import { palette } from "../theme";

const days = ["ПН, 17", "ВТ, 18", "СР, 19", "ЧТ, 20", "ПТ, 21", "СБ, 22"];
const lessons = [
  {
    day: 0,
    top: 65,
    height: 92,
    title: "Python Start",
    meta: "CYP-PY-GRP-26-0018",
    color: palette.blue,
  },
  {
    day: 1,
    top: 185,
    height: 92,
    title: "Web Junior",
    meta: "CYP-WEB-GRP-26-0021",
    color: palette.violet,
  },
  {
    day: 2,
    top: 95,
    height: 120,
    title: "Robotics",
    meta: "CYP-RB-GRP-26-0024",
    color: palette.amber,
  },
  {
    day: 3,
    top: 240,
    height: 92,
    title: "Python Start",
    meta: "ONL-PY-GRP-26-0027",
    color: palette.cyan,
  },
  {
    day: 4,
    top: 135,
    height: 110,
    title: "Web Pro",
    meta: "CYP-WEB-GRP-26-0029",
    color: palette.green,
  },
  {
    day: 5,
    top: 75,
    height: 130,
    title: "Game Dev",
    meta: "CYP-GD-GRP-26-0030",
    color: palette.rose,
  },
];

export const AcademyScene: React.FC = () => (
  <Background accent={palette.amber}>
    <div style={{ position: "absolute", left: 120, top: 54 }}>
      <SceneHeading {...copy.academy} accent="#fbbf24" />
    </div>
    <div style={{ position: "absolute", left: 120, top: 278 }}>
      <AppWindow
        sectionLabel="Администрирование"
        title={copy.academy.screenTitle}
        navItems={nav.administration}
        activeItem="Структура академии"
        accent={palette.amber}
        delay={24}
      >
        <div
          style={{
            display: "flex",
            gap: 9,
            alignItems: "center",
            marginBottom: 13,
          }}
        >
          <Pill color={palette.blue}>
            <Building2 size={12} /> Cyberpark
          </Pill>
          <Pill muted>Все преподаватели</Pill>
          <Pill muted>Неделя</Pill>
          <div
            style={{
              marginLeft: "auto",
              height: 36,
              padding: "0 13px",
              borderRadius: 11,
              background: palette.blue,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            <CalendarPlus size={15} /> Новое занятие
          </div>
        </div>
        <div
          style={{
            height: 575,
            background: "#fff",
            border: `1px solid ${palette.line}`,
            borderRadius: 17,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              height: 46,
              marginLeft: 58,
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              borderBottom: `1px solid ${palette.line}`,
            }}
          >
            {days.map((day, index) => (
              <div
                key={day}
                style={{
                  display: "grid",
                  placeItems: "center",
                  borderLeft: index ? `1px solid ${palette.line}` : "none",
                  fontSize: 11,
                  fontWeight: 800,
                  color: index === 1 ? palette.blue : palette.text,
                }}
              >
                {day}
              </div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 46,
              width: 58,
              bottom: 0,
              background: "#fbfcfe",
              borderRight: `1px solid ${palette.line}`,
            }}
          >
            {[9, 11, 13, 15, 17, 19].map((hour, index) => (
              <div
                key={hour}
                style={{
                  position: "absolute",
                  top: index * 88 + 9,
                  right: 10,
                  fontSize: 9,
                  color: palette.muted,
                }}
              >
                {hour}:00
              </div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              left: 58,
              right: 0,
              top: 46,
              bottom: 0,
              backgroundImage: `linear-gradient(${palette.line} 1px, transparent 1px), linear-gradient(90deg, ${palette.line} 1px, transparent 1px)`,
              backgroundSize: "100% 88px, calc(100% / 6) 100%",
            }}
          />
          {lessons.map((lesson) => (
            <div
              key={lesson.meta}
              style={{
                position: "absolute",
                left: `calc(58px + (100% - 58px) / 6 * ${lesson.day} + 7px)`,
                width: "calc((100% - 58px) / 6 - 14px)",
                top: lesson.top + 46,
                height: lesson.height,
                borderRadius: 11,
                background: `${lesson.color}15`,
                border: `1px solid ${lesson.color}55`,
                borderLeft: `4px solid ${lesson.color}`,
                padding: 9,
                overflow: "hidden",
              }}
            >
              <div
                style={{ fontSize: 11, fontWeight: 850, color: palette.text }}
              >
                {lesson.title}
              </div>
              <div style={{ fontSize: 8, color: palette.muted, marginTop: 4 }}>
                {lesson.meta}
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: lesson.color,
                  fontWeight: 750,
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Clock3 size={11} /> 17:30 • 90 мин
              </div>
            </div>
          ))}
        </div>
        <Modal
          title={copy.academy.dialogTitle}
          subtitle="Новый ученик из воронки продаж"
          width={620}
        >
          <div style={{ padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar initials="АЮ" color={palette.violet} size={45} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 850 }}>
                  Амина Юсупова
                </div>
                <div
                  style={{ fontSize: 10, color: palette.muted, marginTop: 4 }}
                >
                  15 августа • 18:30 • Cyberpark
                </div>
              </div>
              <Pill color={palette.green}>
                <CheckCircle2 size={12} /> подтверждено
              </Pill>
            </div>
            <div
              style={{
                marginTop: 20,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {[
                [BookOpen, "Курс", "Python Start"],
                [UserRoundPlus, "Преподаватель", "Диана Хасанова"],
                [DoorOpen, "Кабинет", "Room 3 • 12 мест"],
                [MapPin, "Формат", "Офлайн • Cyberpark"],
              ].map(([Icon, label, value]) => (
                <div
                  key={String(label)}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: palette.surface,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      width: 31,
                      height: 31,
                      borderRadius: 10,
                      background: `${palette.amber}16`,
                      color: palette.amber,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: palette.muted }}>
                      {String(label)}
                    </div>
                    <div
                      style={{ fontSize: 11, fontWeight: 800, marginTop: 3 }}
                    >
                      {String(value)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 20,
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
                Отмена
              </div>
              <div
                style={{
                  height: 36,
                  padding: "0 14px",
                  background: palette.blue,
                  color: "#fff",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                <CheckCircle2 size={15} /> Подтвердить запись
              </div>
            </div>
          </div>
        </Modal>
      </AppWindow>
    </div>
  </Background>
);
