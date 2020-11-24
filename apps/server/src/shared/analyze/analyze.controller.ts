import { RedisNames } from '@libs/common/redis/redis.types'
import { Controller, Delete, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import * as dayjs from 'dayjs'
import { RedisService } from 'nestjs-redis'
import { Auth } from '../../../../../libs/core/decorators/auth.decorator'
import { getTodayEarly, getWeekStart } from '../../../../../libs/utils/time'
import { PagerDto } from '../base/dto/pager.dto'
import { AnalyzeDto } from './analyze.dto'
import { AnalyzeService } from './analyze.service'

@Controller('analyze')
@ApiTags('Analyze Routes')
@Auth()
export class AnalyzeController {
  constructor(
    private readonly service: AnalyzeService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async getAnalyze(@Query() query: AnalyzeDto & Partial<PagerDto>) {
    const { from, to = new Date(), page = 1, size = 50 } = query

    const data = await this.service.getRangeAnalyzeData(from, to, {
      limit: ~~size,
      skip: (~~page - 1) * ~~size,
    })
    const total = await this.service.getCallTime()
    const redis = this.redisService.getClient(RedisNames.Access)
    const fromRedisIps = await redis.get('ips')
    const ips = fromRedisIps ? JSON.parse(fromRedisIps) : []
    return {
      ...data,
      total,
      today_ips: ips,
    }
  }

  @Get('today')
  async getAnalyzeToday(@Query() query: Partial<PagerDto>) {
    const { page = 1, size = 50 } = query
    const today = new Date()
    const todayEarly = getTodayEarly(today)
    return await this.service.getRangeAnalyzeData(todayEarly, today, {
      limit: ~~size,
      skip: (~~page - 1) * ~~size,
    })
  }

  @Get('week')
  async getAnalyzeWeek(@Query() query: Partial<PagerDto>) {
    const { page = 1, size = 50 } = query
    const today = new Date()
    const weekStart = getWeekStart(today)
    return await this.service.getRangeAnalyzeData(weekStart, today, {
      limit: ~~size,
      skip: (~~page - 1) * ~~size,
    })
  }

  @Get('fragment')
  async getFragment() {
    const day = await this.service.getIpAndPvAggregate('day', true)

    const now = new Date()
    const nowHour = now.getHours()
    const dayData = Array(24)
      .fill(undefined)
      .map((v, i) => {
        return [
          {
            hour: i === nowHour ? '现在' : i + '时',
            key: 'ip',
            value: day[i.toString().padStart(2, '0')]?.ip || 0,
          },
          {
            hour: i === nowHour ? '现在' : i + '时',
            key: 'pv',
            value: day[i.toString().padStart(2, '0')]?.pv || 0,
          },
        ]
      })
    const all = (await this.service.getIpAndPvAggregate('all')) as any[]

    const weekData = all
      .slice(0, 7)
      .map((item) => {
        const date =
          '周' +
          ['日', '一', '二', '三', '四', '五', '六'][
            dayjs(item.date).get('day')
          ]
        return [
          {
            day: date,
            key: 'ip',
            value: item.ip,
          },
          {
            day: date,
            key: 'pv',
            value: item.pv,
          },
        ]
      })
      .reverse()

    const monthData = all
      .slice(0, 30)
      .map((item) => {
        return [
          {
            date: item.date.split('-').slice(1, 3).join('-'),
            key: 'ip',
            value: item.ip,
          },
          {
            date: item.date.split('-').slice(1, 3).join('-'),
            key: 'pv',
            value: item.pv,
          },
        ]
      })
      .reverse()

    return {
      today: dayData.flat(1),
      weeks: weekData.flat(1),
      months: monthData.flat(1),
    }
  }

  @Get('like')
  async getTodayLikedArticle() {
    const client = this.redisService.getClient(RedisNames.Like)
    const keys = await client.keys('*mx_like*')
    return await Promise.all(
      keys.map(async (key) => {
        const id = key.split('_').pop()
        const json = await client.get(id)
        return {
          [id]: (JSON.parse(json) as {
            ip: string
            created: string
          }[]).sort(
            (a, b) =>
              new Date(a.created).getTime() - new Date(b.created).getTime(),
          ),
        }
      }),
    )
  }

  @Delete()
  async clearAnalyze(@Query() query: AnalyzeDto) {
    const { from = new Date('2020-01-01'), to = new Date() } = query
    await this.service.cleanAnalyzeRange({ from, to })
    return 'OK'
  }
}
