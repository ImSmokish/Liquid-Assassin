import { pool } from './connection';

// Types for database models
export interface BotConfig {
  id: string;
  chain_id: number;
  chain_name: string;
  contract_address?: string;
  owner_address: string;
  monitoring_min: number;
  monitoring_max: number;
  execution_min: number;
  execution_max: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface LiquidationPosition {
  id: string;
  chain_id: number;
  user_address: string;
  collateral_asset: string;
  debt_asset: string;
  collateral_amount: string;
  debt_amount: string;
  health_factor: number;
  liquidation_threshold: number;
  liquidation_bonus: number;
  is_liquidatable: boolean;
  last_updated: Date;
  created_at: Date;
}

export interface LiquidationAttempt {
  id: string;
  chain_id: number;
  position_id: string;
  user_address: string;
  collateral_asset: string;
  debt_asset: string;
  liquidation_amount: string;
  flash_loan_amount: string;
  gas_used?: number;
  gas_price?: string;
  transaction_hash?: string;
  status: 'pending' | 'success' | 'failed' | 'reverted';
  profit_amount?: string;
  profit_token?: string;
  error_message?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface Profit {
  id: string;
  chain_id: number;
  token_address: string;
  token_symbol: string;
  amount: string;
  usd_value?: number;
  liquidation_attempt_id: string;
  created_at: Date;
}

export interface ActivityLog {
  id: string;
  chain_id?: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: any;
  created_at: Date;
}

export interface ChainStatus {
  id: string;
  chain_id: number;
  chain_name: string;
  is_monitoring: boolean;
  last_block_number?: number;
  last_health_check?: Date;
  error_count: number;
  last_error?: string;
  created_at: Date;
  updated_at: Date;
}

// Database operations
export class DatabaseService {
  // Bot Config operations
  static async createBotConfig(config: Omit<BotConfig, 'id' | 'created_at' | 'updated_at'>): Promise<BotConfig> {
    const query = `
      INSERT INTO bot_configs (chain_id, chain_name, contract_address, owner_address, 
                              monitoring_min, monitoring_max, execution_min, execution_max, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const values = [
      config.chain_id, config.chain_name, config.contract_address, config.owner_address,
      config.monitoring_min, config.monitoring_max, config.execution_min, config.execution_max, config.is_active
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async getBotConfig(chainId: number): Promise<BotConfig | null> {
    const query = 'SELECT * FROM bot_configs WHERE chain_id = $1';
    const result = await pool.query(query, [chainId]);
    return result.rows[0] || null;
  }

  static async updateBotConfig(chainId: number, updates: Partial<BotConfig>): Promise<BotConfig | null> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'created_at');
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [chainId, ...fields.map(field => updates[field as keyof BotConfig])];
    
    const query = `UPDATE bot_configs SET ${setClause} WHERE chain_id = $1 RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  // Liquidation Position operations
  static async upsertLiquidationPosition(position: Omit<LiquidationPosition, 'id' | 'created_at' | 'last_updated'>): Promise<LiquidationPosition> {
    const query = `
      INSERT INTO liquidation_positions (chain_id, user_address, collateral_asset, debt_asset, 
                                        collateral_amount, debt_amount, health_factor, 
                                        liquidation_threshold, liquidation_bonus, is_liquidatable)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (chain_id, user_address, collateral_asset, debt_asset)
      DO UPDATE SET
        collateral_amount = EXCLUDED.collateral_amount,
        debt_amount = EXCLUDED.debt_amount,
        health_factor = EXCLUDED.health_factor,
        liquidation_threshold = EXCLUDED.liquidation_threshold,
        liquidation_bonus = EXCLUDED.liquidation_bonus,
        is_liquidatable = EXCLUDED.is_liquidatable,
        last_updated = NOW()
      RETURNING *
    `;
    
    const values = [
      position.chain_id, position.user_address, position.collateral_asset, position.debt_asset,
      position.collateral_amount, position.debt_amount, position.health_factor,
      position.liquidation_threshold, position.liquidation_bonus, position.is_liquidatable
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async getLiquidatablePositions(chainId: number, minHealthFactor: number, maxHealthFactor: number): Promise<LiquidationPosition[]> {
    const query = `
      SELECT * FROM liquidation_positions 
      WHERE chain_id = $1 AND is_liquidatable = true 
      AND health_factor BETWEEN $2 AND $3
      ORDER BY health_factor ASC
    `;
    const result = await pool.query(query, [chainId, minHealthFactor, maxHealthFactor]);
    return result.rows;
  }

  // Liquidation Attempt operations
  static async createLiquidationAttempt(attempt: Omit<LiquidationAttempt, 'id' | 'created_at' | 'completed_at'>): Promise<LiquidationAttempt> {
    const query = `
      INSERT INTO liquidation_attempts (chain_id, position_id, user_address, collateral_asset, 
                                       debt_asset, liquidation_amount, flash_loan_amount, 
                                       gas_used, gas_price, transaction_hash, status, 
                                       profit_amount, profit_token, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    
    const values = [
      attempt.chain_id, attempt.position_id, attempt.user_address, attempt.collateral_asset,
      attempt.debt_asset, attempt.liquidation_amount, attempt.flash_loan_amount,
      attempt.gas_used, attempt.gas_price, attempt.transaction_hash, attempt.status,
      attempt.profit_amount, attempt.profit_token, attempt.error_message
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async updateLiquidationAttempt(id: string, updates: Partial<LiquidationAttempt>): Promise<LiquidationAttempt | null> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'created_at');
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [id, ...fields.map(field => updates[field as keyof LiquidationAttempt])];
    
    const query = `UPDATE liquidation_attempts SET ${setClause} WHERE id = $1 RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  // Profit operations
  static async recordProfit(profit: Omit<Profit, 'id' | 'created_at'>): Promise<Profit> {
    const query = `
      INSERT INTO profits (chain_id, token_address, token_symbol, amount, usd_value, liquidation_attempt_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      profit.chain_id, profit.token_address, profit.token_symbol,
      profit.amount, profit.usd_value, profit.liquidation_attempt_id
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async getProfitsByChain(chainId: number): Promise<Profit[]> {
    const query = 'SELECT * FROM profits WHERE chain_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [chainId]);
    return result.rows;
  }

  // Activity Log operations
  static async logActivity(log: Omit<ActivityLog, 'id' | 'created_at'>): Promise<ActivityLog> {
    const query = `
      INSERT INTO activity_logs (chain_id, level, message, data)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const values = [log.chain_id, log.level, log.message, log.data ? JSON.stringify(log.data) : null];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async getActivityLogs(chainId?: number, limit: number = 100): Promise<ActivityLog[]> {
    let query = 'SELECT * FROM activity_logs';
    const values: any[] = [];
    
    if (chainId) {
      query += ' WHERE chain_id = $1';
      values.push(chainId);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1);
    values.push(limit);
    
    const result = await pool.query(query, values);
    return result.rows;
  }

  // Chain Status operations
  static async updateChainStatus(chainId: number, updates: Partial<ChainStatus>): Promise<ChainStatus | null> {
    const fields = Object.keys(updates).filter(key => key !== 'id' && key !== 'created_at');
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const values = [chainId, ...fields.map(field => updates[field as keyof ChainStatus])];
    
    const query = `UPDATE chain_status SET ${setClause} WHERE chain_id = $1 RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  static async getChainStatus(chainId: number): Promise<ChainStatus | null> {
    const query = 'SELECT * FROM chain_status WHERE chain_id = $1';
    const result = await pool.query(query, [chainId]);
    return result.rows[0] || null;
  }

  static async getAllChainStatus(): Promise<ChainStatus[]> {
    const query = 'SELECT * FROM chain_status ORDER BY chain_id';
    const result = await pool.query(query);
    return result.rows;
  }
}
