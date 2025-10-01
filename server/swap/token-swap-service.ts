import { ethers } from 'ethers';
import { CHAIN_CONFIGS } from '../multi-chain-service';
import { DatabaseService } from '../database/models';

export interface SwapParams {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  recipient: string;
  slippageTolerance: number; // in basis points (e.g., 300 = 3%)
  deadline: number; // timestamp
}

export interface SwapResult {
  success: boolean;
  transactionHash?: string;
  amountOut?: string;
  gasUsed?: number;
  error?: string;
}

export interface SwapRoute {
  dex: string;
  path: string[];
  amountOut: string;
  priceImpact: string;
  gasEstimate: number;
}

export interface QuoteResult {
  amountOut: string;
  priceImpact: string;
  gasEstimate: number;
  routes: SwapRoute[];
}

export class TokenSwapService {
  private providers: Map<number, ethers.providers.JsonRpcProvider> = new Map();
  private routerContracts: Map<string, ethers.Contract> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    Object.values(CHAIN_CONFIGS).forEach(chain => {
      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
    });
  }

  public async getQuote(params: Omit<SwapParams, 'recipient' | 'slippageTolerance' | 'deadline'>): Promise<QuoteResult | null> {
    try {
      console.log(`💱 Getting quote for ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut} on chain ${params.chainId}`);
      
      const routes = await this.findSwapRoutes(params.chainId, params.tokenIn, params.tokenOut, params.amountIn);
      
      if (routes.length === 0) {
        console.log(`❌ No swap routes available for ${params.tokenIn} -> ${params.tokenOut} on chain ${params.chainId}`);
        return null;
      }

      // Find best route (highest amount out)
      const bestRoute = routes.reduce((best, current) => 
        parseFloat(current.amountOut) > parseFloat(best.amountOut) ? current : best
      );

      const totalAmountOut = bestRoute.amountOut;
      const totalPriceImpact = bestRoute.priceImpact;
      const totalGasEstimate = bestRoute.gasEstimate;

      console.log(`✅ Best quote found: ${totalAmountOut} ${params.tokenOut} (${totalPriceImpact}% price impact)`);
      
      return {
        amountOut: totalAmountOut,
        priceImpact: totalPriceImpact,
        gasEstimate: totalGasEstimate,
        routes
      };
    } catch (error) {
      console.error(`❌ Error getting quote:`, error);
      return null;
    }
  }

  public async executeSwap(params: SwapParams): Promise<SwapResult> {
    try {
      console.log(`💱 Executing swap: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut} on chain ${params.chainId}`);
      
      const quote = await this.getQuote({
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn
      });

      if (!quote) {
        throw new Error('No quote available for swap');
      }

      const bestRoute = quote.routes[0]; // Use best route
      const result = await this.executeSwapWithRoute(params, bestRoute);
      
      if (result.success) {
        // Log successful swap
        await DatabaseService.logActivity({
          chain_id: params.chainId,
          level: 'success',
          message: `Swap executed successfully`,
          data: {
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            amountOut: result.amountOut,
            dex: bestRoute.dex,
            transactionHash: result.transactionHash
          }
        });
      }

      return result;
    } catch (error) {
      console.error(`❌ Swap execution failed:`, error);
      
      // Log failed swap
      await DatabaseService.logActivity({
        chain_id: params.chainId,
        level: 'error',
        message: `Swap execution failed`,
        data: {
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          error: error.message
        }
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  public async swapToETH(chainId: number, tokenAddress: string, amount: string): Promise<SwapResult> {
    try {
      console.log(`💱 Swapping ${amount} tokens to ETH on chain ${chainId}`);
      
      const chain = Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId);
      if (!chain) {
        throw new Error(`Chain ${chainId} not supported`);
      }

      const swapParams: SwapParams = {
        chainId,
        tokenIn: tokenAddress,
        tokenOut: chain.wethAddress,
        amountIn: amount,
        recipient: process.env.OWNER_ADDRESS || '',
        slippageTolerance: 300, // 3%
        deadline: Math.floor(Date.now() / 1000) + 1800 // 30 minutes
      };

      return await this.executeSwap(swapParams);
    } catch (error) {
      console.error(`❌ Token to ETH swap failed:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  public async consolidateProfitsToETH(): Promise<SwapResult[]> {
    try {
      console.log(`💰 Consolidating all profits to ETH`);
      
      const results: SwapResult[] = [];
      
      // Get profits from all chains
      const chains = Object.values(CHAIN_CONFIGS);
      
      for (const chain of chains) {
        const profits = await DatabaseService.getProfitsByChain(chain.chainId);
        
        for (const profit of profits) {
          // Convert any token to ETH (not just USDC)
          if (parseFloat(profit.amount) > 0 && profit.token_address !== chain.wethAddress) {
            const result = await this.swapToETH(chain.chainId, profit.token_address, profit.amount);
            results.push(result);
          }
        }
      }
      
      console.log(`✅ Profit consolidation to ETH completed: ${results.filter(r => r.success).length}/${results.length} successful`);
      
      return results;
    } catch (error) {
      console.error(`❌ Profit consolidation to ETH failed:`, error);
      return [];
    }
  }

  private async findSwapRoutes(chainId: number, tokenIn: string, tokenOut: string, amountIn: string): Promise<SwapRoute[]> {
    const routes: SwapRoute[] = [];
    
    // Uniswap V2 routes
    const uniswapV2Route = await this.getUniswapV2Route(chainId, tokenIn, tokenOut, amountIn);
    if (uniswapV2Route) routes.push(uniswapV2Route);
    
    // Uniswap V3 routes
    const uniswapV3Route = await this.getUniswapV3Route(chainId, tokenIn, tokenOut, amountIn);
    if (uniswapV3Route) routes.push(uniswapV3Route);
    
    // SushiSwap routes (if available)
    const sushiRoute = await this.getSushiSwapRoute(chainId, tokenIn, tokenOut, amountIn);
    if (sushiRoute) routes.push(sushiRoute);
    
    return routes;
  }

  private async getUniswapV2Route(chainId: number, tokenIn: string, tokenOut: string, amountIn: string): Promise<SwapRoute | null> {
    try {
      const routerContract = await this.getUniswapV2Router(chainId);
      if (!routerContract) return null;

      const path = [tokenIn, tokenOut];
      const amountsOut = await routerContract.getAmountsOut(ethers.utils.parseUnits(amountIn, 18), path);
      const amountOut = ethers.utils.formatUnits(amountsOut[1], 18);
      
      // Calculate price impact (simplified)
      const priceImpact = this.calculatePriceImpact(amountIn, amountOut);
      
      // Estimate gas
      const gasEstimate = await this.estimateSwapGas(chainId, 'UniswapV2', path, amountIn);
      
      return {
        dex: 'UniswapV2',
        path,
        amountOut,
        priceImpact,
        gasEstimate
      };
    } catch (error) {
      console.warn(`⚠️ Uniswap V2 route not available:`, error);
      return null;
    }
  }

  private async getUniswapV3Route(chainId: number, tokenIn: string, tokenOut: string, amountIn: string): Promise<SwapRoute | null> {
    try {
      const routerContract = await this.getUniswapV3Router(chainId);
      if (!routerContract) return null;

      // Uniswap V3 uses different path format
      const path = ethers.utils.solidityPack(['address', 'uint24', 'address'], [tokenIn, 3000, tokenOut]); // 0.3% fee
      
      // Get quote from Uniswap V3 quoter
      const quoterContract = await this.getUniswapV3Quoter(chainId);
      const amountOut = await quoterContract.callStatic.quoteExactInputSingle(
        tokenIn,
        tokenOut,
        3000, // 0.3% fee
        ethers.utils.parseUnits(amountIn, 18),
        0
      );
      
      const amountOutFormatted = ethers.utils.formatUnits(amountOut, 18);
      
      // Calculate price impact
      const priceImpact = this.calculatePriceImpact(amountIn, amountOutFormatted);
      
      // Estimate gas
      const gasEstimate = await this.estimateSwapGas(chainId, 'UniswapV3', [tokenIn, tokenOut], amountIn);
      
      return {
        dex: 'UniswapV3',
        path: [tokenIn, tokenOut],
        amountOut: amountOutFormatted,
        priceImpact,
        gasEstimate
      };
    } catch (error) {
      console.warn(`⚠️ Uniswap V3 route not available:`, error);
      return null;
    }
  }

  private async getSushiSwapRoute(chainId: number, tokenIn: string, tokenOut: string, amountIn: string): Promise<SwapRoute | null> {
    try {
      // SushiSwap is available on some chains
      if (chainId === 1 || chainId === 137) { // Ethereum and Polygon
        const routerContract = await this.getSushiSwapRouter(chainId);
        if (!routerContract) return null;

        const path = [tokenIn, tokenOut];
        const amountsOut = await routerContract.getAmountsOut(ethers.utils.parseUnits(amountIn, 18), path);
        const amountOut = ethers.utils.formatUnits(amountsOut[1], 18);
        
        const priceImpact = this.calculatePriceImpact(amountIn, amountOut);
        const gasEstimate = await this.estimateSwapGas(chainId, 'SushiSwap', path, amountIn);
        
        return {
          dex: 'SushiSwap',
          path,
          amountOut,
          priceImpact,
          gasEstimate
        };
      }
      
      return null;
    } catch (error) {
      console.warn(`⚠️ SushiSwap route not available:`, error);
      return null;
    }
  }

  private async executeSwapWithRoute(params: SwapParams, route: SwapRoute): Promise<SwapResult> {
    try {
      const provider = this.providers.get(params.chainId);
      if (!provider) {
        throw new Error(`Provider not found for chain ${params.chainId}`);
      }

      const signer = await this.getSigner(params.chainId);
      if (!signer) {
        throw new Error('No signer available for swap execution');
      }

      // Execute swap based on DEX
      switch (route.dex) {
        case 'UniswapV2':
          return await this.executeUniswapV2Swap(params, route, signer);
        case 'UniswapV3':
          return await this.executeUniswapV3Swap(params, route, signer);
        case 'SushiSwap':
          return await this.executeSushiSwap(params, route, signer);
        default:
          throw new Error(`Unsupported DEX: ${route.dex}`);
      }
    } catch (error) {
      console.error(`❌ Swap execution with route failed:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeUniswapV2Swap(params: SwapParams, route: SwapRoute, signer: ethers.Signer): Promise<SwapResult> {
    try {
      const routerContract = await this.getUniswapV2Router(params.chainId);
      if (!routerContract) {
        throw new Error('Uniswap V2 router not available');
      }

      const amountOutMin = ethers.utils.parseUnits(
        (parseFloat(route.amountOut) * (10000 - params.slippageTolerance) / 10000).toString(),
        18
      );

      const tx = await routerContract.connect(signer).swapExactTokensForTokens(
        ethers.utils.parseUnits(params.amountIn, 18),
        amountOutMin,
        route.path,
        params.recipient,
        params.deadline,
        {
          gasLimit: route.gasEstimate
        }
      );

      const receipt = await tx.wait();
      
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        amountOut: route.amountOut,
        gasUsed: receipt.gasUsed.toNumber()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeUniswapV3Swap(params: SwapParams, route: SwapRoute, signer: ethers.Signer): Promise<SwapResult> {
    try {
      const routerContract = await this.getUniswapV3Router(params.chainId);
      if (!routerContract) {
        throw new Error('Uniswap V3 router not available');
      }

      const amountOutMin = ethers.utils.parseUnits(
        (parseFloat(route.amountOut) * (10000 - params.slippageTolerance) / 10000).toString(),
        18
      );

      const tx = await routerContract.connect(signer).exactInputSingle({
        tokenIn: route.path[0],
        tokenOut: route.path[1],
        fee: 3000, // 0.3% fee
        recipient: params.recipient,
        deadline: params.deadline,
        amountIn: ethers.utils.parseUnits(params.amountIn, 18),
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0
      }, {
        gasLimit: route.gasEstimate
      });

      const receipt = await tx.wait();
      
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        amountOut: route.amountOut,
        gasUsed: receipt.gasUsed.toNumber()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private async executeSushiSwap(params: SwapParams, route: SwapRoute, signer: ethers.Signer): Promise<SwapResult> {
    try {
      const routerContract = await this.getSushiSwapRouter(params.chainId);
      if (!routerContract) {
        throw new Error('SushiSwap router not available');
      }

      const amountOutMin = ethers.utils.parseUnits(
        (parseFloat(route.amountOut) * (10000 - params.slippageTolerance) / 10000).toString(),
        18
      );

      const tx = await routerContract.connect(signer).swapExactTokensForTokens(
        ethers.utils.parseUnits(params.amountIn, 18),
        amountOutMin,
        route.path,
        params.recipient,
        params.deadline,
        {
          gasLimit: route.gasEstimate
        }
      );

      const receipt = await tx.wait();
      
      return {
        success: true,
        transactionHash: receipt.transactionHash,
        amountOut: route.amountOut,
        gasUsed: receipt.gasUsed.toNumber()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  private calculatePriceImpact(amountIn: string, amountOut: string): string {
    // Simplified price impact calculation
    const impact = ((parseFloat(amountIn) - parseFloat(amountOut)) / parseFloat(amountIn)) * 100;
    return Math.abs(impact).toFixed(2);
  }

  private async estimateSwapGas(chainId: number, dex: string, path: string[], amountIn: string): Promise<number> {
    try {
      // Default gas estimates for different DEXs
      const gasEstimates = {
        'UniswapV2': 150000,
        'UniswapV3': 200000,
        'SushiSwap': 150000
      };

      return gasEstimates[dex as keyof typeof gasEstimates] || 200000;
    } catch (error) {
      console.warn(`⚠️ Could not estimate gas for ${dex}, using default`);
      return 200000;
    }
  }

  private async getUniswapV2Router(chainId: number): Promise<ethers.Contract | null> {
    try {
      const routerAddresses = {
        1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Ethereum
        10: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Optimism
        42161: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Arbitrum
        137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' // Polygon
      };

      const routerAddress = routerAddresses[chainId as keyof typeof routerAddresses];
      if (!routerAddress) return null;

      const provider = this.providers.get(chainId);
      if (!provider) return null;

      const routerABI = [
        'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
      ];

      return new ethers.Contract(routerAddress, routerABI, provider);
    } catch (error) {
      console.warn(`⚠️ Uniswap V2 router not available on chain ${chainId}`);
      return null;
    }
  }

  private async getUniswapV3Router(chainId: number): Promise<ethers.Contract | null> {
    try {
      const routerAddresses = {
        1: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Ethereum
        10: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Optimism
        42161: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Arbitrum
        137: '0xE592427A0AEce92De3Edee1F18E0157C05861564' // Polygon
      };

      const routerAddress = routerAddresses[chainId as keyof typeof routerAddresses];
      if (!routerAddress) return null;

      const provider = this.providers.get(chainId);
      if (!provider) return null;

      const routerABI = [
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
      ];

      return new ethers.Contract(routerAddress, routerABI, provider);
    } catch (error) {
      console.warn(`⚠️ Uniswap V3 router not available on chain ${chainId}`);
      return null;
    }
  }

  private async getUniswapV3Quoter(chainId: number): Promise<ethers.Contract | null> {
    try {
      const quoterAddresses = {
        1: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Ethereum
        10: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Optimism
        42161: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Arbitrum
        137: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' // Polygon
      };

      const quoterAddress = quoterAddresses[chainId as keyof typeof quoterAddresses];
      if (!quoterAddress) return null;

      const provider = this.providers.get(chainId);
      if (!provider) return null;

      const quoterABI = [
        'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
      ];

      return new ethers.Contract(quoterAddress, quoterABI, provider);
    } catch (error) {
      console.warn(`⚠️ Uniswap V3 quoter not available on chain ${chainId}`);
      return null;
    }
  }

  private async getSushiSwapRouter(chainId: number): Promise<ethers.Contract | null> {
    try {
      const routerAddresses = {
        1: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // Ethereum
        137: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' // Polygon
      };

      const routerAddress = routerAddresses[chainId as keyof typeof routerAddresses];
      if (!routerAddress) return null;

      const provider = this.providers.get(chainId);
      if (!provider) return null;

      const routerABI = [
        'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
      ];

      return new ethers.Contract(routerAddress, routerABI, provider);
    } catch (error) {
      console.warn(`⚠️ SushiSwap router not available on chain ${chainId}`);
      return null;
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
}
