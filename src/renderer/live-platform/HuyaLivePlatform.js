import LivePlatform from './live-platform.js'
import HttpUtil from '../utils/http-util.js'
import CryptoJS from 'crypto-js'

function decodeHtmlEntities (text) {
  return String(text).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

class HuyaLivePlatform extends LivePlatform {
  constructor () {
    super()
    this.httpHeaders = {
      'User-Agent': this.pcUserAgent,
      Referer: 'https://www.huya.com/',
      Origin: 'https://www.huya.com'
    }
  }

  getId (idOrUrl) {
    return !this.isUrl(idOrUrl) ? idOrUrl : new RegExp('https?://(?:www\\.|m\\.|)huya.com/([^/?]+)').exec(idOrUrl)[1]
  }

  /**
   * 虎牙房间数据目前藏在 PC 页面 stream 字段中，可能为 JSON 或 base64
   */
  async getRoomData (id) {
    const res = await HttpUtil.get(`https://www.huya.com/${id}`, this.httpHeaders)
    const html = res.data
    const match = /stream:\s*(\[[\s\S]*?\])\s*[,;]/.exec(html)
    let streamData = null
    if (match) {
      try {
        streamData = JSON.parse(match[1])
      } catch (e) {
        try {
          streamData = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
        } catch (e2) {
          streamData = null
        }
      }
    }
    if (!streamData || !streamData[0]) {
      // 兼容旧版页面
      const fallback = /window\.HNF_GLOBAL_INIT\s*=\s*([^<]*)/.exec(html)
      if (fallback) {
        const oldData = JSON.parse(fallback[1]).roomInfo.tLiveInfo.tLiveStreamInfo
        return {
          title: oldData.roomName || '',
          name: oldData.nick || '',
          streams: (oldData.vStreamInfo && oldData.vStreamInfo.value) || [],
          bitRates: ((oldData.vBitRateInfo && oldData.vBitRateInfo.value) || []).map(q => q.iBitRate)
        }
      }
      throw new Error('获取虎牙房间信息失败，请检查房间号')
    }
    const room = streamData[0]
    const liveInfo = room.gameLiveInfo || {}
    const streams = room.gameStreamInfoList || []
    const bitRates = []
    for (const stream of streams) {
      for (const quality of (stream.vMultiStreamInfo || [])) {
        if (quality.iBitRate !== undefined && bitRates.indexOf(quality.iBitRate) < 0) {
          bitRates.push(quality.iBitRate)
        }
      }
    }
    return {
      title: liveInfo.roomName || '',
      name: liveInfo.nick || '',
      streams,
      bitRates
    }
  }

  async getUserInfo (idOrUrl) {
    const roomId = this.getId(idOrUrl)
    try {
      const roomInfo = await this.getRoomData(roomId)
      return {
        id: roomId,
        idShow: roomId,
        name: roomInfo.name || roomId,
        roomId: roomId
      }
    } catch (e) {
      // 页面结构变化时退回房间号作为昵称
      return {id: roomId, idShow: roomId, name: roomId, roomId: roomId}
    }
  }

  async check (user, preferenceQuality, preferenceChannel) {
    const roomInfo = await this.getRoomData(user.id)
    if (!roomInfo.streams || roomInfo.streams.length === 0) {
      // 未开播
      return null
    }
    const usableQualityValues = roomInfo.bitRates.length > 0 ? roomInfo.bitRates : ['0']
    const realQuality = LivePlatform.getPreference('value', 'orderIndex', HuyaLivePlatform.defaultConfig.qualities, usableQualityValues, preferenceQuality.value)
    if (!realQuality) {
      throw new Error('无可用清晰度')
    }
    const realChannel = preferenceChannel
    const streamInfo = roomInfo.streams[0]
    const streamUrl = this.generateStreamUrl(streamInfo, realQuality.value)
    return {
      streamUrl,
      ffmpegCommandOutputOption: {
        '-headers': `User-Agent: ${this.pcUserAgent}\r\nReferer: https://www.huya.com/`,
        '-i': streamUrl,
        '-v': 'trace',
        '-c': 'copy',
        '-flvflags': 'add_keyframe_index'
      },
      title: roomInfo.title,
      quality: realQuality,
      channel: realChannel
    }
  }

  /**
   * 按 2025+ 虎牙 web 端 antiCode 规则生成 FLV 地址
   */
  generateStreamUrl (streamInfo, ratio) {
    const antiCode = decodeHtmlEntities(streamInfo.sFlvAntiCode || '')
    const params = new URLSearchParams(antiCode)
    const fm = params.get('fm') || ''
    const wsTime = params.get('wsTime') || ''
    const ctype = params.get('ctype') || 'huya_web'
    const fs = params.get('fs') || ''
    if (!fm || !wsTime) {
      throw new Error('虎牙直播流 antiCode 缺少必要字段')
    }
    const uid = Math.floor(Math.random() * 9999) + 12340000
    const convertUid = ((uid << 8) | (uid >>> 24)) & 0xffffffff
    const seqid = uid + Date.now()
    const prefix = Buffer.from(decodeURIComponent(fm), 'base64').toString('utf8').split('_')[0]
    const hash = CryptoJS.MD5(`${seqid}|${ctype}|100`).toString()
    const wsSecret = CryptoJS.MD5(`${prefix}_${convertUid}_${streamInfo.sStreamName}_${hash}_${wsTime}`).toString()
    const host = String(streamInfo.sFlvUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
    const suffix = streamInfo.sFlvUrlSuffix || 'flv'
    const query = [
      `wsSecret=${wsSecret}`,
      `wsTime=${wsTime}`,
      `ctype=${encodeURIComponent(ctype)}`,
      `seqid=${seqid}`,
      `u=${convertUid}`,
      `sdk_sid=${Date.now()}`,
      `ratio=${ratio}`,
      't=100',
      'ver=1',
      'sv=2401090219',
      'codec=264'
    ]
    if (fs) query.push(`fs=${encodeURIComponent(fs)}`)
    return `https://${host}/${streamInfo.sStreamName}.${suffix}?${query.join('&')}`
  }
}

HuyaLivePlatform.getUserRoomOrHomeUrl = function (user) {
  return 'https://www.huya.com/' + user.id
}

HuyaLivePlatform.isSupportedUrl = function (url) {
  return /https?:\/\/(m|www)\.huya\.com\/.*/.test(url)
}

HuyaLivePlatform.platformInfo = {
  code: 'huya',
  name: '虎牙',
  website: 'https://www.huya.com'
}
HuyaLivePlatform.defaultConfig = {
  qualities: [
    {code: 'LC', name: '流畅', value: '500', orderIndex: 1},
    {code: 'CQ', name: '超清', value: '2000', orderIndex: 2},
    {code: 'LG-4M', name: '蓝光4M', value: '4000', orderIndex: 3},
    {code: 'LG-8M', name: '蓝光8M', value: '0', orderIndex: 4}
  ],
  channels: [
    {code: 'AL-FLV', name: '线路1', value: null, orderIndex: 1}
  ],
  defaultQualityCode: 'LG-8M',
  defaultChannelCode: 'AL-FLV',
  idPlaceholder: '请输入直播间地址或房间号',
  dynamicRoomId: false
}
export default HuyaLivePlatform
