import { expect } from "chai";
import { ethers } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("IntentRouter", function () {
  async function deployFixture() {
    const [owner, user, solver, solver2, feeRecipient, other] =
      await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenIn = await MockERC20.deploy("Token In", "TIN", 18);
    const tokenOut = await MockERC20.deploy("Token Out", "TOUT", 18);

    const IntentRouter = await ethers.getContractFactory("IntentRouter");
    const router = await IntentRouter.deploy(feeRecipient.address);

    await router.setSolver(solver.address, true);

    const mintAmount = ethers.parseEther("10000");
    await tokenIn.mint(user.address, mintAmount);
    await tokenOut.mint(solver.address, mintAmount);

    await tokenIn.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
    await tokenOut.connect(solver).approve(await router.getAddress(), ethers.MaxUint256);

    return { router, tokenIn, tokenOut, owner, user, solver, solver2, feeRecipient, other, mintAmount };
  }

  async function createDefaultIntent(fixture: Awaited<ReturnType<typeof deployFixture>>) {
    const { router, tokenIn, tokenOut, user } = fixture;
    const amountIn = ethers.parseEther("100");
    const minAmountOut = ethers.parseEther("95");
    const maxSlippageBps = 200;
    const maxGasWei = ethers.parseEther("0.01");
    const deadline = (await time.latest()) + 3600;

    const tx = await router
      .connect(user)
      .createIntent(await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, minAmountOut, maxSlippageBps, maxGasWei, deadline);
    const receipt = await tx.wait();

    const intentCreatedEvent = receipt?.logs
      .map((log: any) => {
        try { return router.interface.parseLog({ topics: log.topics as string[], data: log.data }); }
        catch { return null; }
      })
      .find((parsed: any) => parsed?.name === "IntentCreated");

    const intentId = intentCreatedEvent?.args?.[0] ?? 1n;
    return { intentId, amountIn, minAmountOut, maxSlippageBps, maxGasWei, deadline, tx };
  }

  describe("Deployment", function () {
    it("should set deployer as owner", async function () {
      const { router, owner } = await loadFixture(deployFixture);
      expect(await router.owner()).to.equal(owner.address);
    });

    it("should set fee recipient", async function () {
      const { router, feeRecipient } = await loadFixture(deployFixture);
      expect(await router.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("should default protocolFeeBps to 10", async function () {
      const { router } = await loadFixture(deployFixture);
      expect(await router.protocolFeeBps()).to.equal(10);
    });
  });

  describe("createIntent", function () {
    it("should escrow tokenIn from user", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenIn, user } = fixture;
      const amountIn = ethers.parseEther("100");
      const balBefore = await tokenIn.balanceOf(user.address);
      await createDefaultIntent(fixture);
      const balAfter = await tokenIn.balanceOf(user.address);
      expect(balBefore - balAfter).to.equal(amountIn);
      expect(await tokenIn.balanceOf(await router.getAddress())).to.equal(amountIn);
    });

    it("should emit IntentCreated", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenIn, tokenOut, user } = fixture;
      const deadline = (await time.latest()) + 3600;
      await expect(
        router.connect(user).createIntent(await tokenIn.getAddress(), await tokenOut.getAddress(), ethers.parseEther("100"), ethers.parseEther("95"), 200, ethers.parseEther("0.01"), deadline)
      ).to.emit(router, "IntentCreated");
    });

    it("should revert on zero amountIn", async function () {
      const { router, tokenIn, tokenOut, user } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 3600;
      await expect(
        router.connect(user).createIntent(await tokenIn.getAddress(), await tokenOut.getAddress(), 0, ethers.parseEther("95"), 200, ethers.parseEther("0.01"), deadline)
      ).to.be.revertedWithCustomError(router, "InvalidIntent");
    });

    it("should revert on past deadline", async function () {
      const { router, tokenIn, tokenOut, user } = await loadFixture(deployFixture);
      const past = (await time.latest()) - 1;
      await expect(
        router.connect(user).createIntent(await tokenIn.getAddress(), await tokenOut.getAddress(), ethers.parseEther("100"), ethers.parseEther("95"), 200, ethers.parseEther("0.01"), past)
      ).to.be.revertedWithCustomError(router, "InvalidIntent");
    });

    it("should increment intent IDs", async function () {
      const fixture = await loadFixture(deployFixture);
      const { intentId: id1 } = await createDefaultIntent(fixture);
      const { intentId: id2 } = await createDefaultIntent(fixture);
      expect(id2).to.be.gt(id1);
    });
  });

  describe("fillIntent", function () {
    it("should transfer tokens correctly: tokenIn->solver, tokenOut->user (minus fee), fee->recipient", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenIn, tokenOut, user, solver, feeRecipient } = fixture;
      const { intentId, amountIn } = await createDefaultIntent(fixture);

      const amountOut = ethers.parseEther("98");
      const hash = ethers.keccak256(ethers.toUtf8Bytes("exec-1"));
      const feeBps = await router.protocolFeeBps();
      const fee = (amountOut * feeBps) / 10000n;

      const userOutBefore = await tokenOut.balanceOf(user.address);
      const solverInBefore = await tokenIn.balanceOf(solver.address);
      const feeBefore = await tokenOut.balanceOf(feeRecipient.address);

      await router.connect(solver).fillIntent(intentId, amountOut, hash);

      expect((await tokenOut.balanceOf(user.address)) - userOutBefore).to.equal(amountOut - fee);
      expect((await tokenIn.balanceOf(solver.address)) - solverInBefore).to.equal(amountIn);
      expect((await tokenOut.balanceOf(feeRecipient.address)) - feeBefore).to.equal(fee);
    });

    it("should emit IntentFilled", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, solver } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      await expect(
        router.connect(solver).fillIntent(intentId, ethers.parseEther("98"), ethers.keccak256(ethers.toUtf8Bytes("e2")))
      ).to.emit(router, "IntentFilled");
    });

    it("should revert if not approved solver", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, other } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      await expect(
        router.connect(other).fillIntent(intentId, ethers.parseEther("98"), ethers.keccak256(ethers.toUtf8Bytes("e3")))
      ).to.be.revertedWithCustomError(router, "SolverNotApproved");
    });

    it("should revert after deadline", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, solver } = fixture;
      const { intentId, deadline } = await createDefaultIntent(fixture);
      await time.increaseTo(deadline + 1);
      await expect(
        router.connect(solver).fillIntent(intentId, ethers.parseEther("98"), ethers.keccak256(ethers.toUtf8Bytes("e4")))
      ).to.be.revertedWithCustomError(router, "DeadlinePassed");
    });

    it("should revert if amountOut < minAmountOut", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, solver } = fixture;
      const { intentId, minAmountOut } = await createDefaultIntent(fixture);
      await expect(
        router.connect(solver).fillIntent(intentId, minAmountOut - 1n, ethers.keccak256(ethers.toUtf8Bytes("e5")))
      ).to.be.revertedWithCustomError(router, "OutputTooLow");
    });

    it("should revert if already filled", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, solver } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("e6"));
      await router.connect(solver).fillIntent(intentId, ethers.parseEther("98"), hash);
      await expect(
        router.connect(solver).fillIntent(intentId, ethers.parseEther("98"), hash)
      ).to.be.revertedWithCustomError(router, "InvalidStatus");
    });
  });

  describe("cancelIntent", function () {
    it("should return escrowed tokens to user", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenIn, user } = fixture;
      const { intentId, amountIn } = await createDefaultIntent(fixture);
      const before = await tokenIn.balanceOf(user.address);
      await router.connect(user).cancelIntent(intentId);
      expect((await tokenIn.balanceOf(user.address)) - before).to.equal(amountIn);
    });

    it("should revert if not intent owner", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, other } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      await expect(router.connect(other).cancelIntent(intentId)).to.be.revertedWithCustomError(router, "NotIntentOwner");
    });

    it("should revert if already filled", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, user, solver } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      await router.connect(solver).fillIntent(intentId, ethers.parseEther("98"), ethers.keccak256(ethers.toUtf8Bytes("c1")));
      await expect(router.connect(user).cancelIntent(intentId)).to.be.revertedWithCustomError(router, "InvalidStatus");
    });
  });

  describe("markExpired", function () {
    it("should return tokens after deadline", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenIn, user } = fixture;
      const { intentId, amountIn, deadline } = await createDefaultIntent(fixture);
      await time.increaseTo(deadline + 1);
      const before = await tokenIn.balanceOf(user.address);
      await router.markExpired(intentId);
      expect((await tokenIn.balanceOf(user.address)) - before).to.equal(amountIn);
    });

    it("should revert if not expired yet", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      await expect(router.markExpired(intentId)).to.be.revertedWithCustomError(router, "InvalidIntent");
    });

    it("should allow anyone to call", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenIn, user, other } = fixture;
      const { intentId, amountIn, deadline } = await createDefaultIntent(fixture);
      await time.increaseTo(deadline + 1);
      const before = await tokenIn.balanceOf(user.address);
      await router.connect(other).markExpired(intentId);
      expect((await tokenIn.balanceOf(user.address)) - before).to.equal(amountIn);
    });
  });

  describe("Access control", function () {
    it("setSolver: owner can approve", async function () {
      const { router, solver2 } = await loadFixture(deployFixture);
      await router.setSolver(solver2.address, true);
      expect(await router.approvedSolvers(solver2.address)).to.be.true;
    });

    it("setSolver: non-owner reverts", async function () {
      const { router, other, solver2 } = await loadFixture(deployFixture);
      await expect(router.connect(other).setSolver(solver2.address, true)).to.be.revertedWithCustomError(router, "NotOwner");
    });

    it("setProtocolFeeBps: owner can update", async function () {
      const { router } = await loadFixture(deployFixture);
      await router.setProtocolFeeBps(50);
      expect(await router.protocolFeeBps()).to.equal(50);
    });

    it("setProtocolFeeBps: reverts above 100", async function () {
      const { router } = await loadFixture(deployFixture);
      await expect(router.setProtocolFeeBps(101)).to.be.reverted;
    });

    it("transferOwnership: new owner has access, old loses it", async function () {
      const { router, owner, other, solver2 } = await loadFixture(deployFixture);
      await router.transferOwnership(other.address);
      expect(await router.owner()).to.equal(other.address);
      await router.connect(other).setSolver(solver2.address, true);
      await expect(router.connect(owner).setSolver(solver2.address, false)).to.be.revertedWithCustomError(router, "NotOwner");
    });
  });

  describe("Protocol fee math", function () {
    it("default 10bps on 1000 tokens = 0.1 fee", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenOut, user, solver, feeRecipient } = fixture;
      const { intentId } = await createDefaultIntent(fixture);
      const amountOut = ethers.parseEther("1000");
      const expectedFee = ethers.parseEther("1");
      const feeBefore = await tokenOut.balanceOf(feeRecipient.address);
      await router.connect(solver).fillIntent(intentId, amountOut, ethers.keccak256(ethers.toUtf8Bytes("f1")));
      expect((await tokenOut.balanceOf(feeRecipient.address)) - feeBefore).to.equal(expectedFee);
    });

    it("zero fee when bps is 0", async function () {
      const fixture = await loadFixture(deployFixture);
      const { router, tokenOut, user, solver, feeRecipient } = fixture;
      await router.setProtocolFeeBps(0);
      const { intentId } = await createDefaultIntent(fixture);
      const amountOut = ethers.parseEther("1000");
      const userBefore = await tokenOut.balanceOf(user.address);
      await router.connect(solver).fillIntent(intentId, amountOut, ethers.keccak256(ethers.toUtf8Bytes("f2")));
      expect((await tokenOut.balanceOf(user.address)) - userBefore).to.equal(amountOut);
    });
  });
});
