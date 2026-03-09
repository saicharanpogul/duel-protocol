import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE"
);

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export function findPda(seeds: Buffer[]) {
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

export function deriveMarket(creator: PublicKey, marketId: number) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId));

  const [market] = findPda([
    Buffer.from("market"),
    creator.toBuffer(),
    idBuf,
  ]);
  const [sideA] = findPda([
    Buffer.from("side"),
    market.toBuffer(),
    Buffer.from([0]),
  ]);
  const [sideB] = findPda([
    Buffer.from("side"),
    market.toBuffer(),
    Buffer.from([1]),
  ]);
  const [mintA] = findPda([
    Buffer.from("mint"),
    market.toBuffer(),
    Buffer.from([0]),
  ]);
  const [mintB] = findPda([
    Buffer.from("mint"),
    market.toBuffer(),
    Buffer.from([1]),
  ]);
  const [tvA] = findPda([
    Buffer.from("token_vault"),
    market.toBuffer(),
    Buffer.from([0]),
  ]);
  const [tvB] = findPda([
    Buffer.from("token_vault"),
    market.toBuffer(),
    Buffer.from([1]),
  ]);
  const [svA] = findPda([
    Buffer.from("sol_vault"),
    market.toBuffer(),
    Buffer.from([0]),
  ]);
  const [svB] = findPda([
    Buffer.from("sol_vault"),
    market.toBuffer(),
    Buffer.from([1]),
  ]);

  return { market, sideA, sideB, mintA, mintB, tvA, tvB, svA, svB };
}
