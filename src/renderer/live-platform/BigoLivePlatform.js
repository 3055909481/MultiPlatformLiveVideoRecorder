import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'

function extractRoomId (idOrUrl) {
  if (!/^https?:\/\//i.test(idOrUrl)) return idOrUrl
  // 短链先不处理，主用普通链接
  if (idOrUrl.indexOf('&h=') > -1) return idOrUrl.split('&h=')[1].split('&')[0]
  if (idOrUrl.indexOf('?h=') > -1) return idOrUrl.split('?h=')[1].split('&')[0]
  const match = /https?:\/\/(?:www\.)?bigo\.tv\/[^/]*\/(\d+)/.exec(idOrUrl) ||
    /https?:\/\/(?:www\.)?bigo\.tv\/(\d+)/.exec(idOrUrl)
  return match ? match[1] : idOrUrl
}

class BigoLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.pcHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
      'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
      Referer: 'https://www.bigo.tv/',
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }

  async fetchRoom (roomId) {
    const res = await HttpUtil.post(
      'https://ta.bigo.tv/official_website/studio/getInternalStudioInfo',
      `siteId=${encodeURIComponent(roomId)}`,
      this.pcHeaders
    )
    const body = res.data
    if (!body || body.code !== 0 || !body.data) throw new Error('获取 Bigo 房间信息失败')
    return body.data
  }

  async getUserInfo (idOrUrl) {
    const roomId = extractRoomId(idOrUrl)
    const data = await this.fetchRoom(roomId)
    const name = data.nick_name || data.clientBigoId || roomId
    return {
      id: roomId,
      idShow: roomId,
      name,
      roomId: roomId
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const roomId = user.roomId || user.id
    const data = await this.fetchRoom(roomId)
    const alive = Number(data.alive)
    if (alive !== 1 || !data.hls_src) return null
    const streamUrl = data.hls_src
    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${this.pcHeaders['User-Agent']}\r\nReferer: https://www.bigo.tv/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy'
      },
      title: data.roomTopic || user.name,
      quality: BigoLivePlatform.defaultConfig.qualities[0],
      channel: preferenceChannel
    }
  }
}

BigoLivePlatform.getUserRoomOrHomeUrl = function (user) {
  return 'https://www.bigo.tv/cn/' + user.id
}

BigoLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/(?:www\.)?bigo\.tv\/.+/.test(url) ||
    /https?:\/\/slink\.bigovideo\.tv\/.+/.test(url)
}

BigoLivePlatform.platformInfo = {
  code: 'bigo',
  name: 'Bigo Live',
  website: 'https://www.bigo.tv'
}
BigoLivePlatform.defaultConfig = {
  qualities: [
    {code: 'HLS', name: '默认(HLS)', value: 'hls', orderIndex: 1}
  ],
  channels: [
    {code: 'DEFAULT', name: '默认线路', value: null, orderIndex: 1}
  ],
  defaultQualityCode: 'HLS',
  defaultChannelCode: 'DEFAULT',
  idPlaceholder: '请输入 Bigo 直播间地址或房间ID',
  dynamicRoomId: false
}
export default BigoLivePlatform
