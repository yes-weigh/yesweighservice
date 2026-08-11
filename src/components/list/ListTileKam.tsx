export function ListTileKam({ name }: { name: string | null | undefined }) {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return <span className="list-tile-kam">{trimmed}</span>;
}
