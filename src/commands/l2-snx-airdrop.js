#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const chalk = require('chalk');
const program = require('commander');
const ethers = require('ethers');
const inquirer = require('inquirer');
const { getContract } = require('../utils/getContract');

/*
 * dataFile format:
 * {
 *   [
 *     {
	 *     "Wallet address": "0x1234...",
	 *     "SNX to pay": 50.04962378
	 *   },
 *   ]
 * }
 * */

async function airdrop({
	network,
	providerUrl,
	dataFile,
	gasPrice,
	dryRun,
}) {
	console.log(`dryRun: ${dryRun}`);

	console.log(`providerUrl: ${providerUrl}`);
	const provider = new ethers.providers.JsonRpcProvider(providerUrl);

	const privateKey = process.env.PRIVATE_KEY;
	console.log(`private key: ${privateKey}`);
	const wallet = new ethers.Wallet(privateKey, provider);
	console.log(`public key: ${wallet.address}`);

	accounts = JSON.parse(fs.readFileSync(dataFile));
	console.log(`Total ${accounts.length} accounts`);

	accounts = accounts.filter(account => !account.sent);
	console.log(`Still need to send to ${accounts.length} accounts`);

	const Synthetix = getContract({
		contract: 'ProxyERC20',
		source: 'MintableSynthetix',
		wallet,
		network,
		useOvm: true,
	});
	console.log(`Synthetix: ${Synthetix.address}`);

	const overrides = {
		gasPrice,
	};

	await _confirm();

	console.log('Starting SNX transfers...');
	for(let i = 0; i < accounts.length; i++) {
		const account = accounts[i];
		const address = account['Wallet address'];

		if (!ethers.utils.isAddress(address)) {
			console.log(`  > ${i + 1}/${accounts.length} - Invalid address ${address}`);

			const possibleAddress = _tryGetAddressFromPk({ pk: address, provider });
			if (possibleAddress) {
				console.log(`    This looks like a private key, did you mean ${possibleAddress}`);
			}

			continue;
		}

		const amount = account['SNX to pay'];
		console.log(`  > Sending ${i + 1}/${accounts.length} - ${address} for ${amount} SNX`);

		const amountParsed = ethers.utils.parseEther(`${amount}`);
		console.log(`    * Amount in wei: ${amountParsed}`);

		const balance = await Synthetix.balanceOf(address);
		console.log(`    * Account balance: ${ethers.utils.formatEther(balance)}`);

		if (!dryRun) {
			// const tx = await Synthetix.transfer(address, amountParsed, overrides);
			// const receipt = await tx.wait();

			console.log(`    * Sent ${receipt.transactionHash}`);

			account.sent = true;
			fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
		}
	}

	console.log('Done.');
}

function _tryGetAddressFromPk({ pk, provider }) {
	try {
		return new ethers.Wallet(pk, provider).address;
	} catch(err) {};
}

async function _confirm() {
	async function confirm() {
		const { confirmation } = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirmation',
				message: 'Continue?',
			},
		]);

		if (!confirmation) {
			console.log(chalk.gray('User cancelled'));
			process.exit(0);
		}
	}

	await confirm();
}

program
	.description('Transfer SNX to a set of addresses specified in a JSON file')
	.option('--network <value>', 'Network to use', 'mainnet')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain', 'https://mainnet.optimism.io')
	.option('--data-file <value>', 'The json file where target accounts are enumerated')
	.option('--gas-price <value>', 'The gas price in gwei to use on all transfers', '0.015')
	.option('--dry-run', 'Do not send any actual transfers', true)
	.action(async (...args) => {
		try {
			await airdrop(...args);
		} catch (err) {
			console.error(chalk.red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
