#!/usr/bin/env node
require('dotenv').config();

const { wrap } = require('synthetix');
const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function airdropWETH({
	providerUrl,
	network,
	dataFile,
	amountToDrop,
	deploymentPath,
	wethAddress,
	gasPrice,
	yes,
}) {
	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!amountToDrop) throw new Error('Please specify the amount to airdrop to each account');
	if (isNaN(amountToDrop)) throw new Error('Invalid amount to drop');
	if (!dataFile) throw new Error('Please specify a JSON input file');
	if (!fs.existsSync(dataFile)) throw new Error(`No file at ${dataFile}`);
	if (!wethAddress) throw new Error('Please specify the target WETH address');
	if (!ethers.utils.isAddress(wethAddress)) throw new Error('Invalid WETH address');

	// Parse data
	const data = JSON.parse(fs.readFileSync(dataFile));

	// Evaluate deployment path
	const { getPathToNetwork } = wrap({
		network,
		useOvm: true,
		fs,
		path,
	});
	if (!deploymentPath) {
		deploymentPath = getPathToNetwork({ network, useOvm: true });
	}

	// Prepare provider and signer
	const privateKey = process.env.PRIVATE_KEY;
	const { wallet, provider } = setupProvider({ providerUrl, privateKey });
	const signerAddress = await wallet.getAddress();

	// Connect to contracts
	const abi = JSON.parse(fs.readFileSync('src/abis/common/ERC20.json', 'utf8'));
	const WETH = new ethers.Contract(wethAddress, abi, wallet);

	// Get a list of target addresses
	let accounts = Object.keys(data.accounts);
	console.log(`All accounts: ${accounts.length}`)

	// Filter accounts
	// More than 1 SNX
	accounts = accounts.filter(address => {
		const account = data.accounts[address];

		return ethers.BigNumber.from(account.balances.SNX).gt(ethers.utils.parseEther('1'))
	});
	console.log(`Filtered accounts: ${accounts.length}`)

	// Evaluate how much each address will need
	amountToDrop = ethers.utils.parseEther(amountToDrop);
	const toAirdrop = {};
	const zero = ethers.utils.parseEther('0');
	let totalAccountsToDropTo = 0;
	let totalWethToDrop = ethers.utils.parseEther('0');
	console.log(chalk.cyan(`1. Checking WETH balances on ${accounts.length} potential target accounts...`));
	for (let i = 0; i < accounts.length; i++) {
		const account = accounts[i];
		const accountBalance = await WETH.balanceOf(account);

		console.log(chalk.gray(`  * Checking account ${i + 1}/${accounts.length} - ${account} - ${ethers.utils.formatEther(accountBalance)} WETH`));

		let delta = amountToDrop.sub(accountBalance);
		if (delta.lte(zero)) {
			console.log(chalk.gray(`    > Account does not need any more WETH`));

			continue;
		}
		console.log(chalk.yellow(`    > Account will need ${ethers.utils.formatEther(delta)} WETH`));

		toAirdrop[account] = delta;
		totalWethToDrop = totalWethToDrop.add(delta);
		totalAccountsToDropTo++;
	}

	if (totalAccountsToDropTo === 0) {
		console.log(chalk.blue.bold('No WETH needs to be airdroped'));
		process.exit(0);
	}

	// Verify signer WETH balance
	const signerBalance = await WETH.balanceOf(signerAddress);
	if (signerBalance.lt(totalWethToDrop)) {
		throw new Error(`Signer only has ${ethers.utils.formatEther(signerBalance)} WETH, and it needs ${ethers.utils.formatEther(totalWethToDrop)} WETH.`);
	}

	// Print data and confirm before continuing
	console.log('');
	console.log(chalk.cyan('Please review this information before continuing:'));
	console.log(chalk.gray('================================================================================'));
	console.log(chalk.yellow('* network:', network));
	console.log(chalk.yellow('* provider:', providerUrl));
	console.log(chalk.yellow('* gas price:', gasPrice));
	console.log(chalk.yellow('* deployment path:', deploymentPath));
	console.log(chalk.yellow('* total accounts to drop to:', totalAccountsToDropTo));
	console.log(chalk.yellow('* target WETH weth balance for each:', ethers.utils.formatEther(amountToDrop)));
	console.log(chalk.yellow('* total WETH to be dropped:', ethers.utils.formatEther(totalWethToDrop)));
	console.log(chalk.yellow('* signer:', wallet.address));
	console.log(chalk.yellow('* signer balance:', ethers.utils.formatEther(signerBalance)));
	console.log(chalk.gray('================================================================================'));
	async function confirm() {
		if (yes) return;

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

	// Sent WETH to each
	const targets = Object.keys(toAirdrop);
	console.log(chalk.cyan(`2. Airdropping WETH to ${targets.length} accounts...`));
	for (let i = 0; i < targets.length; i++) {
		const account = targets[i];
		const amount = toAirdrop[account];

		console.log(chalk.gray(`  > Sending ${ethers.utils.formatEther(amount)} to ${account}...`));

		const tx = await WETH.transfer(account, amount);
		const receipt = await tx.wait();

		console.log(chalk.green(`  > WETH sent ${i + 1}/${targets.length}`));
	}

	console.log(chalk.blue.bold('Done.'));
}

program
	.description('Airdrops L2 WETH on a list of accounts')
	.option('--network <value>', 'Network to use', 'kovan')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('--deployment-path <value>', 'Specify the path to the deployment data directory')
	.option('--data-file <value>', 'The json file where target accounts are stored (generated by get-all-l2-active-snx-holders.js)')
	.option('--amount-to-drop <value>', 'The total amount of WETH to be airdroped to each account', '0.05')
	.option('--weth-address <value>', 'The address of the WETH token in L2')
	.option('--gas-price <value>', 'Gas price to set when performing transfers', '0')
	.option('--yes', 'Skip all confirmations', false)
	.action(async (...args) => {
		try {
			await airdropWETH(...args);
		} catch (err) {
			console.error(chalk.red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
