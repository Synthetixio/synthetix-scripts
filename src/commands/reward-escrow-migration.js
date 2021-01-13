#!/usr/bin/env node

//  fetch all reward escrow holdres

//  for each

//    if RewardEscrowV2.totalBalancePendingMigration(account) > 0 || totalEscrowedAccountBalance > 0 then already imported

//    else add to list

//  in batches of 500

//      invoke RewardEscrowV2.migrateAccountEscrowBalances(accounts, escrowBalances, vestedBalances)

//  now for
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const program = require('commander');
const { red, gray, yellow } = require('chalk');
const synthetix = require('synthetix');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function rewardEscrowMigration({
	network,
	providerUrl,
	dryRun,
	accountJson,
	useFork,
	privateKey,
	// contractName,
	// sourceName,
	// eventName,
	// fromBlock,
	// toBlock,
	// dedup,
}) {
	console.log(gray(`Running in network: ${network}`));

	const accounts = JSON.parse(fs.readFileSync(accountJson));

	console.log(gray('Found'), yellow(accounts.length), gray('accounts'));

	const { getUsers } = synthetix.wrap({
		network,
		// useOvm,
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
	const oldRewardEscrow = await getContract({
		contract: 'RewardEscrow',
		network,
		provider,
	});

	const newRewardEscrow = await getContract({
		contract: 'RewardEscrowV2',
		network,
		wallet,
	});

	let x = 0;

	const accountsWithDetail = [];
	for (const { address } of accounts) {
		const alreadyMigratedPendingVestedImport = +(await newRewardEscrow.totalBalancePendingMigration(address)) > 0;
		const alreadyEscrowed = +(await newRewardEscrow.totalEscrowedAccountBalance(address)) > 0;
		const numVestingEntries = +(await newRewardEscrow.numVestingEntries(address));

		if (alreadyMigratedPendingVestedImport) {
			console.log(gray('Note:'), yellow(address), gray('already migrated pending entry import'));
		} else if (alreadyEscrowed) {
			console.log(gray('Note:'), yellow(address), gray('escrow amounts already exist'));
		}

		const [balance, vested, flatSchedule] = await Promise.all([
			oldRewardEscrow.totalEscrowedAccountBalance(address),
			oldRewardEscrow.totalVestedAccountBalance(address),
			oldRewardEscrow.checkAccountSchedule(address),
		]);

		const schedule = [];
		for (let i = 0; i < flatSchedule.length; i += 2) {
			const [timestamp, entry] = flatSchedule.slice(i).map(_ => _.toString());
			if (timestamp === '0' && entry === '0') {
				continue;
			} else if (timestamp === '0' || entry === '0') {
				console.log(
					red('Warning: address'),
					yellow(address),
					red('has'),
					yellow(flatSchedule),
					red('entries! One is 0'),
				);
			}
			schedule.push({
				timestamp,
				entry,
			});
		}
		accountsWithDetail.push({
			address,
			balance: balance.toString(),
			vested: vested.toString(),
			schedule,
			pending: alreadyMigratedPendingVestedImport,
			hasEscrowBalance: alreadyEscrowed,
			numVestingEntries,
		});

		x++;
		if (x > 10) break;
	}

	const migrationPageSize = 500;
	const accountsToMigrate = accountsWithDetail.filter(({ pending, hasEscrowBalance }) => !pending && !hasEscrowBalance);

	// Do the migrateAccountEscrowBalances() in large batches
	for (let i = 0; i < accountsToMigrate.length; i += migrationPageSize) {
		const accounts = accountsToMigrate.slice(i, i + migrationPageSize);
		console.log(gray('Migrating'), yellow(accounts.length), 'accounts');
		if (dryRun) {
			console.log(gray('[DRY-RUN] Migrating', require('util').inspect(accounts, false, null, true)));
		}
		await newRewardEscrow.migrateAccountEscrowBalances(
			accounts.map(({ address }) => address),
			accounts.map(({ balance }) => balance),
			accounts.map(({ vested }) => vested),
		);
	}

	// Now take all the vesting entries and flatten them
	let accountsToImportVestingEntries = [];

	for (const { address, schedule, numVestingEntries } of accountsWithDetail) {
		if (numVestingEntries !== schedule.length) {
			console.log(
				red('Warning: address '),
				yellow(address),
				red('already has'),
				yellow(numVestingEntries),
				red('instead of'),
				yellow(schedule.length),
			);
			continue;
		}
		accountsToImportVestingEntries = accountsToImportVestingEntries.concat(
			schedule.map(_ => Object.assign({ address }, _)),
		);
	}

	// and do batch inserts of these entries
	const entryBatchSize = 200;
	for (let i = 0; i < accountsToImportVestingEntries.length; i += entryBatchSize) {
		const entries = accountsToImportVestingEntries.slice(i, i + entryBatchSize);
		console.log(gray('Importing vesting entries'), yellow(entries.length));
		if (dryRun) {
			console.log(gray('[DRY-RUN] Importing', require('util').inspect(entries, false, null, true)));
		} else {
			await newRewardEscrow.importVestingSchedule(
				entries.map(({ address }) => address),
				entries.map(({ timestamp }) => timestamp),
				entries.map(({ entry }) => entry),
			);
		}
	}
}

program
	.description('Reward Escrow Migration')
	.requiredOption('-a, --account-json <value>', 'The accounts that hold')
	.option('-f, --use-fork', 'Use a local fork', false)
	.option('-k, --private-key <value>', 'Private key to use to sign txs')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('-r, --dry-run', 'Run as a dry-run', false)
	.action(async (...args) => {
		try {
			await rewardEscrowMigration(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
