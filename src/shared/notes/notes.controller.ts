import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { FastifyReply } from 'fastify'
import { Session } from 'fastify-secure-session'
import { RolesGuard } from 'src/auth/roles.guard'
import { Auth } from 'src/core/decorators/auth.decorator'
import { Master } from 'src/core/decorators/guest.decorator'
import { CannotFindException } from 'src/core/exceptions/cant-find.exception'
import { PermissionInterceptor } from 'src/core/interceptors/permission.interceptors'
import { IdDto } from 'src/shared/base/dto/id.dto'
import { SearchDto } from 'src/shared/base/dto/search.dto'
import {
  ListQueryDto,
  NidType,
  NoteDto,
  NoteQueryDto,
  PasswordQueryDto,
} from 'src/shared/notes/dto/note.dto'
import { addConditionToSeeHideContent, yearCondition } from 'src/utils'
import { IpLocation, IpRecord } from '../../core/decorators/ip.decorator'
import { EventTypes } from '../../gateway/events.types'
import { WebEventsGateway } from '../../gateway/web/events.gateway'
import { NotesService } from './notes.service'

@ApiTags('Note Routes')
@Controller('notes')
@UseInterceptors(PermissionInterceptor)
@UseGuards(RolesGuard)
export class NotesController {
  constructor(
    private readonly noteService: NotesService,
    private readonly webgateway: WebEventsGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取随记带分页器' })
  @Auth()
  async getNotes(@Master() isMaster: boolean, @Query() query: NoteQueryDto) {
    const { size, select, page, sortBy, sortOrder, year } = query
    const condition = {
      ...addConditionToSeeHideContent(isMaster),
      ...yearCondition(year),
    }
    return await this.noteService.findWithPaginator(condition, {
      limit: size,
      skip: (page - 1) * size,
      select,
      sort: sortBy ? { [sortBy]: sortOrder || -1 } : { created: -1 },
    })
  }

  @Get('latest')
  @ApiOperation({ summary: '获取最新发布一篇随记' })
  async getLatestOne(
    @Master() isMaster: boolean,
    @IpLocation() location: IpRecord,
  ) {
    const { latest, next } = await this.noteService.getLatestOne(isMaster)
    this.noteService.shouldAddReadCount(latest, location.ip)
    return { data: latest.toObject(), next: next.toObject() }
  }

  @Get(':id')
  async getOneNote(
    @Param() params: IdDto,
    @Master() isMaster: boolean,
    @Query() query: PasswordQueryDto,
    @IpLocation() location: IpRecord,
  ) {
    const { id } = params
    const { password } = query
    const condition = addConditionToSeeHideContent(isMaster)
    const current = await this.noteService
      .findOne({
        _id: id,
        ...condition,
      })
      .select('+password')
    if (!current) {
      throw new CannotFindException()
    }
    if (
      !this.noteService.checkPasswordToAccess(current, password) &&
      !isMaster
    ) {
      throw new ForbiddenException('不要偷看人家的小心思啦~')
    }
    this.noteService.shouldAddReadCount(current, location.ip)
    const prev = await this.noteService
      .findOne({
        ...condition,
        created: {
          $gt: current.created,
        },
      })
      .sort({ created: 1 })
      .select('-text')
    const next = await this.noteService
      .findOne({
        ...condition,
        created: {
          $lt: current.created,
        },
      })
      .sort({ created: -1 })
      .select('-text')
    return { data: current, next, prev }
  }

  @Get('/list/:id')
  @ApiParam({ name: 'id', example: '5e6f71c5c052ca214fba877a', type: 'string' })
  @ApiOperation({ summary: '以一篇随记为基准的中间 10 篇随记' })
  async getNoteList(
    @Query() query: ListQueryDto,
    @Param() params: IdDto,
    @Master() isMaster: boolean,
  ) {
    const { size = 10 } = query
    const half = Math.floor(size / 2)
    const { id } = params
    const select = 'nid _id title created'
    const condition = addConditionToSeeHideContent(isMaster)
    const currentDocument = await this.noteService
      .findOne({
        _id: id,
        ...condition,
      })
      .select(select)
    if (!currentDocument) {
      throw new CannotFindException()
    }
    const prevList =
      half - 1 === 0
        ? []
        : await this.noteService.findAsync(
            {
              created: {
                $gt: currentDocument.created,
              },
              ...condition,
            },
            { limit: half - 1, sort: { created: -1 }, select },
          )
    const nextList = !half
      ? []
      : await this.noteService.findAsync(
          {
            created: {
              $lt: currentDocument.created,
            },
            ...condition,
          },
          { limit: half, sort: { created: -1 }, select },
        )
    const data = [...prevList, ...nextList, currentDocument].sort(
      (a: any, b: any) => b.created - a.created,
    )
    if (!data.length) {
      throw new CannotFindException()
    }
    return { data, size: data.length }
  }

  @Post()
  @Auth()
  async createNewNote(@Body() body: NoteDto) {
    const res = await this.noteService.createNew(body)
    this.noteService.RecordImageDimensions(res._id)
    this.webgateway.broadcase(EventTypes.NOTE_CREATE, res)
    return res
  }

  @Put(':id')
  @Auth()
  async modifyNote(@Body() body: NoteDto, @Param() params: IdDto) {
    const { id } = params
    const doc = await this.noteService.update({ _id: id }, body)
    this.noteService.RecordImageDimensions(id)
    this.webgateway.broadcase(EventTypes.NOTE_UPDATE, doc)
    return doc
  }

  @Get('like/:id')
  async likeNote(
    @Param() param: IdDto,
    @Req() req: FastifyReply & { session: Session },
    @Res() res: FastifyReply,
    @IpLocation() location: IpRecord,
  ) {
    const isLiked = !(await this.noteService.likeNote(param.id, location.ip))
    const liked = req.session.get('liked') as undefined | string[]
    if (!liked && !isLiked) {
      req.session.set('liked', [param.id])
    } else {
      if (isLiked || liked.includes(param.id)) {
        return res
          .status(422)
          .header('Access-Control-Allow-Origin', req.headers['origin'])
          .header('Access-Control-Allow-Credentials', true)
          .send({ message: '一天一次就够啦' })
      }
      req.session.set('liked', liked.concat(param.id))
    }

    res
      .header('Access-Control-Allow-Origin', req.headers['origin'])
      .header('Access-Control-Allow-Credentials', true)
      .send('OK')
  }

  @Delete(':id')
  @Auth()
  async deleteNote(@Param() params: IdDto) {
    const r = await this.noteService.deleteByIdAsync(params.id)
    this.webgateway.broadcase(EventTypes.NOTE_DELETE, params.id)
    return r
  }

  @ApiOperation({ summary: '根据 nid 查找' })
  @Get('/nid/:nid')
  async getNoteByNid(
    @Param() params: NidType,
    @Master() isMaster: boolean,
    @Query() query: PasswordQueryDto,
    @IpLocation() location: IpRecord,
  ) {
    const _id = await this.noteService.validNid(params.nid)
    return await this.getOneNote({ id: _id }, isMaster, query, location)
  }

  @ApiOperation({ summary: '根据 nid 修改' })
  @Put('/nid/:nid')
  @Auth()
  async modifyNoteByNid(@Param() params: NidType, @Body() body: NoteDto) {
    const _id = await this.noteService.validNid(params.nid)
    return await this.modifyNote(body, {
      id: _id,
    })
  }

  @ApiOperation({ summary: '搜索' })
  @Get('/search')
  async searchNote(@Query() query: SearchDto) {
    const { keyword, page, size } = query
    const select = '_id title created modified nid'
    const keywordArr = keyword
      .split(/\s+/)
      .map((item) => new RegExp(String(item), 'ig'))
    return await this.noteService.findWithPaginator(
      { $or: [{ title: { $in: keywordArr } }, { text: { $in: keywordArr } }] },
      {
        limit: size,
        skip: (page - 1) * size,
        select,
      },
    )
  }
}
