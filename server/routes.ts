import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { aaveService } from "./aave-service";
import { multiChainService } from "./multi-chain-service";
import { crossChainBridgeService } from "./cross-chain-bridge";
import { insertBotConfigurationSchema, insertActivityLogSchema } from "@shared/schema";
import { DatabaseService } from "./database/models";
import { WebSocketManager } from "./websocket/websocket-manager";
import { HealthFactorCalculator } from "./liquidation/health-factor-calculator";
import { FlashLoanService } from "./flash-loan/flash-loan-service";
import { TokenSwapService } from "./swap/token-swap-service";
import { CrossChainBridge } from "./bridge/cross-chain-bridge";

// Global monitoring state
let monitoringCleanup: (() => void) | null = null;
let isMonitoring = false;
let isExecuting = false;
let currentConfig: any = null;

// Initialize new services
const webSocketManager = new WebSocketManager();
const healthFactorCalculator = new HealthFactorCalculator();
const flashLoanService = new FlashLoanService();
const tokenSwapService = new TokenSwapService();
const crossChainBridge = new CrossChainBridge();

export async function registerRoutes(app: Express): Promise<Server> {
  // Bot configuration routes
  app.get("/api/bot/config", async (req, res) => {
    try {
      const userId = "default"; // For demo purposes, using default user
      const config = await storage.getBotConfiguration(userId);
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to get bot configuration" });
    }
  });

  app.post("/api/bot/config", async (req, res) => {
    try {
      const validation = insertBotConfigurationSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid configuration data", details: validation.error });
      }
      
      const config = await storage.saveBotConfiguration(validation.data);
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to save bot configuration" });
    }
  });

  app.put("/api/bot/config", async (req, res) => {
    try {
      const userId = "default";
      const config = await storage.updateBotConfiguration(userId, req.body);
      if (!config) {
        return res.status(404).json({ error: "Configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to update bot configuration" });
    }
  });

  // Liquidation position routes
  app.get("/api/positions", async (req, res) => {
    try {
      const positions = await storage.getLiquidationPositions();
      res.json(positions);
    } catch (error) {
      res.status(500).json({ error: "Failed to get liquidation positions" });
    }
  });

  // Liquidation execution routes
  app.get("/api/executions", async (req, res) => {
    try {
      const executions = await storage.getLiquidationExecutions();
      res.json(executions);
    } catch (error) {
      res.status(500).json({ error: "Failed to get liquidation executions" });
    }
  });

  // Activity log routes
  app.get("/api/activity", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const logs = await storage.getActivityLogs(limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to get activity logs" });
    }
  });

  app.post("/api/activity", async (req, res) => {
    try {
      const validation = insertActivityLogSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid log data", details: validation.error });
      }
      
      const log = await storage.addActivityLog(validation.data);
      
      // Broadcast to WebSocket clients
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'activity_log', data: log }));
        }
      });
      
      res.json(log);
    } catch (error) {
      res.status(500).json({ error: "Failed to add activity log" });
    }
  });

  app.delete("/api/activity", async (req, res) => {
    try {
      await storage.clearActivityLogs();
      
      // Broadcast to WebSocket clients
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'activity_cleared' }));
        }
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear activity logs" });
    }
  });

  // Multi-chain monitoring routes
  app.get("/api/multi-chain/status", async (req, res) => {
    try {
      const profitSummary = await multiChainService.getProfitSummary();
      res.json({ 
        chains: Object.keys(profitSummary),
        profitSummary,
        isMonitoring 
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get multi-chain status" });
    }
  });

  app.post("/api/multi-chain/start", async (req, res) => {
    try {
      const { monitoringRange, executionRange, scanInterval, privateKey } = req.body;
      
      // Stop existing monitoring
      if (monitoringCleanup) {
        monitoringCleanup();
        monitoringCleanup = null;
      }

      // Start multi-chain monitoring
      monitoringCleanup = await multiChainService.startMultiChainMonitoring(
        {
          monitoringRange,
          executionRange,
          scanInterval,
          privateKey
        },
        async (positions) => {
          try {
            // Store positions
            const addPromises = positions.map(position => storage.addLiquidationPosition(position));
            await Promise.all(addPromises);

            // Broadcast to WebSocket clients
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                  type: 'multi_chain_positions', 
                  data: positions 
                }));
              }
            });

            // Log scan results
            await storage.addActivityLog({
              message: `Multi-chain scan completed. Found ${positions.length} positions across all chains`,
              type: "info"
            });
          } catch (error) {
            console.error('Error updating multi-chain positions:', error);
          }
        }
      );

      isMonitoring = true;
      res.json({ success: true, message: "Multi-chain monitoring started" });
    } catch (error) {
      res.status(500).json({ error: "Failed to start multi-chain monitoring" });
    }
  });

  app.post("/api/multi-chain/execute", async (req, res) => {
    try {
      const { positionId, privateKey } = req.body;
      
      // Get position from storage
      const positions = await storage.getLiquidationPositions();
      const position = positions.find(p => p.id === positionId);
      
      if (!position) {
        return res.status(404).json({ error: "Position not found" });
      }

      // Execute cross-chain liquidation
      const result = await multiChainService.executeCrossChainLiquidation(
        position as any, // Type assertion for multi-chain position
        privateKey
      );

      // Update position status
      await storage.updateLiquidationPosition(positionId, { status: 'executed' });

      // Log execution
      await storage.addActivityLog({
        message: `Liquidation executed on ${result.chain}. TX: ${result.txHash}. Profit: $${result.profit.toFixed(2)}`,
        type: "success"
      });

      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: "Failed to execute liquidation" });
    }
  });

  app.get("/api/multi-chain/profits", async (req, res) => {
    try {
      const { privateKey } = req.query;
      
      if (!privateKey) {
        return res.status(400).json({ error: "Private key required" });
      }

      const profitSummary = await crossChainBridgeService.aggregateProfits(
        privateKey as string
      );

      res.json(profitSummary);
    } catch (error) {
      res.status(500).json({ error: "Failed to get profit summary" });
    }
  });

  app.post("/api/multi-chain/bridge", async (req, res) => {
    try {
      const { fromChain, toChain, token, amount, privateKey } = req.body;
      
      const route = await crossChainBridgeService.findOptimalRoute(
        fromChain,
        toChain,
        token,
        amount
      );

      if (!route) {
        return res.status(400).json({ error: "No route found" });
      }

      const result = await crossChainBridgeService.executeCrossChainTransfer(
        route,
        token,
        amount,
        '', // Will use wallet address
        privateKey
      );

      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: "Failed to execute bridge transfer" });
    }
  });

  // Consolidate all profits to target chain and token
  app.post("/api/multi-chain/consolidate", async (req, res) => {
    try {
      const { privateKey, targetChain = 'ethereum', targetToken = 'ETH' } = req.body;
      
      if (!privateKey) {
        return res.status(400).json({ error: "Private key required" });
      }

      // Get current profit summary
      const profitSummary = await crossChainBridgeService.aggregateProfits(privateKey);
      
      const consolidationResults = [];
      let totalConsolidated = 0;

      // Process each chain (except target chain)
      for (const [chain, data] of Object.entries(profitSummary.chainBreakdown)) {
        if (chain !== targetChain && data > 0.01) { // Only consolidate if > $0.01
          try {
            // Find optimal route to target chain
            const route = await crossChainBridgeService.findOptimalRoute(
              chain,
              targetChain,
              CHAIN_CONFIGS[chain]?.usdcAddress || '',
              data.toString()
            );

            if (route) {
              // Execute bridge transfer
              const bridgeResult = await crossChainBridgeService.executeCrossChainTransfer(
                route,
                CHAIN_CONFIGS[chain].usdcAddress,
                data.toString(),
                '', // Will use wallet address
                privateKey
              );

              // If target token is ETH, swap USDC to ETH
              if (targetToken === 'ETH') {
                const swapQuote = await crossChainBridgeService.getSwapQuote(
                  targetChain,
                  CHAIN_CONFIGS[targetChain].usdcAddress,
                  CHAIN_CONFIGS[targetChain].wethAddress,
                  data.toString()
                );

                const swapResult = await crossChainBridgeService.executeSwap(
                  targetChain,
                  swapQuote,
                  privateKey
                );

                consolidationResults.push({
                  chain,
                  amount: data,
                  bridgeTx: bridgeResult.txHash,
                  swapTx: swapResult.txHash,
                  finalToken: 'ETH'
                });
              } else {
                consolidationResults.push({
                  chain,
                  amount: data,
                  bridgeTx: bridgeResult.txHash,
                  finalToken: 'USDC'
                });
              }

              totalConsolidated += data;
            }
          } catch (error) {
            console.error(`Error consolidating from ${chain}:`, error);
            consolidationResults.push({
              chain,
              amount: data,
              error: error.message
            });
          }
        }
      }

      // Log consolidation activity
      await storage.addActivityLog({
        message: `Profit consolidation completed. Consolidated $${totalConsolidated.toFixed(2)} to ${targetChain} as ${targetToken}. ${consolidationResults.length} transactions executed.`,
        type: "success"
      });

      res.json({ 
        success: true, 
        totalConsolidated,
        targetChain,
        targetToken,
        results: consolidationResults
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to consolidate profits" });
    }
  });

  // Enhanced WebSocket management routes
  app.get("/api/websocket/status", async (req, res) => {
    try {
      const status = webSocketManager.getAllConnectionStatus();
      res.json({ connections: status });
    } catch (error) {
      res.status(500).json({ error: "Failed to get WebSocket status" });
    }
  });

  app.post("/api/websocket/connect/:chainId", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const success = await webSocketManager.connect(chainId);
      
      if (success) {
        await webSocketManager.subscribeToNewHeads(chainId);
        res.json({ success: true, message: `Connected to chain ${chainId}` });
      } else {
        res.status(500).json({ error: `Failed to connect to chain ${chainId}` });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to connect WebSocket" });
    }
  });

  app.post("/api/websocket/disconnect/:chainId", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      await webSocketManager.disconnect(chainId);
      res.json({ success: true, message: `Disconnected from chain ${chainId}` });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect WebSocket" });
    }
  });

  // Health factor calculation routes
  app.get("/api/health-factor/:chainId/:userAddress", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const userAddress = req.params.userAddress;
      const { collateralAsset, debtAsset } = req.query;
      
      if (!collateralAsset || !debtAsset) {
        return res.status(400).json({ error: "collateralAsset and debtAsset required" });
      }

      const position = await healthFactorCalculator.calculateHealthFactor(
        chainId,
        userAddress,
        collateralAsset as string,
        debtAsset as string
      );

      res.json({ position });
    } catch (error) {
      res.status(500).json({ error: "Failed to calculate health factor" });
    }
  });

  app.get("/api/health-factor/opportunities/:chainId", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const { minHealthFactor = 0.75, maxHealthFactor = 1.05 } = req.query;

      const opportunities = await healthFactorCalculator.scanLiquidationOpportunities(
        chainId,
        parseFloat(minHealthFactor as string),
        parseFloat(maxHealthFactor as string)
      );

      res.json({ opportunities });
    } catch (error) {
      res.status(500).json({ error: "Failed to scan liquidation opportunities" });
    }
  });

  app.get("/api/health-factor/summary/:chainId", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const summary = await healthFactorCalculator.getChainHealthSummary(chainId);
      res.json({ summary });
    } catch (error) {
      res.status(500).json({ error: "Failed to get chain health summary" });
    }
  });

  // Flash loan routes
  app.post("/api/flash-loan/execute", async (req, res) => {
    try {
      const { chainId, asset, amount, receiverAddress, params } = req.body;
      
      const result = await flashLoanService.executeFlashLoan({
        chainId,
        asset,
        amount,
        receiverAddress,
        params
      });

      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: "Failed to execute flash loan" });
    }
  });

  app.post("/api/flash-loan/liquidation", async (req, res) => {
    try {
      const { chainId, collateralAsset, debtAsset, userAddress, debtToCover, flashLoanAsset, flashLoanAmount } = req.body;
      
      const result = await flashLoanService.executeLiquidationWithFlashLoan({
        chainId,
        collateralAsset,
        debtAsset,
        userAddress,
        debtToCover,
        flashLoanAsset,
        flashLoanAmount
      });

      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: "Failed to execute liquidation with flash loan" });
    }
  });

  app.get("/api/flash-loan/assets/:chainId", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const assets = await flashLoanService.getAvailableFlashLoanAssets(chainId);
      res.json({ assets });
    } catch (error) {
      res.status(500).json({ error: "Failed to get available flash loan assets" });
    }
  });

  // Token swap routes
  app.get("/api/swap/quote", async (req, res) => {
    try {
      const { chainId, tokenIn, tokenOut, amountIn } = req.query;
      
      const quote = await tokenSwapService.getQuote({
        chainId: parseInt(chainId as string),
        tokenIn: tokenIn as string,
        tokenOut: tokenOut as string,
        amountIn: amountIn as string
      });

      res.json({ quote });
    } catch (error) {
      res.status(500).json({ error: "Failed to get swap quote" });
    }
  });

  app.post("/api/swap/execute", async (req, res) => {
    try {
      const { chainId, tokenIn, tokenOut, amountIn, recipient, slippageTolerance, deadline } = req.body;
      
      const result = await tokenSwapService.executeSwap({
        chainId,
        tokenIn,
        tokenOut,
        amountIn,
        recipient,
        slippageTolerance,
        deadline
      });

      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: "Failed to execute swap" });
    }
  });

  app.post("/api/swap/token-to-eth", async (req, res) => {
    try {
      const { chainId, tokenAddress, amount } = req.body;
      
      const result = await tokenSwapService.swapToETH(chainId, tokenAddress, amount);
      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: "Failed to swap token to ETH" });
    }
  });

  app.post("/api/swap/consolidate-to-eth", async (req, res) => {
    try {
      const results = await tokenSwapService.consolidateProfitsToETH();
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: "Failed to consolidate profits to ETH" });
    }
  });

  // Cross-chain bridge routes
  app.get("/api/bridge/routes", async (req, res) => {
    try {
      const { fromChainId, toChainId, tokenAddress, amount } = req.query;
      
      const route = await crossChainBridge.findBestBridgeRoute({
        fromChainId: parseInt(fromChainId as string),
        toChainId: parseInt(toChainId as string),
        tokenAddress: tokenAddress as string,
        amount: amount as string,
        recipient: process.env.OWNER_ADDRESS || ''
      });

      res.json({ route });
    } catch (error) {
      res.status(500).json({ error: "Failed to find bridge route" });
    }
  });

  app.post("/api/bridge/execute", async (req, res) => {
    try {
      const { fromChainId, toChainId, tokenAddress, amount, recipient } = req.body;
      
      const result = await crossChainBridge.executeBridge({
        fromChainId,
        toChainId,
        tokenAddress,
        amount,
        recipient
      });

      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: "Failed to execute bridge" });
    }
  });

  app.post("/api/bridge/consolidate", async (req, res) => {
    try {
      const results = await crossChainBridge.consolidateProfitsToEthereum();
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: "Failed to consolidate profits" });
    }
  });

  app.get("/api/bridge/status/:txHash/:chainId", async (req, res) => {
    try {
      const txHash = req.params.txHash;
      const chainId = parseInt(req.params.chainId);
      
      const status = await crossChainBridge.getBridgeStatus(txHash, chainId);
      res.json({ status });
    } catch (error) {
      res.status(500).json({ error: "Failed to get bridge status" });
    }
  });

  app.get("/api/bridge/tokens/:chainId", async (req, res) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const tokens = await crossChainBridge.getSupportedTokens(chainId);
      res.json({ tokens });
    } catch (error) {
      res.status(500).json({ error: "Failed to get supported tokens" });
    }
  });


  const httpServer = createServer(app);

  // Setup WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    
    // Send initial data
    storage.getActivityLogs(10).then(logs => {
      ws.send(JSON.stringify({ type: 'initial_activity', data: logs }));
    });
    
    storage.getLiquidationPositions().then(positions => {
      ws.send(JSON.stringify({ type: 'initial_positions', data: positions }));
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'start_monitoring':
            await startMonitoring(false);
            break;
            
          case 'start_executing':
            await startMonitoring(true);
            break;
            
          case 'stop_bot':
            await stopMonitoring();
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });

  // Helper functions for monitoring
  async function startMonitoring(executeMode: boolean) {
    try {
      // Stop existing monitoring if any
      if (monitoringCleanup) {
        monitoringCleanup();
        monitoringCleanup = null;
      }

      // Get current bot configuration
      const userId = "default";
      const config = await storage.getBotConfiguration(userId);
      
      if (!config) {
        await storage.addActivityLog({
          message: "No configuration found. Please set up bot configuration first.",
          type: "error"
        });
        return;
      }

      currentConfig = config;
      isMonitoring = true;
      isExecuting = executeMode;

      // Broadcast status change
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'bot_status_change', 
            data: { 
              status: executeMode ? 'EXECUTING' : 'MONITORING', 
              isExecuting: executeMode 
            }
          }));
        }
      });

      // Add activity log
      await storage.addActivityLog({
        message: `Started ${executeMode ? 'monitoring & execution' : 'monitoring only'} mode. Health factor range: ${config.minHealthFactor}-${config.maxHealthFactor}`,
        type: "info"
      });

      // Perform immediate initial scan
      await storage.addActivityLog({
        message: "Performing initial scan for liquidation opportunities...",
        type: "info"
      });
      
      try {
        // Clear any existing positions first
        const existingPositions = await storage.getLiquidationPositions();
        const removePromises = existingPositions.map(pos => storage.removeLiquidationPosition(pos.id));
        await Promise.all(removePromises);
        
        const initialPositions = await aaveService.getLiquidationOpportunities(
          config.monitoringMin || 0.75,
          config.monitoringMax || 1.05,
          config.executionMin || 0.85,
          config.executionMax || 0.87,
          100
        );
        
        // Add initial positions
        const addPromises = initialPositions.map(position => storage.addLiquidationPosition(position));
        const persistedPositions = await Promise.all(addPromises);
        
        // Broadcast initial positions immediately (use persisted records with IDs)
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ 
              type: 'position_update', 
              data: persistedPositions
            }));
          }
        });
        
        await storage.addActivityLog({
          message: `Initial scan completed. Found ${initialPositions.length} positions in range ${config.minHealthFactor}-${config.maxHealthFactor}`,
          type: "success"
        });
      } catch (error) {
        await storage.addActivityLog({
          message: `Initial scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          type: "error"
        });
      }

      // Start AAVE monitoring
      monitoringCleanup = await aaveService.startMonitoring(
        {
          monitoringMin: config.monitoringMin || 0.75,
          monitoringMax: config.monitoringMax || 1.05,
          executionMin: config.executionMin || 0.85,
          executionMax: config.executionMax || 0.87,
          scanInterval: config.scanInterval,
          contractAddress: config.contractAddress,
          rpcUrl: config.rpcUrl
        },
        async (positions) => {
          try {
            // Perform atomic position replacement
            const existingPositions = await storage.getLiquidationPositions();
            
            // Prepare new positions with IDs assigned
            const newPositionsWithIds = await Promise.all(
              positions.map(position => storage.addLiquidationPosition(position))
            );
            
            // Only remove old positions after new ones are successfully added
            const removePromises = existingPositions.map(pos => storage.removeLiquidationPosition(pos.id));
            await Promise.all(removePromises);

            // Broadcast position updates (use persisted records with IDs)
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                  type: 'position_update', 
                  data: newPositionsWithIds
                }));
              }
            });

            // Log scan results
            await storage.addActivityLog({
              message: `Scan completed. Found ${positions.length} positions in range ${config.minHealthFactor}-${config.maxHealthFactor}`,
              type: "info"
            });

            // If in execute mode, check for liquidation opportunities
            if (executeMode && positions.length > 0) {
              const inRangePositions = positions.filter(p => 
                p.healthFactor >= config.minHealthFactor && 
                p.healthFactor <= config.maxHealthFactor
              );
              
              if (inRangePositions.length > 0) {
                await storage.addActivityLog({
                  message: `Found ${inRangePositions.length} positions ready for liquidation. Contract: ${config.contractAddress}`,
                  type: "warning"
                });
              }
            }
          } catch (error) {
            console.error('Error updating positions:', error);
            await storage.addActivityLog({
              message: `Failed to update positions: ${error instanceof Error ? error.message : 'Unknown error'}`,
              type: "error"
            });
          }
        }
      );

    } catch (error) {
      await storage.addActivityLog({
        message: `Failed to start monitoring: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: "error"
      });
      console.error('Monitoring start error:', error);
    }
  }

  async function stopMonitoring() {
    try {
      // Stop monitoring
      if (monitoringCleanup) {
        monitoringCleanup();
        monitoringCleanup = null;
      }

      isMonitoring = false;
      isExecuting = false;
      currentConfig = null;

      // Clear all positions from storage
      const existingPositions = await storage.getLiquidationPositions();
      const removePromises = existingPositions.map(pos => storage.removeLiquidationPosition(pos.id));
      await Promise.all(removePromises);

      // Broadcast status change and position reset
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'bot_status_change', 
            data: { status: 'STOPPED', isExecuting: false }
          }));
          
          // Also broadcast empty positions
          client.send(JSON.stringify({ 
            type: 'position_update', 
            data: []
          }));
        }
      });

      // Add activity log
      await storage.addActivityLog({
        message: "Bot stopped. All monitoring has been disabled.",
        type: "info"
      });

    } catch (error) {
      console.error('Stop monitoring error:', error);
    }
  }

  return httpServer;
}
