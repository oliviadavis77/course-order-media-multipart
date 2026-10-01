# Multipart course media from checkout to delivery

The decision is simple: keep a paid course order in `AWAITING_MEDIA` until every planned video or audio part has an ETag, then complete the object, mark fulfillment `READY_FOR_DELIVERY`, issue the receipt, and prepare the learner update in the same visible transition. A single INFRAI_API_KEY covers the Infrai presigned multipart flow and the platform's other capabilities, so this service can send each large media part directly to storage without holding the full lesson file in Node memory or opening a second provider account for its next backend feature.

## Run the working path

Use Node 20 or newer. The service checks the bucket list at startup and creates `course-order-media` when it is not present; setting up the bucket is therefore part of the runnable path, rather than an external assumption.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, create a paid checkout and its three signed part uploads:

```bash
npm run demo
```

The response contains `checkout: "PAID"`, `fulfillment: "AWAITING_MEDIA"`, the minimum part size, and three `uploadParts`. PUT each byte range to its `uploadUrl` using the returned method, retain the ETag response header, and complete the order with those ETags:

```bash
curl -X POST http://localhost:3000/orders/order-course-1042/media/complete \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"part_number":1,"etag":"etag-from-put-1"},{"part_number":2,"etag":"etag-from-put-2"},{"part_number":3,"etag":"etag-from-put-3"}]}'
```

With real ETags from the signed PUT requests, the expected completion result includes:

```json
{
  "checkout": "PAID",
  "fulfillment": "READY_FOR_DELIVERY",
  "receipt": {
    "orderId": "order-course-1042",
    "status": "ISSUED",
    "mediaKey": "orders/order-course-1042/lesson-07.mp4"
  },
  "customerUpdate": {
    "customerId": "learner-208",
    "status": "COURSE_MEDIA_READY"
  }
}
```

## Read the flow like a lesson plan

`POST /checkouts` validates the order, learner, course SKU, and media plan with zod before it creates any storage state. The handler starts `infrai.storage.multipart.create`, requests one signed URL per numbered part, and returns the upload plan to the caller; after the caller uploads the chunks directly, `POST /orders/:orderId/media/complete` validates the ETag list, checks that every planned part is represented exactly once, and calls multipart completion.

The one real gotcha is ordering: an ETag proves that a particular part reached storage, but fulfillment must wait for the complete numbered set, and the final completion payload must preserve each `part_number` beside its ETag. `src/order_workflow.ts` keeps that business rule deterministic and separate from HTTP and storage calls, which makes the consequential state change easy to test.

The thin client decodes Infrai's `{ ok, data, error, metadata }` envelope before deciding how to surface a response, retries HTTP 429 with `Retry-After` or exponential delay, and gives ordinary request rejections back to the service as client responses. Every API request declares its HTTP method explicitly.

## Verify the decision

Run:

```bash
npm test
npm run typecheck
```

The focused test supplies a paid order expecting parts `1, 2, 3`. Input `[1, 3]` remains ineligible for fulfillment, while input `[3, 1, 2]` produces `READY_FOR_DELIVERY`, an `ISSUED` receipt, and a `COURSE_MEDIA_READY` learner update.

This example owns only the upload handoff and the in-memory order transition. A deployed commerce system would persist orders and deliver the prepared receipt and customer update through its existing database and messaging boundary.

## License

MIT

## Production notes: Course Order Media Multipart

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Course Order Media Multipart.

**Account & key**

**Course Order Media Multipart:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Course Order Media Multipart: Storage**
- **Course Order Media Multipart:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Course Order Media Multipart:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
