export interface BotState {
  status: 'STOPPED' | 'MONITORING' | 'EXECUTING';
  isMonitoring: boolean;
  isExecuting: boolean;
  positionsCount: number;
  executionsCount: number;
  totalProfit: number;
  lastScan?: Date;
}

export interface Position {
  id: string;
  userAddress: string;
  healthFactor: number;
  collateralAsset: string;
  collateralAmount: string;
  debtAsset: string;
  debtAmount: string;
  estimatedProfit: number;
  status: 'monitoring' | 'in_range' | 'executed';
  firstSeen: Date;
  lastUpdated: Date;
}

export interface BotConfig {
  contractAddress: string;
  rpcUrl: string;
  minHealthFactor: number;
  maxHealthFactor: number;
  privateKey: string;
  maxGasPrice: number;
  scanInterval: number;
}

export interface ValidationState {
  contractAddress: 'valid' | 'invalid' | 'empty';
  rpcUrl: 'valid' | 'invalid' | 'empty';
  healthFactors: 'valid' | 'invalid';
  privateKey: 'valid' | 'empty';
}

export interface ActivityLogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
}

export interface WebSocketMessage {
  type: 'activity_log' | 'activity_cleared' | 'bot_status_change' | 'initial_activity' | 'initial_positions' | 'position_update';
  data: any;
}
