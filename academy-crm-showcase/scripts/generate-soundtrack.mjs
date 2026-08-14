import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 44100;
const durationSeconds = 94;
const channels = 2;
const beatSeconds = 60 / 112;
const barSeconds = beatSeconds * 4;
const chordSeconds = barSeconds * 2;
const chordMidi = [
  [45, 48, 52, 57],
  [41, 45, 48, 53],
  [48, 52, 55, 59],
  [43, 47, 50, 55],
];
const melodyOffsets = [12, 19, 15, 19, 12, 22, 19, 15];
const totalSamples = Math.round(sampleRate * durationSeconds);
const pcm = Buffer.allocUnsafe(totalSamples * channels * 2);

const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (value) => Math.max(-1, Math.min(1, value));
const smoothstep = (value) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};
const hashNoise = (sample) => {
  const value = Math.sin((sample + 1) * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

for (let sample = 0; sample < totalSamples; sample += 1) {
  const time = sample / sampleRate;
  const chordIndex = Math.floor(time / chordSeconds) % chordMidi.length;
  const chord = chordMidi[chordIndex];
  const chordPosition = time % chordSeconds;
  const chordEdge = Math.min(
    1,
    chordPosition / 0.22,
    (chordSeconds - chordPosition) / 0.22,
  );
  const beatPosition = time % beatSeconds;
  const beatIndex = Math.floor(time / beatSeconds);
  const beatPulse = Math.exp(-beatPosition * 9);
  const sidechain = 0.66 + 0.34 * smoothstep(Math.min(1, beatPosition / 0.18));

  let padLeft = 0;
  let padRight = 0;
  for (let voice = 0; voice < chord.length; voice += 1) {
    const hz = frequency(chord[voice]);
    const phase = Math.PI * 2 * hz * time;
    const voiceGain = voice === 0 ? 0.8 : 0.52;
    padLeft += Math.sin(phase + voice * 0.13) * voiceGain;
    padRight += Math.sin(phase + voice * 0.21 + 0.18) * voiceGain;
  }
  padLeft *= 0.055 * chordEdge * sidechain;
  padRight *= 0.055 * chordEdge * sidechain;

  const stepSeconds = beatSeconds / 2;
  const stepPosition = time % stepSeconds;
  const stepIndex = Math.floor(time / stepSeconds) % melodyOffsets.length;
  const melodyMidi = chord[0] + melodyOffsets[stepIndex];
  const melodyHz = frequency(melodyMidi);
  const melodyPhase = Math.PI * 2 * melodyHz * stepPosition;
  const melodyEnvelope = Math.exp(-stepPosition * 8.5);
  const melody =
    (Math.sin(melodyPhase) + 0.3 * Math.sin(melodyPhase * 2)) *
    melodyEnvelope *
    0.105;
  const melodyPan = stepIndex % 2 === 0 ? 0.72 : 0.28;

  const bassHz = frequency(chord[0] - 12);
  const bassPhase = Math.PI * 2 * bassHz * beatPosition;
  const bass = Math.sin(bassPhase) * Math.exp(-beatPosition * 3.1) * 0.105;

  const kickPhase =
    Math.PI * 2 * (48 + 84 * Math.exp(-beatPosition * 24)) * beatPosition;
  const kick = Math.sin(kickPhase) * Math.exp(-beatPosition * 18) * 0.34;

  const barBeat = beatIndex % 4;
  const snareEnvelope =
    barBeat === 1 || barBeat === 3 ? Math.exp(-beatPosition * 24) : 0;
  const noise = hashNoise(sample);
  const snare = noise * snareEnvelope * 0.075;

  const halfBeatPosition = time % (beatSeconds / 2);
  const hatGate = beatIndex % 2 === 0 ? 0.7 : 1;
  const hat = noise * Math.exp(-halfBeatPosition * 58) * 0.025 * hatGate;

  const shimmerEnvelope = Math.exp(-stepPosition * 13);
  const shimmer =
    Math.sin(Math.PI * 2 * melodyHz * 2 * stepPosition) *
    shimmerEnvelope *
    0.017;

  const introFade = smoothstep(time / 2.8);
  const outroFade = smoothstep((durationSeconds - time) / 5.5);
  const master = Math.min(introFade, outroFade);
  const left =
    Math.tanh(
      (padLeft +
        melody * melodyPan +
        bass +
        kick +
        snare +
        hat +
        shimmer * 0.35) *
        1.42,
    ) * master;
  const right =
    Math.tanh(
      (padRight +
        melody * (1 - melodyPan) +
        bass +
        kick +
        snare +
        hat * 0.88 +
        shimmer) *
        1.42,
    ) * master;
  pcm.writeInt16LE(Math.round(clamp(left) * 32767), sample * 4);
  pcm.writeInt16LE(Math.round(clamp(right) * 32767), sample * 4 + 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * channels * 2, 28);
header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

const tempDirectory = mkdtempSync(join(tmpdir(), "academy-crm-soundtrack-"));
const wavPath = join(tempDirectory, "soundtrack.wav");
const outputDirectory = new URL("../public/", import.meta.url);
const outputPath = new URL("soundtrack.mp3", outputDirectory);
const outputDirectoryPath = fileURLToPath(outputDirectory);
const outputFilePath = fileURLToPath(outputPath);
mkdirSync(outputDirectoryPath, { recursive: true });
writeFileSync(wavPath, Buffer.concat([header, pcm]));

const result = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    wavPath,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputFilePath,
  ],
  { stdio: "inherit" },
);
rmSync(tempDirectory, { recursive: true, force: true });
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(
  `Generated original ${durationSeconds}s soundtrack at ${outputFilePath}`,
);
