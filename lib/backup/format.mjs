// Small output helpers shared by backup and restore. Pure.

/** `techteam-backup-YYYYMMDD-HHmmss.tar.gz` (local time). @param {Date} date */
export function defaultArchiveName(date = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `techteam-backup-${day}-${time}.tar.gz`;
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
