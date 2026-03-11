/**
 * subscribe.ts
 * Run ONCE after deploying both contracts to register Reactivity subscriptions.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env   ← fill in your values
 *   npx ts-node subscribe.ts
 */

import { ReactivitySDK } from '@somnia-chain/reactivity'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, http, keccak256, toBytes, parseGwei } from 'viem'
import * as dotenv from 'dotenv'
dotenv.config()

const somniaTestnet = {
  id: 50312,
  name: 'Somnia Testnet',
  network: 'somnia-testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://dream-rpc.somnia.network'] },
    public:  { http: ['https://dream-rpc.somnia.network'] },
  },
} as const

const PRIVATE_KEY       = process.env.PRIVATE_KEY       as `0x${string}`
const MOCK_STT_ADDRESS  = process.env.MOCK_STT_ADDRESS  as `0x${string}`
const REACT_PAY_ADDRESS = process.env.REACT_PAY_ADDRESS as `0x${string}`

const TRANSFER_SIG       = keccak256(toBytes('Transfer(address,address,uint256)'))
const WORK_DELIVERED_SIG = keccak256(toBytes('WorkDelivered(uint256,address,bytes32)'))

async function main() {
  if (!PRIVATE_KEY || !MOCK_STT_ADDRESS || !REACT_PAY_ADDRESS) {
    throw new Error('Missing .env values — check PRIVATE_KEY, MOCK_STT_ADDRESS, REACT_PAY_ADDRESS')
  }

  const account = privateKeyToAccount(PRIVATE_KEY)
  console.log('Wallet:', account.address)

  const publicClient = createPublicClient({
    chain: somniaTestnet,
    transport: http(),
  })

  const walletClient = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http(),
  })

  const sdk = new ReactivitySDK({ publicClient, walletClient })

  // Sub 1: RSTT Transfer events → confirm escrow funding
  console.log('\n[1/2] Registering Transfer subscription...')
  const tx1 = await sdk.createSoliditySubscription({
    handlerContractAddress: REACT_PAY_ADDRESS,
    emitter:                MOCK_STT_ADDRESS,
    eventTopics:            [TRANSFER_SIG],
    gasLimit:               500_000n,
    maxFeePerGas:           parseGwei('10'),
    priorityFeePerGas:      parseGwei('2'),
    isGuaranteed:           true,
    isCoalesced:            false,
  })
  await publicClient.waitForTransactionReceipt({ hash: tx1 })
  console.log('✅ Sub 1 done. Tx:', tx1)

  // Sub 2: WorkDelivered events → auto-release payment
  console.log('\n[2/2] Registering WorkDelivered subscription...')
  const tx2 = await sdk.createSoliditySubscription({
    handlerContractAddress: REACT_PAY_ADDRESS,
    emitter:                REACT_PAY_ADDRESS,
    eventTopics:            [WORK_DELIVERED_SIG],
    gasLimit:               500_000n,
    maxFeePerGas:           parseGwei('10'),
    priorityFeePerGas:      parseGwei('2'),
    isGuaranteed:           true,
    isCoalesced:            false,
  })
  await publicClient.waitForTransactionReceipt({ hash: tx2 })
  console.log('✅ Sub 2 done. Tx:', tx2)

  console.log('\n🚀 ReactPay Reactivity subscriptions are LIVE on Somnia Testnet!')
}

main().catch(console.error)
