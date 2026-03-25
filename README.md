# ⚡ PaySom 
Trustless Freelance Escrow on Somnia

> Freelancers lose 20% to platforms like Upwork. PaySom fixes this with trustless escrow on Somnia, smart contracts that auto-release payment the moment work is delivered. No middlemen. No fees. No disputes.

## 🔗 Links
[- **Live Demo:** https://paysom.vercel.app/
- **Video Demo:** 

## 📜 Contract Addresses (Somnia Testnet)
| Contract | Address |
|----------|---------|
| MockSTT (RSTT) | `0xeC1CF1647FB1406D33eC577A279523C425D71D9c` |
| PaySom | `0xDE76d8b12Fe677BFaA9a5fA40Ec57B530fBaB202` |

## 🚀 How It Works
1. **Client** creates an escrow — locks RSTT tokens for a specific freelancer
2. **Somnia Reactivity** watches for the token transfer event on-chain
3. **Freelancer** delivers work — submits a delivery hash (GitHub link, IPFS CID, etc.)
4. **Somnia Reactivity** detects the WorkDelivered event and automatically releases payment
5. **No human intervention required** — the contract executes itself

## ⚡ Somnia Reactivity Integration
PaySom inherits `SomniaEventHandler` and uses `_onEvent` to:
- Listen for ERC-20 `Transfer` events → marks escrow as Funded
- Listen for `WorkDelivered` events → auto-releases payment to freelancer

Both subscriptions are registered on-chain via the `subscribe.ts` script.

## 🛠 Tech Stack
- **Blockchain:** Somnia Testnet (Chain ID: 50312)
- **Smart Contracts:** Solidity + Hardhat
- **Frontend:** Next.js 14, wagmi v2, viem, TypeScript
- **Wallets:** MetaMask, Rabby, Zerion, WalletConnect

## 📁 Project Structure
```
paysom/
├── contracts/
│   ├── SomniaEventHandler.sol
│   ├── MockSTT.sol
│   └── PaySom.sol
├── scripts/
│   └── subscribe.ts
└── frontend/
    └── src/
        ├── app/
        ├── components/
        │   └── App.tsx
        └── lib/
            ├── chain.ts
            └── contracts.ts
```

## 🧪 Try It Yourself
1. Visit https://paysom.vercel.app/
2. Connect your wallet (MetaMask, Rabby, or Zerion)
3. Switch to Somnia Testnet (auto-prompted)
4. Get test STT from https://testnet.somnia.network
5. Click **Get RSTT** to get test tokens
6. Create an escrow with a freelancer wallet
7. Switch to freelancer wallet and click **Deliver Work**
8. Watch Reactivity auto-release the payment ⚡

## 🏆 Somnia Reactivity Hackathon 2026
Built for the Somnia Reactivity Hackathon — demonstrating how reactive smart contracts can automate real-world financial workflows.
