import { waitForHttpReady } from "@t3tools/shared/httpReadiness";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { StackServiceUnhealthyError } from "./StackErrors.ts";

const PROBE_TIMEOUT = Duration.seconds(2);
const READINESS_INTERVAL_MS = 500;

/** One quick check: true when the URL answers 2xx within two seconds. */
export const isHealthy = (url: string): Effect.Effect<boolean, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const answered = yield* client.execute(HttpClientRequest.get(url)).pipe(
      Effect.flatMap((response) => response.text),
      Effect.timeoutOption(PROBE_TIMEOUT),
    );
    return Option.isSome(answered);
  }).pipe(Effect.catch(() => Effect.succeed(false)));

/** Wait for a service to answer healthy, failing after its manifest timeout. */
export const waitUntilHealthy = (input: {
  readonly service: string;
  readonly url: string;
  readonly timeoutSec: number;
}): Effect.Effect<void, StackServiceUnhealthyError, HttpClient.HttpClient> => {
  const target = new URL(input.url);
  return waitForHttpReady({
    baseUrl: target.origin,
    path: `${target.pathname}${target.search}`,
    timeoutMs: input.timeoutSec * 1000,
    intervalMs: READINESS_INTERVAL_MS,
    makeError: ({ cause }) =>
      new StackServiceUnhealthyError({
        service: input.service,
        url: input.url,
        timeoutSec: input.timeoutSec,
        cause,
      }),
  });
};
