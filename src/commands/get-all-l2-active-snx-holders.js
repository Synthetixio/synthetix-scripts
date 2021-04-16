#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');
const { gray, red } = require('chalk');
const { getContract } = require('../utils/getContract');
const { getPastEvents } = require('../utils/getEvents');

let _data, _dataFile;
let _network;

async function getAllActiveSnxHolders({
	historicalProviderUrls,
	providerUrl,
	dataFile,
	network,
	useOvm,
	clear,
}) {
	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!dataFile) throw new Error('Please specify a JSON output file');

	// Retrieve or create the output data file
	let data = {
		accounts: {},
	};
	if (!clear) {
		if (fs.existsSync(dataFile)) {
			data = JSON.parse(fs.readFileSync(dataFile));
		}
	}

	// Set globals
	_network = network;
	_data = data;
	_dataFile = dataFile;

	// Get depositors on all providers
	const allProviders = [providerUrl, ...historicalProviderUrls];
	for (providerUrl of allProviders) {
		await _getAllAddressesThatDeposited({ providerUrl });
	}

	// Read SNX balance for each account
	await _getSNXBalances({ providerUrl });

	// Read sUSD balance for each account
	await _getUSDBalances({ providerUrl });
}

async function _getSNXBalances({ providerUrl }) {
	const provider = _getProvider({ providerUrl });

	// Connect to Synthetix contract
	const Synthetix = getContract({
		contract: 'Synthetix',
		source: 'MintableSynthetix',
		provider,
		network: _network,
		useOvm: true,
	});

	// Read SNX balance for each account
	console.log(gray(`* Getting SNX balances in ${providerUrl}...`));
	const addresses = Object.keys(_data.accounts);
	_data.numSNXHolders = 0;
	for (let i = 0; i < addresses.length; i++) {
		const address = addresses[i];
		const account = _data.accounts[address];
		if (!account.balances) {
			account.balances = {};
		}

		// Get balance
		const balance = await Synthetix.balanceOf(address);
		account.balances.SNX = balance.toString();
		console.log(gray(`  > ${i}/${addresses.length} - ${address}: ${ethers.utils.formatEther(balance)} SNX`));

		// Count accounts holding
		if (balance.gt(ethers.BigNumber.from('0'))) {
			_data.numSNXHolders++;
		}

		// Store in data file
		_data.accounts[address] = account;
		fs.writeFileSync(_dataFile, JSON.stringify(_data, null, 2));
	}
}

async function _getUSDBalances({ providerUrl }) {
	const provider = _getProvider({ providerUrl });

	// Connect to sUSD contract
	const SynthsUSD = getContract({
		contract: 'ProxyERC20sUSD',
		source: 'Synth',
		provider,
		network: _network,
		useOvm: true,
	});

	// Read sUSD balance for each account
	console.log(gray(`* Getting sUSD balances in ${providerUrl}...`));
	const addresses = Object.keys(_data.accounts);
	_data.numsUSDHolders = 0;
	for (let i = 0; i < addresses.length; i++) {
		const address = addresses[i];
		const account = _data.accounts[address];
		if (!account.balances) {
			account.balances = {};
		}

		// Get balance
		const balance = await SynthsUSD.balanceOf(address);
		account.balances.sUSD = balance.toString();
		console.log(gray(`  > ${i}/${addresses.length} - ${address}: ${ethers.utils.formatEther(balance)} sUSD`));

		// Count accounts holding
		if (balance.gt(ethers.BigNumber.from('0'))) {
			_data.numsUSDHolders++;
		}

		// Store in data file
		_data.accounts[address] = account;
		fs.writeFileSync(_dataFile, JSON.stringify(_data, null, 2));
	}
}

function _getProvider({ providerUrl }) {
	if (providerUrl) {
		return new ethers.providers.JsonRpcProvider(providerUrl);
	} else {
		return new ethers.getDefaultProvider();
	}
}

async function _getAllAddressesThatDeposited({ providerUrl }) {
	const provider = _getProvider({ providerUrl });

	// Connect to bridge contract
	const SynthetixBridgeToBase = getContract({
		contract: 'SynthetixBridgeToBase',
		provider,
		network: _network,
		useOvm: true,
	});

	// Get all MintedSecondary events
	// These are emitted when a deposit is completed on L2
	// `event MintedSecondary(address indexed account, uint256 amount)`
	console.log(gray(`* Retrieving all SynthetixBridgeToBase MintedSecondary events in ${providerUrl}...`));
	const events = await getPastEvents({
		contract: SynthetixBridgeToBase,
		eventName: 'MintedSecondary',
		provider,
	});
	console.log(gray(`  > found ${events.length} events`));
	const previousNumEvents = _data.numMintedSecondaryEvents || 0;
	_data.numMintedSecondaryEvents = previousNumEvents + events.length;
	fs.writeFileSync(_dataFile, JSON.stringify(_data, null, 2));

	// Create entries for all addresses that completed a deposit
	for (event of events) {
		const account = event.args.account;
		const amount = event.args.amount;

		// Retrieve or create entry for this account
		let entry = _data.accounts[account] || {
			totalDeposited: '0',
			numDeposits: '0',
		};

		// Update entry
		entry.totalDeposited = ethers.BigNumber.from(entry.totalDeposited).add(amount).toString();
		entry.numDeposits = ethers.BigNumber.from(entry.numDeposits).add(ethers.BigNumber.from('1')).toString();

		// Update data file
		_data.accounts[account] = entry;
		fs.writeFileSync(_dataFile, JSON.stringify(_data, null, 2));
	}
}

program
	.description('Calculates all accounts with a positive SNX balance in L2')
	.option('--network <value>', 'The network to read events from')
	.option('--data-file <value>', 'The json file where all output will be stored')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('--historical-provider-urls <values...>', 'Additional providers with archived history')
	.option('--use-ovm', 'Use an Optimism chain', true)
	.option('--clear', 'Delete previously existing data', false)
	.action(async (...args) => {
		try {
			await getAllActiveSnxHolders(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
