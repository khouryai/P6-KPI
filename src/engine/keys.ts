/**
 * Excel MATCH, COUNTIF and SEARCH are case-insensitive. The workbook therefore
 * treats "IXL Cutover (by BART)" and "IXL Cutover (By BART)" as one library key.
 * Every join in the engine goes through normKey so the application reproduces
 * the workbook's numbers exactly.
 */
export function normKey(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function containsCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
