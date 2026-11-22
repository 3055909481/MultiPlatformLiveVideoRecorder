<template>
  <el-form
      :model="record"
      :rules="formRules"
      ref="recordForm"
      label-position="left"
      label-width="100px"
      size="mini">
    <el-form-item
        prop="idOrUrl">
      <label slot="label">
        直播间
      </label>
      <el-input v-model="record.idOrUrl" :disabled="!record.platform || edit" @blur="getUserInfo" :placeholder="getIdInputPlaceholder"/>
    </el-form-item>
    <el-form-item
        prop="platform">
      <label slot="label">
        直播平台
      </label>
      <el-select v-model="record.platform" :disabled="!record.platform || edit">
        <el-option v-for="livePlatform in livePlatforms" :key="livePlatform.platformInfo.code" :label="livePlatform.platformInfo.name" :value="livePlatform"/>
      </el-select>
    </el-form-item>
    <el-form-item
        prop="website">
      <label slot="label">
        平台地址
      </label>
      <el-input :value="record.website" disabled/>
    </el-form-item>
    <el-form-item
        prop="userName">
      <label slot="label">
        昵称
      </label>
      <el-input v-model="record.userName" :disabled="!record.platform || edit"/>
      <el-tooltip effect="light" content="若自动识别显示为房间号/ID，可直接在此手动修改。昵称保存后会用于录制文件夹命名。" placement="right">
        <em class="el-icon-warning important-help"></em>
      </el-tooltip>
    </el-form-item>
    <el-form-item
        prop="channel">
      <label slot="label">
        线路
      </label>
      <el-select v-model="record.channel" value-key="code">
        <el-option v-for="channel in record.platform ? record.platform.defaultConfig.channels : []" :key="channel.code" :label="channel.name" :value="channel"/>
      </el-select>
    </el-form-item>
    <el-form-item
        prop="quality">
      <label slot="label">
        清晰度
      </label>
      <el-select v-model="record.quality" value-key="code">
        <el-option v-for="quality in record.platform ? record.platform.defaultConfig.qualities : []" :key="quality.code" :label="quality.name" :value="quality"/>
      </el-select>
    </el-form-item>
    <el-form-item
      prop="autoCheck">
      <label slot="label">
        自动检查
      </label>
      <el-switch v-model="record.autoCheck"></el-switch>
    </el-form-item>
    <el-form-item
        v-if="record.autoCheck"
        prop="checkWindow">
      <label slot="label">
        检查窗口
      </label>
      <el-select v-model="record.checkWindow">
        <el-option label="5秒" :value="5"></el-option>
        <el-option label="10秒" :value="10"></el-option>
        <el-option label="15秒" :value="15"></el-option>
        <el-option label="20秒" :value="20"></el-option>
        <el-option label="30秒" :value="30"></el-option>
        <el-option label="1分钟" :value="60"></el-option>
        <el-option label="2分钟" :value="120"></el-option>
        <el-option label="5分钟" :value="300"></el-option>
        <el-option label="10分钟" :value="600"></el-option>
        <el-option label="30分钟" :value="1800"></el-option>
        <el-option label="1小时" :value="3600"></el-option>
        <el-option label="2小时" :value="7200"></el-option>
        <el-option label="4小时" :value="14400"></el-option>
      </el-select>
    </el-form-item>
    <el-form-item
        prop="autoFragment">
      <label slot="label">
        自动分片
      </label>
      <el-switch v-model="record.autoFragment"></el-switch>
    </el-form-item>
    <el-form-item
        v-if="record.autoFragment"
        prop="fragmentLength">
      <label slot="label">
        分片时长
      </label>
      <el-select v-model="record.fragmentLength">
        <el-option label="30分钟" :value="1800"></el-option>
        <el-option label="1小时" :value="3600"></el-option>
        <el-option label="1小时30分钟" :value="4800"></el-option>
        <el-option label="2小时" :value="7200"></el-option>
      </el-select>
    </el-form-item>
    <el-form-item
      prop="fileFormat">
      <label slot="label">
        格式
      </label>
      <el-select v-model="record.fileFormat">
        <el-option v-for="format in fileFormats" :key="format" :value="format" :label="format.toUpperCase()"/>
      </el-select>
    </el-form-item>
    <el-form-item
      prop="outPutDir">
      <label slot="label">
        输出文件夹
      </label>
      <el-input readonly v-model="record.outPutDir"></el-input>
      <el-button type="primary" size="small" @click="chooseOutputDir">选取</el-button>
    </el-form-item>
    <el-form-item>
      <el-button type="success" @click.native="save">保存</el-button>
    </el-form-item>
  </el-form>
</template>

<script>
import livePlatform from '../../../../live-platform/index'
import {getSettings} from '../../../../config/settings'
import {remote} from 'electron'
export default {
  name: 'DetailForm',
  props: {
    edit: {
      type: Boolean,
      default: false
    },
    recordId: {
      type: [Number, String]
    },
    subPage: {
      type: Object
    }
  },
  mounted () {
    this.record.platform = livePlatform.platforms[0]
    // 获取设置
    getSettings().then(settings => {
      if (settings) {
        this.globalSettings = settings
      } else {
        this.globalSettings = this.$manager.recordManager.globalSettings
      }
      if (this.globalSettings.defaultRecordVideoOutputFormat) {
        this.record.fileFormat = this.globalSettings.defaultRecordVideoOutputFormat
      }
      console.log({settings: this.globalSettings})
    }).catch(e => {
      console.log(e)
      this.$message.error('获取软件设置失败!')
      this.$router.back()
    })
  },
  data () {
    let checkWindowValidator = (rule, value, callback) => {
      if (this.record.autoCheck && Number(this.record.checkWindow) < 10) {
        callback((new Error('检查窗口时间不能为空，且最小10秒')))
      } else {
        // 必须调用
        callback()
      }
    }
    return {
      record: {
        platform: null,
        website: null,
        channel: null,
        quality: null,
        idOrUrl: null,
        userName: null,
        autoCheck: false,
        checkWindow: 10,
        outPutDir: null,
        fileFormat: 'flv',
        // 是否自动分片
        autoFragment: false,
        // 自动分片 30分钟，1800秒
        fragmentLength: 1800
      },
      oldRecord: null,
      livePlatforms: livePlatform.platforms,
      fileFormats: [],
      user: {},
      lastParseId: null,
      formRules: {
        platform: [
          {required: true, message: '平台信息不能为空', trigger: 'blur'}
        ],
        website: [
          {required: true, message: '不能为空', trigger: 'blur'}
        ],
        channel: [
          {required: true, message: '线路不能为空', trigger: 'blur'}
        ],
        quality: [
          {required: true, message: '清晰度不能为空', trigger: 'blur'}
        ],
        idOrUrl: [
          {required: true, message: 'id或url不能为空', trigger: 'blur'}
        ],
        userName: [
          {required: true, message: '名称不能为空不能为空', trigger: 'blur'}
        ],
        autoCheck: [
          {required: true, message: '不能为空', trigger: 'blur'}
        ],
        checkWindow: [
          {validator: checkWindowValidator, trigger: 'blur', required: true}
        ],
        autoFragment: [
          {required: true, message: '不能为空', trigger: 'blur'}
        ],
        fragmentLength: [
          {trigger: 'blur', required: true}
        ],
        outPutDir: [
          {required: true, message: '输出文件夹不能为空', trigger: 'blur'}
        ],
        fileFormat: [
          {required: true, message: '格式不能为空', trigger: 'blur'}
        ]
      },
      globalSettings: {}
    }
  },
  computed: {
    getIdInputPlaceholder () {
      return this.record.platform ? this.record.platform.defaultConfig.idPlaceholder : ''
    }
  },
  watch: {
    'record.platform': {
      handler (val) {
        this.record.channel = val.getChannelByCode(val)
        this.record.quality = val.getQualityByCode(val)
        this.record.website = val.platformInfo.website
        this.record.outPutDir = this.$manager.recordManager.globalSettings.defaultOuPutDir
        // 如果全局设置设置了默认录制视频输出格式则使用设置，否则取第一个默认值
        if (val.supportVideoOutPutFormats) {
          if (this.globalSettings.defaultRecordVideoOutputFormat && Object.keys(val.supportVideoOutPutFormats).indexOf(this.globalSettings.defaultRecordVideoOutputFormat) > -1) {
            this.record.fileFormat = this.globalSettings.defaultRecordVideoOutputFormat
          } else {
            this.record.fileFormat = Object.keys(val.supportVideoOutPutFormats).length > 0 ? Object.keys(val.supportVideoOutPutFormats)[0] : null
          }
        }
        this.fileFormats = val.supportVideoOutPutFormats ? Object.keys(val.supportVideoOutPutFormats) : []
      },
      deep: true
    },
    'record.autoFragment': {
      handler (val) {
        if (val) {
          this.$message.info('启用分片设置将在下次录制时生效')
        } else {
          this.$message.info('禁用分片设置立即生效，正在录制的任务将不再分片')
        }
      },
      deep: true
    },
    'record.idOrUrl': {
      handler (val) {
        if (!val || !/^https?:\/\//i.test(val)) return
        const platform = livePlatform.detectPlatformByUrl(val)
        if (platform && (!this.record.platform || platform.platformInfo.code !== this.record.platform.platformInfo.code)) {
          this.record.platform = platform
          this.$message.success(`已自动识别平台：${platform.platformInfo.name}`)
        }
      }
    },
    recordId (newRecordId) {
      if (this.edit) {
        // 编辑模式，数据库加载录制设置
        this.$dbs.record.find({_id: newRecordId}, (e, docs) => {
          if (docs.length >= 1) {
            let record = docs[0]
            let platform = null
            for (let _platform of this.livePlatforms) {
              if (_platform.platformInfo.code === record.platform.code) {
                platform = _platform
                break
              }
            }
            if (!platform) {
              return
            }
            this.record.platform = platform
            this.$nextTick(_ => {
              this.user = record.user
              this.record.userName = record.user.name
              this.record.idOrUrl = record.user.idShow
              // 兼容旧任务：失效的清晰度/线路自动回退到当前默认配置
              this.record.channel = platform.migratePreference(platform, record.settings.preferenceChannel, 'channel')
              this.record.quality = platform.migratePreference(platform, record.settings.preferenceQuality, 'quality')
              this.record.autoCheck = record.settings.autoCheck ? record.settings.autoCheck : false
              this.record.checkWindow = (!record.settings.checkWindow || Number(record.settings.checkWindow)) < 10 ? 10 : record.settings.checkWindow
              this.record.outPutDir = record.settings.outPutDir
              this.record.fileFormat = record.settings.fileFormat
              this.record.autoFragment = record.settings.autoFragment ? record.settings.autoFragment : false
              this.record.fragmentLength = !record.settings.fragmentLength ? 3600 : record.settings.fragmentLength
              this.oldRecord = record
            })
          }
        })
      }
    }
  },
  methods: {
    chooseOutputDir () {
      const result = remote.dialog.showOpenDialogSync({
        title: '选择输出文件夹',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result && result.length > 0) {
        console.log('选择输出文件夹:', result[0])
        this.record.outPutDir = result[0]
      }
    },
    getUserInfo () {
      if (!this.record.idOrUrl && this.record.idOrUrl === this.lastParseId) {
        return
      }
      // 获取用户信息
      let Platform = this.record.platform
      if (/^https?:\/\//i.test(this.record.idOrUrl) && Platform.isSupportedUrl && !Platform.isSupportedUrl(this.record.idOrUrl)) {
        this.$message.warning('输入的链接与所选直播平台不匹配，请检查平台选择')
        return
      }
      new Platform().getUserInfo(this.record.idOrUrl).then(res => {
        console.log(res)
        this.record.idOrUrl = res.idShow
        this.user = res
        this.record.userName = res.name
        this.lastParseId = res.idShow
        // 抖音号码占位说明自动识别失败，提示用户手动填写昵称
        if (Platform.platformInfo.code === 'douyin' && /^\d+$/.test(res.name)) {
          this.$message.warning('抖音昵称自动获取失败（可能未通过验证），请直接在「昵称」输入框手动填写')
        }
      }).catch(e => {
        this.$message.error('获取用户信息失败：' + (e.message || ''))
      })
    },
    save () {
      this.$refs.recordForm.validate(valid => {
        if (valid) {
          this.saveRecord()
        }
      })
    },
    saveRecord () {
      // 昵称框允许手动修改，保存时同步回 user 对象
      this.user = Object.assign({}, this.user, {name: this.record.userName})
      let record = {
        platform: {
          code: this.record.platform.platformInfo.code,
          name: this.record.platform.platformInfo.name,
          website: this.record.platform.platformInfo.website
        },
        user: this.user,
        settings: {
          preferenceChannel: this.record.channel,
          preferenceQuality: this.record.quality,
          outPutDir: this.record.outPutDir,
          autoCheck: this.record.autoCheck,
          checkWindow: this.record.checkWindow,
          fileFormat: this.record.fileFormat,
          autoFragment: this.record.autoFragment,
          fragmentLength: this.record.fragmentLength,
          top: this.oldRecord != null ? this.oldRecord.settings.top : undefined
        },
        status: 0,
        createTime: new Date(),
        lastCheckTime: null
      }
      console.log(record)
      console.log(this.$dbs.record.filename)
      if (this.edit) {
        this.$dbs.record.update({_id: this.recordId}, {$set: {settings: record.settings}}, {}, (e, num) => {
          console.log('更新：' + num)
          if (e) {
            console.log(e)
          }
          if (num) {
            this.$emit('save-success')
          }
        })
      } else {
        // 按平台 + 主播 ID 去重，避免不同平台同名主播被误判为重复
        const duplicateQuery = {
          'platform.code': this.record.platform.platformInfo.code,
          'user.id': this.user.id
        }
        this.$dbs.record.find(duplicateQuery, (e, docs) => {
          if (e) {
            console.log(e)
          }
          if (docs.length > 0) {
            this.$message.error('该主播的录制任务已存在')
          } else {
            this.$dbs.record.insert(record, (e, nDoc) => {
              if (nDoc) {
                this.$emit('save-success')
              }
              console.log(nDoc)
            })
          }
        })
      }
    },
    clear () {
      // 重置数据
      this.record = {
        platform: livePlatform.platforms[0],
        channel: null,
        quality: null,
        idOrUrl: null,
        userName: null,
        autoCheck: false,
        checkWindow: 10,
        outPutDir: null,
        fileFormat: 'flv',
        // 是否自动分片
        autoFragment: false,
        // 自动分片 60分钟
        fragmentLength: 3600
      }
      this.lastParseId = null
      this.$refs.recordForm.clearValidate()
    }
  }
}
</script>

<style scoped>
.el-input {
  max-width: 50%;
}
label {
  font-weight: bold;
  color: black;
}
em.important-help {
  margin-left: 5px;
}
</style>
