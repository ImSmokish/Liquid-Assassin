import { ethers } from 'ethers';
import { CHAIN_CONFIGS } from '../multi-chain-service';
import { DatabaseService } from '../database/models';

export interface FlashLoanParams {
  chainId: number;
  asset: string;
  amount: string;
  receiverAddress: string;
  params: string;
}

export interface FlashLoanResult {
  success: boolean;
  transactionHash?: string;
  gasUsed?: number;
  error?: string;
}

export interface LiquidationParams {
  chainId: number;
  collateralAsset: string;
  debtAsset: string;
  userAddress: string;
  debtToCover: string;
  flashLoanAsset: string;
  flashLoanAmount: string;
}

export class FlashLoanService {
  private providers: Map<number, ethers.providers.JsonRpcProvider> = new Map();
  private poolContracts: Map<number, ethers.Contract> = new Map();
  private liquidatorContracts: Map<number, ethers.Contract> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    Object.values(CHAIN_CONFIGS).forEach(chain => {
      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
    });
  }

  public async executeFlashLoan(params: FlashLoanParams): Promise<FlashLoanResult> {
    try {
      console.log(`🚀 Executing flash loan on chain ${params.chainId} for ${params.amount} ${params.asset}`);
      
      const poolContract = await this.getPoolContract(params.chainId);
      const signer = await this.getSigner(params.chainId);
      
      if (!signer) {
        throw new Error('No signer available for flash loan execution');
      }

      // Prepare flash loan parameters
      const assets = [params.asset];
      const amounts = [ethers.utils.parseUnits(params.amount, 18)];
      const interestRateModes = [0]; // 0 = variable rate
      const onBehalfOf = ethers.constants.AddressZero;
      const referralCode = 0;

      // Estimate gas
      const gasEstimate = await poolContract.connect(signer).estimateGas.flashLoan(
        params.receiverAddress,
        assets,
        amounts,
        interestRateModes,
        onBehalfOf,
        params.params,
        referralCode
      );

      // Execute flash loan
      const tx = await poolContract.connect(signer).flashLoan(
        params.receiverAddress,
        assets,
        amounts,
        interestRateModes,
        onBehalfOf,
        params.params,
        referralCode,
        {
          gasLimit: gasEstimate.mul(120).div(100) // Add 20% buffer
        }
      );

      const receipt = await tx.wait();
      
      console.log(`✅ Flash loan executed successfully: ${receipt.transactionHash}`);
      
      // Log successful flash loan
      await DatabaseService.logActivity({
        chain_id: params.chainId,
        level: 'success',
        message: `Flash loan executed successfully`,
        data: {
          transactionHash: receipt.transactionHash,
          gasUsed: receipt.gasUsed.toString(),
          asset: params.asset,
          amount: params.amount
        }
      });

      return {
        success: true,
        transactionHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toNumber()
      };
    } catch (error) {
      console.error(`❌ Flash loan execution failed:`, error);
      
      // Log failed flash loan
      await DatabaseService.logActivity({
        chain_id: params.chainId,
        level: 'error',
        message: `Flash loan execution failed`,
        data: {
          asset: params.asset,
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

  public async executeLiquidationWithFlashLoan(params: LiquidationParams): Promise<FlashLoanResult> {
    try {
      console.log(`💥 Executing liquidation with flash loan on chain ${params.chainId}`);
      
      const liquidatorContract = await this.getLiquidatorContract(params.chainId);
      const signer = await this.getSigner(params.chainId);
      
      if (!signer) {
        throw new Error('No signer available for liquidation execution');
      }

      // Prepare liquidation parameters
      const liquidationParams = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'address', 'uint256'],
        [params.collateralAsset, params.debtAsset, params.userAddress, ethers.utils.parseUnits(params.debtToCover, 18)]
      );

      // Execute liquidation with flash loan
      const tx = await liquidatorContract.connect(signer).liquidateWithFlashLoan(
        params.flashLoanAsset,
        ethers.utils.parseUnits(params.flashLoanAmount, 18),
        liquidationParams,
        {
          gasLimit: 2000000 // High gas limit for complex operations
        }
      );

      const receipt = await tx.wait();
      
      console.log(`✅ Liquidation with flash loan executed: ${receipt.transactionHash}`);
      
      // Log successful liquidation
      await DatabaseService.logActivity({
        chain_id: params.chainId,
        level: 'success',
        message: `Liquidation with flash loan executed successfully`,
        data: {
          transactionHash: receipt.transactionHash,
          gasUsed: receipt.gasUsed.toString(),
          userAddress: params.userAddress,
          collateralAsset: params.collateralAsset,
          debtAsset: params.debtAsset
        }
      });

      return {
        success: true,
        transactionHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toNumber()
      };
    } catch (error) {
      console.error(`❌ Liquidation with flash loan failed:`, error);
      
      // Log failed liquidation
      await DatabaseService.logActivity({
        chain_id: params.chainId,
        level: 'error',
        message: `Liquidation with flash loan failed`,
        data: {
          userAddress: params.userAddress,
          collateralAsset: params.collateralAsset,
          debtAsset: params.debtAsset,
          error: error.message
        }
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  public async estimateFlashLoanGas(
    chainId: number,
    asset: string,
    amount: string,
    receiverAddress: string,
    params: string
  ): Promise<number> {
    try {
      const poolContract = await this.getPoolContract(chainId);
      
      const assets = [asset];
      const amounts = [ethers.utils.parseUnits(amount, 18)];
      const interestRateModes = [0];
      const onBehalfOf = ethers.constants.AddressZero;
      const referralCode = 0;

      const gasEstimate = await poolContract.estimateGas.flashLoan(
        receiverAddress,
        assets,
        amounts,
        interestRateModes,
        onBehalfOf,
        params,
        referralCode
      );

      return gasEstimate.toNumber();
    } catch (error) {
      console.warn(`⚠️ Could not estimate flash loan gas, using default`);
      return 500000; // Default gas estimate
    }
  }

  public async getAvailableFlashLoanAssets(chainId: number): Promise<string[]> {
    try {
      const chain = Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId);
      if (!chain) {
        throw new Error(`Chain ${chainId} not supported`);
      }

      // Return common flash loan assets for each chain
      const commonAssets = {
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

      return commonAssets[chainId as keyof typeof commonAssets] || [];
    } catch (error) {
      console.error(`❌ Error getting available flash loan assets for chain ${chainId}:`, error);
      return [];
    }
  }

  private async getPoolContract(chainId: number): Promise<ethers.Contract> {
    if (this.poolContracts.has(chainId)) {
      return this.poolContracts.get(chainId)!;
    }

    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider not found for chain ${chainId}`);
    }

    const chain = Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Aave V3 Pool ABI (flash loan functions)
    const poolABI = [
      'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] interestRateModes, address onBehalfOf, bytes params, uint16 referralCode) external',
      'function estimateGas.flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] interestRateModes, address onBehalfOf, bytes params, uint16 referralCode) external view returns (uint256)'
    ];

    const contract = new ethers.Contract(chain.poolAddress, poolABI, provider);
    this.poolContracts.set(chainId, contract);
    
    return contract;
  }

  private async getLiquidatorContract(chainId: number): Promise<ethers.Contract> {
    if (this.liquidatorContracts.has(chainId)) {
      return this.liquidatorContracts.get(chainId)!;
    }

    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider not found for chain ${chainId}`);
    }

    const chain = Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // This would be your deployed liquidator contract
    // For now, we'll use a placeholder
    const liquidatorAddress = process.env[`LIQUIDATOR_CONTRACT_${chainId}`] || ethers.constants.AddressZero;
    
    if (liquidatorAddress === ethers.constants.AddressZero) {
      throw new Error(`Liquidator contract not deployed on chain ${chainId}`);
    }

    // Liquidator contract ABI
    const liquidatorABI = [
      'function liquidateWithFlashLoan(address flashLoanAsset, uint256 flashLoanAmount, bytes liquidationParams) external',
      'function owner() view returns (address)',
      'function withdraw(address token, uint256 amount) external'
    ];

    const contract = new ethers.Contract(liquidatorAddress, liquidatorABI, provider);
    this.liquidatorContracts.set(chainId, contract);
    
    return contract;
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

  public async getFlashLoanFees(chainId: number, asset: string, amount: string): Promise<{
    flashLoanFee: string;
    totalCost: string;
  }> {
    try {
      const poolContract = await this.getPoolContract(chainId);
      
      // Get flash loan fee (typically 0.09% for Aave V3)
      const flashLoanFeeRate = ethers.utils.parseUnits('0.0009', 18); // 0.09%
      const flashLoanAmount = ethers.utils.parseUnits(amount, 18);
      const flashLoanFee = flashLoanAmount.mul(flashLoanFeeRate).div(ethers.utils.parseUnits('1', 18));
      
      return {
        flashLoanFee: ethers.utils.formatUnits(flashLoanFee, 18),
        totalCost: ethers.utils.formatUnits(flashLoanFee, 18)
      };
    } catch (error) {
      console.error(`❌ Error calculating flash loan fees:`, error);
      return {
        flashLoanFee: '0',
        totalCost: '0'
      };
    }
  }
}
