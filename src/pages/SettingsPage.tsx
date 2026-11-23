import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Dices,
  ExternalLink,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  addOrUpdateGuest,
  buildSpinnerKeyframes,
  bulkAdjustGuestGroups,
  bulkImportGuests,
  DEFAULT_CONFIG,
  deleteGuests,
  evalSpinnerRelativeSpeed,
  LIMITS,
  normalizeGroupList,
  resetWinners,
  restoreSingleWinner,
  saveSpinnerConfig,
  setGuestGroups,
  startWheelSpinTicks,
  unlockAudio,
  useSpinnerStore,
  type Guest,
  type SpinnerConfig,
  type WheelTickController,
} from '../store';

const SPINNER_PRESETS = [
  { id: 'balanced', label: 'Balanced Gala', duration: 6, cruise: 15, slowDown: 4.5 },
  { id: 'quick', label: 'Quick & Snappy', duration: 3.5, cruise: 10, slowDown: 2.5 },
  { id: 'hold-crawl', label: 'Hold Fast, Crawl Late', duration: 8, cruise: 45, slowDown: 8.5 },
  { id: 'dramatic', label: 'Long Dramatic Tail', duration: 12, cruise: 20, slowDown: 9.5 },
] as const;

const PREVIEW_SLICE_COLORS = [
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#0EA5E9',
  '#8B5CF6',
  '#EC4899',
  '#22C55E',
  '#3B82F6',
];

interface BulkGuestRow {
  fullName: string;
  employeeId: string;
  division: string;
  groups: string[];
}

export function SettingsPage() {
  const { guests, config } = useSpinnerStore();
  const [activeTab, setActiveTab] = useState<'timing' | 'guests'>('timing');

  const [singleName, setSingleName] = useState('');
  const [singleId, setSingleId] = useState('');
  const [singleDivision, setSingleDivision] = useState('');
  const [singleGroupsText, setSingleGroupsText] = useState('');

  const [bulkGuestsText, setBulkGuestsText] = useState('');
  const [bulkDefaultGroupsText, setBulkDefaultGroupsText] = useState('');
  const [bulkColumnMode, setBulkColumnMode] = useState<'4col' | '5col'>('4col');
  const [bulkSkipHeader, setBulkSkipHeader] = useState(true);
  const [bulkMergeExisting, setBulkMergeExisting] = useState(true);

  const [guestSearch, setGuestSearch] = useState('');
  const [guestGroupFilter, setGuestGroupFilter] = useState<string>('__all__');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAssignGroupInput, setBulkAssignGroupInput] = useState('');
  const [rowGroupDrafts, setRowGroupDrafts] = useState<Record<string, string>>({});
  const [confirmResetTarget, setConfirmResetTarget] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const [configDraft, setConfigDraft] = useState<SpinnerConfig>(config);
  const [configDirty, setConfigDirty] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const previewWheelRef = useRef<SVGSVGElement | null>(null);
  const previewAnimationRef = useRef<Animation | null>(null);
  const previewTicksRef = useRef<WheelTickController | null>(null);
  const previewRotationRef = useRef(0);
  const [isPreviewSpinning, setIsPreviewSpinning] = useState(false);

  useEffect(() => {
    if (!configDirty) {
      setConfigDraft(config);
    }
  }, [config, configDirty]);

  useEffect(() => {
    return () => {
      if (previewTicksRef.current) {
        previewTicksRef.current.stop();
        previewTicksRef.current = null;
      }
      if (previewAnimationRef.current) {
        previewAnimationRef.current.onfinish = null;
        previewAnimationRef.current.cancel();
        previewAnimationRef.current = null;
      }
    };
  }, []);

  const sortedGuests = [...guests].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const drawnWinners = sortedGuests.filter((g) => Boolean(g.wonPrizeAt));

  const groupSummaries = (() => {
    const map = new Map<
      string,
      { name: string; totalInPool: number; eligible: number; winners: number }
    >();
    for (const guest of sortedGuests) {
      for (const grp of guest.groups) {
        const key = grp.toLowerCase();
        const entry = map.get(key) ?? { name: grp, totalInPool: 0, eligible: 0, winners: 0 };
        entry.totalInPool += 1;
        if (guest.wonPrizeAt) entry.winners += 1;
        else entry.eligible += 1;
        map.set(key, entry);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const allExistingGroupNames = groupSummaries.map((g) => g.name);

  const parseCsvRecords = (input: string): string[][] => {
    const clean = input.replace(/^\uFEFF/, '');
    if (!clean.trim()) return [];

    // Support tab-delimited paste if tabs appear outside quotes and no commas exist on first line
    const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';

    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && clean[i + 1] === '\n') i += 1;
        row.push(field.trim());
        if (row.some((cell) => cell.length > 0)) {
          rows.push(row);
        }
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }

    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
    return rows;
  };

  const csvRecords = parseCsvRecords(bulkGuestsText);
  const ignoreCol3 = bulkColumnMode === '5col';

  const parseBulkGuestRows = (): {
    rows: BulkGuestRow[];
    skippedHeader: boolean;
    duplicates: string[];
  } => {
    const defaultGroups = normalizeGroupList(bulkDefaultGroupsText.split(','));
    const parsed: BulkGuestRow[] = [];
    const indexByEmpKey = new Map<string, number>();
    const duplicates: string[] = [];
    let skippedHeader = false;

    for (let idx = 0; idx < csvRecords.length; idx++) {
      const parts = csvRecords[idx];
      if (parts.length === 0) continue;

      // Skip common CSV header row (even when column A is blank, e.g. ",Name,DIV,Award Winner")
      if (idx === 0 && bulkSkipHeader) {
        const c0 = (parts[0] ?? "").trim().toLowerCase();
        const c1 = (parts[1] ?? "").trim().toLowerCase();
        const c2 = (parts[2] ?? "").trim().toLowerCase();
        const isCol0Header =
          c0 === "" ||
          c0 === "id" ||
          c0 === "#" ||
          c0 === "badge" ||
          c0.startsWith("emp");
        const isCol1Header =
          c1 === "name" ||
          c1 === "full name" ||
          c1 === "employee name" ||
          c1 === "emp name" ||
          c1 === "guest name";
        const isCol2Header =
          c2 === "div" || c2 === "division" || c2 === "dept" || c2 === "department";
        if (isCol0Header && (isCol1Header || isCol2Header)) {
          skippedHeader = true;
          continue;
        }
      }

      let employeeId = '';
      let fullName = '';
      let division = '';
      const rowGroups: string[] = [...defaultGroups];

      if (parts.length === 1) {
        fullName = (parts[0] ?? '').slice(0, LIMITS.MAX_FULL_NAME);
        employeeId = `GUEST-${parsed.length + 1}`;
      } else if (parts.length === 2) {
        employeeId = (parts[0] || `GUEST-${parsed.length + 1}`).slice(0, LIMITS.MAX_EMPLOYEE_ID);
        fullName = (parts[1] ?? '').slice(0, LIMITS.MAX_FULL_NAME);
      } else {
        employeeId = (parts[0] || `GUEST-${parsed.length + 1}`).slice(0, LIMITS.MAX_EMPLOYEE_ID);
        fullName = (parts[1] ?? '').slice(0, LIMITS.MAX_FULL_NAME);
        const divIdx = ignoreCol3 ? 3 : 2;
        const grpStartIdx = ignoreCol3 ? 4 : 3;
        division = (parts[divIdx] ?? '').slice(0, LIMITS.MAX_DIVISION);
        for (const extra of parts.slice(grpStartIdx)) {
          if (extra) rowGroups.push(...extra.split(/[;,|]/));
        }
      }

      if (!fullName) continue;
      const empKey = employeeId.toLowerCase();
      const existingIdx = indexByEmpKey.get(empKey);
      if (existingIdx !== undefined) {
        const existing = parsed[existingIdx];
        parsed[existingIdx] = {
          ...existing,
          division: existing.division || division,
          groups: normalizeGroupList([...existing.groups, ...rowGroups]),
        };
        duplicates.push(`${employeeId} (${fullName})`);
        continue;
      }

      indexByEmpKey.set(empKey, parsed.length);
      parsed.push({
        fullName,
        employeeId,
        division,
        groups: normalizeGroupList(rowGroups),
      });
    }
    return { rows: parsed, skippedHeader, duplicates };
  };

  const {
    rows: parsedBulkGuestRows,
    skippedHeader: bulkHeaderSkipped,
    duplicates: bulkDuplicateList,
  } = parseBulkGuestRows();

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setBulkGuestsText(text);
      setStatusMessage({
        type: 'info',
        text: `Loaded "${file.name}". Review the parsed preview below and click Import CSV to Spinner.`,
      });
    } catch {
      setStatusMessage({ type: 'error', text: 'Could not read the selected CSV file.' });
    }
  };

  const handleAddSingleGuest = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = singleName.trim().slice(0, LIMITS.MAX_FULL_NAME);
    const cleanId = singleId.trim().slice(0, LIMITS.MAX_EMPLOYEE_ID);
    const cleanDivision = singleDivision.trim().slice(0, LIMITS.MAX_DIVISION);
    if (!cleanName || !cleanId) {
      setStatusMessage({
        type: 'error',
        text: 'Enter both a Name and Employee # to add a guest to the Prize Spinner.',
      });
      return;
    }

    const result = addOrUpdateGuest(
      cleanName,
      cleanId,
      cleanDivision,
      singleGroupsText.split(',')
    );
    setSingleName('');
    setSingleId('');
    setSingleDivision('');
    setSingleGroupsText('');
    setStatusMessage({
      type: 'success',
      text:
        result === 'updated'
          ? `Updated ${cleanName} (${cleanId}) on the Prize Spinner pool.`
          : `Added ${cleanName} (${cleanId}) to the Prize Spinner.`,
    });
  };

  const handleBulkAddGuests = () => {
    if (parsedBulkGuestRows.length === 0) {
      setStatusMessage({
        type: 'error',
        text: 'No valid rows parsed. Upload or paste CSV rows: Emp #,Name,Division,Group (or 5-column Emp #,Name,Ignored,Division,Group).',
      });
      return;
    }

    const { created, updated, skipped } = bulkImportGuests(parsedBulkGuestRows, bulkMergeExisting);
    setBulkGuestsText('');
    setStatusMessage({
      type: 'success',
      text: `Spinner pool updated: ${created} added, ${updated} existing guest${
        updated === 1 ? '' : 's'
      } merged${skipped > 0 ? `, ${skipped} skipped` : ''}.`,
    });
  };

  const handleAddGroupToGuest = (guest: Guest) => {
    const draft = (rowGroupDrafts[guest.id] ?? '').trim();
    if (!draft) return;
    const next = normalizeGroupList([...guest.groups, ...draft.split(',')]);
    setRowGroupDrafts((prev) => ({ ...prev, [guest.id]: '' }));
    setGuestGroups(guest.id, next);
  };

  const handleRemoveGroupFromGuest = (guest: Guest, groupToRemove: string) => {
    const next = guest.groups.filter((g) => g.toLowerCase() !== groupToRemove.toLowerCase());
    setGuestGroups(guest.id, next);
  };

  const handleBulkGroupAction = (mode: 'add' | 'remove') => {
    const groupNames = normalizeGroupList(bulkAssignGroupInput.split(','));
    if (groupNames.length === 0 || selectedIds.length === 0) return;

    bulkAdjustGuestGroups(selectedIds, groupNames, mode);
    setBulkAssignGroupInput('');
    setStatusMessage({
      type: 'success',
      text: `${mode === 'add' ? 'Added' : 'Removed'} [${groupNames.join(', ')}] ${
        mode === 'add' ? 'to' : 'from'
      } ${selectedIds.length} guest${selectedIds.length === 1 ? '' : 's'}.`,
    });
  };

  const handleResetSpinnerWinners = (groupFilterName?: string) => {
    const count = resetWinners(groupFilterName);
    setConfirmResetTarget(null);
    if (count > 0) {
      setStatusMessage({
        type: 'success',
        text: groupFilterName
          ? `Reset ${count} drawn winner${count === 1 ? '' : 's'} in "${groupFilterName}".`
          : `Reset ${count} drawn winner${count === 1 ? '' : 's'}. All guests are back in the Prize Spinner pool.`,
      });
    }
  };

  const handleRestoreSingleWinner = (guest: Guest) => {
    restoreSingleWinner(guest.id);
    setStatusMessage({
      type: 'info',
      text: `Restored ${guest.fullName} to the eligible Prize Spinner pool.`,
    });
  };

  const handleDeleteSingleGuest = (guest: Guest) => {
    deleteGuests([guest.id]);
    setConfirmDeleteId(null);
    setSelectedIds((prev) => prev.filter((id) => id !== guest.id));
    setStatusMessage({
      type: 'info',
      text: `Removed ${guest.fullName} (${guest.employeeId}) from the spinner pool.`,
    });
  };

  const handleDeleteSelectedGuests = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    deleteGuests(selectedIds);
    setConfirmBulkDelete(false);
    setSelectedIds([]);
    setStatusMessage({
      type: 'info',
      text: `Deleted ${count} guest${count === 1 ? '' : 's'} from the spinner.`,
    });
  };

  const filteredGuests = sortedGuests.filter((g) => {
    if (guestGroupFilter === '__ungrouped__') {
      if (g.groups.length > 0) return false;
    } else if (guestGroupFilter !== '__all__') {
      if (!g.groups.some((grp) => grp.toLowerCase() === guestGroupFilter.toLowerCase())) {
        return false;
      }
    }

    if (!guestSearch.trim()) return true;
    const q = guestSearch.toLowerCase();
    return (
      g.fullName.toLowerCase().includes(q) ||
      g.employeeId.toLowerCase().includes(q) ||
      g.division.toLowerCase().includes(q) ||
      g.groups.some((grp) => grp.toLowerCase().includes(q))
    );
  });

  const updateDraftField = <K extends keyof SpinnerConfig>(field: K, value: SpinnerConfig[K]) => {
    setConfigDirty(true);
    setConfigDraft((prev) => ({ ...prev, [field]: value }));
  };

  const draftDurationSec = Math.max(
    2,
    Math.min(
      20,
      Number.isFinite(Number(configDraft.spinnerDurationSec))
        ? Math.round(Number(configDraft.spinnerDurationSec) * 10) / 10
        : DEFAULT_CONFIG.spinnerDurationSec
    )
  );
  const draftCruisePct = Math.max(
    0,
    Math.min(
      60,
      Number.isFinite(Number(configDraft.spinnerCruisePct))
        ? Math.round(Number(configDraft.spinnerCruisePct))
        : DEFAULT_CONFIG.spinnerCruisePct
    )
  );
  const draftSlowDown = Math.max(
    1,
    Math.min(
      10,
      Number.isFinite(Number(configDraft.spinnerSlowDown))
        ? Math.round(Number(configDraft.spinnerSlowDown) * 10) / 10
        : DEFAULT_CONFIG.spinnerSlowDown
    )
  );

  const runPreviewSpin = () => {
    const wheel = previewWheelRef.current;
    if (!wheel) return;

    if (previewTicksRef.current) {
      previewTicksRef.current.stop();
      previewTicksRef.current = null;
    }
    if (previewAnimationRef.current) {
      previewAnimationRef.current.onfinish = null;
      previewAnimationRef.current.cancel();
      previewAnimationRef.current = null;
    }

    const startAngle = ((previewRotationRef.current % 360) + 360) % 360;
    const extraSpins = Math.max(5, Math.round(draftDurationSec * 1.45)) * 360;
    const targetAngle = extraSpins + Math.round(Math.random() * 359);

    const keyframes = buildSpinnerKeyframes(
      startAngle,
      targetAngle,
      draftCruisePct,
      draftSlowDown,
      300
    );
    const anim = wheel.animate(keyframes, {
      duration: draftDurationSec * 1000,
      easing: 'linear',
      fill: 'forwards',
    });
    previewAnimationRef.current = anim;

    if (configDraft.pegSoundEnabled) {
      unlockAudio();
      previewTicksRef.current = startWheelSpinTicks({
        startAngle,
        targetAngle,
        durationSec: draftDurationSec,
        cruisePct: draftCruisePct,
        slowDown: draftSlowDown,
        numSegments: PREVIEW_SLICE_COLORS.length,
        muted: false,
      });
    }

    anim.onfinish = () => {
      if (previewTicksRef.current) {
        previewTicksRef.current.stop();
        previewTicksRef.current = null;
      }
      const settled = ((targetAngle % 360) + 360) % 360;
      previewRotationRef.current = settled;
      if (previewWheelRef.current) {
        previewWheelRef.current.style.transform = `translate3d(0px, 0px, 0px) rotate(${settled}deg)`;
      }
      anim.cancel();
      previewAnimationRef.current = null;
      setIsPreviewSpinning(false);
    };

    setIsPreviewSpinning(true);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = (configDraft.title || DEFAULT_CONFIG.title).trim().slice(0, 120);
    if (!cleanTitle) {
      setStatusMessage({ type: 'error', text: 'Spinner Header Label is required.' });
      return;
    }

    saveSpinnerConfig({
      title: cleanTitle,
      spinnerDurationSec: draftDurationSec,
      spinnerCruisePct: draftCruisePct,
      spinnerSlowDown: draftSlowDown,
      winningSoundEnabled: configDraft.winningSoundEnabled,
      pegSoundEnabled: configDraft.pegSoundEnabled,
      confettiEnabled: configDraft.confettiEnabled,
      rotationEnabled: configDraft.rotationEnabled,
    });
    setConfigDirty(false);
    setStatusMessage({ type: 'success', text: 'Spinner settings saved locally.' });
  };

  const eligibleAllCount = sortedGuests.filter((g) => !g.wonPrizeAt).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="text-xs font-semibold tracking-wider text-amber-300 uppercase mb-1">
            JMEG Events · Local Browser Storage
          </div>
          <h1 className="font-display text-4xl font-bold text-white">Spinner Settings</h1>
        </div>

        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-400 text-[#070B19] text-xs font-bold hover:bg-amber-300 transition-colors cursor-pointer whitespace-nowrap"
        >
          <Dices className="w-4 h-4" />
          <span>Open Prize Spinner ({eligibleAllCount} Eligible)</span>
        </Link>
      </div>

      {/* Section Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111833] border border-slate-800 rounded-xl w-fit">
        {[
          { id: 'timing', label: 'Timing & Display', icon: SettingsIcon },
          { id: 'guests', label: `Guests & Groups (${sortedGuests.length})`, icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                active ? 'bg-amber-400 text-[#070B19]' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl border text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-300'
              : statusMessage.type === 'error'
              ? 'bg-red-500/10 border-red-500/35 text-red-300'
              : 'bg-amber-500/10 border-amber-400/35 text-amber-200'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* TAB 1: SPINNER TIMING, HEADER & TEST WHEEL */}
      {activeTab === 'timing' &&
        (() => {
          const chartW = 320;
          const chartH = 112;
          const padX = 10;
          const padY = 12;
          const innerW = chartW - padX * 2;
          const innerH = chartH - padY * 2;
          const sampleCount = 48;

          const points = Array.from({ length: sampleCount + 1 }, (_, i) => {
            const t = i / sampleCount;
            const speed = evalSpinnerRelativeSpeed(t, draftCruisePct, draftSlowDown);
            const x = padX + t * innerW;
            const y = padY + (1 - speed) * innerH;
            return { x, y };
          });

          const linePath = points
            .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(' ');
          const areaPath = `${linePath} L ${(padX + innerW).toFixed(1)} ${(padY + innerH).toFixed(1)} L ${padX.toFixed(1)} ${(padY + innerH).toFixed(1)} Z`;

          const cruiseEndX = padX + (draftCruisePct / 100) * innerW;
          const cruiseSeconds = (draftDurationSec * draftCruisePct) / 100;
          const slowSeconds = draftDurationSec - cruiseSeconds;

          return (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <form
                onSubmit={handleSaveConfig}
                className="lg:col-span-7 bg-[#111833] border border-slate-800 rounded-2xl p-6 space-y-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">Prize Spinner Timing &amp; Title</h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Customize the header label shown above the wheel, spin length, and slow-down
                      tail curve.
                    </p>
                  </div>
                  {configDirty && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfigDraft(config);
                        setConfigDirty(false);
                      }}
                      className="text-xs text-slate-400 hover:text-white underline cursor-pointer shrink-0"
                    >
                      Discard Changes
                    </button>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="spinner-header-title"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Spinner Header Label
                  </label>
                  <input
                    id="spinner-header-title"
                    type="text"
                    required
                    maxLength={120}
                    value={configDraft.title}
                    onChange={(e) => updateDraftField('title', e.target.value)}
                    placeholder="JMEG Events"
                    className="w-full rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="text-xs font-semibold text-slate-300">Quick Curve Presets</div>
                  <div className="flex flex-wrap gap-2">
                    {SPINNER_PRESETS.map((preset) => {
                      const isSelected =
                        Math.abs(draftDurationSec - preset.duration) < 0.05 &&
                        Math.abs(draftCruisePct - preset.cruise) < 1 &&
                        Math.abs(draftSlowDown - preset.slowDown) < 0.05;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setConfigDirty(true);
                            setConfigDraft((prev) => ({
                              ...prev,
                              spinnerDurationSec: preset.duration,
                              spinnerCruisePct: preset.cruise,
                              spinnerSlowDown: preset.slowDown,
                            }));
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors whitespace-nowrap ${
                            isSelected
                              ? 'bg-[#00477f] border-sky-300/60 text-sky-50 font-semibold'
                              : 'bg-[#070B19] border-slate-700 text-slate-300 hover:border-amber-400/50'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="spinner-duration-range" className="text-sm font-semibold text-white">
                      Total Spin Duration
                    </label>
                    <span className="font-mono text-sm font-bold text-amber-300 tabular-nums">
                      {draftDurationSec.toFixed(1)}s
                    </span>
                  </div>
                  <input
                    id="spinner-duration-range"
                    type="range"
                    min={2}
                    max={20}
                    step={0.5}
                    value={draftDurationSec}
                    onChange={(e) => updateDraftField('spinnerDurationSec', Number(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                    <span>2.0s (Fast Draw)</span>
                    <span>11.0s</span>
                    <span>20.0s (Suspense Draw)</span>
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="spinner-cruise-range" className="text-sm font-semibold text-white">
                      Full-Speed Hold Before Braking
                    </label>
                    <span className="font-mono text-sm font-bold text-sky-300 tabular-nums">
                      {draftCruisePct}% ({cruiseSeconds.toFixed(1)}s)
                    </span>
                  </div>
                  <input
                    id="spinner-cruise-range"
                    type="range"
                    min={0}
                    max={60}
                    step={5}
                    value={draftCruisePct}
                    onChange={(e) => updateDraftField('spinnerCruisePct', Number(e.target.value))}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Controls how soon deceleration begins. At <strong className="text-slate-200">0%</strong>{' '}
                    the wheel begins slowing immediately; higher values hold top speed longer before
                    braking kicks in.
                  </p>
                </div>

                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between gap-4">
                    <label htmlFor="spinner-slowdown-range" className="text-sm font-semibold text-white">
                      End Slow-Down Tail Strength
                    </label>
                    <span className="font-mono text-sm font-bold text-amber-300 tabular-nums">
                      {draftSlowDown.toFixed(1)} / 10
                    </span>
                  </div>
                  <input
                    id="spinner-slowdown-range"
                    type="range"
                    min={1}
                    max={10}
                    step={0.5}
                    value={draftSlowDown}
                    onChange={(e) => updateDraftField('spinnerSlowDown', Number(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Higher values stretch the deceleration tail near the end so the wheel creeps
                    slowly to a stop.
                  </p>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800">
                  <div>
                    <div className="text-sm font-semibold text-white">Sound &amp; Celebration Effects</div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Choose which audio and visual effects run during spins and winner reveals.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        {
                          key: 'winningSoundEnabled',
                          label: 'Winning Sound',
                          desc: 'Audience clapping applause when landing on a winner.',
                        },
                        {
                          key: 'pegSoundEnabled',
                          label: 'Spinner Peg Sound',
                          desc: 'Game-show wooden peg clicks while spinning.',
                        },
                        {
                          key: 'confettiEnabled',
                          label: 'Confetti',
                          desc: 'Confetti cannons and falling star celebration.',
                        },
                        {
                          key: 'rotationEnabled',
                          label: 'Rotation',
                          desc: '360° stage and winner spotlight spin reveal.',
                        },
                      ] as const
                    ).map((item) => {
                      const enabled = configDraft[item.key];
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => updateDraftField(item.key, !enabled)}
                          className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                            enabled
                              ? 'bg-[#00477f]/45 border-sky-300/45 text-white'
                              : 'bg-[#070B19] border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white">{item.label}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                              {item.desc}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              enabled ? 'bg-amber-400' : 'bg-slate-700'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-[#070B19] transition-transform ${
                                enabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-lg bg-amber-400 text-[#070B19] text-sm font-bold hover:bg-amber-300 cursor-pointer"
                  >
                    Save Spinner Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfigDirty(true);
                      setConfigDraft((prev) => ({
                        ...prev,
                        spinnerDurationSec: DEFAULT_CONFIG.spinnerDurationSec,
                        spinnerCruisePct: DEFAULT_CONFIG.spinnerCruisePct,
                        spinnerSlowDown: DEFAULT_CONFIG.spinnerSlowDown,
                        winningSoundEnabled: DEFAULT_CONFIG.winningSoundEnabled,
                        pegSoundEnabled: DEFAULT_CONFIG.pegSoundEnabled,
                        confettiEnabled: DEFAULT_CONFIG.confettiEnabled,
                        rotationEnabled: DEFAULT_CONFIG.rotationEnabled,
                      }));
                    }}
                    className="px-4 py-3 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                  >
                    Reset Defaults
                  </button>
                </div>
              </form>

              {/* Live Speed Curve & Test Wheel Preview */}
              <div className="lg:col-span-5 bg-[#111833] border border-amber-400/25 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                    Live Speed Profile &amp; Test Spin
                  </div>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {draftDurationSec.toFixed(1)}s total
                  </span>
                </div>

                <div className="bg-[#070B19] border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Wheel Speed (%)</span>
                    <span className="font-mono text-sky-300">
                      {draftCruisePct > 0
                        ? `Braking starts @ ${cruiseSeconds.toFixed(1)}s`
                        : 'Immediate braking'}
                    </span>
                  </div>
                  <svg
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    className="w-full h-28 overflow-visible"
                    role="img"
                    aria-label="Spinner speed over time curve"
                  >
                    <defs>
                      <linearGradient id="spinnerSpeedFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00477f" stopOpacity="0.65" />
                        <stop offset="100%" stopColor="#00477f" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>
                    <line
                      x1={padX}
                      y1={padY + innerH}
                      x2={padX + innerW}
                      y2={padY + innerH}
                      stroke="#1E293B"
                      strokeWidth="1"
                    />
                    <line
                      x1={padX}
                      y1={padY + innerH * 0.5}
                      x2={padX + innerW}
                      y2={padY + innerH * 0.5}
                      stroke="#1E293B"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <path d={areaPath} fill="url(#spinnerSpeedFill)" />
                    {draftCruisePct > 0 && (
                      <line
                        x1={cruiseEndX}
                        y1={padY}
                        x2={cruiseEndX}
                        y2={padY + innerH}
                        stroke="#38BDF8"
                        strokeDasharray="4 3"
                        strokeWidth="1.25"
                      />
                    )}
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#FACC15"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="flex justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                    <span>0.0s (Peak)</span>
                    <span>{(draftDurationSec / 2).toFixed(1)}s</span>
                    <span>{draftDurationSec.toFixed(1)}s (Stop)</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-[#070B19] border border-slate-800 rounded-xl p-3">
                    <div className="text-slate-400">Peak-Speed Hold</div>
                    <div className="font-mono text-base font-bold text-sky-300 mt-0.5 tabular-nums">
                      {cruiseSeconds.toFixed(1)}s
                    </div>
                  </div>
                  <div className="bg-[#070B19] border border-slate-800 rounded-xl p-3">
                    <div className="text-slate-400">Slow-Down Window</div>
                    <div className="font-mono text-base font-bold text-amber-300 mt-0.5 tabular-nums">
                      {slowSeconds.toFixed(1)}s
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center pt-2 space-y-4 border-t border-slate-800">
                  <div className="relative">
                    <svg
                      ref={previewWheelRef}
                      viewBox="0 0 160 160"
                      className="w-40 h-40 rounded-full border-4 border-amber-400/70 shadow-lg"
                      style={{
                        willChange: 'transform',
                        backfaceVisibility: 'hidden',
                        contain: 'layout paint style',
                      }}
                    >
                      {PREVIEW_SLICE_COLORS.map((color, idx) => {
                        const sliceRad = (Math.PI * 2) / PREVIEW_SLICE_COLORS.length;
                        const a1 = idx * sliceRad - Math.PI / 2;
                        const a2 = (idx + 1) * sliceRad - Math.PI / 2;
                        const x1 = 80 + Math.cos(a1) * 80;
                        const y1 = 80 + Math.sin(a1) * 80;
                        const x2 = 80 + Math.cos(a2) * 80;
                        const y2 = 80 + Math.sin(a2) * 80;
                        return (
                          <path
                            key={idx}
                            d={`M 80 80 L ${x1} ${y1} A 80 80 0 0 1 ${x2} ${y2} Z`}
                            fill={color}
                            stroke="rgba(255, 255, 255, 0.32)"
                            strokeWidth="1"
                          />
                        );
                      })}
                    </svg>
                    <div
                      aria-hidden="true"
                      className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-r-[8px] border-t-[16px] border-l-transparent border-r-transparent border-t-amber-300"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={runPreviewSpin}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00477f] border border-sky-300/45 text-xs font-bold text-sky-50 hover:bg-[#00599e] cursor-pointer whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5 text-amber-300" />
                    <span>{isPreviewSpinning ? 'Restart Test Spin' : 'Test Spin Curve'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* TAB 2: GUESTS, GROUPINGS, BULK ADD & WINNER RESET */}
      {activeTab === 'guests' && (
        <div className="space-y-8">
          <datalist id="existing-group-suggestions">
            {allExistingGroupNames.map((grp) => (
              <option key={grp} value={grp} />
            ))}
          </datalist>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Add Single + Bulk Add Guests */}
            <div className="lg:col-span-6 bg-[#111833] border border-slate-800 rounded-2xl p-6 space-y-6">
              <form onSubmit={handleAddSingleGuest} className="space-y-3 border-b border-slate-800 pb-6">
                <div>
                  <h2 className="text-lg font-bold text-white">Add Guest to Spinner</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Add an individual participant with optional division and grouping labels.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    maxLength={LIMITS.MAX_EMPLOYEE_ID}
                    value={singleId}
                    onChange={(e) => setSingleId(e.target.value)}
                    placeholder="Employee #"
                    className="rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <input
                    type="text"
                    required
                    maxLength={LIMITS.MAX_FULL_NAME}
                    value={singleName}
                    onChange={(e) => setSingleName(e.target.value)}
                    placeholder="Employee Name"
                    className="rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <input
                    type="text"
                    maxLength={LIMITS.MAX_DIVISION}
                    value={singleDivision}
                    onChange={(e) => setSingleDivision(e.target.value)}
                    placeholder="Division (optional)"
                    className="rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    list="existing-group-suggestions"
                    value={singleGroupsText}
                    onChange={(e) => setSingleGroupsText(e.target.value)}
                    placeholder="Groupings (optional, comma-separated)"
                    className="flex-1 rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#00477f] border border-sky-300/40 text-xs font-bold text-sky-50 hover:bg-[#00599e] cursor-pointer whitespace-nowrap"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-amber-300" />
                    <span>Add Guest</span>
                  </button>
                </div>
              </form>

              {/* CSV Import / Bulk Add */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-white">CSV Import (Comma-Delimited)</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Upload a <code className="font-mono text-slate-200">.csv</code> file or paste
                      comma-separated rows:{' '}
                      <code className="font-mono text-slate-200">
                        Emp #,Name,Division,Group
                      </code>{' '}
                      (or 5-column{' '}
                      <code className="font-mono text-slate-200">
                        Emp #,Name,Ignored,Division,Group
                      </code>
                      ).
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00477f] border border-sky-300/45 text-xs font-bold text-sky-50 hover:bg-[#00599e] cursor-pointer whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5 text-amber-300" />
                    <span>Upload .csv</span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFileUpload}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div>
                  <label
                    htmlFor="bulk-default-groups"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Assign Extra Grouping(s) to All Imported Guests{' '}
                    <span className="text-slate-500 font-normal">(optional, comma-separated)</span>
                  </label>
                  <input
                    id="bulk-default-groups"
                    type="text"
                    value={bulkDefaultGroupsText}
                    onChange={(e) => setBulkDefaultGroupsText(e.target.value)}
                    placeholder="e.g. 5yr, Office Staff"
                    className="w-full rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  {allExistingGroupNames.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-[11px] text-slate-400">Quick add existing:</span>
                      {allExistingGroupNames.map((grp) => (
                        <button
                          key={grp}
                          type="button"
                          onClick={() => {
                            const current = normalizeGroupList(bulkDefaultGroupsText.split(','));
                            setBulkDefaultGroupsText(
                              normalizeGroupList([...current, grp]).join(', ')
                            );
                          }}
                          className="px-2 py-0.5 rounded bg-[#070B19] border border-slate-700 text-[11px] text-sky-300 hover:border-sky-300 cursor-pointer"
                        >
                          + {grp}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">CSV Column Format</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setBulkColumnMode('4col')}
                      className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        bulkColumnMode === '4col'
                          ? 'bg-[#00477f] border-sky-300/60 text-sky-50 font-semibold'
                          : 'bg-[#070B19] border-slate-700 text-slate-300 hover:border-amber-400/50'
                      }`}
                    >
                      4 Columns: Emp #, Name, Division, Group
                    </button>
                    <button
                      type="button"
                      onClick={() => setBulkColumnMode('5col')}
                      className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        bulkColumnMode === '5col'
                          ? 'bg-[#00477f] border-sky-300/60 text-sky-50 font-semibold'
                          : 'bg-[#070B19] border-slate-700 text-slate-300 hover:border-amber-400/50'
                      }`}
                    >
                      5 Columns: Emp #, Name, [Ignore Col 3], Division, Group
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="bulk-guests-textarea"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Paste CSV Rows
                  </label>
                  <textarea
                    id="bulk-guests-textarea"
                    rows={5}
                    value={bulkGuestsText}
                    onChange={(e) => setBulkGuestsText(e.target.value)}
                    placeholder={
                      'J01818,Ignacio Ramirez,Division 3,20yr\nj04475,Tamela Edwards,Office Staff,'
                    }
                    className="w-full rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkSkipHeader}
                        onChange={(e) => setBulkSkipHeader(e.target.checked)}
                        className="w-4 h-4 accent-amber-400 rounded cursor-pointer"
                      />
                      <span>Skip header row</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkMergeExisting}
                        onChange={(e) => setBulkMergeExisting(e.target.checked)}
                        className="w-4 h-4 accent-amber-400 rounded cursor-pointer"
                      />
                      <span>If Employee # exists, update division &amp; merge groupings</span>
                    </label>
                  </div>
                </div>

                {parsedBulkGuestRows.length > 0 && (
                  <div className="bg-[#070B19] border border-slate-800 rounded-xl p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-amber-300 tabular-nums">
                        Ready to import: {parsedBulkGuestRows.length} unique guest
                        {parsedBulkGuestRows.length === 1 ? '' : 's'}
                        {bulkHeaderSkipped ? ' · header skipped' : ''}
                      </span>
                      {bulkDuplicateList.length > 0 && (
                        <span className="text-[11px] text-sky-300 tabular-nums">
                          {bulkDuplicateList.length} duplicate ID
                          {bulkDuplicateList.length === 1 ? '' : 's'} merged
                        </span>
                      )}
                    </div>
                    {bulkDuplicateList.length > 0 && (
                      <div className="text-[11px] text-slate-400 leading-relaxed">
                        Duplicate Employee #s in CSV (kept once with merged groups):{' '}
                        <span className="font-mono text-slate-300">
                          {bulkDuplicateList.join(', ')}
                        </span>
                      </div>
                    )}
                    <div className="max-h-44 overflow-y-auto text-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="text-[11px] text-slate-500 border-b border-slate-800">
                            <th className="py-1 pr-2 font-medium">Emp #</th>
                            <th className="py-1 pr-2 font-medium">Name</th>
                            <th className="py-1 pr-2 font-medium">Division</th>
                            <th className="py-1 font-medium">Group</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {parsedBulkGuestRows.slice(0, 50).map((row) => (
                            <tr key={row.employeeId} className="text-slate-300">
                              <td className="py-1 pr-2 font-mono text-amber-300 whitespace-nowrap">
                                {row.employeeId}
                              </td>
                              <td className="py-1 pr-2 font-semibold text-white truncate max-w-[140px]">
                                {row.fullName}
                              </td>
                              <td className="py-1 pr-2 text-slate-300 truncate max-w-[130px]">
                                {row.division || '—'}
                              </td>
                              <td className="py-1 font-mono text-[11px] text-sky-300 truncate max-w-[110px]">
                                {row.groups.length > 0 ? row.groups.join(', ') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsedBulkGuestRows.length > 50 && (
                        <div className="text-[11px] text-slate-500 pt-1">
                          + {parsedBulkGuestRows.length - 50} more rows...
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={parsedBulkGuestRows.length === 0}
                  onClick={handleBulkAddGuests}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-amber-400 text-[#070B19] text-sm font-bold hover:bg-amber-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Users className="w-4 h-4" />
                  <span>Import CSV to Spinner ({parsedBulkGuestRows.length})</span>
                </button>
              </div>
            </div>

            {/* Right Column: Group Spinners & Winner Reset */}
            <div className="lg:col-span-6 bg-[#111833] border border-amber-400/25 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                    Spinner Pools &amp; Reset
                  </div>
                  <h2 className="text-lg font-bold text-white mt-0.5">
                    Group Spinners &amp; Winner Reset
                  </h2>
                </div>

                {confirmResetTarget === '__guests_all__' ? (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-400/40 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-red-200 font-semibold">
                      Reset {drawnWinners.length}?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleResetSpinnerWinners()}
                      className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-bold hover:bg-red-400 cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmResetTarget(null)}
                      className="text-xs text-slate-300 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={drawnWinners.length === 0}
                    onClick={() => setConfirmResetTarget('__guests_all__')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#070B19] border border-amber-400/45 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-[#070B19] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All Drawn ({drawnWinners.length})</span>
                  </button>
                )}
              </div>

              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                <div className="flex items-center justify-between gap-3 bg-[#070B19] border border-amber-400/35 rounded-xl px-4 py-3">
                  <div>
                    <div className="text-sm font-bold text-white">All Guests</div>
                    <div className="text-xs font-mono text-slate-400 tabular-nums">
                      {eligibleAllCount} eligible of {sortedGuests.length} total
                    </div>
                  </div>
                  <Link
                    to="/"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-400 text-[#070B19] text-xs font-bold hover:bg-amber-300 whitespace-nowrap"
                  >
                    <Dices className="w-3.5 h-3.5" />
                    <span>Open Spinner</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>

                {groupSummaries.length === 0 ? (
                  <div className="text-xs text-slate-400 py-5 text-center border border-dashed border-slate-800 rounded-xl">
                    No groupings created yet. Add any custom grouping attribute (department, table,
                    tier, etc.) to guests below to launch group-filtered spinners.
                  </div>
                ) : (
                  groupSummaries.map((grp) => (
                    <div
                      key={grp.name}
                      className="flex flex-wrap items-center justify-between gap-3 bg-[#070B19] border border-slate-800 rounded-xl px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-sky-200 truncate flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                          <span>{grp.name}</span>
                        </div>
                        <div className="text-xs font-mono text-slate-400 tabular-nums">
                          {grp.eligible} eligible · {grp.totalInPool} total
                          {grp.winners > 0 ? ` · ${grp.winners} won` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {grp.winners > 0 && (
                          <button
                            type="button"
                            onClick={() => handleResetSpinnerWinners(grp.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-amber-300 hover:border-amber-400 cursor-pointer whitespace-nowrap"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Reset ({grp.winners})</span>
                          </button>
                        )}
                        <Link
                          to={`/?group=${encodeURIComponent(grp.name)}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#00477f] border border-sky-300/45 text-xs font-bold text-sky-50 hover:bg-[#00599e] whitespace-nowrap"
                        >
                          <Dices className="w-3.5 h-3.5 text-amber-300" />
                          <span>Pull Up Spinner</span>
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {drawnWinners.length > 0 && (
                <div className="border-t border-slate-800 pt-4 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Recently Drawn Winners ({drawnWinners.length})
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {drawnWinners.map((w) => (
                      <div
                        key={w.id}
                        className="inline-flex items-center gap-2 bg-[#070B19] border border-slate-800 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <span className="font-semibold text-white">{w.fullName}</span>
                        <span className="font-mono text-slate-400">{w.employeeId}</span>
                        <button
                          type="button"
                          onClick={() => handleRestoreSingleWinner(w)}
                          className="text-amber-300 hover:text-amber-200 underline cursor-pointer ml-1"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Guest Roster, Custom Groupings & Deletion */}
          <div className="bg-[#111833] border border-slate-800 rounded-2xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Spinner Guest Roster &amp; Groupings ({filteredGuests.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Search participants, assign custom grouping labels, or delete guests from the
                  spinner.
                </p>
              </div>

              {guestGroupFilter !== '__all__' && guestGroupFilter !== '__ungrouped__' && (
                <Link
                  to={`/?group=${encodeURIComponent(guestGroupFilter)}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00477f] border border-sky-300/45 text-xs font-bold text-sky-50 hover:bg-[#00599e] whitespace-nowrap"
                >
                  <Dices className="w-3.5 h-3.5 text-amber-300" />
                  <span>Open &ldquo;{guestGroupFilter}&rdquo; Spinner</span>
                </Link>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={guestSearch}
                  onChange={(e) => setGuestSearch(e.target.value)}
                  placeholder="Search guests by name, ID, or grouping..."
                  className="w-full rounded-lg bg-[#070B19] border border-slate-700 pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <select
                aria-label="Filter guests by grouping"
                value={guestGroupFilter}
                onChange={(e) => setGuestGroupFilter(e.target.value)}
                className="rounded-lg bg-[#070B19] border border-slate-700 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
              >
                <option value="__all__">All Groups ({sortedGuests.length})</option>
                {groupSummaries.map((grp) => (
                  <option key={grp.name} value={grp.name}>
                    {grp.name} ({grp.totalInPool})
                  </option>
                ))}
                <option value="__ungrouped__">Ungrouped Only</option>
              </select>
            </div>

            {filteredGuests.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#070B19] border border-slate-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const visibleIds = filteredGuests.map((g) => g.id);
                      const allSelected = visibleIds.every((id) => selectedIds.includes(id));
                      if (allSelected) {
                        setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
                      } else {
                        setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
                      }
                    }}
                    className="text-amber-300 hover:text-amber-200 font-semibold cursor-pointer"
                  >
                    {filteredGuests.every((g) => selectedIds.includes(g.id))
                      ? 'Deselect Visible'
                      : 'Select All Visible'}
                  </button>
                  <span className="text-slate-500 font-mono tabular-nums">
                    {selectedIds.length} selected
                  </span>
                  {selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIds([]);
                        setConfirmBulkDelete(false);
                      }}
                      className="text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    list="existing-group-suggestions"
                    value={bulkAssignGroupInput}
                    onChange={(e) => setBulkAssignGroupInput(e.target.value)}
                    placeholder="Grouping name(s), comma-separated..."
                    className="rounded-lg bg-[#111833] border border-slate-700 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 w-52"
                  />
                  <button
                    type="button"
                    disabled={selectedIds.length === 0 || !bulkAssignGroupInput.trim()}
                    onClick={() => handleBulkGroupAction('add')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#00477f] border border-sky-300/45 text-xs font-semibold text-sky-50 hover:bg-[#00599e] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Group</span>
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.length === 0 || !bulkAssignGroupInput.trim()}
                    onClick={() => handleBulkGroupAction('remove')}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:text-red-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    Remove Group
                  </button>

                  {confirmBulkDelete && selectedIds.length > 0 ? (
                    <div className="inline-flex items-center gap-2 bg-red-500/15 border border-red-400/50 rounded-lg px-2.5 py-1">
                      <span className="text-xs font-semibold text-red-200 whitespace-nowrap">
                        Delete {selectedIds.length}?
                      </span>
                      <button
                        type="button"
                        onClick={handleDeleteSelectedGuests}
                        className="px-2.5 py-0.5 rounded bg-red-500 text-white text-xs font-bold hover:bg-red-400 cursor-pointer"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmBulkDelete(false)}
                        className="text-xs text-slate-300 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={() => setConfirmBulkDelete(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs font-semibold text-red-300 hover:bg-red-500/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Selected</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {filteredGuests.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                {sortedGuests.length === 0
                  ? 'No guests in the spinner pool yet. Use Add Guest or Bulk Add above.'
                  : 'No guests match this search or grouping filter.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-800 max-h-[560px] overflow-y-auto pr-1">
                {filteredGuests.map((guest) => {
                  const isSelected = selectedIds.includes(guest.id);
                  const draftValue = rowGroupDrafts[guest.id] ?? '';
                  const isConfirmingDelete = confirmDeleteId === guest.id;

                  return (
                    <div
                      key={guest.id}
                      className="py-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds((prev) => [...prev, guest.id]);
                            } else {
                              setSelectedIds((prev) => prev.filter((id) => id !== guest.id));
                            }
                          }}
                          aria-label={`Select ${guest.fullName}`}
                          className="mt-1 w-4 h-4 accent-amber-400 rounded cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">{guest.fullName}</span>
                            <span className="text-xs font-mono text-amber-300 tabular-nums">
                              {guest.employeeId}
                            </span>
                            {guest.division && (
                              <span className="text-xs text-slate-300">· {guest.division}</span>
                            )}
                            {guest.wonPrizeAt && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                                · Won Prize
                                <button
                                  type="button"
                                  onClick={() => handleRestoreSingleWinner(guest)}
                                  className="text-amber-300 hover:text-amber-200 underline cursor-pointer"
                                >
                                  Reset
                                </button>
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {guest.groups.length === 0 ? (
                              <span className="text-[11px] text-slate-500">No groupings</span>
                            ) : (
                              guest.groups.map((grp) => (
                                <span
                                  key={grp}
                                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-[#00477f]/65 border border-sky-300/35 text-sky-100"
                                >
                                  <span>{grp}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveGroupFromGuest(guest, grp)}
                                    aria-label={`Remove ${grp} from ${guest.fullName}`}
                                    className="text-sky-200 hover:text-red-300 cursor-pointer"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pl-7 xl:pl-0 shrink-0">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleAddGroupToGuest(guest);
                          }}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            list="existing-group-suggestions"
                            value={draftValue}
                            onChange={(e) =>
                              setRowGroupDrafts((prev) => ({
                                ...prev,
                                [guest.id]: e.target.value,
                              }))
                            }
                            placeholder="Add grouping..."
                            maxLength={LIMITS.MAX_GROUP_NAME}
                            className="rounded-lg bg-[#070B19] border border-slate-700 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 w-40"
                          />
                          <button
                            type="submit"
                            disabled={!draftValue.trim()}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00477f] border border-sky-300/40 text-xs font-semibold text-sky-50 hover:bg-[#00599e] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add</span>
                          </button>
                        </form>

                        {isConfirmingDelete ? (
                          <div className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-400/50 rounded-lg px-2.5 py-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteSingleGuest(guest)}
                              className="px-2 py-0.5 rounded bg-red-500 text-white text-xs font-bold hover:bg-red-400 cursor-pointer whitespace-nowrap"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-slate-300 hover:text-white cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(guest.id)}
                            aria-label={`Delete ${guest.fullName}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold text-red-300 hover:border-red-400/60 hover:bg-red-500/10 cursor-pointer whitespace-nowrap"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
