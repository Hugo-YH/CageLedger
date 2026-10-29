/** Split stored names without treating spaces, middle dots, or hyphens as separators. */
export function splitPersonNames(raw: string | null | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(/[、/\\;；,，|｜／＼\r\n\t]+/u)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

export function formatPersonNames(raw: string | null | undefined): string {
  return splitPersonNames(raw).join("、");
}
