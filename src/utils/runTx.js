const ethers = require('ethers');

async function stageTx({ txPromise }) {
	try {
		const tx = await txPromise;

		return {
			success: true,
			tx,
		};
	} catch (error) {
		return {
			success: false,
			error,
		};
	}
}

async function runTx({ tx, provider }) {
	try {
		const receipt = await tx.wait();

		return {
			success: true,
			receipt,
		};
	} catch (error) {
		// Try to get the revert reason when none is provided
		try {
			let code = await provider.call(tx);
			code = code.substr(138);

			// Try to parse the revert reason bytes.
			if (code.length === '64') {
				error.reason = ethers.utils.parseBytes32String(`0x${code}`);
			} else {
				error.reason = '';
				const chunks = code.match(/.{1,62}/g);
				chunks.map(chunk => {
					try {
						const parsed = ethers.utils.toUtf8String(`0x${chunk}00`);
						error.reason += parsed;
					} catch(error) {}
				});
			}

			return {
				success: false,
				error,
			};
		} catch (suberror) {
			error.error = suberror;

			return {
				success: false,
				error,
			};
		}
	}
}

module.exports = {
	stageTx,
	runTx,
};
