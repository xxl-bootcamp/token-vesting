import * as anchor from "@coral-xyz/anchor";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BankrunProvider } from "anchor-bankrun";
import { BanksClient, Clock, ProgramTestContext, startAnchor } from "solana-bankrun";
import { mintTo, createMint } from "spl-token-bankrun";

import VestingIDL from "../target/idl/vesting.json";
import type { Vesting } from "../target/types/vesting";
import { BN } from "@coral-xyz/anchor";

describe("Vesting", () => {
  const companyName = "test company name";
  let beneficary: Keypair;
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: anchor.Program<Vesting>;
  let banksClient: BanksClient;
  let employer: Keypair;
  let mint: PublicKey;

  let beneficaryProvider: BankrunProvider;
  let program2: anchor.Program<Vesting>;
  let vestingAccountKey: PublicKey;
  let treasuryAccount: PublicKey;
  let employeeAccount: PublicKey;

  beforeAll(async () => {
    beneficary = new anchor.web3.Keypair();
    context = await startAnchor(
      "",
      [{ name: "vesting", programId: new PublicKey(VestingIDL.address) }],
      [
        {
          address: beneficary.publicKey,
          info: { lamports: 1_000_000_000, data: Buffer.alloc(0), owner: SYSTEM_PROGRAM_ID, executable: false },
        },
      ]
    );
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    program = new anchor.Program<Vesting>(VestingIDL as Vesting, provider);
    banksClient = context.banksClient;

    employer = provider.wallet.payer;
    // @ts-ignore
    mint = await createMint(banksClient, employer, employer.publicKey, null, 2);

    beneficaryProvider = new BankrunProvider(context);
    beneficaryProvider.wallet = new NodeWallet(beneficary);

    program2 = new anchor.Program<Vesting>(VestingIDL as Vesting, beneficaryProvider);
    [vestingAccountKey] = PublicKey.findProgramAddressSync([Buffer.from(companyName)], program.programId);
    [treasuryAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting_treasury"), Buffer.from(companyName)],
      program.programId
    );
    [employeeAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("employee_vesting"), beneficary.publicKey.toBuffer(), vestingAccountKey.toBuffer()],
      program.programId
    );
  });

  it("Should create a vesting account", async () => {
    const tx = await program.methods
      .createVestingAccount(companyName)
      .accounts({
        signer: employer.publicKey,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const vestingAccountData = await program.account.vestingAccount.fetch(vestingAccountKey, "confirmed");
    console.log("Vesting account data:", vestingAccountData);
    console.log("Create vesting account:", tx);
  });

  it("Should fund the treasury token account", async () => {
    const amount = 10_000 * 10 ** 9;
    // @ts-ignore
    const mintTx = await mintTo(banksClient, employer, mint, treasuryAccount, employer, amount);
    console.log("Mint Treasury Token Account:", mintTx);
  });

  it("Should create empoyee vesting account", async () => {
    const tx2 = await program.methods
      .createEmployeeAccount(new BN(0), new BN(100), new BN(100), new BN(0))
      .accounts({
        benificiary: beneficary.publicKey,
        vestingAccount: vestingAccountKey,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    console.log("Create empoyee vesting account:", tx2);
    console.log("Eployee account:", employeeAccount.toBase58());
  });

  it("Should claim the employee's vested tokens", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const currentClock = await banksClient.getClock();
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        1000n
      )
    );
    const tx3 = await program2.methods
      .claimToken(companyName)
      .accounts({ tokenProgram: TOKEN_PROGRAM_ID })
      .rpc({ commitment: "confirmed" });

    console.log("Claim the employee's vested tokens:", tx3);
  });
});
