function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function tierDisplayRows(catalog) {
  const tiers = catalog?.tiers;
  if (!tiers || typeof tiers !== 'object') return [];
  return ['low', 'medium', 'high', 'ultra'].filter((id) => tiers[id]).map((id) => {
    const entry = tiers[id];
    const bytes = entry.packBytes || entry.bytes;
    return { id, name: id === 'low' ? '低' : id === 'medium' ? '中' : id === 'high' ? '高' : '极致', faces: `${Number(entry.faces || 0).toLocaleString()} 三角面`, size: formatBytes(bytes) };
  });
}
