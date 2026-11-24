import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import {
  Award,
  Layers,
  Maximize2,
  RotateCcw,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  buildSpinnerKeyframes,
  hasWonInPool,
  markGuestWinner,
  playWinningSound,
  startWheelSpinTicks,
  unlockAudio,
  useSpinnerStore,
  type Guest,
  type WheelTickController,
} from '../store';

const WHEEL_COLORS = [
  '#EF4444', // Vivid Red
  '#F59E0B', // Bright Amber
  '#10B981', // Emerald Green
  '#0EA5E9', // Sky Cyan
  '#8B5CF6', // Electric Violet
  '#EC4899', // Hot Pink
  '#F97316', // Tangerine Orange
  '#14B8A6', // Teal
  '#3B82F6', // Cobalt Blue
  '#EAB308', // Sunny Gold
  '#22C55E', // Vivid Green
  '#E11D48', // Crimson Rose
  '#06B6D4', // Turquoise
  '#6366F1', // Indigo Blue
  '#FB7185', // Coral Pink
  '#84CC16', // Lime Green
];

function getSliceColor(index: number, total: number): string {
  const paletteLen = WHEEL_COLORS.length;
  if (total > 1 && index === total - 1 && index % paletteLen === 0) {
    return WHEEL_COLORS[Math.floor(paletteLen / 2)];
  }
  return WHEEL_COLORS[index % paletteLen];
}

const CONFETTI_COLORS = [
  '#004881',
  '#0EA5E9',
  '#F59E0B',
  '#10B981',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#FACC15',
];

interface EmblemDrop {
  id: number;
  left: string;
  delay: string;
  duration: string;
}

export function SpinnerPage() {
  const { guests, config } = useSpinnerStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [excludePreviousWinners, setExcludePreviousWinners] = useState(true);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<Guest | null>(null);
  const [lastWinner, setLastWinner] = useState<Guest | null>(null);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [viewportSpinning, setViewportSpinning] = useState(false);
  const [popupAnim, setPopupAnim] = useState<'spin' | 'pop' | 'none'>('none');
  const [emblems, setEmblems] = useState<EmblemDrop[]>([]);

  const fullscreenStageRef = useRef<HTMLDivElement | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wheelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentRotationRef = useRef(0);
  const spinAnimationRef = useRef<Animation | null>(null);
  const spinTicksRef = useRef<WheelTickController | null>(null);

  const confettiLauncherRef = useRef<confetti.CreateTypes | null>(null);
  const celebrationTimersRef = useRef<number[]>([]);

  useEffect(() => {
    spinTicksRef.current?.setMuted(muted);
  }, [muted]);

  const clearCelebrationTimers = useCallback(() => {
    for (const id of celebrationTimersRef.current) {
      window.clearTimeout(id);
    }
    celebrationTimersRef.current = [];
  }, []);

  useEffect(() => {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;

    let launcher: confetti.CreateTypes;
    try {
      launcher = confetti.create(canvas, {
        resize: true,
        useWorker: true,
        disableForReducedMotion: true,
      });
    } catch {
      launcher = confetti.create(canvas, {
        resize: true,
        useWorker: false,
        disableForReducedMotion: true,
      });
    }
    confettiLauncherRef.current = launcher;

    return () => {
      clearCelebrationTimers();
      if (spinTicksRef.current) {
        spinTicksRef.current.stop();
        spinTicksRef.current = null;
      }
      if (spinAnimationRef.current) {
        spinAnimationRef.current.onfinish = null;
        spinAnimationRef.current.cancel();
        spinAnimationRef.current = null;
      }
      try {
        launcher.reset();
      } catch {
        // Ignore worker reset errors on teardown
      }
      confettiLauncherRef.current = null;
    };
  }, [clearCelebrationTimers]);

  // Keep fullscreen state synchronized with browser Fullscreen API
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      } else if (document.fullscreenElement === fullscreenStageRef.current) {
        setIsFullscreen(true);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const enterFullscreen = async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setIsFullscreen(true);
    const el = fullscreenStageRef.current;
    if (el && el.requestFullscreen && !document.fullscreenElement) {
      try {
        await el.requestFullscreen();
      } catch {
        // Fallback fixed viewport overlay remains active if Fullscreen API is blocked
      }
    }
  };

  const activeGroup = (searchParams.get('group') ?? '').trim();

  const groupStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; eligible: number }>();
    for (const guest of guests) {
      for (const grp of guest.groups) {
        const key = grp.toLowerCase();
        const existing = map.get(key) ?? { name: grp, total: 0, eligible: 0 };
        existing.total += 1;
        if (!hasWonInPool(guest, grp)) existing.eligible += 1;
        map.set(key, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [guests]);

  const selectGroup = (groupName: string) => {
    if (isSpinning) return;
    setLastWinner(null);
    if (!groupName) {
      searchParams.delete('group');
      setSearchParams(searchParams);
    } else {
      setSearchParams({ group: groupName });
    }
  };

  const groupFilteredGuests = useMemo(() => {
    if (!activeGroup) return guests;
    const target = activeGroup.toLowerCase();
    return guests.filter((g) => g.groups.some((grp) => grp.toLowerCase() === target));
  }, [guests, activeGroup]);

  const eligibleGuests = useMemo(
    () =>
      excludePreviousWinners
        ? groupFilteredGuests.filter((g) => !hasWonInPool(g, activeGroup))
        : groupFilteredGuests,
    [groupFilteredGuests, excludePreviousWinners, activeGroup]
  );

  const numSegments = eligibleGuests.length;
  const sliceAngle = numSegments > 0 ? 360 / numSegments : 0;

  // Render clean, vibrant supersampled wheel texture without rim dots or center shield
  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas || numSegments === 0) return;

    const dpr = Math.max(2, Math.min(window.devicePixelRatio || 1, 2));
    const displaySize = 760;
    canvas.width = displaySize * dpr;
    canvas.height = displaySize * dpr;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const cx = displaySize / 2;
    const cy = displaySize / 2;
    const radius = displaySize / 2;

    ctx.clearRect(0, 0, displaySize, displaySize);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const sliceRad = (2 * Math.PI) / numSegments;
    const showSliceBorders = numSegments <= 90;
    const showLabels = numSegments <= 64;
    const seamOverlapRad =
      showSliceBorders || numSegments === 1 ? 0 : Math.min(0.003, sliceRad * 0.15);
    const fontSize =
      numSegments <= 10 ? 22 : numSegments <= 20 ? 19 : numSegments <= 36 ? 15.5 : 13;

    for (let i = 0; i < numSegments; i++) {
      const startAngle = i * sliceRad - Math.PI / 2;
      const endAngle = (i + 1) * sliceRad - Math.PI / 2 + seamOverlapRad;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = getSliceColor(i, numSegments);
      ctx.fill();
    }

    if (showSliceBorders && numSegments > 1) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = numSegments > 32 ? 1.1 : 1.8;
      ctx.lineCap = 'butt';
      for (let i = 0; i < numSegments; i++) {
        const a = i * sliceRad - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.stroke();
      }
    }

    if (showLabels) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.lineWidth = 4;
      ctx.fillStyle = '#FFFFFF';
      const maxLabelWidth = radius - 70;

      for (let i = 0; i < numSegments; i++) {
        const midAngle = (i + 0.5) * sliceRad - Math.PI / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(midAngle);

        let label = eligibleGuests[i].fullName;
        if (ctx.measureText(label).width > maxLabelWidth) {
          while (label.length > 3 && ctx.measureText(`${label}…`).width > maxLabelWidth) {
            label = label.slice(0, -1);
          }
          label = `${label}…`;
        }
        ctx.strokeText(label, radius - 24, 0);
        ctx.fillText(label, radius - 24, 0);
        ctx.restore();
      }
    }

    ctx.restore();
    canvas.style.transform = `translate3d(0px, 0px, 0px) rotate(${currentRotationRef.current}deg)`;
  }, [eligibleGuests, numSegments]);

  const scheduleTimer = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    celebrationTimersRef.current.push(id);
  };

  const triggerExtravaganza = () => {
    clearCelebrationTimers();

    if (config.winningSoundEnabled) {
      playWinningSound(muted);
    }

    if (config.rotationEnabled) {
      if (viewportSpinning) {
        setViewportSpinning(false);
        setPopupAnim('none');
        requestAnimationFrame(() => {
          setViewportSpinning(true);
          setPopupAnim('spin');
        });
      } else {
        setViewportSpinning(true);
        setPopupAnim('spin');
      }
      scheduleTimer(() => {
        setViewportSpinning(false);
        setPopupAnim('none');
      }, 1250);
    } else {
      setViewportSpinning(false);
      setPopupAnim('pop');
    }

    if (!config.confettiEnabled) {
      setIsCelebrating(false);
      setEmblems([]);
      return;
    }

    setIsCelebrating(true);
    scheduleTimer(() => setIsCelebrating(false), 3300);

    const fire = confettiLauncherRef.current ?? confetti;

    const launchCannons = (count: number, velocity: number, spread: number) => {
      fire({
        particleCount: count,
        angle: 58,
        spread,
        startVelocity: velocity,
        ticks: 180,
        gravity: 1.05,
        origin: { x: 0.02, y: 0.72 },
        colors: CONFETTI_COLORS,
        shapes: ['square', 'circle', 'star'],
      });
      fire({
        particleCount: count,
        angle: 122,
        spread,
        startVelocity: velocity,
        ticks: 180,
        gravity: 1.05,
        origin: { x: 0.98, y: 0.72 },
        colors: CONFETTI_COLORS,
        shapes: ['square', 'circle', 'star'],
      });
    };

    fire({
      particleCount: 70,
      spread: 95,
      startVelocity: 48,
      ticks: 190,
      origin: { x: 0.5, y: 0.45 },
      colors: CONFETTI_COLORS,
      shapes: ['star', 'square', 'circle'],
    });
    launchCannons(30, 56, 60);

    scheduleTimer(() => launchCannons(24, 52, 58), 380);
    scheduleTimer(() => {
      fire({
        particleCount: 34,
        spread: 110,
        startVelocity: 36,
        scalar: 1.15,
        ticks: 180,
        origin: { x: 0.5, y: 0.3 },
        colors: ['#004881', '#F59E0B', '#0EA5E9'],
        shapes: ['star'],
      });
      launchCannons(20, 48, 55);
    }, 850);
    scheduleTimer(() => launchCannons(18, 45, 52), 1500);

    const drops: EmblemDrop[] = Array.from({ length: 12 }).map((_, i) => ({
      id: Date.now() + i,
      left: `${Math.round(((i * 8 + Math.random() * 5) % 92) + 4)}vw`,
      delay: `${(i * 0.09).toFixed(2)}s`,
      duration: `${(2.0 + (i % 4) * 0.3).toFixed(2)}s`,
    }));
    setEmblems(drops);
    scheduleTimer(() => setEmblems([]), 3600);
  };

  const durationSec = config.spinnerDurationSec;
  const cruisePct = config.spinnerCruisePct;
  const slowDown = config.spinnerSlowDown;

  const handleSpin = () => {
    const canvas = wheelCanvasRef.current;
    if (!canvas || numSegments === 0 || isSpinning || winner) return;

    if (spinTicksRef.current) {
      spinTicksRef.current.stop();
      spinTicksRef.current = null;
    }
    if (spinAnimationRef.current) {
      spinAnimationRef.current.onfinish = null;
      spinAnimationRef.current.cancel();
      spinAnimationRef.current = null;
    }

    unlockAudio();

    const winnerIndex = Math.floor(Math.random() * numSegments);
    const chosenWinner = eligibleGuests[winnerIndex];

    const innerJitter = numSegments > 1 ? (Math.random() - 0.5) * sliceAngle * 0.55 : 0;
    const centerOfWinner = winnerIndex * sliceAngle + sliceAngle / 2 + innerJitter;
    const landingMod = (((360 - centerOfWinner) % 360) + 360) % 360;

    const extraSpins = Math.max(5, Math.round(durationSec * 1.45)) * 360;
    const startAngle = ((currentRotationRef.current % 360) + 360) % 360;
    const targetAngle = extraSpins + landingMod;

    const keyframes = buildSpinnerKeyframes(startAngle, targetAngle, cruisePct, slowDown, 300);
    const anim = canvas.animate(keyframes, {
      duration: durationSec * 1000,
      easing: 'linear',
      fill: 'forwards',
    });
    spinAnimationRef.current = anim;

    if (config.pegSoundEnabled) {
      spinTicksRef.current = startWheelSpinTicks({
        startAngle,
        targetAngle,
        durationSec,
        cruisePct,
        slowDown,
        numSegments,
        muted,
      });
    }

    anim.onfinish = () => {
      if (spinTicksRef.current) {
        spinTicksRef.current.stop();
        spinTicksRef.current = null;
      }
      const settled = ((targetAngle % 360) + 360) % 360;
      currentRotationRef.current = settled;
      if (wheelCanvasRef.current) {
        wheelCanvasRef.current.style.transform = `translate3d(0px, 0px, 0px) rotate(${settled}deg)`;
      }
      anim.cancel();
      spinAnimationRef.current = null;
      setIsSpinning(false);
      setWinner(chosenWinner);
      setLastWinner(chosenWinner);
      triggerExtravaganza();
      markGuestWinner(chosenWinner.id, activeGroup);
    };

    setWinner(null);
    setIsSpinning(true);
  };

  const handleSpinRef = useRef(handleSpin);
  handleSpinRef.current = handleSpin;

  const handleCloseWinner = useCallback(() => {
    clearCelebrationTimers();
    try {
      confettiLauncherRef.current?.reset();
    } catch {
      // Ignore reset errors
    }
    setIsCelebrating(false);
    setViewportSpinning(false);
    setPopupAnim('none');
    setEmblems([]);
    setWinner(null);
  }, [clearCelebrationTimers]);

  // Fullscreen keyboard shortcuts: Space to spin, Escape to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          handleSpinRef.current();
        }
      } else if (e.key === 'Escape') {
        if (!document.fullscreenElement) {
          setIsFullscreen(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const fullscreenTitle = activeGroup;

  return (
    <div
      ref={fullscreenStageRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 h-screen w-screen overflow-hidden flex flex-col justify-between bg-[#F4F7FB] text-slate-900'
          : 'min-h-[calc(100vh-4rem)] relative overflow-hidden flex flex-col justify-between bg-[#F4F7FB] text-slate-900'
      }
    >
      {/* Confetti Canvas mounted inside stage so it works in native Fullscreen */}
      <canvas
        ref={confettiCanvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-[65]"
      />

      {isCelebrating && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[5] pointer-events-none animate-gala-glow"
          style={{
            background:
              'radial-gradient(circle at 50% 44%, rgba(0, 72, 129, 0.16), rgba(245, 158, 11, 0.12) 42%, rgba(244, 247, 251, 0) 76%)',
          }}
        />
      )}

      {emblems.map((drop) => (
        <div
          key={drop.id}
          className="gala-emblem-drop text-amber-500 text-3xl select-none"
          style={{
            left: drop.left,
            animationDelay: drop.delay,
            animationDuration: drop.duration,
          }}
        >
          ✦
        </div>
      ))}

      <div
        className={`flex-1 flex flex-col justify-between relative ${
          viewportSpinning ? 'animate-viewport-spin' : ''
        }`}
      >
        {/* Top Stage Controls Bar (hidden in fullscreen) */}
        {!isFullscreen && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 pt-4 flex flex-wrap items-center justify-between gap-3 relative z-20">
            <div className="flex items-center gap-4">
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#004881] transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Spinner Settings</span>
              </Link>
              <span className="text-slate-300" aria-hidden="true">
                |
              </span>
              <span className="text-xs font-mono font-semibold text-[#004881] tabular-nums">
                {eligibleGuests.length} Eligible Guests
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to="/settings"
                className="hidden sm:inline-flex items-center text-xs font-mono text-slate-500 hover:text-[#004881] transition-colors tabular-nums mr-1"
                title="Adjust spin duration & slow-down curve in Settings"
              >
                {durationSec.toFixed(1)}s spin · tail {slowDown.toFixed(1)}/10
              </Link>

              <button
                type="button"
                onClick={() => setExcludePreviousWinners((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  excludePreviousWinners
                    ? 'bg-[#004881] border-[#004881] text-white'
                    : 'bg-white border-slate-300 text-slate-700 hover:border-[#004881]/50'
                }`}
              >
                {excludePreviousWinners ? 'Excluding Prior Winners' : 'Including All Guests'}
              </button>

              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Unmute wheel sound' : 'Mute wheel sound'}
                className="p-2 rounded-lg bg-white border border-slate-300 text-[#004881] hover:border-[#004881] transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={enterFullscreen}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-[#004881]/35 text-xs font-semibold text-[#004881] hover:bg-[#004881] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fullscreen</span>
              </button>
            </div>
          </div>
        )}

        {/* Group Spinner Selector Strip (hidden in fullscreen) */}
        {!isFullscreen && (groupStats.length > 0 || activeGroup) && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 pt-2.5 relative z-20">
            <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 shadow-sm rounded-xl px-3.5 py-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 mr-1 whitespace-nowrap">
                <Layers className="w-3.5 h-3.5 text-[#004881]" />
                <span>Spinner Pool:</span>
              </div>
              <button
                type="button"
                disabled={isSpinning}
                onClick={() => selectGroup('')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                  !activeGroup
                    ? 'bg-[#004881] text-white'
                    : 'bg-[#F4F7FB] border border-slate-200 text-slate-700 hover:border-[#004881]/50 hover:text-[#004881]'
                }`}
              >
                All Guests (
                {excludePreviousWinners ? guests.filter((g) => !hasWonInPool(g)).length : guests.length})
              </button>
              {groupStats.map((grp) => {
                const isSelected = activeGroup.toLowerCase() === grp.name.toLowerCase();
                const count = excludePreviousWinners ? grp.eligible : grp.total;
                return (
                  <button
                    key={grp.name}
                    type="button"
                    disabled={isSpinning}
                    onClick={() => selectGroup(grp.name)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 tabular-nums ${
                      isSelected
                        ? 'bg-[#004881] text-white'
                        : 'bg-[#F4F7FB] border border-slate-200 text-slate-700 hover:border-[#004881]/50 hover:text-[#004881]'
                    }`}
                  >
                    {grp.name} ({count})
                  </button>
                );
              })}
              {activeGroup &&
                !groupStats.some((g) => g.name.toLowerCase() === activeGroup.toLowerCase()) && (
                  <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#004881] text-white">
                    {activeGroup} (0)
                  </span>
                )}
            </div>
          </div>
        )}

        {/* Main Stage Centerpiece */}
        <div
          className={`flex-1 flex flex-col items-center justify-center px-4 relative z-10 ${
            isFullscreen ? 'py-2 gap-4' : 'py-3 gap-3'
          }`}
        >
          {isFullscreen ? (
            fullscreenTitle ? (
              <div className="text-center pb-1">
                <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#004881]">
                  {fullscreenTitle}
                </h1>
              </div>
            ) : null
          ) : (
            <div className="text-center mb-1 space-y-0.5">
              {activeGroup && (
                <div className="text-[11px] font-semibold tracking-[0.22em] text-[#004881] uppercase">
                  {activeGroup}
                </div>
              )}
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900">
                Prize Spinner
              </h1>
            </div>
          )}

          {numSegments === 0 ? (
            <div className="max-w-md w-full bg-white border border-slate-200 shadow-sm rounded-2xl p-8 text-center space-y-4 my-8">
              <Award className="w-12 h-12 text-[#004881] mx-auto" />
              <h2 className="font-display text-3xl font-bold text-slate-900">
                {groupFilteredGuests.length === 0
                  ? activeGroup
                    ? `No Guests in "${activeGroup}"`
                    : 'No Guests on Wheel Yet'
                  : activeGroup
                  ? `All Guests in "${activeGroup}" Drawn`
                  : 'All Guests Drawn'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {groupFilteredGuests.length === 0
                  ? activeGroup
                    ? `Assign the "${activeGroup}" grouping to guests in Spinner Settings, or switch back to All Guests.`
                    : 'Add participants individually or bulk import a guest list in Spinner Settings.'
                  : 'Every eligible guest in this pool has already been drawn. Reset winners in Spinner Settings or toggle "Including All Guests" above.'}
              </p>
              {!isFullscreen && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {activeGroup && (
                    <button
                      type="button"
                      onClick={() => selectGroup('')}
                      className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-semibold hover:border-[#004881] hover:text-[#004881] cursor-pointer"
                    >
                      All Guests Pool
                    </button>
                  )}
                  <Link
                    to="/settings"
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[#004881] text-white text-sm font-bold hover:bg-[#003764]"
                  >
                    Open Settings
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className={`flex flex-col items-center ${isFullscreen ? '' : 'space-y-5'}`}>
              {/* Wheel Assembly */}
              <div className="relative select-none mt-3">
                <div className="absolute -inset-3 rounded-full bg-gradient-to-tr from-[#004881] via-[#2B7BB9] to-[#003764] opacity-90 shadow-xl shadow-[#004881]/20" />

                <div
                  className={`relative rounded-full border-[6px] sm:border-[8px] border-[#004881] bg-white shadow-xl ${
                    isFullscreen
                      ? fullscreenTitle
                        ? 'w-[min(90vw,80vh)] h-[min(90vw,80vh)]'
                        : 'w-[min(92vw,84vh)] h-[min(92vw,84vh)]'
                      : 'w-[min(90vw,64vh)] h-[min(90vw,64vh)]'
                  }`}
                >
                  <canvas
                    ref={wheelCanvasRef}
                    className="w-full h-full block rounded-full"
                    style={{
                      willChange: 'transform',
                      backfaceVisibility: 'hidden',
                      contain: 'layout paint style',
                    }}
                  />
                </div>

                {/* High-Contrast Top Pointer */}
                <svg
                  viewBox="0 0 36 40"
                  className="w-10 h-11 sm:w-11 sm:h-12 absolute -top-6 left-1/2 -translate-x-1/2 z-30 drop-shadow-[0_4px_10px_rgba(0,72,129,0.4)]"
                  aria-hidden="true"
                >
                  <polygon
                    points="18,38 3,4 33,4"
                    fill="#FACC15"
                    stroke="#004881"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* Spin Action (hidden in fullscreen; Space spins) */}
              {!isFullscreen && (
                <div className="min-h-[72px] flex flex-col items-center justify-center text-center gap-2">
                  <button
                    type="button"
                    onClick={handleSpin}
                    disabled={isSpinning || numSegments < 1 || winner !== null}
                    className="px-10 py-3.5 rounded-full bg-[#004881] text-white font-extrabold text-base sm:text-lg uppercase tracking-wider shadow-lg shadow-[#004881]/25 hover:bg-[#003764] active:translate-y-0.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSpinning ? 'Spinning the Wheel...' : 'Spin the Wheel'}
                  </button>

                  {lastWinner && !winner && !isSpinning && (
                    <button
                      type="button"
                      onClick={() => {
                        setPopupAnim('pop');
                        setWinner(lastWinner);
                      }}
                      className="text-xs font-semibold text-[#004881] hover:underline cursor-pointer"
                    >
                      Last Selected: {lastWinner.fullName} (View Spotlight)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Hint or Normal Footer */}
        {isFullscreen ? (
          <div className="pb-3 pt-1 px-4 text-center text-xs text-slate-500 relative z-20 select-none">
            Press{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[11px] font-semibold text-[#004881]">
              Space
            </kbd>{' '}
            to spin the wheel · Press{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[11px] font-semibold text-slate-700">
              Esc
            </kbd>{' '}
            to exit fullscreen
          </div>
        ) : (
          <div className="pb-3 text-center text-xs text-slate-500">
            JMEG Events · Live Prize Drawing
          </div>
        )}
      </div>

      {/* Persistent Full-Screen Winner Spotlight Overlay (inside stage container for Fullscreen compatibility) */}
      {winner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-slate-900/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-spotlight-name"
        >
          <div
            className={`relative max-w-2xl w-full bg-white border-2 border-[#004881]/30 rounded-3xl p-8 sm:p-12 text-center shadow-2xl space-y-6 ${
              popupAnim === 'spin'
                ? 'animate-popup-spin'
                : popupAnim === 'pop'
                ? 'animate-spotlight-pop'
                : ''
            }`}
          >
            <button
              type="button"
              onClick={handleCloseWinner}
              aria-label="Close winner announcement"
              className="absolute top-5 right-5 w-10 h-10 rounded-full border border-slate-200 bg-slate-50 text-slate-500 hover:text-[#004881] hover:border-[#004881]/40 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold tracking-[0.24em] text-[#004881] uppercase pt-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Ladies and Gentlemen</span>
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>

            <h2
              id="winner-spotlight-name"
              className="font-display text-5xl sm:text-7xl font-bold text-slate-900 leading-tight break-words"
              style={{ textWrap: 'balance' }}
            >
              {winner.fullName}
            </h2>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base sm:text-xl font-mono font-semibold text-[#004881] tabular-nums">
                <span>Employee #: {winner.employeeId}</span>
                {winner.division && (
                  <>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-sans font-semibold text-slate-700">
                      {winner.division}
                    </span>
                  </>
                )}
              </div>
              {winner.groups.length > 0 && (
                <div className="text-xs font-mono text-slate-600">{winner.groups.join(' · ')}</div>
              )}
              <div className="text-xs text-slate-500">{config.title}</div>
            </div>

            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              {(config.confettiEnabled || config.rotationEnabled || config.winningSoundEnabled) && (
                <button
                  type="button"
                  onClick={triggerExtravaganza}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-300 bg-slate-50 text-[#004881] text-sm font-semibold hover:bg-[#004881]/5 hover:border-[#004881]/40 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Replay Effects</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCloseWinner}
                className="px-8 py-3 rounded-xl bg-[#004881] text-white text-sm font-extrabold uppercase tracking-wide hover:bg-[#003764] transition-colors cursor-pointer"
              >
                Close &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
