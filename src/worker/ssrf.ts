/**
 * SSRF and Response-Size Protection for Cloudflare Workers.
 * (F-05)
 */

export function isSafeWorkerUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  try {
    const parsed = new URL(rawUrl);

    // 1. Only http and https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // 2. Reject embedded userinfo (credentials)
    if (parsed.username || parsed.password) {
      return false;
    }

    const host = parsed.hostname.toLowerCase().trim();
    if (!host) return false;

    // 3. Reject localhost and internal hostname conventions
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan') ||
      host.endsWith('.corp') ||
      host.endsWith('.home') ||
      host.endsWith('.arpa') ||
      host === 'metadata.google.internal' ||
      host === 'metadata'
    ) {
      return false;
    }

    // 4. Reject single-label hostnames (intranet hostnames like "database" or "admin")
    if (!host.includes('.') && !host.startsWith('[')) {
      return false;
    }

    // 5. IPv4 checks
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = host.match(ipv4Regex);
    if (ipMatch) {
      const o1 = parseInt(ipMatch[1], 10);
      const o2 = parseInt(ipMatch[2], 10);
      const o3 = parseInt(ipMatch[3], 10);
      const o4 = parseInt(ipMatch[4], 10);

      if ([o1, o2, o3, o4].some((o) => o < 0 || o > 255 || isNaN(o))) {
        return false;
      }

      // 0.0.0.0/8 (Broadcast/Current network)
      if (o1 === 0) return false;
      // 10.0.0.0/8 (Private)
      if (o1 === 10) return false;
      // 100.64.0.0/10 (Carrier NAT)
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return false;
      // 127.0.0.0/8 (Loopback)
      if (o1 === 127) return false;
      // 169.254.0.0/16 (Link-local / Cloud metadata 169.254.169.254)
      if (o1 === 169 && o2 === 254) return false;
      // 172.16.0.0/12 (Private)
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
      // 192.0.0.0/24 & 192.0.2.0/24 (Documentation/Reserved)
      if (o1 === 192 && o2 === 0 && (o3 === 0 || o3 === 2)) return false;
      // 192.168.0.0/16 (Private)
      if (o1 === 192 && o2 === 168) return false;
      // 198.18.0.0/15 (Benchmarking)
      if (o1 === 198 && (o2 === 18 || o2 === 19)) return false;
      // 198.51.100.0/24 (Documentation)
      if (o1 === 198 && o2 === 51 && o3 === 100) return false;
      // 203.0.113.0/24 (Documentation)
      if (o1 === 203 && o2 === 0 && o3 === 113) return false;
      // 224.0.0.0/4 (Multicast)
      if (o1 >= 224 && o1 <= 239) return false;
      // 240.0.0.0/4 (Reserved)
      if (o1 >= 240) return false;
    }

    // 6. IPv6 checks
    const cleanHost = host.replace(/^\[|\]$/g, '');
    if (cleanHost.includes(':')) {
      if (
        cleanHost === '::1' ||
        cleanHost === '::' ||
        cleanHost.startsWith('fc') ||
        cleanHost.startsWith('fd') ||
        cleanHost.startsWith('fe80') ||
        cleanHost.startsWith('ff')
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Safely fetches a remote subtitle file with strict SSRF checks, manual redirects,
 * and streaming response size bounds (default max 5 MiB).
 * (F-05)
 */
export async function fetchRemoteSubtitleWithSafety(
  initialUrl: string,
  maxBytes = 5 * 1024 * 1024,
  maxRedirects = 3
): Promise<string> {
  let currentUrl = initialUrl;
  let redirectsCount = 0;

  while (true) {
    if (!isSafeWorkerUrl(currentUrl)) {
      throw new Error(`Target destination is restricted or invalid: ${currentUrl}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        headers: {
          'Accept': 'text/vtt, text/plain, application/x-subrip, */*',
          'User-Agent': 'OpenTranscript-AI/1.0',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      redirectsCount++;
      if (redirectsCount > maxRedirects) {
        throw new Error(`Too many redirects (exceeded ${maxRedirects} hops).`);
      }

      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response (${res.status}) missing Location header.`);
      }

      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} returned from remote server.`);
    }

    // Check Content-Type (reject HTML login/error pages)
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      throw new Error('Received HTML response instead of subtitle file.');
    }

    // Stream and enforce byte limit
    if (!res.body) {
      const text = await res.text();
      if (text.length > maxBytes) {
        throw new Error(`Subtitle content exceeds maximum allowed size of ${maxBytes} bytes.`);
      }
      return text;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytesReceived = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesReceived += value.byteLength;
          if (bytesReceived > maxBytes) {
            await reader.cancel();
            throw new Error(`Subtitle file exceeds maximum allowed size of ${maxBytes} bytes.`);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks
    const combined = new Uint8Array(bytesReceived);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder('utf-8').decode(combined);
  }
}
