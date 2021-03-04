#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');
const { gray, red } = require('chalk');
const { getContract } = require('../utils/getContract');
const { getPastEvents } = require('../utils/getEvents');

async function getIssuerBalances({
	providerUrl,
	dataFile,
	network,
	useOvm,
}) {	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!dataFile) throw new Error('Please specify a JSON output file');

	// Retrieve the output data file
	// Create the file if it doesn't exist
	let data;
	if (fs.existsSync(dataFile)) {
		data = JSON.parse(fs.readFileSync(dataFile));
	} else {
		data = {};
	}

	// Setup the provider
	let provider;
	if (providerUrl) {
		provider = new ethers.providers.JsonRpcProvider(providerUrl);
	} else {
		provider = new ethers.getDefaultProvider();
	}

	const currentBlock = await provider.getBlock();
	console.log('Current block:', currentBlock.number);
	data.blockNumebr = currentBlock.number;
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

	const SynthetixBridgeToBase = getContract({
		contract: 'SynthetixBridgeToBase',
		provider,
		network,
		useOvm,
	});
// Get all minted secondary events
	console.log(gray(`1) Retrieving all SynthetixBridgeToBase MintedSecondary events...`));
	const events = await getPastEvents({
		contract: SynthetixBridgeToBase,
		eventName: 'MintedSecondary',
		provider,
	});
	console.log(gray(`  > found ${events.length} events`));

	data.numMintedSecondaryEvents = events.length;
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

	// Retrieve all addresses that deposited
	const depositors = events
		.map(event => event.args.account)
		.filter((address, idx, self) => self.indexOf(address) === idx);
	console.log(gray(`  > found ${depositors.length} unique addresses in the events`));

	data.numDepositors = depositors.length;
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

	const Synthetix = getContract({
		contract: 'Synthetix',
		source: 'MintableSynthetix',
		provider,
		network,
		useOvm,
	});

	// Read sUSD balance of each account that issued
	console.log(gray(`2) Reading balance of all accounts that ever deposited, and storing accounts with a balance greater than zero SNX...`));
	if (!data.depositors) data.depositors = {};
	if (!data.total) data.total = '0';
	let total = ethers.utils.parseEther('0');
	data.totalHolders = 0;
	const minimum = ethers.utils.parseEther('0');
	for (let i = 0; i < depositors.length; i++) {
		const account = depositors[i];

		// Get balance
		const balance = await Synthetix.balanceOf(account);
		if (!balance.gt(minimum)) {
			continue;
		}

		// Count accounts with more than minimum balance
		data.totalHolders++;
		console.log(gray(`  > Holders: `, data.totalHolders));

		// Accum
		total = total.add(balance);
		data.total = total.toString();

		// Stdout
		console.log(gray(`  > Depositor ${i + 1}/${depositors.length} - ${account}: ${ethers.utils.formatEther(balance)} SNX > Total: ${ethers.utils.formatEther(total)} SNX`));

		// Store in data file
		data.depositors[account] = balance.toString();

		// Store the data immediately
		fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
	}
}

program
	.description('Calculates all accounts with a positive SNX balance in L2')
	.option('--network <value>', 'The network to read events from')
	.option('--data-file <value>', 'The json file where all output will be stored')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('--use-ovm', 'Use an Optimism chain', true)
	.action(async (...args) => {
		try {
			await getIssuerBalances(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
