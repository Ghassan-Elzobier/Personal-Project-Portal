import type { Instrumentation } from "next";

// Server errors (pages, route handlers, server actions, the proxy) go to the
// error tracker, which the factory turns into bug issues (docs/FACTORY.md).
// Next has already left out redirect() and notFound(), which are not errors.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestError } = await import("./lib/errors/store");
  await reportRequestError(error, request, context);
};
