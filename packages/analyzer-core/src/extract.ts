import type { ExtractionContext, UrlAnalysisRequest } from "./types.js";

const MAX_CONTENT_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type ResolvedAddress = {
  address: string;
};

type HostnameResolver = (hostname: string) => Promise<ResolvedAddress[]>;
type ReadableFetchResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  body?: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
};
type UrlFetcherInit = {
  headers: Record<string, string>;
  redirect: "manual";
  resolvedAddresses: ResolvedAddress[];
};
type UrlFetcher = (url: string, init: UrlFetcherInit) => Promise<ReadableFetchResponse>;

const defaultHostnameResolver: HostnameResolver = async (hostname) => {
  const nodeDnsModule = "node:dns/promises";
  const dns = await import(/* @vite-ignore */ nodeDnsModule) as typeof import("node:dns/promises");
  return dns.lookup(hostname, { all: true, verbatim: true });
};
let hostnameResolver = defaultHostnameResolver;

export function __setHostnameResolverForTests(resolver?: HostnameResolver): void {
  hostnameResolver = resolver ?? defaultHostnameResolver;
}

function addressFamily(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

function hostnameForTls(hostname: string): string {
  return normalizedHostname(hostname);
}

function hostHeaderFor(parsed: URL): string {
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
}

const defaultUrlFetcher: UrlFetcher = async (url, init) => {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const nodeHttpsModule = "node:https";
  const nodeHttpModule = "node:http";
  const transport = isHttps
    ? await import(/* @vite-ignore */ nodeHttpsModule) as typeof import("node:https")
    : await import(/* @vite-ignore */ nodeHttpModule) as typeof import("node:http");
  const addresses = init.resolvedAddresses.map((entry) => entry.address);
  if (addresses.length === 0) {
    throw new Error("URL host could not be resolved.");
  }
  let addressIndex = 0;

  return await new Promise<ReadableFetchResponse>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: {
          ...init.headers,
          host: hostHeaderFor(parsed),
        },
        servername: isHttps ? hostnameForTls(parsed.hostname) : undefined,
        lookup: (_hostname, _options, callback) => {
          const address = addresses[addressIndex % addresses.length];
          addressIndex += 1;
          callback(null, address, addressFamily(address));
        },
      },
      (response) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(key, item);
            }
          } else if (value !== undefined) {
            headers.set(key, String(value));
          }
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_CONTENT_BYTES) {
            request.destroy(new Error("URL response is too large."));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            url,
            headers,
            body: null,
            text: async () => body,
          });
        });
      },
    );
    request.setTimeout(15_000, () => {
      request.destroy(new Error("URL fetch timed out."));
    });
    request.on("error", reject);
    request.end();
  });
};

let urlFetcher = defaultUrlFetcher;

export function __setUrlFetcherForTests(fetcher?: UrlFetcher): void {
  urlFetcher = fetcher ?? defaultUrlFetcher;
}

function normalizeUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    throw new Error("URL is required.");
  }
  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate) ? candidate : `https://${candidate}`;
  const parsed = new URL(withScheme);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported.");
  }
  return parsed.toString();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/giu, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return named[lower] ?? match;
  });
}

function htmlTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return title ? textFromHtmlFragment(title) : undefined;
}

function removeNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/giu, " ")
    .replace(/<svg[\s\S]*?<\/svg>/giu, " ")
    .replace(/<template[\s\S]*?<\/template>/giu, " ")
    .replace(/<(?:nav|header|footer|aside|form|button|iframe|canvas)[\s\S]*?<\/(?:nav|header|footer|aside|form|button|iframe|canvas)>/giu, " ");
}

function textFromHtmlFragment(fragment: string): string {
  return decodeHtmlEntities(
    fragment
      .replace(/<(?:br|hr)\s*\/?>/giu, "\n")
      .replace(/<\/(?:p|div|article|section|main|h[1-6]|li|blockquote|tr|table|ul|ol)>/giu, "\n")
      .replace(/<li[^>]*>/giu, "\n- ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function linkDensity(fragment: string): number {
  const linkText = [...fragment.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => textFromHtmlFragment(match[1]))
    .join(" ");
  const text = textFromHtmlFragment(fragment);
  return text.length > 0 ? linkText.length / text.length : 0;
}

function wordCount(value: string): number {
  return [...value.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'-]*/gu)].length;
}

function candidateScore(fragment: string): number {
  const text = textFromHtmlFragment(fragment);
  const words = wordCount(text);
  const paragraphCount = [...fragment.matchAll(/<\/p>/giu)].length;
  const headingCount = [...fragment.matchAll(/<h[1-6]\b/giu)].length;
  const listCount = [...fragment.matchAll(/<li\b/giu)].length;
  return words + paragraphCount * 22 + headingCount * 10 + Math.min(40, listCount * 3) - Math.round(words * linkDensity(fragment) * 1.8);
}

function collectReadableCandidates(html: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    /<(article|main)\b[^>]*>[\s\S]*?<\/\1>/giu,
    /<(section|div)\b[^>]*(?:id|class|role)=["'][^"']*(?:article|content|entry|main|post|story|body)[^"']*["'][^>]*>[\s\S]*?<\/\1>/giu,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      candidates.push(match[0]);
    }
  }
  return candidates;
}

function extractReadableHtml(html: string): { text: string; notes: string[] } {
  const cleaned = removeNonContent(html);
  const fullText = textFromHtmlFragment(cleaned);
  const candidates = collectReadableCandidates(cleaned)
    .map((fragment) => ({
      fragment,
      score: candidateScore(fragment),
      text: textFromHtmlFragment(fragment),
    }))
    .filter((candidate) => wordCount(candidate.text) >= 25)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best || best.score < Math.max(60, wordCount(fullText) * 0.18)) {
    return {
      text: fullText,
      notes: candidates.length > 0 ? ["Readable content extraction used the full page after candidate scoring."] : [],
    };
  }

  return {
    text: best.text,
    notes: ["Readable content extraction selected a likely article body."],
  };
}

function estimateConfidence(text: string): number {
  const words = [...text.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'-]*/gu)].length;
  if (words >= 180) {
    return 0.86;
  }
  if (words >= 80) {
    return 0.68;
  }
  if (words >= 30) {
    return 0.42;
  }
  return 0.18;
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = parseIpv4(hostname);
  if (!octets) {
    return false;
  }
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168 ||
    first === 100 && second >= 64 && second <= 127 ||
    first === 192 && second === 0 && third === 0 ||
    first === 192 && second === 0 && third === 2 ||
    first === 198 && (second === 18 || second === 19) ||
    first === 198 && second === 51 && third === 100 ||
    first === 203 && second === 0 && third === 113 ||
    first >= 224
  );
}

function parseIpv6(hostname: string): number[] | null {
  let value = hostname;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon === -1) {
      return null;
    }
    const ipv4 = parseIpv4(value.slice(lastColon + 1));
    if (!ipv4) {
      return null;
    }
    const [first, second, third, fourth] = ipv4;
    value = `${value.slice(0, lastColon)}:${((first << 8) | second).toString(16)}:${((third << 8) | fourth).toString(16)}`;
  }

  const compressionParts = value.split("::");
  if (compressionParts.length > 2) {
    return null;
  }
  const parseParts = (part: string): number[] | null => {
    if (!part) {
      return [];
    }
    const parsed = part.split(":").map((hextet) => (/^[\da-f]{1,4}$/i.test(hextet) ? Number.parseInt(hextet, 16) : Number.NaN));
    return parsed.some((hextet) => !Number.isFinite(hextet)) ? null : parsed;
  };

  const head = parseParts(compressionParts[0] ?? "");
  const tail = parseParts(compressionParts[1] ?? "");
  if (!head || !tail) {
    return null;
  }
  if (compressionParts.length === 1) {
    return head.length === 8 ? head : null;
  }
  const zeroCount = 8 - head.length - tail.length;
  if (zeroCount < 1) {
    return null;
  }
  return [...head, ...Array.from({ length: zeroCount }, () => 0), ...tail];
}

function isPrivateIpv6(hostname: string): boolean {
  const hextets = parseIpv6(hostname);
  if (!hextets) {
    return false;
  }
  const [firstHextet, secondHextet, thirdHextet] = hextets;
  const isIpv4Mapped =
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff;
  if (isIpv4Mapped) {
    return isPrivateIpv4([
      hextets[6] >> 8,
      hextets[6] & 0xff,
      hextets[7] >> 8,
      hextets[7] & 0xff,
    ].join("."));
  }
  return (
    hextets.every((hextet) => hextet === 0) ||
    hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1 ||
    firstHextet === 0x0100 && secondHextet === 0 ||
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    firstHextet === 0x2002 ||
    firstHextet === 0x2001 && secondHextet === 0x0002 && thirdHextet === 0 ||
    firstHextet === 0x2001 && secondHextet >= 0x0010 && secondHextet <= 0x001f ||
    firstHextet === 0x2001 && secondHextet === 0x0db8
  );
}

function isPrivateHost(hostname: string): boolean {
  const lower = normalizedHostname(hostname);
  return (
    lower === "localhost" ||
    lower.endsWith(".local") ||
    isPrivateIpv4(lower) ||
    isPrivateIpv6(lower)
  );
}

async function assertUrlAllowed(url: string, allowPrivateNetwork?: boolean): Promise<ResolvedAddress[]> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported.");
  }
  if (!allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
    throw new Error("Private-network URLs are disabled by default.");
  }

  let resolvedAddresses: ResolvedAddress[];
  try {
    resolvedAddresses = await hostnameResolver(normalizedHostname(parsed.hostname));
  } catch {
    throw new Error("URL host could not be resolved.");
  }
  if (resolvedAddresses.length === 0) {
    throw new Error("URL host could not be resolved.");
  }
  if (!allowPrivateNetwork && resolvedAddresses.some((entry) => isPrivateHost(entry.address))) {
    throw new Error("Private-network URLs are disabled by default.");
  }
  return resolvedAddresses;
}

async function fetchReadableUrl(requestedUrl: string, allowPrivateNetwork?: boolean): Promise<ReadableFetchResponse> {
  let currentUrl = requestedUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const resolvedAddresses = await assertUrlAllowed(currentUrl, allowPrivateNetwork);
    const response = await urlFetcher(currentUrl, {
      redirect: "manual",
      resolvedAddresses,
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.2",
        "user-agent": "FlavorPressContentAnalyzer/0.1",
      },
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    if (redirectCount === MAX_REDIRECTS) {
      throw new Error("URL redirected too many times.");
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`URL redirect failed without a Location header (HTTP ${response.status}).`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error("URL redirected too many times.");
}

async function readResponseTextWithLimit(response: Pick<ReadableFetchResponse, "body" | "text">): Promise<string> {
  if (!response.body) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_CONTENT_BYTES) {
      throw new Error("URL response is too large.");
    }
    return body;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_CONTENT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("URL response is too large.");
    }
    body += decoder.decode(value, { stream: true });
  }

  body += decoder.decode();
  return body;
}

export async function extractTextFromUrl(input: UrlAnalysisRequest): Promise<{
  text: string;
  context: ExtractionContext;
}> {
  const requestedUrl = normalizeUrl(input.url);
  const response = await fetchReadableUrl(requestedUrl, input.options?.allowPrivateNetwork);
  if (!response.ok) {
    throw new Error(`URL fetch failed with HTTP ${response.status}.`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_CONTENT_BYTES) {
    throw new Error("URL response is too large.");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error(`URL response is not readable text or HTML (${contentType}).`);
  }

  const body = await readResponseTextWithLimit(response);

  const extracted = contentType.includes("text/plain")
    ? { text: body.trim(), notes: [] }
    : extractReadableHtml(body);
  const text = extracted.text;
  const confidence = estimateConfidence(text);
  return {
    text,
    context: {
      requestedUrl,
      finalUrl: response.url,
      title: contentType.includes("text/plain") ? undefined : htmlTitle(body),
      contentType: contentType || undefined,
      confidence,
      notes: [
        ...extracted.notes,
        ...(confidence < 0.5 ? ["Readable content extraction returned limited text."] : []),
      ],
    },
  };
}
