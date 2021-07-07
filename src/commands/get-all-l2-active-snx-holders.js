#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const chalk = require('chalk');
const { getPastEvents } = require('../utils/getEvents');
const { getContract } = require('../utils/getContract');
const { wrap } = require('synthetix');

// There are currently 2 bridge versions: 0x045e507925d2e05D114534D0810a1abD94aca8d6, and 0xCd9D4988C0AE61887B075bA77f08cbFAd2b65068
// https://etherscan.io/address/0x045e507925d2e05D114534D0810a1abD94aca8d6#events
// https://etherscan.io/address/0xCd9D4988C0AE61887B075bA77f08cbFAd2b65068#events
const knownBridges = {
	'0x045e507925d2e05D114534D0810a1abD94aca8d6': {
		fromBlock: 11656238,
		depositEventName: 'Deposit',
		depositEventTarget: 'account',
		migrateEventName: 'ExportedVestingEntries',
		migrateEventTarget: 'account',
		abi: [
			{
				"anonymous":false,
				"inputs":[
					 {
							"indexed":true,
							"internalType":"address",
							"name":"account",
							"type":"address"
					 },
					 {
							"indexed":false,
							"internalType":"uint256",
							"name":"amount",
							"type":"uint256"
					 }
				],
				"name":"Deposit",
				"type":"event"
			},
			{
				"anonymous":false,
				"inputs":[
					 {
							"indexed":true,
							"internalType":"address",
							"name":"account",
							"type":"address"
					 },
					 {
							"indexed":false,
							"internalType":"uint256",
							"name":"escrowedAccountBalance",
							"type":"uint256"
					 },
					 {
							"components":[
								 {
										"internalType":"uint64",
										"name":"endTime",
										"type":"uint64"
								 },
								 {
										"internalType":"uint256",
										"name":"escrowAmount",
										"type":"uint256"
								 }
							],
							"indexed":false,
							"internalType":"struct VestingEntries.VestingEntry[]",
							"name":"vestingEntries",
							"type":"tuple[]"
					 }
				],
				"name":"ExportedVestingEntries",
				"type":"event"
			},
		],
	},
	'0xCd9D4988C0AE61887B075bA77f08cbFAd2b65068': {
		fromBlock: 12409013,
		depositEventName: 'DepositInitiated',
		depositEventTarget: '_to',
		migrateEventName: 'ExportedVestingEntries',
		migrateEventTarget: 'account',
		abi: [
			{
				"anonymous":false,
				"inputs":[
					 {
							"indexed":true,
							"internalType":"address",
							"name":"_from",
							"type":"address"
					 },
					 {
							"indexed":false,
							"internalType":"address",
							"name":"_to",
							"type":"address"
					 },
					 {
							"indexed":false,
							"internalType":"uint256",
							"name":"_amount",
							"type":"uint256"
					 }
				],
				"name":"DepositInitiated",
				"type":"event"
			},
			{
				"anonymous":false,
				"inputs":[
					 {
							"indexed":true,
							"internalType":"address",
							"name":"account",
							"type":"address"
					 },
					 {
							"indexed":false,
							"internalType":"uint256",
							"name":"escrowedAccountBalance",
							"type":"uint256"
					 },
					 {
							"components":[
								 {
										"internalType":"uint64",
										"name":"endTime",
										"type":"uint64"
								 },
								 {
										"internalType":"uint256",
										"name":"escrowAmount",
										"type":"uint256"
								 }
							],
							"indexed":false,
							"internalType":"struct VestingEntries.VestingEntry[]",
							"name":"vestingEntries",
							"type":"tuple[]"
					 }
				],
				"name":"ExportedVestingEntries",
				"type":"event"
			},
		],
	},
};

const network = 'mainnet';

async function getAllActiveSnxHolders({
	providerUrlL1,
	providerUrlL2,
	dataFile,
	toBlock,
	clear,
}) {
	// Validate input parameters
	if (!providerUrlL1) throw new Error('Please specify a provider');
	if (!providerUrlL2) throw new Error('Please specify a provider');
	if (!dataFile) throw new Error('Please specify a JSON output file');
	if (!providerUrlL1.includes(network)) {
		throw new Error('Invalid L1 provider. Only Mainnet Etherem is supported');
	}

	// Retrieve or create the output data file
	let data = {
		accounts: {},
		depositors: 0,
		holders: {
			SNX: 0,
			sUSD: 0,
		},
	};
	if (!clear) {
		if (fs.existsSync(dataFile)) {
			data = JSON.parse(fs.readFileSync(dataFile));
		}
	}

	_verifyKnownBridges();

	const candidates = await _getAllAddressesThatDepositedOrMigratedEscrowOnL1({ data, toBlock, dataFile, providerUrl: providerUrlL1 });
  await _getBalancesOnL2({ data, dataFile, candidates, providerUrl: providerUrlL2 });
}

async function _getAllAddressesThatDepositedOrMigratedEscrowOnL1({ toBlock, data, dataFile, providerUrl }) {
	console.log(chalk.blue(`> Getting all addresses that triggered Deposit, DepositInitiated, or ExportedVestingEntries events in L1 with provider ${providerUrl}`));

	const provider = _getProvider({ providerUrl });

	const knownAddresses = Object.keys(knownBridges);

	const addresses = [];
	for (const bridgeAddress of knownAddresses) {
		const bridge = knownBridges[bridgeAddress];
		const { fromBlock, depositEventName, depositEventTarget, migrateEventName, migrateEventTarget, abi } = bridge;

		const contract = new ethers.Contract(bridgeAddress, abi, provider);

		// Build filter to look for logs
		// See: https://docs.ethers.io/v5/single-page/#/v5/concepts/events/-%23-events--filters
		// Notice the double array in topics. This means depositEventName OR migrateEventName
		console.log(chalk.gray(`  > Looking for ${depositEventName} and ${migrateEventName} events in bridge at ${bridgeAddress} from block ${fromBlock}`));
		const filter = {
			address: contract.address,
			topics: [_getEventTopics({ contract, eventNames: [depositEventName, migrateEventName] })],
			fromBlock: fromBlock,
			toBlock: !isNaN(toBlock) ? +toBlock : 'latest',
		};
		console.log(chalk.gray(`  > Looking for events from block ${filter.fromBlock} to block ${filter.toBlock}`));

		// Find all events from this bridge
		const logs = await provider.getLogs(filter);
		const events = _parseLogs({ contract, logs });

		// Split event types
		const depositEvents = events.filter(e => e.name === depositEventName);
		console.log(chalk.gray(`    * found ${depositEvents.length} ${depositEventName} events`));
		// Discard migration events whose tx hash exists in a deposit event
		const migrateEvents = events.filter(e => e.name === migrateEventName)
			.filter(m => !depositEvents.some(d => d.transactionHash === m.transactionHash));
		console.log(chalk.gray(`    * found ${migrateEvents.length} ${migrateEventName} events`));

		depositEvents.map(event => {
			const address = event.args[depositEventTarget].toLowerCase();
			if (!addresses.includes(address)) {
				addresses.push(address);
			}
		});

		migrateEvents.map(event => {
			const address = event.args[migrateEventTarget].toLowerCase();
			if (!addresses.includes(address)) {
				addresses.push(address);
			}
		});
	}
	console.log(chalk.gray(`  * Found ${addresses.length} unique addresses`));

	data.depositors = addresses.length;
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

	return addresses;
}

function _getEventTopics({ contract, eventNames }) {
	const allTopics = [];

	for (eventName of eventNames) {
		const topics = contract.filters[eventName]().topics;
		allTopics.push(...topics);
	}

	return allTopics;
}

function _verifyKnownBridges() {
	console.log(chalk.blue(`> Verifying known bridges`));
	const knownAddresses = Object.keys(knownBridges);
	console.log(chalk.gray(`  * Expecting ${knownAddresses.length} bridge versions with addresses: ${knownAddresses}`));

	// Recorded versions should be the ones we expect
	const { getVersions } = wrap({ network, useOvm: false, fs, path });
	const { SynthetixBridgeToOptimism: registeredBridges } = getVersions({ byContract: true, fs, path })
	const registeredAddresses = registeredBridges.map(b => b.address);
	console.log(chalk.gray(`  * Found ${registeredAddresses.length} bridge versions with addresses: ${registeredAddresses}`));
	if (registeredAddresses.toString() !== knownAddresses.toString()) {
		throw new Error('Mismatching between registered and expected bridges');
	}
}

function _parseLogs({ contract, logs }) {
	return logs.map(log =>
		Object.assign({ transactionHash: log.transactionHash, logIndex: log.logIndex }, contract.interface.parseLog(log)),
	);
}

async function _getBalancesOnL2({ data, dataFile, candidates, providerUrl }) {
	console.log(chalk.blue(`> Getting addresses balances on L2 with provider ${providerUrl}`));

	const provider = _getProvider({ providerUrl });

	const Synthetix = getContract({
		contract: 'Synthetix',
		source: 'MintableSynthetix',
		provider,
		network,
		useOvm: true,
	});
	const SynthsUSD = getContract({
		contract: 'ProxyERC20sUSD',
		source: 'Synth',
		provider,
		network,
		useOvm: true,
	});

	// Read SNX balance for each account
	for (let i = 0; i < candidates.length; i++) {
		const address = candidates[i];

		// Read from data file
		const account = data.accounts[address] || {};
		if (!account.balances) {
			account.balances = {};
		}

		// Get balances
		const balanceSNX = ethers.utils.formatEther(await Synthetix.balanceOf(address));
		const balancesUSD = ethers.utils.formatEther(await SynthsUSD.balanceOf(address));
		console.log(chalk.gray(`  > ${address} ${i}/${candidates.length} holds ${balanceSNX} SNX and ${balancesUSD} sUSD on L2`));

		data.holders.SNX++;
		data.holders.sUSD++;

		// Store in data file
		account.balances.SNX = balanceSNX;
		account.balances.sUSD = balancesUSD;
		data.accounts[address] = account;
		fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
	}
}

function _getProvider({ providerUrl }) {
	if (providerUrl) {
		return new ethers.providers.JsonRpcProvider({
			url: providerUrl,
			timeout: 120000 // 20 minutes
		});
	} else {
		return new ethers.getDefaultProvider();
	}
}

program
	.description('Calculates all accounts with a positive SNX balance in L2')
	.option('--data-file <value>', 'The json file where all output will be stored')
	.option('--provider-url-l1 <value>', 'The L1 provider to use')
	.option('--provider-url-l2 <value>', 'The L2 provider to use')
	.option('--to-block <value>', 'Final block to include in the scan', 'latest')
	.option('--clear', 'Delete previously existing data', false)
	.action(async (...args) => {
		try {
			await getAllActiveSnxHolders(...args);
		} catch (err) {
			console.error(chalk.red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
