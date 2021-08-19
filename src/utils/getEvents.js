const { gray } = require('chalk');

async function getPastEvents({ contract, eventName, provider, fromBlock, toBlock }) {
	const filter = getFilter({ contract, eventName, fromBlock, toBlock })
	let logs = await provider.getLogs(filter);
	logs = logs.map(log =>
		Object.assign({ transactionHash: log.transactionHash, logIndex: log.logIndex }, contract.interface.parseLog(log)),
	);

	return logs;
}

async function waitForEvent({ contract, eventName, provider, fromBlock, toBlock, validator, timeout }) {

	const filter = getFilter({ contract, eventName, fromBlock, toBlock })
	let logs = await provider.getLogs(filter);
	logs = logs.map(log =>
		Object.assign({ transactionHash: log.transactionHash, logIndex: log.logIndex }, contract.interface.parseLog(log)),
	);

	return logs;
}

function getFilter({ contract, eventName, fromBlock, toBlock, listeningMode }) {
	let filter = { address: contract.address };

	if (eventName) {
		filter = contract.filters[eventName]();
		if (!filter) throw new Error(`Event ${eventName} not found in contract abi.`);
	}

	if (!listeningMode) {
		filter.fromBlock = +fromBlock || 'earliest';
		filter.toBlock = +toBlock || 'latest';
	}

	return filter;
}

module.exports = {
	getPastEvents,
};
