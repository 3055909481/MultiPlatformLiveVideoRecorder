'use strict'

import fs from 'fs'
import path from 'path'
import vm from 'vm'

// 与 dart_simple_live 一致的 QQ 浏览器指纹，配合匿名 ttwid 可拿到全画质
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400'
const ANONYMOUS_TTWID = 'ttwid=1%7CB1qls3GdnZhUov9o2NxOMxxYS2ff6OSvEWbv0ytbES4%7C1680522049%7C280d802d6d478e3e78d0c807f7c487e7ffec0ae4e5fdd6a0fe74c3c6af149511'

const root = typeof window !== 'undefined' ? window : global
root.__MPLVR_HELPERS = root.__MPLVR_HELPERS || {}

let signContext = null

function resolveScriptPath () {
  const candidates = []
  if (root.__static) candidates.push(path.join(root.__static, 'douyin-abogus.js'))
  try {
    // eslint-disable-next-line no-undef
    const electron = typeof window !== 'undefined' ? require('electron').remote : require('electron')
    if (electron && electron.app && electron.app.getAppPath) {
      candidates.push(path.join(electron.app.getAppPath(), 'static', 'douyin-abogus.js'))
    }
  } catch (e) {
    // 忽略
  }
  candidates.push(path.join(__dirname, 'douyin-abogus.js'))
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch (e) {
      // 忽略
    }
  }
  return null
}

function getContext () {
  if (signContext) return signContext
  const scriptPath = resolveScriptPath()
  if (!scriptPath) throw new Error('找不到抖音签名脚本')
  const js = fs.readFileSync(scriptPath, 'utf8')
  const sandbox = {
    console,
    Date,
    Math,
    String,
    Array,
    Object,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    Buffer,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    Int32Array
  }
  vm.createContext(sandbox)
  vm.runInContext(js, sandbox)
  signContext = sandbox
  return sandbox
}

function randomMsToken (length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

root.__MPLVR_HELPERS.douyinSignUrl = function (url) {
  const ctx = getContext()
  const parsed = new URL(url)
  let msToken = parsed.searchParams.get('msToken') || ''
  if (!msToken) {
    msToken = randomMsToken(107)
    parsed.searchParams.set('msToken', msToken)
  }
  parsed.searchParams.delete('a_bogus')
  const query = parsed.searchParams.toString()
  const aBogus = vm.runInContext(
    `getABogus(${JSON.stringify(query)}, ${JSON.stringify(DEFAULT_UA)})`,
    ctx
  )
  parsed.searchParams.set('a_bogus', String(aBogus))
  return parsed.toString()
}

root.__MPLVR_HELPERS.DOUYIN_UA = DEFAULT_UA
root.__MPLVR_HELPERS.DOUYIN_TTWID = ANONYMOUS_TTWID
