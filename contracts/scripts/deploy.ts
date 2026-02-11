import { ethers } from "hardhat";

async function main() {
  const feeRecipient = process.env.FEE_RECIPIENT;
  if (!feeRecipient) throw new Error("FEE_RECIPIENT is required");

  const factory = await ethers.getContractFactory("IntentRouter");
  const contract = await factory.deploy(feeRecipient);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log("IntentRouter deployed:", addr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
