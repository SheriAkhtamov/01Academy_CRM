import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CircleDollarSign,
  ReceiptText,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { copy, nav, people } from "../content";
import {
  AppWindow,
  AreaChart,
  Background,
  Card,
  MetricCard,
  Pill,
  SceneHeading,
} from "../ui";
import { palette } from "../theme";

export const FinanceScene: React.FC = () => (
  <Background accent={palette.green}>
    <div style={{ position: "absolute", left: 120, top: 54 }}>
      <SceneHeading {...copy.finance} accent="#4ade80" />
    </div>
    <div style={{ position: "absolute", left: 120, top: 278 }}>
      <AppWindow
        sectionLabel="Финансы"
        title={copy.finance.screenTitle}
        navItems={nav.finance}
        activeItem="Обзор"
        accent={palette.green}
        delay={24}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.45fr repeat(3, 1fr)",
            gap: 13,
          }}
        >
          <div
            style={{
              borderRadius: 18,
              background: "linear-gradient(140deg, #0a3427, #0f5d43)",
              padding: 18,
              color: "#fff",
              boxShadow: "0 15px 32px rgba(12,84,61,.2)",
            }}
          >
            <div style={{ fontSize: 11, color: "#a7ddc9", fontWeight: 700 }}>
              Чистая прибыль
            </div>
            <div
              style={{
                fontSize: 31,
                fontWeight: 900,
                marginTop: 8,
                letterSpacing: "-.045em",
              }}
            >
              126,8 млн UZS
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
              <Pill color="#86efac">
                <TrendingUp size={11} /> +21,4%
              </Pill>
              <span
                style={{ fontSize: 9, color: "#a7ddc9", alignSelf: "center" }}
              >
                к прошлому месяцу
              </span>
            </div>
          </div>
          <MetricCard
            label="Выручка"
            value="482,4 млн"
            delta="+12,6%"
            color={palette.blue}
            delay={44}
            icon={ArrowDownToLine}
          />
          <MetricCard
            label="Все расходы"
            value="355,6 млн"
            delta="−3,2%"
            color={palette.rose}
            delay={50}
            icon={ArrowUpFromLine}
          />
          <MetricCard
            label="Маржа"
            value="26,3%"
            delta="+4,1%"
            color={palette.green}
            delay={56}
            icon={CircleDollarSign}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.7fr .8fr",
            gap: 13,
            marginTop: 13,
          }}
        >
          <Card
            title="Прибыль и денежный поток"
            subtitle="Помесячная динамика"
            style={{ height: 278 }}
          >
            <div style={{ padding: "10px 18px 0" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <Pill color={palette.green}>Прибыль</Pill>
                <Pill color={palette.blue}>Выручка</Pill>
                <Pill color={palette.rose}>Расходы</Pill>
              </div>
              <AreaChart color={palette.green} delay={62} height={176} />
            </div>
          </Card>
          <Card
            title="Структура расходов"
            subtitle="355,6 млн UZS"
            style={{ height: 278 }}
          >
            <div
              style={{
                padding: 15,
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  width: 126,
                  height: 126,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: `conic-gradient(${palette.violet} 0 44%, ${palette.rose} 44% 66%, ${palette.amber} 66% 82%, ${palette.blue} 82% 100%)`,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 23,
                    background: "#fff",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    color: palette.muted,
                    fontWeight: 800,
                  }}
                >
                  РАСХОДЫ
                </div>
              </div>
              <div style={{ display: "grid", gap: 11, flex: 1 }}>
                {[
                  ["Зарплаты", "44%", palette.violet],
                  ["Маркетинг", "22%", palette.rose],
                  ["Аренда", "16%", palette.amber],
                  ["Операционные", "18%", palette.blue],
                ].map(([label, value, color]) => (
                  <div
                    key={String(label)}
                    style={{
                      display: "flex",
                      gap: 7,
                      alignItems: "center",
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
        </div>
        <Card
          title="Последние транзакции"
          subtitle="Доходы, расходы и выплаты в одном реестре"
          style={{ height: 218, marginTop: 13 }}
        >
          <div style={{ padding: "0 17px" }}>
            {people.slice(0, 4).map((person, index) => (
              <div
                key={person.name}
                style={{
                  height: 39,
                  display: "grid",
                  gridTemplateColumns: "82px 1.3fr 1fr 120px 120px",
                  alignItems: "center",
                  borderBottom:
                    index < 3 ? `1px solid ${palette.line}` : "none",
                  fontSize: 10,
                }}
              >
                <span style={{ color: palette.muted }}>
                  14 авг • {10 + index}:2{index}
                </span>
                <strong>
                  {index === 2
                    ? "Рекламный бюджет Meta"
                    : `Оплата • ${person.course}`}
                </strong>
                <span style={{ color: palette.muted }}>
                  {index === 2 ? "Маркетинг" : person.name}
                </span>
                <Pill color={index === 2 ? palette.amber : palette.green}>
                  {index === 2 ? "Проведено" : "Оплачено"}
                </Pill>
                <span
                  style={{
                    textAlign: "right",
                    fontWeight: 850,
                    color: index === 2 ? palette.rose : palette.green,
                  }}
                >
                  {index === 2 ? "− 8 400 000" : `+ ${person.amount}`}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <div
          style={{
            position: "absolute",
            right: 38,
            bottom: 40,
            display: "flex",
            gap: 9,
          }}
        >
          <Pill color={palette.violet}>
            <WalletCards size={12} /> Зарплаты
          </Pill>
          <Pill color={palette.blue}>
            <ReceiptText size={12} /> Транзакции
          </Pill>
          <Pill color={palette.green}>
            <Banknote size={12} /> Доходы
          </Pill>
        </div>
      </AppWindow>
    </div>
  </Background>
);
