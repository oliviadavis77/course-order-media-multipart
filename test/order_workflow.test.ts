import assert from "node:assert/strict";
import test from "node:test";
import { finishCourseOrder, type PendingOrder } from "../src/order_workflow.js";

const pendingOrder: PendingOrder = {
  orderId: "order-course-1042",
  customerId: "learner-208",
  courseSku: "TS-STREAMING-VIDEO",
  media: {
    fileName: "lesson-07.mp4",
    contentType: "video/mp4",
    sizeBytes: 25_000_000,
    partCount: 3,
  },
  uploadId: "upload-1042",
  objectKey: "orders/order-course-1042/lesson-07.mp4",
  checkout: "PAID",
  fulfillment: "AWAITING_MEDIA",
};

test("issues the receipt and learner update only when every media part is present", () => {
  assert.throws(
    () => finishCourseOrder(pendingOrder, [1, 3]),
    /Every planned media part must be present/,
  );

  const result = finishCourseOrder(pendingOrder, [3, 1, 2]);
  assert.equal(result.fulfillment, "READY_FOR_DELIVERY");
  assert.deepEqual(result.receipt, {
    orderId: "order-course-1042",
    status: "ISSUED",
    mediaKey: "orders/order-course-1042/lesson-07.mp4",
  });
  assert.deepEqual(result.customerUpdate, {
    customerId: "learner-208",
    status: "COURSE_MEDIA_READY",
  });
});
