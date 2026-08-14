export type HostedService = "forge" | "sqyre";
export type HostedAuthenticationProvider = "google" | "discord" | "patreon";

const HOSTED_SERVICE_DOMAINS: Record<HostedService, readonly string[]> = {
  forge: ["forge-vtt.com"],
  sqyre: ["sqyre.app"],
};

const HOST_AUTHENTICATION_DOMAINS: Record<
  HostedAuthenticationProvider,
  readonly string[]
> = {
  google: ["accounts.google.com"],
  discord: ["discord.com"],
  patreon: ["patreon.com"],
};

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

export function isHostedGameServerUrl(
  rawUrl: string,
  service: HostedService,
): boolean {
  const url = getHttpUrl(rawUrl);
  if (!url) return false;

  if (service === "sqyre") {
    return hostnameMatchesDomain(url.hostname, "games.sqyre.app");
  }

  return (
    url.hostname.toLowerCase() !== "forge-vtt.com" &&
    hostnameMatchesDomain(url.hostname, "forge-vtt.com")
  );
}

export function getHostedAuthenticationProviderFromUrl(
  rawUrl: string,
): HostedAuthenticationProvider | null {
  const url = getHttpUrl(rawUrl);
  if (!url) return null;

  for (const [provider, domains] of Object.entries(
    HOST_AUTHENTICATION_DOMAINS,
  ) as [HostedAuthenticationProvider, readonly string[]][]) {
    if (domains.some((domain) => hostnameMatchesDomain(url.hostname, domain))) {
      return provider;
    }
  }

  return null;
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

  const currentIsAuthentication =
    getHostedAuthenticationProviderFromUrl(currentUrl) !== null;
  const targetIsAuthentication =
    getHostedAuthenticationProviderFromUrl(targetUrl) !== null;

  if (currentService === service && targetIsAuthentication) return true;
  if (
    currentIsAuthentication &&
    (targetIsAuthentication || targetService === service)
  ) {
    return true;
  }

  return false;
}
