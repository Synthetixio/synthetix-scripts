#!/usr/bin/env node
require('dotenv').config();

const { wrap } = require('synthetix');
const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const inquirer = require('inquirer');
const { cyan, gray, green, yellow, red } = require('chalk');
const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function distributeSNX({
	providerUrl,
	network,
	dataFile,
	totalRewards,
	deploymentPath,
	gasPrice,
	yes,
	dryRun,
}) {
	// Validate input parameters
	if (!network) throw new Error('Please specify a network');
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!totalRewards) throw new Error('Please specify the total amount of SNX rewards to be distributed');
	if (isNaN(totalRewards)) throw new Error('Invalid total rewards');
	if (!dataFile) throw new Error('Please specify a JSON input file');
	if (!fs.existsSync(dataFile)) throw new Error(`No file at ${dataFile}`);

	// Parse data
	const data = JSON.parse(fs.readFileSync(dataFile));

	// Calculate the reward multiplier
	// 1 escrowed SNX does not necessarily translate 1 rewarded SNX. For example,
	// if 100000 SNX is to be rewarded, and 200000 SNX were escrowed, each escrowed SNX
	// corresponds to 0.5 rewarded SNX.
	const k = ethers.BigNumber.from('1000000');
	const totalRewardsWei = ethers.utils.parseEther(totalRewards);
	const rewardMultiplier = k.mul(totalRewardsWei).div(ethers.BigNumber.from(data.totals.totalEscrowedSNX));

	// Track distribution info in the data file
	if (!data.totals.distributedSNX) data.totals.distributedSNX = '0';
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

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

	// Prepare contracts and signer
	const privateKey = process.env.PRIVATE_KEY;
	const { wallet, provider } = setupProvider({ providerUrl, privateKey });
	const Synthetix = getContract({
		contract: 'ProxyERC20',
		source: 'MintableSynthetix',
		wallet,
		network,
		useOvm: true,
	});

	// Prepare tx params
	const overrides = {
		gasPrice: ethers.utils.parseUnits(gasPrice, 'gwei'),
		gasLimit: 5000000,
	};

	// Verify that the signer has enough balance
	const pendingToDistribute = ethers.utils.parseEther(totalRewards).sub(
		ethers.BigNumber.from(data.totals.distributedSNX)
	);
	const signerBalance = await Synthetix.balanceOf(wallet.address);
	if (!dryRun) {
		if (signerBalance.lt(pendingToDistribute)) {
			throw new Error(red(`${pendingToDistribute} SNX need to be distributed and the signer only has ${signerBalance}`));
		}
	}

	// Print data and confirm before continuing
	console.log('');
	console.log(cyan('Please review this information before continuing:'));
	console.log(gray('================================================================================'));
	console.log(yellow('* network:', network));
	console.log(yellow('* provider:', providerUrl));
	console.log(yellow('* gas price:', gasPrice));
	console.log(yellow('* deployment path:', deploymentPath));
	console.log(yellow('* Target accounts:', data.totals.accountsThatWithdrew));
	console.log(yellow('* SNX to be rewarded:', totalRewards));
	console.log(yellow('* SNX already distributed:', ethers.utils.formatEther(data.totals.distributedSNX)));
	console.log(yellow('* SNX pending to be distributed:', ethers.utils.formatEther(pendingToDistribute)));
	console.log(yellow('* SNX in escrow:', ethers.utils.formatEther(data.totals.totalEscrowedSNX)));
	console.log(yellow('* reward multiplier:', ethers.utils.formatUnits(rewardMultiplier, 'mwei')));
	console.log(yellow('* Signer:', wallet.address));
	console.log(yellow('* Signer balance:', ethers.utils.formatEther(signerBalance)));
	console.log(yellow('* DRY RUN:', dryRun));
	console.log(gray('================================================================================'));
	console.log('\n');
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
			console.log(gray('User cancelled'));
			process.exit(0);
		}
	}
	await confirm();

	// Sweep all accounts
	const mismatchers = [];
	const accounts = Object.keys(data.accounts);
	const numAccounts = accounts.length;
	for (let i = 0; i < numAccounts; i++) {
		const account = accounts[i];
		console.log(gray(`  > Processing account ${i + 1}/${numAccounts} - ${account}`));

		const distributed = data.accounts[account].distributedSNX;
		const escrowed = data.accounts[account].escrowedSNX;
		const balance = await Synthetix.balanceOf(account);
		console.log(gray(`    > distributed: ${distributed}`));
		console.log(gray(`    > escrowed: ${escrowed}`));
		console.log(gray(`    > balance: ${balance}`));

		if (balance.toString() !== '0' && distributed === '0') {
			console.log(yellow(`WARNING: account has a positive balance and has not been distributed to yet!`));
			await confirm();
		}

		if (distributed === '0' && escrowed !== '0' && balance.toString() === '0') {
			const rewardAmount = ethers.BigNumber.from(data.accounts[account].escrowedSNX).mul(rewardMultiplier).div(k);
			console.log(yellow(`    ⮑  Sending ${ethers.utils.formatEther(rewardAmount)} SNX...`));

			if (dryRun) continue;

			const tx = await Synthetix.transfer(account, rewardAmount, overrides); const receipt = await tx.wait();

			if (!receipt) {
				console.log(red(`    > Error while sending SNX!`));
				await confirm();

				continue;
			}

			const newBalance = await Synthetix.balanceOf(account);
			console.log(gray(`    > new balance: ${newBalance.toString()}`));

			console.log(green(`    > Succesfully sent SNX`));

			data.accounts[account].tx = receipt.transactionHash;
			data.accounts[account].distributedSNX = `${rewardAmount}`;
			data.totals.distributedSNX = ethers.BigNumber.from(data.totals.distributedSNX).add(rewardAmount).toString();

			fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

			if (!newBalance.eq(rewardAmount)) {
				console.log(yellow(`WARNING: New account balance is unexpected!`));
				await confirm();

				continue;
			}
		} else if(escrowed !== '0') {
			if (balance.toString() === distributed) {
				console.log(gray(`    > balance checks`));
			} else {
				mismatchers.push(account);
				console.log(red(`    > Balance mismatch!`));
			}
		}
	}

	console.log(green(`> DONE!`));
	console.log(gray(`mismatchers: ${mismatchers.length}`, mismatchers));
}

program
	.description('Distributes L2 trial SNX rewards accourding to calculated scores')
	.option('--network <value>', 'Network to use', 'kovan')
	.option('--provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('--deployment-path <value>', 'Specify the path to the deployment data directory')
	.option('--data-file <value>', 'The json file where target accounts are stored (generated by calculate-l2-trial-scores.js)')
	.option('--total-rewards <value>', 'The total amount of SNX to be distributed', '200000')
	.option('--gas-price <value>', 'Gas price to set when performing transfers', '0')
	.option('--yes', 'Skip all confirmations', false)
	.option('--dry-run', 'Avoids sending any transaction', false)
	.action(async (...args) => {
		try {
			await distributeSNX(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
