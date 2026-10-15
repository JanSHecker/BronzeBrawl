import { open } from 'fs/promises';
import { BadRequestException } from '@nestjs/common';

/** Independently implemented ROFL1 structural validation (not replay decryption). */
export async function validateRofl(path: string, size: number, matchId: string, version: string): Promise<void> {
  const file = await open(path, 'r');
  try {
    if (size < 323) throw new Error();
    const header = Buffer.alloc(288);
    if ((await file.read(header, 0, 288, 0)).bytesRead !== 288 || !header.subarray(0, 6).equals(Buffer.from('RIOT\0\0', 'binary'))) throw new Error();
    const headerLength = header.readUInt16LE(262), fileLength = header.readUInt32LE(264);
    const metadataOffset = header.readUInt32LE(268), metadataLength = header.readUInt32LE(272);
    const payloadHeaderOffset = header.readUInt32LE(276), payloadHeaderLength = header.readUInt32LE(280), payloadOffset = header.readUInt32LE(284);
    if (headerLength !== 288 || fileLength !== size || metadataOffset !== headerLength || metadataLength < 2 || metadataLength > 1024 * 1024 ||
        payloadHeaderOffset !== metadataOffset + metadataLength || payloadHeaderLength < 34 || payloadHeaderLength > 4096 ||
        payloadOffset !== payloadHeaderOffset + payloadHeaderLength || payloadOffset >= size) throw new Error();
    const metadata = Buffer.alloc(metadataLength);
    if ((await file.read(metadata, 0, metadataLength, metadataOffset)).bytesRead !== metadataLength) throw new Error();
    const meta = JSON.parse(metadata.toString('utf8'));
    if (!meta || typeof meta !== 'object' || (meta.gameVersion !== undefined && meta.gameVersion !== version)) throw new Error();
    const payload = Buffer.alloc(payloadHeaderLength);
    if ((await file.read(payload, 0, payload.length, payloadHeaderOffset)).bytesRead !== payload.length ||
        payload.readBigUInt64LE(0) !== BigInt(matchId.split('_')[1])) throw new Error();
  } catch { throw new BadRequestException('Invalid or unsupported ROFL header, file length, match identity or version'); }
  finally { await file.close(); }
}
