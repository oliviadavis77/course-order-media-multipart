import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infrai } from "./infrai_storage.js";
import {
  checkoutBodySchema,
  completionBodySchema,
  finishCourseOrder,
  type PendingOrder,
} from "./order_workflow.js";

const bucket = process.env.MEDIA_BUCKET ?? "course-order-media";
const orders = new Map<string, PendingOrder>();

async function ensureMediaBucket(): Promise<void> {
  const { items } = await infrai.storage.bucket.list();
  if (!items.some((item) => item.name === bucket)) {
    await infrai.storage.bucket.create(bucket);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

async function beginCheckout(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const checkout = checkoutBodySchema.parse(await readJson(request));
  const objectKey = `orders/${checkout.orderId}/${checkout.media.fileName}`;
  const upload = await infrai.storage.multipart.create(bucket, objectKey, checkout.media.contentType);
  if (checkout.media.partCount > upload.part_count_max) {
    throw new RangeError("The requested part count exceeds the upload plan.");
  }

  const uploadParts = await Promise.all(
    Array.from({ length: checkout.media.partCount }, async (_, index) => {
      const partNumber = index + 1;
      const signed = await infrai.storage.multipart.presign_part(upload.upload_id, partNumber);
      return { partNumber, uploadUrl: signed.url, method: signed.method };
    }),
  );
  const order: PendingOrder = {
    ...checkout,
    uploadId: upload.upload_id,
    objectKey,
    checkout: "PAID",
    fulfillment: "AWAITING_MEDIA",
  };
  orders.set(order.orderId, order);
  json(response, 201, {
    orderId: order.orderId,
    checkout: order.checkout,
    fulfillment: order.fulfillment,
    partSizeMin: upload.part_size_min,
    uploadParts,
  });
}

async function completeMedia(
  orderId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const order = orders.get(orderId);
  if (!order) return json(response, 404, { error: "Order not found" });
  const completion = completionBodySchema.parse(await readJson(request));
  const fulfilled = finishCourseOrder(order, completion.parts.map((part) => part.part_number));
  await infrai.storage.multipart.complete(order.uploadId, completion.parts);
  orders.delete(orderId);
  json(response, 200, fulfilled);
}

export function createCourseOrderServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/checkouts") {
        return await beginCheckout(request, response);
      }
      const completionMatch = request.url?.match(/^\/orders\/([^/]+)\/media\/complete$/);
      if (request.method === "POST" && completionMatch) {
        return await completeMedia(decodeURIComponent(completionMatch[1]), request, response);
      }
      json(response, 404, { error: "Route not found" });
    } catch (error) {
      if (error instanceof ZodError) return json(response, 400, { error: "Invalid request body", issues: error.issues });
      if (error instanceof RangeError) return json(response, 422, { error: error.message });
      if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        return json(response, status, { error: error.code, message: error.message });
      }
      json(response, 500, { error: "Service request failed" });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await ensureMediaBucket();
  const port = Number(process.env.PORT ?? 3000);
  createCourseOrderServer().listen(port, () => {
    console.log(`Course order service listening on http://localhost:${port}`);
  });
}
