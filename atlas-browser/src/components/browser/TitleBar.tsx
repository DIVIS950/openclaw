import type { MouseEvent } from "react";

/**
 * Custom draggable title bar with macOS-style traffic light buttons.
 * The entire bar is draggable; buttons are marked no-drag.
 */
export function TitleBar() {
  function handleClose(e: MouseEvent) {
    e.stopPropagation();
    window.electronAPI?.close();
  }

  function handleMinimize(e: MouseEvent) {
    e.stopPropagation();
    window.electronAPI?.minimize();
  }

  function handleMaximize(e: MouseEvent) {
    e.stopPropagation();
    window.electronAPI?.maximize();
  }

  return (
    <div
      className="title-bar"
      style={{
        height: 36,
        background: "var(--atlas-midnight)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        WebkitAppRegion: "drag",
        userSelect: "none",
        borderBottom: "1px solid var(--atlas-glass-border)",
      } as React.CSSProperties}
    >
      {/* Traffic lights */}
      <div
        className="traffic-lights"
        style={{
          position: "absolute",
          left: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        <TrafficLight color="#FF5F57" hoverColor="#E0443E" onClick={handleClose} label="Close" />
        <TrafficLight color="#FEBC2E" hoverColor="#D4A028" onClick={handleMinimize} label="Minimize" />
        <TrafficLight color="#28C840" hoverColor="#1AAB29" onClick={handleMaximize} label="Maximize" />
      </div>

      {/* Title */}
      <span
        style={{
          fontSize: "var(--atlas-text-sm)",
          fontWeight: "var(--atlas-weight-semibold)" as unknown as number,
          color: "var(--atlas-text-primary)",
          textShadow: "0 0 8px rgba(166, 255, 0, 0.2)",
          letterSpacing: "0.05em",
        }}
      >
        Atlas
      </span>
    </div>
  );
}

function TrafficLight({
  color,
  hoverColor,
  onClick,
  label,
}: {
  color: string;
  hoverColor: string;
  onClick: (e: MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = hoverColor;
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = color;
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: color,
        border: "none",
        cursor: "pointer",
        padding: 0,
        transition: "var(--atlas-transition-fast)",
      }}
    />
  );
}
