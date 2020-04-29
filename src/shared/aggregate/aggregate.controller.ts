import { FileType } from '@libs/db/models/file.model'
import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiProperty, ApiTags } from '@nestjs/swagger'
import { RolesGuard } from 'src/auth/roles.guard'
import { ConfigsService } from 'src/configs/configs.service'
import { Master } from 'src/core/decorators/guest.decorator'
import MasterService from 'src/master/master.service'
import { AggregateService } from 'src/shared/aggregate/aggregate.service'
import { RandomTypeDto } from './dtos/random.dto'
import { TopQueryDto } from './dtos/top.dto'
import { TimelineQueryDto, TimelineType } from './dtos/timeline.dto'
import { pick } from 'lodash'
import Category from '@libs/db/models/category.model'
import { yearCondition } from '../utils'
@Controller('aggregate')
@ApiTags('Aggregate Routes')
@UseGuards(RolesGuard)
export class AggregateController {
  constructor(
    private readonly service: AggregateService,
    private readonly configs: ConfigsService,
    private readonly userService: MasterService,
  ) {}
  @Get()
  async aggregate() {
    return {
      user: await this.userService.getMasterInfo(),
      seo: this.configs.seo,
      categories: await this.service.getAllCategory(),
      pageMeta: await this.service.getAllPages('title _id slug order'),
    }
  }

  @Get('top')
  @ApiProperty({ description: '获取最新发布的内容' })
  async top(@Query() query: TopQueryDto, @Master() isMaster: boolean) {
    const { size } = query
    return await this.service.topActivity(size, isMaster)
  }

  @Get('random')
  async getRandomImage(@Query() query: RandomTypeDto) {
    const { type, imageType = FileType.IMAGE, size = 1 } = query

    return await this.service.getRandomContent(type, imageType, size)
  }

  @Get('timeline')
  async getTimeline(@Query() query: TimelineQueryDto) {
    const { sort = 1, type, year } = query
    const data = {} as any

    const getPosts = async () => {
      const data = await this.service.postModel
        .find({ hide: false, ...yearCondition(year) })
        .sort({ created: sort })
        .populate('category')
        .lean()

      return data.map((item) => ({
        ...pick(item, ['_id', 'title', 'slug']),
        category: item.category,
        summary:
          item.summary ??
          (item.text.length > 150
            ? item.text.slice(0, 150) + '...'
            : item.text),
        url: encodeURI(
          '/posts/' + (item.category as Category).slug + '/' + item.slug,
        ),
      }))
    }
    const getNotes = async () =>
      await this.service.noteModel
        .find({
          hide: false,
          password: undefined,
          ...yearCondition(year),
        })
        .sort({ created: sort })
        .select('_id nid title weather mood')
        .lean()
    switch (type) {
      case TimelineType.Post: {
        data.posts = await getPosts()
        return
      }
      case TimelineType.Note: {
        data.notes = await getNotes()
        return
      }
      default: {
        data.notes = await getNotes()
        data.posts = await getPosts()
      }
    }

    return { data }
  }
}
