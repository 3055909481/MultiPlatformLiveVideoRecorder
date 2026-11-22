const test = require('node:test')
const assert = require('node:assert/strict')
require('../src/helper/safe-url')
const isSafeTargetUrl = global.__MPLVR_HELPERS.isSafeTargetUrl

test('允许访问公网 http(s) 平台地址', () => {
  assert.equal(isSafeTargetUrl('https://www.douyu.com/12345'), true)
  assert.equal(isSafeTargetUrl('http://m.huya.com/abc'), true)
})

test('阻止本地、内网与元数据地址', () => {
  assert.equal(isSafeTargetUrl('http://127.0.0.1:8080/admin'), false)
  assert.equal(isSafeTargetUrl('http://localhost:31091'), false)
  assert.equal(isSafeTargetUrl('http://192.168.1.1'), false)
  assert.equal(isSafeTargetUrl('http://10.0.0.5'), false)
  assert.equal(isSafeTargetUrl('http://172.16.0.1'), false)
  assert.equal(isSafeTargetUrl('http://169.254.169.254/latest/meta-data'), false)
  assert.equal(isSafeTargetUrl('https://printer.internal'), false)
})

test('阻止非 http(s) 协议与非法地址', () => {
  assert.equal(isSafeTargetUrl('file:///etc/passwd'), false)
  assert.equal(isSafeTargetUrl('ftp://example.com'), false)
  assert.equal(isSafeTargetUrl('not a url'), false)
})
