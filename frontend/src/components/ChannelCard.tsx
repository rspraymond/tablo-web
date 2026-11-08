import { useMemo } from "react";
import type { GuideChannel } from "../api/tablo";
import { episodeLabel, badgesFor, type Badge } from "../lib/filters";

interface Props {
  channel: GuideChannel;
  now: number;
  onClick: () => void;
}

function BadgeChip({ badge }: { badge: Badge }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        badge.kind === "live" ? "bg-accent text-white" : "bg-white/10 text-white/60"
      }`}
    >
      {badge.label}
    </span>
  );
}

export function ChannelCard({ channel, now, onClick }: Props) {
  const program = channel.current_program;
  const next = channel.next_program;
  const line = episodeLabel(program);
  const badges = badgesFor(channel);

  // Calculate progress
  const progress = useMemo(() => {
    if (!program) return 0;
    const start = new Date(program.start).getTime();
    return Math.max(0, Math.min(100, ((now - start) / (program.duration * 1000)) * 100));
  }, [program, now]);

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col rounded-xl overflow-hidden
                 bg-surface-raised border border-surface-border
                 hover:border-accent/40 hover:channel-glow
                 transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-accent/50"
    >
      <div className="flex p-5 gap-5 items-start">
        {/* Logo/Badge container */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div className="w-16 h-12 flex items-center justify-center bg-black/20 rounded-lg p-1.5 border border-white/5">
            {channel.logo_url ? (
              <img src={channel.logo_url} alt={channel.call_sign} className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-xs font-bold text-white/40">{channel.call_sign}</span>
            )}
          </div>
          <span className="text-[10px] font-black tracking-tighter text-white/30 uppercase">
            {channel.major > 0 ? `${channel.major}.${channel.minor}` : "OTT"}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="flex-1 min-w-0 text-sm font-bold text-white/90 truncate">
              {program?.title || "No Information"}
            </p>
            {badges.map(b => <BadgeChip key={b.kind} badge={b} />)}
          </div>
          {line && (
            <p className="text-xs font-semibold text-accent/90 truncate">{line}</p>
          )}
          <p className="mt-1 text-xs text-white/40 line-clamp-2 leading-relaxed h-8">
            {program?.description || `Watching ${channel.display_name}`}
          </p>

          {/* Progress bar */}
          {program && (
            <div className="mt-3">
              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] font-medium text-white/20 uppercase tracking-widest">
                <span>{new Date(program.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                <span>{Math.round(program.duration / 60)}m</span>
              </div>
            </div>
          )}

          {/* What's next */}
          {next && (
            <p className="mt-3 text-[10px] font-medium text-white/20 uppercase tracking-widest truncate">
              Next {new Date(next.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {next.title}
            </p>
          )}
        </div>
      </div>

      {/* Overlay play button on hover */}
      <div className="absolute inset-0 bg-accent/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
         <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
           <svg className="w-6 h-6 text-white translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
             <path d="M8 5v14l11-7z" />
           </svg>
         </div>
      </div>
    </button>
  );
}
