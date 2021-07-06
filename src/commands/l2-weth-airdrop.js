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
	yes,
	minSUSD,
	minSNX,
	gasPrice,
}) {
	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!amountToDrop) throw new Error('Please specify the amount to airdrop to each account');
	if (isNaN(amountToDrop)) throw new Error('Invalid amount to drop');
	if (isNaN(gasPrice)) throw new Error('Invalid gas price');
	if (!dataFile) throw new Error('Please specify a JSON input file');
	if (!fs.existsSync(dataFile)) throw new Error(`No file at ${dataFile}`);
	if (!wethAddress) throw new Error('Please specify the target WETH address');
	if (!ethers.utils.isAddress(wethAddress)) throw new Error('Invalid WETH address');
	if (!minSUSD || isNaN(minSUSD)) throw new Error('Invalid minSUSD');
	if (!minSNX || isNaN(minSNX)) throw new Error('Invalid minSNX');

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

	// Filter accounts by min balances
	if (+minSNX > 0) {
		accounts = accounts.filter(address => {
			const account = data.accounts[address];
			return ethers.utils.parseEther(account.balances.SNX).gte(ethers.utils.parseEther(minSNX))
		});
	}
	if (+minSUSD > 0) {
		accounts = accounts.filter(address => {
			const account = data.accounts[address];
			return ethers.utils.parseEther(account.balances.sUSD).gte(ethers.utils.parseEther(minSUSD))
		});
	}

	// Check how many accounts still need to be sent ETH
	accounts = accounts.filter(address => {
		const account = data.accounts[address];
		return !account.sent;
	});
	console.log(`Filtered accounts: ${accounts.length}`)

	if (accounts.length === 0) {
		console.log(chalk.blue.bold('No WETH needs to be airdroped'));
		process.exit(0);
	}

	// Evaluate how much each address will need
	amountToDrop = ethers.utils.parseEther(amountToDrop);
	const totalWethToDrop = amountToDrop.mul(accounts.length);

	// Print data and confirm before continuing
	console.log('');
	console.log(chalk.cyan('Please review this information before continuing:'));
	console.log(chalk.gray('================================================================================'));
	console.log(chalk.yellow('* network:', network));
	console.log(chalk.yellow('* provider:', providerUrl));
	console.log(chalk.yellow('* gas price:', gasPrice, ' gwei'));
	console.log(chalk.yellow('* deployment path:', deploymentPath));
	console.log(chalk.yellow('* total accounts to drop to:', accounts.length));
	console.log(chalk.yellow('* target WETH weth balance for each:', ethers.utils.formatEther(amountToDrop)));
	console.log(chalk.yellow('* total WETH to be dropped:', ethers.utils.formatEther(totalWethToDrop)));
	console.log(chalk.yellow('* signer:', wallet.address));
	console.log(chalk.yellow('* signer balance:', ethers.utils.formatEther(await WETH.balanceOf(wallet.address))));
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

	// Verify signer WETH balance
	const signerBalance = await WETH.balanceOf(signerAddress);
	if (signerBalance.lt(totalWethToDrop)) {
		throw new Error(`Signer only has ${ethers.utils.formatEther(signerBalance)} WETH, and it needs ${ethers.utils.formatEther(totalWethToDrop)} WETH.`);
	}

	// Sent WETH to each
	const overrides = {
		gasPrice: ethers.utils.parseUnits(gasPrice, 'gwei'),
	};
	console.log(chalk.cyan(`2. Airdropping WETH to ${accounts.length} accounts...`));
	for (let i = 0; i < accounts.length; i++) {
		const account = accounts[i];

		console.log(chalk.gray(`  > Sending ${ethers.utils.formatEther(amountToDrop)} to ${account}...`));

		// const tx = await WETH.transfer(account, amountToDrop, overrides);
		// const receipt = await tx.wait();

		account.sent = true;
		fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

		console.log(chalk.green(`  > WETH sent ${i + 1}/${targets.length}`));
	}

	console.log(chalk.blue.bold('Done.'));
}

program
	.description('Airdrops L2 WETH on a list of accounts')
	.option('--network <value>', 'Network to use', 'mainnet')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain', 'https://mainnet.optimism.io')
	.option('--deployment-path <value>', 'Specify the path to the deployment data directory')
	.option('--data-file <value>', 'The json file where target accounts are stored (generated by get-all-l2-active-snx-holders.js)')
	.option('--amount-to-drop <value>', 'The total amount of WETH to be airdroped to each account', '0.01')
	.option('--weth-address <value>', 'The address of the WETH token in L2', '0x4200000000000000000000000000000000000006')
	.option('--min-SNX <value>', 'The minimum amount of SNX on L2 for airdrop eligibility', '1')
	.option('--min-sUSD <value>', 'The minimum amount of sUSD on L2 for airdrop eligibility', '1')
	.option('--gas-price <value>', 'The gas price to use on all transfers', '0')
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
