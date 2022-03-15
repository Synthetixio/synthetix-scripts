require('dotenv/config');
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const program = require('commander');
const createQueue = require('fastq');
const sortKeys = require('sort-keys');

const SynthetixDebtShareAbi = require('../abis/common/SynthetixDebtShare.json');

function read(filename) {
	return JSON.parse(fs.readFileSync(filename));
}

function writeDebt(filename, key, value) {
	const data = read(filename);
	data.debts[key] = value;
	fs.writeFileSync(filename, JSON.stringify(sortKeys(data), null, 2));
}

async function getAccounts(Contract, deployedBlock) {
	const events = await Contract.queryFilter(Contract.filters.Transfer(null, null, null), deployedBlock);

	// Use a Set to have implicitily unique values
	const addresses = new Set();
	for (const event of events) {
		addresses.add(event.args.to);
		addresses.add(event.args.from);
	}

	addresses.delete('0x0000000000000000000000000000000000000000');

	return Array.from(addresses);
}

async function getDebts({ Contract, blockTag, addresses, filename }) {
	const debts = {};

	let i = 0;
	const pad = addresses.length.toString().length;

	const queue = createQueue.promise(async function (address) {
		try {
			const debt = await Contract.balanceOf(address, { blockTag });

			if (debt > 0) {
				writeDebt(filename, address, debt.toString());
			}

			const index = (++i).toString().padStart(pad);
			console.log(`${index} ${address} debt: ${ethers.utils.formatEther(debt)}`);
		} catch (err) {
			console.error(`Error processing ${address}:`);
			console.error(err);
		}
	}, 15);

	for (const address of addresses) {
		queue.push(address);
	}

	await queue.drained();

	return debts;
}

async function downloadDebts({ filename, address, deployedBlock, latestBlock }) {
	const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
	const lastBlock = latestBlock || (await provider.getBlockNumber()) - 10;

	console.log(`      Provider URL: ${process.env.PROVIDER_URL}`);
	console.log(`  Deployed Address: ${address}`);
	console.log(`    Deployed Block: ${deployedBlock}`);
	console.log(`      Latest block: ${lastBlock}`);
	console.log(`              File: ${filename}`);

	const Contract = new ethers.Contract(address, SynthetixDebtShareAbi, provider);

	let addresses = await getAccounts(Contract, deployedBlock);

	console.log(`  Collected ${addresses.length} addresses`);

	// Do not get debts for addresses already fetched
	if (fs.existsSync(filename)) {
		const data = read(filename).debts;

		if (data.contractAddress !== address || data.deployedBlock !== deployedBlock || data.latestBlock !== latestBlock) {
			throw new Error('Invalid debts file');
		}

		const currentAddresses = new Set(addresses);
		for (const address of Object.keys(data.debts)) {
			currentAddresses.delete(address);
		}
		addresses = Array.from(currentAddresses);
	} else {
		fs.writeFileSync(
			filename,
			JSON.stringify(
				{
					contractAddress: address,
					deployedBlock,
					latestBlock,
					debts: {},
				},
				null,
				2,
			),
		);
	}

	await getDebts({ filename, Contract, blockTag: lastBlock, addresses });
}

program
	.description('Get all the addresses with their debts querying to the SynthetixDebtShare contract')
	.option('--address <value>', 'Contract address', '0x89FCb32F29e509cc42d0C8b6f058C993013A843F')
	.option('--deployed-block <value>', 'Block in which the contract was deployed', 14169250)
	.option('--latest-block <value>', 'Block until which to fetch data')
	.action(async ({ address, deployedBlock, latestBlock }) => {
		const filename = path.resolve(__dirname, '..', '..', 'data', `${deployedBlock}-users-debts.json`);

		try {
			await downloadDebts({ filename, address, deployedBlock, latestBlock });
		} catch (err) {
			console.error(err);
			process.exitCode = 1;
		}
	});

program.parse(process.argv);
