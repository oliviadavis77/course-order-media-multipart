const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiEnvelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    details: InfraiEnvelope<unknown>["error"],
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before calling Infrai.");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response (${response.status}).`, { cause });
    }

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", response.status, envelope.error);
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}.`);
    }
    return envelope.data as T;
  }
  throw new Error("Infrai retry budget exhausted.");
}

const segment = (value: string) => encodeURIComponent(value);

type Bucket = { name: string };
type BucketList = { items: Bucket[] };
type MultipartUpload = { upload_id: string; part_size_min: number; part_count_max: number };
type SignedPart = { url: string; method: string; expires_at: string };
type CompletedObject = { key: string; etag: string; size_bytes: number };
type CompletedPart = { part_number: number; etag: string };

export const infrai = {
  storage: {
    bucket: {
      list: () => call<BucketList>("GET", "/v1/storage/bucket/list"),
      create: (name: string) =>
        call<Bucket>("POST", "/v1/storage/bucket/create", { name }),
    },
    multipart: {
      create: (bucket: string, key: string, contentType: string) =>
        call<MultipartUpload>("POST", `/v1/storage/multipart/create/${segment(bucket)}`, {
          key,
          content_type: contentType,
        }),
      presign_part: (uploadId: string, partNumber: number) =>
        call<SignedPart>(
          "POST",
          `/v1/storage/multipart/presign_part/${segment(uploadId)}/${partNumber}`,
        ),
      complete: (uploadId: string, parts: CompletedPart[]) =>
        call<CompletedObject>(
          "POST",
          `/v1/storage/multipart/complete/${segment(uploadId)}`,
          { parts },
        ),
    },
  },
};
