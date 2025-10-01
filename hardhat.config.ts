import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true, // Enable viaIR to handle stack too deep errors
    },
  },
  networks: {
    // Ethereum Mainnet
    ethereum: {
      url: "https://eth-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz",
      chainId: 1,
      accounts: [], // Add your private key here when ready to deploy
    },
    // Optimism Mainnet
    optimism: {
      url: "https://opt-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz",
      chainId: 10,
      accounts: [], // Add your private key here when ready to deploy
    },
    // Arbitrum Mainnet
    arbitrum: {
      url: "https://arb-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz",
      chainId: 42161,
      accounts: [], // Add your private key here when ready to deploy
    },
    // Polygon Mainnet
    polygon: {
      url: "https://poly-mainnet.g.alchemy.com/v2/7lLqtBjOl0BGBA_G1OKrz",
      chainId: 137,
      accounts: [], // Add your private key here when ready to deploy
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      ethereum: "YOUR_ETHERSCAN_API_KEY",
      optimisticEthereum: "YOUR_OPTIMISTIC_ETHERSCAN_API_KEY",
      arbitrumOne: "YOUR_ARBISCAN_API_KEY",
      polygon: "YOUR_POLYGONSCAN_API_KEY",
    },
  },
};

export default config;

