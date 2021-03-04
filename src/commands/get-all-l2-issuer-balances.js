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
	minimumBalance,
	useOvm,
}) {	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!dataFile) throw new Error('Please specify a JSON output file');
	if (isNaN(+minimumBalance)) throw new Error('Please specify a valid minimum balance');

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

	// Get SynthsUSD contract
	const SynthsUSD = getContract({
		contract: 'ProxyERC20sUSD',
		source: 'Synth',
		provider,
		network,
		useOvm,
	});

	// Get all issue events
	console.log(gray(`1) Retrieving all sUSD issue events...`));
	const events = await getPastEvents({
		contract: SynthsUSD,
		eventName: 'Issued',
		provider,
	});
	console.log(gray(`  > found ${events.length} events`));

	data.numIssueEvents = events.length;
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

	// Retrieve all addresses that issued
	const issuers = events
		.map(event => event.args.account)
		.filter((address, idx, self) => self.indexOf(address) === idx);
	console.log(gray(`  > found ${issuers.length} unique addresses in the events`));

	data.numIssuers = issuers.length;
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

	// Read sUSD balance of each account that issued
	console.log(gray(`2) Reading balance of all accounts that ever issued...`));
	if (!data.issuers) data.issuers = {};
	if (!data.total) data.total = '0';
	let total = ethers.utils.parseEther('0');
	const minimum = ethers.utils.parseEther(minimumBalance);
	data.totalIssuers = 0;
	for (let i = 0; i < issuers.length; i++) {
		const account = issuers[i];

		// Get balance
		const balance = await SynthsUSD.balanceOf(account);
		if (!balance.gt(minimum)) {
			continue;
		}

		// Count accounts with more than minimum balance
		data.totalIssuers++;
		console.log(gray(`  > Issuers: `, data.totalIssuers));

		// Accum
		total = total.add(balance);
		data.total = total.toString();

		// Stdout
		console.log(gray(`  > Issuer ${i + 1}/${issuers.length} - ${account}: ${ethers.utils.formatEther(balance)} sUSD > Total: ${ethers.utils.formatEther(total)} sUSD`));

		// Store in data file
		data.issuers[account] = balance.toString();

		// Store the data immediately
		fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
	}
}

program
	.description('Calculates all issuer balances in L2')
	.option('--network <value>', 'The network to read events from')
	.option('--data-file <value>', 'The json file where all output will be stored')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('--use-ovm', 'Use an Optimism chain', true)
	.option('--minimum-balance <value>', 'Minimum SNX balance to consider for holding', '1')
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
