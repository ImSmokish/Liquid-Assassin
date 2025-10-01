import { ethers } from 'ethers';

// WebSocket data source configurations for optimal performance
export class WebSocketDataSources {
  
  // 🚀 RECOMMENDED: Alchemy WebSocket (Most Reliable)
  static readonly ALCHEMY_ENDPOINTS = {
    ethereum: 'wss://eth-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz',
    optimism: 'wss://opt-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz',
    arbitrum: 'wss://arb-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz',
    polygon: 'wss://poly-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz'
  };

  // 🔥 ALTERNATIVE: QuickNode WebSocket (High Performance)
  static readonly QUICKNODE_ENDPOINTS = {
    ethereum: 'wss://your-endpoint.quiknode.pro/YOUR_API_KEY/',
    optimism: 'wss://your-optimism-endpoint.quiknode.pro/YOUR_API_KEY/',
    arbitrum: 'wss://your-arbitrum-endpoint.quiknode.pro/YOUR_API_KEY/',
    polygon: 'wss://your-polygon-endpoint.quiknode.pro/YOUR_API_KEY/'
  };

  // ⚡ ALTERNATIVE: Infura WebSocket (Enterprise Grade)
  static readonly INFURA_ENDPOINTS = {
    ethereum: 'wss://mainnet.infura.io/ws/v3/YOUR_PROJECT_ID',
    optimism: 'wss://optimism-mainnet.infura.io/ws/v3/YOUR_PROJECT_ID',
    arbitrum: 'wss://arbitrum-mainnet.infura.io/ws/v3/YOUR_PROJECT_ID',
    polygon: 'wss://polygon-mainnet.infura.io/ws/v3/YOUR_PROJECT_ID'
  };

  // 🎯 SPECIALIZED: Moralis WebSocket (DeFi Focused)
  static readonly MORALIS_ENDPOINTS = {
    multiChain: 'wss://ws.moralis.io/streams',
    apiKey: 'YOUR_MORALIS_API_KEY'
  };

  // 📊 PRICE DATA: Real-time price feeds
  static readonly PRICE_ENDPOINTS = {
    coingecko: 'wss://ws.coingecko.com/v3/ws',
    cryptocompare: 'wss://streamer.cryptocompare.com/v2',
    binance: 'wss://stream.binance.com:9443/ws/ethusdt@ticker'
  };

  // 🔍 LIQUIDATION EVENTS: Aave V3 specific events
  static readonly AAVE_V3_EVENTS = {
    liquidationCall: 'LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)',
    reserveDataUpdated: 'ReserveDataUpdated(address indexed reserve, uint256 liquidityRate, uint256 stableBorrowRate, uint256 variableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex)',
    userAccountDataUpdated: 'UserAccountDataUpdated(address indexed user, uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
  };

  // 🎯 OPTIMAL CONFIGURATION FOR 5-10 SECOND REFRESH
  static getOptimalConfiguration() {
    return {
      // Primary data source (most reliable)
      primary: {
        provider: 'alchemy',
        endpoints: this.ALCHEMY_ENDPOINTS,
        features: [
          'Real-time liquidation events',
          'Sub-second latency',
          '99.9% uptime',
          'Automatic reconnection',
          'Event filtering'
        ]
      },
      
      // Backup data source (fallback)
      backup: {
        provider: 'quicknode',
        endpoints: this.QUICKNODE_ENDPOINTS,
        features: [
          'High performance',
          'Enterprise grade',
          'Global CDN',
          'Advanced monitoring'
        ]
      },
      
      // Price data source (for profit calculations)
      priceData: {
        provider: 'coingecko',
        endpoint: this.PRICE_ENDPOINTS.coingecko,
        refreshRate: '5 seconds',
        features: [
          'Real-time price updates',
          'Multi-token support',
          'Historical data',
          'Market cap data'
        ]
      },
      
      // Monitoring configuration
      monitoring: {
        refreshInterval: 5000, // 5 seconds
        maxRetries: 3,
        retryDelay: 2000, // 2 seconds
        healthCheckInterval: 30000, // 30 seconds
        connectionTimeout: 10000 // 10 seconds
      }
    };
  }

  // 🔧 WebSocket connection factory
  static createWebSocketProvider(chain: string, provider: 'alchemy' | 'quicknode' | 'infura' = 'alchemy'): ethers.WebSocketProvider {
    let endpoint: string;
    
    switch (provider) {
      case 'alchemy':
        endpoint = this.ALCHEMY_ENDPOINTS[chain as keyof typeof this.ALCHEMY_ENDPOINTS];
        break;
      case 'quicknode':
        endpoint = this.QUICKNODE_ENDPOINTS[chain as keyof typeof this.QUICKNODE_ENDPOINTS];
        break;
      case 'infura':
        endpoint = this.INFURA_ENDPOINTS[chain as keyof typeof this.INFURA_ENDPOINTS];
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
    
    if (!endpoint) {
      throw new Error(`No endpoint configured for chain: ${chain}`);
    }
    
    return new ethers.WebSocketProvider(endpoint);
  }

  // 📊 Event subscription configuration
  static getEventSubscriptions() {
    return {
      // High-priority events (immediate processing)
      highPriority: [
        'LiquidationCall',
        'UserAccountDataUpdated'
      ],
      
      // Medium-priority events (5-second processing)
      mediumPriority: [
        'ReserveDataUpdated',
        'Borrow',
        'Repay'
      ],
      
      // Low-priority events (10-second processing)
      lowPriority: [
        'Supply',
        'Withdraw',
        'FlashLoan'
      ]
    };
  }

  // 🔄 Connection health monitoring
  static createHealthMonitor() {
    return {
      checkInterval: 30000, // 30 seconds
      timeout: 10000, // 10 seconds
      maxFailures: 3,
      retryDelay: 5000, // 5 seconds
      
      // Health check endpoints
      endpoints: {
        ethereum: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
        optimism: 'https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
        arbitrum: 'https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
        polygon: 'https://poly-mainnet.g.alchemy.com/v2/YOUR_API_KEY'
      }
    };
  }
}

// 🎯 RECOMMENDED SETUP FOR YOUR BOT:
export const RECOMMENDED_CONFIG = {
  // Use Alchemy as primary (most reliable for DeFi)
  primaryProvider: 'alchemy',
  
  // Use QuickNode as backup (high performance)
  backupProvider: 'quicknode',
  
  // 5-second refresh rate for optimal performance
  refreshRate: 5000,
  
  // Event priorities for liquidation monitoring
  eventPriorities: {
    liquidation: 'high', // Immediate processing
    healthFactor: 'high', // Immediate processing
    priceUpdate: 'medium', // 5-second processing
    generalEvents: 'low' // 10-second processing
  },
  
  // Connection management
  connectionManagement: {
    autoReconnect: true,
    maxReconnectAttempts: 5,
    reconnectDelay: 2000,
    healthCheckInterval: 30000
  }
};
