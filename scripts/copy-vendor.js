'use strict'

const fs = require('fs')
const path = require('path')

const cryptoSource = require.resolve('crypto-js/crypto-js.js')
const cryptoT = path.join(__dirname, '..', 'static', 'crypto-js.js')
fs.copyFileSync(cryptoSource, cryptoT)
console.log('copied crypto-js browser bundle to static/crypto-js.js')

const abogusSource = path.join(__dirname, '..', 'src', 'helper', 'douyin-abogus.js')
const abogusTarget = path.join(__dirname, '..', 'static', 'douyin-abogus.js')
if (fs.existsSync(abogusSource)) {
  fs.copyFileSync(abogusSource, abogusTarget)
  console.log('copied douyin a_bogus script to static/douyin-abogus.js')
}
