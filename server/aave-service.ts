import { request, gql } from 'graphql-request';
import { ethers } from 'ethers';
import type { LiquidationPosition } from '@shared/schema';

export interface AaveUserReserve {
  id: string;
  user: { id: string };
  reserve: {
    id: string;
    symbol: string;
    name: string;
    decimals: number;
    liquidationThreshold: string;
    liquidationBonus: string;
    usageAsCollateralEnabled: boolean;
    borrowingEnabled: boolean;
    price: { priceInEth: string };
  };
  currentATokenBalance: string;
  currentVariableDebt: string;
  currentStableDebt: string;
  liquidityRate: string;
  usageAsCollateralEnabledOnUser: boolean;
  stableBorrowRate: string;
  variableBorrowRate: string;
}

export interface AaveUser {
  id: string;
  reserves: AaveUserReserve[];
}

export interface HealthFactorData {
  userAddress: string;
  healthFactor: number;
  totalCollateralETH: number;
  totalDebtETH: number;
  availableBorrowsETH: number;
  currentLiquidationThreshold: number;
  ltv: number;
  reserves: AaveUserReserve[];
}

export class AaveService {
  private subgraphUrl: string;
  private provider: ethers.JsonRpcProvider | null = null;
  private ethPrice: number = 3200; // Fallback ETH price, should be updated from oracle

  constructor() {
    // AAVE V3 Ethereum mainnet subgraph
    this.subgraphUrl = 'https://gateway-arbitrum.network.thegraph.com/api/b1b0b4b4c5c5c5c5c5c5c5c5c5c5c5c5/subgraphs/id/HB1Z2EAw4rtPRYVb2Nz8QGFLHCpym6ByBX6vbCViuE9F';
  }

  public setRpcProvider(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  // Query to get users with active debt positions
  private getUsersWithDebtQuery = gql`
    query GetUsersWithDebt($first: Int!, $skip: Int!) {
      users(
        first: $first
        skip: $skip
        where: { 
          reserves_: { 
            currentVariableDebt_gt: "0"
          }
        }
      ) {
        id
        reserves {
          id
          currentATokenBalance
          currentVariableDebt
          currentStableDebt
          usageAsCollateralEnabledOnUser
          reserve {
            id
            symbol
            name
            decimals
            liquidationThreshold
            liquidationBonus
            usageAsCollateralEnabled
            borrowingEnabled
            price {
              priceInEth
            }
          }
        }
      }
    }
  `;

  // Query to get users with stable debt (run separately)
  private getUsersWithStableDebtQuery = gql`
    query GetUsersWithStableDebt($first: Int!, $skip: Int!) {
      users(
        first: $first
        skip: $skip
        where: { 
          reserves_: { 
            currentStableDebt_gt: "0"
          }
        }
      ) {
        id
        reserves {
          id
          currentATokenBalance
          currentVariableDebt
          currentStableDebt
          usageAsCollateralEnabledOnUser
          reserve {
            id
            symbol
            name
            decimals
            liquidationThreshold
            liquidationBonus
            usageAsCollateralEnabled
            borrowingEnabled
            price {
              priceInEth
            }
          }
        }
      }
    }
  `;

  // Calculate health factor for a user
  public calculateHealthFactor(user: AaveUser): HealthFactorData {
    let totalCollateralETH = 0;
    let totalDebtETH = 0;
    let totalCollateralWithThreshold = 0;
    let currentLiquidationThreshold = 0;

    for (const reserve of user.reserves) {
      const decimals = parseInt(reserve.reserve.decimals.toString());
      const priceInEth = parseFloat(reserve.reserve.price.priceInEth);
      const liquidationThreshold = parseInt(reserve.reserve.liquidationThreshold) / 10000; // Convert from basis points

      // Calculate collateral value
      if (reserve.usageAsCollateralEnabledOnUser && parseFloat(reserve.currentATokenBalance) > 0) {
        const collateralAmount = parseFloat(reserve.currentATokenBalance) / Math.pow(10, decimals);
        const collateralValueETH = collateralAmount * priceInEth;
        
        totalCollateralETH += collateralValueETH;
        totalCollateralWithThreshold += collateralValueETH * liquidationThreshold;
      }

      // Calculate debt value
      const totalDebt = parseFloat(reserve.currentVariableDebt) + parseFloat(reserve.currentStableDebt);
      if (totalDebt > 0) {
        const debtAmount = totalDebt / Math.pow(10, decimals);
        const debtValueETH = debtAmount * priceInEth;
        totalDebtETH += debtValueETH;
      }
    }

    // Calculate current liquidation threshold
    if (totalCollateralETH > 0) {
      currentLiquidationThreshold = totalCollateralWithThreshold / totalCollateralETH;
    }

    // Calculate health factor
    const healthFactor = totalDebtETH > 0 ? totalCollateralWithThreshold / totalDebtETH : 999;

    return {
      userAddress: user.id,
      healthFactor,
      totalCollateralETH,
      totalDebtETH,
      availableBorrowsETH: Math.max(0, totalCollateralWithThreshold - totalDebtETH),
      currentLiquidationThreshold,
      ltv: totalCollateralETH > 0 ? totalDebtETH / totalCollateralETH : 0,
      reserves: user.reserves
    };
  }

  // Get liquidation opportunities based on health factor range
  public async getLiquidationOpportunities(
    monitoringMin: number = 0.75,
    monitoringMax: number = 1.05,
    executionMin: number = 0.85,
    executionMax: number = 0.87,
    maxUsers: number = 100
  ): Promise<LiquidationPosition[]> {
    try {
      const liquidationPositions: LiquidationPosition[] = [];
      let skip = 0;
      const batchSize = 50;
      let processedUsers = 0;

      while (processedUsers < maxUsers) {
        // Get users with variable debt
        const variableDebtData = await request(this.subgraphUrl, this.getUsersWithDebtQuery, {
          first: Math.min(batchSize, maxUsers - processedUsers),
          skip: skip
        }) as { users: AaveUser[] };

        // Get users with stable debt
        const stableDebtData = await request(this.subgraphUrl, this.getUsersWithStableDebtQuery, {
          first: Math.min(batchSize, maxUsers - processedUsers),
          skip: skip
        }) as { users: AaveUser[] };

        // Combine and deduplicate users
        const userMap = new Map<string, AaveUser>();
        [...(variableDebtData.users || []), ...(stableDebtData.users || [])].forEach(user => {
          userMap.set(user.id, user);
        });

        const allUsers = Array.from(userMap.values());

        if (allUsers.length === 0) {
          break;
        }

        for (const user of allUsers) {
          if (processedUsers >= maxUsers) break;

          const healthData = this.calculateHealthFactor(user);
          
          // Only include users with health factor in our monitoring range
          if (healthData.healthFactor >= monitoringMin && healthData.healthFactor <= monitoringMax) {
            const position = this.convertToLiquidationPosition(healthData, executionMin, executionMax);
            if (position) {
              liquidationPositions.push(position);
            }
          }

          processedUsers++;
        }

        skip += batchSize;
      }

      return liquidationPositions.sort((a, b) => a.healthFactor - b.healthFactor);
    } catch (error) {
      console.error('Error fetching liquidation opportunities:', error);
      return [];
    }
  }

  // Convert health factor data to liquidation position
  private convertToLiquidationPosition(healthData: HealthFactorData, executionMin: number, executionMax: number): LiquidationPosition | null {
    // Find the largest collateral position for liquidation
    let largestCollateral = { symbol: '', amount: '0', valueETH: 0 };
    let largestDebt = { symbol: '', amount: '0', valueETH: 0 };

    for (const reserve of healthData.reserves) {
      const decimals = parseInt(reserve.reserve.decimals.toString());
      const priceInEth = parseFloat(reserve.reserve.price.priceInEth);

      // Check collateral
      if (reserve.usageAsCollateralEnabledOnUser && parseFloat(reserve.currentATokenBalance) > 0) {
        const collateralAmount = parseFloat(reserve.currentATokenBalance) / Math.pow(10, decimals);
        const valueETH = collateralAmount * priceInEth;
        
        if (valueETH > largestCollateral.valueETH) {
          largestCollateral = {
            symbol: reserve.reserve.symbol,
            amount: collateralAmount.toFixed(6),
            valueETH
          };
        }
      }

      // Check debt
      const totalDebt = parseFloat(reserve.currentVariableDebt) + parseFloat(reserve.currentStableDebt);
      if (totalDebt > 0) {
        const debtAmount = totalDebt / Math.pow(10, decimals);
        const valueETH = debtAmount * priceInEth;
        
        if (valueETH > largestDebt.valueETH) {
          largestDebt = {
            symbol: reserve.reserve.symbol,
            amount: debtAmount.toFixed(6),
            valueETH
          };
        }
      }
    }

    if (largestCollateral.valueETH === 0 || largestDebt.valueETH === 0) {
      return null;
    }

    // Estimate profit (simplified calculation)
    const liquidationBonus = 0.05; // 5% typical bonus
    const estimatedProfitETH = Math.min(largestDebt.valueETH * 0.5, largestCollateral.valueETH) * liquidationBonus;
    const estimatedProfitUSD = estimatedProfitETH * this.ethPrice;

    // Determine status based on execution range
    let status: 'monitoring' | 'in_range' | 'executed' = 'monitoring';
    if (healthData.healthFactor >= executionMin && healthData.healthFactor <= executionMax) {
      status = 'in_range';
    }

    return {
      id: '', // Will be set by storage
      userAddress: healthData.userAddress,
      healthFactor: healthData.healthFactor,
      collateralAsset: largestCollateral.symbol,
      collateralAmount: largestCollateral.amount,
      debtAsset: largestDebt.symbol,
      debtAmount: largestDebt.amount,
      estimatedProfit: estimatedProfitUSD,
      status,
      firstSeen: new Date(),
      lastUpdated: new Date()
    };
  }

  // Get ETH price from a simple API (could be improved with oracle integration)
  public async updateEthPrice(): Promise<void> {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      if (data.ethereum && data.ethereum.usd) {
        this.ethPrice = data.ethereum.usd;
      }
    } catch (error) {
      console.error('Failed to update ETH price:', error);
      // Keep using fallback price
    }
  }

  // Monitor for new liquidation opportunities
  public async startMonitoring(
    config: {
      monitoringMin: number;
      monitoringMax: number;
      executionMin: number;
      executionMax: number;
      scanInterval: number;
      contractAddress: string;
      rpcUrl?: string;
    },
    onNewPositions: (positions: LiquidationPosition[]) => void
  ): Promise<() => void> {
    
    if (config.rpcUrl) {
      this.setRpcProvider(config.rpcUrl);
    }

    // Update ETH price initially
    await this.updateEthPrice();

    const monitoringInterval = setInterval(async () => {
      try {
        // Update ETH price periodically
        await this.updateEthPrice();
        
        // Get liquidation opportunities
        const positions = await this.getLiquidationOpportunities(
          config.monitoringMin,
          config.monitoringMax,
          config.executionMin,
          config.executionMax,
          200 // Monitor up to 200 users
        );

        onNewPositions(positions);
      } catch (error) {
        console.error('Error during monitoring:', error);
      }
    }, config.scanInterval * 1000);

    // Return cleanup function
    return () => {
      clearInterval(monitoringInterval);
    };
  }
}

export const aaveService = new AaveService();