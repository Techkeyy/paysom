import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'

export const somniaTestnet = defineChain({
  id: 50312, name: 'Somnia Testnet', network: 'somnia-testnet',
  nativeCurrency: { name: 'Somnia Test Token', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://dream-rpc.somnia.network'], webSocket: ['wss://dream-rpc.somnia.network/ws'] },
    public:  { http: ['https://dream-rpc.somnia.network'], webSocket: ['wss://dream-rpc.somnia.network/ws'] },
  },
  blockExplorers: { default: { name: 'Somnia Explorer', url: 'https://shannon-explorer.somnia.network' } },
})

export const wagmiConfig = createConfig({
  chains: [somniaTestnet],
  connectors: [
    injected({ target: 'metaMask' }),
    injected({ target: 'rabby' }),
    injected(),
    walletConnect({ projectId: 'b8a1daa2dd22335f4e2a5a2d3c9d9e1f' }),
  ],
  transports: { [somniaTestnet.id]: http('https://dream-rpc.somnia.network') },
  reconnectOnMount: false,
})
