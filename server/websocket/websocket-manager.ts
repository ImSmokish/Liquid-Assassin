import { WebSocket } from 'ws';
import { DatabaseService } from '../database/models';
import { CHAIN_CONFIGS } from '../multi-chain-service';

export interface WebSocketConnection {
  chainId: number;
  chainName: string;
  ws: WebSocket | null;
  isConnected: boolean;
  reconnectAttempts: number;
  lastPing: Date;
  subscriptions: string[];
}

export class WebSocketManager {
  private connections: Map<number, WebSocketConnection> = new Map();
  private reconnectIntervals: Map<number, NodeJS.Timeout> = new Map();
  private pingIntervals: Map<number, NodeJS.Timeout> = new Map();
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private pingInterval = 30000; // 30 seconds

  constructor() {
    this.initializeConnections();
  }

  private initializeConnections(): void {
    // Initialize connections for all supported chains
    Object.values(CHAIN_CONFIGS).forEach(chain => {
      this.connections.set(chain.chainId, {
        chainId: chain.chainId,
        chainName: chain.name,
        ws: null,
        isConnected: false,
        reconnectAttempts: 0,
        lastPing: new Date(),
        subscriptions: []
      });
    });
  }

  public async connect(chainId: number): Promise<boolean> {
    const connection = this.connections.get(chainId);
    if (!connection) {
      console.error(`❌ Chain ${chainId} not supported`);
      return false;
    }

    if (connection.isConnected) {
      console.log(`✅ Chain ${chainId} already connected`);
      return true;
    }

    try {
      const wsUrl = this.getWebSocketUrl(chainId);
      console.log(`🔌 Connecting to ${connection.chainName} WebSocket: ${wsUrl}`);

      const ws = new WebSocket(wsUrl);
      connection.ws = ws;

      ws.on('open', () => {
        console.log(`✅ Connected to ${connection.chainName} WebSocket`);
        connection.isConnected = true;
        connection.reconnectAttempts = 0;
        connection.lastPing = new Date();
        
        // Log successful connection
        DatabaseService.logActivity({
          chain_id: chainId,
          level: 'success',
          message: `WebSocket connected to ${connection.chainName}`,
          data: { chainId, chainName: connection.chainName }
        });

        // Start ping interval
        this.startPingInterval(chainId);
      });

      ws.on('message', (data) => {
        this.handleMessage(chainId, data);
      });

      ws.on('close', (code, reason) => {
        console.log(`❌ ${connection.chainName} WebSocket closed: ${code} - ${reason}`);
        connection.isConnected = false;
        connection.ws = null;
        
        // Log disconnection
        DatabaseService.logActivity({
          chain_id: chainId,
          level: 'warn',
          message: `WebSocket disconnected from ${connection.chainName}`,
          data: { code, reason: reason.toString() }
        });

        // Attempt reconnection
        this.scheduleReconnect(chainId);
      });

      ws.on('error', (error) => {
        console.error(`❌ ${connection.chainName} WebSocket error:`, error);
        connection.isConnected = false;
        
        // Log error
        DatabaseService.logActivity({
          chain_id: chainId,
          level: 'error',
          message: `WebSocket error on ${connection.chainName}`,
          data: { error: error.message }
        });

        // Attempt reconnection
        this.scheduleReconnect(chainId);
      });

      return true;
    } catch (error) {
      console.error(`❌ Failed to connect to ${connection.chainName}:`, error);
      this.scheduleReconnect(chainId);
      return false;
    }
  }

  public async disconnect(chainId: number): Promise<void> {
    const connection = this.connections.get(chainId);
    if (!connection || !connection.isConnected) {
      return;
    }

    console.log(`🔌 Disconnecting from ${connection.chainName} WebSocket`);
    
    // Clear intervals
    this.clearIntervals(chainId);
    
    // Close WebSocket
    if (connection.ws) {
      connection.ws.close();
      connection.ws = null;
    }
    
    connection.isConnected = false;
    connection.subscriptions = [];

    // Log disconnection
    DatabaseService.logActivity({
      chain_id: chainId,
      level: 'info',
      message: `Manually disconnected from ${connection.chainName}`,
      data: { chainId, chainName: connection.chainName }
    });
  }

  public async subscribeToNewHeads(chainId: number): Promise<boolean> {
    const connection = this.connections.get(chainId);
    if (!connection || !connection.isConnected || !connection.ws) {
      console.error(`❌ Cannot subscribe to new heads: Chain ${chainId} not connected`);
      return false;
    }

    try {
      const subscription = {
        id: 1,
        method: 'eth_subscribe',
        params: ['newHeads']
      };

      connection.ws.send(JSON.stringify(subscription));
      connection.subscriptions.push('newHeads');
      
      console.log(`✅ Subscribed to new heads for ${connection.chainName}`);
      
      // Log subscription
      DatabaseService.logActivity({
        chain_id: chainId,
        level: 'info',
        message: `Subscribed to new heads for ${connection.chainName}`,
        data: { subscription: 'newHeads' }
      });

      return true;
    } catch (error) {
      console.error(`❌ Failed to subscribe to new heads for ${connection.chainName}:`, error);
      return false;
    }
  }

  public async subscribeToLogs(chainId: number, address: string, topics: string[] = []): Promise<boolean> {
    const connection = this.connections.get(chainId);
    if (!connection || !connection.isConnected || !connection.ws) {
      console.error(`❌ Cannot subscribe to logs: Chain ${chainId} not connected`);
      return false;
    }

    try {
      const subscription = {
        id: 2,
        method: 'eth_subscribe',
        params: ['logs', {
          address: address,
          topics: topics
        }]
      };

      connection.ws.send(JSON.stringify(subscription));
      connection.subscriptions.push(`logs:${address}`);
      
      console.log(`✅ Subscribed to logs for ${connection.chainName} at ${address}`);
      
      // Log subscription
      DatabaseService.logActivity({
        chain_id: chainId,
        level: 'info',
        message: `Subscribed to logs for ${connection.chainName}`,
        data: { address, topics }
      });

      return true;
    } catch (error) {
      console.error(`❌ Failed to subscribe to logs for ${connection.chainName}:`, error);
      return false;
    }
  }

  public getConnectionStatus(chainId: number): WebSocketConnection | null {
    return this.connections.get(chainId) || null;
  }

  public getAllConnectionStatus(): WebSocketConnection[] {
    return Array.from(this.connections.values());
  }

  private getWebSocketUrl(chainId: number): string {
    const chain = Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Use Alchemy WebSocket URLs
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('ALCHEMY_API_KEY not found in environment variables');
    }

    return `wss://${chain.alchemyNetwork}.g.alchemy.com/v2/${alchemyKey}`;
  }

  private handleMessage(chainId: number, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.method === 'eth_subscription') {
        this.handleSubscriptionMessage(chainId, message);
      } else if (message.id) {
        // Handle RPC responses
        this.handleRpcResponse(chainId, message);
      }
    } catch (error) {
      console.error(`❌ Error parsing WebSocket message for chain ${chainId}:`, error);
    }
  }

  private handleSubscriptionMessage(chainId: number, message: any): void {
    const connection = this.connections.get(chainId);
    if (!connection) return;

    if (message.params?.subscription === 'newHeads') {
      this.handleNewBlock(chainId, message.params.result);
    } else if (message.params?.subscription?.startsWith('logs:')) {
      this.handleNewLog(chainId, message.params.result);
    }
  }

  private handleNewBlock(chainId: number, block: any): void {
    console.log(`📦 New block on chain ${chainId}: ${block.number}`);
    
    // Update chain status
    DatabaseService.updateChainStatus(chainId, {
      last_block_number: parseInt(block.number, 16),
      last_health_check: new Date(),
      error_count: 0
    });

    // Log new block
    DatabaseService.logActivity({
      chain_id: chainId,
      level: 'info',
      message: `New block received`,
      data: { 
        blockNumber: parseInt(block.number, 16),
        blockHash: block.hash,
        timestamp: parseInt(block.timestamp, 16)
      }
    });
  }

  private handleNewLog(chainId: number, log: any): void {
    console.log(`📝 New log on chain ${chainId}: ${log.transactionHash}`);
    
    // Log new log
    DatabaseService.logActivity({
      chain_id: chainId,
      level: 'info',
      message: `New log received`,
      data: {
        transactionHash: log.transactionHash,
        address: log.address,
        topics: log.topics,
        data: log.data
      }
    });
  }

  private handleRpcResponse(chainId: number, message: any): void {
    // Handle RPC responses (subscription confirmations, etc.)
    if (message.result && typeof message.result === 'string' && message.result.startsWith('0x')) {
      console.log(`✅ Subscription confirmed for chain ${chainId}: ${message.result}`);
    }
  }

  private scheduleReconnect(chainId: number): void {
    const connection = this.connections.get(chainId);
    if (!connection) return;

    if (connection.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts reached for ${connection.chainName}`);
      
      // Log max reconnection attempts
      DatabaseService.logActivity({
        chain_id: chainId,
        level: 'error',
        message: `Max reconnection attempts reached for ${connection.chainName}`,
        data: { attempts: connection.reconnectAttempts }
      });
      return;
    }

    connection.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, connection.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`🔄 Scheduling reconnection for ${connection.chainName} in ${delay}ms (attempt ${connection.reconnectAttempts})`);
    
    const timeout = setTimeout(() => {
      this.connect(chainId);
    }, delay);
    
    this.reconnectIntervals.set(chainId, timeout);
  }

  private startPingInterval(chainId: number): void {
    const interval = setInterval(() => {
      const connection = this.connections.get(chainId);
      if (!connection || !connection.isConnected || !connection.ws) {
        clearInterval(interval);
        return;
      }

      try {
        connection.ws.ping();
        connection.lastPing = new Date();
      } catch (error) {
        console.error(`❌ Ping failed for ${connection.chainName}:`, error);
        connection.isConnected = false;
        clearInterval(interval);
        this.scheduleReconnect(chainId);
      }
    }, this.pingInterval);
    
    this.pingIntervals.set(chainId, interval);
  }

  private clearIntervals(chainId: number): void {
    const reconnectInterval = this.reconnectIntervals.get(chainId);
    if (reconnectInterval) {
      clearTimeout(reconnectInterval);
      this.reconnectIntervals.delete(chainId);
    }

    const pingInterval = this.pingIntervals.get(chainId);
    if (pingInterval) {
      clearInterval(pingInterval);
      this.pingIntervals.delete(chainId);
    }
  }

  public async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up WebSocket connections...');
    
    // Clear all intervals
    this.reconnectIntervals.forEach(interval => clearTimeout(interval));
    this.pingIntervals.forEach(interval => clearInterval(interval));
    
    // Close all connections
    for (const [chainId, connection] of this.connections) {
      if (connection.isConnected && connection.ws) {
        connection.ws.close();
      }
    }
    
    this.connections.clear();
    this.reconnectIntervals.clear();
    this.pingIntervals.clear();
    
    console.log('✅ WebSocket cleanup completed');
  }
}
