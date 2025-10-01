import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useWebSocket } from '@/hooks/use-websocket';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import type { BotState, BotConfig, ValidationState, Position, ActivityLogEntry } from '@/types/bot';

export default function LiquidationBot() {
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

  const [config, setConfig] = useState<BotConfig>({
    contractAddress: '',
    rpcUrl: 'https://eth.llamarpc.com',
    minHealthFactor: 0.82,
    maxHealthFactor: 0.85,
    privateKey: '',
    maxGasPrice: 50,
    scanInterval: 15
  });

  // Separate monitoring and execution ranges
  const [monitoringRange, setMonitoringRange] = useState({
    min: 0.75,
    max: 1.05
  });
  
  const [executionRange, setExecutionRange] = useState({
    min: 0.85,
    max: 0.87
  });

  const [validation, setValidation] = useState<ValidationState>({
    contractAddress: 'empty',
    rpcUrl: 'valid',
    healthFactors: 'valid',
    privateKey: 'empty'
  });

  const [positions, setPositions] = useState<Position[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [currentBlockNumber, setCurrentBlockNumber] = useState<number>(18742000);
  const [currentGasPrice, setCurrentGasPrice] = useState<number>(25);
  
  // Wallet connection state
  const [walletConnected, setWalletConnected] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [contractOwner, setContractOwner] = useState<string>('');

  // Load configuration from localStorage
  useEffect(() => {
    const savedConfig = localStorage.getItem('aave_bot_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
        validateConfiguration(parsed);
        addActivityLog('Configuration loaded from localStorage.', 'success');
      } catch (error) {
        addActivityLog('Failed to load saved configuration.', 'error');
      }
    }
    addActivityLog('System initialized. Ready to start monitoring.', 'info');
  }, []);

  // WebSocket subscriptions
  useEffect(() => {
    subscribe('activity_log', (data: ActivityLogEntry) => {
      setActivityLog(prev => [...prev.slice(-99), data]);
    });

    subscribe('activity_cleared', () => {
      setActivityLog([]);
    });

    subscribe('bot_status_change', (data: { status: string, isExecuting: boolean }) => {
      setBotState(prev => ({
        ...prev,
        status: data.status as BotState['status'],
        isMonitoring: data.status !== 'STOPPED',
        isExecuting: data.isExecuting
      }));
    });

    subscribe('initial_activity', (data: ActivityLogEntry[]) => {
      setActivityLog(data);
    });

    subscribe('initial_positions', (data: Position[]) => {
      setPositions(data);
      setBotState(prev => ({ ...prev, positionsCount: data.length }));
    });

    subscribe('position_update', (data: Position[]) => {
      setPositions(data);
      setBotState(prev => ({ ...prev, positionsCount: data.length }));
    });

    return () => {
      unsubscribe('activity_log');
      unsubscribe('activity_cleared');
      unsubscribe('bot_status_change');
      unsubscribe('initial_activity');
      unsubscribe('initial_positions');
      unsubscribe('position_update');
    };
  }, [subscribe, unsubscribe]);

  // Simulate block number and gas price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBlockNumber(prev => prev + Math.floor(Math.random() * 3) + 1);
      setCurrentGasPrice(Math.floor(Math.random() * 50) + 10);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Configuration validation
  const validateConfiguration = useCallback((cfg: BotConfig) => {
    const contractValid = /^0x[a-fA-F0-9]{40}$/.test(cfg.contractAddress);
    const rpcValid = /^https?:\/\/[\w\-\.]+(\:\d+)?(\/.*)?$/.test(cfg.rpcUrl);
    const healthValid = cfg.minHealthFactor < cfg.maxHealthFactor;
    const keyValid = cfg.privateKey.length > 0;

    setValidation({
      contractAddress: cfg.contractAddress === '' ? 'empty' : contractValid ? 'valid' : 'invalid',
      rpcUrl: cfg.rpcUrl === '' ? 'empty' : rpcValid ? 'valid' : 'invalid',
      healthFactors: healthValid ? 'valid' : 'invalid',
      privateKey: cfg.privateKey === '' ? 'empty' : 'valid'
    });

    return contractValid && rpcValid && healthValid && keyValid;
  }, []);

  // Save configuration
  const saveConfiguration = useCallback(async () => {
    localStorage.setItem('aave_bot_config', JSON.stringify(config));
    
    try {
      await apiRequest('POST', '/api/bot/config', {
        ...config,
        userId: 'default'
      });
      addActivityLog('Configuration saved successfully.', 'success');
    } catch (error) {
      addActivityLog('Failed to save configuration to server.', 'error');
    }
  }, [config]);

  // Add activity log entry
  const addActivityLog = useCallback(async (message: string, type: 'info' | 'success' | 'warning' | 'error') => {
    try {
      await apiRequest('POST', '/api/activity', { message, type });
    } catch (error) {
      console.error('Failed to add activity log:', error);
    }
  }, []);

  // Handle input changes
  const handleConfigChange = useCallback((field: keyof BotConfig, value: string | number) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
    validateConfiguration(newConfig);
    saveConfiguration();
  }, [config, validateConfiguration, saveConfiguration]);

  // Bot control functions
  const startMonitoring = useCallback(() => {
    if (!validateConfiguration(config)) {
      toast({
        title: "Configuration Error",
        description: "Please check all configuration fields",
        variant: "destructive"
      });
      return;
    }

    sendMessage({ type: 'start_monitoring' });
    addActivityLog(`Started monitoring mode. Scanning every ${config.scanInterval} seconds.`, 'success');
  }, [config, validateConfiguration, sendMessage, addActivityLog, toast]);

  const startExecuting = useCallback(() => {
    if (!validateConfiguration(config)) {
      toast({
        title: "Configuration Error", 
        description: "Please check all configuration fields",
        variant: "destructive"
      });
      return;
    }

    sendMessage({ type: 'start_executing' });
    addActivityLog(`Started monitoring & execution mode. Scanning every ${config.scanInterval} seconds.`, 'warning');
  }, [config, validateConfiguration, sendMessage, addActivityLog, toast]);

  const stopBot = useCallback(() => {
    sendMessage({ type: 'stop_bot' });
    addActivityLog('Bot stopped by user.', 'info');
  }, [sendMessage, addActivityLog]);

  const clearLog = useCallback(async () => {
    try {
      await apiRequest('DELETE', '/api/activity');
      addActivityLog('Activity log cleared.', 'info');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear activity log",
        variant: "destructive"
      });
    }
  }, [addActivityLog, toast]);

  // Helper functions
  const getInputClassName = (field: keyof ValidationState) => {
    const base = "w-full px-4 py-3 rounded-lg border-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
    if (field === 'healthFactors') {
      return validation[field] === 'valid' 
        ? `${base} border-green-300 bg-green-50 text-green-900` 
        : `${base} border-red-300 bg-red-50 text-red-900`;
    }
    switch (validation[field]) {
      case 'valid': return `${base} border-green-300 bg-green-50 text-green-900`;
      case 'invalid': return `${base} border-red-300 bg-red-50 text-red-900`;
      default: return `${base} border-gray-300 bg-white text-gray-900 hover:border-gray-400`;
    }
  };

  const getHealthFactorColor = (hf: number) => {
    if (hf < 0.85) return 'health-critical';
    if (hf < 0.9) return 'health-danger'; 
    if (hf < 0.95) return 'health-warning';
    return 'health-safe';
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString();
  };

  const getStatusIndicatorClass = () => {
    if (botState.status === 'EXECUTING') return 'status-indicator status-running blink';
    if (botState.status === 'MONITORING') return 'status-indicator status-monitoring';
    return 'status-indicator status-stopped';
  };

  const maskPrivateKey = (key: string) => {
    if (key.length <= 8) return key;
    return key.substring(0, 4) + '*'.repeat(key.length - 8) + key.substring(key.length - 4);
  };

  // Wallet connection functions
  const connectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];
        setWalletAddress(address);
        setWalletConnected(true);
        
        // Check if connected wallet is the contract owner
        if (config.contractAddress) {
          await checkContractOwnership(address);
        }
        
        addActivityLog(`Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`, 'success');
      } else {
        toast({
          title: "MetaMask Not Found",
          description: "Please install MetaMask to connect your wallet",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: "Failed to connect wallet",
        variant: "destructive"
      });
    }
  };

  const checkContractOwnership = async (address: string) => {
    try {
      // This would call your smart contract to check if the address is the owner
      // For now, we'll simulate this check
      const isContractOwner = address.toLowerCase() === contractOwner.toLowerCase();
      setIsOwner(isContractOwner);
      
      if (isContractOwner) {
        addActivityLog('✅ Wallet verified as contract owner', 'success');
      } else {
        addActivityLog('❌ Wallet is not the contract owner', 'error');
      }
    } catch (error) {
      addActivityLog('Failed to verify contract ownership', 'error');
    }
  };

  const disconnectWallet = () => {
    setWalletConnected(false);
    setWalletAddress('');
    setIsOwner(false);
    addActivityLog('Wallet disconnected', 'info');
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      {/* Navigation Header */}
      <nav className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold">LiquidAssassin</h1>
              <Badge variant="outline">Aave v3 Bot</Badge>
            </div>
            <div className="flex items-center space-x-2">
              <Link href="/">
                <Button variant="outline" size="sm">Single Chain</Button>
              </Link>
              <Link href="/multi-chain">
                <Button variant="default" size="sm">Multi-Chain</Button>
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              {walletConnected ? (
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${isOwner ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm font-mono">
                      {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                    </span>
                    {isOwner && <Badge variant="default" className="bg-green-600">OWNER</Badge>}
                  </div>
                  <Button 
                    onClick={disconnectWallet}
                    variant="outline" 
                    size="sm"
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
            <h1 className="text-3xl font-bold text-primary mb-2" data-testid="title">
              AAVE LIQUIDATION BOT v2.0
            </h1>
            <p className="text-muted-foreground">Advanced Position Monitoring & Flash Liquidation System</p>
            <div className="mt-4 flex items-center justify-center gap-4 text-sm">
              <div className="flex items-center">
                <span className={getStatusIndicatorClass()} data-testid="connection-indicator"></span>
                <span data-testid="connection-text">
                  {isConnected ? (botState.status === 'EXECUTING' ? 'Executing' : botState.status === 'MONITORING' ? 'Monitoring' : 'Connected') : 'Disconnected'}
                </span>
              </div>
              <div className="text-muted-foreground">|</div>
              <div>Network: <span className="text-accent">Ethereum Mainnet</span></div>
              <div className="text-muted-foreground">|</div>
              <div>Block: <span className="text-primary" data-testid="block-number">{currentBlockNumber}</span></div>
              <div className="text-muted-foreground">|</div>
              <div>Monitor: <span className="text-blue-600">{monitoringRange.min}-{monitoringRange.max}</span></div>
              <div className="text-muted-foreground">|</div>
              <div>Execute: <span className="text-green-600">{executionRange.min}-{executionRange.max}</span></div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Configuration Panel */}
        <Card className="bg-white shadow-xl border-0 rounded-2xl">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-2xl">
            <CardTitle className="text-2xl font-bold flex items-center">
              <span className="mr-3">⚙️</span>
              Bot Configuration
            </CardTitle>
            <p className="text-blue-100 mt-2">Configure your liquidation strategy and wallet connection</p>
          </CardHeader>
          <CardContent className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {/* Contract Address */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">📄</span>
                  Contract Address
                </Label>
                <Input
                  type="text"
                  className={getInputClassName('contractAddress')}
                  placeholder="0x1234567890abcdef1234567890abcdef12345678"
                  maxLength={42}
                  value={config.contractAddress}
                  onChange={(e) => handleConfigChange('contractAddress', e.target.value)}
                  data-testid="input-contract-address"
                />
                <div className="text-xs flex items-center" data-testid="text-contract-status">
                  {validation.contractAddress === 'empty' ? (
                    <span className="text-gray-500">Enter your deployed contract address</span>
                  ) : validation.contractAddress === 'valid' ? (
                    <span className="text-green-600 flex items-center">
                      <span className="mr-1">✅</span>
                      Valid contract address
                    </span>
                  ) : (
                    <span className="text-red-600 flex items-center">
                      <span className="mr-1">❌</span>
                      Invalid address format
                    </span>
                  )}
                </div>
              </div>

              {/* Contract Owner Address */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">👤</span>
                  Contract Owner Address
                </Label>
                <Input
                  type="text"
                  className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 bg-white text-gray-900 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  placeholder="0x1234567890abcdef1234567890abcdef12345678"
                  maxLength={42}
                  value={contractOwner}
                  onChange={(e) => setContractOwner(e.target.value)}
                />
                <div className="text-xs flex items-center">
                  {contractOwner === '' ? (
                    <span className="text-gray-500">Enter the contract owner address</span>
                  ) : /^0x[a-fA-F0-9]{40}$/.test(contractOwner) ? (
                    <span className="text-green-600 flex items-center">
                      <span className="mr-1">✅</span>
                      Valid owner address
                    </span>
                  ) : (
                    <span className="text-red-600 flex items-center">
                      <span className="mr-1">❌</span>
                      Invalid address format
                    </span>
                  )}
                </div>
              </div>

              {/* RPC URL */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">🌐</span>
                  RPC Endpoint
                </Label>
                <Input
                  type="text"
                  className={getInputClassName('rpcUrl')}
                  placeholder="https://eth.llamarpc.com"
                  value={config.rpcUrl}
                  onChange={(e) => handleConfigChange('rpcUrl', e.target.value)}
                  data-testid="input-rpc-url"
                />
                <div className="text-xs flex items-center" data-testid="text-rpc-status">
                  {validation.rpcUrl === 'empty' ? (
                    <span className="text-gray-500">Enter your Ethereum RPC endpoint</span>
                  ) : validation.rpcUrl === 'valid' ? (
                    <span className="text-green-600 flex items-center">
                      <span className="mr-1">✅</span>
                      Valid RPC endpoint
                    </span>
                  ) : (
                    <span className="text-red-600 flex items-center">
                      <span className="mr-1">❌</span>
                      Invalid URL format
                    </span>
                  )}
                </div>
              </div>

              {/* Monitoring Range */}
              <div className="space-y-4 col-span-full">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">👁️</span>
                  Monitoring Range (Wide)
                </Label>
                <div className="bg-blue-50 p-4 rounded-xl border-2 border-blue-200">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-blue-700 mb-2 block">Monitor From</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-blue-300 bg-white text-gray-900 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        step="0.01"
                        min="0.5"
                        max="1.5"
                        placeholder="0.75"
                        value={monitoringRange.min}
                        onChange={(e) => setMonitoringRange(prev => ({ ...prev, min: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div className="text-blue-600 font-medium">to</div>
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-blue-700 mb-2 block">Monitor To</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-blue-300 bg-white text-gray-900 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        step="0.01"
                        min="0.5"
                        max="1.5"
                        placeholder="1.05"
                        value={monitoringRange.max}
                        onChange={(e) => setMonitoringRange(prev => ({ ...prev, max: parseFloat(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-blue-700">
                    📊 <strong>Wide Monitoring:</strong> Bot watches positions from {monitoringRange.min} to {monitoringRange.max} health factor
                  </div>
                </div>
              </div>

              {/* Execution Range */}
              <div className="space-y-4 col-span-full">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">⚡</span>
                  Execution Range (Tight)
                </Label>
                <div className="bg-green-50 p-4 rounded-xl border-2 border-green-200">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-green-700 mb-2 block">Execute From</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-green-300 bg-white text-gray-900 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                        step="0.01"
                        min="0.5"
                        max="1.0"
                        placeholder="0.85"
                        value={executionRange.min}
                        onChange={(e) => setExecutionRange(prev => ({ ...prev, min: parseFloat(e.target.value) }))}
                      />
                    </div>
                    <div className="text-green-600 font-medium">to</div>
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-green-700 mb-2 block">Execute To</Label>
                      <Input
                        type="number"
                        className="w-full px-4 py-3 rounded-lg border-2 border-green-300 bg-white text-gray-900 hover:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                        step="0.01"
                        min="0.5"
                        max="1.0"
                        placeholder="0.87"
                        value={executionRange.max}
                        onChange={(e) => setExecutionRange(prev => ({ ...prev, max: parseFloat(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-green-700">
                    ⚡ <strong>Execution Zone:</strong> Bot executes liquidations when positions drop to {executionRange.min}-{executionRange.max} health factor
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExecutionRange({ min: 0.85, max: 0.87 });
                      }}
                      className="text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                    >
                      🎯 Tight (0.85-0.87)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExecutionRange({ min: 0.80, max: 0.90 });
                      }}
                      className="text-xs bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                    >
                      📈 Wide (0.80-0.90)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExecutionRange({ min: 0.82, max: 0.85 });
                      }}
                      className="text-xs bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                    >
                      ⚡ Aggressive (0.82-0.85)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExecutionRange({ min: 0.90, max: 0.95 });
                      }}
                      className="text-xs bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                    >
                      🛡️ Conservative (0.90-0.95)
                    </Button>
                  </div>
                </div>
              </div>

              {/* Max Gas Price */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">⛽</span>
                  Max Gas Price (gwei)
                </Label>
                <Input
                  type="number"
                  className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 bg-white text-gray-900 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  min="1"
                  max="1000"
                  value={config.maxGasPrice}
                  onChange={(e) => handleConfigChange('maxGasPrice', parseInt(e.target.value))}
                  data-testid="input-max-gas-price"
                />
                <div className="text-xs text-gray-600">
                  Current: <span className="font-medium text-blue-600" data-testid="text-current-gas-price">{currentGasPrice}</span> gwei
                </div>
              </div>

              {/* Scan Interval */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">⏱️</span>
                  Scan Interval (seconds)
                </Label>
                <Input
                  type="number"
                  className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 bg-white text-gray-900 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  min="5"
                  max="300"
                  value={config.scanInterval}
                  onChange={(e) => handleConfigChange('scanInterval', parseInt(e.target.value))}
                  data-testid="input-scan-interval"
                />
                <div className="text-xs text-gray-600">Recommended: 10-30 seconds</div>
              </div>

              {/* Private Key */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center">
                  <span className="mr-2">🔑</span>
                  Private Key (for automation)
                </Label>
                <Input
                  type="password"
                  className={getInputClassName('privateKey')}
                  placeholder="Enter your wallet private key for automated transactions..."
                  value={config.privateKey}
                  onChange={(e) => handleConfigChange('privateKey', e.target.value)}
                  data-testid="input-private-key"
                />
                <div className="text-xs flex items-center" data-testid="text-key-status">
                  {validation.privateKey === 'empty' ? (
                    <span className="text-gray-500">Enter your private key for automated liquidation execution</span>
                  ) : (
                    <span className="text-green-600 flex items-center">
                      <span className="mr-1">✅</span>
                      Key set ({config.privateKey.length} characters)
                    </span>
                  )}
                </div>
                <div className="text-xs text-yellow-600 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                  <div className="flex items-start space-x-2">
                    <span className="text-yellow-600 mt-0.5">⚠️</span>
                    <div>
                      <div className="font-semibold text-yellow-800">Security Warning:</div>
                      <div className="text-yellow-700 mt-1">
                        • This private key is stored locally in your browser<br/>
                        • Only use this for automated liquidation execution<br/>
                        • Never share your private key with anyone<br/>
                        • Consider using a dedicated wallet for bot operations
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="mt-8">
              {!walletConnected ? (
                <div className="w-full p-6 bg-yellow-50 border-2 border-yellow-200 rounded-xl">
                  <div className="flex items-center space-x-3 text-yellow-700">
                    <span className="text-2xl">🔒</span>
                    <div>
                      <div className="font-semibold">Connect your wallet to access bot controls</div>
                      <div className="text-sm text-yellow-600">Click "Connect Wallet" in the top right corner</div>
                    </div>
                  </div>
                </div>
              ) : !isOwner ? (
                <div className="w-full p-6 bg-red-50 border-2 border-red-200 rounded-xl">
                  <div className="flex items-center space-x-3 text-red-700">
                    <span className="text-2xl">❌</span>
                    <div>
                      <div className="font-semibold">Only the contract owner can control this bot</div>
                      <div className="text-sm text-red-600">Make sure you're connected with the correct wallet</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Button
                    onClick={startMonitoring}
                    disabled={botState.isMonitoring}
                    className="h-16 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-monitor"
                  >
                    <div className="text-center">
                      <div className="text-2xl mb-1">📊</div>
                      <div className="text-sm">MONITOR ONLY</div>
                    </div>
                  </Button>
                  <Button
                    onClick={startExecuting}
                    disabled={botState.isMonitoring || !config.privateKey}
                    className={`h-16 font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                      config.privateKey 
                        ? 'bg-green-600 hover:bg-green-700 text-white' 
                        : 'bg-gray-400 text-gray-200'
                    }`}
                    data-testid="button-execute"
                  >
                    <div className="text-center">
                      <div className="text-2xl mb-1">⚡</div>
                      <div className="text-sm">
                        {config.privateKey ? 'AUTO EXECUTE' : 'NEEDS PRIVATE KEY'}
                      </div>
                    </div>
                  </Button>
                  <Button
                    onClick={stopBot}
                    disabled={!botState.isMonitoring}
                    className="h-16 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid="button-stop"
                  >
                    <div className="text-center">
                      <div className="text-2xl mb-1">🛑</div>
                      <div className="text-sm">EMERGENCY STOP</div>
                    </div>
                  </Button>
                  <Button
                    onClick={saveConfiguration}
                    className="h-16 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                    data-testid="button-save"
                  >
                    <div className="text-center">
                      <div className="text-2xl mb-1">💾</div>
                      <div className="text-sm">SAVE CONFIG</div>
                    </div>
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">System Status</div>
              <div className="text-lg font-bold text-primary" data-testid="text-system-status">
                {botState.status}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {botState.status === 'STOPPED' ? 'Ready to start' : 
                 botState.status === 'MONITORING' ? 'Scanning positions' : 'Active execution'}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Positions Monitored</div>
              <div className="text-lg font-bold text-accent" data-testid="text-positions-count">
                {botState.positionsCount}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Active liquidation targets</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Liquidations Executed</div>
              <div className="text-lg font-bold text-primary" data-testid="text-executions-count">
                {botState.executionsCount}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Total successful</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Estimated Profit</div>
              <div className="text-lg font-bold text-primary" data-testid="text-total-profit">
                ${botState.totalProfit.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">From liquidations</div>
            </CardContent>
          </Card>
        </div>

        {/* Positions Table */}
        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="bg-muted px-6 py-3 border-b border-border">
            <CardTitle className="text-lg font-bold text-accent">🎯 MONITORED POSITIONS</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {positions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="text-empty-positions">
                <div className="text-lg mb-2">👀</div>
                <div>No positions being monitored</div>
                <div className="text-sm mt-1">Start monitoring to see liquidation opportunities</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-sm text-accent">
                      <th className="px-6 py-3">User Address</th>
                      <th className="px-6 py-3">Health Factor</th>
                      <th className="px-6 py-3">Collateral</th>
                      <th className="px-6 py-3">Debt</th>
                      <th className="px-6 py-3">Est. Profit</th>
                      <th className="px-6 py-3">Age</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position) => (
                      <tr key={position.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-3 font-mono text-sm" data-testid={`text-address-${position.id}`}>
                          {position.userAddress.slice(0, 6)}...{position.userAddress.slice(-4)}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`font-bold ${getHealthFactorColor(position.healthFactor)}`} data-testid={`text-health-factor-${position.id}`}>
                            {position.healthFactor.toFixed(3)}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm">
                          <div>{position.collateralAmount} {position.collateralAsset}</div>
                        </td>
                        <td className="px-6 py-3 text-sm">
                          <div>{position.debtAmount} {position.debtAsset}</div>
                        </td>
                        <td className="px-6 py-3 text-primary font-bold" data-testid={`text-profit-${position.id}`}>
                          ${position.estimatedProfit.toFixed(2)}
                        </td>
                        <td className="px-6 py-3 text-muted-foreground text-sm">
                          {Math.floor((Date.now() - new Date(position.firstSeen).getTime()) / 60000)}m
                        </td>
                        <td className="px-6 py-3">
                          <span className={`text-sm ${position.status === 'in_range' ? 'text-accent' : 'text-muted-foreground'}`} data-testid={`text-status-${position.id}`}>
                            {position.status.toUpperCase()}
                          </span>
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
        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="bg-muted px-6 py-3 border-b border-border flex justify-between items-center">
            <CardTitle className="text-lg font-bold text-accent">📋 ACTIVITY LOG</CardTitle>
            <Button
              onClick={clearLog}
              className="text-xs px-3 py-1 bg-destructive/20 text-destructive rounded hover:bg-destructive/30 transition-colors"
              data-testid="button-clear-log"
            >
              CLEAR
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-64 overflow-y-auto p-4 space-y-1" data-testid="container-activity-log">
              {activityLog.length === 0 ? (
                <div className="text-sm text-muted-foreground">No activity logs yet...</div>
              ) : (
                activityLog.map((entry) => (
                  <div
                    key={entry.id}
                    className={`text-sm ${
                      entry.type === 'success' ? 'text-primary' :
                      entry.type === 'warning' ? 'text-secondary' :
                      entry.type === 'error' ? 'text-destructive' :
                      'text-muted-foreground'
                    }`}
                    data-testid={`log-entry-${entry.id}`}
                  >
                    [{formatTime(entry.timestamp)}] {entry.message}
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
