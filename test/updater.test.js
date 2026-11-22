const test = require('node:test')
const assert = require('node:assert/strict')

// 直接复制纯函数逻辑验证（避免 electron 依赖）
function parseVersion (version) {
  if (!version) return [0, 0, 0, 0]
  const cleaned = String(version).replace(/^v/i, '')
  const numbers = cleaned
    .split(/[.-]/)
    .filter(part => /^\d+$/.test(part))
    .map(part => parseInt(part, 10))
  while (numbers.length < 4) numbers.push(0)
  return numbers.slice(0, 4)
}

function isNewer (remote, local) {
  const r = parseVersion(remote)
  const l = parseVersion(local)
  for (let i = 0; i < r.length; i++) {
    if (r[i] > l[i]) return true
    if (r[i] < l[i]) return false
  }
  return false
}

test('解析带 fork 后缀的版本号', () => {
  assert.deepEqual(parseVersion('v1.2.6-fork.0'), [1, 2, 6, 0])
  assert.deepEqual(parseVersion('1.2.5-fork.1'), [1, 2, 5, 1])
})

test('正确判断新版本', () => {
  assert.equal(isNewer('v1.2.7-fork.0', '1.2.6-fork.0'), true)
  assert.equal(isNewer('v1.3.0-fork.0', '1.2.6-fork.0'), true)
  assert.equal(isNewer('v1.2.6-fork.1', '1.2.6-fork.0'), true)
})

test('相同版本或旧版本不提示更新', () => {
  assert.equal(isNewer('v1.2.6-fork.0', '1.2.6-fork.0'), false)
  assert.equal(isNewer('v1.2.5-fork.0', '1.2.6-fork.0'), false)
})

function parseLatestVersion (finalUrl, html) {
  const urlMatch = /\/releases\/tag\/([^/?#]+)/.exec(finalUrl || '')
  if (urlMatch) return decodeURIComponent(urlMatch[1])
  const htmlMatch = /\/releases\/tag\/([^"?#<]+)/.exec(html || '')
  return htmlMatch ? decodeURIComponent(htmlMatch[1]) : ''
}

function parseAssetLink (html) {
  const hrefMatch = /href="([^"]*\/releases\/download\/[^"]+\.exe)"/.exec(html || '')
  if (!hrefMatch) return {downloadUrl: '', assetName: ''}
  const downloadUrl = hrefMatch[1].startsWith('http') ? hrefMatch[1] : `https://github.com${hrefMatch[1]}`
  return {downloadUrl, assetName: decodeURIComponent(downloadUrl.split('/').pop())}
}

test('从重定向 URL 解析最新版本号', () => {
  assert.equal(parseLatestVersion('https://github.com/x/y/releases/tag/v1.3.0-fork.0', ''), 'v1.3.0-fork.0')
})

test('从 HTML 兜底解析最新版本号', () => {
  const html = '<link rel="canonical" href="https://github.com/x/y/releases/tag/v1.3.0-fork.0">'
  assert.equal(parseLatestVersion('', html), 'v1.3.0-fork.0')
})

test('从资产页解析 exe 下载链接', () => {
  const html = '<a href="/3055909481/MultiPlatformLiveVideoRecorder/releases/download/v1.3.0-fork.0/MPLVR.Setup.1.3.0-fork.0.exe">Download</a>'
  const result = parseAssetLink(html)
  assert.equal(result.assetName, 'MPLVR.Setup.1.3.0-fork.0.exe')
  assert.ok(result.downloadUrl.indexOf('https://github.com') === 0)
})
