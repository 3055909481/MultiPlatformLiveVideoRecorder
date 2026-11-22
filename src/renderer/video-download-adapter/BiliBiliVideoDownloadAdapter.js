import VideoDownloadAdapter from './VideoDownloadAdapter'
import httpUtil from '../utils/http-util'
import {getSettings} from '../config/settings'

const wbi = require('../../helper/bilibili-wbi')
const qs = require('query-string')

let wbiKeys = null
let wbiKeysExpire = 0

async function signedParams (params) {
  if (!wbiKeys || Date.now() > wbiKeysExpire) {
    const nav = await httpUtil.get('https://api.bilibili.com/x/web-interface/nav')
    wbiKeys = wbi.extractWbiKeys(nav.data)
    wbiKeysExpire = Date.now() + 6 * 60 * 60 * 1000
  }
  return wbi.sign(params, wbiKeys.imgKey, wbiKeys.subKey)
}

function parseVideoInfo (html) {
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*([^<]+?);\(function/,
    /window\.__INITIAL_STATE__\s*=\s*([^<]+?);/
  ]
  for (const pattern of patterns) {
    const found = pattern.exec(html)
    if (found) {
      try {
        const info = JSON.parse(found[1])
        if (info && info.videoData) return info
      } catch (e) {
        // 继续尝试下一个正则
      }
    }
  }
  throw new Error('获取视频信息失败，页面结构可能已变化')
}

class BiliBiliVideoDownloadAdapter extends VideoDownloadAdapter {
  constructor () {
    super()
    this.httpHeaders = {
      'User-Agent': this.pcUserAgent,
      Referer: 'https://www.bilibili.com/',
      Origin: 'https://www.bilibili.com'
    }
  }

  async requestHeaders (extraCookie) {
    const settings = (await getSettings()) || {}
    const cookie = extraCookie || settings.biliBiliUserCookie || ''
    return Object.assign({}, this.httpHeaders, cookie ? {Cookie: cookie} : {})
  }

  async ffmpegHeaders () {
    const settings = (await getSettings()) || {}
    const cookie = settings.biliBiliUserCookie || ''
    return `Referer: https://www.bilibili.com/\r\nOrigin: https://www.bilibili.com\r\nUser-Agent: ${this.pcUserAgent}${cookie ? `\r\nCookie: ${cookie}` : ''}`
  }

  async getDownloadInfo (url, preferenceQuality) {
    const preferenceQualityCode = preferenceQuality && preferenceQuality.code
    return new Promise(async (resolve, reject) => {
      try {
        const headers = await this.requestHeaders()
        const videoPageHtml = (await httpUtil.get(url, headers)).data
        const videoInfo = parseVideoInfo(videoPageHtml)
        const cid = videoInfo.videoData.cid
        const title = videoInfo.videoData.title
        const bvid = videoInfo.videoData.bvid
        const owner = videoInfo.videoData.owner && videoInfo.videoData.owner.name ? videoInfo.videoData.owner.name : ''
        const qualityOption = this.getQuality(preferenceQualityCode)
        const qn = qualityOption ? qualityOption.value : 116

        const legacyParams = {
          cid,
          bvid,
          qn,
          fnval: 4048,
          fnver: 0,
          fourk: 1,
          otype: 'json'
        }
        let data = null
        try {
          const wbiParams = await signedParams(Object.assign({}, legacyParams))
          const wbiRes = await httpUtil.postExchange({
            config: {
              method: 'get',
              url: `https://api.bilibili.com/x/player/wbi/playurl?${qs.stringify(wbiParams)}`,
              headers
            }
          })
          if (wbiRes.data && wbiRes.data.code === 0 && wbiRes.data.data) {
            data = wbiRes.data.data
          }
        } catch (e) {
          // WBI 失败时使用旧接口兜底
        }
        if (!data) {
          const legacyRes = await httpUtil.postExchange({
            config: {
              method: 'get',
              url: `https://api.bilibili.com/x/player/playurl?${qs.stringify(legacyParams)}`,
              headers
            }
          })
          if (!legacyRes.data || legacyRes.data.code !== 0 || !legacyRes.data.data) {
            throw new Error('获取播放地址失败')
          }
          data = legacyRes.data.data
        }

        const quality = this.getQualityByValue(Number(data.quality)) || qualityOption
        const ffmpegHeaders = await this.ffmpegHeaders()
        if (data.durl && data.durl.length > 0) {
          const flvUrl = data.durl[0].url
          resolve({
            streamUrls: flvUrl,
            title,
            owner,
            quality,
            ffmpegCommandOutputOption: {
              '-headers': ffmpegHeaders,
              '-i': flvUrl,
              '-c': 'copy'
            }
          })
          return
        }
        if (!data.dash || (!data.dash.video || data.dash.video.length === 0)) {
          throw new Error('播放地址中没有可用的视频流')
        }
        const dashVideo = data.dash.video[0]
        const dashVideoUrl = dashVideo.baseUrl || dashVideo.base_url || dashVideo.url
        const dashAudio = data.dash.audio && data.dash.audio.length > 0 ? data.dash.audio[0] : null
        const options = [{
          '-headers': ffmpegHeaders,
          '-i': dashVideoUrl
        }]
        if (dashAudio) {
          const dashAudioUrl = dashAudio.baseUrl || dashAudio.base_url || dashAudio.url
          options.push({
            '-headers': ffmpegHeaders,
            '-i': dashAudioUrl,
            '-c': 'copy'
          })
        } else {
          options[0]['-c'] = 'copy'
        }
        resolve({
          streamUrls: dashVideoUrl,
          title,
          owner,
          quality,
          ffmpegCommandOutputOption: options
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  async getVideoDetails (url) {
    return new Promise(async (resolve, reject) => {
      try {
        const headers = await this.requestHeaders()
        const spaceMatch = /https?:\/\/space\.bilibili\.com\/(\d+)[/?$]/.exec(url)
        const listMatch = /https?:\/\/www\.bilibili\.com\/medialist\/play\/(\d+)[/?]/.exec(url)
        if (!spaceMatch && !listMatch) {
          const html = (await httpUtil.get(url, headers)).data
          const videoInfo = parseVideoInfo(html)
          resolve([{
            id: videoInfo.bvid,
            title: videoInfo.videoData.title,
            cover: videoInfo.videoData.pic,
            url: url
          }])
          return
        }

        const videoDetailList = []
        if (spaceMatch) {
          // 用户主页：2024 起 space/arc/search 必须 WBI 签名
          const mid = spaceMatch[1]
          for (let page = 1; page <= 20; page++) {
            const params = await signedParams({mid, ps: 50, pn: page, order: 'pubdate', tid: 0, keyword: ''})
            const res = await httpUtil.postExchange({
              config: {
                method: 'get',
                url: `https://api.bilibili.com/x/space/wbi/arc/search?${qs.stringify(params)}`,
                headers
              }
            })
            if (!res.data || res.data.code !== 0 || !res.data.data || !res.data.data.list) {
              throw new Error((res.data && res.data.message) || '获取用户视频列表失败')
            }
            const vlist = res.data.data.list.vlist || []
            for (const video of vlist) {
              videoDetailList.push({
                id: video.bvid,
                title: video.title,
                cover: video.pic,
                url: `https://www.bilibili.com/video/${video.bvid}`
              })
            }
            if (vlist.length < 50) break
          }
          resolve(videoDetailList)
          return
        }

        // 播放列表接口暂不需要签名
        const uid = listMatch[1]
        let hasMore = true
        let oid = 0
        const listApi = `https://api.bilibili.com/x/v2/medialist/resource/list?type=1&otype=2&biz_id=${uid}&bvid=&with_current=true&mobi_app=web&ps=100&direction=false&sort_field=1&tid=0&desc=true&oid=`
        while (hasMore) {
          const res = await httpUtil.postExchange({
            config: {method: 'get', url: listApi + oid, headers}
          })
          const data = res.data && res.data.data
          if (!data || !data.media_list || data.media_list.length === 0) break
          hasMore = data.has_more
          for (const video of data.media_list) {
            if (video.id === oid) continue
            videoDetailList.push({
              id: video.bv_id,
              title: video.title,
              cover: video.cover,
              url: `https://www.bilibili.com/video/${video.bv_id}`
            })
          }
          oid = data.media_list[data.media_list.length - 1].id
        }
        resolve(videoDetailList)
      } catch (e) {
        reject(e)
      }
    })
  }

  getQuality (code) {
    for (let quality of BiliBiliVideoDownloadAdapter.defaultConfig.qualities) {
      if (code === quality.code) return quality
    }
    return null
  }

  getQualityByValue (value) {
    for (let quality of BiliBiliVideoDownloadAdapter.defaultConfig.qualities) {
      if (value === quality.value) return quality
    }
    return null
  }
}
BiliBiliVideoDownloadAdapter.info = {
  code: 'bilibili',
  name: '哔哩哔哩',
  webUrl: 'https://www.bilibili.com'
}

BiliBiliVideoDownloadAdapter.defaultConfig = {
  qualities: [
    {code: 'LC360P', name: '流畅 360P', value: 16, orderIndex: 1},
    {code: 'QX480P', name: '清晰 480P', value: 32, orderIndex: 2},
    {code: 'GQ720P', name: '高清 720P', value: 64, orderIndex: 3},
    {code: 'GQ1080P', name: '高清 1080P', value: 80, orderIndex: 4},
    {code: 'GQ1080PGM', name: '高清 1080P高码率', value: 112, orderIndex: 5},
    {code: 'GQ1080P60', name: '高清 1080P60帧', value: 116, orderIndex: 6},
    {code: '4KCQ', name: '超清 4K', value: 120, orderIndex: 7}
  ]
}
export default BiliBiliVideoDownloadAdapter
