const ethers = require('ethers');

async function runTx({ txPromise, provider }) {
	let tx;

	/*
	 	* This rather bizarre piece of code attempts to run txs
	 	* and catch any kind of failures that may occur,
	 	* trying to parse any errors and get revert reasons.
	 	*
	 	* If errors can't be parsed, they are just printed out.
	 	* */

	// Method interaction => TransactionRequest
	try {
		tx = await txPromise;
	} catch (error) {
		error.tx = tx;

		return {
			success: false,
			error,
		};
	}

	// TransactionResponse => TransactionReceipt
	try {
		const receipt = await tx.wait();

		return {
			success: true,
			receipt,
		};
	} catch (error) {
		error.tx = tx;

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
		} catch (error) {
			error.tx = tx;

			return {
				success: false,
				error,
			};
		}
	}
}

module.exports = {
	runTx,
};
