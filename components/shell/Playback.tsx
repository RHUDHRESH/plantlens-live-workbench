"use client";

import { Pause, Play, SkipForward, StepForward } from "lucide-react";
import { Button, Select, Tip } from "@/components/ui";
import { useApp } from "@/store/app";
import { formatDuration } from "@/lib/util";

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32];

export function Playback({ compact }: { compact?: boolean }) {
  const snapshot = useApp((s) => s.snapshot);
  const play = useApp((s) => s.play);
  const pause = useApp((s) => s.pause);
  const setSpeed = useApp((s) => s.setSpeed);
  const seek = useApp((s) => s.seek);
  const stepOnce = useApp((s) => s.stepOnce);
  if (!snapshot) return null;
  const { clock } = snapshot;
  const running = clock.running;
  const min = Number.isFinite(snapshot.stats.earliestMs) ? snapshot.stats.earliestMs : clock.startMs;
  const max = clock.liveMs;
  const range = Math.max(1, max - min);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Playback">
      <Button size="sm" variant="ghost" onClick={running ? pause : play} aria-label={running ? "Pause" : "Play"}>
        {running ? <Pause size={14} /> : <Play size={14} />}
      </Button>
      <Tip content="Advance one simulation step (1 s)">
        <Button size="sm" variant="ghost" onClick={stepOnce} aria-label="Step one second" disabled={running}>
          <StepForward size={14} />
        </Button>
      </Tip>
      {clock.viewingPast ? (
        <Tip content="Jump to the live edge">
          <Button size="sm" variant="ghost" onClick={() => seek(max)} aria-label="Jump to live">
            <SkipForward size={14} />
          </Button>
        </Tip>
      ) : null}
      <Select aria-label="Playback speed" value={String(clock.speed)} onChange={(e) => setSpeed(Number(e.target.value))} className="h-7 text-[12px]">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </Select>
      {!compact && (
        <label className="hidden items-center gap-1.5 text-[11px] text-muted xl:flex">
          <span className="mono">−{formatDuration(max - clock.cursorMs)}</span>
          <input type="range" min={0} max={1000} value={Math.round(((clock.cursorMs - min) / range) * 1000)} onChange={(e) => seek(min + (Number(e.target.value) / 1000) * range)} aria-label="Observation cursor" className="w-28 accent-[var(--accent)]" />
          <span className="mono">{formatDuration(max - min)} recorded</span>
        </label>
      )}
    </div>
  );
}
