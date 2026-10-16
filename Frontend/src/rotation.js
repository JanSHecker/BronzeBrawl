export function rotationAvailable(status) {
  if (status.gameState === "ended") return false;
  if (typeof status.rotationAvailable === "boolean") return status.rotationAvailable;
  const remaining = status.rotationRemainingSeconds;
  return Number.isFinite(remaining) && remaining <= 0;
}

export function formatRotationTime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
