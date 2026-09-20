import { z } from "zod";

export const checkoutBodySchema = z.object({
  orderId: z.string().min(3).max(80),
  customerId: z.string().min(3).max(80),
  courseSku: z.string().min(3).max(80),
  media: z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.string().regex(/^(video|audio)\/[a-z0-9.+-]+$/i),
    sizeBytes: z.number().int().positive(),
    partCount: z.number().int().min(1).max(10_000),
  }),
});

export const completionBodySchema = z.object({
  parts: z.array(z.object({
    part_number: z.number().int().positive(),
    etag: z.string().min(1),
  })).min(1),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
export type CompletionBody = z.infer<typeof completionBodySchema>;

export type PendingOrder = CheckoutBody & {
  uploadId: string;
  objectKey: string;
  checkout: "PAID";
  fulfillment: "AWAITING_MEDIA";
};

export type FulfilledOrder = Omit<PendingOrder, "fulfillment"> & {
  fulfillment: "READY_FOR_DELIVERY";
  receipt: { orderId: string; status: "ISSUED"; mediaKey: string };
  customerUpdate: { customerId: string; status: "COURSE_MEDIA_READY" };
};

export function finishCourseOrder(
  order: PendingOrder,
  uploadedPartNumbers: number[],
): FulfilledOrder {
  const expected = Array.from({ length: order.media.partCount }, (_, index) => index + 1);
  const received = [...new Set(uploadedPartNumbers)].sort((a, b) => a - b);
  if (received.length !== expected.length || received.some((part, index) => part !== expected[index])) {
    throw new Error("Every planned media part must be present before fulfillment.");
  }

  return {
    ...order,
    fulfillment: "READY_FOR_DELIVERY",
    receipt: { orderId: order.orderId, status: "ISSUED", mediaKey: order.objectKey },
    customerUpdate: { customerId: order.customerId, status: "COURSE_MEDIA_READY" },
  };
}
