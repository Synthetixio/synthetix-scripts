#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');
const chalk = require('chalk');
const { getRevertReason } = require('../utils/runTx');

async function getReason({
	providerUrl,
	network,
	txHash,
}) {
	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!txHash) throw new Error('Please specify a transaction hash');

	// If no provider url is set, try to deduce it
	if (!providerUrl) {
		switch (network) {
			case 'mainnet':
				providerUrl = 'https://mainnet.optimism.io';
				break;
			case 'kovan':
				providerUrl = 'https://kovan.optimism.io';
				break;
			default:
				throw new Error(`No known provider for network: ${network}. Please specify a custom provider.`);
		}
	}

	// Setup the provider
	let provider;
	if (providerUrl) {
		provider = new ethers.providers.JsonRpcProvider(providerUrl);
	} else {
		provider = new ethers.getDefaultProvider();
	}

	// Retrieve the transaction
	const tx = await provider.getTransaction(txHash);
	console.log(chalk.gray(`Transaction: ${JSON.stringify(tx, null, 2)}`));

	// Retrieve receipt
	const receipt = await provider.getTransactionReceipt(txHash);
	console.log(chalk.gray(`Receipt: ${JSON.stringify(receipt, null, 2)}`));

	// Try to retrieve the revert reason
	let reason;
	try {
		reason = await getRevertReason({ tx, provider });
	} catch (error) { console.log(error); }
	if (reason) {
		console.log(chalk.magenta.inverse(`Reason: ${reason}`));
	} else {
		console.log(chalk.red('Unable to retrieve revert reason'));
	}
}

program
	.description('Retrieves a revert reason for a failing L2 transaction')
	.option('--network <value>', 'The network to use', 'mainnet')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('--tx-hash <value>', 'The hash of the transaction that reverted')
	.action(async (...args) => {
		try {
			await getReason(...args);
		} catch (err) {
			console.error(chalk.red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
