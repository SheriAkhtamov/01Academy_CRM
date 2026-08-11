export interface CalendarTimeRange {
  startMinutes: number;
  endMinutes: number;
}

export interface CalendarTimeSegment extends CalendarTimeRange {
  kind: 'time' | 'collapsed';
  offset: number;
  size: number;
}

export interface CalendarTimeMarker {
  minutes: number;
  offset: number;
}

export interface CalendarTimeScale {
  startMinutes: number;
  endMinutes: number;
  totalSize: number;
  segments: CalendarTimeSegment[];
  markers: CalendarTimeMarker[];
}

interface CalendarTimeScaleOptions {
  hourSize?: number;
  defaultStartMinutes?: number;
  defaultEndMinutes?: number;
  eventPaddingMinutes?: number;
  collapseThresholdMinutes?: number;
  collapsedGapSize?: number;
  emptyCalendarSize?: number;
}

const MINUTES_IN_DAY = 24 * 60;
const MINUTES_IN_HOUR = 60;

const clampMinute = (minutes: number) => (
  Math.min(MINUTES_IN_DAY, Math.max(0, minutes))
);

const roundMinuteDown = (minutes: number, step: number) => (
  Math.floor(minutes / step) * step
);

const roundMinuteUp = (minutes: number, step: number) => (
  Math.ceil(minutes / step) * step
);

export function getCalendarMinutePosition(
  scale: CalendarTimeScale,
  minutes: number,
) {
  const clampedMinutes = Math.min(scale.endMinutes, Math.max(scale.startMinutes, minutes));
  const segment = scale.segments.find((item) => clampedMinutes <= item.endMinutes)
    ?? scale.segments.at(-1);
  if (!segment || segment.endMinutes <= segment.startMinutes) return 0;

  const progress = (clampedMinutes - segment.startMinutes)
    / (segment.endMinutes - segment.startMinutes);
  return segment.offset + progress * segment.size;
}

export function isCalendarMinuteCollapsed(
  scale: CalendarTimeScale,
  minutes: number,
) {
  return scale.segments.some((segment) => (
    segment.kind === 'collapsed'
    && minutes > segment.startMinutes
    && minutes < segment.endMinutes
  ));
}

export function buildCalendarTimeScale(
  events: CalendarTimeRange[],
  {
    hourSize = 68,
    defaultStartMinutes = 9 * MINUTES_IN_HOUR,
    defaultEndMinutes = 21 * MINUTES_IN_HOUR,
    eventPaddingMinutes = 30,
    collapseThresholdMinutes = 2 * MINUTES_IN_HOUR,
    collapsedGapSize = 32,
    emptyCalendarSize = 260,
  }: CalendarTimeScaleOptions = {},
): CalendarTimeScale {
  const validEvents = events
    .map((event) => ({
      startMinutes: clampMinute(Number(event.startMinutes)),
      endMinutes: clampMinute(Number(event.endMinutes)),
    }))
    .filter((event) => (
      Number.isFinite(event.startMinutes)
      && Number.isFinite(event.endMinutes)
      && event.endMinutes > event.startMinutes
    ));

  if (validEvents.length === 0) {
    return {
      startMinutes: defaultStartMinutes,
      endMinutes: defaultEndMinutes,
      totalSize: emptyCalendarSize,
      segments: [{
        kind: 'collapsed',
        startMinutes: defaultStartMinutes,
        endMinutes: defaultEndMinutes,
        offset: 0,
        size: emptyCalendarSize,
      }],
      markers: [],
    };
  }

  const eventStart = validEvents.length > 0
    ? Math.min(...validEvents.map((event) => event.startMinutes))
    : defaultStartMinutes;
  const eventEnd = validEvents.length > 0
    ? Math.max(...validEvents.map((event) => event.endMinutes))
    : defaultEndMinutes;
  const startMinutes = clampMinute(roundMinuteDown(eventStart - eventPaddingMinutes, 30));
  const endMinutes = clampMinute(roundMinuteUp(eventEnd + eventPaddingMinutes, 30));

  const activeRanges = validEvents
    .map((event) => ({
      startMinutes: Math.max(
        startMinutes,
        roundMinuteDown(event.startMinutes - eventPaddingMinutes, 30),
      ),
      endMinutes: Math.min(
        endMinutes,
        roundMinuteUp(event.endMinutes + eventPaddingMinutes, 30),
      ),
    }))
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .reduce<CalendarTimeRange[]>((ranges, range) => {
      const previous = ranges.at(-1);
      if (!previous || range.startMinutes > previous.endMinutes) {
        ranges.push({ ...range });
      } else {
        previous.endMinutes = Math.max(previous.endMinutes, range.endMinutes);
      }
      return ranges;
    }, []);

  const rawSegments: Array<Pick<CalendarTimeSegment, 'kind' | 'startMinutes' | 'endMinutes'>> = [];
  let cursor = startMinutes;
  for (const range of activeRanges) {
    if (range.startMinutes > cursor) {
      rawSegments.push({
        kind: range.startMinutes - cursor >= collapseThresholdMinutes ? 'collapsed' : 'time',
        startMinutes: cursor,
        endMinutes: range.startMinutes,
      });
    }
    rawSegments.push({
      kind: 'time',
      startMinutes: range.startMinutes,
      endMinutes: range.endMinutes,
    });
    cursor = range.endMinutes;
  }
  if (cursor < endMinutes) {
    rawSegments.push({
      kind: endMinutes - cursor >= collapseThresholdMinutes ? 'collapsed' : 'time',
      startMinutes: cursor,
      endMinutes,
    });
  }

  let offset = 0;
  const segments = rawSegments.map<CalendarTimeSegment>((segment) => {
    const size = segment.kind === 'collapsed'
      ? collapsedGapSize
      : ((segment.endMinutes - segment.startMinutes) / MINUTES_IN_HOUR) * hourSize;
    const positionedSegment = { ...segment, offset, size };
    offset += size;
    return positionedSegment;
  });
  const scaleWithoutMarkers: CalendarTimeScale = {
    startMinutes,
    endMinutes,
    totalSize: offset,
    segments,
    markers: [],
  };
  const firstHour = roundMinuteUp(startMinutes, MINUTES_IN_HOUR);
  const markers = Array.from(
    { length: Math.max(0, Math.floor((endMinutes - firstHour) / MINUTES_IN_HOUR) + 1) },
    (_, index) => firstHour + index * MINUTES_IN_HOUR,
  )
    .filter((minutes) => !isCalendarMinuteCollapsed(scaleWithoutMarkers, minutes))
    .map((minutes) => ({
      minutes,
      offset: getCalendarMinutePosition(scaleWithoutMarkers, minutes),
    }));

  return { ...scaleWithoutMarkers, markers };
}
