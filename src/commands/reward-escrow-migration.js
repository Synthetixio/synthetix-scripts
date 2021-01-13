#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const { red, gray, yellow } = require('chalk');
const synthetix = require('synthetix');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');
const { getPastEvents } = require('../utils/getEvents');

async function rewardEscrowMigration({ network, providerUrl, dryRun, useFork, privateKey }) {
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
	const oldRewardEscrow = await getContract({
		contract: 'RewardEscrow',
		network,
		provider,
	});

	const vestingEntryEvents = await getPastEvents({
		contract: oldRewardEscrow,
		eventName: 'VestingEntryCreated',
		network,
		provider: new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL.replace('network', network)), // can't use a fork to load events for some reason
	});

	const accounts = Array.from(new Set(vestingEntryEvents.map(({ args: [address] }) => address)));

	console.log(gray('Found'), yellow(accounts.length), gray('accounts'));

	const newRewardEscrow = await getContract({
		contract: 'RewardEscrowV2',
		network,
		wallet,
	});

	const accountsWithDetail = [];
	for (const address of accounts) {
		const alreadyEscrowed = +(await newRewardEscrow.totalEscrowedAccountBalance(address)) > 0;

		if (alreadyEscrowed) {
			console.log(
				gray('Note:'),
				yellow(address),
				gray('escrow amounts already exist. It will NOT be added to the migrate call.'),
			);
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
			hasEscrowBalance: alreadyEscrowed,
		});
	}

	const migrationPageSize = 500;
	const accountsToMigrate = accountsWithDetail.filter(({ hasEscrowBalance }) => !hasEscrowBalance);

	const dryRunOutput = { migratedAccounts: [], importedEntries: [] };

	// Do the migrateAccountEscrowBalances() in large batches
	for (let i = 0; i < accountsToMigrate.length; i += migrationPageSize) {
		const accounts = accountsToMigrate.slice(i, i + migrationPageSize);
		console.log(gray('Migrating'), yellow(accounts.length), gray('accounts'));
		if (dryRun) {
			dryRunOutput.migratedAccounts = dryRunOutput.migratedAccounts.concat(accounts);
		} else {
			await newRewardEscrow.migrateAccountEscrowBalances(
				accounts.map(({ address }) => address),
				accounts.map(({ balance }) => balance),
				accounts.map(({ vested }) => vested),
			);
		}
	}

	// Now take all the vesting entries, check they aren't already in and flatten them
	let accountsToImportVestingEntries = [];

	for (const { address, schedule } of accountsWithDetail) {
		const alreadyMigratedPendingVestedImport = +(await newRewardEscrow.totalBalancePendingMigration(address)) > 0;

		if (!dryRun && !alreadyMigratedPendingVestedImport) {
			console.log(gray('Skipping entries for'), yellow(address), gray('as no longer pending.'));
			continue;
		}

		// now fetch all new vesting entries that have been imported
		const entryIDsForAccount = await newRewardEscrow.getVestingSchedules(
			address,
			'0',
			(schedule.length + 1).toString(),
		);

		// now only add those entries that cannot already be found
		accountsToImportVestingEntries = accountsToImportVestingEntries.concat(
			schedule
				.filter(
					({ timestamp, entry }) =>
						!entryIDsForAccount.find(
							({ endTime, escrowAmount }) => endTime.toString() === timestamp && escrowAmount === entry,
						),
				)
				.map(_ => Object.assign({ address }, _)),
		);
	}

	// and do batch inserts of these entries
	const entryBatchSize = 200;
	for (let i = 0; i < accountsToImportVestingEntries.length; i += entryBatchSize) {
		const entries = accountsToImportVestingEntries.slice(i, i + entryBatchSize);
		console.log(gray('Importing vesting entries'), yellow(entries.length));
		if (dryRun) {
			dryRunOutput.importedEntries = dryRunOutput.importedEntries.concat(entries);
		} else {
			await newRewardEscrow.importVestingSchedule(
				entries.map(({ address }) => address),
				entries.map(({ timestamp }) => timestamp),
				entries.map(({ entry }) => entry),
			);
		}
	}

	if (dryRun) {
		fs.writeFileSync(`rewards-out-dry-run-${network}.json`, JSON.stringify(dryRunOutput, null, 2));
		process.exit();
	}

	// now run through and make sure everything is kosher

	console.log(gray('Now performing final checks.'));

	for (const { address, balance, vested, schedule } of accountsWithDetail) {
		const totalBalancePendingMigration = +(await newRewardEscrow.totalBalancePendingMigration(address));
		const numVestingEntries = +(await newRewardEscrow.numVestingEntries(address));
		const totalEscrowedAccountBalance = (await newRewardEscrow.totalEscrowedAccountBalance(address)).toString();
		const totalVestedAccountBalance = (await newRewardEscrow.totalVestedAccountBalance(address)).toString();

		if (totalBalancePendingMigration !== 0) {
			console.log(
				red('Error: address'),
				yellow(address),
				red('still has'),
				yellow(totalBalancePendingMigration),
				red('migration left'),
			);
		}

		if (numVestingEntries !== schedule.length) {
			console.log(
				red('Error: address '),
				yellow(address),
				red('has vesting entries length'),
				yellow(numVestingEntries),
				red('instead of'),
				yellow(schedule.length),
			);
		}

		if (totalEscrowedAccountBalance !== balance) {
			console.log(
				red('Error: address '),
				yellow(address),
				red('has mismatched total escrowed balance'),
				yellow(totalEscrowedAccountBalance),
				red('instead of'),
				yellow(balance),
			);
		}

		if (totalVestedAccountBalance !== vested) {
			console.log(
				red('Error: address '),
				yellow(address),
				red('has mismatched total vested'),
				yellow(totalVestedAccountBalance),
				red('instead of'),
				yellow(vested),
			);
		}
	}

	// now check total
	const newTotalBalance = +(await newRewardEscrow.totalEscrowedBalance());
	const oldTotalBalance = +(await oldRewardEscrow.totalEscrowedBalance());

	if (newTotalBalance !== oldTotalBalance) {
		console.log(red('Error: total mismatch'), yellow(newTotalBalance), red('versus older'), yellow(oldTotalBalance));
	}

	console.log(gray('Final checks complete.'));
}

program
	.description('Reward Escrow Migration')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-f, --use-fork', 'Use a local fork', false)
	.option('-k, --private-key <value>', 'Private key to use to sign txs')
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
