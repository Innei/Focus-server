import Comment, {
  CommentRefTypes,
  CommentState,
} from '@libs/db/models/comment.model'
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { DocumentType } from '@typegoose/typegoose'
import { RolesGuard } from 'apps/server/src/auth/roles.guard'
import { Master } from 'libs/core/decorators/guest.decorator'
import { IpLocation, IpRecord } from 'libs/core/decorators/ip.decorator'
import { CannotFindException } from 'libs/core/exceptions/cant-find.exception'
import { PagerDto } from 'apps/server/src/shared/base/dto/pager.dto'
import {
  CommentDto,
  CommentRefTypesDto,
  TextOnlyDto,
} from 'apps/server/src/shared/comments/dto/comment.dto'
import { Pager } from 'apps/server/src/shared/comments/dto/pager.dto'
import { StateDto } from 'apps/server/src/shared/comments/dto/state.dto'
import { Auth } from '../../../../../libs/core/decorators/auth.decorator'
import { AdminEventsGateway } from '../../gateway/admin/events.gateway'
import { EventTypes } from '../../gateway/events.types'
import { ReplyMailType } from '../../plugins/mailer'
import { IdDto } from '../base/dto/id.dto'
import { CommentsService } from './comments.service'

@Controller('comments')
@ApiTags('Comment Routes')
@UseGuards(RolesGuard)
export class CommentsController {
  constructor(
    private readonly commentService: CommentsService,
    private readonly gateway: AdminEventsGateway,
  ) {
    // this.commentService.findOne({}).then((res) => {
    //   this.commentService.sendEmail(res, ReplyMailType.Owner)
    // })
  }

  @Get()
  @Auth()
  async getRecentlyComments(@Query() query: Pager) {
    const { size = 10, page = 1, state = 0 } = query
    return await this.commentService.getComments({ size, page, state })
  }

  @Get(':id')
  @ApiOperation({ summary: '根据 comment id 获取评论, 包括子评论' })
  async getComments(@Param() params: IdDto) {
    const { id } = params
    const data = await this.commentService
      .findOne({
        _id: id,
      })
      .populate('parent')
    if (!data) {
      throw new CannotFindException()
    }
    return data
  }

  @Get('/ref/:id')
  @ApiParam({
    name: 'id',
    description: 'refId',
    example: '5e6f67e85b303781d28072a3',
  })
  @ApiOperation({ summary: '根据评论的 refId 获取评论, 如 Post Id' })
  async getCommentsByRefId(@Param() params: IdDto, @Query() query: PagerDto) {
    const { id } = params
    const { page = 1, size = 10, select } = query
    const comments = await this.commentService.findWithPaginator(
      {
        parent: undefined,
        ref: id,
        $or: [
          {
            state: 0,
          },
          { state: 1 },
        ],
      },
      {
        limit: size,
        skip: (page - 1) * size,
        select,
        sort: { created: -1 },
      },
    )
    return comments
  }

  @Post(':id')
  @ApiOperation({ summary: '根据文章的 _id 评论' })
  async comment(
    @Param() params: IdDto,
    @Body() body: CommentDto,
    @Body('author') author: string,
    @Master() isMaster: boolean,
    @IpLocation() ipLocation: IpRecord,
    @Query() query: CommentRefTypesDto,
  ) {
    if (!isMaster) {
      await this.commentService.ValidAuthorName(author)
    }
    const { ref } = query

    const id = params.id
    if (
      !(await this.commentService.allowComment(
        id,
        ref || CommentRefTypes.Post,
      )) &&
      !Master
    ) {
      throw new ForbiddenException('主人禁止了评论')
    }

    const model = { ...body, ...ipLocation }

    const comment = await this.commentService.createComment(
      id,
      ref || CommentRefTypes.Post,
      model,
    )

    new Promise(async (resolve) => {
      if (await this.commentService.checkSpam(comment)) {
        comment.state = CommentState.Junk
        await comment.save()
      } else if (!isMaster) {
        this.commentService.sendEmail(comment, ReplyMailType.Owner)
        this.gateway.broadcase(EventTypes.COMMENT_CREATE, comment)
      }
      resolve(null)
    })

    return comment
  }

  @Post('/reply/:id')
  @ApiParam({
    name: 'id',
    description: 'cid',
    example: '5e7370bec56432cbac578e2d',
  })
  async replyByCid(
    @Param() params: IdDto,
    @Body() body: CommentDto,
    @Body('author') author: string,
    @Master() isMaster: boolean,
    @IpLocation() ipLocation: IpRecord,
  ) {
    if (!isMaster) {
      await this.commentService.ValidAuthorName(author)
    }

    const { id } = params

    const parent = await this.commentService.findById(id).populate('ref')
    if (!parent) {
      throw new CannotFindException()
    }
    const commentIndex = parent.commentsIndex
    const key = `${parent.key}#${commentIndex}`

    const model: Partial<Comment> = {
      parent,
      ref: (parent.ref as DocumentType<any>)._id,
      refType: parent.refType,
      ...body,
      ...ipLocation,
      key,
    }

    const comment = await this.commentService.createNew(model)

    await parent.updateOne({
      $push: {
        children: comment._id,
      },
      $inc: {
        commentsIndex: 1,
      },
      state:
        comment.state === CommentState.Read &&
        parent.state !== CommentState.Read
          ? CommentState.Read
          : parent.state,
    })
    if (isMaster) {
      this.commentService.sendEmail(comment, ReplyMailType.Guest)
    } else {
      this.commentService.sendEmail(
        comment,
        ReplyMailType.Owner,
        // comment.author,
      )
      this.gateway.broadcase(EventTypes.COMMENT_CREATE, comment)
    }
    return { message: '回复成功!' }
  }

  @Post('/master/comment/:id')
  @ApiOperation({ summary: '主人专用评论接口 需要登录' })
  @Auth()
  async commentByMaster(
    @Req() req: any,
    @Param() params: IdDto,
    @Body() body: TextOnlyDto,
    @IpLocation() ipLocation: IpRecord,
    @Query() query: CommentRefTypesDto,
  ) {
    // console.log(req.user)
    const { name, mail, url } = req.user
    const model: CommentDto = {
      author: name,
      ...body,
      mail,
      url,
      state: CommentState.Read,
    } as CommentDto
    return await this.comment(
      params,
      model as any,
      undefined,
      true,
      ipLocation,
      query,
    )
  }

  @Post('/master/reply/:id')
  @ApiOperation({ summary: '主人专用评论回复 需要登录' })
  @ApiParam({ name: 'id', description: 'cid' })
  @Auth()
  async replyByMaster(
    @Req() req: any,
    @Param() params: IdDto,
    @Body() body: TextOnlyDto,
    @IpLocation() ipLocation: IpRecord,
  ) {
    const { name, mail, url } = req.user
    const model: CommentDto = {
      author: name,
      ...body,
      mail,
      url,
      state: CommentState.Read,
    } as CommentDto
    return await this.replyByCid(params, model, undefined, true, ipLocation)
  }
  @Patch(':id')
  @ApiOperation({ summary: '修改评论的状态' })
  @Auth()
  async modifyCommentState(@Param() params: IdDto, @Body() body: StateDto) {
    const { id } = params
    const { state } = body

    try {
      const query = await this.commentService.updateAsync(
        {
          _id: id,
        },
        { state },
      )

      return query
    } catch {
      throw new CannotFindException()
    }
  }

  @Delete(':id')
  @Auth()
  async deleteComment(@Param() params: IdDto) {
    const { id } = params
    return await this.commentService.deleteComments(id)
  }
}
