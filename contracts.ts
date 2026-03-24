// ── Contract addresses ────────────────────────────────────────────────────────
// Fill these in after deploying via Remix
export const MOCK_STT_ADDRESS  = (process.env.NEXT_PUBLIC_MOCK_STT_ADDRESS  ?? '') as `0x${string}`
export const REACT_PAY_ADDRESS = (process.env.NEXT_PUBLIC_REACT_PAY_ADDRESS ?? '') as `0x${string}`

// ── MockSTT ABI (minimal) ─────────────────────────────────────────────────────
export const MOCK_STT_ABI = [
  { name: 'balanceOf',    type: 'function', stateMutability: 'view',        inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance',    type: 'function', stateMutability: 'view',        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve',      type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'faucet',       type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'decimals',     type: 'function', stateMutability: 'view',        inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'symbol',       type: 'function', stateMutability: 'view',        inputs: [], outputs: [{ type: 'string' }] },
  { name: 'Transfer',     type: 'event', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
] as const

// ── ReactPay ABI (full) ───────────────────────────────────────────────────────
export const REACT_PAY_ABI = [
  // Write
  {
    name: 'createEscrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'freelancer',    type: 'address' },
      { name: 'amount',        type: 'uint256' },
      { name: 'title',         type: 'string'  },
      { name: 'disputeWindow', type: 'uint256' },
    ],
    outputs: [{ name: 'escrowId', type: 'uint256' }],
  },
  {
    name: 'deliverWork',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId',     type: 'uint256' },
      { name: 'deliveryHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'raiseDispute',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [],
  },
  // Read
  {
    name: 'getEscrow',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id',             type: 'uint256' },
        { name: 'client',         type: 'address' },
        { name: 'freelancer',     type: 'address' },
        { name: 'amount',         type: 'uint256' },
        { name: 'title',          type: 'string'  },
        { name: 'deliveryHash',   type: 'bytes32' },
        { name: 'state',          type: 'uint8'   },
        { name: 'createdBlock',   type: 'uint256' },
        { name: 'fundedBlock',    type: 'uint256' },
        { name: 'deliveredBlock', type: 'uint256' },
        { name: 'disputeWindow',  type: 'uint256' },
      ],
    }],
  },
  {
    name: 'getAllEscrows',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'id',             type: 'uint256' },
        { name: 'client',         type: 'address' },
        { name: 'freelancer',     type: 'address' },
        { name: 'amount',         type: 'uint256' },
        { name: 'title',          type: 'string'  },
        { name: 'deliveryHash',   type: 'bytes32' },
        { name: 'state',          type: 'uint8'   },
        { name: 'createdBlock',   type: 'uint256' },
        { name: 'fundedBlock',    type: 'uint256' },
        { name: 'deliveredBlock', type: 'uint256' },
        { name: 'disputeWindow',  type: 'uint256' },
      ],
    }],
  },
  {
    name: 'getClientEscrows',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'client', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getFreelancerEscrows',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  { name: 'escrowCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'token',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  // Events
  {
    name: 'EscrowCreated',
    type: 'event',
    inputs: [
      { name: 'id',         type: 'uint256', indexed: true },
      { name: 'client',     type: 'address', indexed: true },
      { name: 'freelancer', type: 'address', indexed: true },
      { name: 'amount',     type: 'uint256', indexed: false },
      { name: 'title',      type: 'string',  indexed: false },
    ],
  },
  {
    name: 'PaymentConfirmed',
    type: 'event',
    inputs: [
      { name: 'id',          type: 'uint256', indexed: true },
      { name: 'blockNumber', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'WorkDelivered',
    type: 'event',
    inputs: [
      { name: 'id',           type: 'uint256', indexed: true },
      { name: 'freelancer',   type: 'address', indexed: true },
      { name: 'deliveryHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    name: 'PaymentReleased',
    type: 'event',
    inputs: [
      { name: 'id',         type: 'uint256', indexed: true },
      { name: 'freelancer', type: 'address', indexed: true },
      { name: 'amount',     type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'DisputeRaised',
    type: 'event',
    inputs: [
      { name: 'id',     type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
    ],
  },
] as const

// ── Escrow state enum ─────────────────────────────────────────────────────────
export const ESCROW_STATES = ['Pending', 'Funded', 'Delivered', 'Released', 'Disputed', 'Refunded'] as const
export type EscrowState = typeof ESCROW_STATES[number]

export function getStateName(state: number): EscrowState {
  return ESCROW_STATES[state] ?? 'Unknown'
}

// ── State colors ──────────────────────────────────────────────────────────────
export const STATE_COLOR: Record<string, string> = {
  Pending:   '#F59E0B',
  Funded:    '#3B82F6',
  Delivered: '#8B5CF6',
  Released:  '#10B981',
  Disputed:  '#EF4444',
  Refunded:  '#6B7280',
}
