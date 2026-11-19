import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import {
  Award,
  Layers,
  RotateCcw,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  buildSpinnerKeyframes,
  markGuestWinner,
  playCelebrationFanfare,
  unlockAudio,
  useSpinnerStore,
  type Guest,
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
  '#EF4444',
  '#F59E0B',
  '#FACC15',
  '#10B981',
  '#0EA5E9',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
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

  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<Guest | null>(null);
  const [lastWinner, setLastWinner] = useState<Guest | null>(null);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [viewportSpinning, setViewportSpinning] = useState(false);
  const [popupAnim, setPopupAnim] = useState<'spin' | 'pop' | 'none'>('none');
  const [emblems, setEmblems] = useState<EmblemDrop[]>([]);

  const wheelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentRotationRef = useRef(0);
  const spinAnimationRef = useRef<Animation | null>(null);

  const confettiLauncherRef = useRef<confetti.CreateTypes | null>(null);
  const celebrationTimersRef = useRef<number[]>([]);

  const clearCelebrationTimers = useCallback(() => {
    for (const id of celebrationTimersRef.current) {
      window.clearTimeout(id);
    }
    celebrationTimersRef.current = [];
  }, []);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '65';
    document.body.appendChild(canvas);

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
      canvas.remove();
    };
  }, [clearCelebrationTimers]);

  const activeGroup = (searchParams.get('group') ?? '').trim();

  const groupStats = useMemo(() => {
    const map = new Map<string, { name: string; total: number; eligible: number }>();
    for (const guest of guests) {
      for (const grp of guest.groups) {
        const key = grp.toLowerCase();
        const existing = map.get(key) ?? { name: grp, total: 0, eligible: 0 };
        existing.total += 1;
        if (!guest.wonPrizeAt) existing.eligible += 1;
        map.set(key, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [guests]);

  const selectGroup = (groupName: string) => {
    if (isSpinning) return;
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
        ? groupFilteredGuests.filter((g) => !g.wonPrizeAt)
        : groupFilteredGuests,
    [groupFilteredGuests, excludePreviousWinners]
  );

  const numSegments = eligibleGuests.length;
  const sliceAngle = numSegments > 0 ? 360 / numSegments : 0;

  // Render clean, vibrant supersampled wheel texture without rim dots or center shield
  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas || numSegments === 0) return;

    const dpr = Math.max(2, Math.min(window.devicePixelRatio || 1, 2));
    const displaySize = 440;
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
    const seamOverlapRad = showSliceBorders || numSegments === 1 ? 0 : Math.min(0.003, sliceRad * 0.15);
    const fontSize =
      numSegments <= 10 ? 14 : numSegments <= 20 ? 12 : numSegments <= 36 ? 10 : 8.5;

    // 1. Solid vibrant slice wedges
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

    // 2. Clean radial divider lines when slice width allows
    if (showSliceBorders && numSegments > 1) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = numSegments > 32 ? 0.75 : 1.35;
      ctx.lineCap = 'butt';
      for (let i = 0; i < numSegments; i++) {
        const a = i * sliceRad - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3);
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.stroke();
      }
    }

    // 3. Guest name labels when legible
    if (showLabels) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(7, 11, 25, 0.85)';
      ctx.lineWidth = 2.6;
      ctx.fillStyle = '#FFFFFF';
      const maxLabelWidth = radius - 42;

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
        ctx.strokeText(label, radius - 16, 0);
        ctx.fillText(label, radius - 16, 0);
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
    setIsCelebrating(true);

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

    playCelebrationFanfare(muted);

    scheduleTimer(() => setIsCelebrating(false), 3300);
    scheduleTimer(() => {
      setViewportSpinning(false);
      setPopupAnim('none');
    }, 1250);

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
        colors: ['#FACC15', '#D4AF37', '#FEF3C7'],
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

    if (spinAnimationRef.current) {
      spinAnimationRef.current.onfinish = null;
      spinAnimationRef.current.cancel();
      spinAnimationRef.current = null;
    }

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

    anim.onfinish = () => {
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
      markGuestWinner(chosenWinner.id);
    };

    setWinner(null);
    setIsSpinning(true);
    unlockAudio();
  };

  const handleCloseWinner = () => {
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
  };

  return (
    <>
      {isCelebrating && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[5] pointer-events-none animate-gala-glow"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, rgba(0, 71, 127, 0.72), rgba(250, 204, 21, 0.16) 42%, rgba(7, 11, 25, 0) 78%)',
          }}
        />
      )}

      {emblems.map((drop) => (
        <div
          key={drop.id}
          className="gala-emblem-drop text-amber-300 text-3xl select-none"
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
        className={`min-h-[calc(100vh-4rem)] relative overflow-hidden flex flex-col justify-between bg-[#070B19] ${
          viewportSpinning ? 'animate-viewport-spin' : ''
        }`}
      >
        {/* Top Stage Controls Bar */}
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 pt-6 flex flex-wrap items-center justify-between gap-4 relative z-20">
          <div className="flex items-center gap-4">
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-amber-300 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Spinner Settings</span>
            </Link>
            <span className="text-slate-700" aria-hidden="true">
              |
            </span>
            <span className="text-xs font-mono text-amber-300 tabular-nums">
              {eligibleGuests.length} Eligible Guests
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/settings"
              className="hidden sm:inline-flex items-center text-xs font-mono text-slate-400 hover:text-amber-300 transition-colors tabular-nums"
              title="Adjust spin duration & slow-down curve in Settings"
            >
              {durationSec.toFixed(1)}s spin · tail {slowDown.toFixed(1)}/10
            </Link>

            <button
              type="button"
              onClick={() => setExcludePreviousWinners((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                excludePreviousWinners
                  ? 'bg-[#00477f] border-sky-300/45 text-sky-50'
                  : 'bg-[#111833] border-slate-700 text-slate-400'
              }`}
            >
              {excludePreviousWinners ? 'Excluding Prior Winners' : 'Including All Guests'}
            </button>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute fanfare audio' : 'Mute fanfare audio'}
              className="p-2 rounded-lg bg-[#111833] border border-slate-700 text-amber-300 hover:border-amber-400/50 cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Group Spinner Selector Strip */}
        {(groupStats.length > 0 || activeGroup) && (
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 pt-3 relative z-20">
            <div className="flex flex-wrap items-center gap-2 bg-[#111833]/80 border border-slate-800 rounded-xl px-3.5 py-2.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 mr-1 whitespace-nowrap">
                <Layers className="w-3.5 h-3.5 text-amber-300" />
                <span>Spinner Pool:</span>
              </div>
              <button
                type="button"
                disabled={isSpinning}
                onClick={() => selectGroup('')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                  !activeGroup
                    ? 'bg-amber-400 text-[#070B19]'
                    : 'bg-[#070B19] border border-slate-700 text-slate-300 hover:border-amber-400/50'
                }`}
              >
                All Guests (
                {excludePreviousWinners ? guests.filter((g) => !g.wonPrizeAt).length : guests.length})
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
                        ? 'bg-[#00477f] border border-sky-300/60 text-sky-50'
                        : 'bg-[#070B19] border border-slate-700 text-slate-300 hover:border-sky-300/50'
                    }`}
                  >
                    {grp.name} ({count})
                  </button>
                );
              })}
              {activeGroup &&
                !groupStats.some((g) => g.name.toLowerCase() === activeGroup.toLowerCase()) && (
                  <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#00477f] border border-sky-300/60 text-sky-50">
                    {activeGroup} (0)
                  </span>
                )}
            </div>
          </div>
        )}

        {/* Main Stage Centerpiece */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 relative z-10">
          <div className="text-center mb-6 space-y-1">
            <div className="text-xs font-semibold tracking-[0.22em] text-amber-300 uppercase">
              {activeGroup ? `${config.title} · Group: ${activeGroup}` : config.title}
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-white">
              Prize Spinner
            </h1>
          </div>

          {numSegments === 0 ? (
            <div className="max-w-md w-full bg-[#111833] border border-amber-400/25 rounded-2xl p-8 text-center space-y-4 my-8">
              <Award className="w-12 h-12 text-amber-300 mx-auto" />
              <h2 className="font-display text-3xl font-bold text-white">
                {groupFilteredGuests.length === 0
                  ? activeGroup
                    ? `No Guests in "${activeGroup}"`
                    : 'No Guests on Wheel Yet'
                  : activeGroup
                  ? `All Guests in "${activeGroup}" Drawn`
                  : 'All Guests Drawn'}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                {groupFilteredGuests.length === 0
                  ? activeGroup
                    ? `Assign the "${activeGroup}" grouping to guests in Spinner Settings, or switch back to All Guests.`
                    : 'Add participants individually or bulk import a guest list in Spinner Settings.'
                  : 'Every eligible guest in this pool has already been drawn. Reset winners in Spinner Settings or toggle "Including All Guests" above.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {activeGroup && (
                  <button
                    type="button"
                    onClick={() => selectGroup('')}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[#00477f] border border-sky-300/45 text-sky-50 text-sm font-semibold hover:bg-[#00599e] cursor-pointer"
                  >
                    All Guests Pool
                  </button>
                )}
                <Link
                  to="/settings"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-amber-400 text-[#070B19] text-sm font-bold hover:bg-amber-300"
                >
                  Open Settings
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center space-y-8">
              {/* Wheel Assembly */}
              <div className="relative select-none">
                <div className="absolute -inset-3 rounded-full bg-gradient-to-tr from-amber-600 via-amber-200 to-amber-500 opacity-85 shadow-2xl" />

                <div className="relative w-[310px] h-[310px] sm:w-[440px] sm:h-[440px] rounded-full border-[6px] border-[#070B19] bg-[#070B19] shadow-2xl">
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
                  className="w-9 h-10 absolute -top-5 left-1/2 -translate-x-1/2 z-30 drop-shadow-[0_4px_12px_rgba(7,11,25,0.85)]"
                  aria-hidden="true"
                >
                  <polygon
                    points="18,38 3,4 33,4"
                    fill="#FACC15"
                    stroke="#070B19"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* Spin Action */}
              <div className="min-h-[84px] flex flex-col items-center justify-center text-center gap-3">
                <button
                  type="button"
                  onClick={handleSpin}
                  disabled={isSpinning || numSegments < 1 || winner !== null}
                  className="px-10 py-4 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-[#070B19] font-extrabold text-lg uppercase tracking-wider shadow-xl hover:from-amber-200 hover:to-amber-400 active:translate-y-0.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="text-xs text-amber-300 hover:text-amber-200 underline cursor-pointer"
                  >
                    Last Selected: {lastWinner.fullName} (View Spotlight)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="pb-6 text-center text-xs text-slate-500">
          JMEG Events · Live Prize Drawing
        </div>
      </div>

      {/* Persistent Full-Screen Winner Spotlight Overlay */}
      {winner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-[#070B19]/88"
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-spotlight-name"
        >
          <div
            className={`relative max-w-2xl w-full bg-gradient-to-b from-[#00477f] via-[#111833] to-[#070B19] border-2 border-amber-400/70 rounded-3xl p-8 sm:p-12 text-center shadow-[0_0_50px_rgba(250,204,21,0.22)] space-y-6 ${
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
              className="absolute top-5 right-5 w-10 h-10 rounded-full border border-slate-700 bg-[#070B19]/80 text-slate-300 hover:text-white hover:border-amber-400 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold tracking-[0.26em] text-amber-300 uppercase pt-2">
              <Sparkles className="w-4 h-4" />
              <span>Ladies and Gentlemen</span>
              <Sparkles className="w-4 h-4" />
            </div>

            <h2
              id="winner-spotlight-name"
              className="font-display text-5xl sm:text-7xl font-bold text-white leading-tight break-words"
              style={{ textWrap: 'balance' }}
            >
              {winner.fullName}
            </h2>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base sm:text-xl font-mono text-amber-200 tabular-nums">
                <span>Employee #: {winner.employeeId}</span>
                {winner.division && (
                  <>
                    <span className="text-amber-400/50" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-sans font-semibold text-sky-200">{winner.division}</span>
                  </>
                )}
              </div>
              {winner.groups.length > 0 && (
                <div className="text-xs font-mono text-sky-300">{winner.groups.join(' · ')}</div>
              )}
              <div className="text-xs text-slate-400">{config.title}</div>
            </div>

            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={triggerExtravaganza}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-sky-300/45 bg-[#00477f] text-sky-50 text-sm font-semibold hover:bg-[#00599e] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Replay Fanfare</span>
              </button>

              <button
                type="button"
                onClick={handleCloseWinner}
                className="px-8 py-3 rounded-xl bg-amber-400 text-[#070B19] text-sm font-extrabold uppercase tracking-wide hover:bg-amber-300 transition-colors cursor-pointer"
              >
                Close &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
