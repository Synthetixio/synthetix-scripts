#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const { gray, red } = require('chalk');
const { wrap } = require('synthetix');
const { getPastEvents } = require('../utils/getEvents');

async function calculateScores({
	providerUrl,
	outputFile,
}) {
	// Validate input parameters
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!outputFile) throw new Error('Please specify a JSON output file');
	if (!fs.existsSync(outputFile)) throw new Error(`No JSON file at ${outputFile}`);

	// Retrieve the output data file
	// let data = JSON.parse(fs.readFileSync(outputFile));

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

	// For each SynthetixBridgeToBase version
	for (let i = 0; i < versions.length; i++) {
		// Get version
		const version = versions[i];
		console.log(gray(`> Looking for WithdrawalInitiated events emitted from SynthetixBridgeToBase at ${version.address}, deployed as part of the "${version.release}" release (Synthetix v${version.tag}), on ${version.date}...`));

		// Connect to the version's SynthetixBridgeToBase contract
		const source = getSource({ contract, network, useOvm });
		const SynthetixBridgeToBase = new ethers.Contract(version.address, source.abi, provider);

		// Fetch WithdrawalInitiated events emitted from the contract
		const events = await getPastEvents({
			contract: SynthetixBridgeToBase,
			eventName,
			provider,
		});

		console.log(events);
	}


	// function getSynthetixBridgeToBase({ address }) {

	// }

	// const SynthetixBridgeToBase = getContract({
	// 	contract: 'SynthetixBridgeToBase',
	// 	network: 'goerli',
	// 	useOvm: true,
	// });

	// console.log(await SynthetixBridgeToBase.resolverAddressesRequired());
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
