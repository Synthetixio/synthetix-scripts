#!/usr/bin/env node

require('dotenv').config();

const program = require('commander');

const { green, cyan, red, bgRed } = require('chalk');
const { formatEther, formatBytes32String, toUtf8String } = require('ethers').utils;
const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');

async function status({ network, useOvm, providerUrl, addresses, block, useFork, deploymentPath }) {
	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Input ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	addresses = addresses ? addresses.split(',') : [];

	if (!providerUrl && process.env.PROVIDER_URL) {
		providerUrl = process.env.PROVIDER_URL.replace('network', network);
	}

	const blockOptions = { blockTag: block ? +block : 'latest' };

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Setup ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	if (useFork) {
		providerUrl = 'http://localhost:8545';
	}

	const { provider } = setupProvider({ providerUrl });

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ Log utils ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	const logSection = sectionName => {
		console.log(green(`\n=== ${sectionName}: ===`));
	};

	const logItem = (itemName, itemValue, indent = 1, color = undefined) => {
		const hasValue = itemValue !== undefined;
		const spaces = '  '.repeat(indent);
		const name = cyan(`* ${itemName}${hasValue ? ':' : ''}`);
		const value = hasValue ? itemValue : '';

		if (color) {
			console.log(color(spaces, name, value));
		} else {
			console.log(spaces, name, value);
		}
	};

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~ General ~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	logSection('Info');

	logItem('Network', network);
	logItem('Deployment', deploymentPath);
	logItem('Optimism', useOvm);
	logItem('Block #', blockOptions.blockTag);
	logItem('Provider', providerUrl);

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ Synthetix ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	logSection('Synthetix');

	const Synthetix = getContract({
		contract: 'Synthetix',
		source: useOvm ? 'MintableSynthetix' : 'Synthetix',
		network,
		useOvm,
		provider,
		deploymentPath,
	});

	const anySynthOrSNXRateIsInvalid = await Synthetix.anySynthOrSNXRateIsInvalid(blockOptions);
	logItem(
		'Synthetix.anySynthOrSNXRateIsInvalid',
		anySynthOrSNXRateIsInvalid,
		1,
		anySynthOrSNXRateIsInvalid ? bgRed : undefined,
	);

	logItem('Synthetix.totalSupply', (await Synthetix.totalSupply(blockOptions)).toString() / 1e18);

	/* ~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ DebtCache ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('DebtCache');

	const DebtCache = getContract({
		contract: 'DebtCache',
		source: useOvm ? 'RealtimeDebtCache' : 'DebtCache',
		network,
		useOvm,
		provider,
		deploymentPath
	});

	const info = await DebtCache.cacheInfo();

	logItem(
		'DebgCache.info.isInvalid',
		info.isInvalid,
		1,
		info.isInvalid ? bgRed : undefined,
	);

	logItem(
		'DebgCache.info.isStale',
		info.isStale,
		1,
		info.isStale ? bgRed : undefined,
	);

	/* ~~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ SynthetixState ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('SynthetixState');

	const SynthetixState = getContract({
		contract: 'SynthetixState',
		network,
		useOvm,
		provider,
		deploymentPath,
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
		deploymentPath,
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

	const FeePool = getContract({
		contract: 'FeePool',
		network,
		useOvm,
		provider,
		deploymentPath,
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
		deploymentPath,
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
		deploymentPath,
	});

	const getAddress = async ({ contract }) => {
		logItem(
			`AddressResolver.getAddress(${contract})`,
			await AddressResolver.getAddress(formatBytes32String(contract), blockOptions),
		);
	};

	await getAddress({ contract: 'RewardsDistribution' });

	/* ~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ SystemSettings ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('SystemSettings');

	const SystemSettings = getContract({
		contract: 'SystemSettings',
		network,
		useOvm,
		provider,
		deploymentPath,
	});

	const rateStalePeriod = await SystemSettings.rateStalePeriod();

	logItem(`rateStalePeriod`, rateStalePeriod.toString());

	/* ~~~~~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~ ExchangeRates ~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~~~~~ */

	logSection('ExchangeRates');

	const ExchangeRates = getContract({
		contract: 'ExchangeRates',
		network,
		useOvm,
		provider,
		deploymentPath,
	});

	const Issuer = getContract({
		contract: 'Issuer',
		network,
		useOvm,
		provider,
		deploymentPath,
	});

	const currencyKeys = await Issuer.availableCurrencyKeys();
	const now = Math.floor(new Date().getTime() / 60000);

	const logRate = async currencyKey => {
		const currency = toUtf8String(currencyKey);
		const rate = await ExchangeRates.rateForCurrency(currencyKey, blockOptions);
		const isInvalid = await ExchangeRates.rateIsInvalid(currencyKey);
		const updated = await ExchangeRates.lastRateUpdateTimes(currencyKey, blockOptions);
		const sinceUpdate = Math.floor(now - +updated.toString() / 60);

		logItem(
			`${currency} rate:`,
			`${formatEther(rate)} (Updated ${sinceUpdate} minutes ago)`,
			1,
			isInvalid ? bgRed : undefined,
		);
	};

	for (const currencyKey of currencyKeys) {
		await logRate(currencyKey);
	}
	await logRate(formatBytes32String('SNX'));
}
program
	.description('Query state of the system on any network')
	.option('-a, --addresses <values...>', 'Addresses to perform particular checks on')
	.option('-b, --block <value>', 'Block number to check again')
	.option('-f, --use-fork', 'Use a local fork', false)
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('-y, --deployment-path <value>', 'Specify the path to the deployment data directory')
	.option('-z, --use-ovm', 'Use an Optimism chain', false)
	.action(async (...args) => {
		try {
			await status(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
