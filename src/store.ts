import { useSyncExternalStore } from 'react';

export interface SpinnerConfig {
  title: string;
  spinnerDurationSec: number;
  spinnerCruisePct: number;
  spinnerSlowDown: number;
}

export interface Guest {
  id: string;
  fullName: string;
  employeeId: string;
  division: string;
  groups: string[];
  wonPrizeAt: string;
  createdAt: string;
}

export const LIMITS = {
  MAX_FULL_NAME: 120,
  MAX_EMPLOYEE_ID: 64,
  MAX_DIVISION: 120,
  MAX_GROUP_NAME: 48,
  MAX_GROUPS_PER_GUEST: 20,
} as const;

export const DEFAULT_CONFIG: SpinnerConfig = {
  title: 'JMEG Events',
  spinnerDurationSec: 6,
  spinnerCruisePct: 15,
  spinnerSlowDown: 4.5,
};

const GUESTS_KEY = 'jmeg_spinner_guests_v1';
const CONFIG_KEY = 'jmeg_spinner_config_v1';

export function normalizeGroupList(rawItems: unknown[]): string[] {
  if (!Array.isArray(rawItems)) return [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, LIMITS.MAX_GROUP_NAME);
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    clean.push(trimmed);
    if (clean.length >= LIMITS.MAX_GROUPS_PER_GUEST) break;
  }
  return clean;
}

function clampConfig(raw: Partial<SpinnerConfig> | null | undefined): SpinnerConfig {
  const title =
    typeof raw?.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 120)
      : DEFAULT_CONFIG.title;
  const dur = Number(raw?.spinnerDurationSec);
  const cruise = Number(raw?.spinnerCruisePct);
  const slow = Number(raw?.spinnerSlowDown);
  return {
    title,
    spinnerDurationSec: Number.isFinite(dur) ? Math.max(2, Math.min(20, Math.round(dur * 10) / 10)) : DEFAULT_CONFIG.spinnerDurationSec,
    spinnerCruisePct: Number.isFinite(cruise) ? Math.max(0, Math.min(60, Math.round(cruise))) : DEFAULT_CONFIG.spinnerCruisePct,
    spinnerSlowDown: Number.isFinite(slow) ? Math.max(1, Math.min(10, Math.round(slow * 10) / 10)) : DEFAULT_CONFIG.spinnerSlowDown,
  };
}

function readGuests(): Guest[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        fullName: String(item.fullName ?? '').trim().slice(0, LIMITS.MAX_FULL_NAME),
        employeeId: String(item.employeeId ?? '').trim().slice(0, LIMITS.MAX_EMPLOYEE_ID),
        division: typeof item.division === 'string' ? item.division.trim().slice(0, LIMITS.MAX_DIVISION) : '',
        groups: normalizeGroupList(Array.isArray(item.groups) ? item.groups : []),
        wonPrizeAt: typeof item.wonPrizeAt === 'string' ? item.wonPrizeAt : '',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      }))
      .filter((g) => g.fullName.length > 0 && g.employeeId.length > 0);
  } catch {
    return [];
  }
}

function readConfig(): SpinnerConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return clampConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
}

interface StoreState {
  guests: Guest[];
  config: SpinnerConfig;
}

let state: StoreState = {
  guests: readGuests(),
  config: readConfig(),
};

const listeners = new Set<() => void>();

function emit(next: StoreState) {
  state = next;
  for (const l of listeners) l();
}

function persistGuests(guests: Guest[]) {
  try {
    window.localStorage.setItem(GUESTS_KEY, JSON.stringify(guests));
  } catch {
    // Ignore storage quota errors
  }
  emit({ ...state, guests });
}

function persistConfig(config: SpinnerConfig) {
  const clean = clampConfig(config);
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota errors
  }
  emit({ ...state, config: clean });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === GUESTS_KEY || e.key === CONFIG_KEY) {
      emit({
        guests: readGuests(),
        config: readConfig(),
      });
    }
  });
}

export function useSpinnerStore() {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
  return snapshot;
}

export function addOrUpdateGuest(
  fullName: string,
  employeeId: string,
  division: string,
  groups: string[]
): 'added' | 'updated' {
  const cleanName = fullName.trim().slice(0, LIMITS.MAX_FULL_NAME);
  const cleanId = employeeId.trim().slice(0, LIMITS.MAX_EMPLOYEE_ID);
  const cleanDivision = division.trim().slice(0, LIMITS.MAX_DIVISION);
  const cleanGroups = normalizeGroupList(groups);
  const existingIdx = state.guests.findIndex(
    (g) => g.employeeId.toLowerCase() === cleanId.toLowerCase()
  );

  if (existingIdx >= 0) {
    const existing = state.guests[existingIdx];
    const next = [...state.guests];
    next[existingIdx] = {
      ...existing,
      fullName: cleanName,
      division: cleanDivision || existing.division,
      groups: normalizeGroupList([...existing.groups, ...cleanGroups]),
    };
    persistGuests(next);
    return 'updated';
  }

  const next: Guest[] = [
    ...state.guests,
    {
      id: crypto.randomUUID(),
      fullName: cleanName,
      employeeId: cleanId,
      division: cleanDivision,
      groups: cleanGroups,
      wonPrizeAt: '',
      createdAt: new Date().toISOString(),
    },
  ];
  persistGuests(next);
  return 'added';
}

export function bulkImportGuests(
  rows: Array<{ fullName: string; employeeId: string; division: string; groups: string[] }>,
  mergeExisting: boolean
): { created: number; updated: number; skipped: number } {
  const next = [...state.guests];
  const indexByEmpId = new Map<string, number>();
  next.forEach((g, idx) => indexByEmpId.set(g.employeeId.toLowerCase(), idx));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const key = row.employeeId.toLowerCase();
    const existingIdx = indexByEmpId.get(key);
    if (existingIdx !== undefined) {
      if (!mergeExisting) {
        skipped += 1;
        continue;
      }
      const existing = next[existingIdx];
      next[existingIdx] = {
        ...existing,
        fullName: row.fullName || existing.fullName,
        division: row.division || existing.division,
        groups: normalizeGroupList([...existing.groups, ...row.groups]),
      };
      updated += 1;
    } else {
      const guest: Guest = {
        id: crypto.randomUUID(),
        fullName: row.fullName,
        employeeId: row.employeeId,
        division: row.division,
        groups: normalizeGroupList(row.groups),
        wonPrizeAt: '',
        createdAt: nowIso,
      };
      indexByEmpId.set(key, next.length);
      next.push(guest);
      created += 1;
    }
  }

  persistGuests(next);
  return { created, updated, skipped };
}

export function setGuestGroups(guestId: string, groups: string[]) {
  const clean = normalizeGroupList(groups);
  persistGuests(state.guests.map((g) => (g.id === guestId ? { ...g, groups: clean } : g)));
}

export function bulkAdjustGuestGroups(guestIds: string[], groupNames: string[], mode: 'add' | 'remove') {
  const targetSet = new Set(guestIds);
  const cleanNames = normalizeGroupList(groupNames);
  const removeSet = new Set(cleanNames.map((g) => g.toLowerCase()));

  persistGuests(
    state.guests.map((g) => {
      if (!targetSet.has(g.id)) return g;
      const nextGroups =
        mode === 'add'
          ? normalizeGroupList([...g.groups, ...cleanNames])
          : g.groups.filter((grp) => !removeSet.has(grp.toLowerCase()));
      return { ...g, groups: nextGroups };
    })
  );
}

export function markGuestWinner(guestId: string) {
  const wonAt = new Date().toISOString();
  persistGuests(state.guests.map((g) => (g.id === guestId ? { ...g, wonPrizeAt: wonAt } : g)));
}

export function restoreSingleWinner(guestId: string) {
  persistGuests(state.guests.map((g) => (g.id === guestId ? { ...g, wonPrizeAt: '' } : g)));
}

export function resetWinners(groupFilterName?: string): number {
  let count = 0;
  const target = groupFilterName?.toLowerCase();
  const next = state.guests.map((g) => {
    if (!g.wonPrizeAt) return g;
    if (target && !g.groups.some((grp) => grp.toLowerCase() === target)) return g;
    count += 1;
    return { ...g, wonPrizeAt: '' };
  });
  if (count > 0) persistGuests(next);
  return count;
}

export function deleteGuests(guestIds: string[]) {
  const removeSet = new Set(guestIds);
  persistGuests(state.guests.filter((g) => !removeSet.has(g.id)));
}

export function saveSpinnerConfig(config: SpinnerConfig) {
  persistConfig(config);
}

// --- Custom C1-Continuous Spin Easing Curve ---

export function evalSpinnerProgress(t: number, cruisePct: number, slowDown: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const alpha = Math.max(0, Math.min(0.6, cruisePct / 100));
  const clampedSlowDown = Math.max(1, Math.min(10, slowDown));
  const power = 1.6 + ((clampedSlowDown - 1) / 9) * 5.4;

  const v0 = 1 / (alpha + (1 - alpha) / power);
  if (t <= alpha) return v0 * t;

  const u = (t - alpha) / (1 - alpha);
  return v0 * alpha + ((v0 * (1 - alpha)) / power) * (1 - Math.pow(1 - u, power));
}

export function evalSpinnerRelativeSpeed(t: number, cruisePct: number, slowDown: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;

  const alpha = Math.max(0, Math.min(0.6, cruisePct / 100));
  const clampedSlowDown = Math.max(1, Math.min(10, slowDown));
  const power = 1.6 + ((clampedSlowDown - 1) / 9) * 5.4;

  if (t <= alpha) return 1;
  const u = (t - alpha) / (1 - alpha);
  return Math.pow(1 - u, power - 1);
}

export function buildSpinnerKeyframes(
  startAngle: number,
  targetAngle: number,
  cruisePct: number,
  slowDown: number,
  steps = 300
): Keyframe[] {
  const delta = targetAngle - startAngle;
  const keyframes: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + delta * evalSpinnerProgress(t, cruisePct, slowDown);
    keyframes.push({
      offset: t,
      transform: `translate3d(0px, 0px, 0px) rotate(${angle.toFixed(4)}deg)`,
    });
  }
  return keyframes;
}

// --- Web Audio TV Game Show Wooden Peg Spin Ticks ---

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export interface WheelTickController {
  setMuted: (muted: boolean) => void;
  stop: () => void;
}

export function startWheelSpinTicks(params: {
  startAngle: number;
  targetAngle: number;
  durationSec: number;
  cruisePct: number;
  slowDown: number;
  numSegments: number;
  muted: boolean;
}): WheelTickController {
  const noop: WheelTickController = {
    setMuted: () => {},
    stop: () => {},
  };

  try {
    const ctx = getAudioContext();
    if (!ctx) return noop;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const { startAngle, targetAngle, durationSec, cruisePct, slowDown, numSegments, muted } = params;
    const totalDelta = targetAngle - startAngle;
    if (totalDelta <= 0 || durationSec <= 0 || numSegments <= 0) return noop;

    // Master muteable bus so toggling mute mid-spin works immediately
    const masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 0.85;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.08;

    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    // Pre-generate a tiny crisp noise burst buffer for the pointer pin snapping off each wooden peg
    const snapLength = Math.floor(ctx.sampleRate * 0.018);
    const snapBuffer = ctx.createBuffer(1, snapLength, ctx.sampleRate);
    const snapData = snapBuffer.getChannelData(0);
    for (let i = 0; i < snapLength; i++) {
      const env = Math.pow(1 - i / snapLength, 2.2);
      snapData[i] = (Math.random() * 2 - 1) * env;
    }

    // Match slice dividers for moderate wheels, or cap to an authentic game-show peg ring
    const pegCount =
      numSegments >= 8 && numSegments <= 24 ? numSegments : numSegments < 8 ? 16 : 20;
    const pegStepDeg = 360 / pegCount;

    // Compute exact peg crossing times along the spin easing curve
    const sampleSteps = Math.max(1200, Math.round(durationSec * 240));
    const crossings: Array<{ timeSec: number; speed: number; pegIdx: number }> = [];

    let prevAngle = startAngle;
    let prevPegIndex = Math.floor(prevAngle / pegStepDeg);
    let lastScheduledTime = -1;
    const minTickGapSec = 0.022; // Keep fast ticks crisp & distinct without buzzing

    for (let i = 1; i <= sampleSteps; i++) {
      const t = i / sampleSteps;
      const angle = startAngle + totalDelta * evalSpinnerProgress(t, cruisePct, slowDown);
      const pegIndex = Math.floor(angle / pegStepDeg);

      if (pegIndex > prevPegIndex) {
        const prevT = (i - 1) / sampleSteps;
        const boundaryAngle = (prevPegIndex + 1) * pegStepDeg;
        const frac = angle > prevAngle ? (boundaryAngle - prevAngle) / (angle - prevAngle) : 0;
        const crossT = prevT + Math.max(0, Math.min(1, frac)) * (t - prevT);
        const timeSec = crossT * durationSec;

        if (timeSec - lastScheduledTime >= minTickGapSec) {
          const speed = evalSpinnerRelativeSpeed(crossT, cruisePct, slowDown);
          crossings.push({ timeSec, speed, pegIdx: pegIndex });
          lastScheduledTime = timeSec;
        }
      }

      prevAngle = angle;
      prevPegIndex = pegIndex;
    }

    const activeNodes: Array<AudioScheduledSourceNode> = [];
    const baseTime = ctx.currentTime + 0.015;

    const scheduleWoodenPegHit = (hitTime: number, speed: number, pegIdx: number) => {
      // Subtle organic pitch variation per wooden peg (+/- 5%)
      const pegJitter = 0.95 + ((pegIdx * 37) % 11) * 0.01;
      const slowWeight = 1 - Math.min(1, speed) * 0.25; // Slightly warmer/heavier as it slows down
      const level = (0.34 + 0.26 * slowWeight) * (0.85 + 0.15 * (1 - speed));

      // 1. Hollow wooden peg body knock (rapid downward pitch transient)
      const woodOsc = ctx.createOscillator();
      const woodGain = ctx.createGain();
      woodOsc.type = 'triangle';
      const startFreq = (820 + speed * 140) * pegJitter;
      const endFreq = 265 * pegJitter;
      woodOsc.frequency.setValueAtTime(startFreq, hitTime);
      woodOsc.frequency.exponentialRampToValueAtTime(endFreq, hitTime + 0.018);

      woodGain.gain.setValueAtTime(0.0001, hitTime);
      woodGain.gain.linearRampToValueAtTime(level, hitTime + 0.0015);
      woodGain.gain.exponentialRampToValueAtTime(0.0001, hitTime + 0.026);

      woodOsc.connect(woodGain);
      woodGain.connect(masterGain);
      woodOsc.start(hitTime);
      woodOsc.stop(hitTime + 0.03);
      activeNodes.push(woodOsc);

      // 2. Lower wooden resonance thud for physical peg warmth
      const thudOsc = ctx.createOscillator();
      const thudGain = ctx.createGain();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(420 * pegJitter, hitTime);
      thudOsc.frequency.exponentialRampToValueAtTime(165 * pegJitter, hitTime + 0.022);

      thudGain.gain.setValueAtTime(0.0001, hitTime);
      thudGain.gain.linearRampToValueAtTime(level * 0.55, hitTime + 0.002);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, hitTime + 0.028);

      thudOsc.connect(thudGain);
      thudGain.connect(masterGain);
      thudOsc.start(hitTime);
      thudOsc.stop(hitTime + 0.032);
      activeNodes.push(thudOsc);

      // 3. Flapper/pin snap transient
      const snapSrc = ctx.createBufferSource();
      snapSrc.buffer = snapBuffer;
      const snapFilter = ctx.createBiquadFilter();
      snapFilter.type = 'bandpass';
      snapFilter.frequency.value = (2150 + speed * 450) * pegJitter;
      snapFilter.Q.value = 1.6;

      const snapGain = ctx.createGain();
      snapGain.gain.setValueAtTime(level * 0.65, hitTime);
      snapGain.gain.exponentialRampToValueAtTime(0.0001, hitTime + 0.016);

      snapSrc.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(masterGain);
      snapSrc.start(hitTime);
      snapSrc.stop(hitTime + 0.02);
      activeNodes.push(snapSrc);
    };

    for (const crossing of crossings) {
      scheduleWoodenPegHit(baseTime + crossing.timeSec, crossing.speed, crossing.pegIdx);
    }

    let stopped = false;

    return {
      setMuted: (nextMuted: boolean) => {
        if (stopped) return;
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(nextMuted ? 0 : 0.85, now);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(0, now);
        for (const node of activeNodes) {
          try {
            node.stop(now);
          } catch {
            // Node already finished
          }
        }
        try {
          masterGain.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      },
    };
  } catch {
    return noop;
  }
}
