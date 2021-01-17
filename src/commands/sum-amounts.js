const { BigNumber } = require('ethers');
const fs = require('fs');
const input = JSON.parse(fs.readFileSync('castor-reward-escrows-final.json'));

const total = input.reduce((memo, { balanceOf }) => BigNumber.from(balanceOf).add(memo), BigNumber.from(0));

console.log('total', total.toString());
