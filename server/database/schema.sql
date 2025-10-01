-- LiquidAssassin Database Schema
-- Multi-chain liquidation bot database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Bot configurations table
CREATE TABLE IF NOT EXISTS bot_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    chain_name VARCHAR(50) NOT NULL,
    contract_address VARCHAR(42),
    owner_address VARCHAR(42) NOT NULL,
    monitoring_min DECIMAL(10,4) DEFAULT 0.75,
    monitoring_max DECIMAL(10,4) DEFAULT 1.05,
    execution_min DECIMAL(10,4) DEFAULT 0.85,
    execution_max DECIMAL(10,4) DEFAULT 0.87,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Liquidation positions table
CREATE TABLE IF NOT EXISTS liquidation_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    collateral_asset VARCHAR(42) NOT NULL,
    debt_asset VARCHAR(42) NOT NULL,
    collateral_amount DECIMAL(78,18) NOT NULL,
    debt_amount DECIMAL(78,18) NOT NULL,
    health_factor DECIMAL(10,4) NOT NULL,
    liquidation_threshold DECIMAL(10,4) NOT NULL,
    liquidation_bonus DECIMAL(10,4) NOT NULL,
    is_liquidatable BOOLEAN DEFAULT false,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Liquidation attempts table
CREATE TABLE IF NOT EXISTS liquidation_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    position_id UUID REFERENCES liquidation_positions(id),
    user_address VARCHAR(42) NOT NULL,
    collateral_asset VARCHAR(42) NOT NULL,
    debt_asset VARCHAR(42) NOT NULL,
    liquidation_amount DECIMAL(78,18) NOT NULL,
    flash_loan_amount DECIMAL(78,18) NOT NULL,
    gas_used BIGINT,
    gas_price DECIMAL(20,0),
    transaction_hash VARCHAR(66),
    status VARCHAR(20) DEFAULT 'pending', -- pending, success, failed, reverted
    profit_amount DECIMAL(78,18),
    profit_token VARCHAR(42),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Profit tracking table
CREATE TABLE IF NOT EXISTS profits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    token_symbol VARCHAR(10) NOT NULL,
    amount DECIMAL(78,18) NOT NULL,
    usd_value DECIMAL(20,2),
    liquidation_attempt_id UUID REFERENCES liquidation_attempts(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER,
    level VARCHAR(10) NOT NULL, -- info, warn, error, success
    message TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chain status table
CREATE TABLE IF NOT EXISTS chain_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id INTEGER UNIQUE NOT NULL,
    chain_name VARCHAR(50) NOT NULL,
    is_monitoring BOOLEAN DEFAULT false,
    last_block_number BIGINT,
    last_health_check TIMESTAMP WITH TIME ZONE,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_liquidation_positions_chain_health ON liquidation_positions(chain_id, health_factor);
CREATE INDEX IF NOT EXISTS idx_liquidation_positions_liquidatable ON liquidation_positions(is_liquidatable, chain_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_attempts_status ON liquidation_attempts(status, chain_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_attempts_created_at ON liquidation_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_chain_level ON activity_logs(chain_id, level);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_profits_chain_token ON profits(chain_id, token_address);

-- Update triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bot_configs_updated_at BEFORE UPDATE ON bot_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chain_status_updated_at BEFORE UPDATE ON chain_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
