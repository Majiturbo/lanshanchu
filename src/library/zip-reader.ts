import type JSZip from "jszip";

const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

interface ZipRecord { size: number; crc: number }

function records(bytes: Uint8Array): Map<string, ZipRecord> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("压缩包目录无法读取");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES || count === 0xffff || start === 0xffffffff || size === 0xffffffff)
    throw new Error("压缩包包含过多条目或不支持的超大目录");
  if (start + size > end) throw new Error("压缩包目录位置错误");
  const result = new Map<string, ZipRecord>();
  let offset = start;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) throw new Error("压缩包目录损坏");
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error("不支持超大压缩条目");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > start + size) throw new Error("压缩包目录损坏");
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    result.set(name, { size: uncompressed, crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== start + size) throw new Error("压缩包目录损坏");
  return result;
}

function updateCrc(crc: number, chunk: Uint8Array): number {
  for (const byte of chunk) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc;
}

export class BoundedZipReader {
  private total = 0;

  private constructor(private readonly zip: JSZip, private readonly metadata: Map<string, ZipRecord>) {}

  static async open(bytes: Uint8Array): Promise<BoundedZipReader> {
    const metadata = records(bytes);
    const { default: JSZip } = await import("jszip");
    return new BoundedZipReader(await JSZip.loadAsync(bytes), metadata);
  }

  async read(path: string): Promise<string> {
    const file = this.zip.file(path);
    const record = this.metadata.get(path);
    if (!file || !record) throw new Error(`缺少 ${path}`);
    if (record.size > MAX_ENTRY_BYTES || this.total + record.size > MAX_ARCHIVE_TEXT_BYTES)
      throw new Error("压缩文档展开后超过读取上限");

    const stream = (file as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let length = 0;
    let crc = -1;
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        stream.pause();
        reject(error);
      };
      stream.on("data", (chunk) => {
        if (settled) return;
        length += chunk.length;
        if (length > record.size || this.total + length > MAX_ARCHIVE_TEXT_BYTES || length > MAX_ENTRY_BYTES) {
          fail(new Error("压缩文档展开后超过读取上限"));
          return;
        }
        crc = updateCrc(crc, chunk);
        chunks.push(chunk);
      });
      stream.on("error", fail);
      stream.on("end", () => {
        if (settled) return;
        if (length !== record.size || (crc ^ -1) >>> 0 !== record.crc) {
          fail(new Error(`压缩条目损坏：${path}`));
          return;
        }
        settled = true;
        const output = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
        resolve(output);
      });
      stream.resume();
    });
    this.total += length;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}
