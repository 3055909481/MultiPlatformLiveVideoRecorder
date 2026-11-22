'use strict'

const CryptoJS = require('crypto-js')

const root = typeof window !== 'undefined' ? window : global
root.__MPLVR_HELPERS = root.__MPLVR_HELPERS || {}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

root.__MPLVR_HELPERS.extractWbiKeys = function (navData) {
  const wbiImg = navData && navData.data && navData.data.wbi_img
  if (!wbiImg || !wbiImg.img_url || !wbiImg.sub_url) {
    throw new Error('无法获取 B 站 WBI 密钥')
  }
  return {
    imgKey: wbiImg.img_url.split('/').pop().replace(/\.png$/, ''),
    subKey: wbiImg.sub_url.split('/').pop().replace(/\.png$/, '')
  }
}

root.__MPLVR_HELPERS.signWbi = function (params, imgKey, subKey) {
  const raw = imgKey + subKey
  const mixinKey = MIXIN_KEY_ENC_TAB.map(i => raw[i]).join('').slice(0, 32)
  const signed = Object.assign({}, params, {wts: Math.floor(Date.now() / 1000)})
  const query = Object.keys(signed).sort().map(key => {
    const value = String(signed[key]).replace(/[!'()*]/g, '')
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }).join('&')
  signed.w_rid = CryptoJS.MD5(query + mixinKey).toString()
  return signed
}
