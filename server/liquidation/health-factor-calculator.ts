import { ethers } from 'ethers';
import { CHAIN_CONFIGS } from '../multi-chain-service';
import { DatabaseService } from '../database/models';

export interface UserPosition {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: string;
  debtAmount: string;
  healthFactor: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  isLiquidatable: boolean;
}

export interface LiquidationOpportunity {
  user: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: string;
  debtAmount: string;
  healthFactor: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  maxLiquidationAmount: string;
  potentialProfit: string;
  gasEstimate: string;
}

export class HealthFactorCalculator {
  private providers: Map<number, ethers.providers.JsonRpcProvider> = new Map();
  private poolContracts: Map<number, ethers.Contract> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    Object.values(CHAIN_CONFIGS).forEach(chain => {
      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
    });
  }

  public async calculateHealthFactor(
    chainId: number,
    userAddress: string,
    collateralAsset: string,
    debtAsset: string
  ): Promise<UserPosition | null> {
    try {
      const provider = this.providers.get(chainId);
      if (!provider) {
        throw new Error(`Provider not found for chain ${chainId}`);
      }

      const chain = Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId);
      if (!chain) {
        throw new Error(`Chain ${chainId} not supported`);
      }

      // Get pool contract
      const poolContract = await this.getPoolContract(chainId);
      
      // Get user account data
      const accountData = await poolContract.getUserAccountData(userAddress);
      
      // Parse account data
      const totalCollateralETH = ethers.utils.formatEther(accountData.totalCollateralETH);
      const totalDebtETH = ethers.utils.formatEther(accountData.totalDebtETH);
      const availableBorrowsETH = ethers.utils.formatEther(accountData.availableBorrowsETH);
      const currentLiquidationThreshold = ethers.utils.formatEther(accountData.currentLiquidationThreshold);
      const ltv = ethers.utils.formatEther(accountData.ltv);
      const healthFactor = ethers.utils.formatEther(accountData.healthFactor);

      // Get specific collateral and debt amounts
      const collateralData = await poolContract.getUserReserveData(collateralAsset, userAddress);
      const debtData = await poolContract.getUserReserveData(debtAsset, userAddress);

      const collateralAmount = ethers.utils.formatUnits(
        collateralData.currentATokenBalance,
        await this.getTokenDecimals(chainId, collateralAsset)
      );
      
      const debtAmount = ethers.utils.formatUnits(
        debtData.currentStableDebt.add(debtData.currentVariableDebt),
        await this.getTokenDecimals(chainId, debtAsset)
      );

      // Get liquidation threshold and bonus for collateral asset
      const reserveData = await poolContract.getReserveData(collateralAsset);
      const liquidationThreshold = ethers.utils.formatEther(reserveData.liquidationThreshold);
      const liquidationBonus = ethers.utils.formatEther(reserveData.liquidationBonus);

      const healthFactorNum = parseFloat(healthFactor);
      const isLiquidatable = healthFactorNum < 1.0;

      const position: UserPosition = {
        user: userAddress,
        collateralAsset,
        debtAsset,
        collateralAmount,
        debtAmount,
        healthFactor: healthFactorNum,
        liquidationThreshold: parseFloat(liquidationThreshold),
        liquidationBonus: parseFloat(liquidationBonus),
        isLiquidatable
      };

      // Store position in database
      await DatabaseService.upsertLiquidationPosition({
        chain_id: chainId,
        user_address: userAddress,
        collateral_asset: collateralAsset,
        debt_asset: debtAsset,
        collateral_amount: collateralAmount,
        debt_amount: debtAmount,
        health_factor: healthFactorNum,
        liquidation_threshold: parseFloat(liquidationThreshold),
        liquidation_bonus: parseFloat(liquidationBonus),
        is_liquidatable: isLiquidatable
      });

      return position;
    } catch (error) {
      console.error(`❌ Error calculating health factor for user ${userAddress} on chain ${chainId}:`, error);
      
      // Log error
      await DatabaseService.logActivity({
        chain_id: chainId,
        level: 'error',
        message: `Health factor calculation failed`,
        data: { userAddress, collateralAsset, debtAsset, error: error.message }
      });
      
      return null;
    }
  }

  public async scanLiquidationOpportunities(
    chainId: number,
    minHealthFactor: number,
    maxHealthFactor: number
  ): Promise<LiquidationOpportunity[]> {
    try {
      console.log(`🔍 Scanning liquidation opportunities on chain ${chainId} (HF: ${minHealthFactor}-${maxHealthFactor})`);
      
      // Get liquidatable positions from database
      const positions = await DatabaseService.getLiquidatablePositions(chainId, minHealthFactor, maxHealthFactor);
      
      const opportunities: LiquidationOpportunity[] = [];
      
      for (const position of positions) {
        const opportunity = await this.analyzeLiquidationOpportunity(chainId, position);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
      
      console.log(`✅ Found ${opportunities.length} liquidation opportunities on chain ${chainId}`);
      
      // Log scan results
      await DatabaseService.logActivity({
        chain_id: chainId,
        level: 'info',
        message: `Liquidation scan completed`,
        data: { 
          opportunitiesFound: opportunities.length,
          minHealthFactor,
          maxHealthFactor
        }
      });
      
      return opportunities;
    } catch (error) {
      console.error(`❌ Error scanning liquidation opportunities on chain ${chainId}:`, error);
      
      // Log error
      await DatabaseService.logActivity({
        chain_id: chainId,
        level: 'error',
        message: `Liquidation scan failed`,
        data: { chainId, minHealthFactor, maxHealthFactor, error: error.message }
      });
      
      return [];
    }
  }

  private async analyzeLiquidationOpportunity(
    chainId: number,
    position: any
  ): Promise<LiquidationOpportunity | null> {
    try {
      const poolContract = await this.getPoolContract(chainId);
      
      // Calculate maximum liquidation amount (50% of debt or collateral)
      const debtAmount = ethers.utils.parseUnits(position.debt_amount, 18);
      const collateralAmount = ethers.utils.parseUnits(position.collateral_amount, 18);
      
      const maxLiquidationDebt = debtAmount.div(2); // 50% of debt
      const maxLiquidationCollateral = collateralAmount.mul(ethers.utils.parseUnits('0.5', 18)).div(ethers.utils.parseUnits('1', 18));
      
      const maxLiquidationAmount = maxLiquidationDebt.lt(maxLiquidationCollateral) ? maxLiquidationDebt : maxLiquidationCollateral;
      
      // Calculate potential profit
      const liquidationBonus = ethers.utils.parseUnits(position.liquidation_bonus.toString(), 18);
      const profitAmount = maxLiquidationAmount.mul(liquidationBonus).div(ethers.utils.parseUnits('1', 18));
      
      // Estimate gas cost
      const gasEstimate = await this.estimateLiquidationGas(chainId, position.user_address, position.collateral_asset, position.debt_asset, maxLiquidationAmount);
      
      const opportunity: LiquidationOpportunity = {
        user: position.user_address,
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset,
        collateralAmount: position.collateral_amount,
        debtAmount: position.debt_amount,
        healthFactor: position.health_factor,
        liquidationThreshold: position.liquidation_threshold,
        liquidationBonus: position.liquidation_bonus,
        maxLiquidationAmount: ethers.utils.formatUnits(maxLiquidationAmount, 18),
        potentialProfit: ethers.utils.formatUnits(profitAmount, 18),
        gasEstimate: gasEstimate.toString()
      };
      
      return opportunity;
    } catch (error) {
      console.error(`❌ Error analyzing liquidation opportunity:`, error);
      return null;
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

    // Aave V3 Pool ABI (simplified)
    const poolABI = [
      'function getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
      'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint256 stableRateLastUpdated, uint256 usageAsCollateralEnabled)',
      'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint128 averageStableBorrowRate, uint128 liquidityIndex, uint128 variableBorrowIndex, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint128 averageStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)',
      'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external',
      'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] interestRateModes, address onBehalfOf, bytes params, uint16 referralCode) external'
    ];

    const contract = new ethers.Contract(chain.poolAddress, poolABI, provider);
    this.poolContracts.set(chainId, contract);
    
    return contract;
  }

  private async getTokenDecimals(chainId: number, tokenAddress: string): Promise<number> {
    try {
      const provider = this.providers.get(chainId);
      if (!provider) return 18; // Default to 18 decimals

      const tokenABI = ['function decimals() view returns (uint8)'];
      const tokenContract = new ethers.Contract(tokenAddress, tokenABI, provider);
      const decimals = await tokenContract.decimals();
      return decimals;
    } catch (error) {
      console.warn(`⚠️ Could not get decimals for token ${tokenAddress} on chain ${chainId}, using 18`);
      return 18;
    }
  }

  private async estimateLiquidationGas(
    chainId: number,
    userAddress: string,
    collateralAsset: string,
    debtAsset: string,
    liquidationAmount: ethers.BigNumber
  ): Promise<number> {
    try {
      const poolContract = await this.getPoolContract(chainId);
      
      // Estimate gas for liquidation call
      const gasEstimate = await poolContract.estimateGas.liquidationCall(
        collateralAsset,
        debtAsset,
        userAddress,
        liquidationAmount,
        false // receiveAToken = false
      );
      
      return gasEstimate.toNumber();
    } catch (error) {
      console.warn(`⚠️ Could not estimate gas for liquidation, using default`);
      return 500000; // Default gas estimate
    }
  }

  public async getChainHealthSummary(chainId: number): Promise<{
    totalPositions: number;
    liquidatablePositions: number;
    averageHealthFactor: number;
    totalCollateral: string;
    totalDebt: string;
  }> {
    try {
      // This would require more complex queries to get all positions
      // For now, return basic stats from database
      const positions = await DatabaseService.getLiquidatablePositions(chainId, 0, 2.0);
      
      const liquidatablePositions = positions.filter(p => p.is_liquidatable).length;
      const averageHealthFactor = positions.reduce((sum, p) => sum + p.health_factor, 0) / positions.length || 0;
      const totalCollateral = positions.reduce((sum, p) => sum + parseFloat(p.collateral_amount), 0).toString();
      const totalDebt = positions.reduce((sum, p) => sum + parseFloat(p.debt_amount), 0).toString();
      
      return {
        totalPositions: positions.length,
        liquidatablePositions,
        averageHealthFactor,
        totalCollateral,
        totalDebt
      };
    } catch (error) {
      console.error(`❌ Error getting chain health summary for chain ${chainId}:`, error);
      return {
        totalPositions: 0,
        liquidatablePositions: 0,
        averageHealthFactor: 0,
        totalCollateral: '0',
        totalDebt: '0'
      };
    }
  }
}
