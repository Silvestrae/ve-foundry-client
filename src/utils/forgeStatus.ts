function decodeHtml(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return namedEntities[code.toLowerCase()] ?? entity;
    },
  );
}

export function parseForgeSignedInUserHtml(html: string): string | undefined {
  const profileName = html.match(
    /<span\b[^>]*class="[^"]*\buser-profile-name\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  )?.[1];
  if (!profileName) return undefined;

  const username = decodeHtml(profileName.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return username || undefined;
}
