import Vue from 'vue'
import log from '../config/log'
import livePlatform from '../live-platform/index'
import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import {illegalPathCharRemove, sleep} from '../../helper'
import {getSettings} from '../config/settings'
// import store from '../../main/store'

const recordManager = new Vue({
  functional: true,
  data () {
    return {
      hasInit: false,
      recordStatus: {
        checking: -1,
        waitToCheck: 0,
        recording: 1
      },
      recordHistoryStatus: {
        failed: -1,
        unexpectedExit: 0,
        recording: 1,
        success: 2
      },
      // queue: [],
      // recordQueueIndex: {},
      stopCallbackMap: {},
      // 录制异常中断的退避信息：{recordId: {failures, lastFailTime}}
      reconnectBackoff: {},
      // 续录状态：{recordId: {targetPath, tempPath}}
      resumeState: {},
      // 设为false关闭自动扫描检查录制
      checkRunning: true,
      // 检查扫描窗口（ms）
      checkScanWindow: 1000,
      // 全局设置
      globalSettings: {
        defaultOuPutDir: null
      },
      statusChangeListener: null
    }
  },
  mounted () {
    console.log(this.$dbs.record.filename)
  },
  methods: {
    async init () {
      log.info('初始化录制管理')
      if (!this.hasInit) {
        // 防止多次加载导致正在正常录制任务重置
        this.hasInit = true
      } else {
        return
      }
      await this.fixDatabase()
      // 获取全局设置
      const gSettings = await getSettings()
      if (gSettings) {
        // 如果有设置则使用，否则使用默认设置
        this.globalSettings = gSettings
      }
      while (this.checkRunning) {
        // 自动检查由每个录制任务自己的 settings.autoCheck 控制，不再有全局开关
        try {
          log.info('正在检查...')
          console.log(this.stopCallbackMap)
          console.log(Object.keys(this.stopCallbackMap))
          // 查询自动检查且未正在录制的记录
          const records = await this.$dbs.record._find_({'settings.autoCheck': true, status: {$ne: this.recordStatus.recording}}).catch(e => {
            log.error('获取自动检查录制列表失败')
          })
          if (!records || records.length === 0) {
            // 无自动检查的录制任务，1秒后再次扫描
            await sleep(this.checkScanWindow)
            continue
          }
          // 运行时防护：同一平台+同一主播只让一个任务检查，避免重复任务互相冲突
          // （即使启动时去重因故未清理干净，也能防止并发录制产生碎片）
          const seenUser = {}
          const deduped = []
          for (const r of records) {
            const code = r.platform && r.platform.code
            const uid = r.user && (r.user.id != null ? r.user.id : r.user.name)
            const key = code + '|' + uid
            if (seenUser[key]) continue
            seenUser[key] = true
            deduped.push(r)
          }
          for (const record of deduped) {
            if (this.stopCallbackMap[record._id]) {
              // 正在录制，跳过
              continue
            }
            // 录制任务设置的检查窗口（间隔）时间
            const checkWindow = Number(record.settings.checkWindow)
            if (!record.lastCheckTime || new Date().getTime() > record.lastCheckTime.getTime() + (checkWindow * 1000)) {
              // 当前时间大于上次检查时间+检查窗口，检查并启动录制
              console.log(`检查${record._id}`)
              this.checkAndStartRecord(record._id)
            }
          }
          // 1秒后再次扫描
          await sleep(this.checkScanWindow)
        } catch (e) {
          log.error('录制检查出错:' + e.message)
        }
      }
    },
    async fixDatabase () {
      // 只重置上次退出时仍处于「检查中/录制中」的残留状态，不改动正常等待中的任务
      await this.$dbs.record._update_({
        status: {$in: [this.recordStatus.checking, this.recordStatus.recording]}
      }, {$set: {status: this.recordStatus.waitToCheck}}, {multi: true})
      await this.$dbs.recordHistory._update_({status: this.recordHistoryStatus.recording}, {$set: {status: this.recordHistoryStatus.unexpectedExit, stopRecordTime: new Date()}}, {multi: true})
      // 清理同一平台+同一主播的重复任务（历史遗留），只保留最早创建的一条
      await this.dedupeRecords()
    },
    /**
     * 自动去重：同平台 + 同主播(user.id) 只保留一个录制任务，删除其余。
     * 重复任务会同时监控同一直播、互相冲突，产生大量短片段。
     */
    async dedupeRecords () {
      try {
        const all = await this.$dbs.record._find_({})
        if (!all || all.length === 0) return
        const groups = {}
        for (const r of all) {
          const code = r.platform && r.platform.code
          const uid = r.user && (r.user.id != null ? r.user.id : r.user.name)
          if (!code || !uid) continue
          const key = code + '|' + uid
          if (!groups[key]) groups[key] = []
          groups[key].push(r)
        }
        // 配置签名：只删除配置完全相同的重复项，避免误删用户有意保留的不同配置
        const signature = r => {
          const s = r.settings || {}
          const q = s.preferenceQuality || {}
          const c = s.preferenceChannel || {}
          return JSON.stringify([
            s.autoCheck, s.checkWindow, s.fileFormat, s.autoFragment, s.fragmentLength,
            q.code, c.code
          ])
        }
        let removed = 0
        for (const key of Object.keys(groups)) {
          const list = groups[key]
          if (list.length <= 1) continue
          // 按创建时间升序，保留最早的一条
          // 兼容 nedb 的日期格式 {"$$date": 时间戳}
          const ts = v => {
            if (!v) return 0
            if (v && typeof v === 'object' && v.$$date) return new Date(v.$$date).getTime()
            const n = new Date(v).getTime()
            return Number.isFinite(n) ? n : 0
          }
          list.sort((a, b) => ts(a.createTime) - ts(b.createTime))
          const keptSig = signature(list[0])
          for (let i = 1; i < list.length; i++) {
            // 配置不同的保留（可能是用户有意的多配置）
            if (signature(list[i]) !== keptSig) continue
            if (this.stopCallbackMap[list[i]._id]) this.stopRecord(list[i]._id)
            await this.$dbs.record._remove_({_id: list[i]._id}, {})
            removed++
          }
        }
        if (removed > 0) console.log(`[去重] 清理了 ${removed} 个配置完全相同的重复录制任务`)
      } catch (e) {
        console.log('去重失败:', e.message)
      }
    },
    async fixUnexpectedRecordHistory () {
      try {
        const docs = await this.$dbs.recordHistory._find_({status: this.recordHistoryStatus.unexpectedExit})
        if (docs && docs.length > 0) {
          // 调用ffmpeg补齐关键帧
        }
      } catch (e) {
        console.log('修复意外退出导致损坏的录制文件失败: ' + e.message)
      }
    },
    newStatusChangeListener () {
      // start/end 只有开播才调用
      const changeListener = {
        startCheck: null,
        endCheck: null,
        start: null,
        doing: null,
        end: null,
        error: null,
        onStartCheck: function (call) {
          this.startCheck = call
          return changeListener
        },
        onEndCheck: function (call) {
          this.endCheck = call
          return changeListener
        },
        onStart: function (call) {
          this.start = call
          return changeListener
        },
        onDoing: function (call) {
          this.doing = call
          return changeListener
        },
        onEnd: function (call) {
          this.end = call
          return changeListener
        },
        onError: function (call) {
          this.error = call
          return changeListener
        }
      }
      return changeListener
    },
    getStatusChangeListenerHandler (listener) {
      return {
        startCheck: function (options, record) {
          if (listener && listener.startCheck) {
            if (!options) {
              options = {}
            }
            listener.startCheck(options, record)
          }
        },
        endCheck: function (options, record, isLive, continueRecord) {
          if (listener && listener.endCheck) {
            if (!options) {
              options = {}
            }
            continueRecord = continueRecord != null ? continueRecord : isLive
            listener.endCheck(options, record, isLive, continueRecord)
          }
        },
        start: function (options, record, recordHistory) {
          if (listener && listener.start) {
            if (!options) {
              options = {}
            }
            listener.start(options, record, recordHistory)
          }
        },
        doing: function (options, record, recordHistory) {
          if (listener && listener.doing) {
            if (!options) {
              options = {}
            }
            listener.doing(options, record, recordHistory)
          }
        },
        end: function (options, record) {
          if (listener && listener.end) {
            if (!options) {
              options = {}
            }
            listener.end(options, record)
          }
        },
        error: function (options, record, e) {
          if (listener && listener.error) {
            if (!options) {
              options = {}
            }
            listener.error(options, record, e)
          }
        }
      }
    },
    setGlobalSettings (globalSettings) {
      this.globalSettings = globalSettings
    },
    getRecordHomePath (record) {
      // 获取平台信息
      const Platform = livePlatform.getPlatform(record.platform.code)
      // 生成文件路径 ${outPutDir}/${platformName}/${userName}
      const fileDir = path.join(record.settings.outPutDir, path.join(illegalPathCharRemove(Platform.platformInfo.name), illegalPathCharRemove(record.user.name)))
      if (!fs.existsSync(fileDir)) {
        fs.mkdirsSync(fileDir)
      }
      return fileDir
    },
    /**
     * 获取正在录制的任务线路名称、清晰度名称
     * @param recordId
     * @return {Promise<unknown>}
     */
    getRecordingQualityAndChannel (recordId) {
      return new Promise(async (resolve, reject) => {
        // 查找最新一条正在录制的记录
        this.$dbs.recordHistory.$find({recordId: recordId, status: this.recordHistoryStatus.recording}).sort({startRecordTime: -1}).limit(1).then((e, docs) => {
          if (e) {
            reject(e)
          } else {
            resolve({
              qualityName: docs[0].quality.name,
              channelName: docs[0].channel.name
            })
          }
        })
      })
    },
    handlerListener () {
      return this.getStatusChangeListenerHandler(this.statusChangeListener)
    },
    setStatusChangeListener (listener) {
      this.statusChangeListener = listener
    },
    /**
     * 检查并启动录制
     * @param recordId 录制任务id
     * @param options 检查参数，回调时会传回
     * @return {Promise<void>}
     */
    async checkAndStartRecord (recordId, options) {
      console.log(await this.$dbs.record._find_({_id: recordId}))
      // 查询是否正在录制，如是则跳过此次操作并抛出异常提示
      let record = (await this.$dbs.record._find_({_id: recordId}))[0]
      if (record.status === this.recordStatus.recording) {
        // 不能重复录制
        this.handlerListener().error(options, record, new Error('正在录制中,请勿重复操作'))
        return
      }
      // 更新上次检查时间
      this.$dbs.record._update_({_id: record._id}, {$set: {lastCheckTime: new Date()}}, {}).catch(e => {
        if (e) {
          console.log('更新上次检查时间出错: ' + e.message)
        }
      })
      // 检查录制文件存储文件夹是否存在
      if (!fs.existsSync(record.settings.outPutDir)) {
        // 不存在则弹出提示（自动检查也会弹出）
        this.handlerListener().error({showMessage: true}, record, new Error(`路径‘${record.settings.outPutDir}’ 不存在！`))
        return
      }
      // 调用开始检查
      this.handlerListener().startCheck(options, record)
      // 获取平台信息
      const Platform = livePlatform.getPlatform(record.platform.code)
      // 获取实例
      const platformRoom = new Platform()
      // 检查开播状态并返回直播流信息
      platformRoom.check(record.user, record.settings.preferenceQuality, record.settings.preferenceChannel).then(async result => {
        if (!result) {
          // 未开播，调用
          // this.$message.warning(`${record.user.name} 未开播！`)
          this.handlerListener().endCheck(options, record, false)
          return
        }
        if (this.stopCallbackMap[record._id]) {
          // 已经在录制，放弃本次操作
          this.handlerListener().endCheck(options, record, true, false)
          return
        }
        this.handlerListener().endCheck(options, record, true)
        if ((await this.$dbs.record._count_({_id: recordId})) <= 0) {
          // 检查过程中任务被删除，放弃
          this.handlerListener().end(options, record)
          return
        }
        // 生成文件路径 ${outPutDir}/${platformName}/${userName}
        const fileDir = path.join(record.settings.outPutDir, path.join(illegalPathCharRemove(Platform.platformInfo.name), illegalPathCharRemove(record.user.name)))
        console.log(fileDir)
        // 不存在则创建
        fs.mkdirsSync(fileDir)
        const fileName = illegalPathCharRemove(`${new Date().Format('yyyy-MM-dd [HH-mm-ss]')} ${result.title}`) + `.${record.settings.fileFormat}`
        // 输出文件路径
        let outFilePath = path.join(fileDir, fileName)
        let actualOutputPath = outFilePath
        let resumeTarget = null

        // 判断是否可以续录到上次未达分片时长的文件
        const resumable = await this.findResumableFile(recordId, record.settings, outFilePath)
        if (resumable) {
          resumeTarget = resumable.path
          // 续录模式：本次先录到临时文件，结束后合并回目标文件。
          // 注意：临时文件必须保留原扩展名（如 xxx.resuming.flv），否则 ffmpeg 无法推断输出格式而报 EINVAL。
          const ext = path.extname(outFilePath)
          actualOutputPath = outFilePath.slice(0, -ext.length) + '.resuming' + ext
          outFilePath = resumeTarget // 历史记录指向最终的目标文件
          this.resumeState[recordId] = {
            targetPath: resumeTarget,
            tempPath: actualOutputPath,
            targetHistoryId: resumable.historyId
          }
          console.log(`续录模式: 临时=${actualOutputPath} 目标=${resumeTarget}`)
        } else {
          delete this.resumeState[recordId]
        }

        // 插入录制历史记录
        const recordHistory = {
          recordId: recordId,
          file: {
            name: path.basename(outFilePath),
            format: record.settings.fileFormat,
            absolutePath: outFilePath
          },
          status: this.recordHistoryStatus.recording,
          quality: result.quality,
          channel: result.channel,
          title: result.title,
          startRecordTime: new Date(),
          stopRecordTime: null,
          errorMessage: null
        }
        // 插入一条录制记录
        let insertHistoryError = null
        const recordHistoryDoc = await this.$dbs.recordHistory._insert_(recordHistory).catch(e => {
          insertHistoryError = e
        })
        if (insertHistoryError) {
          // 出错
          this.handlerListener().error(options, record, insertHistoryError)
          return
        }
        // 上次自检时间，用于当任务进行中时不断调用回调onDoing
        let lastSelfCheckTime = null
        // 调用ffmpeg录制
        const command = ffmpeg()
        // 设置全局默认参数
        // IO 超时时间，单位微秒。原 20 秒对直播流过于激进（HLS 分片间隔+网络抖动
        // 很容易 20 秒无数据而误判中断），增大到 60 秒以减少网络波动导致的误杀。
        command.outputOptions('-rw_timeout', 60000000)
        // 根据不同平台设置不同输出操作
        Platform.setFFmpegOutputOptions(command, result.ffmpegCommandOutputOption)
        // 输出格式设置
        const videoOutPutFormatOptions = Platform.supportVideoOutPutFormats[record.settings.fileFormat]
        if (!videoOutPutFormatOptions) {
          // 格式不支持
          this.handlerListener().error(options, record, Error(`此平台不支持${record.settings.fileFormat}格式视频输出！`))
          return
        } else {
          // 追加视频输出格式参数FFmpegOutputOptions
          Platform.setFFmpegOutputOptions(command, videoOutPutFormatOptions)
        }
        const recordStartTime = Date.now()
        command.output(actualOutputPath)
          .on('error', async (e) => {
            // 续录模式下录制失败：删除临时文件，目标文件保持原样
            const rState = this.resumeState[recordId]
            if (rState) {
              try { if (fs.existsSync(rState.tempPath)) fs.unlinkSync(rState.tempPath) } catch (e2) {}
              delete this.resumeState[recordId]
            }
            // 计算退避时间：短时间就中断视为网络异常，连续异常时逐步拉长重连间隔，
            // 避免"中断->立刻重录"风暴产生大量几秒的无效片段。
            const duration = Date.now() - recordStartTime
            const backoff = this.computeReconnectBackoff(recordId, duration)
            console.log({m: 'ffmpeg error!!!', e, durationMs: duration, backoffMs: backoff})

            // 重置状态时把 lastCheckTime 推迟，扫描循环在退避期内不会重录
            const retryAt = new Date(Date.now() + backoff - (Number(record.settings.checkWindow) || 10) * 1000)
            await this.$dbs.record._update_({_id: recordId}, {$set: {status: this.recordStatus.waitToCheck, lastCheckTime: retryAt}}, {})
              .then(async _ => {
                await this.$dbs.recordHistory._update_({_id: recordHistoryDoc._id}, {$set: {status: this.recordHistoryStatus.failed, stopRecordTime: new Date(), errorMessage: e.message}}, {})
                this.handlerListener().error(options, record, e)
                this.removeStopCallback(recordId)
              }).catch(e1 => {
                this.handlerListener().error(options, record, e1)
                this.removeStopCallback(recordId)
              })
          })
          .on('end', async () => {
            // 正常结束，清除该任务的异常中断退避计数
            delete this.reconnectBackoff[recordId]
            // 续录模式：把临时文件合并回目标文件
            const rState = this.resumeState[recordId]
            let merged = false
            if (rState) {
              try {
                merged = await this.mergeResumedFile(rState.targetPath, rState.tempPath)
                if (merged) {
                  // 合并成功：更新目标历史记录的结束时间（时长=总时长），删除本次重复记录
                  await this.$dbs.recordHistory._update_({_id: rState.targetHistoryId}, {$set: {stopRecordTime: new Date()}}, {})
                  await this.$dbs.recordHistory._remove_({_id: recordHistoryDoc._id}, {})
                  console.log(`续录合并完成: ${rState.targetPath}`)
                }
              } catch (e) {
                console.log('续录合并异常:', e)
              }
              delete this.resumeState[recordId]
            }
            // 录制结束，重置record状态，recordHistory标记成功
            await this.$dbs.record._update_({_id: recordId}, {$set: {status: this.recordStatus.waitToCheck, lastCheckTime: new Date(), 'user.roomId': (result.roomId ? result.roomId : record.user.roomId)}}, {})
              .then(async _ => {
                if (!merged) {
                  await this.$dbs.recordHistory._update_({_id: recordHistoryDoc._id}, {$set: {status: this.recordHistoryStatus.success, stopRecordTime: new Date()}}, {})
                }
                this.handlerListener().end(options, record)
                this.removeStopCallback(recordId)
              })
              .catch(e => {
                this.handlerListener().error(options, record, e)
                this.removeStopCallback(recordId)
              })
            console.log('end!!!')
          })
          .on('stderr', stderrLine => {
            // console.log(stderrLine)
            // 每5秒调用一次
            if (lastSelfCheckTime === null || new Date().getTime() > lastSelfCheckTime + 5000) {
              lastSelfCheckTime = new Date().getTime()
              this.handlerListener().doing(options, record, recordHistory)
            }
          })
        if (this.stopCallbackMap[record._id] !== undefined) {
          // 多次检查，检查期间有其他检查已经在录制，放弃本次操作
          console.log({a: '录制冲突，跳过', b: this.stopCallbackMap})
          return
        }
        await this.$dbs.record._update_({_id: recordId}, {$set: {status: this.recordStatus.recording}}, {}).then(_ => {
          command.run()
          this.stopCallbackMap[record._id] = () => {
            command.ffmpegProc && command.ffmpegProc.stdin.write('q')
          }
          if (record.settings.autoFragment) {
            // 启动分片
            this.startAutoFragment(recordId)
          }
          this.handlerListener().start(options, record, recordHistory)
        }).catch(e => {
          this.handlerListener().error(options, record, e)
          this.removeStopCallback(recordId)
        })
      }).catch(e => {
        this.handlerListener().error(options, record, e)
      })
    },
    async startAutoFragment (recordId) {
      console.log('分片录制任务')
      const startRecordTime = new Date().getTime()
      while (this.stopCallbackMap[recordId]) {
        const record = (await this.$dbs.record._find_({_id: recordId}))[0]
        const fragmentLength = !record.settings.fragmentLength ? 1800 : record.settings.fragmentLength
        if (record.settings.autoFragment && (new Date().getTime() - startRecordTime) > fragmentLength * 1000) {
          console.log('启动分片')
          // 分片停止当前录制，启动新录制(不传递options)
          this.stopRecord(recordId)
          while (await this.isRecording(recordId)) {
            await sleep(100)
          }
          this.checkAndStartRecord(recordId)
          break
        }
        if (record.status === this.recordStatus.waitToCheck) {
          break
        }
        await sleep(this.checkScanWindow)
      }
    },
    /**
     * 查找可续录的上次录制文件。
     * 条件：同一录制任务、状态成功、文件存在、格式支持concat、
     *       上次时长未达分片时长、两次开始时间间隔在配置阈值内。
     * @return {Promise<string|null>} 可续接的文件绝对路径
     */
    async findResumableFile (recordId, settings, outFilePath) {
      try {
        // 仅 FLV/MP4/MKV/TS 支持 ffmpeg concat -c copy
        const ext = path.extname(outFilePath).toLowerCase()
        if (!['.flv', '.mp4', '.mkv', '.ts'].includes(ext)) return null
        const gapMinutes = Number(this.globalSettings.resumeGapMinutes)
        const maxGapMs = (Number.isFinite(gapMinutes) && gapMinutes > 0 ? gapMinutes : 10) * 60 * 1000
        const fragmentSeconds = Number(settings.fragmentLength) || 1800
        const now = Date.now()

        const histories = await this.$dbs.recordHistory._find_({recordId, status: this.recordHistoryStatus.success})
        if (!histories || histories.length === 0) return null
        // 取结束时间最近的一条（上次录完的文件）
        const endOf = r => r.stopRecordTime ? new Date(r.stopRecordTime).getTime() : 0
        const sorted = histories.slice().sort((a, b) => endOf(b) - endOf(a))
        const last = sorted[0]
        const startMs = last.startRecordTime ? new Date(last.startRecordTime).getTime() : 0
        const stopMs = endOf(last)
        // 关键：间隔按上次的【结束时间】算，而不是开始时间。
        // 否则一段录了很久的文件，即使刚停几秒就重开，也会因 start 太早被判定超时而不续录。
        if (!stopMs || (now - stopMs) > maxGapMs) return null
        const absPath = last.file && last.file.absolutePath
        if (!absPath || !fs.existsSync(absPath) || absPath === outFilePath) return null

        // 上次文件时长 = stop - start；未达分片时长才续录
        const durationSec = stopMs && startMs ? (stopMs - startMs) / 1000 : 0
        if (durationSec <= 0 || durationSec >= fragmentSeconds) return null
        // 文件需非空
        if (fs.statSync(absPath).size < 1024) return null
        return {path: absPath, historyId: last._id}
      } catch (e) {
        console.log('查找续录文件出错:', e)
        return null
      }
    },

    /**
     * 把本次录制的临时文件用 ffmpeg concat -c copy 合并到目标文件，成功后删除临时文件。
     */
    mergeResumedFile (targetPath, tempPath) {
      return new Promise((resolve, reject) => {
        if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1024) {
          // 临时文件无效，直接删掉，不动原文件
          try { fs.unlinkSync(tempPath) } catch (e) {}
          resolve(false)
          return
        }
        const listPath = tempPath + '.concat.txt'
        // concat 清单里的路径用正斜杠并转义单引号
        const safe = p => p.replace(/\\/g, '/').replace(/'/g, "'\\''")
        fs.writeFileSync(listPath, `file '${safe(targetPath)}'\nfile '${safe(tempPath)}'\n`)
        // 合并结果也必须保留原扩展名，否则 ffmpeg 无法推断 muxer 报 EINVAL
        const ext = path.extname(tempPath)
        const mergedPath = tempPath.slice(0, -ext.length) + '.merged' + ext
        ffmpeg()
          .input(listPath)
          .inputOptions('-f', 'concat', '-safe', '0')
          .outputOptions('-c', 'copy')
          .output(mergedPath)
          .on('end', () => {
            try {
              if (fs.existsSync(mergedPath) && fs.statSync(mergedPath).size > 0) {
                fs.copyFileSync(mergedPath, targetPath)
              }
              fs.unlinkSync(tempPath)
              if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath)
              if (fs.existsSync(listPath)) fs.unlinkSync(listPath)
              resolve(true)
            } catch (e) {
              reject(e)
            }
          })
          .on('error', e => {
            // 合并失败：清理临时文件，保留原文件
            try {
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
              if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath)
              if (fs.existsSync(listPath)) fs.unlinkSync(listPath)
            } catch (e2) {}
            console.log('续录合并失败:', e.message)
            resolve(false)
          })
          .run()
      })
    },

    /**
     * 计算录制异常中断后的重连退避时间（毫秒）。
     * 短时中断视为网络异常，连续异常时指数退避；录制较久后中断则视为偶发，重置计数。
     */
    computeReconnectBackoff (recordId, durationMs) {
      const MIN_DURATION = 2 * 60 * 1000 // 低于 2 分钟视为异常中断
      const BASE = 30 * 1000 // 基础退避 30 秒
      const MAX = 5 * 60 * 1000 // 最大退避 5 分钟
      let info = this.reconnectBackoff[recordId] || {failures: 0, lastFailTime: 0}
      // 距上次失败超过 10 分钟，认为已经恢复，重置计数
      if (Date.now() - info.lastFailTime > 10 * 60 * 1000) info.failures = 0
      if (durationMs >= MIN_DURATION) {
        // 录制了较久才断，属于偶发网络波动，重置计数，短暂退避
        info.failures = 0
      } else {
        info.failures += 1
      }
      info.lastFailTime = Date.now()
      this.reconnectBackoff[recordId] = info
      const backoff = info.failures === 0 ? BASE : Math.min(BASE * info.failures, MAX)
      return backoff
    },
    isRecording (recordId) {
      return new Promise(async resolve => {
        let docs = []
        if (recordId) {
          docs = await this.$dbs.record._find_({_id: recordId, status: this.recordStatus.recording})
        } else {
          docs = await this.$dbs.record._find_({status: this.recordStatus.recording})
        }
        if (docs && docs.length > 0) {
          return resolve(true)
        } else {
          return resolve(false)
        }
      })
    },
    removeStopCallback (recordId) {
      this.stopRecord(recordId)
    },
    stopRecord (recordId) {
      const stopCallback = this.stopCallbackMap[recordId]
      if (stopCallback) {
        stopCallback()
        delete this.stopCallbackMap[recordId]
      }
    },
    stopAll () {
      const recordIds = []
      for (const recordId of Object.keys(this.stopCallbackMap)) {
        recordIds.push(recordId)
      }
      for (const recordId of recordIds) {
        this.stopRecord(recordId)
      }
    },
    onAllRecordsStopped () {
      return new Promise(async resolve => {
        let time = 0
        while (await this.$manager.recordManager.isRecording()) {
          await sleep(100)
          time += 100
          if (time > 300000) {
            // 等待超过5分钟直接退出
            break
          }
        }
        resolve()
      })
    }
  },
  beforeDestroy () {
    this.checkRunning = false
    this.stopAll()
  }
})

export default recordManager
