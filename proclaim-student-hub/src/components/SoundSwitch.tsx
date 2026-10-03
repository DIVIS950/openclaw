import { useState } from "react";
import { play, sound } from "../lab/fx.ts";

/** The Revision Lab sounds on or off; an iOS-style row. */
export function SoundSwitch({ row = false }: { row?: boolean }) {
  const [on, setOn] = useState(sound.on);
  const input = (
    <input
      type="checkbox"
      role="switch"
      checked={on}
      onChange={(e) => {
        sound.set(e.target.checked);
        setOn(e.target.checked);
        if (e.target.checked) {
          play("right");
        }
      }}
      aria-label="Sounds"
    />
  );
  if (row) {
    return (
      <label className="ios-row plain" style={{ cursor: "pointer" }}>
        <span style={{ flex: 1 }}>Sounds</span>
        {input}
      </label>
    );
  }
  return (
    <label className="card between" style={{ cursor: "pointer" }}>
      <span className="stack" style={{ gap: 2 }}>
        <strong>Sounds</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          Little sounds for right, wrong and streaks
        </span>
      </span>
      {input}
    </label>
  );
}
