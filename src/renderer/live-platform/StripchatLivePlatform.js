import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'

function parseInput (idOrUrl) {
  if (!/^https?:\/\//i.test(idOrUrl)) {
    return {username: idOrUrl, origin: 'https://stripchat.com'}
  }
  const match = /^(https?:\/\/[\w.-]*stripchat\.com)\/([a-zA-Z0-9_-]+)/.exec(idOrUrl)
  if (match) {
    return {username: match[2], origin: match[1]}
  }
  return {username: idOrUrl, origin: 'https://stripchat.com'}
}

class StripchatLivePlatform extends LivePlatform {
  constructor () {
    super()
    // 参考 ChanTrail/StripchatRecorder：完整的浏览器指纹头可绕过 Cloudflare，无需 Cookie
    this.browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.6',
      'Cache-Control': 'max-age=0',
      Priority: 'u=0, i',
      'Sec-CH-UA': '"Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Linux"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Sec-GPC': '1',
      'Upgrade-Insecure-Requests': '1'
    }
    // CDN 客户端用另一套 UA
    this.cdnUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
  }

  headersFor (username) {
    return Object.assign({}, this.browserHeaders, {
      Referer: `https://stripchat.com/${username}`
    })
  }

  /**
   * 第一步：broadcasts 接口拿 modelId 与 isLive
   */
  async fetchBroadcast (username, origin) {
    origin = origin || 'https://stripchat.com'
    const url = `${origin}/api/front/v1/broadcasts/${username}`
    const res = await HttpUtil.get(url, this.headersFor(username))
    if (res.status === 403 || res.status === 418) {
      throw new Error(`Stripchat 拒绝访问（HTTP ${res.status}），请检查网络/代理设置`)
    }
    const item = res.data && res.data.item
    if (!item) {
      // 主播不存在时接口通常返回 404 或 error
      const msg = res.data && res.data.error ? res.data.error : `HTTP ${res.status}`
      throw new Error(`获取 Stripchat 主播信息失败（${msg}）`)
    }
    return item
  }

  /**
   * 第二步：cam 接口拿 status / streamName / username
   */
  async fetchCam (modelId, username, origin) {
    origin = origin || 'https://stripchat.com'
    const url = `${origin}/api/front/v2/models/${modelId}/cam`
    const res = await HttpUtil.get(url, this.headersFor(username))
    const data = res.data
    if (!data || !data.cam || !data.user) {
      const msg = data && data.error ? data.error : `HTTP ${res.status}`
      throw new Error(`获取 Stripchat 房间状态失败（${msg}）`)
    }
    return data
  }

  buildStreamUrls (modelId) {
    const urls = []
    // 多个 CDN 顶级域名，逐个尝试
    for (const tld of ['doppiocdn.com', 'doppiocdn.org', 'doppiocdn.net', 'doppiocdn.live']) {
      urls.push(`https://edge-hls.${tld}/hls/${modelId}/master/${modelId}_auto.m3u8`)
      urls.push(`https://edge-hls.${tld}/hls/${modelId}/master/${modelId}.m3u8`)
    }
    return urls
  }

  async getUserInfo (idOrUrl) {
    const {username, origin} = parseInput(idOrUrl)
    let name = username
    let namePlaceholder = false
    try {
      const item = await this.fetchBroadcast(username, origin)
      const data = await this.fetchCam(item.modelId, username, origin)
      name = (data.user && data.user.user && data.user.user.username) || username
    } catch (e) {
      namePlaceholder = true
    }
    return {
      id: username,
      idShow: username,
      name,
      namePlaceholder,
      origin,
      roomId: username
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const username = user.roomId || user.id
    const origin = user.origin || 'https://stripchat.com'
    const item = await this.fetchBroadcast(username, origin)
    const data = await this.fetchCam(item.modelId, username, origin)
    const cam = data.cam
    const userInfo = data.user && data.user.user
    const isLive = userInfo && (userInfo.isLive === true || item.isLive === true)
    const status = userInfo && userInfo.status
    // 只有 public 才可直接录制；private/groupShow 等不录
    if (!isLive || status !== 'public') return null

    const modelId = item.modelId || (cam && cam.streamName)
    const urls = this.buildStreamUrls(modelId)
    if (urls.length === 0) return null
    const streamUrl = urls[0]
    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${this.cdnUserAgent}\r\nReferer: https://stripchat.com/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy'
      },
      title: (cam && cam.topic) || user.name,
      quality: StripchatLivePlatform.defaultConfig.qualities[0],
      channel: preferenceChannel,
      backupStreamUrls: urls.slice(1)
    }
  }
}

StripchatLivePlatform.getUserRoomOrHomeUrl = function (user) {
  const origin = user.origin || 'https://stripchat.com'
  return origin + '/' + user.id
}

StripchatLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/(?:\w+\.)?stripchat\.com\/[a-zA-Z0-9_-]+/.test(url)
}

StripchatLivePlatform.platformInfo = {
  code: 'stripchat',
  name: 'Stripchat',
  website: 'https://stripchat.com'
}
StripchatLivePlatform.defaultConfig = {
  qualities: [
    {code: 'AUTO', name: '自动(HLS)', value: 'auto', orderIndex: 1}
  ],
  channels: [
    {code: 'DEFAULT', name: '默认线路', value: null, orderIndex: 1}
  ],
  defaultQualityCode: 'AUTO',
  defaultChannelCode: 'DEFAULT',
  idPlaceholder: '请输入 Stripchat 直播间地址或用户名',
  dynamicRoomId: false
}
export default StripchatLivePlatform
