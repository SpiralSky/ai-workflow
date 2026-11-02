/** An explicitly hypothetical visible-payload index; these are neither tokens nor monetary prices. */
export interface Payload { input: string; output: string }

/** Count the exact UTF-8 common prefix without splitting a code point. */
export function commonPrefixBytes(left: string, right: string): number {
  const a = [...left], b = [...right]; let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return Buffer.byteLength(a.slice(0, n).join(''));
}

/** First assignment is cold. Later eligible bytes are only the longest exact visible prefix
 * shared with a prior assignment in the same arm. Hidden native prefixes/cache eligibility are unknown.
 */
export function payloadProxy(payloads: Payload[]) {
  let inputBytes = 0, outputBytes = 0, hypotheticalRepeatPrefixBytes = 0;
  payloads.forEach((p, i) => {
    inputBytes += Buffer.byteLength(p.input); outputBytes += Buffer.byteLength(p.output);
    hypotheticalRepeatPrefixBytes += Math.max(0, ...payloads.slice(0, i).map(previous => commonPrefixBytes(previous.input, p.input)));
  });
  const scenarios = [1, 4, 8].flatMap(outputWeight => [1, 0.5, 0.1].map(repeatedPrefixWeight => ({
    outputWeight, repeatedPrefixWeight,
    units: inputBytes - hypotheticalRepeatPrefixBytes * (1 - repeatedPrefixWeight) + outputWeight * outputBytes,
  })));
  return { unit: 'normalized public-task-brief/source-artifact UTF-8 units', inputBytes, outputBytes, hypotheticalRepeatPrefixBytes,
    scenarios, actualCacheHits: null, actualCacheEligibility: null, tokens: null, costUSD: null,
    excludes: ['common coordinator instructions', 'task metadata', 'hidden native context', 'hidden reasoning', 'native model turns', 'unobserved tool traffic', 'actual cache behavior', 'local compute price'] };
}
