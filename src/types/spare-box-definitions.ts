/** Named spare carton presets (Settings → Logistics → Spare box dia). */
export type SpareBoxDefinition = {
  id: string;
  name: string;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

function positiveCm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

function newSpareBoxId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `spare-box-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Drop invalid rows; require name + all three dims > 0. */
export function normalizeSpareBoxDefinitions(raw: unknown): SpareBoxDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: SpareBoxDefinition[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const obj = row as Record<string, unknown>;
    const name = String(obj.name ?? '').trim();
    const lengthCm = positiveCm(obj.lengthCm);
    const breadthCm = positiveCm(obj.breadthCm ?? obj.widthCm);
    const heightCm = positiveCm(obj.heightCm);
    if (!name || lengthCm == null || breadthCm == null || heightCm == null) continue;
    let id = String(obj.id ?? '').trim() || newSpareBoxId();
    if (seen.has(id)) id = newSpareBoxId();
    seen.add(id);
    out.push({ id, name, lengthCm, breadthCm, heightCm });
  }
  return out;
}

export function createEmptySpareBoxDefinitionDraft(): SpareBoxDefinition {
  return {
    id: newSpareBoxId(),
    name: '',
    lengthCm: 0,
    breadthCm: 0,
    heightCm: 0,
  };
}

/** Book Courier uses widthCm for breadth. */
export function spareBoxDefinitionToDraftDims(def: SpareBoxDefinition): {
  lengthCm: string;
  widthCm: string;
  heightCm: string;
} {
  return {
    lengthCm: String(def.lengthCm),
    widthCm: String(def.breadthCm),
    heightCm: String(def.heightCm),
  };
}

export function spareBoxDefinitionMatchesDraftDims(
  def: SpareBoxDefinition,
  box: { lengthCm: string; widthCm: string; heightCm: string },
): boolean {
  const length = positiveCm(box.lengthCm);
  const breadth = positiveCm(box.widthCm);
  const height = positiveCm(box.heightCm);
  if (length == null || breadth == null || height == null) return false;
  return (
    length === def.lengthCm
    && breadth === def.breadthCm
    && height === def.heightCm
  );
}
