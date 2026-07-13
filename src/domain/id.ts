let fallbackSequence = 0;

/**
 * Generates a client-side draft identifier in both HTTPS and private HTTP deployments.
 * Server-side persistence continues to own durable identifiers after a record is saved.
 */
export function createClientId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();

  const bytes = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else {
    bytes[0] = Math.floor(Math.random() * 0xffffffff);
    bytes[1] = Math.floor(Math.random() * 0xffffffff);
  }

  fallbackSequence = (fallbackSequence + 1) & 0xffff;
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = `${bytes[0].toString(16).padStart(8, "0")}${bytes[1].toString(16).padStart(8, "0")}`;
  const variant = ((bytes[1] >>> 16) & 0x3fff) | 0x8000;
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-4${random.slice(0, 3)}-${variant.toString(16).padStart(4, "0")}-${random.slice(3)}${fallbackSequence.toString(16).padStart(4, "0")}`;
}
