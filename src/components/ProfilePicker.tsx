import { PROFILES, PROFILE_ORDER } from "../engine/profiles";
import type { ProfileId } from "../engine/types";

export function ProfilePicker({ value, onChange }: { value: ProfileId; onChange: (p: ProfileId) => void }) {
  return (
    <>
      <h2 className="section-title">Compression</h2>
      <div className="group" role="radiogroup" aria-label="Compression profile">
        {PROFILE_ORDER.map((id) => {
          const p = PROFILES[id];
          const selected = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`choice${selected ? " selected" : ""}`}
              onClick={() => onChange(id)}
            >
              <span className="choice-text">
                <span className="choice-title">
                  {p.label}
                  {id === "balanced" && <span className="tag tag-accent">Recommended</span>}
                </span>
                <span className="choice-sub">{p.summary}</span>
              </span>
              <span className="check" aria-hidden="true">
                {selected ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
