'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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

// ─── Detect which injected wallets are actually present ───────────────────────
function detectInjectedWallets(): { id: string; label: string; desc: string; icon: string }[] {
  const eth = (window as any).ethereum
  if (!eth) return []

  const found: { id: string; label: string; desc: string; icon: string }[] = []
  const providers: any[] = eth.providers ?? [eth]

  for (const p of providers) {
    if (p.isRabby)      { found.push({ id: 'rabby',   label: 'Rabby',         desc: 'Detected browser extension', icon: '🐰' }); continue }
    if (p.isBraveWallet){ found.push({ id: 'brave',   label: 'Brave Wallet',  desc: 'Detected browser extension', icon: '🦁' }); continue }
    if (p.isCoinbaseWallet){ found.push({ id: 'coinbase', label: 'Coinbase Wallet', desc: 'Detected browser extension', icon: '🔵' }); continue }
    if (p.isTrust)      { found.push({ id: 'trust',   label: 'Trust Wallet',  desc: 'Detected browser extension', icon: '🛡️' }); continue }
    if (p.isMetaMask)   { found.push({ id: 'metamask',label: 'MetaMask',      desc: 'Detected browser extension', icon: '🦊' }); continue }
    // generic fallback for any other injected provider
    found.push({ id: 'injected', label: 'Browser Wallet', desc: 'Detected browser extension', icon: '🌐' })
  }

  // de-dupe by id (multiple providers array entries can match the same wallet)
  return found.filter((w, i, arr) => arr.findIndex(x => x.id === w.id) === i)
}

// ─── WALLET MODAL ─────────────────────────────────────────────────────────────
function WalletModal({ onClose }: { onClose: () => void }) {
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const { isConnected } = useAccount()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const closedRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detected injected wallets (computed once on mount)
  const [injectedWallets] = useState(() => {
    if (typeof window === 'undefined') return []
    return detectInjectedWallets()
  })

  // Close as soon as wagmi confirms connection
  useEffect(() => {
    if (isConnected && connecting && !closedRef.current) {
      closedRef.current = true
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setTimeout(onClose, 250)
    }
  }, [isConnected, connecting, onClose])

  // Cleanup timeout on unmount
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  async function handleInjected(walletId: string) {
    if (connecting) return
    setConnecting(walletId)
    setErr('')

    // Always clear previous session so wagmi never silently re-uses it
    await disconnect()
    await new Promise(r => setTimeout(r, 150))

    // Set a 15 s timeout — if the wallet extension never responds, bail out
    // with a helpful message instead of spinning forever
    timeoutRef.current = setTimeout(() => {
      if (!closedRef.current) {
        setConnecting(null)
        setErr('Wallet didn\'t respond within 15 s. Make sure the extension is unlocked, then try again.')
      }
    }, 15_000)

    try {
      // Use the generic injected() connector — it calls eth_requestAccounts
      // on window.ethereum directly, which always triggers the extension popup
      const connector = injected()
      await connect({ connector })
      // success handled by the isConnected effect above
    } catch (e: any) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      // User rejected → don't show an error, just reset
      const msg: string = e?.message ?? e?.shortMessage ?? ''
      if (msg.toLowerCase().includes('rejected') || msg.toLowerCase().includes('denied') || (e?.code === 4001)) {
        setConnecting(null)
        return
      }
      // Fallback: raw eth_requestAccounts (handles edge-cases where wagmi connector fails)
      try {
        const eth = (window as any).ethereum
        if (!eth) throw new Error('No wallet extension found. Install one and refresh the page.')
        await eth.request({ method: 'eth_requestAccounts' })
        await new Promise(r => setTimeout(r, 500))
        if (!closedRef.current) { closedRef.current = true; onClose() }
      } catch (e2: any) {
        const msg2: string = e2?.message ?? ''
        if (!msg2.toLowerCase().includes('rejected') && !msg2.toLowerCase().includes('denied')) {
          setErr(msg2 || 'Connection failed. Make sure your wallet is unlocked.')
        }
        setConnecting(null)
      }
    }
  }

  async function handleWalletConnect() {
    if (connecting) return
    setConnecting('walletconnect')
    setErr('')
    await disconnect()
    await new Promise(r => setTimeout(r, 150))
    try {
      const connector = walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true })
      connect({ connector })
      // WalletConnect opens its own modal; isConnected effect will close ours
    } catch (e: any) {
      setErr(e?.message ?? 'WalletConnect failed')
      setConnecting(null)
    }
  }

  const noWalletFound = injectedWallets.length === 0

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Connect Wallet</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {noWalletFound ? 'No browser wallet detected' : 'Choose your wallet to continue'}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Detected injected wallets */}
        {injectedWallets.map(wallet => {
          const isThis = connecting === wallet.id
          const isOther = !!connecting && connecting !== wallet.id
          return (
            <button key={wallet.id} onClick={() => handleInjected(wallet.id)} disabled={!!connecting}
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderRadius: 14, background: isThis ? T.accentDim : T.surface2, border: `1px solid ${isThis ? T.accentMid : T.border}`, cursor: connecting ? 'not-allowed' : 'pointer', color: T.text, textAlign: 'left', opacity: isOther ? 0.45 : 1, transition: 'all 0.15s' }}>
              <div style={{ fontSize: 26, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0 }}>
                {isThis ? '⏳' : wallet.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{wallet.label}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2, fontFamily: T.mono }}>{wallet.desc}</div>
              </div>
              {isThis
                ? <div style={{ fontSize: 11, color: T.accent, fontFamily: T.mono, flexShrink: 0 }}>Check extension…</div>
                : <div style={{ color: T.muted, fontSize: 18, flexShrink: 0 }}>›</div>}
            </button>
          )
        })}

        {/* If no extension found, show a hint */}
        {noWalletFound && (
          <div style={{ padding: '14px 16px', borderRadius: 14, background: T.surface2, border: `1px solid ${T.border}`, fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            No wallet extension detected in this browser.<br />
            Install <a href="https://rabby.io" target="_blank" rel="noreferrer" style={{ color: T.accent }}>Rabby</a> or{' '}
            <a href="https://metamask.io" target="_blank" rel="noreferrer" style={{ color: T.accent }}>MetaMask</a>,
            then refresh — or use WalletConnect below to connect a mobile wallet.
          </div>
        )}

        {/* WalletConnect always shown */}
        {(() => {
          const isThis = connecting === 'walletconnect'
          const isOther = !!connecting && connecting !== 'walletconnect'
          return (
            <button onClick={handleWalletConnect} disabled={!!connecting}
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderRadius: 14, background: isThis ? T.accentDim : T.surface2, border: `1px solid ${isThis ? T.accentMid : T.border}`, cursor: connecting ? 'not-allowed' : 'pointer', color: T.text, textAlign: 'left', opacity: isOther ? 0.45 : 1, transition: 'all 0.15s' }}>
              <div style={{ fontSize: 26, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: T.surface, border: `1px solid ${T.border}`, flexShrink: 0 }}>
                {isThis ? '⏳' : '🔗'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>WalletConnect</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2, fontFamily: T.mono }}>Mobile & all WC wallets</div>
              </div>
              {isThis
                ? <div style={{ fontSize: 11, color: T.accent, fontFamily: T.mono, flexShrink: 0 }}>Opening QR…</div>
                : <div style={{ color: T.muted, fontSize: 18, flexShrink: 0 }}>›</div>}
            </button>
          )
        })()}
      </div>

      {err && (
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: T.red + '15', border: `1px solid ${T.red}40`, fontSize: 12, color: T.red, fontFamily: T.mono, lineHeight: 1.5 }}>
          ⚠️ {err}
          <button onClick={() => { setErr(''); setConnecting(null) }} style={{ marginLeft: 10, background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Retry</button>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 10, color: T.muted, textAlign: 'center', fontFamily: T.mono, lineHeight: 1.6 }}>
        By connecting you agree to use this dApp on Somnia Testnet.<br />
        Make sure your wallet is set to Somnia Testnet (Chain ID: 50312).
      </div>
    </Modal>
  )
}

// ─── NETWORK SWITCH MODAL ──────────────────────────────────────────────────────
function NetworkModal({ onClose, onSwitch }: { onClose: () => void; onSwitch: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function doSwitch() {
    setBusy(true); setErr('')
    try {
      await onSwitch()
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to switch network')
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🌐</div>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Wrong Network</div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, marginBottom: 24 }}>
          ReactPay runs on <span style={{ color: T.accent, fontWeight: 700 }}>Somnia Testnet</span> (Chain ID: 50312).<br />
          Switch your wallet to continue.
        </div>
        {err && <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: T.red + '15', border: `1px solid ${T.red}40`, fontSize: 12, color: T.red, fontFamily: T.mono }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <Btn onClick={doSwitch} disabled={busy} style={{ flex: 2, padding: '10px', borderRadius: 99, background: T.accent, color: '#0A0E14', border: 'none', fontWeight: 800, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Switching…' : '⚡️ Switch to Somnia Testnet'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

function GasBanner({ sttBal, onDismiss }: { sttBal: bigint; onDismiss: () => void }) {
  if (sttBal >= BigInt('10000000000000000')) return null
  return (
    <div style={{ background: '#F59E0B12', border: '1px solid #F59E0B35', borderRadius: 10, padding: '10px 16px', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>⛽️</span>
        <span style={{ fontSize: 12, color: T.yellow, fontFamily: T.mono }}>
          Low STT balance — you need STT for gas.&nbsp;
          <a href="https://testnet.somnia.network/" target="_blank" rel="noreferrer" style={{ color: T.accent, fontWeight: 700, textDecoration: 'none' }}>Get STT from faucet ↗️</a>
        </span>
      </div>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 16, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: T.mono }}>{label}</div>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #1E2D3D', background: '#141C28', color: '#E2EAF0', fontSize: 13, fontFamily: T.mono, outline: 'none', boxSizing: 'border-box' }} />
      {hint && <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// ─── Gas estimation helper for raw eth_sendTransaction fallback paths ──────────
// Wallets like Rabby reject transactions with gas: 0x0 (no estimate).
// Estimates via eth_estimateGas + 30% buffer; falls back to 300k if RPC rejects.
async function estimateGas(eth: any, tx: { from: string; to: string; data: string }): Promise<string> {
  try {
    const raw: string = await eth.request({ method: 'eth_estimateGas', params: [tx] })
    const buffered = Math.ceil(parseInt(raw, 16) * 1.3)
    return '0x' + buffered.toString(16)
  } catch {
    return '0x493E0' // 300_000 — safe default for any contract interaction
  }
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: wc } = useWalletClient()
  const [title, setTitle] = useState('')
  const [freelancer, setFreelancer] = useState('')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const valid = title.length > 0 && freelancer.startsWith('0x') && freelancer.length === 42 && parseFloat(amount) > 0

  async function create() {
    if (!valid) return
    setBusy(true); setErr('')
    try {
      const amt = parseUnits(amount, 18)
      if (wc) {
        setStatus('Step 1/2: Approving RSTT...')
        const appTx = await wc.writeContract({ address: MOCK_STT_ADDRESS, abi: MOCK_STT_ABI, functionName: 'approve', args: [REACT_PAY_ADDRESS, amt] })
        await publicClient.waitForTransactionReceipt({ hash: appTx })
        setStatus('Step 2/2: Creating escrow...')
        const tx = await wc.writeContract({ address: REACT_PAY_ADDRESS, abi: REACT_PAY_ABI, functionName: 'createEscrow', args: [freelancer as `0x${string}`, amt, title, BigInt(300)] })
        await publicClient.waitForTransactionReceipt({ hash: tx })
      } else {
        const eth = (window as any).ethereum
        if (!eth) throw new Error('No wallet found')
        const { encodeFunctionData } = await import('viem')
        const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
        setStatus('Step 1/2: Approving RSTT...')
        const approveData = encodeFunctionData({ abi: MOCK_STT_ABI, functionName: 'approve', args: [REACT_PAY_ADDRESS, amt] })
        const approveTx = { from: accounts[0], to: MOCK_STT_ADDRESS, data: approveData }
        const appGas = await estimateGas(eth, approveTx)
        const appTx = await eth.request({ method: 'eth_sendTransaction', params: [{ ...approveTx, gas: appGas }] })
        await publicClient.waitForTransactionReceipt({ hash: appTx as `0x${string}`, timeout: 120_000 })
        setStatus('Step 2/2: Creating escrow...')
        const createData = encodeFunctionData({ abi: REACT_PAY_ABI, functionName: 'createEscrow', args: [freelancer as `0x${string}`, amt, title, BigInt(300)] })
        const createTx = { from: accounts[0], to: REACT_PAY_ADDRESS, data: createData }
        const createGas = await estimateGas(eth, createTx)
        const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ ...createTx, gas: createGas }] })
        await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}`, timeout: 120_000 })
      }
      setStatus('Done! Reactivity is now watching...')
      setTimeout(() => { onDone(); onClose() }, 1500)
    } catch (e: any) { setErr(e?.shortMessage ?? e?.message ?? String(e)); setBusy(false) }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Create Escrow</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <Field label="Job Title" value={title} onChange={setTitle} placeholder="e.g. Logo Design" />
      <Field label="Freelancer Wallet" value={freelancer} onChange={setFreelancer} placeholder="0x..." hint="Must be a different wallet from yours" />
      <Field label="Amount (RSTT)" value={amount} onChange={setAmount} placeholder="100" type="number" />
      {status && <div style={{ padding: '10px 14px', borderRadius: 8, background: T.accentDim, border: `1px solid ${T.accentMid}`, fontSize: 12, color: T.accent, fontFamily: T.mono, marginBottom: 12 }}>{status}</div>}
      {err && <div style={{ padding: '10px 14px', borderRadius: 8, background: T.red + '15', border: `1px solid ${T.red}40`, fontSize: 12, color: T.red, fontFamily: T.mono, marginBottom: 12 }}>Error: {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 99, background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <Btn onClick={create} disabled={!valid || busy} style={{ flex: 1, padding: '9px 20px', borderRadius: 99, background: T.accent, color: '#0A0E14', border: 'none', fontWeight: 800, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: (!valid || busy) ? 0.5 : 1 }}>
          {busy ? 'Working...' : '⚡️ Create Escrow'}
        </Btn>
      </div>
    </Modal>
  )
}

function DeliverModal({ escrow, onClose, onDone }: { escrow: Escrow; onClose: () => void; onDone: () => void }) {
  const { data: wc } = useWalletClient()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function deliver() {
    if (!input || input.length < 10) return
    setBusy(true); setErr('')
    try {
      setStatus('Submitting delivery hash on-chain...')
      const hash = keccak256(toBytes(input))
      if (wc) {
        const tx = await wc.writeContract({ address: REACT_PAY_ADDRESS, abi: REACT_PAY_ABI, functionName: 'deliverWork', args: [escrow.id, hash] })
        await publicClient.waitForTransactionReceipt({ hash: tx })
      } else {
        const eth = (window as any).ethereum
        if (!eth) throw new Error('No wallet found')
        const { encodeFunctionData } = await import('viem')
        const data = encodeFunctionData({ abi: REACT_PAY_ABI, functionName: 'deliverWork', args: [escrow.id, hash] })
        const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
        const deliverTx = { from: accounts[0], to: REACT_PAY_ADDRESS, data }
        const gas = await estimateGas(eth, deliverTx)
        const txHash = await eth.request({ method: 'eth_sendTransaction', params: [{ ...deliverTx, gas }] })
        await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 120_000 })
      }
      setStatus('Delivered! Reactivity will auto-release payment ⚡️')
      setTimeout(() => { onDone(); onClose() }, 2000)
    } catch (e: any) { setErr(e?.shortMessage ?? e?.message ?? String(e)); setBusy(false) }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Deliver Work</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Escrow #{escrow.id.toString()} · {fmt(escrow.amount)} RSTT</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <Field label="Delivery Reference" value={input} onChange={setInput} placeholder="GitHub link, IPFS CID, file hash..." hint="Hashed and stored on-chain as proof of delivery" />
      {input.length > 0 && input.length < 10 && (
        <div style={{ fontSize: 11, color: T.yellow, marginTop: -8, marginBottom: 12, fontFamily: T.mono }}>⚠️ Reference looks too short — paste a real link or hash</div>
      )}
      {status && <div style={{ padding: '10px 14px', borderRadius: 8, background: T.accentDim, border: `1px solid ${T.accentMid}`, fontSize: 12, color: T.accent, fontFamily: T.mono, marginBottom: 12 }}>{status}</div>}
      {err && <div style={{ padding: '10px 14px', borderRadius: 8, background: T.red + '15', border: `1px solid ${T.red}40`, fontSize: 12, color: T.red, fontFamily: T.mono, marginBottom: 12 }}>Error: {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 99, background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <Btn onClick={deliver} disabled={!input || input.length < 10 || busy} style={{ flex: 1, padding: '9px 20px', borderRadius: 99, background: T.purple, color: '#fff', border: 'none', fontWeight: 800, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: (!input || input.length < 10 || busy) ? 0.5 : 1 }}>
          {busy ? 'Submitting...' : '📦 Deliver Work'}
        </Btn>
      </div>
    </Modal>
  )
}

function Badge({ state }: { state: number }) {
  const name = getStateName(state)
  const color = stateColor(state)
  const icons: Record<string, string> = { Pending: '⏳', Funded: '💰', Delivered: '📦', Released: '✅', Disputed: '⚠️', Refunded: '↩️' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, background: color + '18', border: `1px solid ${color}40`, fontSize: 10, fontWeight: 700, color, fontFamily: T.mono, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {icons[name]} {name}
    </span>
  )
}

function EscrowCard({ escrow, myAddress, onDeliver, onRefresh }: { escrow: Escrow; myAddress?: string; onDeliver: () => void; onRefresh: () => void }) {
  const { data: wc } = useWalletClient()
  const [expanded, setExpanded] = useState(false)
  const state = getStateName(escrow.state)
  const color = stateColor(escrow.state)
  const isClient = !!(myAddress && escrow.client.toLowerCase() === myAddress.toLowerCase())
  const isFreelancer = !!(myAddress && escrow.freelancer.toLowerCase() === myAddress.toLowerCase())

  async function dispute() {
    if (!wc) return
    try {
      const tx = await wc.writeContract({ address: REACT_PAY_ADDRESS, abi: REACT_PAY_ABI, functionName: 'raiseDispute', args: [escrow.id] })
      await publicClient.waitForTransactionReceipt({ hash: tx })
      onRefresh()
    } catch (e: any) { alert(e?.shortMessage ?? 'Failed') }
  }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, borderLeft: `3px solid ${color}`, overflow: 'hidden' }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer', color: T.text, textAlign: 'left' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{escrow.title || `Escrow #${escrow.id}`}</div>
          <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>{fmt(escrow.amount)} RSTT</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 10 }}>
          <Badge state={escrow.state} />
          <span style={{ color: T.muted, fontSize: 14, transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
        </div>
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${T.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', margin: '14px 0' }}>
            {[
              { k: 'Amount', v: `${fmt(escrow.amount)} RSTT`, c: undefined },
              { k: 'Block', v: `#${escrow.createdBlock.toString()}`, c: undefined },
              { k: 'Client', v: short(escrow.client), c: isClient ? T.accent : undefined },
              { k: 'Freelancer', v: short(escrow.freelancer), c: isFreelancer ? T.purple : undefined },
            ].map(({ k, v, c }) => (
              <div key={k}>
                <div style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, fontFamily: T.mono, color: c ?? T.text, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          {state === 'Pending' && <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: T.accentDim, border: `1px solid ${T.accentMid}`, fontSize: 11, color: T.accent, fontFamily: T.mono }}>⚡️ Reactivity watching for deposit...</div>}
          {state === 'Funded' && <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: T.accentDim, border: `1px solid ${T.accentMid}`, fontSize: 11, color: T.accent, fontFamily: T.mono }}>⚡️ Funded — freelancer can now deliver work</div>}
          {state === 'Delivered' && <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: T.accentDim, border: `1px solid ${T.accentMid}`, fontSize: 11, color: T.accent, fontFamily: T.mono }}>⚡️ Reactivity auto-releasing payment...</div>}
          {state === 'Released' && <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: T.green + '12', border: `1px solid ${T.green}30`, fontSize: 11, color: T.green, fontFamily: T.mono }}>✅ Payment auto-released by Somnia Reactivity</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {state === 'Funded' && isFreelancer && (
              <Btn onClick={onDeliver} style={{ padding: '7px 16px', borderRadius: 99, cursor: 'pointer', background: T.purple, color: '#fff', border: 'none', fontWeight: 700, fontSize: 12 }}>📦 Deliver Work</Btn>
            )}
            {isClient && state === 'Delivered' && (
              <Btn onClick={dispute} style={{ padding: '7px 16px', borderRadius: 99, cursor: 'pointer', background: T.red + '15', color: T.red, border: `1px solid ${T.red}40`, fontWeight: 700, fontSize: 12 }}>⚠️ Dispute</Btn>
            )}
            <Btn onClick={onRefresh} style={{ padding: '5px 12px', borderRadius: 99, cursor: 'pointer', background: 'transparent', color: T.muted, border: `1px solid ${T.border}`, fontSize: 11, fontFamily: T.mono }}>↻ Refresh</Btn>
            <a href={`https://shannon-explorer.somnia.network/address/${REACT_PAY_ADDRESS}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: T.muted, textDecoration: 'none', fontFamily: T.mono, marginLeft: 'auto' }}>Explorer ↗️</a>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ACCOUNT MENU ──────────────────────────────────────────────────────────────
function AccountMenu({
  address,
  onClose,
  onSwitchWallet,
  onDisconnect,
  onSwitchNetwork,
  isWrongNetwork,
}: {
  address: string
  onClose: () => void
  onSwitchWallet: () => void
  onDisconnect: () => void
  onSwitchNetwork: () => void
  isWrongNetwork: boolean
}) {
  return (
    <>
      {/* backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
      <div className="account-menu" style={{ zIndex: 100 }}>
        {/* address */}
        <div style={{ padding: '8px 12px 10px', borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
          <div style={{ fontSize: 9, color: T.muted, fontFamily: T.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Connected as</div>
          <div style={{ fontSize: 11, color: T.accent, fontFamily: T.mono, wordBreak: 'break-all' }}>{address}</div>
        </div>

        {isWrongNetwork && (
          <button
            onClick={() => { onClose(); onSwitchNetwork() }}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: T.red + '12', border: 'none', color: T.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}
          >
            🌐 Switch to Somnia Testnet
          </button>
        )}

        <button
          onClick={() => { onClose(); onSwitchWallet() }}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'transparent', border: 'none', color: T.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          🔄 Switch Wallet
        </button>

        <button
          onClick={onDisconnect}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'transparent', border: 'none', color: T.red, fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          ⏏️ Disconnect
        </button>
      </div>
    </>
  )
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { data: sttBal } = useBalance({ address, query: { enabled: isConnected } })
  const { data: wc } = useWalletClient()

  const [escrows, setEscrows] = useState<Escrow[]>([])
  const [rsttBal, setRsttBal] = useState<bigint>(0n)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'all' | 'mine'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [showWallet, setShowWallet] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showNetworkModal, setShowNetworkModal] = useState(false)
  const [deliverEscrow, setDeliverEscrow] = useState<Escrow | null>(null)
  const [gasBannerDismissed, setGasBannerDismissed] = useState(false)

  const isWrongNetwork = isConnected && chainId !== somniaTestnet.id

  // ── Network switching ──────────────────────────────────────────────────────
  async function switchNetwork() {
    const eth = (window as any).ethereum
    if (!eth) throw new Error('No wallet provider found')
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xC488' }] })
    } catch (e: any) {
      if (e.code === 4902 || e.code === -32603) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xC488',
            chainName: 'Somnia Testnet',
            nativeCurrency: { name: 'Somnia Test Token', symbol: 'STT', decimals: 18 },
            rpcUrls: ['https://dream-rpc.somnia.network'],
            blockExplorerUrls: ['https://shannon-explorer.somnia.network'],
          }],
        })
      } else {
        throw e
      }
    }
  }

  // Prompt user to switch network once on connect (but don't force/auto-switch)
  useEffect(() => {
    if (isWrongNetwork) setShowNetworkModal(true)
  }, [isWrongNetwork])

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    try {
      const all = await publicClient.readContract({ address: REACT_PAY_ADDRESS, abi: REACT_PAY_ABI, functionName: 'getAllEscrows' }) as Escrow[]
      setEscrows([...all].reverse())
    } catch (e) { console.warn(e) }
    if (showLoader) setLoading(false)
  }, [])

  const fetchRSTT = useCallback(async () => {
    if (!address) return
    try {
      const b = await publicClient.readContract({ address: MOCK_STT_ADDRESS, abi: MOCK_STT_ABI, functionName: 'balanceOf', args: [address] }) as bigint
      setRsttBal(b)
    } catch {}
  }, [address])

  useEffect(() => { fetchAll(true); fetchRSTT() }, [fetchAll, fetchRSTT])
  useEffect(() => {
    if (deliverEscrow) return
    const t = setInterval(() => { fetchAll(); fetchRSTT() }, 15000)
    return () => clearInterval(t)
  }, [fetchAll, fetchRSTT, deliverEscrow])

  useEffect(() => { setGasBannerDismissed(false) }, [address])

  // ── Faucet ─────────────────────────────────────────────────────────────────
  async function getFaucet() {
    try {
      if (wc) {
        const tx = await wc.writeContract({ address: MOCK_STT_ADDRESS, abi: MOCK_STT_ABI, functionName: 'faucet', args: [parseUnits('1000', 18)] })
        await publicClient.waitForTransactionReceipt({ hash: tx })
      } else {
        const eth = (window as any).ethereum
        if (!eth) throw new Error('No wallet found')
        const { encodeFunctionData } = await import('viem')
        const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
        const data = encodeFunctionData({ abi: MOCK_STT_ABI, functionName: 'faucet', args: [parseUnits('1000', 18)] })
        const faucetTx = { from: accounts[0], to: MOCK_STT_ADDRESS, data }
        const gas = await estimateGas(eth, faucetTx)
        const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ ...faucetTx, gas }] })
        await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}`, timeout: 120_000 })
      }
      fetchRSTT()
      alert('Got 1,000 RSTT!')
    } catch (e: any) { alert(e?.shortMessage ?? e?.message ?? 'Faucet failed') }
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────
  async function handleDisconnect() {
    setShowAccountMenu(false)
    await disconnect()
    setRsttBal(0n)
  }

  // ── Switch wallet: disconnect then show wallet picker ──────────────────────
  async function handleSwitchWallet() {
    setShowAccountMenu(false)
    await disconnect()
    setRsttBal(0n)
    // Small delay so wagmi clears its state before we open the picker
    await new Promise(r => setTimeout(r, 150))
    setShowWallet(true)
  }

  // ── "Connect Wallet" button: always show picker, never auto-reconnect ──────
  function handleOpenWalletModal() {
    setShowWallet(true)
  }

  const visible = tab === 'mine'
    ? escrows.filter(e => address && (e.client.toLowerCase() === address.toLowerCase() || e.freelancer.toLowerCase() === address.toLowerCase()))
    : escrows

  const totalLocked = escrows.reduce((a, e) => [1, 2].includes(e.state) ? a + e.amount : a, 0n)
  const sttBalRaw = sttBal?.value ?? 0n

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        input::placeholder { color: #4A6680; }
        button:hover:not(:disabled) { filter: brightness(1.1); }
        .stats-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 28px; }
        .hero-title { font-size: 42px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.1; margin-bottom: 14px; }
        .header-connected { display: flex; gap: 8px; align-items: center; }
        .bal-rstt { padding: 6px 10px; border-radius: 8px; background: #141C28; border: 1px solid #1E2D3D; font-size: 11px; font-family: 'JetBrains Mono', monospace; color: #4A6680; white-space: nowrap; }
        .bal-stt  { padding: 6px 10px; border-radius: 8px; background: #141C28; border: 1px solid #1E2D3D; font-size: 11px; font-family: 'JetBrains Mono', monospace; color: #4A6680; white-space: nowrap; }
        .account-menu { position: absolute; top: 54px; right: 16px; background: #0F1520; border: 1px solid #1E2D3D; border-radius: 14px; padding: 8px; min-width: 220px; z-index: 100; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
        @media (max-width: 600px) {
          .modal-overlay { align-items: flex-end !important; }
          .modal-inner { border-radius: 20px 20px 0 0 !important; }
          .stats-grid { grid-template-columns: 1fr 1fr; }
          .stats-grid > div:last-child { grid-column: span 2; }
          .hero-title { font-size: 26px !important; }
          .bal-stt  { display: none !important; }
          .bal-rstt { display: none !important; }
          .account-menu { right: 8px; }
        }
      `}</style>

      {/* Modals */}
      {showWallet && <WalletModal onClose={() => setShowWallet(false)} />}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onDone={() => { fetchAll(); fetchRSTT() }} />}
      {deliverEscrow && <DeliverModal escrow={deliverEscrow} onClose={() => setDeliverEscrow(null)} onDone={() => { fetchAll(); fetchRSTT() }} />}
      {showNetworkModal && <NetworkModal onClose={() => setShowNetworkModal(false)} onSwitch={switchNetwork} />}

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, height: 62, borderBottom: '1px solid #1E2D3D', background: '#0F1520EE', backdropFilter: 'blur(20px)', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: '#4FFFB020', border: '1px solid #4FFFB030', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>⚡️</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em' }}>React<span style={{ color: T.accent }}>Pay</span></div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: T.mono }}>Somnia Reactivity</div>
          </div>
        </div>

        <div className="header-connected" style={{ position: 'relative' }}>
          {isConnected ? (
            <>
              {isWrongNetwork ? (
                // Wrong network — show a prominent switch button
                <Btn
                  onClick={() => setShowNetworkModal(true)}
                  style={{ padding: '7px 14px', borderRadius: 99, background: T.red + '15', color: T.red, border: `1px solid ${T.red}40`, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: T.mono, whiteSpace: 'nowrap' }}
                >
                  ⚠️ Wrong Network
                </Btn>
              ) : (
                <>
                  <Btn onClick={getFaucet} style={{ padding: '7px 12px', borderRadius: 99, background: T.accentDim, color: T.accent, border: `1px solid ${T.accentMid}`, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: T.mono, whiteSpace: 'nowrap' }}>🚰 Get RSTT</Btn>
                  <div className="bal-rstt"><span style={{ color: T.accent, fontWeight: 700 }}>{parseFloat(formatEther(rsttBal)).toFixed(1)}</span>&nbsp;RSTT</div>
                  <div className="bal-stt">{sttBal ? parseFloat(formatEther(sttBal.value)).toFixed(3) : '—'}&nbsp;STT</div>
                </>
              )}

              {/* Account button */}
              <Btn
                onClick={() => setShowAccountMenu(v => !v)}
                style={{ padding: '7px 12px', borderRadius: 99, background: T.surface2, color: T.accent, border: '1px solid #4FFFB035', fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: T.mono, whiteSpace: 'nowrap' }}
              >
                ✓ {short(address ?? '')} ▾
              </Btn>

              {showAccountMenu && (
                <AccountMenu
                  address={address ?? ''}
                  onClose={() => setShowAccountMenu(false)}
                  onSwitchWallet={handleSwitchWallet}
                  onDisconnect={handleDisconnect}
                  onSwitchNetwork={() => setShowNetworkModal(true)}
                  isWrongNetwork={isWrongNetwork}
                />
              )}
            </>
          ) : (
            <Btn
              onClick={handleOpenWalletModal}
              style={{ padding: '10px 20px', borderRadius: 99, background: T.accent, color: '#0A0E14', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Connect Wallet
            </Btn>
          )}
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        {isConnected && !gasBannerDismissed && (
          <GasBanner sttBal={sttBalRaw} onDismiss={() => setGasBannerDismissed(true)} />
        )}

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 14px', borderRadius: 99, marginBottom: 14, background: T.accentDim, border: `1px solid ${T.accentMid}`, fontSize: 11, color: T.accent, fontFamily: T.mono, fontWeight: 700 }}>⚡️ POWERED BY SOMNIA REACTIVITY</div>
          <h1 className="hero-title">Freelance escrow that<br /><span style={{ color: T.accent }}>executes itself.</span></h1>
          <p style={{ fontSize: 15, color: T.muted, maxWidth: 460, margin: '0 auto', lineHeight: 1.7 }}>No Upwork. No PayPal. No 20% fees. Lock funds on-chain, deliver work, get paid — automatically via Somnia Reactivity.</p>
        </div>

        <div className="stats-grid">
          {[
            { label: 'Total Locked', value: `${fmt(totalLocked)} RSTT`, color: T.blue },
            { label: 'Active Escrows', value: String(escrows.filter(e => e.state < 3).length), color: T.accent },
            { label: 'Auto-Released', value: String(escrows.filter(e => e.state === 3).length), color: T.green },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: T.surface, border: '1px solid #1E2D3D', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: T.mono }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'mine'] as const).map(t => (
              <Btn key={t} onClick={() => setTab(t)} style={{ padding: '7px 14px', borderRadius: 99, cursor: 'pointer', background: tab === t ? T.accentDim : 'transparent', border: `1px solid ${tab === t ? T.accentMid : T.border}`, color: tab === t ? T.accent : T.muted, fontSize: 11, fontWeight: 700, fontFamily: T.mono, textTransform: 'uppercase' }}>
                {t === 'all' ? `All (${escrows.length})` : `Mine (${escrows.filter(e => address && (e.client.toLowerCase() === address.toLowerCase() || e.freelancer.toLowerCase() === address.toLowerCase())).length})`}
              </Btn>
            ))}
          </div>
          {isConnected && !isWrongNetwork && (
            <Btn onClick={() => setShowCreate(true)} style={{ padding: '10px 18px', borderRadius: 99, background: T.accent, color: '#0A0E14', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>⚡️ New Escrow</Btn>
          )}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: T.muted, fontFamily: T.mono }}>Loading...</div>}

        {!loading && visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: T.surface, border: '1px solid #1E2D3D', borderRadius: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚡️</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No escrows yet</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 20 }}>{isConnected ? 'Create your first trustless escrow' : 'Connect your wallet to get started'}</div>
            {isConnected && !isWrongNetwork && <Btn onClick={() => setShowCreate(true)} style={{ padding: '10px 22px', borderRadius: 99, background: T.accent, color: '#0A0E14', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Create Escrow</Btn>}
            {!isConnected && <Btn onClick={handleOpenWalletModal} style={{ padding: '10px 22px', borderRadius: 99, background: T.accent, color: '#0A0E14', border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Connect Wallet</Btn>}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(e => (
            <EscrowCard key={e.id.toString()} escrow={e} myAddress={address} onDeliver={() => setDeliverEscrow(e)} onRefresh={() => { fetchAll(); fetchRSTT() }} />
          ))}
        </div>

        <div style={{ marginTop: 48, paddingTop: 20, borderTop: '1px solid #1E2D3D', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.muted, fontFamily: T.mono, flexWrap: 'wrap', gap: 8 }}>
          <span>REACTPAY · SOMNIA REACTIVITY HACKATHON 2026</span>
          <div style={{ display: 'flex', gap: 16 }}>
            <a href="https://shannon-explorer.somnia.network" target="_blank" rel="noreferrer" style={{ color: T.muted, textDecoration: 'none' }}>EXPLORER ↗️</a>
            <a href="https://docs.somnia.network" target="_blank" rel="noreferrer" style={{ color: T.muted, textDecoration: 'none' }}>DOCS ↗️</a>
          </div>
        </div>
      </main>
    </div>
  )
}
