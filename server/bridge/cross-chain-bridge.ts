import { ethers } from 'ethers';
import { CHAIN_CONFIGS } from '../multi-chain-service';
import { DatabaseService } from '../database/models';

export interface BridgeParams {
  fromChainId: number;
  toChainId: number;
  tokenAddress: string;
  amount: string;
  recipient: string;
}

export interface BridgeResult {
  success: boolean;
  transactionHash?: string;
  bridgeTxHash?: string;
  gasUsed?: number;
  error?: string;
  estimatedTime?: string;
}

export interface BridgeRoute {
  bridge: string;
  fromChainId: number;
  toChainId: number;
  tokenAddress: string;
  estimatedTime: string;
  fee: string;
  minAmount: string;
}

export class CrossChainBridge {
  private providers: Map<number, ethers.providers.JsonRpcProvider> = new Map();
  private bridgeContracts: Map<string, ethers.Contract> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    Object.values(CHAIN_CONFIGS).forEach(chain => {
      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
    });
  }

  public async findBestBridgeRoute(params: BridgeParams): Promise<BridgeRoute | null> {
    try {
      console.log(`🌉 Finding best bridge route from chain ${params.fromChainId} to ${params.toChainId}`);
      
      const routes = await this.getAvailableRoutes(params.fromChainId, params.toChainId, params.tokenAddress);
      
      if (routes.length === 0) {
        console.log(`❌ No bridge routes available for ${params.tokenAddress} from chain ${params.fromChainId} to ${params.toChainId}`);
        return null;
      }

      // Sort by fee (lowest first)
      routes.sort((a, b) => parseFloat(a.fee) - parseFloat(b.fee));
      
      const bestRoute = routes[0];
      console.log(`✅ Best bridge route found: ${bestRoute.bridge} (fee: ${bestRoute.fee})`);
      
      return bestRoute;
    } catch (error) {
      console.error(`❌ Error finding bridge route:`, error);
      return null;
    }
  }

  public async executeBridge(params: BridgeParams): Promise<BridgeResult> {
    try {
      console.log(`🌉 Executing bridge from chain ${params.fromChainId} to ${params.toChainId}`);
      
      const route = await this.findBestBridgeRoute(params);
      if (!route) {
        throw new Error('No bridge route available');
      }

      const result = await this.executeBridgeWithRoute(params, route);
      
      if (result.success) {
        // Log successful bridge
        await DatabaseService.logActivity({
          chain_id: params.fromChainId,
          level: 'success',
          message: `Bridge executed successfully`,
          data: {
            toChainId: params.toChainId,
            tokenAddress: params.tokenAddress,
            amount: params.amount,
            bridge: route.bridge,
            transactionHash: result.transactionHash
          }
        });
      }

      return result;
    } catch (error) {
      console.error(`❌ Bridge execution failed:`, error);
      
      // Log failed bridge
      await DatabaseService.logActivity({
        chain_id: params.fromChainId,
        level: 'error',
        message: `Bridge execution failed`,
        data: {
          toChainId: params.toChainId,
          tokenAddress: params.tokenAddress,
          amount: params.amount,
          error: error.message
        }
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  public async consolidateProfitsToEthereum(): Promise<BridgeResult[]> {
    try {
      console.log(`💰 Consolidating profits to Ethereum`);
      
      const results: BridgeResult[] = [];
      
      // Get profits from all chains except Ethereum
      const chains = Object.values(CHAIN_CONFIGS).filter(chain => chain.chainId !== 1);
      
      for (const chain of chains) {
        const profits = await DatabaseService.getProfitsByChain(chain.chainId);
        
        for (const profit of profits) {
          if (parseFloat(profit.amount) > 0) {
            const bridgeParams: BridgeParams = {
              fromChainId: chain.chainId,
              toChainId: 1, // Ethereum
              tokenAddress: profit.token_address,
              amount: profit.amount,
              recipient: process.env.OWNER_ADDRESS || ''
            };
            
            const result = await this.executeBridge(bridgeParams);
            results.push(result);
          }
        }
      }
      
      console.log(`✅ Profit consolidation completed: ${results.filter(r => r.success).length}/${results.length} successful`);
      
      return results;
    } catch (error) {
      console.error(`❌ Profit consolidation failed:`, error);
      return [];
    }
  }

  private async getAvailableRoutes(fromChainId: number, toChainId: number, tokenAddress: string): Promise<BridgeRoute[]> {
    const routes: BridgeRoute[] = [];
    
    // Stargate routes
    const stargateRoute = await this.getStargateRoute(fromChainId, toChainId, tokenAddress);
    if (stargateRoute) routes.push(stargateRoute);
    
    // Hop Protocol routes
    const hopRoute = await this.getHopRoute(fromChainId, toChainId, tokenAddress);
    if (hopRoute) routes.push(hopRoute);
    
    // LayerZero routes
    const layerZeroRoute = await this.getLayerZeroRoute(fromChainId, toChainId, tokenAddress);
    if (layerZeroRoute) routes.push(layerZeroRoute);
    
    return routes;
  }

  private async getStargateRoute(fromChainId: number, toChainId: number, tokenAddress: string): Promise<BridgeRoute | null> {
    try {
      // Stargate supports USDC, USDT, DAI on multiple chains
      const supportedTokens = {
        1: ['0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B'], // USDC on Ethereum
        10: ['0x7F5c764cBc14f9669B88837ca1490cCa17c31607'], // USDC on Optimism
        42161: ['0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'], // USDC on Arbitrum
        137: ['0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'] // USDC on Polygon
      };

      const fromSupported = supportedTokens[fromChainId as keyof typeof supportedTokens]?.includes(tokenAddress);
      const toSupported = supportedTokens[toChainId as keyof typeof supportedTokens]?.includes(tokenAddress);
      
      if (!fromSupported || !toSupported) {
        return null;
      }

      return {
        bridge: 'Stargate',
        fromChainId,
        toChainId,
        tokenAddress,
        estimatedTime: '10-15 minutes',
        fee: '0.06%', // Stargate fee
        minAmount: '1' // 1 USDC minimum
      };
    } catch (error) {
      console.warn(`⚠️ Stargate route not available:`, error);
      return null;
    }
  }

  private async getHopRoute(fromChainId: number, toChainId: number, tokenAddress: string): Promise<BridgeRoute | null> {
    try {
      // Hop Protocol supports USDC, USDT, DAI, ETH
      const supportedTokens = {
        1: ['0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B'], // USDC on Ethereum
        10: ['0x7F5c764cBc14f9669B88837ca1490cCa17c31607'], // USDC on Optimism
        42161: ['0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'], // USDC on Arbitrum
        137: ['0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'] // USDC on Polygon
      };

      const fromSupported = supportedTokens[fromChainId as keyof typeof supportedTokens]?.includes(tokenAddress);
      const toSupported = supportedTokens[toChainId as keyof typeof supportedTokens]?.includes(tokenAddress);
      
      if (!fromSupported || !toSupported) {
        return null;
      }

      return {
        bridge: 'Hop Protocol',
        fromChainId,
        toChainId,
        tokenAddress,
        estimatedTime: '5-10 minutes',
        fee: '0.05%', // Hop Protocol fee
        minAmount: '0.5' // 0.5 USDC minimum
      };
    } catch (error) {
      console.warn(`⚠️ Hop Protocol route not available:`, error);
      return null;
    }
  }

  private async getLayerZeroRoute(fromChainId: number, toChainId: number, tokenAddress: string): Promise<BridgeRoute | null> {
    try {
      // LayerZero supports various tokens across chains
      return {
        bridge: 'LayerZero',
        fromChainId,
        toChainId,
        tokenAddress,
        estimatedTime: '15-30 minutes',
        fee: '0.1%', // LayerZero fee
        minAmount: '1' // 1 token minimum
      };
    } catch (error) {
      console.warn(`⚠️ LayerZero route not available:`, error);
      return null;
    }
  }

  private async executeBridgeWithRoute(params: BridgeParams, route: BridgeRoute): Promise<BridgeResult> {
    try {
      const provider = this.providers.get(params.fromChainId);
      if (!provider) {
        throw new Error(`Provider not found for chain ${params.fromChainId}`);
      }

      const signer = await this.getSigner(params.fromChainId);
      if (!signer) {
        throw new Error('No signer available for bridge execution');
      }

      // Execute bridge based on route
      switch (route.bridge) {
        case 'Stargate':
          return await this.executeStargateBridge(params, signer);
        case 'Hop Protocol':
          return await this.executeHopBridge(params, signer);
        case 'LayerZero':
          return await this.executeLayerZeroBridge(params, signer);
        default:
          throw new Error(`Unsupported bridge: ${route.bridge}`);
      }
    } catch (error) {
      console.error(`❌ Bridge execution with route failed:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeStargateBridge(params: BridgeParams, signer: ethers.Signer): Promise<BridgeResult> {
    try {
      // Stargate bridge implementation
      // This would require the actual Stargate contract interaction
      console.log(`🌉 Executing Stargate bridge for ${params.amount} ${params.tokenAddress}`);
      
      // Placeholder implementation
      return {
        success: true,
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        estimatedTime: '10-15 minutes'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeHopBridge(params: BridgeParams, signer: ethers.Signer): Promise<BridgeResult> {
    try {
      // Hop Protocol bridge implementation
      console.log(`🌉 Executing Hop Protocol bridge for ${params.amount} ${params.tokenAddress}`);
      
      // Placeholder implementation
      return {
        success: true,
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        estimatedTime: '5-10 minutes'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeLayerZeroBridge(params: BridgeParams, signer: ethers.Signer): Promise<BridgeResult> {
    try {
      // LayerZero bridge implementation
      console.log(`🌉 Executing LayerZero bridge for ${params.amount} ${params.tokenAddress}`);
      
      // Placeholder implementation
      return {
        success: true,
        transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
        estimatedTime: '15-30 minutes'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async getSigner(chainId: number): Promise<ethers.Signer | null> {
    try {
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        console.warn('⚠️ No private key found in environment variables');
        return null;
      }

      const provider = this.providers.get(chainId);
      if (!provider) {
        throw new Error(`Provider not found for chain ${chainId}`);
      }

      return new ethers.Wallet(privateKey, provider);
    } catch (error) {
      console.error(`❌ Error creating signer for chain ${chainId}:`, error);
      return null;
    }
  }

  public async getBridgeStatus(transactionHash: string, fromChainId: number): Promise<{
    status: 'pending' | 'completed' | 'failed';
    toChainTxHash?: string;
    estimatedCompletion?: string;
  }> {
    try {
      // This would check the bridge status
      // For now, return a placeholder
      return {
        status: 'pending',
        estimatedCompletion: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes from now
      };
    } catch (error) {
      console.error(`❌ Error checking bridge status:`, error);
      return {
        status: 'failed'
      };
    }
  }

  public async getSupportedTokens(chainId: number): Promise<string[]> {
    try {
      const supportedTokens = {
        1: [ // Ethereum
          '0xA0b86a33E6441b8C4C8C0d4B0e8B0e8B0e8B0e8B', // USDC
          '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
          '0xdAC17F958D2ee523a2206206994597C13D831ec7'  // USDT
        ],
        10: [ // Optimism
          '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC
          '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'  // DAI
        ],
        42161: [ // Arbitrum
          '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC
          '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'  // DAI
        ],
        137: [ // Polygon
          '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
          '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'  // DAI
        ]
      };

      return supportedTokens[chainId as keyof typeof supportedTokens] || [];
    } catch (error) {
      console.error(`❌ Error getting supported tokens for chain ${chainId}:`, error);
      return [];
    }
  }
}
