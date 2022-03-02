#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const { formatEther, parseUnits } = ethers.utils;
const { BigNumber } = ethers;
const { red, gray, yellow, green } = require('chalk');
const synthetix = require('synthetix');
const { sendTx, confirmTx } = require('../utils/runTx');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function fixInflationRate({
	stakedL1,
	stakedL2,
	totalSupply,
	network,
	providerUrl,
	useFork,
	privateKey,
	deploymentPath,
}) {
	console.log(gray(`Running in network: ${network}`));

	const { getUsers } = synthetix.wrap({
		network,
		fs,
		path,
	});

	let publicKey;

	if (useFork) {
		providerUrl = 'http://localhost:8545';
		if (!privateKey) {
			publicKey = getUsers({ user: 'owner' }).address;
		}
	} else if (!providerUrl && process.env.PROVIDER_URL) {
		const envProviderUrl = process.env.PROVIDER_URL;
		if (envProviderUrl.includes('infura')) {
			providerUrl = process.env.PROVIDER_URL.replace('network', network);
		} else {
			providerUrl = envProviderUrl;
		}
	}

	if (!privateKey && process.env.PRIVATE_KEY) {
		privateKey = process.env.PRIVATE_KEY;
	}

	if (!providerUrl) throw new Error('Cannot set up a provider.');

	const { wallet, provider } = await setupProvider({ providerUrl, privateKey, publicKey });

	console.log(gray('Using wallet with address'), yellow(wallet.address));

	// Evaluate deployment path
	const { getPathToNetwork } = synthetix.wrap({
		network,
		useOvm: false,
		fs,
		path,
	});

	if (!deploymentPath) {
		deploymentPath = getPathToNetwork({ network, useOvm: false });
	}

	console.log(gray('Deployment path'), yellow(deploymentPath));

	const supplySchedule = await getContract({
		contract: 'SupplySchedule',
		network,
		deploymentPath,
		provider,
	});

	const synthetixContract = await getContract({
		contract: 'Synthetix',
		network,
		deploymentPath,
		provider,
	});

	const rewardsDistribution = await getContract({
		contract: 'RewardsDistribution',
		network,
		deploymentPath,
		provider,
	});

	const synthetixBridgeToOptimism = await getContract({
		contract: 'SynthetixBridgeToOptimism',
		network,
		deploymentPath,
		provider,
	});

	let accounts;

	const executeTxn = async ({ txPromise }) => {
		console.log(gray(`  > Staging transaction... ${new Date()}`));
		let result = await sendTx({
			txPromise,
			provider,
		});

		if (result.success) {
			console.log(gray(`  > Sending transaction... ${result.tx.hash}`));

			result = await confirmTx({
				tx: result.tx,
				provider,
			});

			if (result.success) {
				console.log(green('Success. Gas used', result.success.receipt));
			} else {
				throw new Error(`Cannot transact. Reason: "${result.error.reason}"`);
			}
		} else {
			throw new Error(`Cannot stage: ${result.error}`);
		}
	};

	const overrides = {
		// gasPrice: parseUnits(gasPrice, 'gwei'),
		// gasLimit: 10e6,
	};

	const inflationAmount = await supplySchedule.inflationAmount();
	let bnTotalSupply, bnStakedL1, bnStakedL2;

	if (totalSupply) {
		bnTotalSupply = BigNumber.from(totalSupply) * 1e18;
	} else {
		bnTotalSupply = await synthetixContract.totalSupply();
	}

	if (stakedL1) {
		bnStakedL1 = BigNumber.from(stakedL1) * 1e18;
	} else {
		// TODO Get stakedL1
		console.log('not implemented');
		return;
	}

	if (stakedL2) {
		bnStakedL2 = BigNumber.from(stakedL2) * 1e18;
	} else {
		// TODO Get stakedL1
		console.log('not implemented');
		return;
	}

	const stakedRatio = (bnStakedL1 + bnStakedL2) / bnTotalSupply;

	let weeklyInflationCorrection;
	let isPositive = false;
	if (stakedRatio < 0.8) {
		weeklyInflationCorrection = inflationAmount.mul(10).div(100);
		isPositive = true;
	} else if (stakedRatio > 0.9) {
		weeklyInflationCorrection = inflationAmount.mul(10).div(100);
		isPositive = false;
	} else {
		weeklyInflationCorrection = inflationAmount.mul(5).div(100);
		isPositive = false;
	}

	const weeklyInflation = isPositive
		? inflationAmount.add(weeklyInflationCorrection)
		: inflationAmount.sub(weeklyInflationCorrection);

	const l2Distribution = weeklyInflation.mul(30).div(100);

	console.log(gray('Total Supply'), yellow(formatEther(bnTotalSupply), 'SNX'));
	console.log(gray('Staked in L1'), yellow(stakedL1.toString(), 'SNX'));
	console.log(gray('Staked in L2'), yellow(stakedL2.toString(), 'SNX'));

	console.log(gray('Inflation Amount'), yellow(formatEther(inflationAmount), 'SNX'));
	console.log(gray('Staked Ratio'), yellow(+stakedRatio * 100, '%'));
	console.log(gray('Weekly Inflation'), yellow(formatEther(weeklyInflation), 'SNX'));
	console.log(gray('L2 Distribution'), yellow(formatEther(l2Distribution), 'SNX'));

	console.log(gray('Tx to stage'), yellow(`SupplySchedule.setInflationAmount(${weeklyInflation.toString()})`));
	console.log(
		gray('Tx to stage'),
		yellow(
			`RewardsDistribution.editRewardDistribution(2, ${
				synthetixBridgeToOptimism.address
			}, ${l2Distribution.toString()})`,
		),
	);

	// TODO Prepare and stage a transaction in the safe
	// supplySchedule.setInflationAmount(weeklyInflation);
	// rewardsDistribution.editRewardDistribution(2, synthetixBridgeToOptimism.address(), l2Distribution);
	return;
}

program
	.description('Fix the inflation rate based on Target Staked Ratio (SIP 202)')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('-m, --staked-l1 <value>', 'L1 Total SNX Staked')
	.option('-o, --staked-l2 <value>', 'L2 Total SNX Staked')
	.option('-t, --total-supply <value>', 'Total Supply')

	.option('-d, --deployment-path <value>', 'Deployment path')
	.option('-k, --private-key <value>', 'Private key to use to sign txs')
	.option('-r, --dry-run', 'Run as a dry-run', false)

	.action(async (...args) => {
		try {
			await fixInflationRate(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
