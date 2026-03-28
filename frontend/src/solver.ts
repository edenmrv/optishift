// Full client-side scheduler – no backend needed
//
// Stint structure:  בדרך לבסיס  →  בבסיס × N  →  יוצא הביתה
// Total stint length = 1 (arrival) + N (base) + 1 (departure) = N + 2
//
// Algorithm:
// 1. Compute how many stints each soldier needs (based on maxHome)
// 2. Calculate ideal stint positions with stagger for even daily coverage
// 3. Place stints greedily near ideal positions
// 4. Ensure minOnBase, fix maxHome violations
// 5. Balance duty across soldiers

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
  minConsecutiveBaseDays: number;
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
  totalBaseDays: number;
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
  const B = config.minConsecutiveBaseDays;
  const stintLen = B + 2;
  const maxHome = config.maxConsecutiveHomeDays;
  const minOnBase = config.minSoldiersOnBase;
  const lastStart = dCount - stintLen;

  if (lastStart < 0) return { entries: [], stats: [] };

  const idToIdx = new Map<string, number>();
  soldiers.forEach((s, i) => idToIdx.set(s.id, i));
  const blockedSets: Set<string>[] = soldiers.map(s => new Set(s.blockedDates));

  const onDuty: boolean[][] = Array.from({ length: n }, () => Array(dCount).fill(false));
  const totalDuty = new Array(n).fill(0);
  const fixedCells = new Set<string>();

  for (const fe of fixedEntries) {
    const i = idToIdx.get(fe.soldierId);
    if (i === undefined) continue;
    const dIdx = days.indexOf(fe.date);
    if (dIdx === -1) continue;
    onDuty[i][dIdx] = fe.status === 'base';
    fixedCells.add(`${i},${dIdx}`);
    if (fe.status === 'base') totalDuty[i]++;
  }

  // ── Helpers ──────────────────────────────────────────────

  function canDoStint(i: number, d: number): boolean {
    if (d < 0 || d + stintLen > dCount) return false;
    if (d > 0 && onDuty[i][d - 1]) return false;
    for (let k = d; k < d + stintLen; k++) {
      if (blockedSets[i].has(days[k]) || onDuty[i][k] || fixedCells.has(`${i},${k}`)) return false;
    }
    if (d + stintLen < dCount && onDuty[i][d + stintLen]) return false;
    return true;
  }

  function placeStint(i: number, d: number) {
    for (let k = d; k < d + stintLen; k++) {
      onDuty[i][k] = true;
    }
    totalDuty[i] += stintLen;
  }

  function getCoverage(): number[] {
    const c = new Array(dCount).fill(0);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dCount; d++) {
        if (onDuty[i][d]) c[d]++;
      }
    }
    return c;
  }

  function getMaxHomeStreak(i: number): number {
    let max = 0, cur = 0;
    for (let d = 0; d < dCount; d++) {
      if (!onDuty[i][d] && !blockedSets[i].has(days[d])) {
        cur++;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    return max;
  }

  function findNearestValid(soldier: number, idealStart: number): number {
    for (let offset = 0; offset <= lastStart; offset++) {
      if (canDoStint(soldier, idealStart + offset)) return idealStart + offset;
      if (canDoStint(soldier, idealStart - offset)) return idealStart - offset;
    }
    return -1;
  }

  // ── Phase 1: Compute ideal positions & place stints ─────
  // Each soldier needs K stints to satisfy maxHome constraint
  const K = Math.max(1, Math.ceil(dCount / (stintLen + maxHome)));

  // Compute ideal base positions for K stints (even home gaps)
  // Pattern: H0 | stint0 | H1 | stint1 | ... | HK
  // Ideal: all home gaps equal → evenGap = (dCount - K * stintLen) / (K + 1)
  const totalHomeDays = Math.max(0, dCount - K * stintLen);
  const evenGap = totalHomeDays / (K + 1);

  // Ideal start for stint j (without any soldier stagger)
  const idealBase: number[] = [];
  for (let j = 0; j < K; j++) {
    idealBase.push(Math.round(evenGap * (j + 1) + j * stintLen));
  }

  // Each soldier shifts ALL stints by the same offset
  // Offset range: [minOffset, maxOffset]
  // Constraints:
  //   p[0] = idealBase[0] + offset ≥ 0  →  offset ≥ -idealBase[0]
  //   p[0] ≤ maxHome                     →  offset ≤ maxHome - idealBase[0]
  //   p[K-1] + stintLen ≤ dCount         →  offset ≤ lastStart - idealBase[K-1]
  //   dCount - (p[K-1] + stintLen) ≤ maxHome → offset ≥ lastStart - maxHome - idealBase[K-1]
  const minOffset = Math.max(
    -idealBase[0],
    K > 0 ? (lastStart - maxHome - idealBase[K - 1]) : 0
  );
  const maxOffset = Math.min(
    maxHome - idealBase[0],
    lastStart - idealBase[K - 1]
  );
  const offsetRange = maxOffset - minOffset;

  // Compute per-soldier offsets spread across [minOffset, maxOffset]
  // Ensure first minOnBase soldiers get minOffset (cover day 0)
  // and last minOnBase soldiers get maxOffset (cover last day)
  const idealStarts: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    let offset: number;
    if (n <= 1) {
      offset = Math.round((minOffset + maxOffset) / 2);
    } else if (i < minOnBase) {
      // Edge: cover day 0
      offset = minOffset;
    } else if (i >= n - minOnBase) {
      // Edge: cover last day
      offset = maxOffset;
    } else {
      // Spread evenly in the middle
      const middleCount = n - 2 * minOnBase;
      const mIdx = i - minOnBase;
      offset = Math.round(minOffset + (mIdx + 1) * offsetRange / (middleCount + 1));
    }

    for (let j = 0; j < K; j++) {
      const pos = Math.max(0, Math.min(lastStart, idealBase[j] + offset));
      idealStarts[i].push(pos);
    }
  }

  // Place stints: process by stint index, earlier positions first
  for (let j = 0; j < K; j++) {
    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((a, b) => idealStarts[a][j] - idealStarts[b][j]);

    for (const i of order) {
      const ideal = idealStarts[i][j];
      const start = findNearestValid(i, ideal);
      if (start >= 0) {
        placeStint(i, start);
      }
    }
  }

  // ── Phase 2: Ensure minOnBase every day ─────────────────
  for (let iter = 0; iter < dCount * n; iter++) {
    const cov = getCoverage();
    let worstDay = -1;
    let worstCov = Infinity;
    for (let d = 0; d < dCount; d++) {
      if (cov[d] < worstCov) { worstCov = cov[d]; worstDay = d; }
    }
    if (worstCov >= minOnBase) break;

    let bestSoldier = -1;
    let bestStart = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < n; i++) {
      for (let s = Math.max(0, worstDay - stintLen + 1); s <= Math.min(worstDay, lastStart); s++) {
        if (!canDoStint(i, s)) continue;
        let score = -totalDuty[i] * 1000;
        for (let k = s; k < s + stintLen; k++) score -= cov[k];
        if (score > bestScore) { bestScore = score; bestSoldier = i; bestStart = s; }
      }
    }

    if (bestSoldier >= 0) {
      placeStint(bestSoldier, bestStart);
    } else {
      break;
    }
  }

  // ── Phase 3: Fix maxHome violations ─────────────────────
  for (let iter = 0; iter < n * 5; iter++) {
    let anyFixed = false;
    for (let i = 0; i < n; i++) {
      if (getMaxHomeStreak(i) <= maxHome) continue;
      let homeCount = 0;
      for (let d = 0; d < dCount; d++) {
        if (!onDuty[i][d] && !blockedSets[i].has(days[d])) {
          homeCount++;
          if (homeCount > maxHome) {
            const homeStart = d - homeCount + 1;
            const mid = homeStart + Math.floor(homeCount / 2);
            let placed = false;
            for (let offset = 0; offset <= homeCount && !placed; offset++) {
              for (const dir of [0, -1, 1]) {
                const s = mid + offset * dir;
                if (canDoStint(i, s)) {
                  placeStint(i, s);
                  placed = true;
                  anyFixed = true;
                  break;
                }
              }
            }
            if (placed) break;
          }
        } else {
          homeCount = 0;
        }
      }
    }
    if (!anyFixed) break;
  }

  // ── Phase 4: Balance by swapping stints ─────────────────
  for (let iter = 0; iter < dCount * 5; iter++) {
    let maxI = 0, minI = 0;
    for (let i = 1; i < n; i++) {
      if (totalDuty[i] > totalDuty[maxI]) maxI = i;
      if (totalDuty[i] < totalDuty[minI]) minI = i;
    }
    if (maxI === minI || totalDuty[maxI] - totalDuty[minI] <= 1) break;

    let swapped = false;
    let d = 0;
    while (d < dCount && !swapped) {
      if (!onDuty[maxI][d]) { d++; continue; }
      const ss = d;
      while (d < dCount && onDuty[maxI][d]) d++;
      const se = d;
      const len = se - ss;

      let canSwap = true;
      for (let k = ss; k < se; k++) {
        if (fixedCells.has(`${maxI},${k}`) || fixedCells.has(`${minI},${k}`)) { canSwap = false; break; }
        if (blockedSets[minI].has(days[k]) || onDuty[minI][k]) { canSwap = false; break; }
      }
      if (!canSwap) continue;
      if (ss > 0 && onDuty[minI][ss - 1]) continue;
      if (se < dCount && onDuty[minI][se]) continue;

      // Check maxHome for both after swap
      let ok = true;
      // maxI loses stint
      let mh = 0, h = 0;
      for (let k = 0; k < dCount; k++) {
        const isOn = (k >= ss && k < se) ? false : onDuty[maxI][k];
        if (!isOn && !blockedSets[maxI].has(days[k])) { h++; if (h > mh) mh = h; } else h = 0;
      }
      if (mh > maxHome) ok = false;
      // minI gains stint
      if (ok) {
        mh = 0; h = 0;
        for (let k = 0; k < dCount; k++) {
          const isOn = (k >= ss && k < se) ? true : onDuty[minI][k];
          if (!isOn && !blockedSets[minI].has(days[k])) { h++; if (h > mh) mh = h; } else h = 0;
        }
        if (mh > maxHome) ok = false;
      }
      if (!ok) continue;

      for (let k = ss; k < se; k++) {
        onDuty[maxI][k] = false;
        onDuty[minI][k] = true;
      }
      totalDuty[maxI] -= len;
      totalDuty[minI] += len;
      swapped = true;
    }
    if (!swapped) break;
  }

  // ── Phase 5: Remove+replace for deeper balance ──────────
  for (let iter = 0; iter < n * 10; iter++) {
    let maxI = 0, minI = 0;
    for (let i = 1; i < n; i++) {
      if (totalDuty[i] > totalDuty[maxI]) maxI = i;
      if (totalDuty[i] < totalDuty[minI]) minI = i;
    }
    if (maxI === minI || totalDuty[maxI] - totalDuty[minI] <= stintLen) break;

    let improved = false;
    let d = 0;
    while (d < dCount && !improved) {
      if (!onDuty[maxI][d]) { d++; continue; }
      const ss = d;
      while (d < dCount && onDuty[maxI][d]) d++;
      const se = d;
      const len = se - ss;

      let canRemove = true;
      for (let k = ss; k < se; k++) {
        if (fixedCells.has(`${maxI},${k}`)) { canRemove = false; break; }
      }
      if (!canRemove) continue;

      // Simulate removal
      for (let k = ss; k < se; k++) onDuty[maxI][k] = false;
      totalDuty[maxI] -= len;

      if (getMaxHomeStreak(maxI) > maxHome) {
        // Restore
        for (let k = ss; k < se; k++) onDuty[maxI][k] = true;
        totalDuty[maxI] += len;
        continue;
      }

      // Check minOnBase still met
      const cov = getCoverage();
      let covOk = true;
      for (let k = ss; k < se; k++) {
        if (cov[k] < minOnBase) { covOk = false; break; }
      }

      if (covOk) {
        // Try placing a stint for minI somewhere
        let bestS = -1;
        let bestCovScore = Infinity;
        for (let s = 0; s <= lastStart; s++) {
          if (!canDoStint(minI, s)) continue;
          let score = 0;
          for (let k = s; k < s + stintLen; k++) score += cov[k];
          if (score < bestCovScore) { bestCovScore = score; bestS = s; }
        }
        if (bestS >= 0) {
          placeStint(minI, bestS);
          improved = true;
        }
      }

      if (!improved) {
        // Restore maxI's stint
        for (let k = ss; k < se; k++) onDuty[maxI][k] = true;
        totalDuty[maxI] += len;
      }
    }
    if (!improved) break;
  }

  // ── Build entries with status labels ────────────────────
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
        if (!prevOn && nextOn) status = 'arriving';
        else if (prevOn && !nextOn) status = 'departing';
        else if (!prevOn && !nextOn) status = 'base';
        else status = 'base';
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
