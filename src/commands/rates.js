#!/usr/bin/env node

require('dotenv').config();

const program = require('commander');

const { green, cyan, red } = require('chalk');
const { formatEther, formatBytes32String } = require('ethers').utils;
const { getSynths } = require('synthetix');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function rates({ network, useOvm, providerUrl }) {
	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Input ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	if (!providerUrl && process.env.PROVIDER_URL) {
		providerUrl = process.env.PROVIDER_URL.replace('network', network);
	}

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Setup ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	const { provider } = setupProvider({ providerUrl });

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~ General ~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	logItem('Network', network);
	logItem('Optimism', useOvm);
	logItem('Provider', providerUrl);

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ Synthetix ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	logSection('Synthetix');

	const Synthetix = getContract({
		contract: 'Synthetix',
		network,
		useOvm,
		provider,
	});

	logItem('Synthetix.anySynthOrSNXRateIsInvalid', await Synthetix.anySynthOrSNXRateIsInvalid(blockOptions));
	logItem('Synthetix.totalSupply', (await Synthetix.totalSupply(blockOptions)).toString() / 1e18);

	/* ~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ SynthetixState ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('SynthetixState');

	const SynthetixState = getContract({
		contract: 'SynthetixState',
		network,
		useOvm,
		provider,
	});

	for (const address of addresses) {
		console.log(green('  Address:'), address);

		const data = await SynthetixState.issuanceData(address, blockOptions);
		logItem('SynthetixState.issuanceData(address)', data.toString());
	}

	/* ~~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ SupplySchedule  ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('SupplySchedule');

	const SupplySchedule = getContract({
		contract: 'SupplySchedule',
		source: useOvm ? 'FixedSupplySchedule' : 'SupplySchedule',
		network,
		useOvm,
		provider,
	});

	const supply = formatEther(await SupplySchedule.mintableSupply(blockOptions));
	logItem('SupplySchedule.mintableSupply', supply);

	if (useOvm) {
		logItem(
			'FixedSupplySchedule.inflationStartDate',
			new Date((await SupplySchedule.inflationStartDate(blockOptions)).toString() * 1000),
		);

		const lastMint = (await SupplySchedule.lastMintEvent(blockOptions)).toNumber();
		logItem('FixedSupplySchedule.lastMintEvent', lastMint);
		const mintPeriod = (await SupplySchedule.mintPeriodDuration(blockOptions)).toNumber();
		logItem('FixedSupplySchedule.mintPeriodDuration', mintPeriod);

		const now = Math.floor(new Date().getTime() / 1000);

		const remainingHours = (lastMint + mintPeriod - now) / (60 * 60);
		logItem('Remaining hours until period ends', remainingHours);

		logItem('FixedSupplySchedule.mintBuffer', (await SupplySchedule.mintBuffer(blockOptions)).toString());
		logItem(
			'FixedSupplySchedule.periodsSinceLastIssuance',
			(await SupplySchedule.periodsSinceLastIssuance(blockOptions)).toString(),
		);
	}

	/* ~~~~~~~~~~~~~~~~~ */
	/* ~~~~ FeePool ~~~~ */
	/* ~~~~~~~~~~~~~~~~~ */

	logSection('FeePool');

	const FeePool = await getContract({
		contract: 'FeePool',
		network,
		useOvm,
		provider,
	});

	logItem('FeePool.feePeriodDuration', (await FeePool.feePeriodDuration(blockOptions)).toString());

	async function feePeriodInfo(idx) {
		const feePeriod = await FeePool.recentFeePeriods(idx, blockOptions);
		logItem(`feePeriod ${idx}:`);

		Object.keys(feePeriod).map(key => {
			if (isNaN(key)) {
				logItem(`${key}`, `${feePeriod[key].toString()}`, 2);
			}
		});

		logItem('startTime:', new Date(feePeriod.startTime.toString() * 1000), 2);
	}

	await feePeriodInfo(0);
	await feePeriodInfo(1);

	for (const address of addresses) {
		console.log(green('  Address:'), address);

		const feesByPeriod = await FeePool.feesByPeriod(address, blockOptions);
		logItem(
			'FeePool.feesByPeriod(address)',
			feesByPeriod.map(period => period.map(fee => fee.toString())),
			2,
		);

		const lastFeeWithdrawal = await FeePool.getLastFeeWithdrawal(address, blockOptions);
		logItem('FeePool.getLastFeeWithdrawal(address)', lastFeeWithdrawal.toString(), 2);

		const effectiveDebtRatioForPeriod = await FeePool.effectiveDebtRatioForPeriod(address, 1, blockOptions);
		logItem(`FeePool.effectiveDebtRatioForPeriod(${address}, 1)`, effectiveDebtRatioForPeriod.toString(), 2);
	}

	/* ~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ FeePoolState ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('FeePoolState');

	const FeePoolState = getContract({
		contract: 'FeePoolState',
		network,
		useOvm,
		provider,
	});

	for (const address of addresses) {
		console.log(green('  Address:'), address);

		const debtEntry = await FeePoolState.getAccountsDebtEntry(address, 0, blockOptions);
		logItem(
			'FeePoolState.getAccountsDebtEntry(address)',
			debtEntry.map(item => item.toString()),
		);
	}

	/* ~~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ AddressResolver ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('AddressResolver');

	const AddressResolver = getContract({
		contract: 'AddressResolver',
		network,
		useOvm,
		provider,
	});

	const getAddress = async ({ contract }) => {
		logItem(
			`AddressResolver.getAddress(${contract})`,
			await AddressResolver.getAddress(formatBytes32String(contract), blockOptions),
		);
	};

	await getAddress({ contract: 'RewardsDistribution' });

	/* ~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ ExchangeRates ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('ExchangeRates');

	const ExchangeRates = getContract({
		contract: 'ExchangeRates',
		network,
		useOvm,
		provider,
	});

	const logRate = async currency => {
		const rate = await ExchangeRates.rateForCurrency(formatBytes32String(currency), blockOptions);
		const updated = await ExchangeRates.lastRateUpdateTimes(formatBytes32String(currency), blockOptions);
		logItem(`${currency} rate:`, `${formatEther(rate)} (${new Date(updated.toString() * 1000)})`);
	};

	await logRate('SNX');

	const synths = getSynths();
	for (const synth of synths) {
		await logRate(synth.name);
	}
}
program
	.description('Query state of the system on any network')
	.option('-a, --addresses <values...>', 'Addresses to perform particular checks on')
	.option('-b, --block <value>', 'Block number to check again')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('-z, --use-ovm', 'Use an Optimism chain', false)
	.action(async (...args) => {
		try {
			await rates(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
