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

// --- Web Audio Low-Bass Hockey Goal Horn ("Toot! Toot!") ---

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

function createBrassSaturationCurve(amount = 14): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const buffer = new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT);
  const curve = new Float32Array(buffer);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export function playCelebrationFanfare(muted = false): void {
  if (muted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Master compressor keeps the deep low-bass horn huge without clipping
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -10;
    master.knee.value = 12;
    master.ratio.value = 5;
    master.attack.value = 0.003;
    master.release.value = 0.16;
    master.connect(ctx.destination);

    // Subtle hockey arena slapback echo bus
    const arenaEcho1 = ctx.createDelay(0.5);
    arenaEcho1.delayTime.value = 0.095;
    const arenaEcho2 = ctx.createDelay(0.5);
    arenaEcho2.delayTime.value = 0.19;

    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 850;

    const echoGain1 = ctx.createGain();
    echoGain1.gain.value = 0.24;
    const echoGain2 = ctx.createGain();
    echoGain2.gain.value = 0.13;

    echoFilter.connect(arenaEcho1);
    arenaEcho1.connect(echoGain1);
    echoGain1.connect(master);

    echoFilter.connect(arenaEcho2);
    arenaEcho2.connect(echoGain2);
    echoGain2.connect(master);

    const brassCurve = createBrassSaturationCurve(3.4);

    // Single pneumatic hockey horn blast ("TOOT")
    const triggerHockeyHornBlast = (startTime: number, duration: number, level = 0.72) => {
      const brassDrive = ctx.createWaveShaper();
      brassDrive.curve = brassCurve;
      brassDrive.oversample = '2x';

      const blastGain = ctx.createGain();
      blastGain.gain.setValueAtTime(0.0001, startTime);
      blastGain.gain.linearRampToValueAtTime(level, startTime + 0.028);
      blastGain.gain.setValueAtTime(level * 0.94, startTime + Math.max(0.05, duration - 0.06));
      blastGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      // Warm low-mid brass filter so the low bass dominates
      const hornFilter = ctx.createBiquadFilter();
      hornFilter.type = 'lowpass';
      hornFilter.Q.value = 1.9;
      hornFilter.frequency.setValueAtTime(1650, startTime);
      hornFilter.frequency.exponentialRampToValueAtTime(1120, startTime + duration);

      // Sub-bass boost shelf for chesty arena rumble
      const bassBoost = ctx.createBiquadFilter();
      bassBoost.type = 'lowshelf';
      bassBoost.frequency.value = 150;
      bassBoost.gain.value = 6.5;

      brassDrive.connect(hornFilter);
      hornFilter.connect(bassBoost);
      bassBoost.connect(blastGain);
      blastGain.connect(master);
      blastGain.connect(echoFilter);

      // Deep sub-bass foundation (55 Hz A1 + 110 Hz A2)
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(53.2, startTime);
      subOsc.frequency.linearRampToValueAtTime(55.0, startTime + 0.04);
      subOsc.frequency.setValueAtTime(55.0, startTime + Math.max(0.06, duration - 0.06));
      subOsc.frequency.linearRampToValueAtTime(53.5, startTime + duration);
      subGain.gain.value = 0.55;
      subOsc.connect(subGain);
      subGain.connect(blastGain);
      subOsc.start(startTime);
      subOsc.stop(startTime + duration + 0.03);

      // Multi-bell hockey horn chord cluster (detuned low A2 + D3 + E3 + gritty upper A3)
      const bells: Array<{ freq: number; type: OscillatorType; gain: number }> = [
        { freq: 109.3, type: 'sawtooth', gain: 0.28 }, // A2 bell 1
        { freq: 110.6, type: 'sawtooth', gain: 0.28 }, // A2 bell 2 (thick air-horn beat)
        { freq: 146.5, type: 'sawtooth', gain: 0.17 }, // D3 low-mid body
        { freq: 164.8, type: 'sawtooth', gain: 0.19 }, // E3 power fifth
        { freq: 219.2, type: 'sawtooth', gain: 0.10 }, // A3 upper brass bite
      ];

      for (const bell of bells) {
        const osc = ctx.createOscillator();
        const voiceGain = ctx.createGain();
        osc.type = bell.type;

        // Pneumatic air-valve pitch scoop on attack & slight pressure sag on release
        osc.frequency.setValueAtTime(bell.freq * 0.962, startTime);
        osc.frequency.linearRampToValueAtTime(bell.freq, startTime + 0.038);
        osc.frequency.setValueAtTime(bell.freq, startTime + Math.max(0.06, duration - 0.065));
        osc.frequency.linearRampToValueAtTime(bell.freq * 0.974, startTime + duration);

        voiceGain.gain.value = bell.gain;
        osc.connect(voiceGain);
        voiceGain.connect(brassDrive);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.03);
      }

      // Brief pressurized air burst on horn valve opening
      const airSamples = Math.floor(ctx.sampleRate * 0.06);
      const airBuffer = ctx.createBuffer(1, airSamples, ctx.sampleRate);
      const airData = airBuffer.getChannelData(0);
      for (let i = 0; i < airSamples; i++) {
        airData[i] = Math.random() * 2 - 1;
      }
      const airNoise = ctx.createBufferSource();
      airNoise.buffer = airBuffer;
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'bandpass';
      airFilter.frequency.value = 620;
      airFilter.Q.value = 1.1;
      const airGain = ctx.createGain();
      airGain.gain.setValueAtTime(0.14, startTime);
      airGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.055);
      airNoise.connect(airFilter);
      airFilter.connect(airGain);
      airGain.connect(master);
      airNoise.start(startTime);
      airNoise.stop(startTime + 0.06);
    };

    const now = ctx.currentTime + 0.02;

    // Classic hockey goal horn: "TOOT! ... TOOOOOOT!"
    triggerHockeyHornBlast(now, 0.36, 0.72);
    triggerHockeyHornBlast(now + 0.51, 0.9, 0.78);
  } catch {
    // Ignore WebAudio playback restrictions
  }
}
