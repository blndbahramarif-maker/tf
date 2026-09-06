import { Plus, X } from "lucide-react";

export interface StorageOptionInput {
  label: string;
  priceDelta: string;
  stock: string;
}

export function StorageOptionsEditor({
  options,
  onChange,
}: {
  options: StorageOptionInput[];
  onChange: (options: StorageOptionInput[]) => void;
}) {
  function update(i: number, patch: Partial<StorageOptionInput>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  return (
    <div className="space-y-2.5">
      {options.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2.5 px-1 text-xs font-bold uppercase tracking-wide text-ink-950/40">
          <span>Storage</span>
          <span>Price Adjustment</span>
          <span>Stock</span>
          <span />
        </div>
      )}
      {options.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2.5">
          <input
            value={o.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="e.g. 128GB"
            className="input"
          />
          <input
            type="number"
            step="0.01"
            value={o.priceDelta}
            onChange={(e) => update(i, { priceDelta: e.target.value })}
            placeholder="0.00"
            className="input"
          />
          <input
            type="number"
            min="0"
            value={o.stock}
            onChange={(e) => update(i, { stock: e.target.value })}
            placeholder="0"
            className="input"
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-950/10 text-ink-950/40 hover:border-rose-300 hover:text-rose-600"
            aria-label="Remove storage option"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, { label: "", priceDelta: "0", stock: "0" }])}
        className="flex items-center gap-2 rounded-full border border-dashed border-ink-950/20 px-4 py-2 text-sm font-bold text-ink-950/60 hover:border-brand-300 hover:text-brand-600"
      >
        <Plus className="h-4 w-4" /> Add Storage Option
      </button>
      <p className="text-xs text-ink-950/40">
        Price adjustment is added to the base price for this option (use 0 for the base option). When storage
        options are set, stock is tracked per option instead of the overall stock field below.
      </p>
    </div>
  );
}
