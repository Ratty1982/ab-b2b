/**
 * Decode uploaded / emailed 231PO3NEW bytes for parsing.
 * Browser File.text() always uses UTF-8; Autopart exports are often
 * Windows-1252 / Latin-1. Wrong decoding shifts fixed-width columns and
 * makes native Avail detection fail closed.
 */

export type StockFeedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export type DecodedStockFeed = {
  text: string;
  encoding: StockFeedEncoding;
  bom: boolean;
  byteLength: number;
};

function hasUtf16LeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
}

function hasUtf16BeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function countNulInSample(bytes: Uint8Array, limit = 4000): number {
  const n = Math.min(bytes.length, limit);
  let nul = 0;
  for (let i = 0; i < n; i += 1) if (bytes[i] === 0) nul += 1;
  return nul;
}

function looksLikeUtf16WithoutBom(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  if (bytes.length < 8) return null;
  const sample = Math.min(bytes.length, 4000);
  const nul = countNulInSample(bytes, sample);
  if (nul < sample * 0.15) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < sample; i += 1) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenNul += 1;
    else oddNul += 1;
  }
  if (oddNul > evenNul * 1.5) return "utf-16le";
  if (evenNul > oddNul * 1.5) return "utf-16be";
  return null;
}

function decodeWindows1252(bytes: Uint8Array): string {
  // Prefer TextDecoder when available; Node 22+ supports windows-1252.
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
    return out;
  }
}

function score231Candidate(text: string): number {
  let score = 0;
  if (/\(\s*231PO3NEW\s*\)/i.test(text)) score += 5;
  if (/Part\s*Number/i.test(text) && /\bAvail\b/i.test(text) && /\bStk\b/i.test(text)) score += 5;
  if (/Pick\s*Qty/i.test(text)) score += 2;
  // Mojibake / replacement characters indicate a bad decode for a report.
  if (text.includes("\uFFFD")) score -= 8;
  return score;
}

/**
 * Decode feed bytes with BOM / UTF-16 / Windows-1252 awareness.
 * Chooses the decode that best preserves 231PO3NEW header structure.
 */
export function decodeStockFeedBytes(input: Uint8Array | Buffer | ArrayBuffer): DecodedStockFeed {
  let bytes: Uint8Array;
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    bytes = input as Uint8Array;
  }
  const byteLength = bytes.byteLength;

  if (hasUtf8Bom(bytes)) {
    const text = new TextDecoder("utf-8").decode(bytes.subarray(3));
    return { text, encoding: "utf-8", bom: true, byteLength };
  }
  if (hasUtf16LeBom(bytes)) {
    const text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
    return { text, encoding: "utf-16le", bom: true, byteLength };
  }
  if (hasUtf16BeBom(bytes)) {
    const text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
    return { text, encoding: "utf-16be", bom: true, byteLength };
  }

  const utf16Guess = looksLikeUtf16WithoutBom(bytes);
  if (utf16Guess) {
    const text = new TextDecoder(utf16Guess).decode(bytes);
    return { text, encoding: utf16Guess, bom: false, byteLength };
  }

  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const latin1 = decodeWindows1252(bytes);
  const utf8Score = score231Candidate(utf8);
  const latin1Score = score231Candidate(latin1);
  if (latin1Score > utf8Score) {
    return { text: latin1, encoding: "windows-1252", bom: false, byteLength };
  }
  return { text: utf8, encoding: "utf-8", bom: false, byteLength };
}

export function decodeStockFeedBase64(base64: string): DecodedStockFeed {
  const trimmed = base64.trim();
  const comma = trimmed.indexOf(",");
  const payload = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  return decodeStockFeedBytes(Buffer.from(payload, "base64"));
}
