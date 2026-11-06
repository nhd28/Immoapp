// Pipeline-Stufen einer Immobilie – von Eingang bis Kauf.
export const STATUSES = [
  { key: 'eingang', label: 'Eingang', color: '#64748b' },
  { key: 'pruefung', label: 'In Prüfung', color: '#0ea5e9' },
  { key: 'besichtigung', label: 'Besichtigung', color: '#8b5cf6' },
  { key: 'angebot', label: 'Angebot abgegeben', color: '#f59e0b' },
  { key: 'finanzierung', label: 'Finanzierung', color: '#ec4899' },
  { key: 'notar', label: 'Notartermin', color: '#14b8a6' },
  { key: 'gekauft', label: 'Gekauft', color: '#16a34a' },
  { key: 'abgelehnt', label: 'Abgelehnt', color: '#dc2626' },
];
export const STATUS_KEYS = STATUSES.map((s) => s.key);
export const statusLabel = (k) => STATUSES.find((s) => s.key === k)?.label ?? k;

// Bewertungskriterien (je 1–5 Sterne, pro Person)
export const CRITERIA = [
  { key: 'lage', label: 'Lage' },
  { key: 'zustand', label: 'Zustand' },
  { key: 'preis', label: 'Preis/Leistung' },
  { key: 'rendite', label: 'Rendite' },
  { key: 'potenzial', label: 'Potenzial' },
];
