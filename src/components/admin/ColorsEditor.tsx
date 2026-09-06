import { Plus, X } from "lucide-react";

export interface ColorInput {
  name: string;
  hex: string;
}

export function ColorsEditor({
  colors,
  onChange,
}: {
  colors: ColorInput[];
  onChange: (colors: ColorInput[]) => void;
}) {
  function update(i: number, patch: Partial<ColorInput>) {
    onChange(colors.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-2.5">
      {colors.map((c, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <input
            type="color"
            value={c.hex}
            onChange={(e) => update(i, { hex: e.target.value })}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-ink-950/10 p-1"
          />
          <input
            value={c.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Colour name (e.g. Midnight)"
            className="input flex-1"
          />
          <button
            type="button"
            onClick={() => onChange(colors.filter((_, idx) => idx !== i))}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ink-950/10 text-ink-950/40 hover:border-rose-300 hover:text-rose-600"
            aria-label="Remove colour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...colors, { name: "", hex: "#5b21f2" }])}
        className="flex items-center gap-2 rounded-full border border-dashed border-ink-950/20 px-4 py-2 text-sm font-bold text-ink-950/60 hover:border-brand-300 hover:text-brand-600"
      >
        <Plus className="h-4 w-4" /> Add Colour
      </button>
    </div>
  );
}
