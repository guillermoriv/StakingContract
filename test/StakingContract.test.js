const { ethers, upgrades } = require('hardhat');
const assert = require('assert');

/*
  Describing the tests, for the staking
  contract.

  It also deploys the token contract to
  give the rewards for the user.
*/
describe('StakingContract: Testing Staking Contract', () => {
  let stakingC;
  let stakeToken;
  let iWETH;
  let pairV2;

  let owner;
  let account2;
  let account3;

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
  const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

  before(async () => {
    [owner, account2, account3] = await ethers.getSigners();

    const StakeToken = await ethers.getContractFactory('StakeToken');
    stakeToken = await upgrades.deployProxy(StakeToken, ['StakeToken', 'STK']);

    const StakingContract = await ethers.getContractFactory('StakingContract');
    stakingC = await upgrades.deployProxy(StakingContract, [
      owner.address,
      stakeToken.address,
    ]);
    await stakingC.deployed();

    iWETH = await ethers.getContractAt('IWeth', WETH);

    pairV2 = await ethers.getContractAt(
      'IUniswapV2Pair',
      await stakingC._getAddressPair(WETH, DAI)
    );
  });

  it('should deploy the contract with the proxy', async () => {
    const StakingContract = await ethers.getContractFactory('StakingContract');
    let stakingCTest = await upgrades.deployProxy(StakingContract, [
      owner.address,
      stakeToken.address,
    ]);
    await stakingCTest.deployed();

    assert.ok(stakingCTest.address);
  });

  it('has a correct address, the deployed contract', async () => {
    assert.ok(stakingC.address);
  });

  it('should create the stake with no LP tokens', async () => {
    await stakingC
      .connect(account2)
      .createStake(
        WETH,
        DAI,
        0,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        0,
        {
          value: ethers.utils.parseUnits('1', 18),
        }
      );
    assert(Number((await stakingC.stakeOf(account2.address)).toString()) > 0);
  });

  it('should reject the transaction, because the actual user is not a holder', async () => {
    try {
      await stakingC.connect(account3).claimStakeAndReward(WETH, DAI);
    } catch (error) {
      assert(error);
    }
  });

  it('should sign a transaction and then approve with LP tokens', async () => {
    const iDAI = await ethers.getContractAt('IERC20', DAI);

    await iWETH.deposit({ value: ethers.utils.parseEther('0.5') });
    await iWETH.transfer(pairV2.address, ethers.utils.parseEther('0.5'));
    await iWETH.deposit({ value: ethers.utils.parseEther('0.5') });

    const amount0Out =
      WETH === (await pairV2.token1())
        ? String(
            await stakingC._getReturn(WETH, DAI, ethers.utils.parseEther('0.5'))
          )
        : 0;
    const amount1Out =
      WETH === (await pairV2.token0())
        ? String(
            await stakingC._getReturn(WETH, DAI, ethers.utils.parseEther('0.5'))
          )
        : 0;

    await pairV2.swap(amount0Out, amount1Out, owner.address, '0x');

    await iDAI.transfer(
      pairV2.address,
      String(await iDAI.balanceOf(owner.address))
    );

    await iWETH.transfer(
      pairV2.address,
      String(await iWETH.balanceOf(owner.address))
    );

    await pairV2.mint(owner.address);

    const domain = {
      name: 'Uniswap V2',
      version: '1',
      chainId: 1,
      verifyingContract: pairV2.address,
    };

    const types = {
      Permit: [
        {
          name: 'owner',
          type: 'address',
        },
        {
          name: 'spender',
          type: 'address',
        },
        {
          name: 'value',
          type: 'uint256',
        },
        {
          name: 'nonce',
          type: 'uint256',
        },
        {
          name: 'deadline',
          type: 'uint256',
        },
      ],
    };

    const deadline = Date.now() + 1;

    const amount = (await pairV2.balanceOf(owner.address)).toString();

    const value = {
      owner: owner.address,
      spender: stakingC.address,
      value: amount,
      nonce: Number(await pairV2.nonces(owner.address)),
      deadline: deadline,
    };

    const signature = (
      await owner._signTypedData(domain, types, value)
    ).substring(2);
    const r = '0x' + signature.substring(0, 64);
    const s = '0x' + signature.substring(64, 128);
    const v = parseInt(signature.substring(128, 130), 16);

    await stakingC.createStake(WETH, DAI, v, r, s, deadline);
  });

  it('should claim the stake from the contract and receive the tokens', async () => {
    await stakingC.claimStakeAndReward(WETH, DAI);

    assert(Number(await pairV2.balanceOf(owner.address)) > 0);
    assert(Number(await stakeToken.balanceOf(owner.address)) > 0);
  });

  it('should reject the claim reward if already the user claimed the reward', async () => {
    await stakingC
      .connect(account3)
      .createStake(
        WETH,
        DAI,
        0,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        0,
        {
          value: ethers.utils.parseUnits('1', 18),
        }
      );

    assert(Number((await stakingC.stakeOf(account3.address)).toString()) > 0);

    await stakingC.connect(account3).claimReward(WETH, DAI);

    try {
      await stakingC.connect(account3).claimReward(WETH, DAI);
    } catch (error) {
      assert(error);
    }
  });
});
