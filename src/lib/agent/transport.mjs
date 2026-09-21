/** JSON transports need an explicit binary envelope; native JS callers retain
 * ArrayBuffer/typed-array results from the same API. */
export function agentJSONValue(value) {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return {
      encoding: 'base64',
      type: value.constructor.name,
      byteLength: bytes.length,
      base64: btoa(binary),
    };
  }
  if (Array.isArray(value)) return value.map(agentJSONValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, agentJSONValue(item)]),
    );
  return value;
}
