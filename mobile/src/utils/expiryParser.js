const EXPIRY_KEYWORDS = /\b(?:EXP(?:IRY|IRES|IRATION)?|USE\s*BY|BEST\s*BEFORE|BBE|HSD|HẠN\s*SỬ\s*DỤNG)\b/i;

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseGs1Date(value) {
  if (!/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  // GS1 permits day 00 to mean the last day of the month.
  const encodedDay = Number(value.slice(4, 6));
  const day = encodedDay || new Date(Date.UTC(year, month, 0)).getUTCDate();
  return toIsoDate(year, month, day);
}

function parseGs1ElementString(rawValue) {
  let value = String(rawValue || '').trim().replace(/^\](?:d2|Q3)/i, '');
  const parenthesized = value.match(/\(17\)\s*(\d{6})/);
  if (parenthesized) return parseGs1Date(parenthesized[1]);

  // Parse the common fixed-length AIs instead of matching an arbitrary "17"
  // inside a GTIN or lot number.
  const fixedLengths = { '00': 18, '01': 14, '11': 6, '13': 6, '15': 6, '17': 6 };
  const variableAis = new Set(['10', '21']);
  let offset = 0;

  while (offset + 2 <= value.length) {
    const ai = value.slice(offset, offset + 2);
    offset += 2;
    if (ai === '17') return parseGs1Date(value.slice(offset, offset + 6));

    if (fixedLengths[ai]) {
      offset += fixedLengths[ai];
      continue;
    }
    if (variableAis.has(ai)) {
      const separator = value.indexOf('\u001d', offset);
      if (separator === -1) break;
      offset = separator + 1;
      continue;
    }
    break;
  }
  return null;
}

function parseInternalExpiry(rawValue) {
  const value = String(rawValue || '');
  const match = value.match(/(?:^|[?&;|,\s])(?:EXP|EXPIRY|HSD)\s*[=:]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=$|[?&;|,\s])/i);
  return match ? toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function parsePrintedDate(value) {
  let match = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return toIsoDate(year, Number(match[2]), Number(match[1]));
}

export function parseExpiryFromScan(rawValue) {
  return parseInternalExpiry(rawValue) || parseGs1ElementString(rawValue);
}

export function isValidExpiryDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return !!match && toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) === value;
}

export function parseExpiryFromOcr(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!EXPIRY_KEYWORDS.test(lines[index])) continue;
    const nearbyText = `${lines[index]} ${lines[index + 1] || ''}`;
    const parsed = parsePrintedDate(nearbyText);
    if (parsed) return parsed;
  }

  // Accept an unlabelled date only when OCR found exactly one valid date.
  const candidates = [...new Set(lines.map(parsePrintedDate).filter(Boolean))];
  return candidates.length === 1 ? candidates[0] : null;
}
