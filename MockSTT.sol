// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockSTT
 * @notice ERC-20 payment token for ReactPay on Somnia Testnet.
 *         Native STT doesn't emit Transfer logs — this one does.
 *         Built-in faucet so anyone can grab test tokens.
 *
 * DEPLOY: Remix → Somnia Testnet (Chain ID 50312) → no constructor args
 */
contract MockSTT {
    string  public name     = "ReactPay Token";
    string  public symbol   = "RSTT";
    uint8   public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    // Anyone can mint up to 10,000 RSTT for testing
    function faucet(uint256 amount) external {
        require(amount <= 10_000 * 10 ** 18, "Max 10,000 RSTT per call");
        _mint(msg.sender, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0),          "Zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply   += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
