import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useWebSocket } from '@/hooks/use-websocket';
import { apiRequest } from '@/lib/queryClient';
import type { BotState, BotConfig, ValidationState, Position, ActivityLogEntry } from '@/types/bot';

interface ChainStatus {
  chain: string;
  usdc: number;
  isMonitoring: boolean;
  positions: number;
}

interface MultiChainPosition extends Position {
  chain: string;
  chainId: number;
  profitToken: string;
  estimatedGasCost: number;
  crossChainRequired: boolean;
}

export default function MultiChainDashboard() {
  const { toast } = useToast();
  const { isConnected, sendMessage, subscribe, unsubscribe } = useWebSocket();
  
  // State
  const [botState, setBotState] = useState<BotState>({
    status: 'STOPPED',
    isMonitoring: false,
    isExecuting: false,
    positionsCount: 0,
    executionsCount: 0,
    totalProfit: 0
  });

  const [monitoringRange, setMonitoringRange] = useState({
    min: 0.75,
    max: 1.05
  });
  
  const [executionRange, setExecutionRange] = useState({
    min: 0.85,
    max: 0.87
  });

  const [config, setConfig] = useState<BotConfig>({
    contractAddress: '',
    rpcUrl: 'https://eth.llamarpc.com',
    minHealthFactor: 0.82,
    maxHealthFactor: 0.85,
    privateKey: '',
    maxGasPrice: 50,
    scanInterval: 15
  });

  const [chainStatuses, setChainStatuses] = useState<ChainStatus[]>([]);
  const [positions, setPositions] = useState<MultiChainPosition[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [profitSummary, setProfitSummary] = useState<Record<string, { usdc: number; chain: string }>>({});
  const [isConsolidating, setIsConsolidating] = useState(false);
  
  // Wallet connection state
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [contractOwner, setContractOwner] = useState('');

  // Wallet connection functions
  const connectWallet = useCallback(async () => {
    try {
      if (!window.ethereum) {
        toast({
          title: "MetaMask Required",
          description: "Please install MetaMask to use this application",
          variant: "destructive"
        });
        return;
      }

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      
      setWalletAddress(address);
      setWalletConnected(true);
      
      addActivityLog(`Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`, 'success');
      
      // Check if this is the contract owner
      await checkContractOwnership(address);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect wallet. Please try again.",
        variant: "destructive"
      });
    }
  }, [addActivityLog, toast]);

  const checkContractOwnership = useCallback(async (address: string) => {
    if (!config.contractAddress) {
      setIsOwner(false);
      return;
    }

    try {
      // For multi-chain, we need to check ownership on each chain
      // For now, we'll assume the same owner address for all contracts
      const isContractOwner = address.toLowerCase() === contractOwner.toLowerCase();
      setIsOwner(isContractOwner);
      
      if (isContractOwner) {
        addActivityLog('Contract ownership verified. Full access granted.', 'success');
      } else {
        addActivityLog('Warning: You are not the contract owner. Limited access only.', 'warning');
      }
    } catch (error) {
      console.error('Failed to check contract ownership:', error);
      setIsOwner(false);
    }
  }, [config.contractAddress, contractOwner, addActivityLog]);

  const disconnectWallet = useCallback(() => {
    setWalletConnected(false);
    setWalletAddress('');
    setIsOwner(false);
    addActivityLog('Wallet disconnected.', 'info');
  }, [addActivityLog]);

  // Load configuration
  useEffect(() => {
    const savedConfig = localStorage.getItem('multi_chain_bot_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
        addActivityLog('Multi-chain configuration loaded.', 'success');
      } catch (error) {
        addActivityLog('Failed to load saved configuration.', 'error');
      }
    }
    addActivityLog('Multi-chain system initialized. Ready to monitor all chains.', 'info');
  }, []);

  // WebSocket subscriptions
  useEffect(() => {
    subscribe('activity_log', (data: ActivityLogEntry) => {
      setActivityLog(prev => [...prev.slice(-99), data]);
    });

    subscribe('multi_chain_positions', (data: MultiChainPosition[]) => {
      setPositions(data);
      setBotState(prev => ({ ...prev, positionsCount: data.length }));
    });

    return () => {
      unsubscribe('activity_log');
      unsubscribe('multi_chain_positions');
    };
  }, [subscribe, unsubscribe]);

  // Add activity log entry
  const addActivityLog = useCallback(async (message: string, type: 'info' | 'success' | 'warning' | 'error') => {
    try {
      await apiRequest('POST', '/api/activity', { message, type });
    } catch (error) {
      console.error('Failed to add activity log:', error);
    }
  }, []);

  // Start multi-chain monitoring
  const startMultiChainMonitoring = useCallback(async () => {
    if (!walletConnected || !isOwner) {
      toast({
        title: "Access Denied",
        description: "Only contract owners can start monitoring",
        variant: "destructive"
      });
      return;
    }

    try {
      await apiRequest('POST', '/api/multi-chain/start', {
        monitoringRange,
        executionRange,
        scanInterval: config.scanInterval,
        privateKey: config.privateKey
      });
      
      addActivityLog('Multi-chain monitoring started across all chains.', 'success');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start multi-chain monitoring",
        variant: "destructive"
      });
    }
  }, [walletConnected, isOwner, monitoringRange, executionRange, config, addActivityLog, toast]);

  // Execute liquidation
  const executeLiquidation = useCallback(async (positionId: string) => {
    if (!walletConnected || !isOwner) {
      toast({
        title: "Access Denied",
        description: "Only contract owners can execute liquidations",
        variant: "destructive"
      });
      return;
    }

    try {
      await apiRequest('POST', '/api/multi-chain/execute', {
        positionId,
        privateKey: config.privateKey
      });
      
      addActivityLog(`Liquidation executed for position ${positionId}`, 'success');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to execute liquidation",
        variant: "destructive"
      });
    }
  }, [walletConnected, isOwner, config.privateKey, addActivityLog, toast]);

  // Get profit summary
  const getProfitSummary = useCallback(async () => {
    try {
      const summary = await apiRequest('GET', `/api/multi-chain/profits?privateKey=${config.privateKey}`);
      setProfitSummary(summary);
    } catch (error) {
      console.error('Failed to get profit summary:', error);
    }
  }, [config.privateKey]);

  // Consolidate all profits to ETH on Ethereum
  const consolidateProfits = useCallback(async () => {
    if (!walletConnected || !isOwner) {
      toast({
        title: "Access Denied",
        description: "Only contract owners can consolidate profits",
        variant: "destructive"
      });
      return;
    }

    setIsConsolidating(true);
    try {
      const result = await apiRequest('POST', '/api/multi-chain/consolidate', {
        privateKey: config.privateKey,
        targetChain: 'ethereum',
        targetToken: 'ETH'
      });
      
      addActivityLog(`Profit consolidation completed! Consolidated $${result.totalConsolidated.toFixed(2)} to Ethereum as ETH.`, 'success');
      
      toast({
        title: "Consolidation Complete",
        description: `Successfully consolidated $${result.totalConsolidated.toFixed(2)} to ETH on Ethereum`,
        variant: "default"
      });

      // Refresh profit summary
      await getProfitSummary();
    } catch (error) {
      addActivityLog('Profit consolidation failed. Check logs for details.', 'error');
      toast({
        title: "Error",
        description: "Failed to consolidate profits",
        variant: "destructive"
      });
    } finally {
      setIsConsolidating(false);
    }
  }, [walletConnected, isOwner, config.privateKey, addActivityLog, toast, getProfitSummary]);

  // Load chain statuses
  const loadChainStatuses = useCallback(async () => {
    try {
      const status = await apiRequest('GET', '/api/multi-chain/status');
      setChainStatuses(Object.entries(status.profitSummary).map(([chain, data]: [string, any]) => ({
        chain,
        usdc: data.usdc,
        isMonitoring: status.isMonitoring,
        positions: positions.filter(p => p.chain === chain).length
      })));
    } catch (error) {
      console.error('Failed to load chain statuses:', error);
    }
  }, [positions]);

  useEffect(() => {
    loadChainStatuses();
    getProfitSummary();
  }, [loadChainStatuses, getProfitSummary]);

  const getChainColor = (chain: string) => {
    switch (chain) {
      case 'ethereum': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'optimism': return 'bg-red-100 text-red-800 border-red-200';
      case 'arbitrum': return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 'polygon': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getHealthFactorColor = (hf: number) => {
    if (hf < 0.85) return 'text-red-600 font-bold';
    if (hf < 0.9) return 'text-yellow-600 font-bold'; 
    if (hf < 0.95) return 'text-orange-600 font-bold';
    return 'text-green-600 font-bold';
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      {/* Navigation Header */}
      <nav className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold">LiquidAssassin</h1>
              <Badge variant="outline">Multi-Chain Bot</Badge>
            </div>
            <div className="flex items-center space-x-4">
              {walletConnected ? (
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${isOwner ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm font-mono">
                      {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                    </span>
                    {isOwner && (
                      <Badge variant="outline" className="text-green-600 border-green-200">
                        Owner
                      </Badge>
                    )}
                  </div>
                  <Button
                    onClick={disconnectWallet}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={connectWallet}
                  variant="default"
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Connect Wallet
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-primary mb-2">
              MULTI-CHAIN LIQUIDATION BOT
            </h1>
            <p className="text-muted-foreground">Monitor & Execute Across Ethereum, Optimism, Arbitrum & Polygon</p>
            <div className="mt-4 flex items-center justify-center gap-4 text-sm">
              <div className="flex items-center">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
              <div className="text-muted-foreground">|</div>
              <div>Monitor: <span className="text-blue-600">{monitoringRange.min}-{monitoringRange.max}</span></div>
              <div className="text-muted-foreground">|</div>
              <div>Execute: <span className="text-green-600">{executionRange.min}-{executionRange.max}</span></div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Chain Status Dashboard */}
        <Card className="bg-white shadow-xl border-0 rounded-2xl">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-2xl">
            <CardTitle className="text-2xl font-bold flex items-center">
              <span className="mr-3">🌐</span>
              Chain Status Dashboard
            </CardTitle>
            <p className="text-blue-100 mt-2">Monitor all chains for liquidation opportunities</p>
          </CardHeader>
          <CardContent className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {chainStatuses.map((status) => (
                <div key={status.chain} className={`p-4 rounded-xl border-2 ${getChainColor(status.chain)}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg capitalize">{status.chain}</h3>
                    <Badge variant="outline" className="text-xs">
                      {status.isMonitoring ? 'Monitoring' : 'Stopped'}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm">
                      <span className="font-medium">USDC:</span> ${status.usdc.toFixed(2)}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Positions:</span> {status.positions}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Configuration Panel */}
        <Card className="bg-white shadow-xl border-0 rounded-2xl">
          <CardHeader className="bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-t-2xl">
            <CardTitle className="text-2xl font-bold flex items-center">
              <span className="mr-3">⚙️</span>
              Multi-Chain Configuration
            </CardTitle>
            <p className="text-green-100 mt-2">Configure monitoring and execution ranges for all chains</p>
          </CardHeader>
          <CardContent className="p-8">
            {/* Contract Owner Configuration */}
            <div className="mb-6 p-4 bg-yellow-50 rounded-xl border-2 border-yellow-200">
              <Label className="text-sm font-semibold text-yellow-700 flex items-center mb-3">
                <span className="mr-2">🔐</span>
                Contract Owner Configuration
              </Label>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-medium text-yellow-700 mb-2 block">Contract Owner Address</Label>
                  <Input
                    type="text"
                    className="w-full px-4 py-3 rounded-lg border-2 border-yellow-300 bg-white text-gray-900"
                    placeholder="0x..."
                    value={contractOwner}
                    onChange={(e) => setContractOwner(e.target.value)}
                  />
                  <div className="mt-2 text-xs text-yellow-700">
                    ⚠️ <strong>Security:</strong> Only the contract owner can start monitoring, execute liquidations, and consolidate profits
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Monitoring Range */}
              <div className="space-y-4">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">👁️</span>
                  Monitoring Range (All Chains)
                </Label>
                <div className="bg-blue-50 p-4 rounded-xl border-2 border-blue-200">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-blue-700 mb-2 block">Monitor From</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-blue-300 bg-white text-gray-900"
                        step="0.01"
                        min="0.5"
                        max="1.5"
                        value={monitoringRange.min}
                        onChange={(e) => setMonitoringRange(prev => ({ ...prev, min: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div className="text-blue-600 font-medium">to</div>
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-blue-700 mb-2 block">Monitor To</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-blue-300 bg-white text-gray-900"
                        step="0.01"
                        min="0.5"
                        max="1.5"
                        value={monitoringRange.max}
                        onChange={(e) => setMonitoringRange(prev => ({ ...prev, max: parseFloat(e.target.value) }))}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution Range */}
              <div className="space-y-4">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">⚡</span>
                  Execution Range (All Chains)
                </Label>
                <div className="bg-green-50 p-4 rounded-xl border-2 border-green-200">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-green-700 mb-2 block">Execute From</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-green-300 bg-white text-gray-900"
                        step="0.01"
                        min="0.5"
                        max="1.0"
                        value={executionRange.min}
                        onChange={(e) => setExecutionRange(prev => ({ ...prev, min: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div className="text-green-600 font-medium">to</div>
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-green-700 mb-2 block">Execute To</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-green-300 bg-white text-gray-900"
                        step="0.01"
                        min="0.5"
                        max="1.0"
                        value={executionRange.max}
                        onChange={(e) => setExecutionRange(prev => ({ ...prev, max: parseFloat(e.target.value) }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="flex flex-wrap gap-4">
              <Button
                onClick={startMultiChainMonitoring}
                disabled={!walletConnected || !isOwner}
                className={`h-16 ${!walletConnected || !isOwner ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'} text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200`}
              >
                <div className="text-center">
                  <div className="text-2xl mb-1">🌐</div>
                  <div className="text-sm">
                    {!walletConnected ? 'CONNECT WALLET' : !isOwner ? 'OWNER ONLY' : 'START MULTI-CHAIN'}
                  </div>
                </div>
              </Button>
              
              <Button
                onClick={getProfitSummary}
                disabled={!walletConnected || !isOwner}
                className={`h-16 ${!walletConnected || !isOwner ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'} text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200`}
              >
                <div className="text-center">
                  <div className="text-2xl mb-1">💰</div>
                  <div className="text-sm">
                    {!walletConnected ? 'CONNECT WALLET' : !isOwner ? 'OWNER ONLY' : 'CHECK PROFITS'}
                  </div>
                </div>
              </Button>

              <Button
                onClick={consolidateProfits}
                disabled={!walletConnected || !isOwner || isConsolidating}
                className={`h-16 ${!walletConnected || !isOwner ? 'bg-gray-400' : isConsolidating ? 'bg-purple-400' : 'bg-purple-600 hover:bg-purple-700'} text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200`}
              >
                <div className="text-center">
                  <div className="text-2xl mb-1">{isConsolidating ? '⏳' : '🔄'}</div>
                  <div className="text-sm">
                    {!walletConnected ? 'CONNECT WALLET' : !isOwner ? 'OWNER ONLY' : isConsolidating ? 'CONSOLIDATING...' : 'CONSOLIDATE TO ETH'}
                  </div>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Multi-Chain Positions */}
        <Card className="bg-white shadow-xl border-0 rounded-2xl overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-purple-600 to-pink-600 text-white">
            <CardTitle className="text-2xl font-bold flex items-center">
              <span className="mr-3">🎯</span>
              Multi-Chain Positions
            </CardTitle>
            <p className="text-purple-100 mt-2">Liquidation opportunities across all chains</p>
          </CardHeader>
          <CardContent className="p-0">
            {positions.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-lg mb-2">🌐</div>
                <div>No positions found across all chains</div>
                <div className="text-sm mt-1">Start monitoring to see liquidation opportunities</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-sm text-gray-600">
                      <th className="px-6 py-3">Chain</th>
                      <th className="px-6 py-3">User Address</th>
                      <th className="px-6 py-3">Health Factor</th>
                      <th className="px-6 py-3">Collateral</th>
                      <th className="px-6 py-3">Debt</th>
                      <th className="px-6 py-3">Est. Profit</th>
                      <th className="px-6 py-3">Cross-Chain</th>
                      <th className="px-6 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position) => (
                      <tr key={position.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-6 py-3">
                          <Badge className={getChainColor(position.chain)}>
                            {position.chain.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 font-mono text-sm">
                          {position.userAddress.slice(0, 6)}...{position.userAddress.slice(-4)}
                        </td>
                        <td className="px-6 py-3">
                          <span className={getHealthFactorColor(position.healthFactor)}>
                            {position.healthFactor.toFixed(3)}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm">
                          {position.collateralAmount} {position.collateralAsset}
                        </td>
                        <td className="px-6 py-3 text-sm">
                          {position.debtAmount} {position.debtAsset}
                        </td>
                        <td className="px-6 py-3 text-green-600 font-bold">
                          ${position.estimatedProfit.toFixed(2)}
                        </td>
                        <td className="px-6 py-3">
                          {position.crossChainRequired ? (
                            <Badge variant="outline" className="text-orange-600 border-orange-200">
                              Required
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-200">
                              Same Chain
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <Button
                            onClick={() => executeLiquidation(position.id)}
                            disabled={!walletConnected || !isOwner || position.status === 'executed'}
                            className={`text-xs ${!walletConnected || !isOwner ? 'bg-gray-400' : position.status === 'executed' ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                          >
                            {!walletConnected ? 'Connect' : !isOwner ? 'Owner Only' : position.status === 'executed' ? 'Executed' : 'Execute'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Log */}
        <Card className="bg-white shadow-xl border-0 rounded-2xl overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-gray-600 to-gray-800 text-white">
            <CardTitle className="text-2xl font-bold flex items-center">
              <span className="mr-3">📋</span>
              Multi-Chain Activity Log
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-64 overflow-y-auto p-4 space-y-1">
              {activityLog.length === 0 ? (
                <div className="text-sm text-gray-500">No activity logs yet...</div>
              ) : (
                activityLog.map((entry) => (
                  <div
                    key={entry.id}
                    className={`text-sm ${
                      entry.type === 'success' ? 'text-green-600' :
                      entry.type === 'warning' ? 'text-yellow-600' :
                      entry.type === 'error' ? 'text-red-600' :
                      'text-gray-600'
                    }`}
                  >
                    [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.message}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
