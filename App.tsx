'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect, useBalance, useWalletClient, useChainId } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { formatEther, parseUnits, keccak256, toBytes, createPublicClient, http } from 'viem'
import { MOCK_STT_ADDRESS, REACT_PAY_ADDRESS, MOCK_STT_ABI, REACT_PAY_ABI, getStateName, STATE_COLOR } from '@/lib/contracts'
import { somniaTestnet } from '@/lib/chain'

const T = {
  bg: '#0A0E14', surface: '#0F1520', surface2: '#141C28', border: '#1E2D3D',
  text: '#E2EAF0', muted: '#4A6680', accent: '#4FFFB0', accentDim: '#4FFFB015',
  accentMid: '#4FFFB035', blue: '#3B9EFF', purple: '#A78BFA', yellow: '#F59E0B',
  red: '#EF4444', green: '#10B981',
  mono: "'JetBrains Mono', monospace", sans: "'DM Sans', sans-serif",
}

const short = (a: string) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '—'
const fmt = (v: bigint) => parseFloat(formatEther(v)).toFixed(2)
const stateColor = (s: number) => STATE_COLOR[getStateName(s)] ?? T.muted

const publicClient = createPublicClient({ chain: somniaTestnet, transport: http('https://dream-rpc.somnia.network') })
const WC_PROJECT_ID = 'b8a1daa2dd22335f4e2a5a2d3c9d9e1f'

interface Escrow {
  id: bigint; client: string; freelancer: string; amount: bigint; title: string
  deliveryHash: string; state: number; createdBlock: bigint; fundedBlock: bigint
  deliveredBlock: bigint; disputeWindow: bigint
}

function Btn({ onClick, disabled, style, children }: { onClick?: () => void; disabled?: boolean; style?: React.CSSProperties; children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false)
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)} onMouseLeave={() => setPressed(false)}
      style={{ ...style, transform: pressed && !disabled ? 'scale(0.95)' : 'scale(1)', boxShadow: pressed && !disabled ? `0 0 16px ${T.accent}50` : 'none', transition: 'transform 0.1s, box-shadow 0.1s, filter 0.15s, opacity 0.15s' }}
    >{children}</button>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} className="modal-inner" style={{ background: '#0F1520', border: '1px solid #1E2D3D', borderRadius: 20, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

function WalletModal({ onClose }: { onClose: () => void }) {
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const wallets = [
    { id: 'metamask', label: 'MetaMask', desc: 'Browser extension wallet', icon: '🦊', connector: injected({ target: 'metaMask' }) },
    { id: 'rabby', label: 'Rabby', desc: 'Browser extension wallet', icon: '🐰', connector: injected({ target: 'rabby' }) },
    { id: 'zerion', label: 'Zerion', desc: 'Browser extension wallet', icon: '🔷', connector: injected() },
    { id: 'walletconnect', label: 'WalletConnect', desc: 'Mobile & all WC wallets', icon: '🔗', connector: walletConnect({ projectId: WC_PROJECT_ID }) },
  ]

  async function handleConnect(wallet: typeof wallets[0]) {
    setConnecting(wallet.id)
    setErr('')
    try {
      await disconnect()
      await new Promise(r => setTimeout(r, 300))
      await connect({ connector: wallet.connector })
      await new Promise(r => setTimeout(r, 500))
      onClose()
    } catch (e: any) {
      if (wallet.id !== 'walletconnect') {
        try {
          const eth = (window as any).ethereum
          if (!eth) throw new Error('No wallet found — open this site inside your wallet\'s browser')
          await eth.request({ method: 'eth_requestAccounts' })
          await new Promise(r => setTimeout(r, 500))
          onClose()
          return
        } catch (e2: any) {
          setErr(e2?.message ?? 'Connection failed')
          setConnecting(null)
          return
        }
      }
      setErr(e?.message ?? 'Connection failed')
      setConnecting(null)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Connect Wallet</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Choose your wallet to continue</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {wallets.map(wallet => (
          <button key={wallet.id} onClick={() => handleConnect(wallet)} disabled={!!connecting}
            style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderRadius: 14, background: connecting === wallet.id ? T.accentDim : T.surface2, border: `1px solid ${connecting === wallet.id ? T.accentMid : T.border}`, cursor: connecting ? 'not-allowed' : 'pointer', color: T.text, textAlign: 'left', opacity: connecting && connecting !== wallet.id ? 0.5 : 1, transition: 'all 0.15s' }}
          >
            <div style={{ fontSize: 26, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0 }}>
              {connecting === wallet.id ? '⏳' : wallet.icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{wallet.label}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2, fontFamily: T.mono }}>{wallet.desc}</div>
            </div>
            <div style={{ marginLeft: 'auto', color: T.muted, fontSize: 18 }}>›</div>
          </button>
        ))}
      </div>
      {err && <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: T.red + '15', border: `1px solid ${T.red}40`, fontSize: 12, color: T.red, fontF
