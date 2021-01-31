#!/usr/bin/env node

require('dotenv').config();

const program = require('commander');

const { green, cyan, red, bgRed } = require('chalk');
const { formatEther, formatBytes32String, toUtf8String } = require('ethers').utils;
const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function synthStatus({ network, useOvm, providerUrl, useFork, deploymentPath }) {
	if (!providerUrl && process.env.PROVIDER_URL) {
		providerUrl = process.env.PROVIDER_URL.replace('network', network);
	}

	if (useFork) {
		providerUrl = 'http://localhost:8545';
	}

	const { provider } = setupProvider({ providerUrl });

	console.log('Info');

	console.log('Network', network);
	console.log('Deployment', deploymentPath);
	console.log('Optimism', useOvm);
	console.log('Provider', providerUrl);
	console.log('');

	const Issuer = getContract({
		contract: 'Issuer',
		network,
		useOvm,
		provider,
		deploymentPath,
	});
	const currencyKeys = await Issuer.availableCurrencyKeys();

	const SystemStatus = getContract({
		contract: 'SystemStatus',
		network,
		useOvm,
		provider,
		deploymentPath,
	});

	for (let i = 0; i < currencyKeys.length; i++) {
		const currencyKey = currencyKeys[i];
		const currency = toUtf8String(currencyKey);
		const status = await SystemStatus.synthSuspension(currencyKey);

		console.log(`${currency} ${currencyKey.substr(0, 10)} - Suspended: ${status}`);
	}
}

program
	.description('Query state of the system on any network')
	.option('-f, --use-fork', 'Use a local fork', false)
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('-y, --deployment-path <value>', 'Specify the path to the deployment data directory')
	.option('-z, --use-ovm', 'Use an Optimism chain', false)
	.action(async (...args) => {
		try {
			await synthStatus(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
