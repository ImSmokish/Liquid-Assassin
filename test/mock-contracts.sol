// SPDX-License-Identifier: MIT
pragma solidity =0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// Mock Aave Pool for testing
contract MockAavePool {
    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external {
        // Simulate flash loan by transferring tokens to receiver
        IERC20Metadata(asset).transfer(receiver, amount);
        
        // Call the receiver's executeOperation function
        (bool success,) = receiver.call(
            abi.encodeWithSignature(
                "executeOperation(address,uint256,uint256,address,bytes)",
                asset,
                amount,
                (amount * 5) / 10000, // 0.05% premium
                address(this),
                params
            )
        );
        require(success, "Flash loan callback failed");
    }

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external {
        // Mock liquidation - transfer some collateral to the caller
        uint256 collateralAmount = debtToCover * 110 / 100; // 10% bonus
        IERC20Metadata(collateralAsset).transfer(msg.sender, collateralAmount);
    }
}

// Mock Uniswap Router for testing
contract MockUniswapRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        pure
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        
        // Simulate 1:1 swap for testing
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = amountIn;
        }
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external {
        // Mock swap - transfer tokens to recipient
        IERC20Metadata(path[0]).transferFrom(msg.sender, address(this), amountIn);
        IERC20Metadata(path[path.length - 1]).transfer(to, amountIn);
    }
}

// Mock WETH for testing
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}
    
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
    
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }
}

// Mock ERC20 Token for testing
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1M tokens for testing
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
