export interface CalendarLaneRange {
  startMinutes: number;
  endMinutes: number;
}

export type CalendarLaneItem<Item> = Item & {
  lane: number;
  laneCount: number;
};

/**
 * Splits overlapping events into side-by-side lanes so nothing is painted on
 * top of anything else. Events are clustered first, so a single long lesson
 * does not squeeze the whole day into narrow columns — only the times that
 * genuinely collide share their width.
 */
export function assignCalendarLanes<Item extends CalendarLaneRange>(
  events: Item[],
): Array<CalendarLaneItem<Item>> {
  const sorted = [...events].sort((left, right) => (
    left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes
  ));
  const positioned: Array<CalendarLaneItem<Item>> = [];

  for (let index = 0; index < sorted.length;) {
    const cluster: Item[] = [sorted[index]];
    let clusterEnd = sorted[index].endMinutes;
    let cursor = index + 1;

    while (cursor < sorted.length && sorted[cursor].startMinutes < clusterEnd) {
      cluster.push(sorted[cursor]);
      clusterEnd = Math.max(clusterEnd, sorted[cursor].endMinutes);
      cursor += 1;
    }

    const laneEnds: number[] = [];
    const clusterPositioned = cluster.map((event) => {
      let lane = laneEnds.findIndex((endMinutes) => endMinutes <= event.startMinutes);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = event.endMinutes;
      return { event, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);

    positioned.push(...clusterPositioned.map(({ event, lane }) => ({
      ...event,
      lane,
      laneCount,
    })));
    index = cursor;
  }

  return positioned;
}
