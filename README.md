# ⚡ ReactPay

> Trustless freelance escrow powered by Somnia Reactivity. Payments that execute themselves.

## What is ReactPay?

ReactPay is a decentralized escrow protocol for freelance payments built on Somnia. A client locks funds on-chain, a freelancer delivers work, and payment releases **automatically**no , middlemen, no fees, no delays.

This is powered by **Somnia Reactivity**. The contract inherits `SomniaEventHandler` and uses `_onEvent` to react to on-chain events in real time:

- Transfer detected → escrow auto-funded ⚡
- Work delivered → payment auto-released ⚡

## Deployed Contracts (Somnia Testnet)

| Contract | Address |
|----------|---------|
| MockSTT (RSTT) | `0xeC1CF1647FB1406D33eC577A279523C425D71D9c` |
| ReactPay | `0xDE76d8b12Fe677BFaA9a5fA40Ec57B530fBaB202` |

## Tech Stack

- Solidity + SomniaEventHandler
- Next.js, wagmi, viem
- Somnia Testnet (Chain ID: 50312)

## Demo Flow

1. Connect wallet → Get RSTT from faucet
2. Create escrow with freelancer address + amount
3. Reactivity detects Transfer → **auto-funded** ⚡
4. Freelancer submits delivery reference
5. Reactivity detects WorkDelivered → **auto-released** ⚡
