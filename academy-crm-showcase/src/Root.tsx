import "./index.css";
import { Composition, Folder } from "remotion";
import { AcademyCRMShowcase } from "./Showcase";
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

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Showcase-scenes">
        <Composition
          id="Intro"
          component={IntroScene}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Executive"
          component={ExecutiveScene}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Sales"
          component={SalesScene}
          durationInFrames={300}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Communications"
          component={CommunicationScene}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Academy"
          component={AcademyScene}
          durationInFrames={300}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Teacher"
          component={TeacherScene}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Marketing"
          component={MarketingScene}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Finance"
          component={FinanceScene}
          durationInFrames={300}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Tasks"
          component={TasksScene}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Platform"
          component={PlatformScene}
          durationInFrames={270}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="Outro"
          component={OutroScene}
          durationInFrames={240}
          fps={30}
          width={1920}
          height={1080}
        />
      </Folder>
      <Composition
        id="AcademyCRMShowcase"
        component={AcademyCRMShowcase}
        durationInFrames={2820}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
