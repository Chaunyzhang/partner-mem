const HAN_RUN_PATTERN = /\p{Script=Han}+/gu;

export function buildFtsIndexText(text: string): string {
  const normalized = text.normalize("NFC");
  const cjkTerms = buildCjkTerms(normalized);
  return cjkTerms.length > 0 ? `${normalized} ${cjkTerms.join(" ")}` : normalized;
}

export function buildFtsMatchQuery(query: string): string {
  const normalized = query.normalize("NFC");
  const cjkTerms = buildCjkTerms(normalized);
  if (cjkTerms.length > 0) {
    return cjkTerms.map(quoteFtsTerm).join(" OR ");
  }

  return normalized
    .split(/\s+/u)
    .filter((term) => term.length > 0)
    .map(quoteFtsTerm)
    .join(" ");
}

function buildCjkTerms(text: string): string[] {
  const terms: string[] = [];

  for (const match of text.matchAll(HAN_RUN_PATTERN)) {
    const chars = Array.from(match[0]);
    appendNgrams(terms, chars, 3);
    appendNgrams(terms, chars, 2);
  }

  return [...new Set(terms)];
}

function appendNgrams(terms: string[], chars: string[], size: number): void {
  if (chars.length < size) return;
  for (let index = 0; index <= chars.length - size; index += 1) {
    terms.push(chars.slice(index, index + size).join(""));
  }
}

function quoteFtsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}
