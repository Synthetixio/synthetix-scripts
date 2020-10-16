const fs = require('fs');
const { gray } = require('chalk');
const {
	constants: {
		CONFIG_FILENAME,
	},
	wrap,
} = require('synthetix');

const { getPathToNetwork } = wrap({
	path,
	fs,
});

const ensureDeploymentPath = deploymentPath => {
	if (!fs.existsSync(deploymentPath)) {
		throw Error(
			`Invalid deployment path. Please provide a folder with a compatible ${CONFIG_FILENAME}`
		);
	}
};

const getDeploymentPathForNetwork = network => {
	console.log(gray('Loading default deployment for network'));
	return getPathToNetwork({ network });
};

module.exports = {
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
};
