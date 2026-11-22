'use strict'

const fs = require('fs')
const path = require('path')

const source = require.resolve('crypto-js/crypto-js.js')
const target = path.join(__dirname, '..', 'static', 'crypto-js.js')

fs.copyFileSync(source, target)
console.log('copied crypto-js browser bundle to static/crypto-js.js')
