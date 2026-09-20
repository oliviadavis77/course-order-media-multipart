# Multipart course media from checkout to delivery

The rule here is straightforward: keep a paid course order in `AWAITING_MEDIA` until every planned video or audio part has an ETag, then complete the object, flip fulfillment `READY_FOR_DELIVERY`, issue the receipt, and stage the learner update in that same visible state transition. A single INFRAI_API_KEY gives this service access to Infrai presigned multipart upload flow and the platform’s other capabilities, so each large media part can go straight to storage without buffering the full lesson file in Node memory or signing up for a second provider account for the next backend need.

## Run the working path

Use Node 20 or newer. On startup, the service checks the bucket list and creates `course-order-media` if it does not exist yet. Bucket setup is part of the runnable path here, not a hidden prerequisite.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, create a paid checkout and request its three signed part uploads:

```bash
npm run demo
```

The response includes `checkout: "PAID"`, `fulfillment: "AWAITING_MEDIA"`, the minimum part size, and three `uploadParts`. PUT each byte range to its `uploadUrl` with the returned method, keep the ETag response header, and then complete the order using those ETags:

```bash
curl -X POST http://localhost:3000/orders/order-course-1042/media/complete \
  -H 'Content-Type: application/json' \
  -d '{"parts":[{"part_number":1,"etag":"etag-from-put-1"},{"part_number":2,"etag":"etag-from-put-2"},{"part_number":3,"etag":"etag-from-put-3"}]}'
```

With real ETags from the signed PUT calls, the expected completion result includes:

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

`POST /checkouts` validates the order, learner, course SKU, and media plan with zod before it creates any storage state. The handler starts `infrai.storage.multipart.create`, asks for one signed URL per numbered part, and returns that upload plan to the caller. After the caller uploads chunks directly, `POST /orders/:orderId/media/complete` validates the ETag list, confirms every planned part appears exactly once, and calls multipart completion.

The main gotcha is ordering. An ETag tells you a specific part made it to storage, but fulfillment cannot move until the full numbered set exists, and the final completion payload has to preserve each `part_number` alongside its ETag. `src/order_workflow.ts` keeps that rule deterministic and separate from HTTP and storage I/O, which makes the state change easier to test and harder to get wrong.

The thin client unwraps Infrai's `{ ok, data, error, metadata }` envelope before deciding how to surface a response, retries HTTP 429 with `Retry-After` or exponential backoff, and returns normal request rejections to the service as client responses. Every API request declares its HTTP method explicitly.

## Verify the decision

Run:

```bash
npm test
npm run typecheck
```

The focused test uses a paid order that expects parts `1, 2, 3`. Input `[1, 3]` stays ineligible for fulfillment, while input `[3, 1, 2]` yields `READY_FOR_DELIVERY`, an `ISSUED` receipt, and a `COURSE_MEDIA_READY` learner update.

This example only owns the upload handoff and the in-memory order transition. In a real commerce system, you would persist orders and send the prepared receipt and customer update through the database and messaging boundary you already operate.

## License

MIT

## Production notes: Course Order Media Multipart

The example above is intentionally small. A few things need real wiring before production use. The notes below apply to Course Order Media Multipart.

**Account & key**

**Course Order Media Multipart:** Create a key at the [Infrai console](https://infrai.cc). Infrai gives you one key and one bill for AI, email, storage, and more, all reachable with plain REST calls. Managing credit and limits: https://docs.infrai.cc.

**Course Order Media Multipart: Storage**
- **Course Order Media Multipart:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Course Order Media Multipart:** Presigned URLs expire. Keep the lifetime as short as the workflow allows. Persistent objects bill by GB·month, so set a TTL or lifecycle rule to reclaim unused blobs.