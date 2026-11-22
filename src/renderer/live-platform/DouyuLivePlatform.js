import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'
// 斗鱼签名混淆代码需要真实浏览器环境执行，这里放到主进程的隐藏窗口（无 Node 权限）
import IpcChannel from '../../helper/IpcChannel'
import ipcRendererUtil from '../../helper/ipcRendererUtil'
import CryptoJS from 'crypto-js'
import uuid4 from 'uuid/v4'
import qs from 'query-string'

function getSignFromWindow (rid, code, did, t10) {
  return new Promise((resolve, reject) => {
    const listener = (event, key, success, data) => {
      if (key !== rid) return
      ipcRendererUtil.removeListener(IpcChannel.getDouyuSignReply, listener)
      if (success) resolve(data)
      else reject(new Error('斗鱼签名计算失败'))
    }
    ipcRendererUtil.on(IpcChannel.getDouyuSignReply, listener)
    ipcRendererUtil.sendToMain(IpcChannel.getDouyuSign, rid, code, did, t10)
  })
}

async function getSignFn (rid) {
  const res = await HttpUtil.get('https://www.douyu.com/swf_api/homeH5Enc?rids=' + rid)
  const json = res.data
  if (json.error !== 0) throw new Error('斗鱼签名接口返回异常')
  const code = json.data && json.data['room' + rid]
  if (!code) throw new Error('斗鱼签名代码块不存在')
  return async (roomId, did, t10) => getSignFromWindow(rid, code, did, t10)
}

class DouyuLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.httpHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': this.pcUserAgent
    }
  }

  getId (idOrUrl) {
    if (!this.isUrl(idOrUrl)) return idOrUrl
    if (idOrUrl.indexOf('?') > -1) {
      const found = new RegExp('https?://(?:www\\.|m\\.|)douyu.com/[^?]*\\?rid=([^&]+)', 'g').exec(idOrUrl)
      return found ? found[1] : idOrUrl
    }
    const found = new RegExp('https?://(?:www\\.|m\\.|)douyu.com/([^/?]+)', 'g').exec(idOrUrl)
    return found ? found[1] : idOrUrl
  }

  async getUserInfo (idOrUrl) {
    const url = this.isUrl(idOrUrl) ? idOrUrl : `https://www.douyu.com/${idOrUrl}`
    const res = await HttpUtil.get(url, this.httpHeaders)
    const html = res.data
    let userName = ''
    const namePatterns = [
      /<div class="Title-anchorName" title="([^<>]+)">/,
      /"nickname"\s*:\s*"([^"]+)"/,
      /<h1[^>]*class="[^"]*anchor[^"]*"[^>]*>([^<>]+)<\/h1>/
    ]
    for (const pattern of namePatterns) {
      const found = pattern.exec(html)
      if (found) {
        userName = found[1]
        break
      }
    }
    const id = this.getId(idOrUrl)
    return {id, idShow: id, name: userName || id, roomId: id}
  }

  /**
   * 免签名预览流，作为动态签名失败时的兜底（预览流可能无法选择清晰度）
   */
  async getPreviewStream (rid, user) {
    const time = String(Date.now())
    const auth = CryptoJS.MD5(`${rid}${time}`).toString()
    const res = await HttpUtil.post(
      `https://playweb.douyucdn.cn/lapi/live/hlsH5Preview/${rid}`,
      qs.stringify({rid, did: '10000000000000000000000000001501'}),
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.pcUserAgent,
        rid,
        time,
        auth
      }
    )
    const body = res.data
    if (body && body.error === 104) return null
    if (!body || body.error !== 0 || !body.data || !body.data.rtmp_live) {
      throw new Error('斗鱼预览流获取失败')
    }
    const streamUrl = `${body.data.rtmp_url}/${body.data.rtmp_live}`
    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${this.pcUserAgent}`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy',
        '-flvflags': 'add_keyframe_index'
      },
      title: user.name || rid,
      quality: {code: 'PREVIEW', name: '预览流', value: null, orderIndex: 0},
      channel: {code: 'DEFAULT', name: '默认线路', value: null, orderIndex: 0}
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const homeRes = await HttpUtil.get('https://m.douyu.com/' + user.id, this.httpHeaders)
    let roomId = user.id
    const ridMatch = /rid":(\d{1,8}),"vipId/.exec(homeRes.data)
    if (ridMatch) roomId = ridMatch[1]

    try {
      const sign = await getSignFn(roomId)
      let did = uuid4().replace(/-/g, '')
      let t10 = String(Math.floor(Date.now().valueOf() / 1000))
      const postData = await sign(roomId, did, t10)
      const previewRes = await HttpUtil.post(`https://playweb.douyu.com/lapi/live/getH5Play/${roomId}`, postData, this.httpHeaders)
      if (!previewRes.data || !previewRes.data.data || !previewRes.data.data.rtmp_live) {
        return null
      }
      const usableQualityNameMap = {}
      for (const quality of (previewRes.data.data.multirates || [])) {
        usableQualityNameMap[quality.name] = quality
      }
      const realQuality = LivePlatform.getPreference('name', 'orderIndex', DouyuLivePlatform.defaultConfig.qualities, Object.keys(usableQualityNameMap), preferenceQuality.name)
      if (!realQuality) throw new Error('无可用清晰度')
      const realQualityUsed = Object.assign({}, realQuality)
      realQualityUsed.value = usableQualityNameMap[realQualityUsed.name].rate

      did = uuid4().replace(/-/g, '')
      t10 = String(Math.floor(Date.now().valueOf() / 1000))
      const secondSign = await sign(roomId, did, t10)
      const postSignData = qs.stringify(Object.assign({}, qs.parse(secondSign), {
        cdn: preferenceChannel.value,
        rate: realQualityUsed.value || 0,
        iar: 0,
        ive: 0
      }))
      const streamRes = await HttpUtil.post(`https://www.douyu.com/lapi/live/getH5Play/${roomId}`, postSignData, this.httpHeaders)
      const streamUrl = `${streamRes.data.data.rtmp_url}/${streamRes.data.data.rtmp_live}`
      return {
        streamUrl,
        ffmpegCommandOutputOption: {
          '-headers': `User-Agent: ${this.pcUserAgent}`,
          '-i': streamUrl,
          '-v': 'trace',
          '-c': 'copy',
          '-flvflags': 'add_keyframe_index'
        },
        title: user.name || roomId,
        quality: realQualityUsed,
        channel: preferenceChannel
      }
    } catch (e) {
      // 动态签名失败时退回免签名预览流
      return this.getPreviewStream(roomId, user)
    }
  }
}

DouyuLivePlatform.getUserRoomOrHomeUrl = function (user) {
  return 'https://www.douyu.com/' + user.id
}

DouyuLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/(m|www)\.douyu\.com\/.*/.test(url)
}

DouyuLivePlatform.platformInfo = {
  code: 'douyu',
  name: '斗鱼TV',
  website: 'https://www.douyu.com'
}
DouyuLivePlatform.defaultConfig = {
  qualities: [
    {code: 'GQ', name: '高清', value: '900', orderIndex: 1},
    {code: 'CQ', name: '超清', value: '2000', orderIndex: 2},
    {code: 'LG-4M', name: '蓝光4M', value: '4000', orderIndex: 3},
    {code: 'YH-480P20', name: '原画480P20', value: null, orderIndex: 4},
    {code: 'YH-480P30', name: '原画480P30', value: null, orderIndex: 5},
    {code: 'YH-720P20', name: '原画720P20', value: null, orderIndex: 6},
    {code: 'YH-720P30', name: '原画720P30', value: null, orderIndex: 7},
    {code: 'YH-1080P10', name: '原画1080P10', value: null, orderIndex: 8},
    {code: 'YH-1080P20', name: '原画1080P20', value: null, orderIndex: 9},
    {code: 'YH-1080P30', name: '原画1080P30', value: null, orderIndex: 10},
    {code: 'YH-1080P40', name: '原画1080P40', value: null, orderIndex: 11},
    {code: 'YH-1080P50', name: '原画1080P50', value: null, orderIndex: 12},
    {code: 'YH-1080P60', name: '原画1080P60', value: null, orderIndex: 13}
  ],
  channels: [
    {code: 'TENCENT', name: '腾讯云', value: 'tct', orderIndex: 1},
    {code: 'TENCENT-H5', name: '腾讯云-H5', value: 'tct-h5', orderIndex: 2},
    {code: 'ZHUXIAN-WANGXIU', name: '主线 (网宿)', value: 'ws', orderIndex: 3},
    {code: 'ZHUXIAN-WANGXIU-H5', name: '主线-H5 (网宿)', value: 'ws-h5', orderIndex: 4},
    {code: 'ALI-H5', name: '阿里云-H5', value: 'ali-h5', orderIndex: 5},
    {code: 'WANGXIU-2', name: '网宿2', value: 'ws2', orderIndex: 6},
    {code: 'DILIAN', name: '帝联', value: 'dl', orderIndex: 7}
  ],
  defaultQualityCode: 'YH-1080P60',
  defaultChannelCode: 'TENCENT',
  idPlaceholder: '请输入直播间地址或房间号',
  dynamicRoomId: false
}
export default DouyuLivePlatform
