#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');

async function exportCSV({
	dataFile,
}) {
	// Validate input parameters
	if (!dataFile) throw new Error('Please specify a JSON output file');

	// Retrieve input data file
	let data;
	if (fs.existsSync(dataFile)) {
		data = JSON.parse(fs.readFileSync(dataFile));
	} else {
		throw new Error(`Unable to find data file at ${dataFile}`);
	}

	// Parse everything onto this string
	let str = '';

	// Parse accounts
	str += '\n';
	str += 'account,SNX,sUSD\n';
	const addresses = Object.keys(data.accounts);
	for (let address of addresses) {
		const account = data.accounts[address];

		const SNX = account.balances.SNX;
		const sUSD = account.balances.sUSD;

		str += `${address},${SNX},${sUSD}\n`;
	}

	// Retrieve output data file
	const outputDataFile = dataFile.replace('.json', '.csv');
	fs.writeFileSync(outputDataFile, str);
}

program
	.description('Parses a json file into a csv file')
	.option('--data-file <value>', 'The json file where all output will be stored')
	.action(async (...args) => {
		try {
			await exportCSV(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
