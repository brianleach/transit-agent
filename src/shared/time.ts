export type Timezone = 'US/Central' | 'US/Eastern' | 'Europe/London';

function getDstBoundaries(
  year: number,
  tz: Timezone,
): { dstStart: number; dstEnd: number } {
  if (tz === 'US/Central' || tz === 'US/Eastern') {
    // DST: 2nd Sunday of March 2:00 AM local → 1st Sunday of November 2:00 AM local
    const mar1 = new Date(Date.UTC(year, 2, 1));
    const firstSunMar = ((7 - mar1.getUTCDay()) % 7) + 1;
    const nov1 = new Date(Date.UTC(year, 10, 1));
    const firstSunNov = ((7 - nov1.getUTCDay()) % 7) + 1;
    if (tz === 'US/Central') {
      return {
        dstStart: Date.UTC(year, 2, firstSunMar + 7, 8), // 2 AM CST = 08:00 UTC
        dstEnd: Date.UTC(year, 10, firstSunNov, 7), // 2 AM CDT = 07:00 UTC
      };
    } else {
      return {
        dstStart: Date.UTC(year, 2, firstSunMar + 7, 7), // 2 AM EST = 07:00 UTC
        dstEnd: Date.UTC(year, 10, firstSunNov, 6), // 2 AM EDT = 06:00 UTC
      };
    }
  }
  // Europe/London: last Sunday of March 1:00 UTC → last Sunday of October 1:00 UTC
  const mar31 = new Date(Date.UTC(year, 2, 31));
  const lastSunMar = 31 - mar31.getUTCDay();
  const oct31 = new Date(Date.UTC(year, 9, 31));
  const lastSunOct = 31 - oct31.getUTCDay();
  return {
    dstStart: Date.UTC(year, 2, lastSunMar, 1),
    dstEnd: Date.UTC(year, 9, lastSunOct, 1),
  };
}

const BASE_OFFSETS: Record<Timezone, number> = {
  'US/Central': -6,
  'US/Eastern': -5,
  'Europe/London': 0,
};

export function localTzOffsetHours(tz: Timezone): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const { dstStart, dstEnd } = getDstBoundaries(year, tz);
  const ts = now.getTime();
  return ts >= dstStart && ts < dstEnd
    ? BASE_OFFSETS[tz] + 1
    : BASE_OFFSETS[tz];
}

export function toLocalDate(ts: number | Date, tz: Timezone): Date {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : ts;
  const offset = localTzOffsetHours(tz);
  return new Date(d.getTime() + offset * 3600000);
}

export function localNow(tz: Timezone): Date {
  return toLocalDate(new Date(), tz);
}

export function fmtTime(d: Date): string {
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  else if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm}`;
}

export function fmtTimeHM(d: Date): string {
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  else if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function fmtTime24(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtDateTimeShort(d: Date): string {
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  else if (h === 0) h = 12;
  return `${String(mo).padStart(2, '0')}/${String(day).padStart(2, '0')} ${h}:${String(m).padStart(2, '0')}${ampm}`;
}
