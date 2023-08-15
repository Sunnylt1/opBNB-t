import {ethers} from "ethers";
import "dotenv/config";
import {CrossChainMessenger, ETHBridgeAdapter, MessageStatus, StandardBridgeAdapter} from "@eth-optimism/sdk"

const BNB_TEST_NODE = process.env.BNB_TEST_NODE;
const opBNB_TEST_NODE = process.env.opBNB_TEST_NODE;
const PRIVATE_KEY = process.env.PRIVATE_KEY
const TO_ADDRESS = process.env.TO_ADDRESS

const L1_BUSD = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee"
const L2_BUSD = "0xa9aD1484D9Bfb27adbc2bf50A6E495777CC8cFf2"

let crossChainMessenger;


const getSigners = async () => {

    const l1RpcProvider = new ethers.providers.JsonRpcProvider(BNB_TEST_NODE);
    const l2RpcProvider = new ethers.providers.JsonRpcProvider(opBNB_TEST_NODE);

    const l1Wallet = new ethers.Wallet(PRIVATE_KEY, l1RpcProvider);
    const l2Wallet = new ethers.Wallet(PRIVATE_KEY, l2RpcProvider);

    return [l1Wallet, l2Wallet]
}

const setup = async (l1Signer, l2Signer) => {

    const zeroAddr = "0x".padEnd(42, "0")
    const l1Contracts = {
        StateCommitmentChain: zeroAddr,
        CanonicalTransactionChain: zeroAddr,
        BondManager: zeroAddr,
        // These contracts have the addresses you found out earlier.
        AddressManager: "0x4d07b9B1ffC70Fc824587573cfb6ef1Cc404AaD7",   // Lib_AddressManager.json
        L1CrossDomainMessenger: "0xD506952e78eeCd5d4424B1990a0c99B1568E7c2C",  // Proxy__OVM_L1CrossDomainMessenger.json
        L1StandardBridge: "0x677311Fd2cCc511Bbc0f581E8d9a07B033D5E840",   // Proxy__OVM_L1StandardBridge.json
        OptimismPortal: "0x4386C8ABf2009aC0c263462Da568DD9d46e52a31",   // OptimismPortalProxy.json
        L2OutputOracle: "0xFf2394Bb843012562f4349C6632a0EcB92fC8810",   // L2OutputOracleProxy.json
    }
    const bridges = {
        Standard: {
            l1Bridge: l1Contracts.L1StandardBridge,
            l2Bridge: "0x4200000000000000000000000000000000000010",
            Adapter: StandardBridgeAdapter
        },
        ETH: {
            l1Bridge: l1Contracts.L1StandardBridge,
            l2Bridge: "0x4200000000000000000000000000000000000010",
            Adapter: ETHBridgeAdapter
        }
    }

    crossChainMessenger = new CrossChainMessenger({
        bedrock: true,
        contracts: {
            l1: l1Contracts
        },
        bridges: bridges,
        l1ChainId: await l1Signer.getChainId(),
        l2ChainId: await l2Signer.getChainId(),
        l1SignerOrProvider: l1Signer,
        l2SignerOrProvider: l2Signer,
    })
}

const withdrawProveAndFinalize = async (l1Signer, l2Hash) => {
    const start = new Date()

    console.log(`Transaction hash (on L2): ${l2Hash} , Time so far ${(new Date() - start) / 1000} seconds`)
    console.log("Waiting for status to be READY_TO_PROVE....")
    let lastBlockNumber = await l1Signer.provider.getBlockNumber();
    let fromBlockNumber = lastBlockNumber - 4950;

    await crossChainMessenger.waitForMessageStatus(l2Hash, MessageStatus.READY_TO_PROVE, {fromBlockOrBlockHash: fromBlockNumber});
    let status = await crossChainMessenger.getMessageStatus(l2Hash, 0, fromBlockNumber);
    if (status === MessageStatus.READY_TO_PROVE) {
        // prove Message
        const tx = await crossChainMessenger.proveMessage(l2Hash, {overrides: {gasLimit: 5000000}})
        const rcpt = await tx.wait()
        console.log(rcpt.transactionHash)
    }
    console.log("In the challenge period, waiting for status READY_FOR_RELAY")
    console.log(`Time so far ${(new Date() - start) / 1000} seconds`)
    await crossChainMessenger.waitForMessageStatus(l2Hash, MessageStatus.READY_FOR_RELAY, {fromBlockOrBlockHash: fromBlockNumber})

    console.log("Ready for relay, finalizing message now")
    console.log(`Time so far ${(new Date() - start) / 1000} seconds`)

    status = await crossChainMessenger.getMessageStatus(l2Hash, 0, fromBlockNumber);
    if (status === MessageStatus.READY_FOR_RELAY) {
        // finalize Message
        const tx = await crossChainMessenger.finalizeMessage(l2Hash, {overrides: {gasLimit: 5000000}})
        const rcpt = await tx.wait()
        console.log(rcpt.transactionHash)
    }
    console.log("Waiting for status to change to RELAYED")
    console.log(`Time so far ${(new Date() - start) / 1000} seconds`)
    await crossChainMessenger.waitForMessageStatus(l2Hash, MessageStatus.RELAYED, {fromBlockOrBlockHash: fromBlockNumber})
    console.log(`withdrawETH took ${(new Date() - start) / 1000} seconds\n\n\n`)
}

const reportBalances = async () => {
    const l1Balance = (await crossChainMessenger.l1Signer.getBalance()).toString()
    const l2Balance = (await crossChainMessenger.l2Signer.getBalance()).toString()

    console.log(`Balance on L1: ${ethers.utils.formatEther(l1Balance)} ETH`);
    console.log(`Balance on L2: ${ethers.utils.formatEther(l2Balance)} ETH`);
}

const doTransferERC20 = async (wallet, erc20Address, toAddress, amount = ethers.utils.parseEther("0.000001")) => {
    const abi = [
        "function balanceOf(address) public view returns(uint)",
        "function transfer(address, uint) public returns (bool)",
    ];
    const contractWETH = new ethers.Contract(erc20Address, abi, wallet);
    const tx = await contractWETH.transfer(toAddress, amount);
    await tx.wait(1);
    console.log("doTransferERC20 HASH: ", tx.hash)
}

const doMin = async (wallet) => {
    const abi = ["function mint() public returns (uint256)"]
    const contract = new ethers.Contract("0x5aee67f8dc2d9a5537d4b64057b52da31d37516b", abi, wallet);
    const tx = await contract.mint();
    await tx.wait();
    console.log("doMin HASH: ", tx.hash)
}

const doTransfer = async (wallet, to_address, amount = ethers.utils.parseEther("0.00000001")) => {
    const tx = {to: to_address, value: amount, gasLimit: 21000}

    const receipt = await wallet.sendTransaction(tx);
    await receipt.wait()
    console.log("doTransfer HASH: ", receipt.hash);
}


const doExecute = async (wallet, contract_address, data, amount = ethers.utils.parseEther("0")) => {
    let tx = {
        to: contract_address,
        value: amount,
        data: data,
    }

    const receipt = await wallet.sendTransaction(tx);
    await receipt.wait()
    console.log("doExecute HASH: ", receipt.hash);
    return receipt.hash;
}


const main = async () => {

    const [l1Signer, l2Signer] = await getSigners();
    await setup(l1Signer, l2Signer);
    await reportBalances();


    // run 100 times
    for (let i = 0; i < 110; i++) {
        console.log(`Starting  index ${i}`)

        // 1.Deposit tBNB from BSC Testnet to opBNB Testnet
        try {
            await doExecute(l1Signer, "0x677311fd2ccc511bbc0f581e8d9a07b033d5e840", "0xb1a1a8820000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
                ethers.utils.parseEther("0.00000001"))
        } catch (err) {
            console.log(`Deposit BNB: `, err);
        }

        // 2.Deposit BEP-20 Tokens from BSC Testnet to opBNB Testnet
        try {
            await doExecute(l1Signer, "0x677311Fd2cCc511Bbc0f581E8d9a07B033D5E840", "0x58a997f6000000000000000000000000ed24fc36d5ee211ea25a80239fb8c4cfd80f12ee000000000000000000000000a9ad1484d9bfb27adbc2bf50a6e495777cc8cff200000000000000000000000000000000000000000000000000000002540be4000000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000")
        } catch (err) {
            console.log(`Deposit BUSD: `, err);
        }

        // 3.Transfer BEP-20 Tokens to Other Addresses on opBNB Testnet
        try {
            await doTransferERC20(l2Signer, L2_BUSD, TO_ADDRESS);
        } catch (err) {
            console.log(`doTransferERC20: `, err);
        }

        // 4.Transfer tBNB to Other Addresses on opBNB Testnet
        try {
            await doTransfer(l2Signer, TO_ADDRESS)
        } catch (err) {
            console.log(`doTransfer: `, err);
        }

        // 5.Mint Your Own NFT
        try {
            await doMin(l2Signer)
        } catch (err) {
            console.log(`doMint: `, err);
        }

        // 6.Withdraw tBNB from opBNB Testnet to BSC Testnet
        try {
            let tx = await crossChainMessenger.withdrawETH()
            let rcpt = await tx.wait()
            const hash = rcpt.transactionHash;
            await withdrawProveAndFinalize(l1Signer, hash)
        } catch (err) {
            console.log(`L2 withdraw BNB: `, err);
        }

        // 7.Withdraw BEP-20 Tokens from opBNB Testnet to BSC Testnet
        try {
            let tx = await crossChainMessenger.withdrawERC20(L1_BUSD, L2_BUSD, ethers.utils.parseEther("0.00000001"))
            let rcpt = await tx.wait()
            const hash = rcpt.transactionHash;
            await withdrawProveAndFinalize(l1Signer, hash)
        } catch (err) {
            console.log(`L2 withdraw BNB: `, err);
        }
    }
}
export default main();