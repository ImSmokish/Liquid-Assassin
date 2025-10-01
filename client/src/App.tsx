import { useState, useEffect } from 'react';
import './types/ethereum';

function App() {
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');

  const connectWallet = async () => {
    try {
      if (typeof window === 'undefined' || !window.ethereum) {
        alert('Please install MetaMask to use this application');
        return;
      }

      // Check if MetaMask is installed
      if (!window.ethereum.isMetaMask) {
        alert('Please install MetaMask browser extension');
        return;
      }

      // Request account access
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (accounts.length === 0) {
        alert('No accounts found. Please unlock MetaMask.');
        return;
      }

      const address = accounts[0];
      setWalletAddress(address);
      setWalletConnected(true);
      
      console.log('Wallet connected:', address);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      
      if (error.code === 4001) {
        alert('Connection rejected by user');
      } else if (error.code === -32002) {
        alert('Connection request already pending. Please check MetaMask.');
      } else {
        alert('Failed to connect wallet. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-8">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">LiquidAssassin</h1>
              <p className="text-blue-100 mt-2">Multi-Chain Liquidation Bot</p>
            </div>
            <div>
              {walletConnected ? (
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-sm">
                      {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                    </span>
                  </div>
                  <button
                    onClick={() => setWalletConnected(false)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={connectWallet}
                  className="bg-white text-blue-600 hover:bg-blue-50 px-6 py-3 rounded-lg font-semibold"
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Configuration Card */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">Configuration</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Contract Owner Address
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0x..."
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Monitor Range Min
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="0.75"
                    defaultValue="0.75"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Monitor Range Max
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="1.05"
                    defaultValue="1.05"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Execute Range Min
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="0.85"
                    defaultValue="0.85"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Execute Range Max
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="0.87"
                    defaultValue="0.87"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Control Panel */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">Control Panel</h2>
            
            <div className="space-y-4">
              <button
                disabled={!walletConnected}
                className={`w-full py-4 px-6 rounded-lg font-semibold text-white ${
                  !walletConnected 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {!walletConnected ? 'CONNECT WALLET FIRST' : 'START MULTI-CHAIN MONITORING'}
              </button>

              <button
                disabled={!walletConnected}
                className={`w-full py-4 px-6 rounded-lg font-semibold text-white ${
                  !walletConnected 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                CHECK PROFITS
              </button>

              <button
                disabled={!walletConnected}
                className={`w-full py-4 px-6 rounded-lg font-semibold text-white ${
                  !walletConnected 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                CONSOLIDATE TO ETH
              </button>
            </div>
          </div>
        </div>

        {/* Chain Status */}
        <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-6 text-gray-800">Chain Status</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {['Ethereum', 'Optimism', 'Arbitrum', 'Polygon'].map((chain) => (
              <div key={chain} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-800">{chain}</h3>
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                </div>
                <p className="text-sm text-gray-600">Not Monitoring</p>
                <p className="text-sm text-gray-600">USDC: $0.00</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;