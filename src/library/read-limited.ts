export async function readLimitedBytes(response: Response, limit: number, label: string): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") ?? 0) > limit) throw new Error(`${label}超过容量限制`);
  if (!response.body) throw new Error(`${label}没有可读取的内容`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(`${label}超过容量限制`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
