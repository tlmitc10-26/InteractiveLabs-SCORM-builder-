"use client";

// Light, zod-free import on purpose (mirrors editor.tsx's own rationale):
// runtime-config.ts pulls in only @/lib/design/tokens, never schema.ts's
// zod/sanitize-html/formula-parser weight. This is a client component whose
// bundle chunk must stay free of that weight — verified by grepping the
// built route chunk for "sanitize-html" (see Task 7 verification).
import { useRef, useState } from "react";
import { RDS_COLOR_NAMES, colorHex } from "@/lib/design/tokens";
import { contrastRatio, meetsNonText, ratioLabel } from "@/lib/design/contrast";
import { toDisplayColorRef, resolveColorHex, type ColorRef } from "@/lib/engines/param-sandbox/runtime-config";

const hexPattern = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ value, backgroundHex, imagePresent, onChange }: {
  value: ColorRef;
  backgroundHex: string;
  imagePresent: boolean;
  onChange: (v: ColorRef) => void;
}) {
  // Defensive normalization: `value`'s declared type is ColorRef, but a
  // mid-edit draft loaded from storage without validation can in practice
  // still carry a bare legacy hex string (schema.ts's colorRefSchema
  // migrates that shape at *save* time, not before). toDisplayColorRef
  // wraps that case into `{hex}` so nothing below ever does `"token" in`
  // on a raw string.
  const normalized = toDisplayColorRef(value);
  const currentHex = resolveColorHex(normalized);
  const selectedToken = "token" in normalized ? normalized.token : undefined;
  const selectedIndex = selectedToken ? RDS_COLOR_NAMES.indexOf(selectedToken) : -1;
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [detailsOpen, setDetailsOpen] = useState(() => selectedToken === undefined);

  const selectToken = (index: number, focusButton: boolean) => {
    onChange({ token: RDS_COLOR_NAMES[index] });
    if (focusButton) btnRefs.current[index]?.focus();
  };

  const handleSwatchKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": next = (index + 1) % RDS_COLOR_NAMES.length; break;
      case "ArrowLeft": case "ArrowUp": next = (index - 1 + RDS_COLOR_NAMES.length) % RDS_COLOR_NAMES.length; break;
      case "Home": next = 0; break;
      case "End": next = RDS_COLOR_NAMES.length - 1; break;
      default: return;
    }
    e.preventDefault();
    selectToken(next, true);
  };

  const ratio = contrastRatio(currentHex, backgroundHex);
  const passes = meetsNonText(ratio);

  return (
    <div>
      <div role="radiogroup" aria-label="Fill color" className="grid grid-cols-8 gap-1">
        {RDS_COLOR_NAMES.map((name, i) => {
          const hex = colorHex(name);
          const swatchRatio = contrastRatio(hex, backgroundHex);
          const checked = selectedToken === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${name}, contrast ${ratioLabel(swatchRatio)}`}
              tabIndex={i === tabbableIndex ? 0 : -1}
              ref={(el) => { btnRefs.current[i] = el; }}
              onClick={() => selectToken(i, false)}
              onKeyDown={(e) => handleSwatchKeyDown(e, i)}
              className="rds-swatch-btn"
            >
              <span aria-hidden="true" className={`rds-swatch-swab${checked ? " is-selected" : ""}`} style={{ background: hex }} />
              <span className="rds-swatch-caption">{name}</span>
            </button>
          );
        })}
      </div>

      <details open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)} className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-gray-600">Custom color (for college brand requirements)</summary>
        {/* Keyed on the currently-resolved hex: whenever the color in effect
            changes from OUTSIDE this subtree (a token swatch pick, or a
            parent-level reset), the key changes and React remounts these
            controls with a fresh initial draft — the standard "reset state
            when an external value changes" pattern, so no ref-in-render or
            setState-in-effect is needed to keep the draft in sync. A valid
            keystroke inside this subtree also changes `currentHex` (via
            onChange round-tripping through the parent), remounting the
            inputs to the same value the user just typed — a no-op from the
            user's perspective. */}
        <CustomHexControls key={currentHex} initialHex={currentHex} onChange={(hex) => onChange({ hex })} />
      </details>

      {imagePresent ? (
        <p className="mt-2 text-xs text-gray-600">
          Placed over an image — verify it reads clearly; the numeric readout guarantees meaning.
        </p>
      ) : passes ? (
        <p className="mt-2 text-xs" style={{ color: "var(--rds-success)" }}>
          Passes contrast — {ratioLabel(ratio)} against the stage background (needs 3:1 or better).
        </p>
      ) : (
        <p className="mt-2 text-xs font-medium" style={{ color: "var(--rds-danger)" }}>
          fails 3:1 contrast against the stage background ({ratioLabel(ratio)}) — pick a stronger color
        </p>
      )}
    </div>
  );
}

/** The hex text input + native color picker, kept in sync with each other
 *  through shared local state. Remounted (via the `key` on the call site
 *  above) whenever the externally-resolved color changes, so it never needs
 *  an effect to resync — see the comment at that call site. */
function CustomHexControls({ initialHex, onChange }: { initialHex: string; onChange: (hex: string) => void }) {
  const [hexDraft, setHexDraft] = useState(initialHex);

  const handleTextInput = (raw: string) => {
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (hexPattern.test(trimmed)) onChange(trimmed.toLowerCase());
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        aria-label="Custom color hex value"
        placeholder="#rrggbb"
        value={hexDraft}
        onChange={(e) => handleTextInput(e.target.value)}
        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
      />
      <input
        type="color"
        aria-label="Custom color picker"
        value={hexPattern.test(hexDraft) ? hexDraft : initialHex}
        onChange={(e) => { setHexDraft(e.target.value); onChange(e.target.value); }}
        className="h-8 w-8 cursor-pointer rounded border border-gray-300"
      />
    </div>
  );
}
