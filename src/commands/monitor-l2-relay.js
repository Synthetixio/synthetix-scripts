#!/usr/bin/env node
require('dotenv').config();

const program = require('commander');
const { red, green, gray } = require('chalk');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');
const { getPastEvents } = require('../utils/getEvents');
const { BigNumber, utils } = require('ethers');

const BLOCKS_PER_WEEK_L1 = 45000 // Average 6500 blocks a day ~ 45000 a week
const BLOCKS_PER_WEEK_L2 = 10000 // Average 150 blocks a day ~ 1050 a week // 120000 but limited to 10000

const stringify = (object) => Object.keys(object).reduce(
	(acc,key) => ({
		...acc, 
		...{[key]: object[key] instanceof BigNumber ? object[key].toString() : object[key]},
	}), 
	{}
)

const timify = (timestamp) => `${timestamp} ${green(new Date(+timestamp * 1000).toISOString())}`;

const getAndLogEvents = async ({contractName, eventName, fromBlock, toBlock, network, useOvm, provider}) => {
	const contract = await getContract({
		contract: contractName,
		network,
		useOvm,
		provider,
	});
	let events = await getPastEvents({ contract, eventName, provider, fromBlock, toBlock });
	events = await Promise.all(
		events.map(evt => 
			provider.getTransaction(evt.transactionHash)
				.then(receipt => Object.assign({ 
						hash: receipt.hash, 
						blockNumber: receipt.blockNumber, 
						evt_name: evt.name}))),
		);
	events = await Promise.all(events.map(evt => provider.getBlock(evt.blockNumber).then(block => Object.assign(evt, {timestamp: block.timestamp}))));
	const lastEvent = events.length? events[events.length -1] : undefined;
	console.log(green(`Event: ${contractName}.${eventName}`));
	console.log(gray(`     tx: ${lastEvent?lastEvent.hash:'--'}`));
	console.log(gray(`     block: ${lastEvent?lastEvent.blockNumber:'--'}`));
	console.log(gray(`     block timestamp: ${lastEvent?timify(lastEvent.timestamp):'--'} `));
	return { contract, events }	
};

const getLatestPeriodFromFeePool = async ({network, provider}) => {
	const FeePool = await getContract({
		contract: 'FeePool',
		network,
		useOvm: true,
		provider,
	});

	const feePeriod = await FeePool.recentFeePeriods(BigNumber.from(0));
	console.log(green('FeePool recentFeePeriod (L2)'));
	console.log(gray(`     ID: ${green(feePeriod.feePeriodId.toString())}`));
	console.log(gray(`     RewardsToDistribute: ${green(utils.formatUnits(feePeriod.rewardsToDistribute))} `));
	console.log(gray(`     Timestamp: ${timify(feePeriod.startTime.toString())}`));

	return feePeriod;
};

const waitForEvent = async ({}) => {

}

async function monitorL2Relay({
	network,
	providerUrl,
	fromBlock,
	toBlock,
	providerUrlL2,
	fromBlockL2,
	toBlockL2,
	checkPastEvents,
	timeout,
}) {
	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Input ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	if (!providerUrl && process.env.PROVIDER_URL) {
		const envProviderUrl = process.env.PROVIDER_URL;
		if (envProviderUrl.includes('infura')) {
			providerUrl = process.env.PROVIDER_URL.replace('network', network);
		} else {
			providerUrl = envProviderUrl;
		}
	}
	if (!providerUrl) throw new Error('Cannot set up a provider.');

	if (!providerUrlL2) {
		providerUrlL2 = `https://${network}.optimism.io`;
	}

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Setup ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	const { provider: providerl1 } = await setupProvider({ providerUrl });
	const { provider: providerl2 } = await setupProvider({ providerUrl: providerUrlL2 });

	if (!fromBlock) {
		// Use 1w offset from latest block
		fromBlock = (await providerl1.getBlock()).number - BLOCKS_PER_WEEK_L1;
	}

	if (!fromBlockL2) {
		// Use 1w offset from latest block
		fromBlockL2 = (await providerl2.getBlock()).number - BLOCKS_PER_WEEK_L2;
	}

	if (checkPastEvents) {
		const { contract: supplySchedule, events: ssEvents } = await getAndLogEvents({ contractName: 'SupplySchedule', eventName: 'SupplyMinted', network, useOvm: false, provider: providerl1, fromBlock, toBlock });
		const { contract: rewardsDistribution, events: rdEvents } = await getAndLogEvents({ contractName: 'RewardsDistribution', eventName: 'RewardsDistributed', network, useOvm: false, provider: providerl1, fromBlock, toBlock });
		const { contract: synthetixBridgeToOptimism, events: sb2oEvents } = await getAndLogEvents({ contractName: 'SynthetixBridgeToOptimism', eventName: 'RewardDepositInitiated', network, useOvm: false, provider: providerl1, fromBlock, toBlock });
		const { contract: synthetixBridgeToBase, events: sb2bEvents } = await getAndLogEvents({ contractName: 'SynthetixBridgeToBase', eventName: 'RewardDepositFinalized', network, useOvm: true, provider: providerl2, fromBlock: fromBlockL2, toBlock: toBlockL2 });
		// const { contract: RewardEscrowV2, events: re2Events } = await getAndLogEvents({ contractName: 'RewardEscrowV2', eventName: 'RewardDepositFinalized', network, useOvm: true, provider: providerl2, fromBlock: fromBlockL2, toBlock: toBlockL2 });
		await getLatestPeriodFromFeePool({network, provider: providerl2 });	
		return
	}


}


program
	.description('Monitor Relayed events')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option('-p, --provider-url <value>', 'The http provider to use for communicating with the blockchain')
	.option('-f, --from-block <value>', 'Starting block for the query')
	.option('-t, --to-block <value>', 'Ending block for the query', 'latest')
	.option('-q, --provider-url-l2 <value>', 'The http provider to use for communicating with the blockchain')
	.option('-g, --from-block-l2 <value>', 'Starting block for the query on L2')
	.option('-u, --to-block-l2 <value>', 'Ending block for the query on L2', 'latest')
	.option('-h, --check-past-events', 'Check latest events (already commited)')
	.option('-x, --timeout', 'Timeout to monitor for events on L2 (ms)', 720000)
	.action(async (...args) => {
		try {
			await monitorL2Relay(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
