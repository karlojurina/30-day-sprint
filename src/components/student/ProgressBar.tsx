"use client";

interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
  size?: "sm" | "md";
}

export function ProgressBar({ value, label, size = "md" }: ProgressBarProps) {
  const height = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between text-xs text-text-secondary">
          <span>{label}</span>
          <span>{value}%</span>
        </div>
      )}
      <div className={`w-full ${height} bg-bg-elevated rounded-full overflow-hidden`}>
        <div
          className={`${height} bg-accent rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}
