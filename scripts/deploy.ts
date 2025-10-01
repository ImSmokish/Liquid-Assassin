import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting deployment of UltimateAaveLiquidator...");

  // Get the contract factory
  const UltimateAaveLiquidator = await ethers.getContractFactory("UltimateAaveLiquidator");

  // Aave V3 Pool addresses for each chain
  const poolAddresses = {
    ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    polygon: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  };

  // Uniswap Router addresses for each chain
  const routerAddresses = {
    ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2
    optimism: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
    arbitrum: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
    polygon: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
  };

  // WETH addresses for each chain
  const wethAddresses = {
    ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    optimism: "0x4200000000000000000000000000000000000006",
    arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
  };

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with the account:", deployer.address);

  // Get the current network
  const network = await ethers.provider.getNetwork();
  const chainName = network.name;
  console.log("🌐 Deploying to network:", chainName);

  // Get the appropriate addresses for this chain
  const poolAddress = poolAddresses[chainName as keyof typeof poolAddresses];
  const routerAddress = routerAddresses[chainName as keyof typeof routerAddresses];
  const wethAddress = wethAddresses[chainName as keyof typeof wethAddresses];

  if (!poolAddress || !routerAddress || !wethAddress) {
    throw new Error(`❌ Unsupported network: ${chainName}`);
  }

  console.log("📋 Configuration:");
  console.log("  - Aave Pool:", poolAddress);
  console.log("  - Uniswap Router:", routerAddress);
  console.log("  - WETH:", wethAddress);

  // Deploy the contract
  console.log("⏳ Deploying contract...");
  const liquidator = await UltimateAaveLiquidator.deploy(
    poolAddress,
    routerAddress,
    wethAddress,
    deployer.address // Owner
  );

  await liquidator.waitForDeployment();

  const contractAddress = await liquidator.getAddress();
  console.log("✅ Contract deployed to:", contractAddress);

  // Verify the deployment
  console.log("🔍 Verifying deployment...");
  const owner = await liquidator.owner();
  const pool = await liquidator.POOL();
  const router = await liquidator.ROUTER();
  const weth = await liquidator.WETH();

  console.log("📊 Deployment Summary:");
  console.log("  - Contract Address:", contractAddress);
  console.log("  - Owner:", owner);
  console.log("  - Aave Pool:", pool);
  console.log("  - Uniswap Router:", router);
  console.log("  - WETH:", weth);

  // Save deployment info
  const deploymentInfo = {
    network: chainName,
    chainId: network.chainId,
    contractAddress,
    owner,
    poolAddress,
    routerAddress,
    wethAddress,
    deployer: deployer.address,
    deploymentTime: new Date().toISOString(),
  };

  console.log("💾 Deployment info saved to deployment-info.json");
  console.log("🎯 Next steps:");
  console.log("  1. Update your bot configuration with the contract address");
  console.log("  2. Test the contract functionality");
  console.log("  3. Deploy to other chains when ready");

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });

