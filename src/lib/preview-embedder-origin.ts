export function isPreviewEmbedderOrigin(origin: string, allow: readonly string[] = []): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
    return allow.some((entry) => {
      const e = entry.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (!e) return false;
      return host === e || host.endsWith(`.${e}`);
    });
  } catch {
    return false;
  }
}

/**
 * True when `hostname` is a hosted live-preview guest host.
 *
 * The platform's preview host suffix is build-time config via
 * `VITE_PREVIEW_HOST_SUFFIX` (e.g. `example.com` matches
 * `https://<app>.example.com`). Empty suffix ⇒ never a preview guest, so the
 * browser behaves like any deployed app.
 */
export function isSandboxPreviewGuestHost(
  hostname: string,
  suffix: string = String(
    (import.meta as { env?: { VITE_PREVIEW_HOST_SUFFIX?: string } }).env
      ?.VITE_PREVIEW_HOST_SUFFIX ?? "",
  ),
): boolean {
  const host = hostname.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const s = suffix.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s) return false;
  return host === s || host.endsWith(`.${s}`);
}

/**
 * Parent/guest preview pair: the guest host is `<app>.<reserved>.preview.<parent>`
 * style and the parent is the same domain (or a subdomain of it).
 */
function isPreviewPair(guestHost: string, parentHost: string): boolean {
  const guest = guestHost.toLowerCase();
  const parent = parentHost.toLowerCase();
  const sep = ".preview.";
  const i = guest.indexOf(sep);
  if (i <= 0) return false;
  const label = guest.slice(0, i);
  const rest = guest.slice(i + sep.length);
  if (label.includes(".") || !rest.includes(".")) return false;
  return parent === rest || parent.endsWith(`.${rest}`);
}

export function resolveParentEmbedderOrigin(
  parentIsSelf: boolean,
  referrer: string,
  ancestorOrigin?: string | null,
  guestHostname: string = "",
): string | null {
  if (parentIsSelf) return null;
  for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) {
    try {
      const url = new URL(
        candidate.includes("://") ? candidate : `https://${candidate}`,
      );
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (
        isPreviewEmbedderOrigin(url.origin) ||
        isSandboxPreviewGuestHost(guestHostname) ||
        isPreviewPair(guestHostname, url.hostname)
      ) {
        return url.origin;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
