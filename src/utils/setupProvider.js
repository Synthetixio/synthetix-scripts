const ethers = require('ethers');

function setupProvider({ providerUrl, privateKey, publicKey }) {
	let provider;
	if (providerUrl) {
		provider = new ethers.providers.JsonRpcProvider(providerUrl);
	} else {
		provider = new ethers.getDefaultProvider();
	}

	let wallet;
	if (publicKey) {
		wallet = provider.getSigner(publicKey);
		wallet.address = publicKey;
	} else {
		wallet = new ethers.Wallet(privateKey || ethers.Wallet.createRandom().privateKey, provider);
	}

	return {
		provider,
		wallet,
	};
}

module.exports = {
	setupProvider,
};
