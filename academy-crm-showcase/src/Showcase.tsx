import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { interpolate, staticFile, useVideoConfig } from "remotion";
import { AcademyScene } from "./scenes/AcademyScene";
import { CommunicationScene } from "./scenes/CommunicationScene";
import { ExecutiveScene } from "./scenes/ExecutiveScene";
import { FinanceScene } from "./scenes/FinanceScene";
import { IntroScene } from "./scenes/IntroScene";
import { MarketingScene } from "./scenes/MarketingScene";
import { OutroScene } from "./scenes/OutroScene";
import { PlatformScene } from "./scenes/PlatformScene";
import { SalesScene } from "./scenes/SalesScene";
import { TasksScene } from "./scenes/TasksScene";
import { TeacherScene } from "./scenes/TeacherScene";

const transitionTiming = linearTiming({ durationInFrames: 18 });

export const AcademyCRMShowcase: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <>
      <Audio
        src={staticFile("soundtrack.mp3")}
        volume={(frame) =>
          interpolate(
            frame,
            [0, 45, durationInFrames - 80, durationInFrames - 1],
            [0, 0.42, 0.42, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
        }
      />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={240} name="Intro">
          <IntroScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence
          durationInFrames={270}
          name="Executive overview"
        >
          <ExecutiveScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={300} name="Sales pipeline">
          <SalesScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={270} name="Communications">
          <CommunicationScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence
          durationInFrames={300}
          name="Academy operations"
        >
          <AcademyScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence
          durationInFrames={270}
          name="Teacher workspace"
        >
          <TeacherScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={270} name="Marketing">
          <MarketingScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={300} name="Finance">
          <FinanceScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={270} name="Tasks">
          <TasksScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={270} name="Platform">
          <PlatformScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={transitionTiming}
        />
        <TransitionSeries.Sequence durationInFrames={240} name="Outro">
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </>
  );
};
