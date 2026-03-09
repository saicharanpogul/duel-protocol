import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE"
);

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export function findPda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

export function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

function u64ToLEBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let val = num;
  for (let i = 0; i < 8; i++) {
    bytes[i] = val & 0xff;
    val = Math.floor(val / 256);
  }
  return bytes;
}

export function deriveMarket(creator: PublicKey, marketId: number) {
  const idBytes = u64ToLEBytes(marketId);

  const [market] = findPda([
    Buffer.from("market"),
    creator.toBuffer(),
    idBytes,
  ]);
  const [sideA] = findPda([
    Buffer.from("side"),
    market.toBuffer(),
    new Uint8Array([0]),
  ]);
  const [sideB] = findPda([
    Buffer.from("side"),
    market.toBuffer(),
    new Uint8Array([1]),
  ]);
  const [mintA] = findPda([
    Buffer.from("mint"),
    market.toBuffer(),
    new Uint8Array([0]),
  ]);
  const [mintB] = findPda([
    Buffer.from("mint"),
    market.toBuffer(),
    new Uint8Array([1]),
  ]);
  const [tvA] = findPda([
    Buffer.from("token_vault"),
    market.toBuffer(),
    new Uint8Array([0]),
  ]);
  const [tvB] = findPda([
    Buffer.from("token_vault"),
    market.toBuffer(),
    new Uint8Array([1]),
  ]);
  const [svA] = findPda([
    Buffer.from("sol_vault"),
    market.toBuffer(),
    new Uint8Array([0]),
  ]);
  const [svB] = findPda([
    Buffer.from("sol_vault"),
    market.toBuffer(),
    new Uint8Array([1]),
  ]);

  return { market, sideA, sideB, mintA, mintB, tvA, tvB, svA, svB };
}
