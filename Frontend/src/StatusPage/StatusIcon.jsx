const paths = {
  chest: 'M4 12v8h16v-8M3 12h18V8a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v4Zm5 0V7m8 5V7m-6 3h4v6h-4z',
  kills: 'm4 3 4 1 12 15-2 2L4 7V3Zm16 0-4 1-4 5m-3 5-5 5 2 2 5-5M2 15l6 6m8-6 6 6',
  revenge: 'M5 8a8 8 0 1 1-1 8M5 3v5h5m3-1-4 6h4l-2 5 6-8h-4V7Z',
  assists: 'M12 21 4 13C-2 6 7 1 12 7c5-6 14-1 8 6l-8 8Zm0-12v6m-3-3h6',
  turret: 'M5 3h4v4h6V3h4v8l-2 2v8H7v-8l-2-2V3Zm2 10h10m-7 8v-5h4v5',
  epic: 'm5 10-3-7 8 4h4l8-4-3 7v6l-7 6-7-6v-6Zm3 2 2 1m6-1-2 1m-5 4h6',
  legendary: 'm3 5 5 4 4-6 4 6 5-4-3 15H6L3 5Zm4 10h10',
  sips: 'm6 3 2 18h8l2-18H6Zm1 6h10m-9 4h8',
  shots: 'm6 7 2 14h8l2-14H6Zm1 5h10M5 7h14',
  chugs: 'M4 4h12v17H4V4Zm12 3h3c3 0 3 10 0 10h-3M7 8v9m5-9v9M4 4V2h12v2',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  shield: 'M12 3 3 7v5c0 5 5 8 9 10 4-2 9-5 9-10V7l-9-4Z',
  shieldBreak: 'M12 3 3 7v5c0 5 5 8 9 10 4-2 9-5 9-10V7l-9-4Zm1 2-4 7h6l-4 8',
};

export default function StatusIcon({ name, ...props }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d={paths[name] || paths.chest} /></svg>;
}
