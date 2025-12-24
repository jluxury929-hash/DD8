/**
 * 🔱 APEX v38.9.20 - THE LIQUIDITY-SENSITIVE WHALE TITAN
 * Fix: Prevents "Liquidity Too Low" by scaling Flash Loans to 10% of pool depth.
 */

const { ethers, Wallet, WebSocketProvider, Contract } = require('ethers');

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: "wss://base-mainnet.g.alchemy.com/v2/G-WBAMA8JxJMjkc-BCeoK",
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    
    // Base Uniswap V2 Pair for WETH/USDC
    WETH_USDC_POOL: "0x88A43bb75941904d47401946215162a26bc773dc",
    
    WHALE_MIN_ETH: ethers.parseEther("10"), 
    GAS_LIMIT: 850000n,
    MARGIN_ETH: "0.005"
};

const PAIR_ABI = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];

async function startWhaleStriker() {
    console.log(`\n🔱 APEX TITAN: LIQUIDITY GUARD ENABLED`);
    
    const provider = new WebSocketProvider(CONFIG.WSS_URL);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
    const poolContract = new Contract(CONFIG.WETH_USDC_POOL, PAIR_ABI, provider);

    // --- LIQUIDITY SCALER ---
    async function getSafeLoanAmount() {
        // 1. Check your Wallet Balance for "Ideal" Loan Size
        const balanceWei = await provider.getBalance(signer.address);
        const balanceEth = parseFloat(ethers.formatEther(balanceWei));
        const usdValue = balanceEth * 3300; 

        let requestedAmount;
        if (usdValue >= 200) requestedAmount = ethers.parseEther("100");
        else if (usdValue >= 100) requestedAmount = ethers.parseEther("75");
        else requestedAmount = ethers.parseEther("25");

        // 2. Cross-reference with Pool Reserves (The Guard)
        try {
            const [res0, res1] = await poolContract.getReserves();
            // On Base WETH/USDC, reserve0 is usually WETH. 
            const poolWethReserves = res0; 
            
            // MATH: If requested loan > 10% of pool, scale it down.
            const maxSafeAmount = poolWethReserves / 10n; 

            if (requestedAmount > maxSafeAmount) {
                console.log(`⚠️ SCALING: Loan too big for pool. Adjusting ${ethers.formatEther(requestedAmount)} -> ${ethers.formatEther(maxSafeAmount)} ETH`);
                return maxSafeAmount;
            }
            return requestedAmount;
        } catch (e) {
            return ethers.parseEther("5"); // Ultra-safe fallback
        }
    }

    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");

    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ["uint256", "uint256", "uint256", "uint256"], log.data
            );
            const maxSwap = decoded.reduce((max, val) => val > max ? val : max, 0n);

            if (maxSwap < CONFIG.WHALE_MIN_ETH) return;

            // GET LIQUIDITY-ADJUSTED LOAN
            const safeLoanAmount = await getSafeLoanAmount();
            
            const iface = new ethers.Interface(["function requestTitanLoan(address,uint256,address[])"]);
            const strikeData = iface.encodeFunctionData("requestTitanLoan", [
                CONFIG.WETH, safeLoanAmount, [CONFIG.WETH, CONFIG.USDC]
            ]);

            // SIMULATE
            const simulation = await provider.call({
                to: CONFIG.TARGET_CONTRACT,
                data: strikeData,
                from: signer.address
            });

            const potentialProfit = BigInt(simulation);
            const feeData = await provider.getFeeData();
            const gasCost = CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || feeData.gasPrice);
            const aaveFee = (safeLoanAmount * 5n) / 10000n;

            if (potentialProfit > (gasCost + ethers.parseEther(CONFIG.MARGIN_ETH) + aaveFee)) {
                console.log(`💎 LIQUIDITY-SAFE PROFIT: ${ethers.formatEther(potentialProfit - gasCost)} ETH`);
                
                const tx = await signer.sendTransaction({
                    to: CONFIG.TARGET_CONTRACT,
                    data: strikeData,
                    gasLimit: CONFIG.GAS_LIMIT,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                    maxFeePerGas: feeData.maxFeePerGas,
                    type: 2
                });
                console.log(`🚀 STRIKE FIRED: ${tx.hash}`);
            }
        } catch (e) {}
    });

    provider.websocket.on("close", () => setTimeout(startWhaleStriker, 5000));
}

startWhaleStriker().catch(console.error);
