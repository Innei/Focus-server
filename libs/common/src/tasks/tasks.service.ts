import { HttpService, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ReturnModelType } from '@typegoose/typegoose'
import { execSync } from 'child_process'
import * as COS from 'cos-nodejs-sdk-v5'
import { existsSync, readFileSync, rmdirSync } from 'fs'
import * as mkdirp from 'mkdirp'
import { RedisService } from 'nestjs-redis'
import { InjectModel } from 'nestjs-typegoose'
import { join } from 'path'
import { TEMP_DIR } from 'apps/server/src/constants'
import { isDev } from 'apps/server/src/utils'

import { Analyze } from '../../../db/src/models/analyze.model'
import { RedisNames } from '../redis/redis.types'
import dayjs = require('dayjs')
import { ToolsService } from 'apps/server/src/common/global/tools/tools.service'
import { ConfigsService } from 'apps/server/src/common/global'
import { BackupsService } from 'apps/server/src/shared/backups/backups.service'

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name)
  constructor(
    private readonly configs: ConfigsService,
    @InjectModel(Analyze)
    private readonly analyzeModel: ReturnModelType<typeof Analyze>,
    private readonly redisCtx: RedisService,
    private readonly tools: ToolsService,
    private readonly http: HttpService,
  ) {}
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'backup' })
  backupDB({ uploadCOS = true }: { uploadCOS?: boolean } = {}) {
    if (!this.configs.get('backupOptions').enable) {
      return
    }
    this.logger.log('--> 备份数据库中')

    const dateDir = this.nowStr

    const backupDirPath = join(BackupsService.backupPath, dateDir)
    mkdirp.sync(backupDirPath)
    try {
      execSync(
        'mongodump -h 127.0.0.1 -d mx-space -o ' +
          backupDirPath +
          ' >/dev/null 2>&1',
        { encoding: 'utf-8' },
      )
      execSync('zip -r backup-' + dateDir + ' mx-space/* && rm -r mx-space', {
        cwd: backupDirPath,
        encoding: 'utf-8',
      })
      this.logger.log('--> 备份成功')
    } catch (e) {
      if (isDev) {
        console.log(e)
      }
      this.logger.error(
        '--> 备份失败, 请确保已安装 zip 或 mongo-tools, mongo-tools 的版本需要与 mongod 版本一致',
      )
      return
    }
    new Promise((reslove) => {
      if (!uploadCOS) {
        return reslove(null)
      }
      const backupOptions = this.configs.get('backupOptions')
      if (
        !backupOptions.Bucket ||
        !backupOptions.Region ||
        !backupOptions.SecretId ||
        !backupOptions.SecretKey
      ) {
        return
      }
      const backupFilePath = join(backupDirPath, 'backup-' + dateDir + '.zip')

      if (!existsSync(backupFilePath)) {
        this.logger.warn('文件不存在, 无法上传到 COS')
        return
      }
      this.logger.log('--> 开始上传到 COS')
      const cos = new COS({
        SecretId: backupOptions.SecretId,
        SecretKey: backupOptions.SecretKey,
      })
      // 分片上传
      cos.sliceUploadFile(
        {
          Bucket: backupOptions.Bucket,
          Region: backupOptions.Region,
          Key: `backup-${dateDir}.zip`,
          FilePath: backupFilePath,
        },
        (err) => {
          if (!err) {
            this.logger.log('--> 上传成功')
          } else {
            this.logger.error('--> 上传失败了' + err)
          }
        },
      )
      reslove('OK')
    })

    return readFileSync(join(backupDirPath, 'backup-' + dateDir + '.zip'))
  }
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT, {
    name: 'clear_access',
  })
  async cleanAccessRecord() {
    const now = new Date().getTime()
    const cleanDate = new Date(now - 7 * 60 * 60 * 24 * 1000)

    await this.analyzeModel.deleteMany({
      created: {
        $lte: cleanDate,
      },
    })
  }
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'reset_ua' })
  async resetIPAccess() {
    await this.redisCtx.getClient(RedisNames.Access).set('ips', '[]')
  }
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'reset_like_article' })
  async resetLikedOrReadArticleRecord() {
    const likeStore = this.redisCtx.getClient(RedisNames.Like)
    const readStore = this.redisCtx.getClient(RedisNames.Read)
    {
      const keys = await likeStore.keys('*mx_like*')
      keys.forEach((key) => {
        likeStore.del(key.split('_').pop())
      })
    }
    {
      const keys = await readStore.keys('*mx_read*')
      keys.forEach((key) => {
        readStore.del(key.split('_').pop())
      })
    }
  }
  get nowStr() {
    return dayjs().format('YYYY-MM-DD-HH:mm:ss')
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  cleanTempDirectory() {
    const tempDir = TEMP_DIR

    rmdirSync(tempDir, { recursive: true })

    mkdirp.sync(tempDir)
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  pushToBaiduSearch() {
    return new Promise(async (resolve, reject) => {
      const configs = this.configs.get('baiduSearchOptions')
      if (configs.enable) {
        const token = configs.token
        if (!token) {
          this.logger.error('[BaiduSearchPushTask] token 为空')
          return reject('token is empty')
        }
        const siteUrl = this.configs.get('url').webUrl

        const pushUrls = await this.tools.getSiteMapContent()
        const urls = pushUrls
          .map((item) => {
            return item.url
          })
          .join('\n')

        const res = await this.http
          .post(
            `http://data.zz.baidu.com/urls?site=${siteUrl}&token=${token}`,
            urls,
            {
              headers: {
                'Content-Type': 'text/plain',
              },
            },
          )
          .toPromise()
        this.logger.log(`提交结果: ${JSON.stringify(res.data)}`)
        return resolve(res.data)
      }
      return resolve(null)
    })
  }
}
