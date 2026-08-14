export type HostedService = "forge" | "sqyre";

const HOSTED_SERVICE_DOMAINS: Record<HostedService, readonly string[]> = {
  forge: ["forge-vtt.com"],
  sqyre: ["sqyre.app"],
};

const HOST_AUTHENTICATION_DOMAINS = [
  "accounts.google.com",
  "discord.com",
  "patreon.com",
] as const;

function getHttpUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return (
    normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

export function getHostedServiceFromUrl(rawUrl: string): HostedService | null {
  const url = getHttpUrl(rawUrl);
  if (!url) return null;

  for (const [service, domains] of Object.entries(HOSTED_SERVICE_DOMAINS) as [
    HostedService,
    readonly string[],
  ][]) {
    if (domains.some((domain) => hostnameMatchesDomain(url.hostname, domain))) {
      return service;
    }
  }

  return null;
}

function isHostAuthenticationUrl(rawUrl: string): boolean {
  const url = getHttpUrl(rawUrl);
  return (
    !!url &&
    HOST_AUTHENTICATION_DOMAINS.some((domain) =>
      hostnameMatchesDomain(url.hostname, domain),
    )
  );
}

/**
 * Keep a hosting provider's login and launch journey inside VE Client while
 * continuing to send unrelated cross-origin links to the default browser.
 */
export function isHostedServiceNavigation(
  currentUrl: string,
  targetUrl: string,
  activeService?: HostedService | null,
): boolean {
  const currentService = getHostedServiceFromUrl(currentUrl);
  const targetService = getHostedServiceFromUrl(targetUrl);
  const service = activeService ?? currentService ?? targetService;
  if (!service) return false;

  if (currentService === service && targetService === service) return true;

  const currentIsAuthentication = isHostAuthenticationUrl(currentUrl);
  const targetIsAuthentication = isHostAuthenticationUrl(targetUrl);

  if (currentService === service && targetIsAuthentication) return true;
  if (
    currentIsAuthentication &&
    (targetIsAuthentication || targetService === service)
  ) {
    return true;
  }

  return false;
}
