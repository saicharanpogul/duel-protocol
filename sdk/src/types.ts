/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/duel.json`.
 */
export type Duel = {
  "address": "CgR6V1AxC7exDFNoh3Q5JP9aea9YuPqq283EwACUGpZE",
  "metadata": {
    "name": "duel",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Duel Protocol: binary outcome markets with TWAP-resolved bonding curves"
  },
  "instructions": [
    {
      "name": "buyTokens",
      "discriminator": [
        189,
        21,
        230,
        133,
        247,
        2,
        110,
        42
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for the selected side (needed for transfer_checked)"
          ]
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault for the selected side"
          ],
          "writable": true
        },
        {
          "name": "buyerTokenAccount",
          "docs": [
            "Buyer's token account for the selected side"
          ],
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint (WSOL, USDC, etc.)"
          ]
        },
        {
          "name": "quoteVault",
          "docs": [
            "Quote vault for the selected side"
          ],
          "writable": true
        },
        {
          "name": "buyerQuoteAccount",
          "docs": [
            "Buyer's quote token account (WSOL ATA, USDC ATA, etc.)"
          ],
          "writable": true
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (pause check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program (may differ for Token-2022)"
          ]
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "solAmount",
          "type": "u64"
        },
        {
          "name": "minTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimPoolFees",
      "discriminator": [
        33,
        187,
        125,
        186,
        41,
        247,
        236,
        89
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Market creator or protocol admin"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (for admin check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "sideAccount",
          "docs": [
            "Side account being claimed for"
          ]
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for this side"
          ]
        },
        {
          "name": "wsolMint",
          "docs": [
            "WSOL mint"
          ]
        },
        {
          "name": "poolAuthority",
          "docs": [
            "Pool authority (const PDA of DAMM v2)"
          ]
        },
        {
          "name": "pool",
          "docs": [
            "Meteora pool"
          ]
        },
        {
          "name": "position",
          "docs": [
            "Position PDA"
          ],
          "writable": true
        },
        {
          "name": "feeReceiverTokenA",
          "docs": [
            "Fee receiver's token A account (receives claimed token fees)"
          ],
          "writable": true
        },
        {
          "name": "feeReceiverTokenB",
          "docs": [
            "Fee receiver's token B account (receives claimed WSOL fees)"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "Pool's token A vault"
          ],
          "writable": true
        },
        {
          "name": "tokenBVault",
          "docs": [
            "Pool's token B vault"
          ],
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "Position NFT token account (market PDA is the authority)"
          ]
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token A program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token B program"
          ]
        },
        {
          "name": "eventAuthority",
          "docs": [
            "Event authority PDA of DAMM v2"
          ]
        },
        {
          "name": "meteoraProgram",
          "docs": [
            "Meteora DAMM v2 program"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        }
      ]
    },
    {
      "name": "closeMarket",
      "discriminator": [
        88,
        154,
        248,
        186,
        48,
        14,
        123,
        244
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Market creator or protocol admin"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideA",
          "writable": true
        },
        {
          "name": "sideB",
          "writable": true
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (for admin check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        }
      ]
    },
    {
      "name": "closePosition",
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Market creator or protocol admin"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (for admin check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "sideAccount"
        },
        {
          "name": "positionNftMint",
          "docs": [
            "Position NFT mint (mut)"
          ],
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "Position NFT token account (mut)"
          ],
          "writable": true
        },
        {
          "name": "pool",
          "docs": [
            "Pool (mut)"
          ],
          "writable": true
        },
        {
          "name": "position",
          "docs": [
            "Position (mut, close)"
          ],
          "writable": true
        },
        {
          "name": "poolAuthority",
          "docs": [
            "Pool authority"
          ]
        },
        {
          "name": "rentReceiver",
          "docs": [
            "Rent receiver"
          ],
          "writable": true
        },
        {
          "name": "token2022Program",
          "docs": [
            "Token-2022 program (for NFT burning)"
          ]
        },
        {
          "name": "eventAuthority",
          "docs": [
            "Event authority PDA"
          ]
        },
        {
          "name": "meteoraProgram",
          "docs": [
            "Meteora DAMM v2 program"
          ]
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        }
      ]
    },
    {
      "name": "closeQuoteVault",
      "discriminator": [
        35,
        15,
        73,
        197,
        180,
        181,
        218,
        189
      ],
      "accounts": [
        {
          "name": "closer",
          "docs": [
            "Anyone can close — rent goes to rent_receiver"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "sideAccount"
        },
        {
          "name": "quoteVault",
          "docs": [
            "Quote vault to close"
          ],
          "writable": true
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault to close (optional — only if empty)"
          ],
          "writable": true
        },
        {
          "name": "rentReceiver",
          "docs": [
            "Receives rent from closed accounts"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program (may differ for Token-2022)"
          ]
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        }
      ]
    },
    {
      "name": "emergencyResolve",
      "discriminator": [
        63,
        112,
        185,
        42,
        47,
        61,
        232,
        79
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Anyone can trigger emergency resolution after the window passes"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "config",
          "docs": [
            "Protocol config"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "sideA",
          "writable": true
        },
        {
          "name": "sideB",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "graduateToDex",
      "discriminator": [
        83,
        110,
        46,
        201,
        206,
        12,
        95,
        44
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Market creator or permissionless caller — pays rent for new accounts"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideAccount",
          "docs": [
            "Side account being graduated"
          ],
          "writable": true
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for this side"
          ],
          "writable": true
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault for this side (source of tokens to seed pool)"
          ],
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint"
          ]
        },
        {
          "name": "quoteVault",
          "docs": [
            "Quote vault — checked for minimum reserve"
          ],
          "writable": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program"
          ]
        },
        {
          "name": "wsolMint",
          "docs": [
            "WSOL mint (So11111111111111111111111111111111111111112)"
          ]
        },
        {
          "name": "positionNftMint",
          "docs": [
            "Position NFT mint — a new keypair, signer"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "Position NFT token account — PDA: [\"position_nft_account\", position_nft_mint]"
          ],
          "writable": true
        },
        {
          "name": "poolAuthority",
          "docs": [
            "Pool authority (const PDA of DAMM v2)"
          ]
        },
        {
          "name": "pool",
          "docs": [
            "Meteora pool PDA: [\"customizable_pool\", max(mintA, mintB), min(mintA, mintB)]"
          ],
          "writable": true
        },
        {
          "name": "position",
          "docs": [
            "Position PDA: [\"position\", position_nft_mint]"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "docs": [
            "Token A vault for the pool — PDA: [\"token_vault\", token_a_mint, pool]"
          ],
          "writable": true
        },
        {
          "name": "tokenBVault",
          "docs": [
            "Token B vault for the pool — PDA: [\"token_vault\", token_b_mint, pool]"
          ],
          "writable": true
        },
        {
          "name": "payerTokenA",
          "docs": [
            "Market PDA's token A account (pre-created, holds tokens to seed)"
          ],
          "writable": true
        },
        {
          "name": "payerTokenB",
          "docs": [
            "Market PDA's WSOL account (pre-created and funded with wrapped SOL)"
          ],
          "writable": true
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token A's token program (SPL Token or Token-2022)"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token B's token program (SPL Token for WSOL)"
          ]
        },
        {
          "name": "token2022Program",
          "docs": [
            "Token-2022 program (for position NFT)"
          ]
        },
        {
          "name": "eventAuthority",
          "docs": [
            "Event authority PDA: [\"__event_authority\"] of DAMM v2"
          ]
        },
        {
          "name": "meteoraProgram",
          "docs": [
            "Meteora DAMM v2 program"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "protocolFeeAccount"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "defaultProtocolFeeBps",
          "type": "u16"
        },
        {
          "name": "marketCreationFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeMarket",
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "sideA",
          "writable": true
        },
        {
          "name": "sideB",
          "writable": true
        },
        {
          "name": "tokenMintA",
          "writable": true
        },
        {
          "name": "tokenMintB",
          "writable": true
        },
        {
          "name": "tokenVaultA",
          "writable": true
        },
        {
          "name": "tokenVaultB",
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint (WSOL, USDC, etc.)"
          ]
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program (may differ from side token program for Token-2022)"
          ]
        },
        {
          "name": "quoteVaultA",
          "docs": [
            "Quote vault for Side A"
          ],
          "writable": true
        },
        {
          "name": "quoteVaultB",
          "docs": [
            "Quote vault for Side B"
          ],
          "writable": true
        },
        {
          "name": "protocolFeeAccount",
          "docs": [
            "Protocol fee recipient — must match config"
          ]
        },
        {
          "name": "config",
          "docs": [
            "Program config (pause check + market creation fee)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "metadataA",
          "docs": [
            "Metadata account for token A"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "const",
                "value": [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintA"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          "name": "metadataB",
          "docs": [
            "Metadata account for token B"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "const",
                "value": [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                "kind": "account",
                "path": "tokenMintB"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          "name": "tokenMetadataProgram",
          "docs": [
            "Metaplex Token Metadata Program"
          ]
        },
        {
          "name": "creatorFeeAccount",
          "docs": [
            "Creator fee recipient — must be a valid account"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "twapWindow",
          "type": "u64"
        },
        {
          "name": "twapInterval",
          "type": "u64"
        },
        {
          "name": "battleTaxBps",
          "type": "u16"
        },
        {
          "name": "protocolFeeBps",
          "type": "u16"
        },
        {
          "name": "sellPenaltyMaxBps",
          "type": "u16"
        },
        {
          "name": "protectionActivationOffset",
          "type": "u64"
        },
        {
          "name": "curveParams",
          "type": {
            "defined": {
              "name": "curveParams"
            }
          }
        },
        {
          "name": "totalSupplyPerSide",
          "type": "u64"
        },
        {
          "name": "nameA",
          "type": "string"
        },
        {
          "name": "symbolA",
          "type": "string"
        },
        {
          "name": "uriA",
          "type": "string"
        },
        {
          "name": "nameB",
          "type": "string"
        },
        {
          "name": "symbolB",
          "type": "string"
        },
        {
          "name": "uriB",
          "type": "string"
        },
        {
          "name": "lpLockMode",
          "type": {
            "defined": {
              "name": "lpLockMode"
            }
          }
        },
        {
          "name": "maxObservationChangePerUpdate",
          "type": "u64"
        },
        {
          "name": "minTwapSpreadBps",
          "type": "u16"
        },
        {
          "name": "creatorFeeBps",
          "type": "u16"
        },
        {
          "name": "resolutionMode",
          "type": {
            "defined": {
              "name": "resolutionMode"
            }
          }
        },
        {
          "name": "oracleAuthority",
          "type": "pubkey"
        },
        {
          "name": "oracleDisputeWindow",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lockPosition",
      "discriminator": [
        227,
        62,
        2,
        252,
        247,
        10,
        171,
        185
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "sideAccount"
        },
        {
          "name": "pool",
          "docs": [
            "Pool (mut)"
          ],
          "writable": true
        },
        {
          "name": "position",
          "docs": [
            "Position (mut)"
          ],
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "Position NFT token account"
          ]
        },
        {
          "name": "eventAuthority",
          "docs": [
            "Event authority PDA"
          ]
        },
        {
          "name": "meteoraProgram",
          "docs": [
            "Meteora DAMM v2 program"
          ]
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "lockLiquidity",
          "type": "u128"
        }
      ]
    },
    {
      "name": "recordTwapSample",
      "discriminator": [
        31,
        68,
        141,
        56,
        246,
        237,
        63,
        5
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Anyone can crank (permissionless)"
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideA",
          "writable": true
        },
        {
          "name": "sideB",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "removeLiquidity",
      "discriminator": [
        80,
        85,
        209,
        72,
        24,
        206,
        177,
        108
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Market creator or protocol admin"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market"
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (for admin check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "sideAccount"
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for this side"
          ]
        },
        {
          "name": "wsolMint",
          "docs": [
            "WSOL mint"
          ]
        },
        {
          "name": "poolAuthority"
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "tokenAAccount",
          "docs": [
            "Token A account to receive withdrawn tokens"
          ],
          "writable": true
        },
        {
          "name": "tokenBAccount",
          "docs": [
            "Token B account to receive withdrawn WSOL"
          ],
          "writable": true
        },
        {
          "name": "tokenAVault",
          "writable": true
        },
        {
          "name": "tokenBVault",
          "writable": true
        },
        {
          "name": "positionNftAccount",
          "docs": [
            "Position NFT token account"
          ]
        },
        {
          "name": "tokenAProgram",
          "docs": [
            "Token A program"
          ]
        },
        {
          "name": "tokenBProgram",
          "docs": [
            "Token B program"
          ]
        },
        {
          "name": "eventAuthority",
          "docs": [
            "Event authority PDA"
          ]
        },
        {
          "name": "meteoraProgram"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "liquidityDelta",
          "type": "u128"
        },
        {
          "name": "minTokenA",
          "type": "u64"
        },
        {
          "name": "minTokenB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolveMarket",
      "discriminator": [
        155,
        23,
        80,
        173,
        46,
        74,
        23,
        239
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Anyone can resolve (permissionless)"
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideA",
          "writable": true
        },
        {
          "name": "sideB",
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint"
          ]
        },
        {
          "name": "quoteVaultA",
          "docs": [
            "Quote vault for Side A"
          ],
          "writable": true
        },
        {
          "name": "quoteVaultB",
          "docs": [
            "Quote vault for Side B"
          ],
          "writable": true
        },
        {
          "name": "protocolFeeAccount",
          "docs": [
            "Protocol fee recipient (quote token account)"
          ],
          "writable": true
        },
        {
          "name": "creatorFeeAccount",
          "docs": [
            "Creator fee recipient (quote token account)"
          ],
          "writable": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "resolveWithOracle",
      "discriminator": [
        241,
        145,
        153,
        184,
        228,
        144,
        92,
        224
      ],
      "accounts": [
        {
          "name": "oracle",
          "docs": [
            "Oracle authority — must match market.oracle_authority"
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideA",
          "writable": true
        },
        {
          "name": "sideB",
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint"
          ]
        },
        {
          "name": "quoteVaultA",
          "docs": [
            "Quote vault for Side A"
          ],
          "writable": true
        },
        {
          "name": "quoteVaultB",
          "docs": [
            "Quote vault for Side B"
          ],
          "writable": true
        },
        {
          "name": "protocolFeeAccount",
          "docs": [
            "Protocol fee recipient (quote token account)"
          ],
          "writable": true
        },
        {
          "name": "creatorFeeAccount",
          "docs": [
            "Creator fee recipient (quote token account)"
          ],
          "writable": true
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program"
          ]
        }
      ],
      "args": [
        {
          "name": "winningSide",
          "type": "u8"
        }
      ]
    },
    {
      "name": "sellPostResolution",
      "discriminator": [
        243,
        79,
        134,
        107,
        9,
        167,
        154,
        243
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for the selected side (needed for transfer_checked)"
          ]
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault for the selected side"
          ],
          "writable": true
        },
        {
          "name": "sellerTokenAccount",
          "docs": [
            "Seller's token account"
          ],
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint"
          ]
        },
        {
          "name": "quoteVault",
          "docs": [
            "Quote vault for the selected side"
          ],
          "writable": true
        },
        {
          "name": "sellerQuoteAccount",
          "docs": [
            "Seller's quote token account"
          ],
          "writable": true
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (pause check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program"
          ]
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tokenAmount",
          "type": "u64"
        },
        {
          "name": "minSolOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sellTokens",
      "discriminator": [
        114,
        242,
        25,
        12,
        62,
        126,
        92,
        2
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "sideAccount",
          "writable": true
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for the selected side (needed for transfer_checked)"
          ]
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault for the selected side"
          ],
          "writable": true
        },
        {
          "name": "sellerTokenAccount",
          "docs": [
            "Seller's token account"
          ],
          "writable": true
        },
        {
          "name": "quoteMint",
          "docs": [
            "Quote token mint"
          ]
        },
        {
          "name": "quoteVault",
          "docs": [
            "Quote vault for the selected side"
          ],
          "writable": true
        },
        {
          "name": "sellerQuoteAccount",
          "docs": [
            "Seller's quote token account"
          ],
          "writable": true
        },
        {
          "name": "config",
          "docs": [
            "Protocol config (pause check)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "quoteTokenProgram",
          "docs": [
            "Quote token program"
          ]
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "tokenAmount",
          "type": "u64"
        },
        {
          "name": "minSolOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "newProtocolFeeAccount",
          "optional": true
        },
        {
          "name": "newAdmin",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": {
            "option": "bool"
          }
        },
        {
          "name": "defaultProtocolFeeBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "marketCreationFee",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "minMarketDuration",
          "type": {
            "option": "u64"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "programConfig",
      "discriminator": [
        196,
        210,
        90,
        231,
        144,
        149,
        140,
        63
      ]
    },
    {
      "name": "side",
      "discriminator": [
        152,
        5,
        114,
        60,
        29,
        214,
        47,
        183
      ]
    }
  ],
  "events": [
    {
      "name": "configUpdated",
      "discriminator": [
        40,
        241,
        230,
        122,
        11,
        19,
        198,
        194
      ]
    },
    {
      "name": "emergencyResolved",
      "discriminator": [
        40,
        211,
        201,
        14,
        244,
        64,
        175,
        239
      ]
    },
    {
      "name": "marketClosed",
      "discriminator": [
        86,
        91,
        119,
        43,
        94,
        0,
        217,
        113
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "tokensBought",
      "discriminator": [
        151,
        148,
        173,
        226,
        128,
        30,
        249,
        190
      ]
    },
    {
      "name": "tokensGraduated",
      "discriminator": [
        5,
        121,
        149,
        210,
        62,
        223,
        221,
        24
      ]
    },
    {
      "name": "tokensSold",
      "discriminator": [
        217,
        83,
        68,
        137,
        134,
        225,
        94,
        45
      ]
    },
    {
      "name": "twapSampled",
      "discriminator": [
        42,
        84,
        142,
        34,
        93,
        69,
        65,
        147
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "marketExpired",
      "msg": "Market has passed its deadline"
    },
    {
      "code": 6001,
      "name": "marketNotExpired",
      "msg": "Market has not reached its deadline yet"
    },
    {
      "code": 6002,
      "name": "marketAlreadyResolved",
      "msg": "Market is already resolved"
    },
    {
      "code": 6003,
      "name": "marketNotResolved",
      "msg": "Market is not resolved yet"
    },
    {
      "code": 6004,
      "name": "notInTwapWindow",
      "msg": "Not within TWAP observation window"
    },
    {
      "code": 6005,
      "name": "twapSampleTooEarly",
      "msg": "TWAP sample too early, interval not elapsed"
    },
    {
      "code": 6006,
      "name": "noTwapSamples",
      "msg": "No TWAP samples recorded"
    },
    {
      "code": 6007,
      "name": "insufficientSolAmount",
      "msg": "Insufficient SOL amount"
    },
    {
      "code": 6008,
      "name": "insufficientTokenBalance",
      "msg": "Insufficient token balance"
    },
    {
      "code": 6009,
      "name": "insufficientReserve",
      "msg": "Insufficient reserve for withdrawal"
    },
    {
      "code": 6010,
      "name": "slippageExceeded",
      "msg": "Slippage tolerance exceeded"
    },
    {
      "code": 6011,
      "name": "invalidSide",
      "msg": "Invalid side index"
    },
    {
      "code": 6012,
      "name": "invalidCurveParams",
      "msg": "Invalid curve parameters"
    },
    {
      "code": 6013,
      "name": "invalidMarketConfig",
      "msg": "Invalid market configuration"
    },
    {
      "code": 6014,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6015,
      "name": "alreadyGraduated",
      "msg": "Side already graduated to DEX"
    },
    {
      "code": 6016,
      "name": "insufficientReserveForGraduation",
      "msg": "Insufficient reserve for DEX graduation"
    },
    {
      "code": 6017,
      "name": "notGraduated",
      "msg": "Side must be graduated before vault closure"
    },
    {
      "code": 6018,
      "name": "lpLocked",
      "msg": "LP is permanently locked, cannot remove liquidity or close position"
    },
    {
      "code": 6019,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6020,
      "name": "drawResult",
      "msg": "TWAP spread below minimum threshold, resolved as draw"
    },
    {
      "code": 6021,
      "name": "invalidFeeConfig",
      "msg": "Invalid fee configuration"
    },
    {
      "code": 6022,
      "name": "oracleNotAllowed",
      "msg": "Oracle resolution not allowed for this market"
    },
    {
      "code": 6023,
      "name": "twapNotAllowed",
      "msg": "TWAP resolution not allowed for this market (oracle-only mode)"
    },
    {
      "code": 6024,
      "name": "oracleDisputeWindowActive",
      "msg": "Oracle dispute window has not expired yet"
    },
    {
      "code": 6025,
      "name": "unauthorizedOracle",
      "msg": "Unauthorized oracle authority"
    },
    {
      "code": 6026,
      "name": "invalidWinningSide",
      "msg": "Invalid winning side (must be 0 or 1)"
    },
    {
      "code": 6027,
      "name": "reentrancyLocked",
      "msg": "Market is currently locked (re-entrancy protection)"
    },
    {
      "code": 6028,
      "name": "emergencyResolveTooEarly",
      "msg": "Emergency resolution window has not passed yet"
    }
  ],
  "types": [
    {
      "name": "configUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "defaultProtocolFeeBps",
            "type": "u16"
          },
          {
            "name": "marketCreationFee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "a",
            "docs": [
              "Steepness coefficient (scaled by 10^9)"
            ],
            "type": "u64"
          },
          {
            "name": "n",
            "docs": [
              "Exponent (1 = linear, 2 = quadratic, 3 = cubic)"
            ],
            "type": "u8"
          },
          {
            "name": "b",
            "docs": [
              "Base price in quote token smallest units"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "emergencyResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lpLockMode",
      "docs": [
        "LP lock mode — configurable at market creation.",
        "Determines whether LP liquidity can be withdrawn after graduation."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "unlocked"
          },
          {
            "name": "permanentLock"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Market creator"
            ],
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "docs": [
              "Unique ID per creator"
            ],
            "type": "u64"
          },
          {
            "name": "sideA",
            "docs": [
              "Side A PDA"
            ],
            "type": "pubkey"
          },
          {
            "name": "sideB",
            "docs": [
              "Side B PDA"
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "Quote token mint (WSOL, USDC, etc.)"
            ],
            "type": "pubkey"
          },
          {
            "name": "deadline",
            "docs": [
              "Unix timestamp deadline"
            ],
            "type": "i64"
          },
          {
            "name": "twapWindow",
            "docs": [
              "TWAP observation window in seconds"
            ],
            "type": "u64"
          },
          {
            "name": "twapInterval",
            "docs": [
              "TWAP sampling interval in seconds"
            ],
            "type": "u64"
          },
          {
            "name": "battleTaxBps",
            "docs": [
              "Battle tax in basis points (0-10000)"
            ],
            "type": "u16"
          },
          {
            "name": "protocolFeeBps",
            "docs": [
              "Protocol fee in basis points (0-500)"
            ],
            "type": "u16"
          },
          {
            "name": "sellPenaltyMaxBps",
            "docs": [
              "Max sell penalty in basis points (0-3000)"
            ],
            "type": "u16"
          },
          {
            "name": "protectionActivationOffset",
            "docs": [
              "Seconds before deadline when sell penalty activates"
            ],
            "type": "u64"
          },
          {
            "name": "curveParams",
            "docs": [
              "Bonding curve parameters"
            ],
            "type": {
              "defined": {
                "name": "curveParams"
              }
            }
          },
          {
            "name": "maxObservationChangePerUpdate",
            "docs": [
              "Max observation change per TWAP update (0 = raw price, >0 = lagging filter)"
            ],
            "type": "u64"
          },
          {
            "name": "minTwapSpreadBps",
            "docs": [
              "Min TWAP spread in bps to determine winner (0 = any difference, >0 = draw if below)"
            ],
            "type": "u16"
          },
          {
            "name": "creatorFeeBps",
            "docs": [
              "Creator fee in basis points (deducted from transfer before protocol fee)"
            ],
            "type": "u16"
          },
          {
            "name": "creatorFeeAccount",
            "docs": [
              "Creator fee recipient"
            ],
            "type": "pubkey"
          },
          {
            "name": "status",
            "docs": [
              "Current market status"
            ],
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "twapSamplesCount",
            "docs": [
              "Number of TWAP samples recorded"
            ],
            "type": "u32"
          },
          {
            "name": "lastSampleTs",
            "docs": [
              "Timestamp of last TWAP sample"
            ],
            "type": "i64"
          },
          {
            "name": "winner",
            "docs": [
              "Winner side index (0 = A, 1 = B), None if not resolved or draw"
            ],
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "finalTwapA",
            "docs": [
              "Final TWAP for side A (quote token units, price * 10^9 for precision)"
            ],
            "type": "u64"
          },
          {
            "name": "finalTwapB",
            "docs": [
              "Final TWAP for side B"
            ],
            "type": "u64"
          },
          {
            "name": "protocolFeeAccount",
            "docs": [
              "Protocol fee recipient"
            ],
            "type": "pubkey"
          },
          {
            "name": "graduatedA",
            "docs": [
              "Whether Side A has graduated to DEX"
            ],
            "type": "bool"
          },
          {
            "name": "graduatedB",
            "docs": [
              "Whether Side B has graduated to DEX"
            ],
            "type": "bool"
          },
          {
            "name": "lpLockMode",
            "docs": [
              "LP lock mode (set at creation, governs post-graduation LP behavior)"
            ],
            "type": {
              "defined": {
                "name": "lpLockMode"
              }
            }
          },
          {
            "name": "resolutionMode",
            "docs": [
              "Resolution mode (Twap, Oracle, or OracleWithTwapFallback)"
            ],
            "type": {
              "defined": {
                "name": "resolutionMode"
              }
            }
          },
          {
            "name": "oracleAuthority",
            "docs": [
              "Oracle authority (required if resolution_mode != Twap)"
            ],
            "type": "pubkey"
          },
          {
            "name": "oracleDisputeWindow",
            "docs": [
              "Dispute window in seconds after deadline (for OracleWithTwapFallback)"
            ],
            "type": "u64"
          },
          {
            "name": "emergencyWindow",
            "docs": [
              "Emergency resolution window in seconds after deadline (draw fallback)"
            ],
            "type": "u64"
          },
          {
            "name": "locked",
            "docs": [
              "Re-entrancy lock (prevents concurrent buy/sell during CPI)"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "battleTaxBps",
            "type": "u16"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "winner",
            "type": "u8"
          },
          {
            "name": "isDraw",
            "type": "bool"
          },
          {
            "name": "finalTwapA",
            "type": "u64"
          },
          {
            "name": "finalTwapB",
            "type": "u64"
          },
          {
            "name": "transferAmount",
            "type": "u64"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "creatorFee",
            "type": "u64"
          },
          {
            "name": "resolutionMode",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "twapObservation"
          },
          {
            "name": "resolved"
          }
        ]
      }
    },
    {
      "name": "programConfig",
      "docs": [
        "Global protocol configuration, owned by admin.",
        "PDA: [b\"config\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Admin authority (can pause, update config, transfer admin)"
            ],
            "type": "pubkey"
          },
          {
            "name": "paused",
            "docs": [
              "Emergency pause flag"
            ],
            "type": "bool"
          },
          {
            "name": "defaultProtocolFeeBps",
            "docs": [
              "Default protocol fee in basis points"
            ],
            "type": "u16"
          },
          {
            "name": "protocolFeeAccount",
            "docs": [
              "Protocol fee recipient"
            ],
            "type": "pubkey"
          },
          {
            "name": "marketCreationFee",
            "docs": [
              "Market creation fee in lamports (0 = free)"
            ],
            "type": "u64"
          },
          {
            "name": "minMarketDuration",
            "docs": [
              "Minimum market duration in seconds (admin-configurable)"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "resolutionMode",
      "docs": [
        "Resolution mode — determines how a market outcome is decided."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "twap"
          },
          {
            "name": "oracle"
          },
          {
            "name": "oracleWithTwapFallback"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "docs": [
              "Parent market PDA"
            ],
            "type": "pubkey"
          },
          {
            "name": "sideIndex",
            "docs": [
              "Side index (0 = A, 1 = B)"
            ],
            "type": "u8"
          },
          {
            "name": "tokenMint",
            "docs": [
              "Token mint for this side"
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenReserveVault",
            "docs": [
              "Vault holding unsold/returned tokens"
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteReserveVault",
            "docs": [
              "Vault holding quote tokens (WSOL, USDC, etc.) from buys"
            ],
            "type": "pubkey"
          },
          {
            "name": "totalSupply",
            "docs": [
              "Fixed total supply (set at creation)"
            ],
            "type": "u64"
          },
          {
            "name": "circulatingSupply",
            "docs": [
              "Tokens currently held by participants"
            ],
            "type": "u64"
          },
          {
            "name": "peakReserve",
            "docs": [
              "Historical max quote reserve (for sell penalty calc)"
            ],
            "type": "u64"
          },
          {
            "name": "twapAccumulator",
            "docs": [
              "Sum of price samples for TWAP (u128 to prevent overflow)"
            ],
            "type": "u128"
          },
          {
            "name": "lastObservation",
            "docs": [
              "Last observation value for lagging TWAP (0 if disabled or first sample)"
            ],
            "type": "u64"
          },
          {
            "name": "penaltyAccumulated",
            "docs": [
              "Accumulated sell penalty (quote tokens retained in vault beyond curve math)"
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tokensBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          },
          {
            "name": "tokensReceived",
            "type": "u64"
          },
          {
            "name": "newPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokensGraduated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "dexPool",
            "type": "pubkey"
          },
          {
            "name": "solSeeded",
            "type": "u64"
          },
          {
            "name": "tokensSeeded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokensSold",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "tokenAmount",
            "type": "u64"
          },
          {
            "name": "quoteReceived",
            "type": "u64"
          },
          {
            "name": "penaltyApplied",
            "type": "u64"
          },
          {
            "name": "newPrice",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "twapSampled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "priceA",
            "type": "u64"
          },
          {
            "name": "priceB",
            "type": "u64"
          },
          {
            "name": "observationA",
            "type": "u64"
          },
          {
            "name": "observationB",
            "type": "u64"
          },
          {
            "name": "sampleCount",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
