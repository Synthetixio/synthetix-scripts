#!/usr/bin/env node

const fs = require('fs');
const { wrap } = require('synthetix');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const { gray, red } = require('chalk');
const { getPastEvents } = require('../utils/getEvents');
const { getContract } = require('../utils/getContract');

async function calculateScores({
	providerUrl,
	outputFile,
}) {
	// Validate input parameters
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!outputFile) throw new Error('Please specify a JSON output file');

	// Retrieve the output data file
	// Create the file if it doesn't exist
	let data;
	if (fs.existsSync(outputFile)) {
		data = JSON.parse(fs.readFileSync(outputFile));
	} else {
		data = {
			totals: {
				escrowedSNX: '0',
				numWithdrawers: '0',
				numEscrowsChecked: '0',
			},
			accounts: {}
		};
	}

	// Setup common constants
	const network = 'goerli';
	const useOvm = true;
	const contract = 'SynthetixBridgeToBase';
	const eventName = 'WithdrawalInitiated';

	// Setup the provider
	let provider;
	if (providerUrl) {
		provider = new ethers.providers.JsonRpcProvider(providerUrl);
	} else {
		provider = new ethers.getDefaultProvider();
	}

	// Get a list of SynthetixBridgeToBase versions that emit WithdrawalInitiated events
	const { getVersions, getSource } = wrap({ network, useOvm, fs, path });
	const versions = getVersions({ network, useOvm, byContract: true, fs, path })[contract];

	// Look for WithdrawalInitiated events on all SynthetixBridgeToBase versions
	console.log(gray(`1) Looking for WithdrawalInitiated events in ${versions.length} versions of SynthetixBridgeToBase...`));
	let allEvents = [];
	for (let i = 0; i < versions.length; i++) {
		// Get version
		const version = versions[i];
		console.log(gray(`  > Version ${i}:`));
		console.log(gray(`    > release: ${version.release}`));
		console.log(gray(`    > tag: ${version.tag}`));
		console.log(gray(`    > commit: ${version.commit}`));
		console.log(gray(`    > date: ${version.date}`));
		console.log(gray(`    > address: ${version.address}`));

		// Connect to the version's SynthetixBridgeToBase contract
		const source = getSource({ contract, network, useOvm });
		const SynthetixBridgeToBase = new ethers.Contract(version.address, source.abi, provider);

		// Fetch WithdrawalInitiated events emitted from the contract
		const events = await getPastEvents({
			contract: SynthetixBridgeToBase,
			eventName,
			provider,
		});
		console.log(gray(`    > events found: ${events.length}`));

		allEvents = allEvents.concat(events);
	}

	// Retrieve all addresses that initiated a withdrawal
	const withdrawers = allEvents.map(event => event.args.account);
	const numWithdrawers = withdrawers.length;
	data.totals.numWithdrawers = numWithdrawers;
	fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

	// Connect to the RewardEscrow contract
	const RewardEscrow = getContract({
		contract: 'RewardEscrow',
		provider,
		network,
		useOvm,
	});

	// Read escrowed SNX amount for each account, and store it in the data file
	console.log(gray(`2) Checking escrowed SNX for each account that withdrew...`));
	data.totals.numEscrowsChecked = 0;
	for (let i = 0; i < numWithdrawers; i++) {
		const account = withdrawers[i];
		console.log(gray(`  > ${i + 1}/${numWithdrawers} - ${account}`));
		data.totals.numEscrowsChecked++;

		// Read escrowed amount if there is no entry
		if (!data.accounts[account]) {
			const escrowed = await RewardEscrow.balanceOf(account);
			console.log(`    > Escrowed: ${ethers.utils.formatEther(escrowed)} SNX`);

			data.accounts[account] = escrowed.toString();
			data.totals.escrowedSNX = ethers.BigNumber.from(data.totals.escrowedSNX).add(escrowed).toString();
		}

		// Store the data immediately
		fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
	}
}

program
	.description('Calculates L2 trial scores and outputs them in a JSON file')
	.option('--output-file <value>', 'The json file where all output will be stored')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.action(async (...args) => {
		try {
			await calculateScores(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
