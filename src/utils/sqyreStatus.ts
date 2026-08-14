import type { ServerStatusData } from "../schemas";

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

function toPlainText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractAboutItems(html: string): string[] {
  const aboutList = html.match(
    /<(ul|ol|div)\b[^>]*class="[^"]*\babout-game\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i,
  )?.[2];
  if (!aboutList) return [];

  const listItems = Array.from(
    aboutList.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi),
  )
    .map((match) => toPlainText(match[1]))
    .filter(Boolean);
  const items = listItems.length ? listItems : [toPlainText(aboutList)];

  return items
    .flatMap((item) => item.split(/\s*\|\s*/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractHeroImage(html: string): string | undefined {
  for (const match of html.matchAll(/--heroImage:\s*url\(([^)]+)\)/gi)) {
    const rawUrl = decodeHtml(match[1].trim().replace(/^['"]|['"]$/g, ""));
    if (!rawUrl || rawUrl.startsWith("data:image/gif")) continue;

    try {
      return new URL(rawUrl, "https://www.sqyre.app").toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractSignedInUser(html: string): string | undefined {
  for (const match of html.matchAll(/<astro-island\b[^>]*\bprops="([^"]*)"/gi)) {
    const props = decodeHtml(match[1]);
    const userMatch = props.match(
      /"(?:currentUserPlayerName|currentUsername)":\[0,("(?:\\.|[^"])*")\]/,
    );
    if (!userMatch) continue;

    try {
      const username = JSON.parse(userMatch[1]);
      if (typeof username === "string" && username.trim()) {
        return username.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

type SqyreListingGame = {
  slug?: string;
  foundryVersion?: string;
  system?: { name?: string; version?: string };
  owner?: { username?: string };
  heroImage?: string;
  extension?: { type?: string };
};

function decodeAstroValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === 0) return decodeAstroValue(value[1]);
    if (value.length === 2 && value[0] === 1 && Array.isArray(value[1])) {
      return value[1].map(decodeAstroValue);
    }
    return value.map(decodeAstroValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decodeAstroValue(child)]),
    );
  }
  return value;
}

function getSqyreListingProps(html: string): {
  games?: SqyreListingGame[];
  username?: string;
} | null {
  for (const match of html.matchAll(/<astro-island\b([^>]*)>/gi)) {
    if (!/GameTiles/i.test(match[1])) continue;
    const propsMatch = match[1].match(/\bprops="([^"]*)"/i);
    if (!propsMatch) continue;

    try {
      const parsed = JSON.parse(decodeHtml(propsMatch[1])) as unknown;
      return decodeAstroValue(parsed) as {
        games?: SqyreListingGame[];
        username?: string;
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function parseSqyreGameListingHtml(
  html: string,
  slug: string,
): (ServerStatusData & { slug: string }) | null {
  const listing = getSqyreListingProps(html);
  const games = listing?.games?.filter((game) => game.slug) ?? [];
  const game = games.find((candidate) => candidate.slug === slug);
  if (!game?.slug) return null;

  let imageUrl: string | undefined;
  if (game.heroImage) {
    try {
      imageUrl = new URL(game.heroImage, "https://www.sqyre.app").toString();
    } catch {
      imageUrl = undefined;
    }
  }

  return {
    active: false,
    version: game.foundryVersion ?? "",
    world: "",
    system: game.system?.name ?? "",
    systemVersion: game.system?.version ?? "",
    users: 0,
    uptime: 0,
    hostedService: "sqyre",
    gameType: game.extension?.type ?? "",
    createdBy: game.owner?.username ?? "",
    signedInUser: listing?.username,
    imageUrl,
    slug: game.slug,
  };
}

export function parseSqyreGameDetailHtml(
  html: string,
): ServerStatusData | null {
  const pageText = toPlainText(html);
  const statusMatch = pageText.match(/\bServer is\s+(on|off)\b/i);
  const aboutItems = extractAboutItems(html);
  const version =
    aboutItems
      .find((item) => /\bFoundry\s+v/i.test(item))
      ?.match(/\bFoundry\s+v([\w.-]+)/i)?.[1] ??
    pageText.match(/\bFoundry\s+v([\w.-]+)/i)?.[1] ??
    "";
  if (!statusMatch && !version && aboutItems.length === 0) return null;

  const gameDetails = aboutItems.filter(
    (item) =>
      !/^Foundry\s+v/i.test(item) && !/^Module Set\b/i.test(item),
  );

  const createdBySection = html.match(
    /class="[^"]*\bcreated-by\b[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i,
  )?.[1];
  const createdBy = createdBySection
    ? toPlainText(createdBySection).replace(/^Created by\s*/i, "").trim()
    : "";

  return {
    active: statusMatch?.[1].toLowerCase() === "on",
    version,
    world: "",
    system: gameDetails[0] ?? "",
    systemVersion: "",
    users: 0,
    uptime: 0,
    hostedService: "sqyre",
    gameType: gameDetails[1] ?? "",
    createdBy,
    signedInUser: extractSignedInUser(html),
    imageUrl: extractHeroImage(html),
  };
}
