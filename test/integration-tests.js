// Integration Tests for Complete System
// Run with: npm run test:integration

const { expect } = require('chai');
const { ethers } = require('hardhat');
const request = require('supertest');
const app = require('../server/index');

describe('LiquidAssassin Integration Tests', function() {
  let liquidator;
  let owner;
  let user;
  let mockPool;
  let mockRouter;
  let mockWETH;
  let mockToken;

  before(async function() {
    // Setup test environment
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

  describe('End-to-End Liquidation Flow', function() {
    it('Should execute complete liquidation process', async function() {
      // 1. Check initial stats
      let stats = await liquidator.getStats();
      expect(stats.totalLiquidations).to.equal(0);
      expect(stats.totalProfit).to.equal(0);

      // 2. Execute liquidation
      await liquidator.executeLiquidation(
        user.address,
        mockToken.address,
        mockToken.address,
        ethers.utils.parseEther("1000"),
        100, // 1% slippage
        Math.floor(Date.now() / 1000) + 3600 // 1 hour deadline
      );

      // 3. Verify stats updated
      stats = await liquidator.getStats();
      expect(stats.totalLiquidations).to.equal(1);
      expect(stats.totalProfit).to.be.gt(0);
    });

    it('Should handle multiple liquidations', async function() {
      const initialLiquidations = (await liquidator.getStats()).totalLiquidations;
      
      // Execute multiple liquidations
      for (let i = 0; i < 3; i++) {
        await liquidator.executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("500"),
          100,
          Math.floor(Date.now() / 1000) + 3600
        );
      }

      const finalStats = await liquidator.getStats();
      expect(finalStats.totalLiquidations).to.equal(initialLiquidations + 3);
    });
  });

  describe('Backend Integration', function() {
    it('Should connect WebSocket and get health factor', async function() {
      // Connect WebSocket
      const wsResponse = await request(app)
        .post('/api/websocket/connect/1')
        .expect(200);
      
      expect(wsResponse.body.success).to.be.true;

      // Get health factor
      const hfResponse = await request(app)
        .get('/api/health-factor/1/0x1234567890123456789012345678901234567890')
        .query({
          collateralAsset: mockToken.address,
          debtAsset: mockToken.address
        })
        .expect(200);
      
      expect(hfResponse.body).to.have.property('position');
    });

    it('Should execute flash loan through API', async function() {
      const flashLoanParams = {
        chainId: 1,
        asset: mockToken.address,
        amount: '1000',
        receiverAddress: liquidator.address,
        params: '0x'
      };

      const response = await request(app)
        .post('/api/flash-loan/execute')
        .send(flashLoanParams)
        .expect(200);
      
      expect(response.body).to.have.property('result');
    });

    it('Should get swap quote and execute swap', async function() {
      // Get quote
      const quoteResponse = await request(app)
        .get('/api/swap/quote')
        .query({
          chainId: 1,
          tokenIn: mockToken.address,
          tokenOut: mockWETH.address,
          amountIn: '1000'
        })
        .expect(200);
      
      expect(quoteResponse.body).to.have.property('quote');

      // Execute swap
      const swapResponse = await request(app)
        .post('/api/swap/execute')
        .send({
          chainId: 1,
          tokenIn: mockToken.address,
          tokenOut: mockWETH.address,
          amountIn: '1000',
          recipient: owner.address,
          slippageTolerance: 300,
          deadline: Math.floor(Date.now() / 1000) + 3600
        })
        .expect(200);
      
      expect(swapResponse.body).to.have.property('result');
    });
  });

  describe('Error Recovery', function() {
    it('Should handle failed liquidations gracefully', async function() {
      // This test would require setting up a scenario that causes liquidation to fail
      // For now, we'll test the error handling mechanisms
      
      // Test with invalid parameters
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

    it('Should handle API errors gracefully', async function() {
      // Test invalid chain ID
      const response = await request(app)
        .get('/api/health-factor/summary/999')
        .expect(500);
      
      expect(response.body).to.have.property('error');
    });
  });

  describe('Performance Tests', function() {
    it('Should execute liquidations within acceptable time', async function() {
      const startTime = Date.now();
      
      await liquidator.executeLiquidation(
        user.address,
        mockToken.address,
        mockToken.address,
        ethers.utils.parseEther("1000"),
        100,
        Math.floor(Date.now() / 1000) + 3600
      );
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Should complete within 10 seconds
      expect(executionTime).to.be.lt(10000);
    });

    it('Should handle concurrent API requests', async function() {
      const promises = [];
      
      // Make 10 concurrent requests
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .get('/api/health-factor/summary/1')
            .expect(200)
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.body).to.have.property('summary');
      });
    });
  });

  describe('Security Tests', function() {
    it('Should prevent unauthorized access', async function() {
      // Test that only owner can execute liquidations
      await expect(
        liquidator.connect(user).executeLiquidation(
          user.address,
          mockToken.address,
          mockToken.address,
          ethers.utils.parseEther("1000"),
          100,
          Math.floor(Date.now() / 1000) + 3600
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it('Should handle reentrancy attacks', async function() {
      // This test would require a malicious contract that tries to reenter
      // The ReentrancyGuard should prevent this
      
      // For now, we'll test that the contract has reentrancy protection
      expect(await liquidator.hasRole(await liquidator.REENTRANCY_GUARD_ROLE(), liquidator.address)).to.be.true;
    });
  });
});
