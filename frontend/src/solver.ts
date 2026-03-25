// Full client-side scheduler – no backend needed
//
// Stint structure:  בדרך לבסיס  →  בבסיס × N  →  יוצא הביתה
// Total stint length = 1 (arrival) + N (base) + 1 (departure) = N + 2
// The user-configured "min consecutive base days" = N (actual base days, not travel)

export interface Soldier {
  id: string;
  name: string;
  blockedDates: string[];
}

export interface ScheduleConfig {
  startDate: string;
  endDate: string;
  minSoldiersOnBase: number;
  maxConsecutiveHomeDays: number;
  minConsecutiveBaseDays: number; // actual "on base" days, NOT counting travel days
}

export type DayStatus = 'home' | 'arriving' | 'base' | 'departing' | 'blocked';

export interface ScheduleEntry {
  date: string;
  soldierId: string;
  status: DayStatus;
}

export interface SoldierStats {
  soldierId: string;
  name: string;
  totalBaseDays: number;   // arriving + base + departing
  totalHomeDays: number;
  totalBlockedDays: number;
}

export interface ScheduleResult {
  entries: ScheduleEntry[];
  stats: SoldierStats[];
}

export interface FixedEntry {
  soldierId: string;
  date: string;
  status: 'base' | 'home';
}

function dateRange(start: string, end: string): string[] {
  const days: string[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function buildSchedule(
  soldiers: Soldier[],
  config: ScheduleConfig,
  fixedEntries: FixedEntry[] = [],
): ScheduleResult {
  if (soldiers.length === 0) return { entries: [], stats: [] };

  const days = dateRange(config.startDate, config.endDate);
  const dCount = days.length;
  const n = soldiers.length;
  const B = config.minConsecutiveBaseDays; // actual base days (not travel)
  const stintLen = B + 2; // arrival + B base + departure
  const maxHome = config.maxConsecutiveHomeDays;
  const minOnBase = config.minSoldiersOnBase;

  const idToIdx = new Map<string, number>();
  soldiers.forEach((s, i) => idToIdx.set(s.id, i));

  const blockedSets: Set<string>[] = soldiers.map(s => new Set(s.blockedDates));

  // onDuty[i][d] = true means soldier i is "assigned" on day d (includes travel days)
  const onDuty: boolean[] [] = Array.from({ length: n }, () => Array(dCount).fill(false));
  const fixedCells = new Set<string>();

  // Apply fixed entries
  for (const fe of fixedEntries) {
    const i = idToIdx.get(fe.soldierId);
    if (i === undefined) continue;
    const dIdx = days.indexOf(fe.date);
    if (dIdx === -1) continue;
    onDuty[i][dIdx] = fe.status === 'base';
    fixedCells.add(`${i},${dIdx}`);
  }

  const totalDuty = new Array(n).fill(0);
  const dutyStreak = new Array(n).fill(0);  // consecutive duty days
  const homeStreak = new Array(n).fill(0);  // consecutive home days

  for (let d = 0; d < dCount; d++) {
    const mustDuty = new Set<number>();
    const mustHome = new Set<number>();
    const canChoose: number[] = [];

    for (let i = 0; i < n; i++) {
      if (fixedCells.has(`${i},${d}`)) {
        if (onDuty[i][d]) mustDuty.add(i); else mustHome.add(i);
        continue;
      }
      if (blockedSets[i].has(days[d])) { mustHome.add(i); continue; }

      // Must continue current stint (haven't completed stintLen yet)
      if (dutyStreak[i] > 0 && dutyStreak[i] < stintLen) {
        // Check if remaining days are available
        const remaining = stintLen - dutyStreak[i];
        let canContinue = true;
        for (let k = d; k < Math.min(d + remaining, dCount); k++) {
          if (blockedSets[i].has(days[k])) { canContinue = false; break; }
        }
        if (canContinue) { mustDuty.add(i); continue; }
        // If can't continue (blocked ahead), let them go home
        // This is a partial stint - unavoidable
      }

      // Too many home days in a row - force to base only if full stint possible
      if (homeStreak[i] >= maxHome && !blockedSets[i].has(days[d])) {
        if (d + stintLen <= dCount) {
          mustDuty.add(i);
          continue;
        }
      }

      canChoose.push(i);
    }

    const need = Math.max(0, minOnBase - mustDuty.size);

    // Sort: fewer total duty days first (fairness), then longer home streak
    canChoose.sort((a, b) => {
      if (totalDuty[a] !== totalDuty[b]) return totalDuty[a] - totalDuty[b];
      return homeStreak[b] - homeStreak[a];
    });

    const chosen = new Set<number>();
    for (const i of canChoose) {
      if (chosen.size >= need) break;
      // Only start a new stint if we can do the full stintLen days
      if (dutyStreak[i] === 0) {
        if (d + stintLen > dCount) continue; // not enough days left for full stint
        let canDoStint = true;
        for (let k = d; k < d + stintLen; k++) {
          if (blockedSets[i].has(days[k])) { canDoStint = false; break; }
        }
        if (!canDoStint) continue;
      }
      chosen.add(i);
    }

    // Fallback if still not enough - only soldiers who can do full stint
    if (mustDuty.size + chosen.size < minOnBase) {
      for (const i of canChoose) {
        if (chosen.has(i)) continue;
        if (mustDuty.size + chosen.size >= minOnBase) break;
        if (dutyStreak[i] === 0 && d + stintLen > dCount) continue;
        chosen.add(i);
      }
    }

    // Assign
    for (let i = 0; i < n; i++) {
      if (fixedCells.has(`${i},${d}`)) {
        // already set
      } else if (blockedSets[i].has(days[d])) {
        onDuty[i][d] = false;
      } else if (mustDuty.has(i) || chosen.has(i)) {
        onDuty[i][d] = true;
      } else {
        onDuty[i][d] = false;
      }

      if (onDuty[i][d]) {
        dutyStreak[i]++;
        homeStreak[i] = 0;
        totalDuty[i]++;
      } else {
        homeStreak[i]++;
        dutyStreak[i] = 0;
      }
    }
  }

  // Balancing pass - equalize total duty days
  if (n > 1) {
    for (let iter = 0; iter < dCount * 3; iter++) {
      let maxI = 0, minI = 0;
      for (let i = 1; i < n; i++) {
        if (totalDuty[i] > totalDuty[maxI]) maxI = i;
        if (totalDuty[i] < totalDuty[minI]) minI = i;
      }
      if (totalDuty[maxI] - totalDuty[minI] <= 1) break;

      // Try to swap an entire stint from maxI to minI
      let swapped = false;

      // Find stint boundaries for maxI
      let d = 0;
      while (d < dCount && !swapped) {
        if (!onDuty[maxI][d]) { d++; continue; }
        // Found start of a stint
        const stintStart = d;
        while (d < dCount && onDuty[maxI][d]) d++;
        const stintEnd = d; // exclusive
        const len = stintEnd - stintStart;

        // Check if minI is free for this entire range
        let canSwap = true;
        for (let k = stintStart; k < stintEnd; k++) {
          if (fixedCells.has(`${maxI},${k}`) || fixedCells.has(`${minI},${k}`)) { canSwap = false; break; }
          if (blockedSets[minI].has(days[k])) { canSwap = false; break; }
          if (onDuty[minI][k]) { canSwap = false; break; } // minI already on duty
        }
        if (!canSwap) continue;

        // Check home streak constraints for maxI after removing stint
        // Simulate: maxI off for this stint
        let maxHomeStreak = 0, h = 0;
        for (let k = 0; k < dCount; k++) {
          const isOn = (k >= stintStart && k < stintEnd) ? false : onDuty[maxI][k];
          if (!isOn && !blockedSets[maxI].has(days[k])) { h++; maxHomeStreak = Math.max(maxHomeStreak, h); }
          else h = 0;
        }
        if (maxHomeStreak > maxHome) continue;

        // Check minI doesn't violate constraints after adding stint
        // Check that the stint for minI doesn't merge with adjacent stints creating too-long duty
        const prevOn = stintStart > 0 && onDuty[minI][stintStart - 1];
        const nextOn = stintEnd < dCount && onDuty[minI][stintEnd];
        if (prevOn || nextOn) continue; // would merge stints

        // Do the swap
        for (let k = stintStart; k < stintEnd; k++) {
          onDuty[maxI][k] = false;
          onDuty[minI][k] = true;
        }
        totalDuty[maxI] -= len;
        totalDuty[minI] += len;
        swapped = true;
      }
      if (!swapped) break;
    }
  }

  // Build entries with proper status labels
  const entries: ScheduleEntry[] = [];
  const stats: SoldierStats[] = [];

  for (let i = 0; i < n; i++) {
    let dutyDays = 0, homeDays = 0, blockedDays = 0;

    for (let d = 0; d < dCount; d++) {
      const isBlocked = blockedSets[i].has(days[d]);
      const isOn = onDuty[i][d];

      let status: DayStatus;

      if (isBlocked) {
        status = 'blocked';
        blockedDays++;
      } else if (isOn) {
        const prevOn = d > 0 ? onDuty[i][d - 1] : false;
        const nextOn = d + 1 < dCount ? onDuty[i][d + 1] : false;

        if (!prevOn && nextOn) {
          status = 'arriving'; // first day of stint = traveling to base
        } else if (prevOn && !nextOn) {
          status = 'departing'; // last day of stint = traveling home
        } else if (!prevOn && !nextOn) {
          status = 'base'; // single day stint (edge case)
        } else {
          status = 'base'; // middle days = on base
        }
        dutyDays++;
      } else {
        status = 'home';
        homeDays++;
      }

      entries.push({ date: days[d], soldierId: soldiers[i].id, status });
    }

    stats.push({
      soldierId: soldiers[i].id,
      name: soldiers[i].name,
      totalBaseDays: dutyDays,
      totalHomeDays: homeDays,
      totalBlockedDays: blockedDays,
    });
  }

  return { entries, stats };
}
