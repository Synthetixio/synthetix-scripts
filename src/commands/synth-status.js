#!/usr/bin/env node

require('dotenv').config();
const program = require('commander');

const { gray, red } = require('chalk');
const { toUtf8String } = require('ethers').utils;
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

	await Promise.all(currencyKeys.map(async currencyKey => {
		const currency = toUtf8String(currencyKey);
		const status = await SystemStatus.synthSuspension(currencyKey);
		const exchangeStatus = await SystemStatus.synthExchangeSuspension(currencyKey);
		const suspended = status[0];
		const reason = status[1];
		const exchangeSuspended = exchangeStatus[0];
		const exchangeReason = exchangeStatus[1];

		if (!!!suspended && !!! exchangeSuspended) {
			console.log(gray(`${currency} ${currencyKey.substr(0, 10)} - Suspended: ${suspended}, Exchange suspended: ${exchangeSuspended}`));
		} else {
			console.log(red(`${currency} ${currencyKey.substr(0, 10)} - Suspended: ${suspended} (${reason}), Exchange suspended: ${exchangeSuspended} (${exchangeReason})`));
		}
	}));
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
