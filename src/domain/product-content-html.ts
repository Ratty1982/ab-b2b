const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "b", "i"]);

/**
 * Server-side sanitiser for product description HTML pasted via Product Content JSON.
 * Strips scripts, styles, iframes, event handlers and javascript: URLs.
 * Allowed tags keep no attributes.
 */
export function sanitizeProductDescriptionHtml(input: string): string {
  let html = input.replace(/\u0000/g, "");
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|svg|math)[\s\S]*?<\/\s*\1\s*>/gi, "");
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|svg|math)[^>]*>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/(href|src|xlink:href)\s*=\s*(['"]?)\s*javascript:[\s\S]*?\2/gi, "");
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g, (match, rawTag: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const closing = match.startsWith("</");
    if (tag === "br") return "<br />";
    if (tag === "b") return closing ? "</strong>" : "<strong>";
    if (tag === "i") return closing ? "</em>" : "<em>";
    return closing ? `</${tag}>` : `<${tag}>`;
  });
  return html.trim();
}
