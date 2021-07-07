#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');

async function compare({
	wethDataFile,
	snxDataFile,
	outputDataFile,
}) {
	// Validate input parameters
	if (!wethDataFile) throw new Error('Please specify a weth input data file');
	if (!snxDataFile) throw new Error('Please specify an snx input data file');
	if (!outputDataFile) throw new Error('Please specify an output data file');

	// Retrieve the data files
	const wethData = _getData({ dataFile: wethDataFile });
	const snxData = _getData({ dataFile: snxDataFile });

	// Get a list of accounts from each
	const wethAccounts = Object.keys(wethData.accounts).map(a => a.toLowerCase());
	const snxAccounts = Object.keys(snxData.accounts).map(a => a.toLowerCase());

	// Get a list of accounts that are in the snx list, but not in the weth list
	const missedAccounts = snxAccounts.filter(s => !wethAccounts.includes(s));
	console.log(`> Found ${missedAccounts.length} accounts that got the first SNX airdrop, but didn't get the WETH airdrop`);

	// Write data file.
	const data = { accounts: {} };
	missedAccounts.map(a => data.accounts[a] = {
		balances: {
			SNX: '',
			sUSD: '',
		}
	});
	fs.writeFileSync(outputDataFile, JSON.stringify(data, null, 2));
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
