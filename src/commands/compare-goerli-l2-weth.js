#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');
const chalk = require('chalk');
const { getContract } = require('../utils/getContract');

async function compare({
	wethDataFile,
	snxDataFile,
	outputDataFile,
	providerUrl,
}) {
	// Validate input parameters
	if (!wethDataFile) throw new Error('Please specify a weth input data file');
	if (!snxDataFile) throw new Error('Please specify an snx input data file');
	if (!outputDataFile) throw new Error('Please specify an output data file');

	const network = 'mainnet';
	const provider = new ethers.providers.JsonRpcProvider({
		url: providerUrl,
		timeout: 120000 // 20 minutes
	});

	// Retrieve the data files
	const wethData = _getData({ dataFile: wethDataFile });
	const snxData = _getData({ dataFile: snxDataFile });

	// Get a list of accounts from each
	const wethAccounts = Object.keys(wethData.accounts).map(a => a.toLowerCase());
	const snxAccounts = Object.keys(snxData.accounts).map(a => a.toLowerCase());

	// Get a list of accounts that are in the snx list, but not in the weth list
	const missedAccounts = snxAccounts.filter(s => !wethAccounts.includes(s));
	console.log(`> Found ${missedAccounts.length} accounts that got the first SNX airdrop, but didn't get the WETH airdrop`);

	const Synthetix = getContract({
		contract: 'Synthetix',
		source: 'MintableSynthetix',
		provider,
		network,
		useOvm: true,
	});
	const SynthsUSD = getContract({
		contract: 'ProxyERC20sUSD',
		source: 'Synth',
		provider,
		network,
		useOvm: true,
	});

	const data = { accounts: {} };
	for (let i = 0; i < missedAccounts.length; i++) {
		const account = missedAccounts[i];

		const balanceSNX = ethers.utils.formatEther(await Synthetix.balanceOf(account));
		const balancesUSD = ethers.utils.formatEther(await SynthsUSD.balanceOf(account));
		console.log(chalk.gray(`  > ${account} ${i + 1}/${missedAccounts.length} holds ${balanceSNX} SNX and ${balancesUSD} sUSD on L2`));

		data.accounts[account] = {
			balances: {
				SNX: balanceSNX,
				sUSD: balancesUSD,
			}
		};

		fs.writeFileSync(outputDataFile, JSON.stringify(data, null, 2));
	}
}

function _getData({ dataFile }) {
	if (fs.existsSync(dataFile)) {
		return JSON.parse(fs.readFileSync(dataFile));
	} else {
		throw new Error(`Unable to find data file at ${dataFile}`);
	}
}

program
	.description('Compares addresses who got the first SNX airdrop with the addresses that got the first WETH airdrop')
	.option('--weth-data-file <value>', 'The json containing the weth airdrop targets')
	.option('--snx-data-file <value>', 'The json containing the snx airdrop targets')
	.option('--output-data-file <value>', 'The json file where all output will be stored')
	.option('--provider-url <value>', 'The L2 provider to use', 'https://mainnet.optimism.io')
	.action(async (...args) => {
		try {
			await compare(...args);
		} catch (err) {
			console.error(chalk.red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
