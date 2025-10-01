# Compute Units Calculation for Multi-Chain Liquidation Bot

## 🔢 **Compute Unit Requirements Analysis**

### **📊 WebSocket Operations & Compute Units:**

#### **1. Real-Time Event Monitoring:**
- **Liquidation Events:** ~50 events/day per chain
- **Health Factor Updates:** ~500 updates/day per chain  
- **Reserve Data Updates:** ~100 updates/day per chain
- **Price Updates:** ~1,000 updates/day per chain

#### **2. Compute Unit Costs:**
- **WebSocket Connection:** 0 compute units (free)
- **Event Subscription:** 0 compute units (free)
- **Event Processing:** 1-2 compute units per event
- **Health Factor Calculation:** 5-10 compute units per calculation
- **Price Data Fetching:** 2-3 compute units per request

### **📈 Monthly Calculations:**

#### **Per Chain (Ethereum, Optimism, Arbitrum, Polygon):**
```
Daily Operations:
- Liquidation Events: 50 × 2 = 100 compute units
- Health Factor Updates: 500 × 8 = 4,000 compute units
- Reserve Data Updates: 100 × 3 = 300 compute units
- Price Updates: 1,000 × 3 = 3,000 compute units
- General Monitoring: 200 × 2 = 400 compute units

Daily Total per Chain: ~7,800 compute units
Monthly Total per Chain: 7,800 × 30 = 234,000 compute units
```

#### **Multi-Chain Total:**
```
4 Chains × 234,000 = 936,000 compute units/month
```

### **🎯 Optimized Configuration:**

#### **Conservative Estimate (Recommended):**
- **Base Monitoring:** 500,000 compute units/month
- **Peak Activity:** 1,000,000 compute units/month
- **Buffer:** 500,000 compute units/month
- **Total:** **2,000,000 compute units/month**

#### **Aggressive Monitoring:**
- **High-Frequency Updates:** 2,000,000 compute units/month
- **Cross-Chain Coordination:** 1,000,000 compute units/month
- **Price Data:** 500,000 compute units/month
- **Total:** **3,500,000 compute units/month**

## 💰 **Cost Analysis:**

### **Alchemy Pricing:**
- **Free Tier:** 300M compute units/month (FREE)
- **Growth Tier:** $199/month for 100M additional units
- **Enterprise:** Custom pricing for high-volume usage

### **QuickNode Pricing:**
- **Starter:** $9/month for 25M requests
- **Growth:** $99/month for 100M requests
- **Business:** $299/month for 500M requests

## 🎯 **Recommended Plan:**

### **For Your Bot (2M compute units/month):**
- **Alchemy Growth Plan:** $199/month
- **QuickNode Business Plan:** $299/month
- **Total Cost:** $498/month

### **Cost Optimization Strategies:**
1. **Event Filtering:** Reduce unnecessary events by 50%
2. **Batch Processing:** Group operations to reduce API calls
3. **Caching:** Store frequently accessed data locally
4. **Smart Refresh:** Only update when significant changes occur

## 📊 **Detailed Breakdown:**

### **WebSocket Operations:**
```
Real-Time Events:
- Liquidation Events: 50/day × 4 chains × 30 days × 2 units = 12,000 units
- Health Factor Updates: 500/day × 4 chains × 30 days × 8 units = 480,000 units
- Reserve Updates: 100/day × 4 chains × 30 days × 3 units = 36,000 units
- Price Updates: 1,000/day × 4 chains × 30 days × 3 units = 360,000 units

Subtotal: 888,000 units/month
```

### **Additional Operations:**
```
API Calls:
- Position Queries: 1,000/day × 4 chains × 30 days × 5 units = 600,000 units
- Profit Calculations: 500/day × 4 chains × 30 days × 10 units = 600,000 units
- Cross-Chain Coordination: 200/day × 4 chains × 30 days × 15 units = 360,000 units

Subtotal: 1,560,000 units/month
```

### **Total Monthly Usage:**
```
WebSocket Events: 888,000 units
API Operations: 1,560,000 units
Buffer (20%): 489,600 units
TOTAL: 2,937,600 units/month
```

## 🎯 **Final Recommendation:**

### **For Production Use:**
- **Estimated Usage:** 3M compute units/month
- **Recommended Plan:** Alchemy Growth ($199/month)
- **Backup Plan:** QuickNode Business ($299/month)
- **Total Monthly Cost:** $498

### **For Development/Testing:**
- **Estimated Usage:** 500K compute units/month
- **Recommended Plan:** Alchemy Free Tier (FREE)
- **Backup Plan:** QuickNode Starter ($9/month)
- **Total Monthly Cost:** $9

## 🔧 **Optimization Tips:**

1. **Use WebSocket Events:** 0 compute units for real-time data
2. **Batch API Calls:** Reduce individual requests
3. **Cache Results:** Store data locally to avoid repeated calls
4. **Smart Filtering:** Only process relevant events
5. **Peak Hour Management:** Reduce activity during high-cost periods

## 📈 **Scaling Considerations:**

### **As Your Bot Grows:**
- **More Chains:** Add 500K units per additional chain
- **Higher Frequency:** Add 1M units for sub-second monitoring
- **More Users:** Add 500K units per additional user
- **Advanced Features:** Add 1M units for cross-chain coordination

### **Enterprise Scaling:**
- **10+ Chains:** 5M+ compute units/month
- **High-Frequency Trading:** 10M+ compute units/month
- **Multiple Bots:** 2M+ compute units per additional bot
- **Custom Solutions:** Contact providers for enterprise pricing

