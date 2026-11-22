const test = require('node:test')
const assert = require('node:assert/strict')
const wbi = require('../src/helper/bilibili-wbi')

test('从 nav 数据中提取 WBI key', () => {
  const nav = {
    data: {
      wbi_img: {
        img_url: 'https://i0.hdslb.com/bfs/wbi/abc123.png',
        sub_url: 'https://i0.hdslb.com/bfs/wbi/def456.png'
      }
    }
  }
  assert.deepEqual(wbi.extractWbiKeys(nav), {imgKey: 'abc123', subKey: 'def456'})
})

test('签名结果包含 wts 与 32 位 w_rid', () => {
  const signed = wbi.sign({bvid: 'BV1xx411c7mD', cid: 123, fnval: 4048}, 'abc123', 'def456')
  assert.ok(signed.wts > 0)
  assert.match(signed.w_rid, /^[0-9a-f]{32}$/)
  assert.equal(signed.bvid, 'BV1xx411c7mD')
})
