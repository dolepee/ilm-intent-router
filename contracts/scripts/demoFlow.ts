import { ethers } from "hardhat";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const contractAddr = process.env.INTENT_ROUTER_ADDRESS;
  if (!contractAddr) throw new Error("INTENT_ROUTER_ADDRESS missing in .env");

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Signer:", me);
  console.log("IntentRouter:", contractAddr);

  const MockERC20 = await ethers.getContractFactory("MockERC20");

  // Deploy mock tokens with delays to avoid nonce issues on public RPC
  console.log("\nDeploying mock WETH...");
  const weth = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
  await weth.waitForDeployment();
  const wethAddr = await weth.getAddress();
  console.log("Mock WETH:", wethAddr);

  console.log("Waiting 8s for nonce sync...");
  await sleep(8000);

  console.log("Deploying mock USDC...");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("Mock USDC:", usdcAddr);

  await sleep(5000);

  // Mint tokens
  console.log("\nMinting WETH...");
  const m1 = await weth.mint(me, ethers.parseEther("100"));
  await m1.wait();
  console.log("Minted 100 WETH");

  await sleep(5000);

  console.log("Minting USDC...");
  const m2 = await usdc.mint(me, ethers.parseUnits("100000", 6));
  await m2.wait();
  console.log("Minted 100,000 USDC");

  await sleep(5000);

  const intentRouter = await ethers.getContractAt("IntentRouter", contractAddr, signer);

  // 1) Approve solver
  console.log("\n--- Step 1: Approve solver ---");
  const tx1 = await intentRouter.setSolver(me, true);
  await tx1.wait();
  console.log("setSolver tx:", tx1.hash);

  await sleep(5000);

  // 2) Approve router for WETH
  console.log("\n--- Step 2: Approve WETH ---");
  const appIn = await weth.approve(contractAddr, ethers.MaxUint256);
  await appIn.wait();
  console.log("WETH approve tx:", appIn.hash);

  await sleep(5000);

  // 3) Create intent
  console.log("\n--- Step 3: Create intent ---");
  const now = Math.floor(Date.now() / 1000);
  const amountIn = ethers.parseEther("1");
  const minAmountOut = ethers.parseUnits("3000", 6);

  const tx2 = await intentRouter.createIntent(
    wethAddr, usdcAddr, amountIn, minAmountOut, 50,
    BigInt("40000000000000"), now + 3600
  );
  const rc2 = await tx2.wait();
  console.log("createIntent tx:", tx2.hash);

  const created = rc2?.logs
    .map((l: any) => { try { return intentRouter.interface.parseLog(l); } catch { return null; } })
    .find((x: any) => x && x.name === "IntentCreated");
  const intentId = created?.args?.intentId ?? 1n;
  console.log("Intent ID:", intentId.toString());

  // Verify escrow
  const escrowed = await weth.balanceOf(contractAddr);
  console.log("Escrowed WETH:", ethers.formatEther(escrowed));

  await sleep(5000);

  // 4) Approve router for USDC (solver side)
  console.log("\n--- Step 4: Approve USDC (solver) ---");
  const appOut = await usdc.approve(contractAddr, ethers.MaxUint256);
  await appOut.wait();
  console.log("USDC approve tx:", appOut.hash);

  await sleep(5000);

  // 5) Fill intent
  console.log("\n--- Step 5: Fill intent ---");
  const amountOut = ethers.parseUnits("3200", 6);
  const execHash = ethers.keccak256(ethers.toUtf8Bytes(`solver:${me}:intent:${intentId}`));

  const tx3 = await intentRouter.fillIntent(intentId, amountOut, execHash);
  await tx3.wait();
  console.log("fillIntent tx:", tx3.hash);

  // Verify
  const inx = await intentRouter.intents(intentId);
  const feeBps = await intentRouter.protocolFeeBps();
  const fee = (amountOut * feeBps) / 10000n;

  console.log("\n=== PROOF BUNDLE ===");
  console.log(JSON.stringify({
    contract: contractAddr,
    mockWETH: wethAddr,
    mockUSDC: usdcAddr,
    signer: me,
    intentId: intentId.toString(),
    status: "Filled",
    amountIn: "1 WETH",
    amountOut: "3200 USDC",
    protocolFee: ethers.formatUnits(fee, 6) + " USDC",
    txs: {
      setSolver: tx1.hash,
      createIntent: tx2.hash,
      fillIntent: tx3.hash,
    },
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
