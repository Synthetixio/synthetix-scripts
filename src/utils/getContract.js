const fs = require('fs');
const path = require('path');

const synthetix = require('synthetix');
const ethers = require('ethers');

const { gray } = require('chalk');

function getContract({
	contract,
	source,
	network = 'mainnet',
	useOvm = false,
	deploymentPath = undefined,
	wallet,
	provider,
}) {
	const { getSource, getTarget } = synthetix.wrap({ network, fs, path });

	const target = getTarget({  contract, network, useOvm, deploymentPath });

	const sourceData = getSource({
		contract: source || target.source,
		network,
		useOvm,
		deploymentPath,
	});

	return new ethers.Contract(target.address, sourceData.abi, wallet || provider);
}

module.exports = {
	getContract,
};
