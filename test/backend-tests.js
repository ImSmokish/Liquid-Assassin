// Backend API Tests
// Run with: npm test

const { expect } = require('chai');
const request = require('supertest');
const app = require('../server/index');

describe('LiquidAssassin Backend API', function() {
  describe('Health Check', function() {
    it('Should return healthy status', async function() {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body.status).to.equal('healthy');
      expect(response.body.services).to.have.property('database');
      expect(response.body.services).to.have.property('websocket');
      expect(response.body.services).to.have.property('blockchain');
    });
  });

  describe('WebSocket Management', function() {
    it('Should get WebSocket status', async function() {
      const response = await request(app)
        .get('/api/websocket/status')
        .expect(200);
      
      expect(response.body).to.have.property('connections');
      expect(response.body.connections).to.be.an('array');
    });

    it('Should connect to Ethereum WebSocket', async function() {
      const response = await request(app)
        .post('/api/websocket/connect/1')
        .expect(200);
      
      expect(response.body.success).to.be.true;
      expect(response.body.message).to.include('Connected to chain 1');
    });

    it('Should disconnect from WebSocket', async function() {
      const response = await request(app)
        .post('/api/websocket/disconnect/1')
        .expect(200);
      
      expect(response.body.success).to.be.true;
      expect(response.body.message).to.include('Disconnected from chain 1');
    });
  });

  describe('Health Factor Calculation', function() {
    it('Should calculate health factor for user', async function() {
      const response = await request(app)
        .get('/api/health-factor/1/0x1234567890123456789012345678901234567890')
        .query({
          collateralAsset: '0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B',
          debtAsset: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
        })
        .expect(200);
      
      expect(response.body).to.have.property('position');
    });

    it('Should scan liquidation opportunities', async function() {
      const response = await request(app)
        .get('/api/health-factor/opportunities/1')
        .query({
          minHealthFactor: 0.75,
          maxHealthFactor: 1.05
        })
        .expect(200);
      
      expect(response.body).to.have.property('opportunities');
      expect(response.body.opportunities).to.be.an('array');
    });

    it('Should get chain health summary', async function() {
      const response = await request(app)
        .get('/api/health-factor/summary/1')
        .expect(200);
      
      expect(response.body).to.have.property('summary');
      expect(response.body.summary).to.have.property('totalPositions');
      expect(response.body.summary).to.have.property('liquidatablePositions');
      expect(response.body.summary).to.have.property('averageHealthFactor');
    });
  });

  describe('Flash Loan Operations', function() {
    it('Should get available flash loan assets', async function() {
      const response = await request(app)
        .get('/api/flash-loan/assets/1')
        .expect(200);
      
      expect(response.body).to.have.property('assets');
      expect(response.body.assets).to.be.an('array');
    });

    it('Should execute flash loan', async function() {
      const flashLoanParams = {
        chainId: 1,
        asset: '0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B',
        amount: '1000',
        receiverAddress: '0x1234567890123456789012345678901234567890',
        params: '0x'
      };

      const response = await request(app)
        .post('/api/flash-loan/execute')
        .send(flashLoanParams)
        .expect(200);
      
      expect(response.body).to.have.property('result');
    });
  });

  describe('Token Swap Operations', function() {
    it('Should get swap quote', async function() {
      const response = await request(app)
        .get('/api/swap/quote')
        .query({
          chainId: 1,
          tokenIn: '0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B',
          tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amountIn: '1000'
        })
        .expect(200);
      
      expect(response.body).to.have.property('quote');
    });

    it('Should execute USDC to ETH swap', async function() {
      const response = await request(app)
        .post('/api/swap/usdc-to-eth')
        .send({
          chainId: 1,
          usdcAmount: '1000'
        })
        .expect(200);
      
      expect(response.body).to.have.property('result');
    });
  });

  describe('Cross-Chain Bridge Operations', function() {
    it('Should find bridge routes', async function() {
      const response = await request(app)
        .get('/api/bridge/routes')
        .query({
          fromChainId: 1,
          toChainId: 10,
          tokenAddress: '0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B',
          amount: '1000'
        })
        .expect(200);
      
      expect(response.body).to.have.property('route');
    });

    it('Should get supported tokens for chain', async function() {
      const response = await request(app)
        .get('/api/bridge/tokens/1')
        .expect(200);
      
      expect(response.body).to.have.property('tokens');
      expect(response.body.tokens).to.be.an('array');
    });
  });

  describe('Error Handling', function() {
    it('Should handle invalid chain ID', async function() {
      const response = await request(app)
        .get('/api/health-factor/summary/999')
        .expect(500);
      
      expect(response.body).to.have.property('error');
    });

    it('Should handle missing parameters', async function() {
      const response = await request(app)
        .get('/api/health-factor/1/0x1234567890123456789012345678901234567890')
        .expect(400);
      
      expect(response.body).to.have.property('error');
    });
  });
});
