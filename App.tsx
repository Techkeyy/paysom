'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { formatEther, parseUnits, keccak256, toBytes, createPublicClient, http } from 'viem'
import { useWalletClient } from 'wagmi'
import {
  MOCK_STT_ADDRESS, REACT_PAY_ADDRESS,
  MOCK_STT_ABI, REACT_PAY_ABI,
  getStateName, STATE_COLOR, ESCROW_STATES
} from '@/lib/contracts'
import { somniaTestnet } from '@/lib/chain'

// ── Design tokens ──────────────────────────────────────────────────────────────
const T = {
  bg:       '#0A0E14',
  surface:  '#0F1520',
  surface2: '#141C28',
  border:   '#1E2D3D',
  text:     '#E2EAF0',
  muted:    '#4A6680',
  dim:      '#253345',
  accent:   '#4FFFB0',
  accentDim:'#4FFFB015',
  accentMid:'#4FFFB035',
  blue:     '#3B9EFF',
  blueDim:  '#3B9EFF15',
  purple:   '#A78BFA',
  yellow:   '#F59E0B',
  red:      '#EF4444',
  green:    '#10B981',
  mono:     "'JetBrains Mono', monospace",
  sans:     "'Clash Display', 'DM Sans', sans-serif",
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const short = (a: string) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'
const fmt = (v: bigint) => parseFloat(formatEther(v)).toFixed(2)
const stateColor = (s: number) => STATE_COLOR[getStateName(s)] ?? T.muted

function useNow() {
  const [n, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set(x => x+1), 5000); return () => clearInterval(t) }, [])
  return n
}

// ── Public client ──────────────────────────────────────────────────────────────
const publicClient = createPublicClient({ chain: somniaTestnet, transport: http('https://dream-rpc.somnia.network') })

// ── Escrow type ────────────────────────────────────────────────────────────────
interface Escrow {
  id: bigint
  client: string
  freelancer: string
  amount: bigint
  title: string
  deliveryHash: string
  state: number
  createdBlock: bigint
  fundedBlock: bigint
  deliveredBlock: bigint
  disputeWindow: bigint
}

// ── Components ─────────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: number }) {
  const name  = getStateName(state)
  const color = stateColor(state)
  const icons: Record<string, string> = {
    Pending: '⏳', Funded: '💰', Delivered: '📦',
    Released: '✅', Disputed: '⚠️', Refunded: '↩️',
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 99,
      background: color + '18', border: `1px solid ${color}40`,
      fontSize: 10, fontWeight: 700, color,
      fontFamily: T.mono, letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {icons[name]} {name}
    </span>
  )
}

function Input({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; hint?: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: T.mono }}>
        {label}
      </label>
      <input
        type={type} value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          padding: '10px 14px', borderRadius: 10,
          border: `1px solid ${focused ? T.accentMid : T.border}`,
          background: T.surface2, color: T.text,
          fontSize: 13, fontFamily: T.mono, outline: 'none',
          transition: 'border-color 0.2s',
        }}
      />
      {hint && <span style={{ fontSize: 10, color: T.muted }}>{hint}</span>}
    </div>
  )
}

function Btn({ children, onClick, disabled, variant = 'primary', small }: {
  children: React.ReactNode; onClick?: () => void
  disabled?: boolean; variant?: 'primary' | 'ghost' | 'danger' | 'purple'; small?: boolean
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: T.accent, color: T.bg, border: 'none' },
    ghost:   { background: 'transparent', color: T.accent, border: `1px solid ${T.accentMid}` },
    danger:  { background: T.red + '18', color: T.red, border: `1px solid ${T.red}40` },
    purple:  { background: T.purple + '18', color: T.purple, border: `1px solid ${T.purple}40` },
  }
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        ...styles[variant],
        padding: small ? '6px 14px' : '10px 20px',
        borderRadius: 99, fontWeight: 700,
        fontSize: small ? 10 : 12, fontFamily: T.sans,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'opacity 0.2s, filter 0.2s',
      }}
    >{children}</button>
  )
}

// ── Create Escrow Modal ────────────────────────────────────────────────────────
function CreateEscrowModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: walletClient } = useWalletClient()
  const { address } = useAccount()
  const [freelancer, setFreelancer] = useState('')
  const [amount, setAmount]         = useState('')
  const [title, setTitle]           = useState('')
  const [step, setStep]             = useState<'idle' | 'approving' | 'creating' | 'done' | 'error'>('idle')
  const [msg, setMsg]               = useState('')

  async function handleCreate() {
    if (!walletClient || !address) return
    try {
      const amountWei = parseUnits(amount, 18)

      // Step 1: Approve
      setStep('approving')
      setMsg('Approving RSTT spend…')
      const approveTx = await walletClient.writeContract({
        address: MOCK_STT_ADDRESS,
        abi: MOCK_STT_ABI,
        functionName: 'approve',
        args: [REACT_PAY_ADDRESS, amountWei],
      })
      await publicClient.waitForTransactionReceipt({ hash: approveTx })

      // Step 2: Create escrow
      setStep('creating')
      setMsg('Creating escrow on-chain…')
      const createTx = await walletClient.writeContract({
        address: REACT_PAY_ADDRESS,
        abi: REACT_PAY_ABI,
        functionName: 'createEscrow',
        args: [freelancer as `0x${string}`, amountWei, title, 300n],
      })
      await publicClient.waitForTransactionReceipt({ hash: createTx })

      setStep('done')
      setMsg('Escrow created! Reactivity is now watching for payment confirmation ⚡')
      setTimeout(() => { onCreated(); onClose() }, 2000)
    } catch (e: any) {
      setStep('error')
      setMsg(e?.shortMessage ?? e?.message ?? 'Transaction failed')
    }
  }

  const isValid = freelancer.startsWith('0x') && freelancer.length === 42 && parseFloat(amount) > 0 && title.length > 0

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000000BB',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 20, padding: 32, width: 480, maxWidth: '95vw',
        animation: 'modalIn 0.2s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, fontFamily: T.sans }}>Create Escrow</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Lock funds → Reactivity confirms automatically</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input label="Job Title" value={title} onChange={setTitle} placeholder="e.g. Landing page design" />
          <Input label="Freelancer Wallet" value={freelancer} onChange={setFreelancer} placeholder="0x…" hint="The wallet that will receive payment on delivery" />
          <Input label="Amount (RSTT)" value={amount} onChange={setAmount} placeholder="e.g. 100" type="number" hint="Tokens locked until work is delivered" />
        </div>

        {msg && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 10,
            background: step === 'error' ? T.red + '15' : step === 'done' ? T.green + '15' : T.accentDim,
            border: `1px solid ${step === 'error' ? T.red : step === 'done' ? T.green : T.accent}30`,
            fontSize: 12, color: step === 'error' ? T.red : step === 'done' ? T.green : T.accent,
            fontFamily: T.mono,
          }}>
            {step === 'approving' || step === 'creating' ? '⏳ ' : step === 'done' ? '✅ ' : '❌ '}{msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleCreate} disabled={!isValid || (step !== 'idle' && step !== 'error')}>
            {step === 'approving' ? 'Approving…' : step === 'creating' ? 'Creating…' : '⚡ Create Escrow'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Deliver Work Modal ─────────────────────────────────────────────────────────
function DeliverModal({ escrow, onClose, onDone }: { escrow: Escrow; onClose: () => void; onDone: () => void }) {
  const { data: walletClient } = useWalletClient()
  const [input, setInput]       = useState('')
  const [step, setStep]         = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [msg, setMsg]           = useState('')

  async function handleDeliver() {
    if (!walletClient || !input) return
    try {
      setStep('pending')
      setMsg('Submitting delivery hash on-chain…')
      const hash = keccak256(toBytes(input))
      const tx = await walletClient.writeContract({
        address: REACT_PAY_ADDRESS,
        abi: REACT_PAY_ABI,
        functionName: 'deliverWork',
        args: [escrow.id, hash],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      setStep('done')
      setMsg('Work delivered! Reactivity will auto-release payment ⚡')
      setTimeout(() => { onDone(); onClose() }, 2500)
    } catch (e: any) {
      setStep('error')
      setMsg(e?.shortMessage ?? e?.message ?? 'Transaction failed')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000000BB',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 20, padding: 32, width: 440, maxWidth: '95vw',
        animation: 'modalIn 0.2s ease',
      }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 800, fontSize: 18, fontFamily: T.sans }}>Deliver Work</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            Escrow #{escrow.id.toString()} · {fmt(escrow.amount)} RSTT
          </div>
        </div>

        <Input
          label="Delivery Reference"
          value={input} onChange={setInput}
          placeholder="IPFS CID, GitHub link, file hash, etc."
          hint="This is hashed and stored on-chain as proof of delivery"
        />

        {msg && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 10,
            background: step === 'error' ? T.red + '15' : step === 'done' ? T.green + '15' : T.accentDim,
            border: `1px solid ${step === 'error' ? T.red : step === 'done' ? T.green : T.accent}30`,
            fontSize: 12, color: step === 'error' ? T.red : step === 'done' ? T.green : T.accent,
            fontFamily: T.mono,
          }}>
            {msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="purple" onClick={handleDeliver} disabled={!input || step === 'pending'}>
            {step === 'pending' ? 'Submitting…' : '📦 Deliver Work'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Escrow Card ────────────────────────────────────────────────────────────────
function EscrowCard({ escrow, address, onRefresh }: { escrow: Escrow; address?: string; onRefresh: () => void }) {
  const [delivering, setDelivering] = useState(false)
  const { data: walletClient }      = useWalletClient()
  const isClient     = escrow.client.toLowerCase()     === address?.toLowerCase()
  const isFreelancer = escrow.freelancer.toLowerCase() === address?.toLowerCase()
  const state        = getStateName(escrow.state)
  const color        = stateColor(escrow.state)

  async function handleDispute() {
    if (!walletClient) return
    try {
      const tx = await walletClient.writeContract({
        address: REACT_PAY_ADDRESS, abi: REACT_PAY_ABI,
        functionName: 'raiseDispute', args: [escrow.id],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      onRefresh()
    } catch (e: any) { alert(e?.shortMessage ?? 'Failed') }
  }

  return (
    <>
      {delivering && (
        <DeliverModal
          escrow={escrow}
          onClose={() => setDelivering(false)}
          onDone={onRefresh}
        />
      )}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 16, padding: '18px 20px',
        borderLeft: `3px solid ${color}`,
        transition: 'border-color 0.3s',
        animation: 'fadeIn 0.3s ease',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, fontFamily: T.sans, marginBottom: 3 }}>
              {escrow.title || `Escrow #${escrow.id}`}
            </div>
            <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>ID #{escrow.id.toString()}</div>
          </div>
          <StateBadge state={escrow.state} />
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 14 }}>
          {[
            { k: 'Amount',     v: `${fmt(escrow.amount)} RSTT` },
            { k: 'Client',     v: short(escrow.client),     color: isClient ? T.accent : undefined },
            { k: 'Freelancer', v: short(escrow.freelancer), color: isFreelancer ? T.purple : undefined },
            { k: 'Block',      v: `#${escrow.createdBlock.toString()}` },
          ].map(({ k, v, color: c }) => (
            <div key={k}>
              <div style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 12, fontFamily: T.mono, color: c ?? T.text, fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Delivery hash */}
        {escrow.deliveryHash !== '0x' + '0'.repeat(64) && (
          <div style={{
            padding: '8px 10px', background: T.surface2,
            borderRadius: 8, marginBottom: 12,
            fontSize: 10, fontFamily: T.mono, color: T.muted,
            wordBreak: 'break-all',
          }}>
            <span style={{ color: T.purple, fontWeight: 700, marginRight: 6 }}>DELIVERY:</span>
            {escrow.deliveryHash.slice(0, 20)}…
          </div>
        )}

        {/* Reactivity flow indicator */}
        {(state === 'Pending' || state === 'Funded' || state === 'Delivered') && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 12,
            background: T.accentDim, border: `1px solid ${T.accentMid}`,
            fontSize: 10, color: T.accent, fontFamily: T.mono,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ animation: 'pulse 2s infinite' }}>⚡</span>
            {state === 'Pending'   && 'Reactivity watching for token deposit…'}
            {state === 'Funded'    && 'Reactivity confirmed payment — waiting for delivery'}
            {state === 'Delivered' && 'Reactivity auto-releasing payment…'}
          </div>
        )}

        {state === 'Released' && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 12,
            background: T.green + '12', border: `1px solid ${T.green}30`,
            fontSize: 10, color: T.green, fontFamily: T.mono,
          }}>
            ✅ Payment auto-released by Somnia Reactivity — no middleman
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isFreelancer && state === 'Funded' && (
            <Btn small variant="purple" onClick={() => setDelivering(true)}>📦 Deliver Work</Btn>
          )}
          {isClient && state === 'Delivered' && (
            <Btn small variant="danger" onClick={handleDispute}>⚠️ Raise Dispute</Btn>
          )}
          <a
            href={`https://shannon-explorer.somnia.network/address/${REACT_PAY_ADDRESS}`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 10, color: T.muted, textDecoration: 'none', fontFamily: T.mono, alignSelf: 'center', marginLeft: 'auto' }}
          >Explorer ↗</a>
        </div>
      </div>
    </>
  )
}

// ── Faucet Button ──────────────────────────────────────────────────────────────
function FaucetBtn({ address }: { address: string }) {
  const { data: walletClient } = useWalletClient()
  const [loading, setLoading]  = useState(false)

  async function handleFaucet() {
    if (!walletClient) return
    setLoading(true)
    try {
      const tx = await walletClient.writeContract({
        address: MOCK_STT_ADDRESS, abi: MOCK_STT_ABI,
        functionName: 'faucet', args: [parseUnits('1000', 18)],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      alert('✅ Got 1,000 RSTT!')
    } catch (e: any) {
      alert(e?.shortMessage ?? 'Faucet failed')
    }
    setLoading(false)
  }

  return (
    <Btn small variant="ghost" onClick={handleFaucet} disabled={loading}>
      {loading ? 'Getting…' : '🚰 Get RSTT'}
    </Btn>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const { address, isConnected }  = useAccount()
  const { connect }               = useConnect()
  const { disconnect }            = useDisconnect()
  const { data: sttBalance }      = useBalance({ address, query: { enabled: isConnected } })
  const [escrows, setEscrows]     = useState<Escrow[]>([])
  const [rsttBal, setRsttBal]     = useState<bigint>(0n)
  const [creating, setCreating]   = useState(false)
  const [tab, setTab]             = useState<'all' | 'mine'>('all')
  const [loading, setLoading]     = useState(false)
  const tick = useNow()

  const noContracts = !MOCK_STT_ADDRESS || !REACT_PAY_ADDRESS

  const fetchEscrows = useCallback(async () => {
    if (noContracts) return
    setLoading(true)
    try {
      const all = await publicClient.readContract({
        address: REACT_PAY_ADDRESS, abi: REACT_PAY_ABI, functionName: 'getAllEscrows',
      }) as Escrow[]
      setEscrows([...all].reverse())
    } catch (e) { console.warn('fetch escrows:', e) }
    setLoading(false)
  }, [noContracts])

  const fetchRSTT = useCallback(async () => {
    if (!address || noContracts) return
    try {
      const bal = await publicClient.readContract({
        address: MOCK_STT_ADDRESS, abi: MOCK_STT_ABI, functionName: 'balanceOf', args: [address],
      }) as bigint
      setRsttBal(bal)
    } catch {}
  }, [address, noContracts])

  useEffect(() => {
    fetchEscrows()
    fetchRSTT()
  }, [fetchEscrows, fetchRSTT, tick])

  const visibleEscrows = tab === 'mine'
    ? escrows.filter(e =>
        e.client.toLowerCase()     === address?.toLowerCase() ||
        e.freelancer.toLowerCase() === address?.toLowerCase()
      )
    : escrows

  // Stats
  const totalLocked  = escrows.reduce((acc, e) => [1,2].includes(e.state) ? acc + e.amount : acc, 0n)
  const totalReleased = escrows.filter(e => e.state === 3).length
  const activeCount  = escrows.filter(e => e.state < 3).length

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes pulse {
          0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 20px ${T.accent}20; }
          50%       { box-shadow: 0 0 40px ${T.accent}40; }
        }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 99px; }
        input::placeholder { color: ${T.muted}; }
        a:hover { opacity: 0.7; }
        button { transition: opacity 0.15s, filter 0.15s; }
        button:hover:not(:disabled) { filter: brightness(1.1); }
      `}</style>

      {/* Grid bg */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `linear-gradient(${T.border}20 1px, transparent 1px), linear-gradient(90deg, ${T.border}20 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at 50% 0%, black 20%, transparent 70%)',
      }} />

      {/* Accent glow top */}
      <div style={{
        position: 'fixed', top: -1, left: '50%', transform: 'translateX(-50%)',
        width: 800, height: 2, zIndex: 0, pointerEvents: 'none',
        background: `linear-gradient(90deg, transparent, ${T.accent}50, transparent)`,
        animation: 'glow 3s ease-in-out infinite',
      }} />

      {/* ── Header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        borderBottom: `1px solid ${T.border}`,
        background: `${T.surface}E8`,
        backdropFilter: 'blur(20px)',
        padding: '0 28px', height: 62,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: `linear-gradient(135deg, ${T.accent}30, ${T.blue}20)`,
            border: `1px solid ${T.accent}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>⚡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.04em', color: T.text }}>
              React<span style={{ color: T.accent }}>Pay</span>
            </div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: T.mono, marginTop: -1 }}>
              Somnia Reactivity · Trustless Escrow
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isConnected && address && (
            <>
              <FaucetBtn address={address} />
              <div style={{
                padding: '6px 12px', borderRadius: 8,
                background: T.surface2, border: `1px solid ${T.border}`,
                fontSize: 11, fontFamily: T.mono, color: T.muted,
              }}>
                <span style={{ color: T.accent, fontWeight: 700 }}>{parseFloat(formatEther(rsttBal)).toFixed(1)}</span> RSTT
              </div>
              <div style={{
                padding: '6px 12px', borderRadius: 8,
                background: T.surface2, border: `1px solid ${T.border}`,
                fontSize: 11, fontFamily: T.mono, color: T.muted,
              }}>
                {sttBalance ? parseFloat(formatEther(sttBalance.value)).toFixed(3) : '—'} STT
              </div>
              <button onClick={() => disconnect()} style={{
                padding: '7px 14px', borderRadius: 99,
                background: T.surface2, color: T.accent,
                border: `1px solid ${T.accentMid}`,
                fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: T.mono,
              }}>✓ {short(address)}</button>
            </>
          )}
          {!isConnected && (
            <Btn onClick={() => connect({ connector: injected() })}>Connect Wallet</Btn>
          )}
        </div>
      </header>

      {/* ── No contracts warning ── */}
      {noContracts && (
        <div style={{
          margin: '20px auto', maxWidth: 700, padding: '16px 20px',
          background: T.yellow + '12', border: `1px solid ${T.yellow}40`,
          borderRadius: 12, fontSize: 13, color: T.yellow, fontFamily: T.mono,
          textAlign: 'center',
        }}>
          ⚠️ Contract addresses not set. Add <strong>NEXT_PUBLIC_MOCK_STT_ADDRESS</strong> and <strong>NEXT_PUBLIC_REACT_PAY_ADDRESS</strong> to your .env.local file after deploying.
        </div>
      )}

      <main style={{
        maxWidth: 1100, margin: '0 auto',
        padding: '28px 20px', position: 'relative', zIndex: 1,
      }}>

        {/* ── Hero section ── */}
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 14px', borderRadius: 99, marginBottom: 16,
            background: T.accentDim, border: `1px solid ${T.accentMid}`,
            fontSize: 11, color: T.accent, fontFamily: T.mono, fontWeight: 700,
            letterSpacing: '0.06em',
          }}>
            ⚡ POWERED BY SOMNIA REACTIVITY
          </div>
          <h1 style={{
            fontSize: 42, fontWeight: 800, letterSpacing: '-0.04em',
            lineHeight: 1.1, marginBottom: 14, color: T.text,
          }}>
            Freelance escrow that<br />
            <span style={{ color: T.accent }}>executes itself.</span>
          </h1>
          <p style={{ fontSize: 15, color: T.muted, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
            No Upwork. No PayPal. No 20% fees. Lock funds on-chain,
            deliver work, get paid — all automatically via Somnia's
            on-chain Reactivity engine.
          </p>
        </div>

        {/* ── Stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Total Locked',     value: `${fmt(totalLocked)} RSTT`,     color: T.blue },
            { label: 'Active Escrows',   value: activeCount.toString(),          color: T.accent },
            { label: 'Auto-Released',    value: totalReleased.toString(),        color: T.green },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 14, padding: '16px 20px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 1,
                background: `linear-gradient(90deg, transparent, ${color}50, transparent)`,
              }} />
              <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                {label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: T.mono, letterSpacing: '-0.03em' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* ── How it works ── */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 16, padding: '20px 24px', marginBottom: 28,
        }}>
          <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            How it works
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, alignItems: 'center' }}>
            {[
              { icon: '🔒', label: 'Client locks RSTT', color: T.yellow },
              { icon: '→', label: '', color: T.border, small: true },
              { icon: '⚡', label: 'Reactivity confirms', color: T.accent },
              { icon: '→', label: '', color: T.border, small: true },
              { icon: '📦', label: 'Freelancer delivers', color: T.blue },
            ].map(({ icon, label, color, small }, i) => (
              small ? (
                <div key={i} style={{ textAlign: 'center', fontSize: 20, color: T.dim }}>→</div>
              ) : (
                <div key={i} style={{
                  textAlign: 'center', padding: '12px 8px',
                  background: T.surface2, borderRadius: 10,
                  border: `1px solid ${T.border}`,
                }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontSize: 10, color, fontWeight: 700, fontFamily: T.mono, lineHeight: 1.4 }}>{label}</div>
                </div>
              )
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
            {[
              { icon: '→', small: true },
              { icon: '⚡', label: 'Reactivity auto-releases', color: T.green },
              { icon: '→', small: true },
            ].map(({ icon, label, color, small }: any, i) => (
              small ? (
                <div key={i} />
              ) : (
                <div key={i} style={{
                  textAlign: 'center', padding: '12px 8px',
                  background: T.green + '10', borderRadius: 10,
                  border: `1px solid ${T.green}30`,
                }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontSize: 10, color, fontWeight: 700, fontFamily: T.mono, lineHeight: 1.4 }}>{label}</div>
                </div>
              )
            ))}
          </div>
        </div>

        {/* ── Escrows list ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'mine'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '7px 16px', borderRadius: 99, cursor: 'pointer',
                background: tab === t ? T.accentDim : 'transparent',
                border: `1px solid ${tab === t ? T.accentMid : T.border}`,
                color: tab === t ? T.accent : T.muted,
                fontSize: 11, fontWeight: 700, fontFamily: T.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {t === 'all' ? `All Escrows (${escrows.length})` : `My Escrows (${escrows.filter(e => e.client.toLowerCase() === address?.toLowerCase() || e.freelancer.toLowerCase() === address?.toLowerCase()).length})`}
              </button>
            ))}
          </div>
          {isConnected && (
            <Btn onClick={() => setCreating(true)}>⚡ New Escrow</Btn>
          )}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>
            Loading escrows…
          </div>
        )}

        {!loading && visibleEscrows.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 16,
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No escrows yet</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 24 }}>
              {isConnected ? 'Create your first trustless escrow above' : 'Connect your wallet to get started'}
            </div>
            {isConnected && <Btn onClick={() => setCreating(true)}>Create First Escrow</Btn>}
            {!isConnected && <Btn onClick={() => connect({ connector: injected() })}>Connect Wallet</Btn>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {visibleEscrows.map(e => (
            <EscrowCard key={e.id.toString()} escrow={e} address={address} onRefresh={() => { fetchEscrows(); fetchRSTT() }} />
          ))}
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 48, paddingTop: 20, borderTop: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 10, color: T.muted, fontFamily: T.mono,
        }}>
          <span>REACTPAY · SOMNIA REACTIVITY HACKATHON 2026</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <a href="https://shannon-explorer.somnia.network" target="_blank" rel="noreferrer" style={{ color: T.muted, textDecoration: 'none' }}>EXPLORER ↗</a>
            <a href="https://docs.somnia.network" target="_blank" rel="noreferrer" style={{ color: T.muted, textDecoration: 'none' }}>DOCS ↗</a>
          </div>
        </div>
      </main>

      {creating && (
        <CreateEscrowModal onClose={() => setCreating(false)} onCreated={() => { fetchEscrows(); fetchRSTT() }} />
      )}
    </div>
  )
}
