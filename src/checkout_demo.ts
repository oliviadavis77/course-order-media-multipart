const baseUrl = process.env.SERVICE_URL ?? "http://localhost:3000";

const checkoutResponse = await fetch(`${baseUrl}/checkouts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    orderId: "order-course-1042",
    customerId: "learner-208",
    courseSku: "TS-STREAMING-VIDEO",
    media: {
      fileName: "lesson-07.mp4",
      contentType: "video/mp4",
      sizeBytes: 25_000_000,
      partCount: 3,
    },
  }),
});

console.log(JSON.stringify(await checkoutResponse.json(), null, 2));
