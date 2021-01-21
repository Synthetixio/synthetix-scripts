#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const program = require('commander');
const ethers = require('ethers');
const { formatEther } = ethers.utils;
const { red, gray, yellow, green } = require('chalk');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');
const { getPastEvents } = require('../utils/getEvents');

async function rewardEscrowMigration({ network, providerUrl, accountToInspect }) {
	console.log(gray(`Running in network: ${network}`));

	if (!providerUrl && process.env.PROVIDER_URL) {
		const envProviderUrl = process.env.PROVIDER_URL;
		if (envProviderUrl.includes('infura')) {
			providerUrl = process.env.PROVIDER_URL.replace('network', network);
		} else {
			providerUrl = envProviderUrl;
		}
	}

	if (!providerUrl) throw new Error('Cannot set up a provider.');

	const { provider } = await setupProvider({ providerUrl });

	const { number: latestBlock, timestamp: latestBlockTimestamp } = await provider.getBlock(
		await provider.getBlockNumber(),
	);

	console.log(gray('Latest block'), yellow(latestBlock), gray('with timestamp of'), yellow(latestBlockTimestamp));

	const oldRewardEscrow = await getContract({
		contract: 'RewardEscrow',
		network,
		provider,
	});

	const rewardEscrowV2 = await getContract({
		contract: 'RewardEscrowV2',
		network,
		provider,
	});

	const migrationThreshold = formatEther(await rewardEscrowV2.migrateEntriesThresholdAmount());
	console.log(gray('Only investigating accounts with >'), yellow(migrationThreshold), gray('escrowed SNX in total'));

	const migratedAccounts = (
		await getPastEvents({
			contract: rewardEscrowV2,
			eventName: 'MigratedAccountEscrow',
			network,
			provider,
		})
	).map(({ args: { account, escrowedAmount, time } }) => ({
		account,
		amount: escrowedAmount,
		time: time.toString(),
	}));

	// sort largest holders first
	const migratedAccountsOverThreshold = migratedAccounts
		.filter(({ amount }) => +formatEther(amount) > +migrationThreshold)
		.sort((a, b) => (+a.amount > +b.amount ? -1 : 1));

	if (accountToInspect) {
		const migratedAccount = migratedAccounts.find(
			({ account }) => account.toLowerCase() === accountToInspect.toLowerCase(),
		);
		if (!migratedAccount) throw new Error('Cannot find account in migrated events!');
		console.log(
			gray('Account'),
			yellow(accountToInspect),
			gray('had migrated balance'),
			yellow(formatEther(migratedAccount.amount)),
		);
	} else {
		console.log(
			gray('Found'),
			yellow(migratedAccounts.length),
			gray('accounts migrated. Of these,'),
			yellow(migratedAccountsOverThreshold.length),
			gray('are over the threshold'),
		);
	}
	const importedAmountsOriginal = (
		await getPastEvents({
			contract: rewardEscrowV2,
			eventName: 'ImportedVestingSchedule',
			network,
			provider,
		})
	).map(({ args: { account, time, escrowAmount } }) => ({
		account,
		time: time.toString(),
		amount: escrowAmount,
	}));

	const importedAmounts = importedAmountsOriginal.reduce((memo, { account, amount }) => {
		memo[account] = memo[account] ? memo[account].add(amount) : amount;
		return memo;
	}, {});

	let alreadyComplete = 0;

	const accountsWithFlattenedEntriesPastVestingDate = [];

	const importedFilename = `data/imported-entries-pending-left-${network}-${latestBlock}.json`;

	// for all accouts over the threshold
	for (const { account } of migratedAccountsOverThreshold) {
		if (accountToInspect && account.toLowerCase() !== accountToInspect.toLowerCase()) {
			continue;
		}
		// now check this matches what is pending for their migration
		const remainingToMigrate = await rewardEscrowV2.totalBalancePendingMigration(account);
		if (remainingToMigrate.toString() === '0') {
			alreadyComplete++;
			// console.log(
			// 	gray('Account'),
			// 	yellow(account),
			// 	gray('is complete with'),
			// 	yellow(formatEther(amount)),
			// 	gray('migrated'),
			// );
			continue; // then done for this account
		}

		// begin a tally
		let entrySumThatArePastVestingDate = ethers.BigNumber.from(0);

		// load their new schedule
		const newSchedule = await rewardEscrowV2.getVestingSchedules(account, '0', '1024'); // limited to 1024 entries (should be more than enough)

		// load their old schedules
		const flatSchedule = await oldRewardEscrow.checkAccountSchedule(account);

		// and loop over them
		for (let i = 0; i < flatSchedule.length; i += 2) {
			const [timestamp, entry] = flatSchedule.slice(i).map(_ => _.toString());
			if (timestamp === '0' && entry === '0') {
				// skip 0 entries
				continue;
			} else if (+timestamp > +latestBlockTimestamp) {
				// skip entries that haven't hit their vesting date
				continue;
			} else if (timestamp === '0' || entry === '0') {
				// warn on bad data and skip
				console.log(
					red('Warning: address'),
					yellow(account),
					red('has'),
					yellow(timestamp, entry),
					red('One is 0. Skipping'),
				);
				continue;
			}

			// look thru new entries to check dupes
			const newScheduleEntry = newSchedule.find(
				({ endTime, escrowAmount }) =>
					endTime.toString() === timestamp.toString() && escrowAmount.toString() === entry.toString(),
			);

			if (newScheduleEntry) {
				if (accountToInspect) {
					console.log(
						gray('Found matching entry for'),
						yellow(formatEther(entry)),
						gray('at time'),
						yellow(new Date(+timestamp * 1000)),
					);
				}
				continue;
			} else if (accountToInspect) {
				console.log(
					gray('Found old entry that is vestable before this moment as'),
					yellow(formatEther(entry)),
					gray('on date'),
					yellow(new Date(+timestamp * 1000)),
				);
			}

			// otherwise add to the sum
			entrySumThatArePastVestingDate = entrySumThatArePastVestingDate.add(flatSchedule[i + 1]);
		}

		if (entrySumThatArePastVestingDate.gt(0)) {
			if (accountToInspect) {
				console.log(gray('The following imported events have occurred for this account'));
				importedAmountsOriginal
					.filter(({ account }) => account.toLowerCase() === accountToInspect.toLowerCase())
					.forEach(({ amount, time }) =>
						console.log(gray('\t- imported'), yellow(formatEther(amount)), gray('on'), yellow(new Date(+time * 1000))),
					);
			}
			// some accounts that have entries now but not before (vesting happened in the time between) need a 0 value here
			const amountAlreadyImported = importedAmounts[account] ? importedAmounts[account] : '0';
			const amountRemainingForImport = entrySumThatArePastVestingDate.sub(amountAlreadyImported).toString();

			if (+amountRemainingForImport > +remainingToMigrate) {
				console.log(
					red('Skipping'),
					yellow(account),
					red('as amount we just calculated'),
					yellow(formatEther(amountRemainingForImport)),
					red('> pending'),
					yellow(formatEther(remainingToMigrate)),
				);
				continue;
			}
			const amountMatchesPending = amountRemainingForImport.toString() === remainingToMigrate.toString();
			accountsWithFlattenedEntriesPastVestingDate.push({
				account,
				amount: amountRemainingForImport,
				pendingOnV2: remainingToMigrate.toString(),
				amountMatchesPending,
			});

			console.log(
				gray('Found missing!'),
				yellow(account),
				gray('with calculated balance remaining'),
				yellow(formatEther(amountRemainingForImport)),
				gray('and pending amount of'),
				yellow(formatEther(remainingToMigrate)),
				gray('Does this complete the migration?'),
				amountMatchesPending ? green('true') : red('false'),
			);

			if (!accountToInspect) {
				fs.writeFileSync(importedFilename, JSON.stringify(accountsWithFlattenedEntriesPastVestingDate, null, 2));
			}
		}
	}

	if (accountToInspect) {
		return;
	}

	const accountsToImportNow = accountsWithFlattenedEntriesPastVestingDate.filter(
		({ amount, amountMatchesPending }) => +amount > 0 && amountMatchesPending,
	);

	const mismatchCount = accountsWithFlattenedEntriesPastVestingDate.reduce(
		(memo, { amountMatchesPending }) => memo + (amountMatchesPending ? 0 : 1),
		0,
	);

	console.log(
		gray('There are'),
		yellow(alreadyComplete),
		gray('accounts complete. And'),
		yellow(accountsWithFlattenedEntriesPastVestingDate.length),
		gray('accounts still yet to migrate. Of these'),
		yellow(mismatchCount),
		gray('still have to self-service migrate. However,'),
		yellow(accountsToImportNow.length),
		gray('will be complete after this'),
	);

	console.log(
		gray('Data payload for all accounts with something vested that needs importing'),
		yellow(
			rewardEscrowV2.interface.encodeFunctionData('importVestingSchedule', [
				accountsToImportNow.map(({ account }) => account),
				accountsToImportNow.map(({ amount }) => amount),
			]),
		),
	);
}

program
	.description('Reward Escrow Migration')
	.option('-a, --account-to-inspect <value>', 'An account to filter to')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
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
