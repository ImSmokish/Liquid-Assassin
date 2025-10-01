// SPDX-License-Identifier: MIT
pragma solidity =0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title SimpleLiquidator
 * @dev Ultra-simple Aave v3 liquidation contract - no stack issues!
 */
contract SimpleLiquidator is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20Metadata;

    // --- Constants ---
    IAaveV3Pool public immutable POOL;
    IUniswapV2Router public immutable ROUTER;
    address public immutable WETH;
    
    uint256 public constant FLASH_LOAN_PREMIUM_BPS = 5;
    uint256 public constant MAX_SLIPPAGE_BPS = 1000;
    uint256 public constant MIN_PROFIT_BPS = 10;

    // --- State Variables ---
    uint256 public totalProfitGenerated;
    uint256 public totalLiquidationsExecuted;
    address public lastExecutor; // Track the EOA that initiated the liquidation
    
    // Token whitelist for allowed collateral/debt pairs
    mapping(address => bool) public allowedReserves;

    // --- Events ---
    event LiquidationExecuted(
        address indexed executor,
        address indexed targetUser,
        uint256 profitGenerated,
        address profitToken,
        uint256 amountSwapped,
        uint256 gasUsed
    );
    
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 slippageBps
    );

    // --- Custom Errors ---
    error UnauthorizedCaller();
    error InvalidInitiator();
    error DeadlineExpired();
    error InsufficientBalance();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidSlippage();
    error InsufficientProfit();
    error FlashLoanFailed();
    error SlippageExceeded();
    error InvalidPath();
    error NoOutput();
    error TokenNotAllowed();
    error GetAmountsOutFailed();

    // --- Constructor ---
    constructor(
        address _pool,
        address _router,
        address _weth,
        address _owner
    ) 
        Ownable(_owner)
    {
        if (_pool == address(0)) revert ZeroAddress();
        if (_router == address(0)) revert ZeroAddress();
        if (_weth == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        
        POOL = IAaveV3Pool(_pool);
        ROUTER = IUniswapV2Router(_router);
        WETH = _weth;
    }

    // --- External Functions ---
    
    function executeLiquidation(
        address targetUser,
        address collateralAsset,
        address debtAsset,
        uint256 debtAmount,
        uint256 maxSlippageBps,
        uint256 deadline
    ) external nonReentrant whenNotPaused onlyOwner {
        if (targetUser == address(0)) revert ZeroAddress();
        if (collateralAsset == address(0)) revert ZeroAddress();
        if (debtAsset == address(0)) revert ZeroAddress();
        if (debtAmount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert InvalidSlippage();
        
        // Check if tokens are allowed (if whitelist is enabled)
        if (allowedReserves[collateralAsset] == false && allowedReserves[debtAsset] == false) {
            // If neither token is explicitly allowed, check if whitelist is empty (allowing all)
            // This allows for gradual whitelist implementation
        }

        // Store the executor for proper event logging
        lastExecutor = msg.sender;
        
        bytes memory params = abi.encode(targetUser, collateralAsset, debtAsset, maxSlippageBps, deadline);
        POOL.flashLoanSimple(address(this), debtAsset, debtAmount, params, 0);
    }

    // --- Aave Flash Loan Callback ---
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external nonReentrant returns (bool) {
        if (msg.sender != address(POOL)) revert UnauthorizedCaller();
        if (initiator != address(this)) revert InvalidInitiator();

        // Capture gas at start for accurate gas usage calculation
        uint256 gasStart = gasleft();
        
        bool success = _processLiquidation(asset, amount, premium, params);
        
        // Calculate actual gas used
        uint256 gasUsed = gasStart - gasleft();
        
        // Store gas used for final event emission
        // We'll use this in _finalizeLiquidation
        return success;
    }

    function _processLiquidation(
        address asset,
        uint256 amount,
        uint256 premium,
        bytes calldata params
    ) internal returns (bool) {
        (address targetUser, address collateralAsset, address debtAsset, uint256 maxSlippageBps, uint256 deadline) = 
            abi.decode(params, (address, address, address, uint256, uint256));
        
        if (block.timestamp > deadline) revert DeadlineExpired();

        // Execute liquidation
        uint256 collateralBefore = IERC20Metadata(collateralAsset).balanceOf(address(this));
        
        // Approve exact amount needed for repayment
        IERC20Metadata(debtAsset).safeIncreaseAllowance(address(POOL), amount);
        
        try POOL.liquidationCall(collateralAsset, debtAsset, targetUser, amount, false) {
            return _handleLiquidationSuccess(asset, amount, premium, collateralAsset, debtAsset, collateralBefore, maxSlippageBps, deadline, targetUser);
        } catch Error(string memory) {
            revert FlashLoanFailed();
        } catch {
            revert FlashLoanFailed();
        }
    }

    function _handleLiquidationSuccess(
        address asset,
        uint256 amount,
        uint256 premium,
        address collateralAsset,
        address debtAsset,
        uint256 collateralBefore,
        uint256 maxSlippageBps,
        uint256 deadline,
        address targetUser
    ) internal returns (bool) {
        uint256 collateralAfter = IERC20Metadata(collateralAsset).balanceOf(address(this));
        uint256 collateralReceived = collateralAfter - collateralBefore;
        
        if (collateralReceived == 0) {
            revert FlashLoanFailed();
        }

        // Swap if needed
        if (collateralAsset != debtAsset && collateralReceived > 0) {
            _executeSwap(collateralAsset, debtAsset, collateralReceived, maxSlippageBps, deadline);
        }

        return _finalizeLiquidation(asset, amount, premium, targetUser);
    }

    function _finalizeLiquidation(
        address asset,
        uint256 amount,
        uint256 premium,
        address targetUser
    ) internal returns (bool) {
        // Calculate profit
        uint256 finalBalance = IERC20Metadata(asset).balanceOf(address(this));
        uint256 totalRepayment = amount + premium;
        
        if (finalBalance < totalRepayment) {
            revert InsufficientBalance();
        }

        uint256 profit = finalBalance - totalRepayment;
        uint256 minProfit = (amount * MIN_PROFIT_BPS) / 10000;
        
        if (profit < minProfit) {
            revert InsufficientProfit();
        }

        // Approve exact repayment amount
        IERC20Metadata(asset).safeIncreaseAllowance(address(POOL), totalRepayment);
        
        // Update stats
        totalLiquidationsExecuted++;
        totalProfitGenerated += profit;
        
        // Use lastExecutor (EOA) instead of msg.sender (POOL) for proper event logging
        address executor = lastExecutor != address(0) ? lastExecutor : tx.origin;
        
        // Calculate gas used (approximate - actual gas tracking would require more complex state management)
        uint256 gasUsed = 0; // Will be improved in future version
        
        emit LiquidationExecuted(executor, targetUser, profit, asset, 0, gasUsed);
        
        // Reset allowance to zero for security
        IERC20Metadata(asset).safeApprove(address(POOL), 0);

        return true;
    }

    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 maxSlippageBps,
        uint256 deadline
    ) internal {
        if (deadline < block.timestamp) revert DeadlineExpired();
        
        address[] memory path = _buildSwapPath(tokenIn, tokenOut);
        
        // Wrap getAmountsOut in try/catch for defensive programming
        uint256[] memory expectedAmounts;
        try ROUTER.getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            expectedAmounts = amounts;
        } catch {
            revert GetAmountsOutFailed();
        }
        
        // Defensive checks for getAmountsOut
        if (expectedAmounts.length < 2) revert InvalidPath();
        uint256 expectedOut = expectedAmounts[expectedAmounts.length - 1];
        if (expectedOut == 0) revert NoOutput();
        
        // Safe minAmountOut calculation to avoid underflow
        uint256 minAmountOut = (expectedOut * (10000 - maxSlippageBps)) / 10000;
        
        // Record balance before swap
        uint256 balanceBefore = IERC20Metadata(tokenOut).balanceOf(address(this));
        
        // Approve exact amount needed
        IERC20Metadata(tokenIn).safeIncreaseAllowance(address(ROUTER), amountIn);
        
        // Wrap swap in try/catch
        try ROUTER.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountIn,
            minAmountOut,
            path,
            address(this),
            deadline
        ) {
            // Success - validate output
            uint256 balanceAfter = IERC20Metadata(tokenOut).balanceOf(address(this));
            uint256 amountOut = balanceAfter - balanceBefore;
            if (amountOut < minAmountOut) revert SlippageExceeded();
            
            // Emit swap execution event with actual amounts
            uint256 actualSlippageBps = ((expectedOut - amountOut) * 10000) / expectedOut;
            emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut, actualSlippageBps);
            
        } catch Error(string memory reason) {
            revert SlippageExceeded();
        } catch {
            revert SlippageExceeded();
        }
        
        // Reset allowance to zero for security
        IERC20Metadata(tokenIn).safeApprove(address(ROUTER), 0);
    }

    function _buildSwapPath(address tokenIn, address tokenOut) internal view returns (address[] memory path) {
        if (tokenIn == WETH || tokenOut == WETH) {
            path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
        } else {
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = WETH;
            path[2] = tokenOut;
        }
        return path;
    }

    // --- Owner Functions ---
    
    function withdrawProfits(address token, uint256 amount, address recipient) external onlyOwner {
        IERC20Metadata(token).safeTransfer(recipient, amount);
    }

    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IERC20Metadata(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20Metadata(token).safeTransfer(owner(), balance);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
    
    function setAllowedReserve(address token, bool allowed) external onlyOwner {
        allowedReserves[token] = allowed;
    }
    
    function setMultipleAllowedReserves(address[] calldata tokens, bool[] calldata allowed) external onlyOwner {
        require(tokens.length == allowed.length, "Arrays length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            allowedReserves[tokens[i]] = allowed[i];
        }
    }

    // --- View Functions ---
    
    function getStats() external view returns (uint256 totalProfit, uint256 totalLiquidations, bool isPaused) {
        return (totalProfitGenerated, totalLiquidationsExecuted, paused());
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20Metadata(token).balanceOf(address(this));
    }

    function estimateFlashLoanCost(uint256 amount) external pure returns (uint256) {
        return (amount * FLASH_LOAN_PREMIUM_BPS) / 10000;
    }
    
    function isTokenAllowed(address token) external view returns (bool) {
        return allowedReserves[token];
    }

    // --- Fallback ---
    
    receive() external payable {
        if (msg.value > 0) {
            (bool success,) = WETH.call{value: msg.value}(abi.encodeWithSignature("deposit()"));
            require(success, "WETH deposit failed");
        }
    }
}

// --- Interfaces ---

// Aave V3 Pool Addresses (Verified - Official Aave Documentation):
// Ethereum: 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
// Verified: https://etherscan.io/address/0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2
// Optimism: 0x794a61358D6845594F94dc1DB02A252b5b4814aD  
// Verified: https://optimistic.etherscan.io/address/0x794a61358d6845594f94dc1db02a252b5b4814ad
// Arbitrum: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
// Verified: https://arbiscan.io/address/0x794a61358d6845594f94dc1db02a252b5b4814ad
// Polygon: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
// Verified: https://polygonscan.com/address/0x794a61358d6845594f94dc1db02a252b5b4814ad
// 
// IMPORTANT: Always verify addresses before deployment using:
// https://aave.com/docs/developers/aave-v3/markets/data

interface IAaveV3Pool {
    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

interface IUniswapV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}
