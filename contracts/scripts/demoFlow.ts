import { ethers } from "hardhat";

async function main() {
  const contractAddr = process.env.INTENT_ROUTER_ADDRESS;
  if (!contractAddr) throw new Error("INTENT_ROUTER_ADDRESS missing in .env");

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();

  const intentRouter = await ethers.getContractAt("IntentRouter", contractAddr, signer);

  // 1) Approve solver (using same signer for MVP demo)
  const tx1 = await intentRouter.setSolver(me, true);
  await tx1.wait();

  // 2) Create intent
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + 3600;

  const tokenIn = "0x4200000000000000000000000000000000000006"; // WETH (Base)
  const tokenOut = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC (Base)

  const amountIn = ethers.parseUnits("1", 18);
  const minAmountOut = ethers.parseUnits("0.98", 18);

  const tx2 = await intentRouter.createIntent(
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    50, // 0.5%
    BigInt("40000000000000"),
    deadline
  );
  const rc2 = await tx2.wait();

  const created = rc2?.logs
    .map((l) => {
      try {
        return intentRouter.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((x) => x && x.name === "IntentCreated");

  const intentId = created?.args?.intentId ?? 1n;

  // 3) Fill intent
  const executionHash = ethers.keccak256(ethers.toUtf8Bytes(`solver:${me}:intent:${intentId.toString()}`));
  const amountOut = ethers.parseUnits("1.01", 18);

  const tx3 = await intentRouter.fillIntent(intentId, amountOut, executionHash);
  await tx3.wait();

  const inx = await intentRouter.intents(intentId);

  console.log(JSON.stringify({
    contract: contractAddr,
    signer: me,
    intentId: intentId.toString(),
    status: inx.status.toString(), // 1 = Filled
    winningSolver: inx.winningSolver,
    amountOut: inx.amountOut.toString(),
    executionHash: inx.executionHash,
    txs: {
      setSolver: tx1.hash,
      createIntent: tx2.hash,
      fillIntent: tx3.hash,
    },
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
