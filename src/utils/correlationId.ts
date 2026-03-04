let counter = 0;

export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  counter = (counter + 1) % 1_000_000;
  const suffix = counter.toString(36).padStart(4, "0");

  // Use crypto.randomUUID when available (Node 19+, all modern browsers)
  if (typeof globalThis.crypto?.randomUUID === "function") {
    const uuid = globalThis.crypto.randomUUID().replace(/-/g, "");
    return `cid_${timestamp}${uuid.substring(0, 12)}${suffix}`;
  }

  // Fallback: concatenate multiple random segments for better entropy
  const r1 = Math.random().toString(36).substring(2, 8);
  const r2 = Math.random().toString(36).substring(2, 8);
  return `cid_${timestamp}${r1}${r2}${suffix}`;
}
