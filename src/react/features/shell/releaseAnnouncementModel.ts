import type { ReleaseNote } from "../../releaseNoteModel";

function versionParts(version: string): number[] | undefined {
  // Match the project's stable/beta/rc numbering; beta2 precedes beta10,
  // all betas precede rc, and the stable release follows its candidates.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)(\d+))?$/.exec(version);
  if (!match) return undefined;
  const parts = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === "beta" ? 0 : match[4] === "rc" ? 1 : 2,
    Number(match[5] || 0),
  ];
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

function compareVersions(left: string, right: string) {
  const a = versionParts(left)!;
  const b = versionParts(right)!;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4];
}

/** Legacy per-version confirmations also serve as the account's reading baseline. */
export function unreadReleaseNotes(notes: ReleaseNote[], currentVersion: string, acknowledgedVersions: string[]) {
  if (!versionParts(currentVersion) || acknowledgedVersions.includes(currentVersion)) return [];
  const baseline = acknowledgedVersions
    .filter((version) => versionParts(version))
    .sort(compareVersions)
    .at(-1);
  const seen = new Set(acknowledgedVersions);
  const available = notes.filter(
    (note) => versionParts(note.version) && compareVersions(note.version, currentVersion) <= 0,
  );
  // A new account starts with the current release, not the entire historical archive.
  return available
    .filter((note) =>
      baseline
        ? compareVersions(note.version, baseline) > 0 && !seen.has(note.version)
        : note.version === currentVersion,
    )
    .sort((a, b) => compareVersions(a.version, b.version));
}
