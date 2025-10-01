// LiquidAssassin Contract Tests
// Run with: npx hardhat test

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UltimateAaveLiquidator", function () {
  let liquidator;
  let owner;
  let user;
  let mockPool;
  let mockRouter;
  let mockWETH;
  let mockToken;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    
    // Deploy mock contracts
    const MockPool = await ethers.getContractFactory("MockAavePool");
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    const MockWETH = await ethers.getContractFactory("MockWETH");
    const MockToken = await ethers.getContractFactory("MockERC20");
    
    mockPool = await MockPool.deploy();
    mockRouter = await MockRouter.deploy();
    mockWETH = await MockWETH.deploy();
    mockToken = await MockToken.deploy("Test Token", "TEST");
    
    // Deploy liquidator
    const Liquidator = await ethers.getContractFactory("UltimateAaveLiquidator");
    liquidator = await Liquidator.deploy(
      mockPool.address,
      mockRouter.address,
      mockWETH.address,
      owner.address
    );
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await liquidator.owner()).to.equal(owner.address);
    });

    it("Should set the correct pool address", async function () {
      expect(await liquidator.POOL()).to.equal(mockPool.address);
    });

    it("Should set the correct router address", async function () {
      expect(await liquidator.ROUTER()).to.equal(mockRouter.address);
    });

    it("Should set the correct WETH address", async function () {
      expect(await liquidator.WETH()).to.equal(mockWETH.address);
    });

    it("Should initialize with zero stats", async function () {
      const stats = await liquidator.getStats();
      expect(stats.totalProfit).to.equal(0);
      expect(stats.totalLiquidations).to.equal(0);
      expect(stats.isPaused).to.be.false;
    });
  });

  describe("Access Control", function () {
    it("Should allow only owner to execute liquidation", async function () {
      await expect(
        liquidator.connect(user).executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("1000"),
          100, // 1% slippage
          Math.floor(Date.now() / 1000) + 3600 // 1 hour deadline
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should allow only owner to pause", async function () {
      await expect(
        liquidator.connect(user).pause()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should allow only owner to withdraw profits", async function () {
      await expect(
        liquidator.connect(user).withdrawProfits(
          mockToken.address,
          ethers.utils.parseEther("100"),
          user.address
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Liquidation Execution", function () {
    it("Should revert with zero address for target user", async function () {
      await expect(
        liquidator.executeLiquidation(
          ethers.constants.AddressZero,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("1000"),
          100,
          Math.floor(Date.now() / 1000) + 3600
        )
      ).to.be.revertedWith("ZeroAddress");
    });

    it("Should revert with zero amount", async function () {
      await expect(
        liquidator.executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          0,
          100,
          Math.floor(Date.now() / 1000) + 3600
        )
      ).to.be.revertedWith("ZeroAmount");
    });

    it("Should revert with expired deadline", async function () {
      await expect(
        liquidator.executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("1000"),
          100,
          Math.floor(Date.now() / 1000) - 3600 // Expired
        )
      ).to.be.revertedWith("DeadlineExpired");
    });

    it("Should revert with invalid slippage", async function () {
      await expect(
        liquidator.executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("1000"),
          2000, // 20% slippage - too high
          Math.floor(Date.now() / 1000) + 3600
        )
      ).to.be.revertedWith("InvalidSlippage");
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause", async function () {
      await liquidator.pause();
      const stats = await liquidator.getStats();
      expect(stats.isPaused).to.be.true;
    });

    it("Should allow owner to unpause", async function () {
      await liquidator.pause();
      await liquidator.unpause();
      const stats = await liquidator.getStats();
      expect(stats.isPaused).to.be.false;
    });

    it("Should prevent liquidation when paused", async function () {
      await liquidator.pause();
      await expect(
        liquidator.executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("1000"),
          100,
          Math.floor(Date.now() / 1000) + 3600
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("View Functions", function () {
    it("Should return correct token balance", async function () {
      const balance = await liquidator.getTokenBalance(mockToken.address);
      expect(balance).to.equal(0);
    });

    it("Should calculate flash loan cost correctly", async function () {
      const amount = ethers.utils.parseEther("1000");
      const cost = await liquidator.estimateFlashLoanCost(amount);
      const expectedCost = amount.mul(5).div(10000); // 0.05%
      expect(cost).to.equal(expectedCost);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw", async function () {
      // This test would require setting up a scenario with tokens in the contract
      await expect(
        liquidator.emergencyWithdraw(mockToken.address)
      ).to.not.be.reverted;
    });
  });
});

// Mock contracts for testing
describe("Mock Contracts", function () {
  it("Should deploy mock contracts successfully", async function () {
    const MockPool = await ethers.getContractFactory("MockAavePool");
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    const MockWETH = await ethers.getContractFactory("MockWETH");
    const MockToken = await ethers.getContractFactory("MockERC20");
    
    const mockPool = await MockPool.deploy();
    const mockRouter = await MockRouter.deploy();
    const mockWETH = await MockWETH.deploy();
    const mockToken = await MockToken.deploy("Test Token", "TEST");
    
    expect(await mockPool.address).to.not.equal(ethers.constants.AddressZero);
    expect(await mockRouter.address).to.not.equal(ethers.constants.AddressZero);
    expect(await mockWETH.address).to.not.equal(ethers.constants.AddressZero);
    expect(await mockToken.address).to.not.equal(ethers.constants.AddressZero);
  });
});
